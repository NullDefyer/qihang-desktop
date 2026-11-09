const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { JsonStore } = require("../electron/store.cjs");
const { PersonalManager, validateBackup, nextReminder } = require("../electron/personal-manager.cjs");

test("backups exclude remote passwords and preserve daily/personal data", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qihang-backup-"));
  try {
    const store = new JsonStore(directory);
    store.save({ services: [], notes: [{ id: "note", content: "personal note" }], shortcuts: [{ id: "quick", target: "https://example.com" }], todos: [], snippets: [] });
    const manager = new PersonalManager({ directory, store, remoteManager: { snapshot: () => ({ servers: [{ id: "server", name: "test", host: "localhost", port: 22, username: "deploy", auth: "password", hasSavedPassword: true, fingerprint: "trusted" }] }) } });
    const backup = manager.backupData();
    const restored = validateBackup(backup);
    assert.equal(restored.state.notes[0].content, "personal note");
    assert.equal(restored.state.shortcuts[0].target, "https://example.com");
    assert.equal(backup.servers[0].hasSavedPassword, undefined);
    assert.equal(backup.servers[0].fingerprint, undefined);
    const first = manager.writeBackup();
    assert.equal(first, manager.writeBackup());
    const recovery = manager.writeBackup("before-restore");
    assert.ok(fs.existsSync(recovery));
    assert.throws(() => validateBackup({ kind: "other" }), /备份/);
    assert.throws(() => validateBackup({ ...backup, state: { services: [{}], notes: [] } }), /无效/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("reminders fire once, advance repeats, skip completed tasks and finish countdowns", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qihang-reminder-"));
  const now = new Date("2026-10-30T15:00:00+08:00").getTime();
  const dueAt = new Date(now - 1000).toISOString();
  const notifications = [];
  const events = [];
  class Notification { static isSupported() { return true; } constructor(value) { this.value = value; } show() { notifications.push(this.value); } }
  try {
    const store = new JsonStore(directory);
    store.save({ todos: [{ id: "once", text: "once", dueAt }, { id: "daily", text: "daily", dueAt, repeat: "daily" }, { id: "done", text: "done", dueAt, completed: true }], countdowns: [{ id: "timer", title: "开会", status: "running", deadline: now - 1, remaining: 1 }, { id: "paused", title: "暂停", status: "paused", deadline: null, remaining: 50 }] });
    const manager = new PersonalManager({ directory, store, Notification, onEvent: (event) => events.push(event) });
    manager.tick(now);
    manager.tick(now);
    assert.equal(notifications.length, 3);
    assert.equal(events.length, 1);
    assert.equal(store.load().countdowns[0].status, "finished");
    assert.equal(store.load().countdowns[1].remaining, 50);
    assert.ok(new Date(store.load().todos[1].dueAt).getTime() > now);
    assert.equal(store.load().todoHistory.length, 3, "An early timer preserves legacy completed items before renderer migration");
    assert.equal(events[0].todoHistory.length, 2);
    assert.ok(store.load().todoHistory.filter((item) => item.type === "reminded").every((item) => item.occurredAt === new Date(now).toISOString() && item.notificationShown));
    manager.tick(now + 24 * 60 * 60 * 1000);
    assert.equal(store.load().todoHistory.length, 4, "Each repeat occurrence is archived, one-off reminders are not duplicated");
    assert.equal(new Set(store.load().todoHistory.map((item) => item.id)).size, 4);
    assert.equal(nextReminder(dueAt, "none", now), null);
    assert.equal(nextReminder("bad", "daily", now), null);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("unavailable system notifications record due events honestly without marking tasks completed", () => {
  let state = { todos: [{ id: "one", text: "reminder", dueAt: "2026-11-01T00:00:00Z" }] };
  const manager = new PersonalManager({ store: { load: () => state, save: (value) => { state = value; } }, Notification: { isSupported: () => false }, onEvent() {} });
  manager.tick(Date.parse("2026-11-03T00:00:00Z"));
  assert.equal(state.todoHistory[0].notificationShown, false);
  assert.equal(state.todos[0].completed, undefined);
  assert.equal(state.todos[0].remindedAt, state.todos[0].dueAt);
});

test("shortcut opening uses safe shell APIs, not commands or arbitrary URL schemes", async () => {
  const calls = [];
  const manager = new PersonalManager({ shell: { openExternal: async (url) => calls.push(url), openPath: async (target) => { calls.push(target); return ""; } } });
  await manager.openTarget("https://example.com/path");
  await assert.rejects(manager.openTarget("javascript:alert(1)"), /绝对/);
  await assert.rejects(manager.openTarget("relative.exe & command"), /绝对/);
  assert.equal(calls.length, 1);
});
