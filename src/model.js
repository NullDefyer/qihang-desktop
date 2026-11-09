import { normalizeTheme, normalizeAccent } from "./themes.js";
import { normalizeTodoHistory } from "./todos.js";

export const SERVICE_STATUS = {
  stopped: { label: "已停止", tone: "muted" },
  starting: { label: "启动中", tone: "info" },
  running: { label: "运行中", tone: "success" },
  stopping: { label: "停止中", tone: "warning" },
  error: { label: "启动失败", tone: "danger" },
};

// Local services appear only after the user explicitly adds a configuration.
export const DEFAULT_SERVICES = [];

export const DEFAULT_NOTES = [
  {
    id: "welcome-note",
    title: "随手记录",
    content: "这里可以记录任意文本内容。\n\n笔记与服务、日志相互独立。",
    updatedAt: Date.now(),
  },
];

export const DEFAULT_STATE = {
  schemaVersion: 4,
  theme: "light",
  services: DEFAULT_SERVICES,
  notes: DEFAULT_NOTES,
  activeNoteId: "welcome-note",
  preferences: {
    startPage: "home", closeBehavior: "tray", exitBehavior: "ask",
    shortcut: "Alt+Space", autoBackup: true, backgroundIntensity: 35, motionEffects: false, accent: "cyan", serviceViewMode: "auto",
    material: "frosted", glassOpacity: 70, glassBlur: 24,
  },
  shortcuts: [],
  todos: [],
  todoHistory: [],
  snippets: [],
  commands: [],
  countdowns: [],
  focus: { running: false, deadline: null, remaining: 1500 },
};

export function normalizeState(value) {
  if (!value || typeof value !== "object") return structuredClone(DEFAULT_STATE);
  const services = Array.isArray(value.services) ? value.services : DEFAULT_SERVICES;
  const notes = Array.isArray(value.notes) && value.notes.length ? value.notes : DEFAULT_NOTES;
  const todos = Array.isArray(value.todos) ? value.todos.filter((item) => item?.id && typeof item.text === "string") : [];

  return {
    schemaVersion: 4,
    theme: normalizeTheme(value.theme),
    services: services.map((service) => ({
      ...service,
      status: "stopped",
      startedAt: null,
      pid: null,
    })),
    notes: notes.map((note) => ({ ...note, pinned: Boolean(note.pinned) })),
    preferences: {
      startPage: ["home", "services", "remote", "notes", "tools", "github"].includes(value.preferences?.startPage) ? value.preferences.startPage : "home",
      closeBehavior: value.preferences?.closeBehavior === "quit" ? "quit" : "tray",
      exitBehavior: value.preferences?.exitBehavior === "stop" ? "stop" : "ask",
      shortcut: typeof value.preferences?.shortcut === "string" ? value.preferences.shortcut : "Alt+Space",
      autoBackup: value.preferences?.autoBackup !== false,
      accent: normalizeAccent(value.preferences?.accent, value.theme),
      backgroundIntensity: Number.isFinite(value.preferences?.backgroundIntensity) ? Math.max(0, Math.min(100, value.preferences.backgroundIntensity)) : 75,
      motionEffects: value.preferences?.motionEffects === true,
      serviceViewMode: ["auto", "full", "compact", "icons"].includes(value.preferences?.serviceViewMode) ? value.preferences.serviceViewMode : "auto",
      material: ["frosted", "liquid", "plain"].includes(value.preferences?.material) ? value.preferences.material : "frosted",
      glassOpacity: Number.isFinite(value.preferences?.glassOpacity) ? Math.max(40, Math.min(95, value.preferences.glassOpacity)) : 70,
      glassBlur: Number.isFinite(value.preferences?.glassBlur) ? Math.max(0, Math.min(40, value.preferences.glassBlur)) : 24,
    },
    shortcuts: Array.isArray(value.shortcuts) ? value.shortcuts.filter((item) => item?.id && typeof item.target === "string") : [],
    todos,
    todoHistory: normalizeTodoHistory(value.todoHistory, todos),
    snippets: Array.isArray(value.snippets) ? value.snippets.filter((item) => item?.id && typeof item.content === "string") : [],
    commands: Array.isArray(value.commands) ? value.commands.filter((item) => item?.id && typeof item.name === "string" && typeof item.command === "string").map((item) => ({ ...item, shell: item.shell === "cmd" ? "cmd" : "powershell", cwd: typeof item.cwd === "string" ? item.cwd : "" })) : [],
    countdowns: Array.isArray(value.countdowns)
      ? value.countdowns.filter((item) => item?.id && typeof item.title === "string" && Number.isFinite(item.remaining) && Number.isFinite(item.durationSeconds)).map((item) => ({ ...item, status: ["running", "paused", "finished"].includes(item.status) ? item.status : "paused" }))
      : value.focus?.running || (Number.isFinite(value.focus?.remaining) && value.focus.remaining !== 1500)
        ? [{ id: "legacy-focus", title: "原计时", mode: "duration", status: value.focus.running ? "running" : "paused", deadline: value.focus.deadline, remaining: value.focus.remaining, durationSeconds: 1500, notifiedAt: null }]
        : [],
    focus: value.focus && Number.isFinite(value.focus.remaining) ? {
      running: Boolean(value.focus.running) && Number.isFinite(value.focus.deadline),
      deadline: value.focus.deadline, remaining: Math.max(0, Math.min(86400, value.focus.remaining)),
    } : structuredClone(DEFAULT_STATE.focus),
    activeNoteId: notes.some((note) => note.id === value.activeNoteId)
      ? value.activeNoteId
      : notes[0].id,
  };
}

export { createId } from "./ids.js";

export function formatUptime(startedAt, now = Date.now()) {
  if (!startedAt) return "-";
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function countdownRemaining(item, now = Date.now()) {
  return item.status === "running" && Number.isFinite(item.deadline)
    ? Math.max(0, Math.ceil((item.deadline - now) / 1000))
    : Math.max(0, Math.round(item.remaining));
}
