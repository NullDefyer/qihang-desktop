const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, safeStorage, Tray, Menu, globalShortcut, shell, Notification, net } = require("electron");
const { ProcessManager } = require("./process-manager.cjs");
const { JsonStore } = require("./store.cjs");
const { RemoteManager } = require("./remote-manager.cjs");
const { PersonalManager } = require("./personal-manager.cjs");
const { StorageLocations } = require("./storage-locations.cjs");
const { installationStorage } = require("./installation-storage.cjs");
const { translateText } = require("./translation.cjs");
const { CommandManager, validateCommand } = require("./command-manager.cjs");
const { CacheCleaner } = require("./cache-cleaner.cjs");

let mainWindow;
let processManager;
let store;
let remoteManager;
let personalManager;
let storageLocations;
let tray;
let quitting = false;
let quitPending = false;
let registeredShortcut = "";
let reminderTimer;
let commandManager;
let cacheCleaner;

function showWindow(action) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (action) send("personal:event", action);
}

function applyShortcut(value = "Alt+Space") {
  if (value === registeredShortcut) return;
  if (registeredShortcut) globalShortcut.unregister(registeredShortcut);
  const previous = registeredShortcut;
  registeredShortcut = "";
  if (!value) return;
  try {
    if (!globalShortcut.register(value, () => showWindow({ type: "search" }))) throw new Error("快捷键已被占用。");
    registeredShortcut = value;
  } catch {
    if (previous && globalShortcut.register(previous, () => showWindow({ type: "search" }))) registeredShortcut = previous;
    throw new Error("快捷键注册失败，请换一个组合，例如 Ctrl+Alt+Space。");
  }
}

async function requestQuit() {
  if (quitPending || quitting) return;
  quitPending = true;
  try {
    const running = processManager?.processes.size || 0;
    if ((running || commandManager?.running) && store.load()?.preferences?.exitBehavior !== "stop") {
      const result = await dialog.showMessageBox(mainWindow, { type: "question", title: "退出启航", message: `还有 ${running} 个由启航启动的本地服务${commandManager?.running ? "，以及 1 个命令任务" : ""}。`, detail: "确认退出将停止这些服务和命令任务。远程容器不会被停止。", buttons: ["取消", "停止任务并退出"], defaultId: 0, cancelId: 0 });
      if (result.response !== 1) return;
    }
    await processManager?.stopAll();
    await commandManager?.stop();
    remoteManager?.disconnect();
    quitting = true;
    app.quit();
  } catch (error) {
    await dialog.showMessageBox(mainWindow, { type: "error", message: "退出失败", detail: error.message });
  } finally { quitPending = false; }
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1488,
    height: 960,
    minWidth: 900,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: "#08131f",
    title: "启航",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "client", "index.html"));
  }

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    if (tray && store.load()?.preferences?.closeBehavior !== "quit") mainWindow.hide();
    else requestQuit();
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => showWindow());

app.whenReady().then(async () => {
  app.setAppUserModelId("com.qihang.desktop");
  storageLocations = new StorageLocations(app.getPath("userData"), app.isPackaged ? installationStorage(path.dirname(process.execPath)) : {});
  if (storageLocations.needsInitialization) {
    let source;
    if (storageLocations.importCandidates.length) {
      const answer = await dialog.showMessageBox({ type: "question", title: "首次启动启航", message: "发现已有启航数据，是否导入？", detail: "全新开始：本地服务和远程服务器列表均为空，手动添加后才会显示。\n导入已有数据：选择旧数据目录，复制服务、笔记和远程服务器等记录；原文件保留。\n\n如果安装目录中已有记录，全新开始会使用 data 下的新子目录，不覆盖旧文件。", buttons: ["全新开始（空列表）", "导入已有数据", "取消启动"], defaultId: 0, cancelId: 2, noLink: true });
      if (answer.response === 2) { quitting = true; app.quit(); return; }
      if (answer.response === 1) {
        const selected = await dialog.showOpenDialog({ title: "选择旧数据目录（原文件保留）", defaultPath: storageLocations.importCandidates[0].dataDirectory, properties: ["openDirectory"] });
        if (selected.canceled || !selected.filePaths.length) { quitting = true; app.quit(); return; }
        source = selected.filePaths[0];
      }
    }
    storageLocations.initialize(source);
  }
  store = new JsonStore(storageLocations.dataDirectory);
  const { GithubClient, githubRepositoryUrl } = await import("./github.mjs");
  const githubClient = new GithubClient((url, options) => net.fetch(url, options));
  ipcMain.handle("github:search", async (_event, value) => {
    try { return { ok: true, value: await githubClient.search(value) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("github:open", async (_event, fullName) => {
    try { await shell.openExternal(githubRepositoryUrl(fullName)); return { ok: true }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  remoteManager = new RemoteManager({
    secretStorage: safeStorage,
    directory: storageLocations.dataDirectory,
    onEvent: (event) => send("remote:event", event),
    confirmHost: async (server, fingerprint) => {
      const result = await dialog.showMessageBox(mainWindow, {
        type: "question",
        title: "确认 SSH 服务器指纹",
        message: `首次连接 ${server.name}（${server.host}:${server.port}）`,
        detail: `服务器指纹：\n${fingerprint}\n\n请与服务器管理员提供的指纹核对，确认一致后再信任。`,
        buttons: ["取消", "信任并连接"], defaultId: 0, cancelId: 0,
      });
      return result.response === 1;
    },
  });
  const remoteActions = {
    snapshot: () => remoteManager.snapshot(),
    save: (value) => remoteManager.upsert(value),
    remove: (id) => remoteManager.remove(id),
    connect: ({ id, credentials }) => remoteManager.connect(id, credentials),
    disconnect: () => remoteManager.disconnect(),
    containers: (id) => remoteManager.listContainers(id),
    monitor: (id) => remoteManager.monitor(id),
    "monitor-settings": (value) => remoteManager.saveMonitorSettings(value),
    stats: (id) => remoteManager.containerStats(id),
    detail: (value) => remoteManager.containerDetail(value),
    "database-save": (value) => remoteManager.saveDatabase(value),
    "database-remove": (value) => remoteManager.removeDatabase(value),
    "database-monitor": (value) => remoteManager.databaseMonitor(value),
    follow: (options) => remoteManager.followLogs(options),
    pause: () => remoteManager.stopLogs(),
    "choose-key": async () => {
      const result = await dialog.showOpenDialog(mainWindow, { title: "选择 SSH 私钥", properties: ["openFile"] });
      return result.canceled ? null : result.filePaths[0];
    },
    export: async ({ text, name }) => {
      if (typeof text !== "string" || text.length > 80 * 1024 * 1024) throw new Error("导出日志内容无效或过大。");
      const result = await dialog.showSaveDialog(mainWindow, { title: "导出当前日志", defaultPath: `${String(name || "remote").replace(/[^a-zA-Z0-9_-]/g, "_")}.log`, filters: [{ name: "日志文件", extensions: ["log", "txt"] }] });
      if (result.canceled || !result.filePath) return false;
      await require("node:fs/promises").writeFile(result.filePath, text, "utf8");
      return true;
    },
  };
  for (const [action, handler] of Object.entries(remoteActions)) {
    ipcMain.handle(`remote:${action}`, async (_event, value) => {
      try { return { ok: true, value: await handler(value) }; }
      catch (error) { return { ok: false, error: error.message || "远程操作失败。" }; }
    });
  }
  processManager = new ProcessManager({
    onLog: (serviceId, stream, message) => {
      send("service:log", {
        serviceId,
        stream,
        message,
        timestamp: new Date().toISOString(),
      });
    },
    onStatus: (serviceId, status, pid = null) => {
      send("service:status", { serviceId, status, pid, timestamp: Date.now() });
    },
  });

  personalManager = new PersonalManager({
    directory: storageLocations.dataDirectory, backupDirectory: storageLocations.backupDirectory, store, remoteManager, shell, dialog, Notification,
    getWindow: () => mainWindow,
    hasRunningServices: () => processManager.processes.size > 0,
    onEvent: (event) => send("personal:event", event),
  });
  commandManager = new CommandManager();
  cacheCleaner = new CacheCleaner({ protectedPaths: () => [app.getPath("userData"), storageLocations.dataDirectory, storageLocations.backupDirectory, path.dirname(process.execPath)] });
  const personalActions = {
    "command-preview": (value) => validateCommand(value),
    "command-run": (value) => commandManager.run(value),
    "command-status": () => commandManager.snapshot(),
    "command-stop": () => commandManager.stop(),
    "cache-scan": () => cacheCleaner.scan(),
    "cache-clean": async (value) => {
      const scan = cacheCleaner.preview();
      if (!scan || scan.scanId !== value?.scanId || !Array.isArray(value.categories)) throw new Error("请先扫描缓存并选择分类。");
      const selected = scan.categories.filter((item) => value.categories.includes(item.id));
      if (!selected.some((item) => item.count)) throw new Error("所选分类没有可清理文件。");
      const count = selected.reduce((sum, item) => sum + item.count, 0);
      const confirmation = await dialog.showMessageBox(mainWindow, { type: "warning", title: "确认清理缓存", message: `永久删除所选分类的 ${count} 个过期缓存文件？`, detail: `${selected.map((item) => `${item.name}（${item.count} 个）\n${item.roots.join("\n")}`).join("\n\n")}\n\n仅删除本次扫描中至少 7 天未修改且未发生变化的文件；不删除文件夹。占用或不可访问的文件会跳过。此操作不经过回收站。`, buttons: ["取消", "确认清理"], defaultId: 0, cancelId: 0 });
      return confirmation.response === 1 ? cacheCleaner.clean(value) : null;
    },
    translate: (value) => translateText(value, (url, options) => net.fetch(url, options)),
    "export-local-logs": async (text) => {
      if (typeof text !== "string" || !text || Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) throw new Error("请选择不超过 2 MB 的日志内容后导出。");
      const selected = await dialog.showSaveDialog(mainWindow, { title: "导出当前筛选的本地日志", defaultPath: "qihang-local-logs.txt", filters: [{ name: "文本日志", extensions: ["txt", "log"] }] });
      if (selected.canceled || !selected.filePath) return false;
      await require("node:fs/promises").writeFile(selected.filePath, text, "utf8");
      return true;
    },
    "choose-target": (kind) => personalManager.chooseTarget(kind),
    "open-target": (target) => personalManager.openTarget(target),
    export: (state) => personalManager.exportBackup(state),
    import: () => personalManager.importBackup(),
    backup: () => personalManager.writeBackup("manual"),
    "open-data": () => shell.openPath(storageLocations.dataDirectory),
    "open-backups": async () => {
      const directory = storageLocations.backupDirectory;
      await require("node:fs/promises").mkdir(directory, { recursive: true });
      return shell.openPath(directory);
    },
    "change-data-directory": async (state) => {
      // Flush the current renderer snapshot before the native folder dialog opens.
      if (state) store.save(state);
      const result = await dialog.showOpenDialog(mainWindow, { title: "选择数据目录（迁移当前记录，原文件保留）", defaultPath: storageLocations.dataDirectory, properties: ["openDirectory", "createDirectory"] });
      if (result.canceled || !result.filePaths.length) return null;
      return storageLocations.moveData(result.filePaths[0], { store, remoteManager, personalManager });
    },
    "change-backup-directory": async () => {
      const result = await dialog.showOpenDialog(mainWindow, { title: "选择备份目录（旧备份保留在原位置）", defaultPath: storageLocations.backupDirectory, properties: ["openDirectory", "createDirectory"] });
      if (result.canceled || !result.filePaths.length) return null;
      return storageLocations.setBackupDirectory(result.filePaths[0], personalManager);
    },
    status: () => ({ shortcut: registeredShortcut, tray: Boolean(tray), notifications: Notification.isSupported(), ...storageLocations.snapshot() }),
  };
  ipcMain.handle("personal:call", async (_event, { action, value } = {}) => {
    try {
      if (!Object.hasOwn(personalActions, action)) throw new Error("不支持的操作。");
      return { ok: true, value: await personalActions[action](value) };
    } catch (error) { return { ok: false, error: error.message }; }
  });

  ipcMain.handle("dialog:select-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择服务文件夹",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("state:load", () => store.load());
  ipcMain.handle("state:save", (_event, state) => {
    try { applyShortcut(state.preferences?.shortcut); }
    catch (error) { send("personal:event", { type: "warning", message: error.message }); }
    store.save(state);
    if (state.preferences?.autoBackup !== false) personalManager.writeBackup();
    return true;
  });
  ipcMain.handle("service:start", (_event, service) => processManager.start(service));
  ipcMain.handle("service:stop", (_event, serviceId) => processManager.stop(serviceId));
  ipcMain.handle("service:start-all", async (_event, services) => {
    const results = [];
    for (const service of services) {
      if (service?.isExample || !service?.folder?.trim() || !service?.startCommand?.trim()) {
        results.push({ serviceId: service?.id, status: "skipped" });
        continue;
      }
      try {
        results.push({ serviceId: service.id, ...processManager.start(service) });
      } catch (error) {
        send("service:log", {
          serviceId: service.id,
          stream: "stderr",
          message: error.message,
          timestamp: new Date().toISOString(),
        });
        send("service:status", { serviceId: service.id, status: "error", pid: null });
      }
    }
    return results;
  });
  ipcMain.handle("service:stop-all", () => processManager.stopAll());

  ipcMain.on("window:minimize", () => mainWindow.minimize());
  ipcMain.on("window:toggle-maximize", () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window:close", () => mainWindow.close());

  createWindow();
  app.getFileIcon(process.execPath).then((icon) => {
    tray = new Tray(icon);
    tray.setToolTip("启航 · 开发与日常");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "打开启航", click: () => showWindow() },
      { label: "全局搜索", click: () => showWindow({ type: "search" }) },
      { label: "本地服务", click: () => showWindow({ type: "navigate", section: "services" }) },
      { label: "笔记", click: () => showWindow({ type: "navigate", section: "notes" }) },
      { type: "separator" },
      { label: "退出启航", click: requestQuit },
    ]));
    tray.on("double-click", () => showWindow());
  }).catch((error) => console.error("托盘初始化失败", error.message));
  try { applyShortcut(store.load()?.preferences?.shortcut); }
  catch (error) { console.error(error.message); }
  reminderTimer = setInterval(() => {
    try { personalManager.tick(); }
    catch (error) { console.error("提醒检查失败", error.message); }
  }, 10000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  dialog.showErrorBox("启航启动失败", error.message);
  quitting = true;
  app.quit();
});

app.on("before-quit", (event) => {
  if (!quitting && mainWindow && !mainWindow.isDestroyed()) { event.preventDefault(); requestQuit(); }
});

app.on("will-quit", () => {
  clearInterval(reminderTimer);
  globalShortcut.unregisterAll();
  tray?.destroy();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
