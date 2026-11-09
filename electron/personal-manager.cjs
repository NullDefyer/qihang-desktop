const fs = require("node:fs");
const path = require("node:path");
const { normalizeServer } = require("./remote-manager.cjs");

function validateBackup(value) {
  if (value?.kind !== "qihang-backup" || value.version !== 1 || !value.state || !Array.isArray(value.state.services) || !Array.isArray(value.state.notes) || !Array.isArray(value.servers)) throw new Error("这不是受支持的启航备份文件。");
  if (value.state.services.some((item) => !item?.id || typeof item.name !== "string") || value.state.notes.some((item) => !item?.id || typeof item.content !== "string")) throw new Error("备份中的服务或笔记数据无效。");
  return { state: value.state, servers: value.servers.map((server) => normalizeServer(server, server.id)) };
}

function nextReminder(dueAt, repeat, now) {
  const date = new Date(dueAt);
  if (!Number.isFinite(date.getTime()) || !["daily", "weekly"].includes(repeat)) return null;
  const days = repeat === "weekly" ? 7 : 1;
  while (date.getTime() <= now) date.setDate(date.getDate() + days);
  return date.toISOString();
}

class PersonalManager {
  constructor({ directory, backupDirectory, store, remoteManager, shell, dialog, Notification, getWindow, hasRunningServices, onEvent }) {
    Object.assign(this, { directory, backupDirectory, store, remoteManager, shell, dialog, Notification, getWindow, hasRunningServices, onEvent });
  }

  backupData(state = this.store.load()) {
    return {
      kind: "qihang-backup", version: 1, createdAt: new Date().toISOString(), state,
      servers: this.remoteManager.snapshot().servers.map(({ hasSavedPassword, fingerprint, ...server }) => ({ ...server, databases: (server.databases || []).map(({ hasSavedPassword: _saved, ...profile }) => profile) })),
    };
  }

  writeBackup(prefix = "daily") {
    const directory = this.backupDirectory || path.join(this.directory, "backups");
    fs.mkdirSync(directory, { recursive: true });
    const stamp = prefix === "daily" ? new Date().toLocaleDateString("sv-SE") : new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(directory, `${prefix}-${stamp}.json`);
    if (prefix === "daily" && fs.existsSync(filePath)) return filePath;
    const data = this.backupData();
    if (!data.state) return null;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    // Only prune this manager's daily snapshots, not user-exported or recovery files.
    const daily = fs.readdirSync(directory).filter((name) => /^daily-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().reverse();
    for (const name of daily.slice(14)) fs.unlinkSync(path.join(directory, name));
    return filePath;
  }

  async exportBackup(state) {
    const data = this.backupData(state);
    validateBackup(data);
    const backupDirectory = this.backupDirectory || path.join(this.directory, "backups");
    fs.mkdirSync(backupDirectory, { recursive: true });
    const result = await this.dialog.showSaveDialog(this.getWindow(), { title: "导出启航配置", defaultPath: path.join(backupDirectory, "启航备份.json"), filters: [{ name: "启航备份", extensions: ["json"] }] });
    if (result.canceled || !result.filePath) return false;
    await fs.promises.writeFile(result.filePath, JSON.stringify(data, null, 2), "utf8");
    return true;
  }

  async importBackup() {
    if (this.hasRunningServices()) throw new Error("请先停止启航启动的本地服务，再恢复配置。");
    const result = await this.dialog.showOpenDialog(this.getWindow(), { title: "恢复启航配置", properties: ["openFile"], filters: [{ name: "启航备份", extensions: ["json"] }] });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    if ((await fs.promises.stat(filePath)).size > 20 * 1024 * 1024) throw new Error("备份文件超过 20 MB。");
    const data = validateBackup(JSON.parse(await fs.promises.readFile(filePath, "utf8")));
    const confirmed = await this.dialog.showMessageBox(this.getWindow(), { type: "question", title: "确认恢复配置", message: "恢复将替换服务、笔记、日常数据和远程连接配置。", detail: "恢复前会自动备份当前数据。远程密码和私钥口令不会从备份恢复。", buttons: ["取消", "恢复"], defaultId: 0, cancelId: 0 });
    if (confirmed.response !== 1) return null;
    if (this.hasRunningServices()) throw new Error("检测到正在运行的服务，恢复已取消。");
    const recoveryPath = this.writeBackup("before-restore");
    const previousState = this.store.load();
    const previousServers = this.remoteManager.servers;
    this.remoteManager.disconnect();
    try {
      this.remoteManager.servers = data.servers;
      this.remoteManager.save();
      this.store.save(data.state);
    } catch (error) {
      this.remoteManager.servers = previousServers;
      try { this.remoteManager.save(); this.store.save(previousState); }
      catch { throw new Error(`恢复失败，回滚未完成，请使用恢复前备份：${recoveryPath}`); }
      throw error;
    }
    return data.state;
  }

  async chooseTarget(kind) {
    const result = await this.dialog.showOpenDialog(this.getWindow(), { title: kind === "folder" ? "选择文件夹" : "选择程序或文件", properties: [kind === "folder" ? "openDirectory" : "openFile"] });
    return result.canceled ? null : result.filePaths[0];
  }

  async openTarget(target) {
    if (typeof target !== "string" || !target.trim()) throw new Error("打开目标不能为空。");
    if (/^https?:\/\//i.test(target)) { await this.shell.openExternal(new URL(target).href); return true; }
    if (!path.isAbsolute(target)) throw new Error("请选择绝对文件路径，或填写 http/https 网址。");
    const error = await this.shell.openPath(target);
    if (error) throw new Error(error);
    return true;
  }

  tick(now = Date.now()) {
    const state = this.store.load();
    if (!state) return;
    const canNotify = this.Notification.isSupported();
    const patches = [];
    const history = [];
    const todos = (state.todos || []).map((todo) => {
      const due = new Date(todo.dueAt).getTime();
      if (todo.completed || !todo.dueAt || !Number.isFinite(due) || due > now || todo.remindedAt === todo.dueAt) return todo;
      const nextDueAt = nextReminder(todo.dueAt, todo.repeat, now);
      if (canNotify) new this.Notification({ title: "启航 · 待办提醒", body: todo.text, silent: false }).show();
      history.push({ id: `reminded-${todo.id}-${todo.dueAt}`, todoId: todo.id, type: "reminded", text: todo.text, occurredAt: new Date(now).toISOString(), scheduledAt: todo.dueAt, notificationShown: canNotify, todo: { ...todo } });
      const patch = { id: todo.id, previousDueAt: todo.dueAt, dueAt: nextDueAt || todo.dueAt, remindedAt: nextDueAt ? null : todo.dueAt };
      patches.push(patch);
      return { ...todo, dueAt: patch.dueAt, remindedAt: patch.remindedAt };
    });
    const countdownPatches = [];
    const countdowns = (state.countdowns || []).map((item) => {
      if (item.status !== "running" || !Number.isFinite(item.deadline) || item.deadline > now || item.notifiedAt) return item;
      if (canNotify) new this.Notification({ title: "启航 · 倒计时到时", body: item.title }).show();
      const patch = { id: item.id, deadline: item.deadline, status: "finished", remaining: 0, notifiedAt: now };
      countdownPatches.push(patch);
      return { ...item, ...patch };
    });
    if (patches.length || countdownPatches.length) {
      // A timer can fire before the renderer has saved its first migration.
      // Preserve legacy completions/reminders instead of masking them with a
      // newly-created history array. IDs match the renderer's one-time migration.
      const previousHistory = Array.isArray(state.todoHistory) ? state.todoHistory : (state.todos || []).flatMap((todo) => [
        ...(todo.completed ? [{ id: `legacy-completed-${todo.id}`, type: "completed", todoId: todo.id, text: todo.text, occurredAt: todo.completedAt || null, todo: { ...todo } }] : []),
        ...(todo.remindedAt ? [{ id: `legacy-reminded-${todo.id}-${todo.remindedAt}`, type: "reminded", todoId: todo.id, text: todo.text, occurredAt: null, scheduledAt: todo.remindedAt, todo: { ...todo } }] : []),
      ]);
      this.store.save({ ...state, todos, todoHistory: [...history, ...previousHistory], countdowns });
      this.onEvent({ type: "reminders", todos: patches, todoHistory: history, countdowns: countdownPatches });
    }
  }
}

module.exports = { PersonalManager, validateBackup, nextReminder };
