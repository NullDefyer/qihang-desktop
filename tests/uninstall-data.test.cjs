const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { installationStorage } = require("../electron/installation-storage.cjs");

test("machine-wide storage secures only the current account folders, with no shared modify rule", { skip: process.platform !== "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qihang-private-storage-"));
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  try {
    fs.mkdirSync(path.join(root, "data")); fs.mkdirSync(path.join(root, "backups"));
    fs.writeFileSync(path.join(root, ".qihang-all-users"), "account-storage-v1");
    const options = installationStorage(root);
    assert.match(options.accountDirectory, /^S-1-5-/);
    const target = path.join(root, "data", options.accountDirectory).replaceAll("'", "''");
    const script = `$a=[System.IO.Directory]::GetAccessControl('${target}');[pscustomobject]@{Protected=$a.AreAccessRulesProtected;Sids=@($a.Access | ForEach-Object {$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value})}|ConvertTo-Json -Compress`;
    const result = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, encoding: "utf8" }));
    assert.equal(result.Protected, true);
    assert.deepEqual(new Set(result.Sids), new Set([options.accountDirectory, "S-1-5-18", "S-1-5-32-544"]));
    assert.deepEqual(installationStorage(root), options);
    const file = path.join(root, "data", options.accountDirectory, "write-check.txt");
    fs.writeFileSync(file, "private"); assert.equal(fs.readFileSync(file, "utf8"), "private");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("uninstall describe retains data; explicit delete removes only app records and verified backups in default/custom locations", { skip: process.platform !== "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qihang-uninstall-data-"));
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  try {
    const install = path.join(root, "自定义安装目录"); const profile = path.join(root, "profile");
    const custom = path.join(root, "custom-data"); const backups = path.join(root, "custom-backups");
    for (const directory of [path.join(install, "data"), path.join(install, "backups"), profile, custom, backups]) fs.mkdirSync(directory, { recursive: true });
    const state = path.join(install, "data", "qihang-state.json");
    const original = path.join(profile, "qihang-state.json");
    const remote = path.join(custom, "remote-servers.json");
    fs.writeFileSync(state, "test-state"); fs.writeFileSync(original, "old-state"); fs.writeFileSync(remote, "encrypted-test");
    fs.writeFileSync(path.join(custom, "personal.txt"), "keep me");
    fs.writeFileSync(path.join(backups, "other.json"), '{"kind":"personal"}');
    const backup = path.join(backups, "manual-test.json");
    fs.writeFileSync(backup, JSON.stringify({ kind: "qihang-backup", version: 1, state: { notes: [] } }));
    const pointer = path.join(install, "data", "storage-locations.json");
    fs.writeFileSync(pointer, JSON.stringify({ dataDirectory: custom, backupDirectory: backups }));
    const accountName = "S-1-5-21-1-2-3-1001";
    const accountData = path.join(install, "data", accountName);
    const accountBackups = path.join(install, "backups", accountName);
    fs.mkdirSync(accountData); fs.mkdirSync(accountBackups);
    fs.writeFileSync(path.join(accountData, "qihang-state.json"), "account-record");
    fs.writeFileSync(path.join(accountBackups, "manual-account.json"), JSON.stringify({ kind: "qihang-backup", version: 1 }));
    const run = (action) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.resolve("build/uninstall-user-data.ps1"), "-Action", action, "-InstallDirectory", install, "-ProfileDirectory", profile], { windowsHide: true, encoding: "utf8" });
    run("Describe");
    assert.ok([state, original, remote, backup, pointer].every((file) => fs.existsSync(file)));
    run("Delete");
    assert.ok([state, remote, backup, pointer].every((file) => !fs.existsSync(file)));
    assert.ok(fs.existsSync(original));
    assert.equal(fs.readFileSync(path.join(custom, "personal.txt"), "utf8"), "keep me");
    assert.ok(fs.existsSync(path.join(backups, "other.json")));
    assert.ok(!fs.existsSync(path.join(install, "data")));
    assert.ok(!fs.existsSync(path.join(install, "backups")));
    run("Delete"); // Repeated uninstall cleanup is harmless.
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("uninstall of an isolated new installation never deletes unrelated legacy profile data", { skip: process.platform !== "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qihang-uninstall-isolated-"));
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  try {
    const install = path.join(root, "install"); const profile = path.join(root, "old-profile");
    const active = path.join(install, "data", "fresh-fixture"); const customBackups = path.join(root, "new-backups");
    const oldCustom = path.join(root, "old-custom");
    for (const dir of [active, profile, oldCustom, customBackups]) fs.mkdirSync(dir, { recursive: true });
    const oldFiles = [path.join(profile, "qihang-state.json"), path.join(oldCustom, "remote-servers.json")];
    oldFiles.forEach(file => fs.writeFileSync(file, "keep-old-data"));
    const oldPointer = path.join(profile, "storage-locations.json");
    fs.writeFileSync(oldPointer, JSON.stringify({ dataDirectory: oldCustom }));
    const pointer = path.join(install, "data", "storage-locations.json");
    fs.writeFileSync(pointer, JSON.stringify({ dataDirectory: active, backupDirectory: customBackups }));
    const current = path.join(active, "qihang-state.json"); fs.writeFileSync(current, "new-state");
    const backup = path.join(customBackups, "manual-fixture.json");
    fs.writeFileSync(backup, JSON.stringify({ kind: "qihang-backup", version: 1 }));
    const run = action => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.resolve("build/uninstall-user-data.ps1"), "-Action", action, "-InstallDirectory", install, "-ProfileDirectory", profile], { windowsHide: true, encoding: "utf8" });
    const description = run("Describe");
    assert.ok(!description.includes(oldCustom));
    run("Delete");
    assert.ok(!fs.existsSync(current) && !fs.existsSync(backup) && !fs.existsSync(pointer));
    assert.ok([...oldFiles, oldPointer].every(file => fs.existsSync(file)));
    run("Delete");
    assert.ok([...oldFiles, oldPointer].every(file => fs.existsSync(file)), "Repeated cleanup cannot fall back to another installation's profile");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
