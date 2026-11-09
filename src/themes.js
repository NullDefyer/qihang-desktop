// Shared identifiers for theme controls and backup migration.
export const THEMES = [
  { id: "light", label: "浅色", mode: "light" },
  { id: "dark", label: "深色", mode: "dark" },
  { id: "system", label: "跟随系统", mode: "system" },
];
export const ACCENTS = [
  { id: "cyan", label: "冰蓝", sample: "#13c9f3" },
  { id: "amber", label: "琥珀", sample: "#ffb72c" },
  { id: "green", label: "荧绿", sample: "#28d976" },
  { id: "blue", label: "靛蓝", sample: "#246cff" },
];
const LEGACY_MODES = { bridge: "dark", cyber: "dark", aurora: "dark", mars: "dark", lunar: "light" };
const LEGACY_ACCENTS = { bridge: "cyan", cyber: "blue", aurora: "green", mars: "amber", lunar: "cyan" };
export function normalizeTheme(id) {
  const mode = LEGACY_MODES[id] || id;
  return THEMES.some((theme) => theme.id === mode) ? mode : "dark";
}
export function getTheme(id) { return THEMES.find((theme) => theme.id === normalizeTheme(id)); }
export function normalizeAccent(accent, legacyTheme) {
  return ACCENTS.some((item) => item.id === accent) ? accent : LEGACY_ACCENTS[legacyTheme] || "cyan";
}
