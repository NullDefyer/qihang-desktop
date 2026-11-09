const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// Machine-wide program files remain read-only. Each Windows account creates
// and secures only its own child folder, without modifying sibling accounts.
function installationStorage(installationDirectory) {
  const marker = path.join(installationDirectory, ".qihang-all-users");
  if (!fs.existsSync(marker)) return { installationDirectory };
  if (!fs.lstatSync(marker).isFile() || fs.readFileSync(marker, "utf8") !== "account-storage-v1") throw new Error("全用户安装的数据模式标记无效。");
  const system = path.join(process.env.SystemRoot || "C:\\Windows", "System32");
  const identity = execFileSync(path.join(system, "whoami.exe"), ["/user", "/fo", "csv", "/nh"], { windowsHide: true, encoding: "utf8" });
  const account = identity.match(/S-1-5-(?:\d+-)*\d+/)?.[0];
  if (!account) throw new Error("无法确认当前 Windows 账号，未访问其他账号的数据。");
  for (const folder of ["data", "backups"]) {
    const root = path.join(installationDirectory, folder);
    if (fs.lstatSync(root).isSymbolicLink()) throw new Error("全用户数据根目录不能是链接。");
    const target = path.join(root, account);
    try { fs.mkdirSync(target, { recursive: false }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    execFileSync(path.join(system, "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "private-account-storage.ps1"), "-Directory", target, "-UserSid", account], { windowsHide: true });
  }
  return { installationDirectory, accountDirectory: account };
}

module.exports = { installationStorage };
