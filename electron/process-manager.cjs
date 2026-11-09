const { execFile, spawn } = require("node:child_process");

class ProcessManager {
  constructor({ onLog, onStatus, spawnProcess = spawn, executeFile = execFile }) {
    this.onLog = onLog;
    this.onStatus = onStatus;
    this.spawnProcess = spawnProcess;
    this.executeFile = executeFile;
    this.processes = new Map();
  }

  start(service) {
    if (service?.isExample) throw new Error("示例服务尚未配置，请选择本机目录并保存后再启动。");
    if (!service?.id || !service?.folder || !service?.startCommand) {
      throw new Error("服务目录和启动命令不能为空");
    }

    if (this.processes.has(service.id)) {
      return { status: "running", pid: this.processes.get(service.id).pid };
    }

    this.onStatus(service.id, "starting");
    this.onLog(service.id, "system", `正在启动 ${service.name}…`);

    const child = this.spawnProcess(service.startCommand, {
      cwd: service.folder,
      shell: true,
      windowsHide: true,
      env: { ...process.env },
    });

    this.processes.set(service.id, child);
    child.stdout?.on("data", (chunk) => this.emitChunk(service.id, "stdout", chunk));
    child.stderr?.on("data", (chunk) => this.emitChunk(service.id, "stderr", chunk));

    child.once("spawn", () => {
      this.onStatus(service.id, "running", child.pid);
      this.onLog(service.id, "system", `${service.name} 已启动，PID: ${child.pid}`);
    });

    child.once("error", (error) => {
      this.processes.delete(service.id);
      this.onStatus(service.id, "error");
      this.onLog(service.id, "stderr", error.message);
    });

    child.once("exit", (code, signal) => {
      this.processes.delete(service.id);
      this.onStatus(service.id, code === 0 || signal ? "stopped" : "error");
      this.onLog(
        service.id,
        code === 0 || signal ? "system" : "stderr",
        `${service.name} 已退出${signal ? `，信号: ${signal}` : `，退出码: ${code ?? "未知"}`}`,
      );
    });

    return { status: "starting", pid: child.pid ?? null };
  }

  async stop(serviceId) {
    const child = this.processes.get(serviceId);
    if (!child) {
      this.onStatus(serviceId, "stopped");
      return { status: "stopped" };
    }

    this.onStatus(serviceId, "stopping", child.pid);
    this.onLog(serviceId, "system", `正在停止进程树 PID: ${child.pid}…`);

    if (process.platform === "win32") {
      await new Promise((resolve, reject) => {
        this.executeFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], (error) => {
          if (error && !error.message.includes("not found")) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }

    this.processes.delete(serviceId);
    this.onStatus(serviceId, "stopped");
    return { status: "stopped" };
  }

  async stopAll() {
    await Promise.all([...this.processes.keys()].map((serviceId) => this.stop(serviceId)));
  }

  emitChunk(serviceId, stream, chunk) {
    String(chunk)
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .forEach((line) => this.onLog(serviceId, stream, line));
  }
}

module.exports = { ProcessManager };
