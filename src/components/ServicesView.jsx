import { CaretDown, Database, DotsThree, FolderSimple, Play, Plus, Stop, Trash } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatUptime, SERVICE_STATUS } from "../model.js";
import { resolveServiceView, serviceColumns } from "../service-layout.js";
import { EnvironmentLayout } from "./EnvironmentLayout.jsx";
import { LogPanel } from "./LogPanel.jsx";
import { ServiceIcon } from "./ServiceIcon.jsx";
import { canStartService } from "../service-templates.js";

const VIEW_LABELS = { auto: "自动", full: "完整卡片", compact: "紧凑条目", icons: "图标磁贴" };

export function ServicesView({ services, logs, now, viewMode = "auto", onViewModeChange, selectedServiceId, onSelect, onStart, onStop, onEdit, onDelete, onAdd, onStartAll, onStopAll, onClear }) {
  const stageRef = useRef(null);
  const menuRef = useRef(null);
  const menuTriggerRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [automaticMode, setAutomaticMode] = useState("compact");
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState(null);
  const mode = viewMode === "auto" ? automaticMode : viewMode;
  const selected = services.find((item) => item.id === selectedServiceId);
  const menuService = services.find((item) => item.id === menu?.id);
  const configOpen = mode === "full" || expanded;

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    });
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (size.width) setAutomaticMode((previous) => resolveServiceView(size.width, size.height, services.length, previous));
  }, [size, services.length]);
  useEffect(() => { setExpanded(false); setMenu(null); }, [mode, selectedServiceId]);

  function closeMenu(restoreFocus = false) {
    setMenu(null);
    if (restoreFocus) menuTriggerRef.current?.focus();
  }
  useEffect(() => {
    if (!menu) return undefined;
    const outside = (event) => { if (!menuRef.current?.contains(event.target) && !menuTriggerRef.current?.contains(event.target)) setMenu(null); };
    const keyboard = (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const buttons = [...menuRef.current.querySelectorAll("button:not(:disabled)")];
        const index = buttons.indexOf(document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
      if (event.key === "Tab") setMenu(null);
    };
    const dismiss = () => setMenu(null);
    menuRef.current?.querySelector("button:not(:disabled)")?.focus();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    // The menu lives outside the scrollable grid, so keep it from floating away
    // from its trigger when the user scrolls or resizes the service region.
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [menu]);

  function openMenu(event, service) {
    event.preventDefault();
    const trigger = event.currentTarget;
    const bounds = trigger.getBoundingClientRect();
    menuTriggerRef.current = trigger;
    setMenu((current) => current?.id === service.id ? null : {
      id: service.id,
      left: Math.max(8, Math.min(window.innerWidth - 184, bounds.right - 176)),
      top: Math.max(8, Math.min(window.innerHeight - 215, bounds.bottom + 5)),
    });
  }
  function removeService(service) {
    if (window.confirm(`删除服务“${service.name}”？`)) onDelete(service);
  }
  function toggleService(service) {
    if (["running", "starting"].includes(service.status)) onStop(service);
    else if (service.status !== "stopping") onStart(service);
  }

  return <div className="services-page">
      <header className="environment-header">
        <div className="environment-title-row"><h1>本地服务</h1><span className="service-summary">{services.length} 个服务</span></div>
        <div className="environment-actions">
          <select className="service-view-select" aria-label="服务展示方式" title={`当前：${VIEW_LABELS[mode]}`} value={viewMode} onChange={(event) => onViewModeChange(event.target.value)}>{Object.entries(VIEW_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <button className="button button--primary" onClick={onStartAll}><Play size={15} weight="fill" />全部启动</button>
          <button className="button button--secondary" onClick={onStopAll}><Stop size={15} />全部停止</button>
          <button className="button button--outline" onClick={onAdd}><Plus size={16} />添加服务</button>
        </div>
      </header>
    <EnvironmentLayout>
    <main className={`service-stage service-stage--${mode}`} data-service-view={mode} ref={stageRef} style={{ "--service-columns": serviceColumns(size.width, mode) }}>
      <div className="service-card-grid service-list">{services.map((service) => {
        const status = service.isExample ? { label: "示例 · 待配置", tone: "muted" } : SERVICE_STATUS[service.status] || SERVICE_STATUS.stopped;
        const running = ["running", "starting", "stopping"].includes(service.status);
        const action = !canStartService(service) ? "配置" : running ? "停止" : service.status === "error" ? "重试" : "启动";
        const details = `${service.name} · ${status.label} · ${service.port ? `端口 ${service.port}` : "未设置端口"}\n${service.description || "本地服务"}\n点击查看日志`;
        return <article key={service.id} data-example={service.isExample ? "true" : undefined} className={`service-card service-card--${status.tone}${selectedServiceId === service.id ? " service-card--selected" : ""}`} onContextMenu={(event) => openMenu(event, service)}>
          <button className="service-card-select" aria-label={`选择服务 ${service.name}`} aria-pressed={selectedServiceId === service.id} title={details} onClick={() => onSelect(service.id)}>
            <ServiceIcon service={service} />
            <span className="service-card-identity"><strong>{service.name}</strong><span className="service-card-status"><i />{status.label}<small className="service-status-port">{service.port ? `:${service.port}` : ""}</small></span></span>
            <span className="service-card-port">{service.port ? `:${service.port}` : "无端口"}</span>
          </button>
          <p className="service-card-description" title={service.description}>{service.description || "本地服务"}</p>
          <p className="service-card-state">{service.status === "running" ? `运行时长 ${formatUptime(service.startedAt, now)}` : status.label}</p>
          <div className="service-state-rule" />
          <div className="service-card-actions">
            <button onClick={() => onSelect(service.id)}>日志</button>
            <button disabled={service.status === "stopping"} onClick={() => toggleService(service)}>{action}</button>
            <button onClick={() => onEdit(service)}>编辑</button>
            <button className="service-card-delete" aria-label={`删除服务 ${service.name}`} title="删除服务" onClick={() => removeService(service)}><Trash size={13} /></button>
          </div>
          <div className="service-condensed-actions">
            <button className="service-quick-toggle" aria-label={`${action}服务 ${service.name}`} title={action} disabled={service.status === "stopping"} onClick={() => toggleService(service)}>{running ? <Stop size={14} /> : <Play size={14} />}</button>
            <button className="service-more" aria-label={`更多操作 ${service.name}`} title="更多操作（也可右键）" aria-haspopup="menu" aria-expanded={menu?.id === service.id} onClick={(event) => openMenu(event, service)}><DotsThree size={19} weight="bold" /></button>
          </div>
        </article>;
      })}{!services.length ? <div className="service-empty"><Database size={28} /><strong>还没有服务</strong><p>选择本地文件夹并配置启动命令。</p><button className="button button--primary" onClick={onAdd}>添加服务</button></div> : null}</div>
      {selected ? <section className={`service-config${configOpen ? " service-config--open" : ""}`} aria-label="所选服务配置">
        <div className="service-config-title"><Database size={17} /><strong title={selected.name}>{selected.name}<span className="service-config-heading"> · 服务配置</span></strong><code className="service-config-summary" title={`${selected.folder}\n${selected.startCommand}`}>{selected.folder} · {selected.port ? `:${selected.port}` : "无端口"}</code>{mode !== "full" ? <button className="quiet-button service-config-expand" aria-expanded={configOpen} onClick={() => setExpanded((value) => !value)}>{configOpen ? "收起" : "展开"}<CaretDown size={12} /></button> : null}<button className="quiet-button service-config-edit" onClick={() => onEdit(selected)}>编辑配置</button></div>
        {configOpen ? <div className="service-config-fields"><span><small>服务目录</small><code title={selected.folder}><FolderSimple size={14} />{selected.folder || "示例待配置：请选择本机目录"}</code></span><span><small>启动命令</small><code title={selected.startCommand}>{selected.startCommand}</code></span><span><small>服务端口</small><code>{selected.port || "未设置"}</code></span></div> : null}
      </section> : null}
      {menu && menuService ? createPortal(<div className="service-action-menu" role="menu" aria-label={`${menuService.name} 操作`} ref={menuRef} style={{ left: menu.left, top: menu.top }}>
        <strong>{menuService.name}</strong>
        <button role="menuitem" onClick={() => { onSelect(menuService.id); closeMenu(); }}>查看日志</button>
        <button role="menuitem" disabled={["starting", "running", "stopping"].includes(menuService.status)} onClick={() => { onStart(menuService); closeMenu(); }}><Play size={14} />{canStartService(menuService) ? "启动" : "配置服务"}</button>
        <button role="menuitem" disabled={!["starting", "running"].includes(menuService.status)} onClick={() => { onStop(menuService); closeMenu(); }}><Stop size={14} />停止</button>
        <button role="menuitem" onClick={() => { onEdit(menuService); closeMenu(); }}>编辑</button>
        <button role="menuitem" className="service-menu-delete" onClick={() => { closeMenu(); removeService(menuService); }}><Trash size={14} />删除</button>
      </div>, document.body) : null}
    </main>
    <LogPanel logs={logs} services={services} selectedServiceId={selectedServiceId} onSelectService={onSelect} onClear={onClear} />
  </EnvironmentLayout></div>;
}
