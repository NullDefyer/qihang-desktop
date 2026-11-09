import { desktop, isDesktop } from "./desktop.js";

// Browser previews use local demo data and never initiate SSH connections.
const listeners = new Set();
let previewServers = [{ id: "demo", name: "测试服务器（演示）", host: "192.168.10.20", port: 22, username: "deploy", auth: "password" }];
let previewTimer;
let previewConnection = null;
const emit = (event) => listeners.forEach((listener) => listener(event));
const ok = (value) => Promise.resolve({ ok: true, value });
const demoContainers = [
  { id: "a".repeat(64), name: "nacos-server", image: "nacos/nacos-server:v2.3.0", state: "running", status: "Up 2 hours", ports: "8848 → 8848" },
  { id: "b".repeat(64), name: "redis", image: "redis:7.2", state: "running", status: "Up 2 hours", ports: "6379 → 6379" },
  { id: "c".repeat(64), name: "nginx", image: "nginx:1.25", state: "running", status: "Up 2 hours", ports: "80 → 80" },
  { id: "d".repeat(64), name: "mysql", image: "mysql:8.0", state: "exited", status: "Exited (0)", ports: "" },
];
const previewApi = {
  snapshot: () => ok({ servers: previewServers, connection: previewConnection }),
  save: (value) => {
    const { password, passphrase, rememberPassword, ...profile } = value;
    const server = { ...profile, id: value.id || crypto.randomUUID(), hasSavedPassword: Boolean(rememberPassword && (password || value.hasSavedPassword)) };
    previewServers = [...previewServers.filter((item) => item.id !== server.id), server];
    return ok(server);
  },
  remove: (id) => { previewServers = previewServers.filter((item) => item.id !== id); return ok(true); },
  connect: ({ id, credentials }) => {
    previewServers = previewServers.map((server) => server.id === id ? { ...server, hasSavedPassword: Boolean(credentials?.rememberPassword) } : server);
    previewConnection = { serverId: id, status: "connected" };
    emit({ type: "connection", ...previewConnection });
    return ok({ ...previewConnection, hasSavedPassword: Boolean(credentials?.rememberPassword) });
  },
  disconnect: () => { clearInterval(previewTimer); if (previewConnection) emit({ type: "connection", ...previewConnection, status: "disconnected" }); previewConnection = null; return ok(true); },
  containers: () => ok(demoContainers),
  monitor: () => ok({ at: Date.now(), os: "Linux（演示）", cores: 4, cpuPercent: 28.6, memoryPercent: 62.4, memoryUsed: 5360110797, memoryTotal: 8589934592, diskPercent: 86.2, diskUsed: 92556544507, diskTotal: 107374182400, load: [0.82, 0.61, 0.45], receiveRate: 1300234, sendRate: 274432, interfaces: ["eth0"] }),
  stats: () => ok(demoContainers.filter(item => item.state === "running").map((item, index) => ({ id: item.id, name: item.name, cpuPercent: [8.2, 1.4, 0.3][index], memoryPercent: [56, 12, 2][index], memory: ["1.12 GB / 2 GB", "128 MB / 1 GB", "24 MB / 1 GB"][index], network: "128 MB / 64 MB", blockIO: "320 MB / 85 MB" }))),
  detail: () => ok({ restartCount: 0, memoryLimit: 2147483648, startedAt: new Date(Date.now() - 100000000).toISOString() }),
  monitorSettings: ({ serverId, settings }) => { previewServers = previewServers.map(item => item.id === serverId ? { ...item, monitorSettings: settings } : item); return ok(settings); },
  databaseSave: ({ serverId, profile }) => {
    const { password, rememberPassword, ...clean } = profile;
    const value = { ...clean, id: profile.id || crypto.randomUUID(), hasSavedPassword: Boolean(rememberPassword && password) };
    previewServers = previewServers.map(item => item.id === serverId ? { ...item, databases: [...(item.databases || []).filter(row => row.id !== value.id), value] } : item);
    return ok(value);
  },
  databaseRemove: ({ serverId, id }) => { previewServers = previewServers.map(item => item.id === serverId ? { ...item, databases: (item.databases || []).filter(row => row.id !== id) } : item); return ok(true); },
  databaseMonitor: () => ok({ at: Date.now(), type: "mysql", version: "8.0（演示）", latency: 3, connections: 64, maxConnections: 200, active: 12, idle: 52, sessions: [{ ID: 301, USER: "demo_user", HOST: "192.0.2.5", COMMAND: "Query", TIME: 2 }], transactions: [], locks: [], errors: {} }),
  pause: () => { clearInterval(previewTimer); return ok(true); },
  follow: ({ serverId, containerId, streamId }) => {
    clearInterval(previewTimer);
    let index = 0;
    const output = () => {
      index += 1;
      emit({ type: "log", serverId, containerId, streamId, stream: index % 9 === 0 ? "stderr" : "stdout", message: `${new Date().toISOString()} ${index % 9 === 0 ? "WARN Slow request detected" : "INFO Request completed successfully"} [demo-${index}]`, timestamp: Date.now() });
    };
    previewTimer = setInterval(output, 1000);
    output();
    return ok(true);
  },
  chooseKey: () => ok(null),
  export: ({ text, name }) => { const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${name || "remote"}.log`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return ok(true); },
  onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
};

export const remoteApi = isDesktop ? desktop.remote : previewApi;

export async function remoteCall(action, value) {
  if (!remoteApi) throw new Error("请重新打开新版启航以使用远程功能。");
  const result = await remoteApi[action](value);
  if (!result?.ok) throw new Error(result?.error || "远程操作失败。");
  return result.value;
}
