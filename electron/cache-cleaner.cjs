const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");

const AGE_MS = 7 * 86400000;
const MAX_ENTRIES = 30000;
const inside = (root, target) => { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };

// This list is constructed only in the main process. The renderer cannot send
// paths to scan/delete. Do not broaden these roots to profile/document folders.
function cacheCategories() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const windows = process.env.SystemRoot || "C:\\Windows";
  const onC = (value) => path.parse(path.resolve(value)).root.toLowerCase() === "c:\\";
  return [
    { id: "temp", name: "用户临时文件", roots: [os.tmpdir()] },
    { id: "windows-temp", name: "Windows 临时文件", roots: [path.join(windows, "Temp")] },
    { id: "directx", name: "DirectX 着色器缓存", roots: [path.join(local, "D3DSCache")] },
    ...[["edge", "Edge", path.join(local, "Microsoft", "Edge", "User Data")], ["chrome", "Chrome", path.join(local, "Google", "Chrome", "User Data")]].map(([id, name, profileRoot]) => ({ id, name: `${name} 浏览器缓存`, profileRoot })),
  ].map((item) => ({ ...item, roots: item.roots?.filter(onC), profileRoot: item.profileRoot && onC(item.profileRoot) ? item.profileRoot : undefined }));
}

class CacheCleaner {
  constructor({ categories = cacheCategories(), protectedPaths = () => [], now = Date.now } = {}) {
    this.categories = categories;
    this.protectedPaths = protectedPaths;
    this.now = now;
    this.busy = false;
    this.scanData = null;
  }

  protected(file) { return this.protectedPaths().filter(Boolean).some((root) => inside(path.resolve(root), file)); }

  async rootsFor(category) {
    if (!category.profileRoot) return category.roots || [];
    let profiles;
    try { profiles = await fs.readdir(category.profileRoot, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
    return profiles.filter((entry) => entry.isDirectory() && /^(Default|Profile \d+)$/.test(entry.name)).flatMap((entry) => ["Cache", "Code Cache", "GPUCache"].map((folder) => path.join(category.profileRoot, entry.name, folder)));
  }

  async safeRoot(root) {
    const resolved = path.resolve(root);
    if (this.protected(resolved)) return false;
    // Reject reparse points at every ancestor, including a redirected profile.
    let current = resolved;
    while (true) {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) return false;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return (await fs.realpath(resolved)).toLowerCase() === resolved.toLowerCase();
  }

  async scan() {
    if (this.busy) throw new Error("正在扫描或清理，请等待完成。");
    this.busy = true;
    this.scanData = null;
    try {
      const startedAt = this.now();
      const deadline = Date.now() + 20000;
      let visited = 0;
      const categories = [];
      for (const category of this.categories) {
        const item = { id: category.id, name: category.name, roots: [], count: 0, bytes: 0, skipped: 0, incomplete: false, samples: [], files: [] };
        categories.push(item);
        let roots;
        try { roots = await this.rootsFor(category); } catch { item.skipped++; continue; }
        for (const root of roots) {
          try {
            if (!await this.safeRoot(root)) { item.skipped++; continue; }
            item.roots.push(path.resolve(root));
            const pending = [path.resolve(root)];
            while (pending.length) {
              if (visited >= MAX_ENTRIES || Date.now() > deadline) { item.incomplete = true; break; }
              const directory = pending.pop();
              let entries;
              try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { item.skipped++; continue; }
              for (const entry of entries) {
                if (++visited > MAX_ENTRIES || Date.now() > deadline) { item.incomplete = true; break; }
                const file = path.join(directory, entry.name);
                if (this.protected(file) || entry.isSymbolicLink()) { item.skipped++; continue; }
                try {
                  const stat = await fs.lstat(file);
                  if (stat.isSymbolicLink()) { item.skipped++; continue; }
                  if (stat.isDirectory()) pending.push(file);
                  else if (stat.isFile() && stat.nlink === 1 && stat.mtimeMs <= startedAt - AGE_MS && stat.ctimeMs <= startedAt - AGE_MS) {
                    const record = { path: file, root, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino };
                    item.files.push(record); item.count++; item.bytes += stat.size;
                    if (item.samples.length < 8) item.samples.push({ path: file, size: stat.size });
                  }
                } catch { item.skipped++; }
              }
            }
          } catch (error) { if (error.code !== "ENOENT") item.skipped++; }
        }
      }
      this.scanData = { scanId: randomUUID(), scannedAt: startedAt, categories };
      return this.preview();
    } finally { this.busy = false; }
  }

  preview() {
    if (!this.scanData) return null;
    return { ...this.scanData, categories: this.scanData.categories.map(({ files, ...item }) => item) };
  }

  async clean({ scanId, categories } = {}) {
    if (this.busy) throw new Error("正在扫描或清理，请等待完成。");
    if (!this.scanData || scanId !== this.scanData.scanId || this.now() - this.scanData.scannedAt > 30 * 60000) throw new Error("扫描结果已失效，请重新扫描。");
    if (!Array.isArray(categories) || !categories.length || categories.some((id) => !this.scanData.categories.some((item) => item.id === id))) throw new Error("请选择有效的缓存分类。");
    this.busy = true;
    const result = { deleted: 0, bytes: 0, skipped: 0 };
    try {
      for (const category of this.scanData.categories.filter((item) => categories.includes(item.id))) {
        for (const file of category.files) {
          try {
            if (this.protected(file.path) || !inside(file.root, file.path) || !await this.safeRoot(path.dirname(file.path))) { result.skipped++; continue; }
            const stat = await fs.lstat(file.path);
            // Revalidate the exact scanned file. New/changed files, links and
            // files used by another process are skipped; roots are never removed.
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== file.size || stat.mtimeMs !== file.mtimeMs || stat.ctimeMs !== file.ctimeMs || stat.ino !== file.ino) { result.skipped++; continue; }
            await fs.unlink(file.path);
            result.deleted++; result.bytes += file.size;
          } catch { result.skipped++; }
        }
      }
      this.scanData = null;
      return result;
    } finally { this.busy = false; }
  }
}

module.exports = { CacheCleaner, cacheCategories, AGE_MS };
