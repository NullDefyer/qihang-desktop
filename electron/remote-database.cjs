const crypto = require("node:crypto");
const net = require("node:net");

function normalizeDatabase(value, id = crypto.randomUUID()) {
  const type = value.type === "redis" ? "redis" : "mysql";
  const profile = { id, name: String(value.name || "").trim(), type, host: String(value.host || "127.0.0.1").trim(), port: Number(value.port || (type === "redis" ? 6379 : 3306)), username: String(value.username || "").trim(), database: String(value.database || "").trim() };
  if (!profile.name || !profile.host || profile.host.length > 253 || /[\s\0]/.test(profile.host)) throw new Error("请填写数据库名称和有效地址。");
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) throw new Error("数据库端口无效。");
  if (type === "mysql" && !profile.username) throw new Error("请填写 MySQL 只读监控用户名。");
  return profile;
}
function publicDatabase(value) {
  return { ...normalizeDatabase(value, value.id), hasSavedPassword: Boolean(value.encryptedPassword) };
}

// The forwarding listener binds only loopback and exists for a single bounded
// sample. Credentials go through driver protocols, never remote shell arguments.
async function withTunnel(session, profile, operation, signal) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
    session.client.forwardOut("127.0.0.1", 0, profile.host, profile.port, (error, channel) => {
      if (error || socket.destroyed || !server.listening) { channel?.destroy(); socket.destroy(); return; }
      sockets.add(channel); channel.on("close", () => sockets.delete(channel)); channel.on("error", () => socket.destroy());
      socket.on("close", () => channel.destroy()); channel.on("close", () => socket.destroy());
      socket.pipe(channel).pipe(socket);
    });
  });
  const abort = () => { for (const socket of sockets) socket.destroy(); server.close(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw new Error("采集已取消。");
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    return await operation(server.address().port);
  } finally { signal?.removeEventListener("abort", abort); abort(); }
}

async function sampleDatabase(session, profile, password) {
  let client, deadline;
  const controller = new AbortController();
  const at = Date.now();
  try {
    return await Promise.race([
      withTunnel(session, profile, async port => {
        if (profile.type === "mysql") {
          client = await require("mysql2/promise").createConnection({ host: "127.0.0.1", port, user: profile.username, password, ...(profile.database ? { database: profile.database } : {}), connectTimeout: 4000, multipleStatements: false, enableKeepAlive: false });
          if (controller.signal.aborted) { client.destroy(); throw new Error("采集已取消。"); }
          const query = async sql => (await client.query({ sql, timeout: 4000 }))[0];
          const start = Date.now(); const version = (await query("SELECT VERSION() AS version"))[0].version;
          const latency = Date.now() - start;
          const result = { at: Date.now(), type: "mysql", version, latency, errors: {} };
          const collect = async (key, sql) => { try { result[key] = await query(sql); } catch { result.errors[key] = "无权限或当前数据库版本不支持此指标"; result[key] = null; } };
          await collect("status", "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Slow_queries','Connections')");
          await collect("variables", "SHOW GLOBAL VARIABLES WHERE Variable_name IN ('max_connections')");
          await collect("sessions", "SELECT ID, USER, HOST, COMMAND, TIME FROM information_schema.PROCESSLIST LIMIT 100");
          await collect("transactions", "SELECT trx_id, trx_mysql_thread_id, trx_started, trx_state FROM information_schema.innodb_trx LIMIT 100");
          await collect("locks", "SELECT OBJECT_SCHEMA, OBJECT_NAME, LOCK_TYPE, LOCK_STATUS FROM performance_schema.data_locks WHERE LOCK_STATUS='WAITING' LIMIT 100");
          const status = Object.fromEntries((result.status || []).map(row => [row.Variable_name, Number(row.Value)]));
          result.connections = Number.isFinite(status.Threads_connected) ? status.Threads_connected : null;
          result.active = Number.isFinite(status.Threads_running) ? status.Threads_running : null;
          result.idle = result.connections != null && result.active != null ? Math.max(0, result.connections - result.active) : null;
          result.maxConnections = result.variables?.length ? Number(result.variables[0].Value) : null;
          result.slowQueries = Number.isFinite(status.Slow_queries) ? status.Slow_queries : null;
          return result;
        }
        client = require("redis").createClient({ socket: { host: "127.0.0.1", port, connectTimeout: 4000, reconnectStrategy: false }, ...(profile.username ? { username: profile.username } : {}), ...(password ? { password } : {}) });
        client.on("error", () => {}); await client.connect();
        if (controller.signal.aborted) { client.destroy(); throw new Error("采集已取消。"); }
        const start = Date.now(); await client.ping(); const latency = Date.now() - start;
        const result = { at: Date.now(), type: "redis", latency, errors: {} };
        let info;
        try { info = Object.fromEntries((await client.info()).split(/\r?\n/).filter(line => line && !line.startsWith("#")).map(line => { const colon = line.indexOf(":"); return [line.slice(0, colon), line.slice(colon + 1)]; })); }
        catch { result.errors.info = "无 INFO 权限，无法读取内部指标"; }
        const numeric = key => info?.[key] != null && Number.isFinite(Number(info[key])) ? Number(info[key]) : null;
        result.version = info?.redis_version || "未知"; result.connections = numeric("connected_clients"); result.memoryUsed = numeric("used_memory"); result.operations = numeric("instantaneous_ops_per_sec");
        try { const config = await client.sendCommand(["CONFIG", "GET", "maxclients"]); const value = Array.isArray(config) ? config[config.indexOf("maxclients") + 1] : config.maxclients; result.maxConnections = Number.isFinite(Number(value)) ? Number(value) : null; } catch { result.maxConnections = null; result.errors.limit = "无 CONFIG GET 权限，最大连接数未知"; }
        try { result.sessions = (await client.sendCommand(["CLIENT", "LIST"])).trim().split("\n").slice(0, 100).map(line => Object.fromEntries(line.split(" ").filter(Boolean).map(pair => { const at = pair.indexOf("="); return [pair.slice(0, at), pair.slice(at + 1)]; }))).map(row => ({ ID: row.id, USER: row.user || "default", HOST: row.addr, COMMAND: row.cmd, TIME: row.idle })); } catch { result.sessions = null; result.errors.sessions = "无 CLIENT LIST 权限"; }
        return result;
      }, controller.signal),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("数据库采集超时")), 12000); }),
    ]);
  } catch {
    // Driver error strings can include usernames or SQL. Keep errors useful
    // without echoing credentials or queries to renderer/logs.
    throw new Error("数据库连接或采集失败，请检查 SSH 转发权限、地址、认证、只读账号权限及是否需要 TLS。当前通过 SSH 隧道使用数据库普通 TCP 协议。");
  } finally {
    clearTimeout(deadline);
    controller.abort();
    if (profile.type === "mysql") client?.destroy();
    else if (client?.isOpen) client.destroy();
  }
}
module.exports = { normalizeDatabase, publicDatabase, sampleDatabase, withTunnel };
