export function transformText(input, action) {
  if (input.length > 200000) throw new Error("单次处理请控制在 20 万字符以内。");
  if (action === "dedupe") return [...new Set(input.split(/\r?\n/))].join("\n");
  if (action === "sort") return input.split(/\r?\n/).sort((a, b) => a.localeCompare(b, "zh-CN")).join("\n");
  if (action === "trim") return input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join("\n");
  if (action === "json") return JSON.stringify(JSON.parse(input), null, 2);
  if (action === "encode") return encodeURIComponent(input);
  if (action === "decode") return decodeURIComponent(input);
  if (action === "base64") return btoa(Array.from(new TextEncoder().encode(input), (byte) => String.fromCharCode(byte)).join(""));
  if (action === "unbase64") return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(input), (char) => char.charCodeAt(0)));
  throw new Error("请选择处理操作。");
}

export function dateDifference(first, second) {
  const read = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("请选择有效日期。");
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("日期不存在，请重新选择。");
    return date.getTime();
  };
  return Math.round((read(second) - read(first)) / 86400000);
}

const UNITS = { length: { m: 1, km: 1000, cm: 0.01, mm: 0.001 }, weight: { kg: 1, g: 0.001, lb: 0.45359237 }, storage: { B: 1, KiB: 1024, MiB: 1048576, GiB: 1073741824 } };
export const UNIT_NAMES = UNITS;
export function convertUnit(value, category, from, to) {
  if (value === "" || !Number.isFinite(Number(value)) || !UNITS[category]?.[from] || !UNITS[category]?.[to]) throw new Error("请输入有效数值与单位。");
  const result = Number(value) * UNITS[category][from] / UNITS[category][to];
  if (!Number.isFinite(result)) throw new Error("结果超出范围。");
  return Number(result.toPrecision(12));
}
