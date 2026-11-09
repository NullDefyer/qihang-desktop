const number = (value) => value != null && String(value).trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;

// Only fixed read-only Linux commands. No renderer-provided command is accepted.
const HOST_COMMAND = `LC_ALL=C sh -c 'test "$(uname -s)" = Linux || exit 42; printf "\\n__CPU__\\n"; head -n 1 /proc/stat; printf "\\n__MEM__\\n"; cat /proc/meminfo; printf "\\n__LOAD__\\n"; cat /proc/loadavg; printf "\\n__NET__\\n"; cat /proc/net/dev; printf "\\n__DISK__\\n"; df -Pk /; printf "\\n__UPTIME__\\n"; cat /proc/uptime; printf "\\n__CORES__\\n"; getconf _NPROCESSORS_ONLN; printf "\\n__OS__\\n"; cat /etc/os-release'`;

function parseHost(output, previous, now = Date.now()) {
  const blocks = {};
  let key;
  for (const line of output.split(/\r?\n/)) {
    const match = /^__(\w+)__$/.exec(line.trim());
    if (match) { key = match[1]; blocks[key] = []; } else if (key) blocks[key].push(line);
  }
  const cpu = (blocks.CPU?.[0] || "").trim().split(/\s+/).slice(1, 9).map(Number);
  const total = cpu.length === 8 && cpu.every(Number.isFinite) ? cpu.reduce((sum, n) => sum + n, 0) : null;
  const idle = total === null ? null : cpu[3] + cpu[4];
  const elapsed = previous ? (now - previous.at) / 1000 : 0;
  const delta = total !== null && previous?.total != null ? total - previous.total : 0;
  const cpuPercent = delta > 0 ? Math.max(0, Math.min(100, 100 * (1 - (idle - previous.idle) / delta))) : null;
  const mem = Object.fromEntries((blocks.MEM || []).map(line => { const m = /^(\w+):\s+(\d+)/.exec(line); return m ? [m[1], Number(m[2]) * 1024] : []; }).filter(row => row.length));
  const memoryUsed = mem.MemTotal != null && mem.MemAvailable != null ? mem.MemTotal - mem.MemAvailable : null;
  const interfaces = (blocks.NET || []).flatMap(line => {
    const m = /^\s*([^:]+):\s*(.*)$/.exec(line); if (!m || m[1] === "lo") return [];
    const fields = m[2].split(/\s+/).map(Number);
    return fields.length >= 16 ? [{ name: m[1], rx: fields[0], tx: fields[8] }] : [];
  });
  const rx = interfaces.reduce((sum, item) => sum + item.rx, 0), tx = interfaces.reduce((sum, item) => sum + item.tx, 0);
  const sameInterfaces = previous?.interfaces === interfaces.map(item => item.name).join(",");
  const disk = blocks.DISK?.filter(line => line.trim()).at(-1)?.trim().split(/\s+/);
  const diskTotal = disk?.length >= 6 ? (number(disk[1]) == null ? null : number(disk[1]) * 1024) : null;
  const diskUsed = disk?.length >= 6 ? (number(disk[2]) == null ? null : number(disk[2]) * 1024) : null;
  const os = (blocks.OS || []).find(line => line.startsWith("PRETTY_NAME="))?.slice(12).replace(/^"|"$/g, "") || "Linux";
  return { at: now, os, cores: number(blocks.CORES?.[0]), uptime: number(blocks.UPTIME?.[0]?.split(" ")[0]), load: blocks.LOAD?.[0]?.split(/\s+/).slice(0, 3).map(Number) || [], cpuPercent, memoryTotal: mem.MemTotal ?? null, memoryUsed, memoryPercent: memoryUsed != null && mem.MemTotal > 0 ? memoryUsed / mem.MemTotal * 100 : null, swapTotal: mem.SwapTotal ?? null, swapUsed: mem.SwapTotal != null ? mem.SwapTotal - mem.SwapFree : null, diskTotal, diskUsed, diskPercent: disk?.length >= 6 ? number(disk[4].replace("%", "")) : null, receiveRate: elapsed > 0 && sameInterfaces && rx >= previous.rx ? (rx - previous.rx) / elapsed : null, sendRate: elapsed > 0 && sameInterfaces && tx >= previous.tx ? (tx - previous.tx) / elapsed : null, interfaces: interfaces.map(item => item.name), counters: { total, idle, rx, tx, interfaces: interfaces.map(item => item.name).join(","), at: now } };
}

function parseStats(output) {
  return output.split(/\r?\n/).filter(Boolean).map(line => {
    const row = JSON.parse(line);
    return { id: row.ID || row.Container, name: row.Name, cpuPercent: number(String(row.CPUPerc || "").replace("%", "")), memoryPercent: number(String(row.MemPerc || "").replace("%", "")), memory: row.MemUsage || "—", network: row.NetIO || "—", blockIO: row.BlockIO || "—", pids: number(row.PIDs) };
  });
}

module.exports = { HOST_COMMAND, parseHost, parseStats };
