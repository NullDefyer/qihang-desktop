const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

// Resolve using Node's module search directories without requesting a private
// package.json export. Nested dist/package.json files are not package roots.
const seen = new Set();
function visit(name, from) {
  const localRequire = createRequire(path.join(from, "package.json"));
  const file = localRequire.resolve.paths(name).map(directory => path.join(directory, name, "package.json")).find(candidate => fs.existsSync(candidate));
  if (!file) throw new Error(`Cannot locate runtime package ${name}`);
  const root = fs.realpathSync(path.dirname(file));
  const metadata = JSON.parse(fs.readFileSync(file, "utf8"));
  if (seen.has(root)) return;
  seen.add(root);
  process.stdout.write(`${root}\n`);
  for (const child of Object.keys(metadata.dependencies || {})) visit(child, root);
}
for (const name of ["ssh2", "mysql2", "redis"]) visit(name, process.cwd());
