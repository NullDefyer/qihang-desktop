export const SERVICE_VIEW_MODES = ["auto", "full", "compact", "icons"];

export function serviceColumns(width, mode) {
  return Math.max(1, Math.min(5, Math.floor((width + 12) / (mode === "full" ? 217 : 204))));
}

// Measure the stable outer stage, not its children: folding content must not
// change the measurement and create a resize/expand feedback loop.
export function resolveServiceView(width, height, count, previous = "compact") {
  const fullRows = Math.ceil(Math.max(1, count) / serviceColumns(width, "full"));
  const compactRows = Math.ceil(Math.max(1, count) / serviceColumns(width, "compact"));
  const fullHeight = 148 + fullRows * 158;
  const compactHeight = 126 + compactRows * 66;
  // Separate enter/leave thresholds prevent flicker around a size boundary.
  if (height >= fullHeight + (previous === "full" ? -12 : 16)) return "full";
  if (height >= compactHeight + (previous === "icons" ? 20 : -8)) return "compact";
  return "icons";
}
