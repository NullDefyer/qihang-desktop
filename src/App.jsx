import {
  CaretDown,
  MagnifyingGlass,
  Cloud,
  Desktop,
  Database,
  Monitor,
  FileText,
  Gear,
  GithubLogo,
  House,
  Toolbox,
  ListBullets,
  Minus,
  Moon,
  Note,
  Sailboat,
  Square,
  Sun,
  X,
} from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { RemoteView } from "./components/RemoteView.jsx";
import { NotesView } from "./components/NotesView.jsx";
import { ServicesView } from "./components/ServicesView.jsx";
import { ServiceDrawer } from "./components/ServiceDrawer.jsx";
import { SettingsView } from "./components/SettingsView.jsx";
import { HomeView } from "./components/HomeView.jsx";
import { SearchPalette } from "./components/SearchPalette.jsx";
import { ToolboxView } from "./components/ToolboxView.jsx";
import { personalCall } from "./personal.js";
import { desktop, isDesktop } from "./desktop.js";
import { createId, DEFAULT_STATE, normalizeState } from "./model.js";
import { canStartService } from "./service-templates.js";
import { THEMES, ACCENTS, getTheme } from "./themes.js";
import { mergeReminderEvent } from "./todos.js";

const GithubView = lazy(() => import("./components/GithubView.jsx").then((module) => ({ default: module.GithubView })));

const NAV_ITEMS = [
  { id: "home", label: "首页", icon: House },
  { id: "services", label: "服务", icon: ListBullets, bridgeIcon: Database },
  { id: "remote", label: "远程", icon: Cloud, bridgeIcon: Monitor },
  { id: "notes", label: "笔记", icon: Note, bridgeIcon: FileText },
  { id: "tools", label: "工具箱", icon: Toolbox },
  { id: "github", label: "GitHub", icon: GithubLogo },
  { id: "settings", label: "设置", icon: Gear },
];

const DEMO_LOGS = [
  ["nacos", "stdout", "JVM detected: 17.0.8"],
  ["nacos", "stdout", "Copying configuration files…"],
  ["nacos", "stdout", "Starting Nacos v2.3.0"],
  ["nacos", "system", "Nacos 服务已就绪，端口: 8848"],
  ["redis", "stdout", "Loading RDB produced by version 7.2.4"],
  ["redis", "stdout", "Ready to accept connections"],
  ["mysql", "system", "等待启动"],
  ["elasticsearch", "stdout", "Node initialized, transport port: 9200"],
].map(([serviceId, stream, message], index) => ({
  id: `demo-${index}`,
  serviceId,
  stream,
  message,
  timestamp: Date.now() - 8000 + index * 1000,
}));

function sanitizeState(state) {
  return {
    ...state,
    theme: state.theme,
    services: state.services.map((service) => ({
      ...service,
      status: "stopped",
      startedAt: null,
      pid: null,
    })),
    notes: state.notes,
    activeNoteId: state.activeNoteId,
  };
}

export function App() {
  const [state, setState] = useState(DEFAULT_STATE);
  const [ready, setReady] = useState(false);
  const [activeSection, setActiveSection] = useState("home");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeTool, setActiveTool] = useState(null);
  const [notice, setNotice] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("nacos");
  const [logs, setLogs] = useState(() => isDesktop ? [] : DEMO_LOGS);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const simulatedTimers = useRef(new Set());
  const selectedTheme = getTheme(state.theme);

  useEffect(() => {
    if (!themeMenuOpen) return undefined;
    const dismiss = (event) => { if (event.type === "keydown" ? event.key === "Escape" : !event.target.closest(".theme-menu-wrap")) setThemeMenuOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", dismiss); };
  }, [themeMenuOpen]);

  const runningCount = useMemo(
    () => state.services.filter((service) => service.status === "running").length,
    [state.services],
  );

  useEffect(() => {
    let active = true;
    desktop.loadState().then((stored) => {
      if (!active) return;
      const restored = normalizeState(stored);
      setState(restored);
      setActiveSection(restored.preferences.startPage);
      setReady(true);
    }).catch((error) => { setNotice(`读取配置失败：${error.message}`); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    const timer = window.setTimeout(() => { desktop.saveState(sanitizeState(state)).catch((error) => setNotice(`保存失败：${error.message}`)); }, 250);
    return () => window.clearTimeout(timer);
  }, [ready, state]);

  useEffect(() => {
    const remove = desktop.personal?.onEvent((event) => {
      if (event.type === "search") setSearchOpen(true);
      if (event.type === "navigate") setActiveSection(event.section);
      if (event.type === "warning") setNotice(event.message);
      if (event.type === "reminders") setState((current) => ({
        ...current,
        ...mergeReminderEvent(current, event),
        countdowns: current.countdowns.map((item) => {
          const patch = event.countdowns?.find((value) => value.id === item.id && value.deadline === item.deadline);
          return patch ? { ...item, ...patch } : item;
        }),
      }));
    });
    const onKey = (event) => {
      if (!isDesktop && event.altKey && event.code === "Space") { event.preventDefault(); setSearchOpen((value) => !value); }
    };
    window.addEventListener("keydown", onKey);
    return () => { remove?.(); window.removeEventListener("keydown", onKey); };
  }, []);

  function updatePersonal(patch) { setState((current) => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch) })); }
  function openNote(id) { setState((current) => ({ ...current, activeNoteId: id })); setActiveSection("notes"); }

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const selected = getTheme(state.theme);
      const resolved = selected.mode === "system" ? (media.matches ? "dark" : "light") : selected.mode;
      const root = document.documentElement;
      root.dataset.theme = resolved;
      root.dataset.skin = "console";
      root.dataset.accent = state.preferences.accent;
      root.dataset.visual = "console";
      root.dataset.material = state.preferences.material;
      root.style.setProperty("--glass-opacity", `${state.preferences.glassOpacity}%`);
      root.style.setProperty("--glass-blur", `${state.preferences.glassBlur}px`);
      root.dataset.motion = state.preferences.motionEffects ? "on" : "off";
      root.style.setProperty("--scene-opacity", String(state.preferences.backgroundIntensity / 100));
      root.style.colorScheme = resolved;
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [state.theme, state.preferences.accent, state.preferences.backgroundIntensity, state.preferences.motionEffects, state.preferences.material, state.preferences.glassOpacity, state.preferences.glassBlur]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    const removeLogListener = desktop.onLog((entry) => appendLog(entry));
    const removeStatusListener = desktop.onStatus((entry) => updateServiceStatus(entry));
    return () => {
      window.clearInterval(interval);
      removeLogListener();
      removeStatusListener();
      simulatedTimers.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  function appendLog(entry) {
    setLogs((current) => [...current.slice(-499), { id: createId("log"), ...entry }]);
  }

  function updateServiceStatus({ serviceId, status, pid = null, timestamp = Date.now() }) {
    setState((current) => ({
      ...current,
      services: current.services.map((service) => service.id === serviceId
        ? {
          ...service,
          status,
          pid,
          startedAt: status === "running"
            ? (service.startedAt ?? timestamp)
            : status === "stopped" ? null : service.startedAt,
        }
        : service),
    }));
  }

  function simulateStart(service) {
    updateServiceStatus({ serviceId: service.id, status: "starting" });
    appendLog({
      serviceId: service.id,
      stream: "system",
      message: `预览模式：正在启动 ${service.name}…`,
      timestamp: Date.now(),
    });
    const timer = window.setTimeout(() => {
      updateServiceStatus({ serviceId: service.id, status: "running" });
      appendLog({
        serviceId: service.id,
        stream: "stdout",
        message: `${service.name} started successfully${service.port ? ` on port ${service.port}` : ""}`,
        timestamp: Date.now(),
      });
      simulatedTimers.current.delete(timer);
    }, 650);
    simulatedTimers.current.add(timer);
  }

  async function startService(service) {
    setSelectedServiceId(service.id);
    if (!canStartService(service)) { openEditDrawer(service); return; }
    try {
      if (isDesktop) await desktop.startService(service);
      else simulateStart(service);
    } catch (error) {
      updateServiceStatus({ serviceId: service.id, status: "error" });
      appendLog({ serviceId: service.id, stream: "stderr", message: error.message, timestamp: Date.now() });
    }
  }

  async function stopService(service) {
    try {
      if (isDesktop) await desktop.stopService(service.id);
      else {
        updateServiceStatus({ serviceId: service.id, status: "stopped" });
        appendLog({
          serviceId: service.id,
          stream: "system",
          message: `${service.name} 已停止`,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      appendLog({ serviceId: service.id, stream: "stderr", message: error.message, timestamp: Date.now() });
    }
  }

  async function startAll() {
    setSelectedServiceId("all");
    const configured = state.services.filter(canStartService);
    const skipped = state.services.length - configured.length;
    if (skipped) setNotice(`已跳过 ${skipped} 个示例或未配置的服务，请先编辑配置并保存。`);
    if (isDesktop) {
      try { await desktop.startAll(configured); }
      catch (error) { setNotice(error.message); }
      return;
    }
    configured.forEach((service, index) => {
      const timer = window.setTimeout(() => {
        simulateStart(service);
        simulatedTimers.current.delete(timer);
      }, index * 180);
      simulatedTimers.current.add(timer);
    });
  }

  async function stopAll() {
    if (isDesktop) await desktop.stopAll();
    else state.services.forEach((service) => {
      if (service.status !== "stopped") stopService(service);
    });
  }

  function openAddDrawer() {
    setEditingService(null);
    setDrawerOpen(true);
  }

  function openEditDrawer(service) {
    setEditingService(service);
    setDrawerOpen(true);
  }

  function saveService(form) {
    setState((current) => ({
      ...current,
      services: editingService
        ? current.services.map((service) => service.id === editingService.id ? { ...service, ...form } : service)
        : [...current.services, {
          ...form,
          id: createId("service"),
          status: "stopped",
          startedAt: null,
          pid: null,
        }],
    }));
    setDrawerOpen(false);
    setEditingService(null);
  }

  async function deleteService(service) {
    if (["running", "starting", "stopping"].includes(service.status)) await stopService(service);
    setState((current) => ({
      ...current,
      services: current.services.filter((item) => item.id !== service.id),
    }));
    setLogs((current) => current.filter((entry) => entry.serviceId !== service.id));
    if (selectedServiceId === service.id) setSelectedServiceId("all");
  }

  function updateNotes(notes, activeNoteId) {
    setState((current) => ({ ...current, notes, activeNoteId }));
  }

  function setTheme(theme) {
    setState((current) => ({ ...current, theme }));
    setThemeMenuOpen(false);
  }

  const content = (() => {
    if (activeSection === "remote") return null;
    if (activeSection === "github") return <Suspense fallback={<div className="github-empty" role="status">正在打开 GitHub 高星项目…</div>}><GithubView report={setNotice} /></Suspense>;
    if (activeSection === "home") return <HomeView state={state} update={updatePersonal} now={now} onOpenNote={openNote} onNavigate={setActiveSection} report={setNotice} />;
    if (activeSection === "tools") return <ToolboxView key={activeTool || "all"} initialTool={activeTool} commands={state.commands} onCommandsChange={(commands) => updatePersonal({ commands })} onNavigate={setActiveSection} report={setNotice} />;
    if (activeSection === "notes") {
      return <NotesView notes={state.notes} activeNoteId={state.activeNoteId} onChange={updateNotes} />;
    }
    if (activeSection === "settings") {
      return <SettingsView theme={state.theme} preferences={state.preferences} onPreferencesChange={(preferences) => updatePersonal({ preferences })} onThemeChange={setTheme} report={setNotice} onChangeDataDirectory={() => personalCall("change-data-directory", sanitizeState(state))} onExport={() => personalCall("export", sanitizeState(state))} onImport={async () => { const restored = await personalCall("import"); if (restored) window.location.reload(); return Boolean(restored); }} />;
    }
    return <ServicesView services={state.services} logs={logs} now={now} viewMode={state.preferences.serviceViewMode} onViewModeChange={(serviceViewMode) => setState((current) => ({ ...current, preferences: { ...current.preferences, serviceViewMode } }))} selectedServiceId={selectedServiceId} onSelect={setSelectedServiceId} onStart={startService} onStop={stopService} onEdit={openEditDrawer} onDelete={deleteService} onAdd={openAddDrawer} onStartAll={startAll} onStopAll={stopAll} onClear={() => setLogs([])} />;
  })();

  return (
    <div className={`app-shell ${ready ? "app-shell--ready" : ""}`}>
      <header className="titlebar">
        <div className="brand">
          <Sailboat size={34} weight="fill" />
          <strong>启航</strong>
          <span />
          <small>开发与日常，随手可达</small>
        </div>
        <button className="global-search home-search" onClick={() => setSearchOpen(true)}><MagnifyingGlass size={17} /><span>搜索应用、文件、笔记和工具…</span><kbd>{state.preferences.shortcut || "搜索"}</kbd></button>
        <div className="window-tools">
          <div className="accent-switcher" role="group" aria-label="强调色">{ACCENTS.map((accent) => <button key={accent.id} className="accent-dot" style={{ "--swatch": accent.sample }} aria-label={"切换" + accent.label + "强调色"} aria-pressed={state.preferences.accent === accent.id} title={accent.label} onClick={() => setState((current) => ({ ...current, preferences: { ...current.preferences, accent: accent.id } }))} />)}</div>
          <button className="console-settings-button" aria-label="打开设置" title="设置" onClick={() => setActiveSection("settings")}><Gear size={17} /></button>
          <div className="theme-menu-wrap">
            <button className="theme-trigger" type="button" aria-label="切换主题" aria-expanded={themeMenuOpen} onClick={() => setThemeMenuOpen((value) => !value)}>
              {selectedTheme.mode === "light" ? <Sun size={17} /> : state.theme === "system" ? <Desktop size={17} /> : <Moon size={17} />}
              {selectedTheme.label} <CaretDown size={14} />
            </button>
            {themeMenuOpen ? (
              <div className="theme-menu">
                {THEMES.map(({ id, label, accent }) => (
                  <button aria-pressed={state.theme === id} className={state.theme === id ? "theme-menu-item--active" : ""} key={id} type="button" onClick={() => setTheme(id)}>
                    <span className="theme-menu-swatch" style={{ "--swatch": accent || "var(--text-secondary)" }} /> <span>{label}</span>{state.theme === id ? <i /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" aria-label="最小化" onClick={desktop.minimize}><Minus size={17} /></button>
          <button type="button" aria-label="最大化" onClick={desktop.toggleMaximize}><Square size={13} /></button>
          <button className="window-close" type="button" aria-label="关闭" onClick={desktop.close}><X size={18} /></button>
        </div>
      </header>
      <div className="app-body">
        <nav className="sidebar">
          <div className="nav-list">
            {NAV_ITEMS.map(({ id, label, icon, bridgeIcon }) => {
              const Icon = bridgeIcon || icon;
              return (
              <button
                className={activeSection === id ? "nav-item nav-item--active" : "nav-item"}
                key={id}
                type="button"
                aria-label={label}
                title={label}
                onClick={() => setActiveSection(id)}
              >
                <Icon size={22} />
                <span>{label}</span>
              </button>
              );
            })}
          </div>
          <div className="sidebar-status">
            <span><i /> 就绪</span>
            <small>版本 0.1.5</small>
          </div>
        </nav>
        <section className="workspace">
          <div className="remote-host" hidden={activeSection !== "remote"}><RemoteView active={activeSection === "remote"} /></div>
          {content}
        </section>
      </div>
      <footer className="console-status"><div><span><i />就绪</span><span><i />本地服务 {runningCount} 个运行中</span><span>{isDesktop ? "数据保存在本机" : "浏览器预览"}</span></div><time>{new Date(now).toLocaleTimeString("zh-CN", { hour12: false })}</time></footer>
      {drawerOpen ? <ServiceDrawer service={editingService} onChooseFolder={() => desktop.selectFolder()} onClose={() => setDrawerOpen(false)} onSubmit={saveService} /> : null}
      {notice ? <div className="app-notice" role="status"><span>{notice}</span><button className="quiet-button" aria-label="关闭提示" onClick={() => setNotice("")}><X size={18} /></button></div> : null}
      {searchOpen ? <SearchPalette state={state} onClose={() => setSearchOpen(false)} onNavigate={setActiveSection} onOpenNote={openNote} onOpenTool={(id) => { setActiveTool(id); setActiveSection("tools"); }} report={setNotice} /> : null}
    </div>
  );
}
