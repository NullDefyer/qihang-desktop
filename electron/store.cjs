const fs = require("node:fs");
const path = require("node:path");

class JsonStore {
  constructor(directory) {
    this.filePath = path.join(directory, "qihang-state.json");
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("读取本地配置失败", error);
      }
      return null;
    }
  }

  save(state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(temporaryPath, this.filePath);
    return true;
  }
}

module.exports = { JsonStore };
