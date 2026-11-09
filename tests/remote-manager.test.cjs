const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { Server, utils } = require("ssh2");
const { RemoteManager, normalizeServer } = require("../electron/remote-manager.cjs");

// Exercise the encryption boundary without depending on Electron in Node unit tests.
function testSecretStorage() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString(value) {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
}

test("remembering passwords is opt-in, encrypted, hidden from snapshots, preserved and removable", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qihang-credentials-"));
  try {
    const secretStorage = testSecretStorage();
    const manager = new RemoteManager({ directory, secretStorage, onEvent() {} });
    const profile = { name: "test", host: "localhost", username: "deploy", password: "test-secret", rememberPassword: true };
    let server = manager.upsert(profile);
    assert.equal(server.hasSavedPassword, true);
    assert.equal("encryptedPassword" in server, false);
    assert.equal(JSON.stringify(manager.snapshot()).includes("test-secret"), false);
    assert.equal(JSON.stringify(manager.snapshot()).includes(manager.servers[0].encryptedPassword), false);
    assert.equal(fs.readFileSync(manager.filePath, "utf8").includes("test-secret"), false);
    assert.equal(new RemoteManager({ directory, secretStorage }).decryptPassword(manager.servers[0]), "test-secret");
    server = manager.upsert({ ...server, rememberPassword: true, password: "", name: "renamed" });
    assert.equal(server.hasSavedPassword, true);
    assert.throws(() => manager.upsert({ ...server, username: "other-user", rememberPassword: true }), /重新输入/);
    server = manager.upsert({ ...server, rememberPassword: false });
    assert.equal(server.hasSavedPassword, false);
    assert.equal(manager.servers[0].encryptedPassword, undefined);
    assert.throws(() => new RemoteManager({ directory, onEvent() {} }).upsert(profile), /加密不可用/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("server validation and persistence exclude credentials", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qihang-remote-"));
  try {
    const manager = new RemoteManager({ directory, onEvent() {}, confirmHost: async () => true });
    assert.throws(() => normalizeServer({ name: "test", host: "localhost", username: "user", port: 99999 }), /端口/);
    assert.throws(() => normalizeServer({ name: "test", host: "localhost", username: "user", auth: "key" }), /私钥/);
    const server = manager.upsert({ name: "test", host: "localhost", username: "user", password: "never-save", passphrase: "never-save" });
    assert.equal(server.port, 22);
    assert.equal(fs.readFileSync(manager.filePath, "utf8").includes("never-save"), false);
    assert.equal(new RemoteManager({ directory }).snapshot().servers.length, 1);
    manager.remove(server.id);
    assert.equal(manager.snapshot().servers.length, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("SSH integration verifies host, authenticates, lists containers, streams UTF-8, pauses and rejects shell injection", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qihang-ssh-"));
  const hostKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" });
  const userKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" });
  const allowedKey = utils.parseKey(userKey);
  const containerId = "a".repeat(64);
  const clients = new Set();
  const commands = [];
  let trustChecks = 0;
  const ssh = new Server({ hostKeys: [hostKey] }, (client) => {
    clients.add(client);
    client.on("error", () => {});
    client.on("close", () => clients.delete(client));
    client.on("authentication", (context) => {
      if (context.method === "password" && context.username === "deploy" && context.password === "test-password") context.accept();
      else if (context.method === "publickey" && context.username === "deploy" && context.key.data.equals(allowedKey.getPublicSSH()) && (!context.signature || allowedKey.verify(context.blob, context.signature, context.hashAlgo) === true)) context.accept();
      else context.reject();
    });
    client.on("ready", () => client.on("session", (accept) => {
      accept().on("exec", (accept, reject, info) => {
        commands.push(info.command);
        const channel = accept();
        if (info.command.includes("docker ps")) {
          channel.write(JSON.stringify({ ID: containerId, Names: "nacos", Image: "nacos:latest", State: "running", Status: "Up 1 hour", Ports: "8848/tcp" }) + "\n");
          channel.exit(0); channel.end();
        } else {
          const bytes = Buffer.from("启动成功\n");
          channel.write(bytes.subarray(0, 2));
          channel.write(bytes.subarray(2));
          channel.stderr.write("warning output\n");
          channel.on("close", () => {});
        }
      });
    }));
  });
  const events = [];
  const manager = new RemoteManager({ directory, secretStorage: testSecretStorage(), onEvent: (event) => events.push(event), confirmHost: async (_server, fingerprint) => { trustChecks += 1; assert.match(fingerprint, /^SHA256:/); return true; } });
  t.after(async () => { manager.disconnect(); clients.forEach((client) => client.end()); await new Promise((resolve) => ssh.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  ssh.listen(0, "127.0.0.1");
  await once(ssh, "listening");
  const server = manager.upsert({ name: "Local SSH fixture", host: "127.0.0.1", port: ssh.address().port, username: "deploy" });
  await manager.connect(server.id, { password: "test-password" });
  assert.equal(trustChecks, 1);
  assert.equal(manager.snapshot().connection.status, "connected");
  assert.match(manager.servers[0].fingerprint, /^SHA256:/);
  assert.equal(fs.readFileSync(manager.filePath, "utf8").includes("test-password"), false);
  const containers = await manager.listContainers(server.id);
  assert.equal(containers[0].name, "nacos");
  await assert.rejects(manager.followLogs({ serverId: server.id, containerId: "bad; touch /tmp/file", tail: 100, streamId: "bad" }), /无效/);
  await manager.followLogs({ serverId: server.id, containerId, tail: 100, streamId: "test-stream" });
  for (let tries = 0; tries < 50 && events.filter((event) => event.type === "log").length < 2; tries += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  const logs = events.filter((event) => event.type === "log");
  assert.ok(logs.some((event) => event.message === "启动成功" && event.stream === "stdout"));
  assert.ok(logs.some((event) => event.message === "warning output" && event.stream === "stderr"));
  assert.ok(commands.every((command) => !command.includes("touch")));
  await manager.stopLogs();
  assert.equal(manager.session.stream, null);
  manager.disconnect();
  await manager.connect(server.id, { password: "test-password" });
  assert.equal(trustChecks, 1, "known host must not prompt again");
  manager.disconnect();
  await assert.rejects(manager.connect(server.id, { password: "incorrect" }), /认证/);
  await manager.connect(server.id, { password: "test-password", rememberPassword: true });
  assert.equal(manager.snapshot().servers[0].hasSavedPassword, true);
  manager.disconnect();
  await manager.connect(server.id, { rememberPassword: true });
  manager.disconnect();
  await assert.rejects(manager.connect(server.id, { password: "incorrect", rememberPassword: true }), /认证/);
  assert.equal(manager.decryptPassword(manager.servers[0]), "test-password", "failed authentication must not overwrite a working saved password");
  await manager.connect(server.id, { rememberPassword: false });
  assert.equal(manager.snapshot().servers[0].hasSavedPassword, false);
  manager.disconnect();
  const privateKeyPath = path.join(directory, "test-key.pem");
  fs.writeFileSync(privateKeyPath, userKey);
  const keyServer = manager.upsert({ ...manager.servers[0], auth: "key", privateKeyPath });
  await manager.connect(keyServer.id);
  assert.equal(manager.session.status, "connected", "private-key authentication must succeed");
  manager.disconnect();
  manager.servers[0].fingerprint = "SHA256:wrong";
  await assert.rejects(manager.connect(server.id), /指纹/);
  assert.equal(manager.session, null);
});

test("container switching waits for channel close and cancels superseded subscriptions", async () => {
  const { EventEmitter } = require("node:events");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qihang-channel-"));
  let activeChannels = 0;
  let peakChannels = 0;
  const signals = [];
  const client = {
    exec(_command, callback) {
      if (activeChannels) { callback(new Error("(SSH) Channel open failure: open failed")); return; }
      activeChannels += 1;
      peakChannels = Math.max(peakChannels, activeChannels);
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      stream.signal = (signal) => signals.push(signal);
      stream.end = () => {};
      stream.close = () => setTimeout(() => { activeChannels -= 1; stream.emit("close", 0); }, 25);
      setTimeout(() => callback(null, stream), 10);
    },
    end() {},
  };
  const manager = new RemoteManager({ directory, onEvent() {} });
  manager.session = { client, server: { id: "fixture" }, status: "connected" };
  const follow = (streamId) => manager.followLogs({ serverId: "fixture", containerId: "a".repeat(64), tail: 100, streamId });
  try {
    await follow("first");
    const switches = await Promise.allSettled([follow("second"), follow("third"), follow("last")]);
    assert.equal(switches[2].status, "fulfilled");
    assert.equal(manager.session.streamId, "last");
    assert.equal(peakChannels, 1, "a MaxSessions=1 server must never receive overlapping log channels");
    assert.ok(switches.slice(0, 2).every((item) => item.status === "rejected" && /取消/.test(item.reason.message)));
    const pending = follow("cancel-before-open-reply");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const paused = manager.stopLogs();
    await assert.rejects(pending, /取消/);
    await paused;
    assert.equal(activeChannels, 0, "pause must also clean up a pending open request");
    await follow("restart");
    await manager.stopLogs();
    assert.equal(activeChannels, 0);
    assert.ok(signals.every((signal) => signal === "TERM"));
  } finally { manager.disconnect(); fs.rmSync(directory, { recursive: true, force: true }); }
});
