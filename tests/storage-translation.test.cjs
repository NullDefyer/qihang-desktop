const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { StorageLocations } = require("../electron/storage-locations.cjs");
const { JsonStore } = require("../electron/store.cjs");
const { translateText } = require("../electron/translation.cjs");

test("fresh installs isolate legacy servers; explicit import and same-install locations persist", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qihang-install-storage-"));
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  try {
    const profile = path.join(root, "profile");
    fs.mkdirSync(profile);
    fs.writeFileSync(path.join(profile, "qihang-state.json"), '{"notes":[{"content":"旧笔记"}]}');
    fs.writeFileSync(path.join(profile, "remote-servers.json"), '[{"host":"test.invalid","encryptedPassword":"preserved"}]');
    fs.mkdirSync(path.join(profile, "backups"));
    fs.writeFileSync(path.join(profile, "backups", "manual-fixture.json"), "legacy-backup");
    const install = path.join(root, "fresh-install");
    const fresh = new StorageLocations(profile, { installationDirectory: install });
    assert.equal(fresh.importCandidates.length, 1);
    assert.ok(!fs.existsSync(path.join(fresh.dataDirectory, "remote-servers.json")));
    fresh.initialize();
    assert.equal(fresh.dataDirectory, fs.realpathSync(path.join(install, "data")));
    assert.equal(fresh.backupDirectory, fs.realpathSync(path.join(install, "backups")));
    assert.ok(!fs.existsSync(path.join(fresh.dataDirectory, "remote-servers.json")));
    assert.ok(fs.existsSync(path.join(profile, "remote-servers.json")));
    assert.equal(new StorageLocations(profile, { installationDirectory: install }).needsInitialization, undefined);
    const otherInstall = path.join(root, "import-install");
    const imported = new StorageLocations(profile, { installationDirectory: otherInstall });
    imported.initialize(profile);
    for (const name of ["qihang-state.json", "remote-servers.json"]) {
      assert.ok(fs.readFileSync(path.join(profile, name)).equals(fs.readFileSync(path.join(imported.dataDirectory, name))));
    }
    assert.equal(fs.readFileSync(path.join(imported.backupDirectory, "manual-fixture.json"), "utf8"), "legacy-backup");
    const customData = path.join(root, "custom-data"); const customBackup = path.join(root, "custom-backup");
    fs.mkdirSync(customData); fs.mkdirSync(customBackup);
    imported.persist(customData, customBackup);
    assert.deepEqual(new StorageLocations(profile, { installationDirectory: otherInstall }).snapshot(), { dataDirectory: fs.realpathSync(customData), backupDirectory: fs.realpathSync(customBackup) });
    // A separate install never follows another installation's custom pointer.
    const separate = new StorageLocations(profile, { installationDirectory: path.join(root, "separate") });
    separate.initialize(); assert.notEqual(separate.dataDirectory, customData);
    fs.rmdirSync(customData);
    assert.throws(() => new StorageLocations(profile, { installationDirectory: otherInstall }), /自定义数据目录不存在/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("explicit clean start preserves occupied default records and remembers the new child", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qihang-clean-install-"));
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  try {
    const install = path.join(root, "install");
    const data = path.join(install, "data"); fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, "remote-servers.json"), "old-servers");
    const locations = new StorageLocations(path.join(root, "profile"), { installationDirectory: install });
    assert.equal(locations.importCandidates.length, 1);
    locations.initialize();
    assert.notEqual(locations.dataDirectory, data);
    assert.equal(fs.readFileSync(path.join(data, "remote-servers.json"), "utf8"), "old-servers");
    assert.ok(!fs.existsSync(path.join(locations.dataDirectory, "remote-servers.json")));
    assert.deepEqual(new StorageLocations(path.join(root, "profile"), { installationDirectory: install }).snapshot(), locations.snapshot());
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("custom data migration retains originals, ciphertext, independent backups and restart locations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qihang-storage-"));
  try {
    const locations = new StorageLocations(path.join(root, "default"));
    const store = new JsonStore(locations.dataDirectory);
    store.save({ notes: [{ id: "test", content: "保留记录" }] });
    const original = store.filePath;
    const remoteManager = { filePath: path.join(locations.dataDirectory, "remote-servers.json") };
    fs.writeFileSync(remoteManager.filePath, '[{"encryptedPassword":"encrypted-fixture"}]');
    const personalManager = { directory: locations.dataDirectory, backupDirectory: locations.backupDirectory };
    const originalBackup = locations.backupDirectory;
    const target = path.join(root, "custom-data");
    locations.moveData(target, { store, remoteManager, personalManager });
    assert.ok(fs.existsSync(original));
    assert.equal(store.load().notes[0].content, "保留记录");
    assert.ok(fs.readFileSync(remoteManager.filePath, "utf8").includes("encrypted-fixture"));
    store.save({ notes: [{ id: "new", content: "new record" }] });
    assert.ok(fs.readFileSync(original, "utf8").includes("保留记录"));
    assert.equal(locations.backupDirectory, originalBackup);
    locations.setBackupDirectory(path.join(root, "custom-backups"), personalManager);
    const restarted = new StorageLocations(path.join(root, "default"));
    assert.deepEqual(restarted.snapshot(), locations.snapshot());
    assert.equal(personalManager.backupDirectory, restarted.backupDirectory);
    assert.throws(() => locations.moveData(path.dirname(original), { store, remoteManager, personalManager }), /已有/);
    const savedPersist = locations.persist;
    locations.persist = () => { throw new Error("simulated failure"); };
    const failedTarget = path.join(root, "failed");
    assert.throws(() => locations.moveData(failedTarget, { store, remoteManager, personalManager }), /simulated/);
    assert.equal(fs.readdirSync(failedTarget).length, 0);
    assert.equal(store.load().notes[0].content, "new record");
    locations.persist = savedPersist;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("machine-wide account folders require explicit import of previous defaults", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qihang-account-storage-"));
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  try {
    const profile = path.join(root, "profile"); const install = path.join(root, "install");
    const previous = new StorageLocations(profile, { installationDirectory: install });
    fs.writeFileSync(path.join(previous.dataDirectory, "qihang-state.json"), "account-notes");
    fs.writeFileSync(path.join(previous.backupDirectory, "manual-test.json"), "account-backup");
    const accountDirectory = "S-1-5-21-100-200-300-1001";
    const account = new StorageLocations(profile, { installationDirectory: install, accountDirectory });
    assert.ok(account.needsInitialization);
    assert.ok(!fs.existsSync(path.join(account.dataDirectory, "qihang-state.json")));
    account.initialize(previous.dataDirectory);
    assert.equal(account.dataDirectory, fs.realpathSync(path.join(install, "data", accountDirectory)));
    assert.equal(fs.readFileSync(path.join(account.dataDirectory, "qihang-state.json"), "utf8"), "account-notes");
    assert.ok(fs.existsSync(path.join(previous.dataDirectory, "qihang-state.json")));
    assert.equal(fs.readFileSync(path.join(account.backupDirectory, "manual-test.json"), "utf8"), "account-backup");
    assert.deepEqual(new StorageLocations(profile, { installationDirectory: install, accountDirectory }).snapshot(), account.snapshot());
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("translation validates inputs and handles service responses without persisting text", async () => {
  let requested;
  const fetcher = async (url) => { requested = new URL(url); return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: "Hello" } }) }; };
  assert.equal((await translateText({ text: "你好", direction: "zh-en" }, fetcher)).text, "Hello");
  assert.equal(requested.hostname, "api.mymemory.translated.net");
  assert.equal(requested.searchParams.get("langpair"), "zh-CN|en");
  await assert.rejects(translateText({ text: "中".repeat(200), direction: "zh-en" }, fetcher), /500/);
  await assert.rejects(translateText({ text: "", direction: "zh-en" }, fetcher), /请输入/);
  await assert.rejects(translateText({ text: "hello", direction: "en-zh" }, async () => { throw new Error("network"); }), /超时/);
  await assert.rejects(translateText({ text: "hello", direction: "en-zh" }, async () => ({ ok: true, json: async () => ({ responseStatus: 429, quotaFinished: true }) })), /额度/);
});
