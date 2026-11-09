const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn, execFile } = require("node:child_process");

const OUTPUT_LIMIT = 512 * 1024;

function validateCommand(value) {
  if (!value || typeof value.name !== "string" || !value.name.trim() || value.name.length > 120) throw new Error("请填写命令名称（最多 120 字）。");
  if (typeof value.command !== "string" || !value.command.trim() || value.command.length > 8000 || value.command.includes("\0")) throw new Error("命令内容不能为空，且最多 8000 字。");
  if (!["powershell", "cmd"].includes(value.shell)) throw new Error("请选择 PowerShell 或 CMD。");
  const cwd = typeof value.cwd === "string" && value.cwd.trim() ? value.cwd.trim() : os.homedir();
  if (!path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error("工作目录必须是存在的绝对目录。");
  return { id: value.id, name: value.name.trim(), command: value.command, shell: value.shell, cwd };
}

// One user-started command task at a time, independent of managed services.
// Output is bounded in memory and never written to the saved-command collection.
class CommandManager {
  constructor({ spawnProcess = spawn, executeFile = execFile } = {}) {
    this.spawnProcess = spawnProcess;
    this.executeFile = executeFile;
    this.child = null;
    this.result = null;
  }

  snapshot() { return this.result ? { ...this.result } : null; }
  get running() { return Boolean(this.child); }

  run(value) {
    if (this.child) throw new Error("已有命令正在运行，请等待完成或先停止。");
    const command = validateCommand(value);
    const options = { cwd: command.cwd, windowsHide: true, env: { ...process.env } };
    let child;
    if (command.shell === "powershell") {
      const script = `$ProgressPreference = 'SilentlyContinue'; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $OutputEncoding = [Console]::OutputEncoding;\n${command.command}`;
      const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      child = this.spawnProcess(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], options);
    } else {
      child = this.spawnProcess(`chcp 65001>nul & ${command.command}`, { ...options, shell: process.env.ComSpec || "cmd.exe" });
    }
    this.child = child;
    const result = this.result = { runId: randomUUID(), commandId: command.id, name: command.name, command: command.command, shell: command.shell, cwd: command.cwd, status: "running", startedAt: Date.now(), endedAt: null, exitCode: null, output: "", truncated: false };
    const append = (text) => {
      if (result.output.length + text.length > OUTPUT_LIMIT) result.truncated = true;
      result.output = (result.output + text).slice(-OUTPUT_LIMIT);
    };
    const decoders = [new TextDecoder("utf-8"), new TextDecoder("utf-8")];
    [child.stdout, child.stderr].forEach((stream, index) => stream?.on("data", (chunk) => append(decoders[index].decode(chunk, { stream: true }))));
    child.once("error", (error) => { append(`\n${error.message}\n`); result.status = "error"; });
    child.once("close", (code) => {
      decoders.forEach((decoder) => append(decoder.decode()));
      result.exitCode = code;
      result.endedAt = Date.now();
      result.status = result.status === "stopping" ? "stopped" : result.status === "error" || code !== 0 ? "error" : "completed";
      if (this.child === child) this.child = null;
    });
    return this.snapshot();
  }

  async stop() {
    const child = this.child;
    if (!child) return this.snapshot();
    const result = this.result;
    result.status = "stopping";
    try {
      if (process.platform === "win32" && child.pid) {
        await new Promise((resolve, reject) => this.executeFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, (error) => error && this.child === child ? reject(error) : resolve()));
      } else child.kill();
      const deadline = Date.now() + 5000;
      while (this.child === child && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 30));
      if (this.child === child) throw new Error("命令进程尚未退出，请稍后重试停止。");
    } catch (error) {
      if (this.child === child) result.status = "running";
      throw error;
    }
    return this.snapshot();
  }
}

module.exports = { CommandManager, validateCommand };
