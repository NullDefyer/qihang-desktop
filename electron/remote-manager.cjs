const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { StringDecoder } = require("node:string_decoder");
const { HOST_COMMAND, parseHost, parseStats } = require("./remote-monitor.cjs");
const { normalizeDatabase, publicDatabase, sampleDatabase } = require("./remote-database.cjs");

function normalizeServer(value, id = crypto.randomUUID()) {
  const server = {
    id,
    name: String(value.name ?? "").trim(),
    host: String(value.host ?? "").trim(),
    port: Number(value.port || 22),
    username: String(value.username ?? "").trim(),
    auth: value.auth === "key" ? "key" : "password",
    privateKeyPath: String(value.privateKeyPath ?? "").trim(),
    useSudo: Boolean(value.useSudo),
    databases: Array.isArray(value.databases) ? value.databases.map((item) => normalizeDatabase(item, item.id)) : [],
    monitorSettings: { cpu: 90, memory: 85, disk: 85, seconds: 60, ...value.monitorSettings },
  };
  if (!server.name || !server.host || !server.username) throw new Error("请填写名称、服务器地址和 SSH 用户名。");
  if (!Number.isInteger(server.port) || server.port < 1 || server.port > 65535) throw new Error("SSH 端口必须在 1–65535 之间。");
  if (server.auth === "key" && !server.privateKeyPath) throw new Error("请选择 SSH 私钥文件。");
  return server;
}

function connectionError(error) {
  const message = error.message || "SSH 连接失败。";
  if (/authentication methods failed/i.test(message)) return "SSH 认证失败，请检查用户名、密码或私钥口令。";
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) return "无法解析服务器地址，请检查域名和网络连接。";
  if (/ECONNREFUSED/.test(message)) return "服务器拒绝连接，请检查 SSH 端口和 SSH 服务状态。";
  if (/timed out|ETIMEDOUT/i.test(message)) return "SSH 连接超时，请检查服务器地址、端口和网络连接。";
  return message;
}

function channelError(error) {
  if (/channel open failure/i.test(error.message || "")) {
    return new Error("服务器拒绝打开 SSH 日志/命令通道，可能是会话数已满或服务器资源不足。请断开后重新连接；若仍发生，请管理员检查 SSH MaxSessions 限制及服务器日志。");
  }
  return error;
}

function publicServer(server) {
  return {
    id: server.id, name: server.name, host: server.host, port: server.port,
    username: server.username, auth: server.auth, privateKeyPath: server.privateKeyPath,
    useSudo: server.useSudo, fingerprint: server.fingerprint,
    hasSavedPassword: Boolean(server.encryptedPassword),
    databases: (server.databases || []).map(publicDatabase),
    monitorSettings: server.monitorSettings || { cpu: 90, memory: 85, disk: 85, seconds: 60 },
  };
}

class RemoteManager {
  constructor({ directory, onEvent, confirmHost, createClient, secretStorage }) {
    this.filePath = path.join(directory, "remote-servers.json");
    this.onEvent = onEvent;
    this.confirmHost = confirmHost;
    this.secretStorage = secretStorage;
    this.createClient = createClient ?? (() => new (require("ssh2").Client)());
    this.session = null;
    try {
      this.servers = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (!Array.isArray(this.servers)) throw new Error("Invalid server list");
    } catch (error) {
      if (error.code !== "ENOENT") console.error("读取远程服务器配置失败", error.message);
      this.servers = [];
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(`${this.filePath}.tmp`, JSON.stringify(this.servers, null, 2), "utf8");
    fs.renameSync(`${this.filePath}.tmp`, this.filePath);
  }

  snapshot() {
    return {
      servers: this.servers.map(publicServer),
      connection: this.session ? { serverId: this.session.server.id, status: this.session.status } : null,
    };
  }

  upsert(value) {
    const existing = this.servers.find((server) => server.id === value.id);
    const server = normalizeServer(value, existing?.id);
    server.databases = existing?.databases || [];
    server.monitorSettings = existing?.monitorSettings || server.monitorSettings;
    // A changed endpoint must be verified again. Credentials never enter this file.
    if (existing?.host === server.host && existing.port === server.port) server.fingerprint = existing.fingerprint;
    const sameAccount = existing?.host === server.host && existing.port === server.port && existing.username === server.username && existing.auth === server.auth;
    if (server.auth === "password" && value.rememberPassword !== false) {
      if (sameAccount && existing.encryptedPassword) server.encryptedPassword = existing.encryptedPassword;
      if (value.rememberPassword === true && value.password) server.encryptedPassword = this.encryptPassword(value.password);
      if (value.rememberPassword === true && !server.encryptedPassword) throw new Error("请输入要保存的 SSH 密码；地址或用户名更改后需要重新输入。");
    }
    if (this.session?.server.id === server.id) this.disconnect();
    this.servers = existing ? this.servers.map((item) => item.id === server.id ? server : item) : [...this.servers, server];
    this.save();
    return publicServer(server);
  }

  encryptPassword(password) {
    if (!this.secretStorage?.isEncryptionAvailable()) throw new Error("系统密码加密不可用，请取消“记住密码”后重试。");
    return this.secretStorage.encryptString(password).toString("base64");
  }

  decryptPassword(server) {
    if (!server.encryptedPassword) return "";
    try {
      if (!this.secretStorage?.isEncryptionAvailable()) throw new Error("Encryption unavailable");
      return this.secretStorage.decryptString(Buffer.from(server.encryptedPassword, "base64"));
    } catch {
      throw new Error("已保存的密码无法解密，请重新输入密码，或在编辑服务器中取消保存密码。");
    }
  }

  remove(id) {
    if (this.session?.server.id === id) this.disconnect();
    this.servers = this.servers.filter((server) => server.id !== id);
    this.save();
    return true;
  }

  emit(session, type, data = {}) {
    if (this.session === session) this.onEvent({ serverId: session.server.id, type, ...data });
  }

  disconnect() {
    const session = this.session;
    if (!session) return true;
    this.stopLogs().catch(() => {});
    this.emit(session, "connection", { status: "disconnected" });
    this.session = null;
    session.client.end();
    session.cancel?.(new Error("连接已取消。"));
    return true;
  }

  async connect(id, credentials = {}) {
    const server = this.servers.find((item) => item.id === id);
    if (!server) throw new Error("服务器配置不存在。");
    this.disconnect();
    const client = this.createClient();
    const session = { client, server, status: "connecting", stream: null };
    this.session = session;
    this.emit(session, "connection", { status: "connecting" });
    try {
      const options = {
        host: server.host, port: server.port, username: server.username,
        readyTimeout: 20000, keepaliveInterval: 15000, keepaliveCountMax: 3,
        hostHash: "sha256",
        hostVerifier: (hash, callback) => {
          const fingerprint = `SHA256:${Buffer.from(hash, "hex").toString("base64").replace(/=+$/, "")}`;
          if (server.fingerprint) {
            if (server.fingerprint !== fingerprint) session.verifyError = "服务器指纹与已保存记录不一致，连接已阻止。请先核实服务器是否更换。";
            callback(server.fingerprint === fingerprint);
            return;
          }
          Promise.resolve(this.confirmHost(server, fingerprint)).then((accepted) => {
            if (!accepted) session.verifyError = "未信任服务器指纹，连接已取消。";
            else session.fingerprint = fingerprint;
            callback(Boolean(accepted) && this.session === session);
          }).catch(() => callback(false));
        },
      };
      if (server.auth === "key") {
        const stat = fs.statSync(server.privateKeyPath);
        if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("私钥文件无效或超过 1 MB。");
        options.privateKey = fs.readFileSync(server.privateKeyPath);
        if (credentials.passphrase) options.passphrase = credentials.passphrase;
      } else {
        options.password = credentials.password || this.decryptPassword(server);
        if (!options.password) throw new Error("请输入本次连接的 SSH 密码。");
        if (credentials.rememberPassword === false && server.encryptedPassword) {
          delete server.encryptedPassword;
          this.save();
        }
        // Check availability before authentication; only persist a replacement after success.
        if (credentials.rememberPassword === true) this.encryptPassword(options.password);
      }
      await new Promise((resolve, reject) => {
        session.cancel = reject;
        client.once("ready", resolve);
        client.on("error", (error) => {
          const message = session.verifyError || connectionError(error);
          session.status = "error";
          this.emit(session, "connection", { status: "error", message });
          reject(new Error(message));
        });
        client.on("close", () => {
          this.emit(session, "connection", { status: "disconnected" });
          if (this.session === session) this.session = null;
          reject(new Error(session.verifyError || "SSH 连接已断开。"));
        });
        client.connect(options);
      });
      session.cancel = null;
      if (this.session !== session) throw new Error("连接已取消。");
      if (session.fingerprint) {
        server.fingerprint = session.fingerprint;
        this.save();
      }
      if (server.auth === "password" && credentials.rememberPassword === true) {
        server.encryptedPassword = this.encryptPassword(options.password);
        this.save();
      }
      session.status = "connected";
      this.emit(session, "connection", { status: "connected" });
      return { serverId: id, status: "connected", hasSavedPassword: Boolean(server.encryptedPassword) };
    } catch (error) {
      if (this.session === session) {
        this.emit(session, "connection", { status: "error", message: error.message });
        this.session = null;
      }
      client.end();
      throw error;
    }
  }

  requireSession(id) {
    if (!this.session || this.session.server.id !== id || this.session.status !== "connected") throw new Error("请先连接所选服务器。");
    return this.session;
  }

  // Bounded one-shot command channel, separate from the long-running log stream.
  executeReadOnly(session, command) {
    return new Promise((resolve, reject) => {
      let channel, finished = false;
      const finish = (error, value) => { if (finished) return; finished = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => { finish(new Error("采集超时，请检查服务器资源和权限。")); channel?.close(); }, 15000);
      session.client.exec(command, (error, stream) => {
        if (error) { finish(channelError(error)); return; }
        channel = stream;
        if (finished || this.session !== session) { stream.close(); finish(new Error("连接已更改。")); return; }
        let stdout = "", stderr = "";
        stream.setEncoding("utf8"); stream.stderr.setEncoding("utf8");
        stream.on("data", chunk => { stdout += chunk; if (stdout.length > 4 * 1024 * 1024) { finish(new Error("采集结果超过大小限制。")); stream.close(); } });
        stream.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-4000); });
        stream.on("error", error => finish(error));
        stream.on("close", code => finish(this.session !== session ? new Error("连接已断开。") : code === 0 ? null : new Error(code === 42 ? "服务器资源监控目前支持 Linux。" : stderr.trim() || "采集失败，请检查 Docker 安装及只读访问权限。"), stdout));
      });
    });
  }

  async monitor(id) {
    const session = this.requireSession(id);
    if (session.monitorRequest) return session.monitorRequest;
    session.monitorRequest = (async () => {
      const host = parseHost(await this.executeReadOnly(session, HOST_COMMAND), session.monitorCounters);
      session.monitorCounters = host.counters;
      delete host.counters;
      return host;
    })();
    try { return await session.monitorRequest; } finally { session.monitorRequest = null; }
  }

  async containerStats(id) {
    const session = this.requireSession(id);
    if (session.statsRequest) return session.statsRequest;
    const prefix = session.server.useSudo ? "sudo -n " : "";
    session.statsRequest = this.executeReadOnly(session, `${prefix}docker stats --no-stream --format '{{json .}}'`).then(parseStats);
    try { return await session.statsRequest; } finally { session.statsRequest = null; }
  }

  async containerDetail({ serverId, containerId }) {
    if (!/^[a-f0-9]{12,64}$/.test(containerId)) throw new Error("容器 ID 无效。");
    const session = this.requireSession(serverId);
    const prefix = session.server.useSudo ? "sudo -n " : "";
    const format = '{"restartCount":{{.RestartCount}},"startedAt":{{json .State.StartedAt}},"memoryLimit":{{.HostConfig.Memory}},"image":{{json .Config.Image}},"ports":{{json .NetworkSettings.Ports}}}';
    return JSON.parse(await this.executeReadOnly(session, `${prefix}docker inspect --type container --format '${format}' -- ${containerId}`));
  }

  saveDatabase({ serverId, profile }) {
    const server = this.servers.find(item => item.id === serverId);
    if (!server) throw new Error("服务器配置不存在。");
    const existing = server.databases?.find(item => item.id === profile.id);
    const database = normalizeDatabase(profile, existing?.id);
    const same = existing && ["host", "port", "username", "type"].every(key => existing[key] === database[key]);
    if (profile.rememberPassword) {
      if (profile.password) database.encryptedPassword = this.encryptPassword(profile.password);
      else if (same && existing.encryptedPassword) database.encryptedPassword = existing.encryptedPassword;
    }
    server.databases = [...(server.databases || []).filter(item => item.id !== database.id), database];
    this.save();
    return publicDatabase(database);
  }

  saveMonitorSettings({ serverId, settings }) {
    const server = this.servers.find(item => item.id === serverId);
    if (!server) throw new Error("服务器配置不存在。");
    for (const key of ["cpu", "memory", "disk"]) if (!Number.isFinite(settings?.[key]) || settings[key] < 1 || settings[key] > 100) throw new Error("告警阈值应在 1–100% 之间。");
    if (!Number.isInteger(settings.seconds) || settings.seconds < 0 || settings.seconds > 3600) throw new Error("告警持续时间应在 0–3600 秒之间。");
    server.monitorSettings = { cpu: settings.cpu, memory: settings.memory, disk: settings.disk, seconds: settings.seconds };
    this.save(); return server.monitorSettings;
  }

  removeDatabase({ serverId, id }) {
    const server = this.servers.find(item => item.id === serverId);
    if (!server) throw new Error("服务器配置不存在。");
    server.databases = (server.databases || []).filter(item => item.id !== id);
    this.save(); return true;
  }

  async databaseMonitor({ serverId, id, password }) {
    const session = this.requireSession(serverId);
    const database = session.server.databases?.find(item => item.id === id);
    if (!database) throw new Error("数据库监控配置不存在，请重新连接 SSH。");
    return sampleDatabase(session, database, password || this.decryptPassword(database));
  }

  async listContainers(id) {
    const session = this.requireSession(id);
    const prefix = session.server.useSudo ? "sudo -n " : "";
    const output = await new Promise((resolve, reject) => {
      let channel;
      const timer = setTimeout(() => { channel?.close(); reject(new Error("读取容器列表超时。")); }, 20000);
      const finish = (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value); };
      session.client.exec(`${prefix}docker ps -a --no-trunc --format '{{json .}}'`, (error, stream) => {
        if (error) return finish(channelError(error));
        channel = stream;
        let stdout = "";
        let stderr = "";
        stream.setEncoding("utf8");
        stream.stderr.setEncoding("utf8");
        stream.on("data", (chunk) => {
          stdout += chunk;
          if (stdout.length > 4 * 1024 * 1024) { stream.close(); finish(new Error("容器列表过大。")); }
        });
        stream.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8000); });
        stream.on("error", (error) => finish(error));
        stream.on("close", (code) => finish(code === 0 ? null : new Error(stderr.trim() || "读取失败，请检查 Docker 是否安装、当前用户权限，以及免密 sudo 设置。"), stdout));
      });
    });
    return output.split(/\r?\n/).filter(Boolean).map((line) => {
      const value = JSON.parse(line);
      if (!/^[a-f0-9]{12,64}$/.test(value.ID)) throw new Error("服务器返回了无效的容器 ID。");
      return { id: value.ID, name: value.Names, image: value.Image, state: value.State, status: value.Status, ports: value.Ports };
    });
  }

  stopLogs() {
    const session = this.session;
    if (!session) return Promise.resolve(true);
    session.logRequest = null;
    session.streamId = null;
    return this.closeLogStream(session);
  }

  closeLogStream(session) {
    if (session.closingLog) return session.closingLog;
    const stream = session.stream;
    if (!stream) return Promise.resolve(true);
    session.stream = null;
    // Terminate only the remote docker-logs command, never the monitored container.
    // Wait for the server's channel-close acknowledgement before opening its replacement.
    const closing = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("旧日志通道未及时释放，请断开服务器后重新连接。")), 5000);
      stream.once("close", () => {
        clearTimeout(timer);
        session.closingLog = null;
        resolve(true);
      });
    });
    session.closingLog = closing;
    try { stream.signal("TERM", () => {}); } catch { /* Some SSH servers do not support signal requests. */ }
    stream.end();
    stream.close();
    return closing;
  }

  async followLogs({ serverId, containerId, tail, streamId }) {
    const session = this.requireSession(serverId);
    if (!/^[a-f0-9]{12,64}$/.test(containerId)) throw new Error("容器 ID 无效。");
    if (![100, 500, 1000].includes(tail)) throw new Error("日志行数无效。");
    if (typeof streamId !== "string" || streamId.length > 100) throw new Error("日志会话无效。");
    const request = { streamId };
    session.logRequest = request;
    const operation = (session.logQueue ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (this.session !== session || session.logRequest !== request) throw new Error("日志订阅已取消。");
      await this.closeLogStream(session);
      if (this.session !== session || session.logRequest !== request) throw new Error("日志订阅已取消。");
      session.streamId = streamId;
      await this.openLogStream(session, { containerId, tail, streamId, request });
      return true;
    });
    session.logQueue = operation;
    return operation;
  }

  async openLogStream(session, { containerId, tail, streamId, request }) {
    const prefix = session.server.useSudo ? "sudo -n " : "";
    await new Promise((resolve, reject) => {
      // A missing channel-open reply must not leave the UI loading indefinitely.
      const timer = setTimeout(() => {
        if (session.logRequest === request) session.logRequest = null;
        session.channelOpenTimedOut = true;
        reject(new Error("打开日志通道超时，请断开服务器后重新连接。"));
      }, 20000);
      if (session.channelOpenTimedOut) { clearTimeout(timer); reject(new Error("日志通道状态不确定，请断开服务器后重新连接。")); return; }
      session.client.exec(`${prefix}docker logs --follow --timestamps --tail ${tail} -- ${containerId}`, (error, stream) => {
        clearTimeout(timer);
        if (error) return reject(channelError(error));
        session.stream = stream;
        if (this.session !== session || session.logRequest !== request) {
          this.closeLogStream(session).then(() => reject(new Error("日志订阅已取消。")), reject);
          return;
        }
        const current = () => this.session === session && session.stream === stream;
        const attach = (source, kind) => {
          const decoder = new StringDecoder("utf8");
          let pending = "";
          const emitLine = (message) => {
            if (current()) this.emit(session, "log", { streamId, containerId, stream: kind, message: message.slice(0, 32768), timestamp: Date.now() });
          };
          source.on("data", (chunk) => {
            pending += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            const lines = pending.split(/\r?\n/);
            pending = lines.pop();
            lines.forEach(emitLine);
            if (pending.length > 32768) { emitLine(pending); pending = ""; }
          });
          return () => { pending += decoder.end(); if (pending) emitLine(pending); };
        };
        const flushOut = attach(stream, "stdout");
        const flushError = attach(stream.stderr, "stderr");
        stream.on("error", (error) => {
          if (current()) this.emit(session, "log-state", { streamId, status: "error", message: error.message });
        });
        stream.on("close", (code) => {
          flushOut(); flushError();
          if (current()) {
            session.stream = null;
            this.emit(session, "log-state", { streamId, status: code === 0 ? "ended" : "error", message: code === 0 ? "日志接收已结束，可重新接收。" : "日志读取失败，请检查容器和 Docker 权限。" });
          }
        });
        resolve();
      });
    });
    return true;
  }
}

module.exports = { RemoteManager, normalizeServer };
