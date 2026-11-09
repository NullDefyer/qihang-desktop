const STORAGE_KEY = "qihang-state-v1";

function browserLoad() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return Promise.resolve(value ? JSON.parse(value) : null);
  } catch {
    return Promise.resolve(null);
  }
}

function browserSave(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return Promise.resolve(true);
}

export const desktop = window.qihang ?? {
  isDesktop: false,
  selectFolder: async () => "D:\\dev\\my-service",
  loadState: browserLoad,
  saveState: browserSave,
  startService: async () => ({ status: "starting", pid: null }),
  stopService: async () => ({ status: "stopped" }),
  startAll: async () => [],
  stopAll: async () => ({ status: "stopped" }),
  minimize: () => {},
  toggleMaximize: () => {},
  close: () => {},
  onLog: () => () => {},
  onStatus: () => () => {},
};

export const isDesktop = Boolean(window.qihang?.isDesktop);
