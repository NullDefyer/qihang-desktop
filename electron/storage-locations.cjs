const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

class StorageLocations {
  constructor(defaultDirectory, { installationDirectory, accountDirectory } = {}) {
    this.defaultDirectory = path.resolve(defaultDirectory);
    if (accountDirectory && !/^S-1-5-(?:\d+-)*\d+$/.test(accountDirectory)) throw new Error("Windows 账号目录无效。");
    const installedData = installationDirectory ? path.join(path.resolve(installationDirectory), "data", accountDirectory || "") : this.defaultDirectory;
    const installedBackups = installationDirectory ? path.join(path.resolve(installationDirectory), "backups", accountDirectory || "") : path.join(this.defaultDirectory, "backups");
    // A packaged installation owns its pointer. A different installation must
    // never silently reuse the global legacy profile (including SSH servers).
    this.configPath = path.join(installedData, "storage-locations.json");
    let config = {};
    let configured = false;
    try { config = JSON.parse(fs.readFileSync(this.configPath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw new Error(`无法读取存储位置设置，请检查 ${this.configPath}：${error.message}`); }
    configured = Boolean(config.dataDirectory);
    if (config.dataDirectory && !fs.existsSync(config.dataDirectory)) throw new Error(`自定义数据目录不存在或无法访问：${config.dataDirectory}。请恢复目录后重试，或检查 ${this.configPath}。`);
    this.dataDirectory = this.resolveDirectory(config.dataDirectory || installedData);
    this.backupDirectory = this.resolveDirectory(config.backupDirectory || (installationDirectory ? installedBackups : path.join(this.dataDirectory, "backups")));
    try { this.checkWritable(this.dataDirectory); this.checkWritable(this.backupDirectory); }
    catch (error) { throw new Error(`数据或备份目录不可写：${error.message}。请将启航安装到当前用户有写入权限的目录。`); }
    this.importCandidates = [];
    if (installationDirectory && !configured) {
      const candidates = [{ dataDirectory: installedData, backupDirectory: installedBackups }];
      try {
        const legacy = JSON.parse(fs.readFileSync(path.join(this.defaultDirectory, "storage-locations.json"), "utf8"));
        if (legacy.dataDirectory) candidates.push(legacy);
      } catch { /* Legacy discovery is optional; it never changes active data. */ }
      candidates.push({ dataDirectory: this.defaultDirectory, backupDirectory: path.join(this.defaultDirectory, "backups") });
      if (accountDirectory) candidates.push({ dataDirectory: path.join(installationDirectory, "data"), backupDirectory: path.join(installationDirectory, "backups") });
      this.importCandidates = candidates.filter((item, index) => typeof item.dataDirectory === "string" && path.isAbsolute(item.dataDirectory) && this.hasRecords(item.dataDirectory) && candidates.findIndex((other) => other.dataDirectory === item.dataDirectory) === index);
      this.needsInitialization = true;
    }
  }

  hasRecords(directory) {
    return ["qihang-state.json", "remote-servers.json"].some((name) => fs.existsSync(path.join(directory, name)));
  }

  initialize(sourceDirectory) {
    if (!this.needsInitialization) return;
    const source = sourceDirectory ? fs.realpathSync(sourceDirectory) : null;
    if (source && !this.hasRecords(source)) throw new Error("所选目录没有启航数据，请选择包含 qihang-state.json 或 remote-servers.json 的目录。");
    const originalData = this.dataDirectory;
    const originalBackup = this.backupDirectory;
    // An explicit clean start must preserve existing records in place. Use a
    // new child only when the installation's default folder is already used.
    if (this.hasRecords(this.dataDirectory) && source !== this.dataDirectory) {
      this.dataDirectory = this.resolveDirectory(path.join(this.dataDirectory, `fresh-${crypto.randomUUID()}`));
    }
    try {
      if (source) {
        const candidate = this.importCandidates.find((item) => fs.realpathSync(item.dataDirectory) === source);
        this.copyLegacyDefaults(source, candidate?.backupDirectory);
      }
      this.persist(this.dataDirectory, this.backupDirectory);
      this.needsInitialization = false;
      this.importCandidates = [];
    } catch (error) {
      this.dataDirectory = originalData; this.backupDirectory = originalBackup;
      throw error;
    }
  }

  copyLegacyDefaults(sourceDirectory = this.defaultDirectory, sourceBackupDirectory) {
    const names = ["qihang-state.json", "remote-servers.json"];
    // Only migrate an unconfigured legacy profile into an unused installation.
    // Existing installation data and explicit location choices always win.
    const existing = this.dataDirectory === sourceDirectory || names.some((name) => fs.existsSync(path.join(this.dataDirectory, name)));
    const sources = existing ? [] : names.filter((name) => fs.existsSync(path.join(sourceDirectory, name)));
    const copies = [];
    try {
      for (const name of sources) this.copyVerified(path.join(sourceDirectory, name), path.join(this.dataDirectory, name), copies);
      const previousBackups = sourceBackupDirectory || path.join(sourceDirectory, "backups");
      if (fs.existsSync(previousBackups) && fs.realpathSync(previousBackups) !== this.backupDirectory) {
        for (const entry of fs.readdirSync(previousBackups, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
          const destination = path.join(this.backupDirectory, entry.name);
          if (fs.existsSync(destination)) continue;
          this.copyVerified(path.join(previousBackups, entry.name), destination, copies);
        }
      }
    } catch (error) {
      for (const copy of copies) { try { fs.unlinkSync(copy); } catch { /* Keep the original legacy profile intact. */ } }
      throw new Error(`旧版本数据复制失败，原文件仍保留：${error.message}`);
    }
  }

  copyVerified(source, destination, copies) {
    if (!fs.lstatSync(source).isFile()) throw new Error(`数据文件不是常规文件：${source}`);
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    copies.push(destination);
    if (!fs.readFileSync(source).equals(fs.readFileSync(destination))) throw new Error(`数据复制校验失败：${source}`);
  }

  resolveDirectory(directory) {
    if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new Error("请选择有效的绝对目录路径。");
    fs.mkdirSync(directory, { recursive: true });
    return fs.realpathSync(directory);
  }

  snapshot() {
    return { dataDirectory: this.dataDirectory, backupDirectory: this.backupDirectory };
  }

  persist(dataDirectory, backupDirectory) {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const temporary = `${this.configPath}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ dataDirectory, backupDirectory }, null, 2), "utf8");
      fs.renameSync(temporary, this.configPath);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  checkWritable(directory) {
    const probe = path.join(directory, `.qihang-write-check-${crypto.randomUUID()}`);
    fs.writeFileSync(probe, "", { flag: "wx" });
    fs.unlinkSync(probe);
  }

  setBackupDirectory(directory, personalManager) {
    const target = this.resolveDirectory(directory);
    this.checkWritable(target);
    this.persist(this.dataDirectory, target);
    this.backupDirectory = target;
    personalManager.backupDirectory = target;
    return this.snapshot();
  }

  moveData(directory, { store, remoteManager, personalManager }) {
    const target = this.resolveDirectory(directory);
    if (target === this.dataDirectory) return this.snapshot();
    this.checkWritable(target);
    const files = ["qihang-state.json", "remote-servers.json"];
    if (files.some((name) => fs.existsSync(path.join(target, name)))) {
      throw new Error("目标目录已有启航数据。为避免覆盖，请选择空目录或新建一个文件夹。");
    }
    const copied = [];
    try {
      for (const name of files) {
        const source = path.join(this.dataDirectory, name);
        if (!fs.existsSync(source)) continue;
        const destination = path.join(target, name);
        fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
        copied.push(destination);
        if (!fs.readFileSync(source).equals(fs.readFileSync(destination))) throw new Error("数据复制校验失败，未更改当前目录。");
      }
      // Switch the small bootstrap pointer only after verified copies exist.
      // Original files and Chromium caches stay in place; active services are unaffected.
      this.persist(target, this.backupDirectory);
    } catch (error) {
      for (const destination of copied) {
        try { fs.unlinkSync(destination); } catch { /* Unused copies can remain; active location is unchanged. */ }
      }
      throw error;
    }
    this.dataDirectory = target;
    store.filePath = path.join(target, "qihang-state.json");
    remoteManager.filePath = path.join(target, "remote-servers.json");
    personalManager.directory = target;
    return this.snapshot();
  }
}

module.exports = { StorageLocations };
