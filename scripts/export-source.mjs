#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: "inherit" });

try {
  run(process.execPath, ["scripts/check-public-source.mjs", "--ref=HEAD"]);
  const manifest = JSON.parse(execFileSync("git", ["show", "HEAD:package.json"], { cwd: root, encoding: "utf8" }));
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version)) throw new Error("提交中的版本号无效。");
  const directory = path.join(root, "release");
  mkdirSync(directory, { recursive: true });
  const output = path.join(directory, `qihang-desktop-source-${manifest.version}.zip`);
  run("git", ["archive", "--format=zip", "--prefix=qihang-desktop/", `--output=${output}`, "HEAD"]);
  const current = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  if (current.version !== manifest.version) console.log("注意：仅导出 HEAD 提交，当前工作区版本尚未提交。");
  console.log(`已导出最新提交：${output}。未提交内容不会包含在内。`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
