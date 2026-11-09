import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(new URL("../scripts/check-public-source.mjs", import.meta.url));

function fixture(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), "qihang-public-source-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const check = () => spawnSync(process.execPath, ["scripts/check-public-source.mjs"], { cwd: root, encoding: "utf8" });
  try {
    mkdirSync(path.join(root, "scripts"));
    copyFileSync(checker, path.join(root, "scripts/check-public-source.mjs"));
    writeFileSync(path.join(root, "README.md"), "Public source fixture\n");
    git("init", "-b", "main");
    git("add", "scripts", "README.md");
    run({ root, git, check });
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  }
}

test("public source checker permits clean source and neutral hosting metadata", () => fixture(({ root, git, check }) => {
  mkdirSync(path.join(root, ".openai"));
  writeFileSync(path.join(root, ".openai/hosting.json"), '{"d1":null,"r2":null}');
  git("add", ".openai/hosting.json");
  const result = check();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /公开源码检查通过/);
}));

test("public source checker rejects runtime data even if it was explicitly staged", () => fixture(({ root, git, check }) => {
  mkdirSync(path.join(root, "data"));
  writeFileSync(path.join(root, "data/qihang-state.json"), '{"notes":[]}');
  git("add", "data/qihang-state.json");
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /不应公开/);
}));

test("public source checker scans staged blobs and never echoes synthetic credentials", () => fixture(({ root, git, check }) => {
  // Deliberately synthetic, never issued by a service; constructed at runtime
  // so the project's own public scan does not contain a token-shaped literal.
  const synthetic = "ghp_" + "f".repeat(36);
  writeFileSync(path.join(root, "example.js"), `export const token = '${synthetic}';`);
  git("add", "example.js");
  writeFileSync(path.join(root, "example.js"), "export const token = '';\n");
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GitHub 令牌/);
  assert.ok(!result.stderr.includes(synthetic));
  assert.ok(!result.stdout.includes(synthetic));
}));
