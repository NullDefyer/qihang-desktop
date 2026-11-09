#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ref = process.argv.find((value) => value.startsWith("--ref="))?.slice(6);
function git(args, options = {}) {
  return execFileSync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024, ...options });
}

// Inspect immutable Git blobs rather than working files: staging a secret then
// deleting it locally must not make a publishing check incorrectly succeed.
try {
  const records = git(ref ? ["ls-tree", "-rz", "--full-tree", ref] : ["ls-files", "--stage", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  if (!records.length) throw new Error("没有可检查的 Git 文件。请先暂存准备公开的源码。");
  const findings = [];
  const blocked = /(^|\/)(node_modules|dist|release|data|backups|\.local-notes|qa|\.aws|\.codex|\.agents)(\/|$)|(^|\/)(qihang-state\.json|remote-servers\.json|storage-locations\.json|\.npmrc|id_rsa[^/]*|id_ed25519[^/]*)$|(^|\/)\.env(?!\.example$)|\.(exe|msi|zip|7z|log|pem|key|pfx|p12|ppk|dmp)$/i;
  const patterns = [
    ["私钥", /-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/],
    ["GitHub 令牌", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
    ["常见 API 密钥", /\b(?:AKIA[0-9A-Z]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{24,})\b/],
    ["npm 认证", /(?:_authToken|_password)\s*[:=]\s*["']?(?!\$\{|process\.env)[A-Za-z0-9_+\/-]{16,}/],
    ["本机用户目录", /[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)[^\s"'<>]+/i],
  ];
  for (const record of records) {
    const tab = record.indexOf("\t");
    const file = record.slice(tab + 1);
    const metadata = record.slice(0, tab).split(" ");
    const hash = metadata[ref ? 2 : 1];
    if (blocked.test(file) || ["build/installer-files.nsh", "AGENTS.md", "design-qa.md", "IMPLEMENTATION-PLAN.md", "REMOTE-MONITOR-QA.md"].includes(file)) findings.push(`${file}: 不应公开的运行数据、产物或本地记录`);
    if (metadata[0] !== "100644" && metadata[0] !== "100755") { findings.push(`${file}: 不支持的链接或子模块`); continue; }
    const blob = git(["cat-file", "blob", hash]);
    if (blob.length > 10 * 1024 * 1024) findings.push(`${file}: 文件超过 10 MB，请使用 Release 存放产物`);
    if (/\.(png|jpe?g|ico|webp|gif)$/i.test(file)) continue;
    const text = blob.toString("utf8");
    for (const [label, pattern] of patterns) if (pattern.test(text)) findings.push(`${file}: 疑似${label}`);
  }
  if (findings.length) throw new Error(findings.join("\n"));
  console.log(`公开源码检查通过：${records.length} 个 Git 文件（${ref || "暂存区"}）。未输出文件内容或任何凭据。`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
