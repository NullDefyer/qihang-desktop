const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("qihang", {
  github: {
    search: (filters) => ipcRenderer.invoke("github:search", filters),
    open: (fullName) => ipcRenderer.invoke("github:open", fullName),
  },
  personal: {
    call: (action, value) => ipcRenderer.invoke("personal:call", { action, value }),
    onEvent: (listener) => {
      const handler = (_event, value) => listener(value);
      ipcRenderer.on("personal:event", handler);
      return () => ipcRenderer.removeListener("personal:event", handler);
    },
  },
  remote: {
    snapshot: () => ipcRenderer.invoke("remote:snapshot"),
    save: (value) => ipcRenderer.invoke("remote:save", value),
    remove: (id) => ipcRenderer.invoke("remote:remove", id),
    connect: (value) => ipcRenderer.invoke("remote:connect", value),
    disconnect: () => ipcRenderer.invoke("remote:disconnect"),
    containers: (id) => ipcRenderer.invoke("remote:containers", id),
    monitor: (id) => ipcRenderer.invoke("remote:monitor", id),
    monitorSettings: (value) => ipcRenderer.invoke("remote:monitor-settings", value),
    stats: (id) => ipcRenderer.invoke("remote:stats", id),
    detail: (value) => ipcRenderer.invoke("remote:detail", value),
    databaseSave: (value) => ipcRenderer.invoke("remote:database-save", value),
    databaseRemove: (value) => ipcRenderer.invoke("remote:database-remove", value),
    databaseMonitor: (value) => ipcRenderer.invoke("remote:database-monitor", value),
    follow: (value) => ipcRenderer.invoke("remote:follow", value),
    pause: () => ipcRenderer.invoke("remote:pause"),
    chooseKey: () => ipcRenderer.invoke("remote:choose-key"),
    export: (value) => ipcRenderer.invoke("remote:export", value),
    onEvent: (listener) => {
      const handler = (_event, value) => listener(value);
      ipcRenderer.on("remote:event", handler);
      return () => ipcRenderer.removeListener("remote:event", handler);
    },
  },
  isDesktop: true,
  selectFolder: () => ipcRenderer.invoke("dialog:select-folder"),
  loadState: () => ipcRenderer.invoke("state:load"),
  saveState: (state) => ipcRenderer.invoke("state:save", state),
  startService: (service) => ipcRenderer.invoke("service:start", service),
  stopService: (serviceId) => ipcRenderer.invoke("service:stop", serviceId),
  startAll: (services) => ipcRenderer.invoke("service:start-all", services),
  stopAll: () => ipcRenderer.invoke("service:stop-all"),
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
  onLog: (listener) => {
    const handler = (_event, entry) => listener(entry);
    ipcRenderer.on("service:log", handler);
    return () => ipcRenderer.removeListener("service:log", handler);
  },
  onStatus: (listener) => {
    const handler = (_event, entry) => listener(entry);
    ipcRenderer.on("service:status", handler);
    return () => ipcRenderer.removeListener("service:status", handler);
  },
});
