const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const { ProcessManager } = require("../electron/process-manager.cjs");

function createFakeChild() {
  const child = new EventEmitter();
  child.pid = 3210;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  return child;
}

test("start validates required service configuration", () => {
  const manager = new ProcessManager({ onLog() {}, onStatus() {} });
  assert.throws(() => manager.start({ id: "redis", folder: "", startCommand: "" }), /不能为空/);
  assert.throws(() => manager.start({ id: "example", isExample: true, folder: "C:/fixture", startCommand: "must-not-run" }), /示例服务/);
  assert.equal(manager.processes.size, 0);
});

test("start streams output and reports running status", async () => {
  const child = createFakeChild();
  const logs = [];
  const statuses = [];
  const manager = new ProcessManager({
    spawnProcess: () => child,
    onLog: (...entry) => logs.push(entry),
    onStatus: (...entry) => statuses.push(entry),
  });

  manager.start({
    id: "redis",
    name: "Redis",
    folder: "D:\\dev\\redis",
    startCommand: "redis-server.exe",
  });
  child.emit("spawn");
  child.stdout.write("Ready to accept connections\n");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(statuses.at(-1)[1], "running");
  assert.equal(statuses.at(-1)[2], 3210);
  assert.ok(logs.some((entry) => entry[2] === "Ready to accept connections"));
});

test("stop terminates the Windows process tree", async () => {
  const child = createFakeChild();
  let taskkillArgs;
  const manager = new ProcessManager({
    spawnProcess: () => child,
    executeFile: (_file, args, callback) => {
      taskkillArgs = args;
      callback(null);
    },
    onLog() {},
    onStatus() {},
  });

  manager.start({
    id: "redis",
    name: "Redis",
    folder: "D:\\dev\\redis",
    startCommand: "redis-server.exe",
  });
  await manager.stop("redis");

  if (process.platform === "win32") {
    assert.deepEqual(taskkillArgs, ["/pid", "3210", "/T", "/F"]);
  }
  assert.equal(manager.processes.has("redis"), false);
});
