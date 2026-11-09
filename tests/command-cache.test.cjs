const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { once, EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { CommandManager, validateCommand } = require("../electron/command-manager.cjs");
const { CacheCleaner, AGE_MS, cacheCategories } = require("../electron/cache-cleaner.cjs");

test("saved commands validate cwd/shell and preserve streaming UTF-8 without unbounded output", () => {
  assert.throws(() => validateCommand({ name: "", command: "echo test" }), /名称/);
  assert.throws(() => validateCommand({ name: "test", command: "", shell: "cmd" }), /内容/);
  assert.throws(() => validateCommand({ name: "test", command: "echo", shell: "bash" }), /请选择/);
  assert.throws(() => validateCommand({ name: "test", command: "echo", shell: "cmd", cwd: "relative" }), /目录/);
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 123;
  let launch;
  const manager = new CommandManager({ spawnProcess: (...args) => { launch = args; return child; } });
  manager.run({ id: "one", name: "中文命令", command: "Write-Output '中文'", shell: "powershell", cwd: os.tmpdir() });
  assert.equal(launch[2].windowsHide, true);
  assert.ok(Buffer.from(launch[1].at(-1), "base64").toString("utf16le").endsWith("Write-Output '中文'"));
  assert.throws(() => manager.run({}), /已有命令/);
  const text = Buffer.from("中文输出"); child.stdout.write(text.subarray(0, 2)); child.stdout.write(text.subarray(2));
  assert.equal(manager.snapshot().output, "中文输出");
  child.stderr.write("x".repeat(600000));
  assert.equal(manager.snapshot().truncated, true);
  assert.ok(manager.snapshot().output.length <= 512 * 1024);
  child.emit("close", 7); assert.equal(manager.running, false); assert.equal(manager.snapshot().status, "error"); assert.equal(manager.snapshot().exitCode, 7);
});

test("real Windows PowerShell/CMD commands report exit code and stop their own process tree", { skip: process.platform !== "win32" }, async () => {
  const manager = new CommandManager();
  for (const [shell, command, expected, code] of [["powershell", "Write-Output '中文测试'; exit 0", "中文测试", 0], ["cmd", "echo cmd-test & exit /b 3", "cmd-test", 3]]) {
    manager.run({ name: "isolated-test", shell, command, cwd: os.tmpdir() });
    await once(manager.child, "close");
    assert.ok(manager.snapshot().output.includes(expected), manager.snapshot().output);
    assert.ok(!manager.snapshot().output.includes("<Objs"), "Output must be readable text, not PowerShell serialization");
    assert.equal(manager.snapshot().exitCode, code);
  }
  manager.run({ name: "stop-test", shell: "powershell", command: "Write-Output 'waiting'; Start-Sleep -Seconds 60", cwd: os.tmpdir() });
  await new Promise((resolve) => setTimeout(resolve, 350));
  await manager.stop();
  assert.equal(manager.snapshot().status, "stopped"); assert.equal(manager.running, false);
});

test("cache cleaner only deletes scanned old regular files and rejects links, changes, protected data and stale tokens", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "qihang-cache-test-"));
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
  try {
    const root = path.join(directory, "cache"); const protectedDir = path.join(root, "keep-app"); const outside = path.join(directory, "documents");
    await fs.mkdir(protectedDir, { recursive: true }); await fs.mkdir(outside);
    for (const [name, text] of [["old.tmp", "delete"], ["changed.tmp", "before"], ["fresh.tmp", "fresh"], ["hard.tmp", "hard"]]) await fs.writeFile(path.join(root, name), text);
    await fs.writeFile(path.join(protectedDir, "notes.json"), "protected");
    await fs.writeFile(path.join(outside, "personal.txt"), "outside");
    await fs.symlink(outside, path.join(root, "linked-documents"), "junction");
    await fs.link(path.join(root, "hard.tmp"), path.join(outside, "hard-link"));
    // Move the test clock forward so freshly created fixture ctimes can be old;
    // fresh.tmp receives a future mtime and must still be excluded.
    let now = Date.now() + AGE_MS + 60000;
    await fs.utimes(path.join(root, "fresh.tmp"), new Date(now), new Date(now));
    const cleaner = new CacheCleaner({ categories: [{ id: "temp", name: "test", roots: [root] }], protectedPaths: () => [protectedDir], now: () => now });
    const scan = await cleaner.scan();
    assert.equal(scan.categories[0].count, 2);
    assert.equal(scan.categories[0].files, undefined);
    assert.ok(scan.categories[0].samples.every((file) => file.path.startsWith(root + path.sep)));
    await assert.rejects(cleaner.clean({ scanId: "forged", categories: ["temp"] }), /失效/);
    await assert.rejects(cleaner.clean({ scanId: scan.scanId, categories: ["documents"] }), /有效/);
    await fs.writeFile(path.join(root, "changed.tmp"), "changed after scan");
    const result = await cleaner.clean({ scanId: scan.scanId, categories: ["temp"] });
    assert.deepEqual(result, { deleted: 1, bytes: 6, skipped: 1 });
    await assert.rejects(fs.access(path.join(root, "old.tmp")));
    assert.equal(await fs.readFile(path.join(outside, "personal.txt"), "utf8"), "outside");
    assert.equal(await fs.readFile(path.join(protectedDir, "notes.json"), "utf8"), "protected");
    assert.equal(await fs.readFile(path.join(root, "fresh.tmp"), "utf8"), "fresh");
    assert.equal(await fs.readFile(path.join(root, "hard.tmp"), "utf8"), "hard");
    const next = await cleaner.scan(); now += 31 * 60000;
    await assert.rejects(cleaner.clean({ scanId: next.scanId, categories: ["temp"] }), /失效/);
    assert.ok(cacheCategories().every((item) => (item.roots || []).every((folder) => folder.toLowerCase().startsWith("c:\\")) && (!item.profileRoot || item.profileRoot.toLowerCase().startsWith("c:\\"))));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("cache revalidation skips an ancestor replaced with a directory junction", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "qihang-cache-link-test-"));
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
  try {
    const root = path.join(directory, "cache"); const child = path.join(root, "child"); const outside = path.join(directory, "outside");
    await fs.mkdir(child, { recursive: true }); await fs.mkdir(outside); await fs.writeFile(path.join(child, "old.tmp"), "original"); await fs.writeFile(path.join(outside, "old.tmp"), "personal");
    const cleaner = new CacheCleaner({ categories: [{ id: "temp", name: "test", roots: [root] }], now: () => Date.now() + AGE_MS + 60000 });
    const scan = await cleaner.scan();
    await fs.rename(child, path.join(root, "moved")); await fs.symlink(outside, child, "junction");
    const result = await cleaner.clean({ scanId: scan.scanId, categories: ["temp"] });
    assert.equal(result.deleted, 0); assert.equal(result.skipped, 1); assert.equal(await fs.readFile(path.join(outside, "old.tmp"), "utf8"), "personal");
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
