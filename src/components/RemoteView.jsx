import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Cloud, Cube, Plus, ArrowClockwise, MagnifyingGlass, X } from "@phosphor-icons/react";
import { createId } from "../model.js";
import { RemoteMonitor } from "./RemoteMonitor.jsx";
import { isDesktop } from "../desktop.js";
import { remoteApi, remoteCall } from "../remote.js";

const EMPTY_SERVER = { name: "", host: "", port: 22, username: "", auth: "password", privateKeyPath: "", useSudo: false };
const CONNECTION_LABELS = { disconnected: "未连接", connecting: "连接中…", connected: "已连接", error: "连接失败" };
const LOG_LABELS = { idle: "选择容器查看日志", loading: "正在订阅日志…", streaming: "正在接收新日志", paused: "已暂停接收，继续时重新读取最近日志", ended: "日志接收已结束", error: "日志接收失败" };

function ServerForm({ server, onClose, onSaved, reportError }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_SERVER, ...server, password: "", rememberPassword: Boolean(server?.hasSavedPassword) }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError("");
    try { onSaved(await remoteCall("save", form)); }
    catch (error) { setError(error.message); }
    finally { setSaving(false); }
  }
  return (
    <div className="remote-modal-backdrop" onKeyDown={(event) => { if (event.key === "Escape" && !saving) onClose(); }}>
      <section className="remote-modal" role="dialog" aria-modal="true" aria-labelledby="server-form-title">
        <div className="remote-modal-header"><h2 id="server-form-title">{server?.id ? "编辑服务器" : "添加服务器"}</h2><button className="quiet-icon" aria-label="关闭服务器配置" onClick={onClose} disabled={saving}><X /></button></div>
        <form onSubmit={submit}>
          <label className="field-label"><span>名称</span><input autoFocus required maxLength={80} value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：测试服务器" /></label>
          <div className="remote-form-grid">
            <label className="field-label"><span>服务器地址</span><input required value={form.host} onChange={(event) => update("host", event.target.value)} placeholder="IP 地址或域名" /></label>
            <label className="field-label"><span>SSH 端口</span><input required type="number" min="1" max="65535" value={form.port} onChange={(event) => update("port", event.target.value)} /></label>
          </div>
          <label className="field-label"><span>SSH 用户名</span><input required value={form.username} onChange={(event) => update("username", event.target.value)} placeholder="例如：deploy" autoComplete="off" /></label>
          <label className="field-label"><span>认证方式</span><select value={form.auth} onChange={(event) => update("auth", event.target.value)}><option value="password">密码认证</option><option value="key">SSH 私钥</option></select></label>
          {form.auth === "password" ? <div className="remote-password-settings">
            <label className="remote-check"><input type="checkbox" checked={form.rememberPassword} onChange={(event) => update("rememberPassword", event.target.checked)} />记住密码（本机加密保存）</label>
            {form.rememberPassword ? <label className="field-label"><span>SSH 密码</span><input type="password" autoComplete="new-password" required={!server?.hasSavedPassword} value={form.password} onChange={(event) => update("password", event.target.value)} placeholder={server?.hasSavedPassword ? "已保存密码，留空保持原密码" : "输入要保存的密码"} /></label> : null}
          </div> : null}
          {form.auth === "key" ? <label className="field-label"><span>私钥文件</span><div className="folder-field"><input required value={form.privateKeyPath} onChange={(event) => update("privateKeyPath", event.target.value)} placeholder="选择本机私钥文件" /><button type="button" onClick={async () => { try { const value = await remoteCall("chooseKey"); if (value) update("privateKeyPath", value); } catch (error) { reportError(error.message); } }}>选择文件</button></div></label> : null}
          <label className="remote-check"><input type="checkbox" checked={form.useSudo} onChange={(event) => update("useSudo", event.target.checked)} />通过免密 sudo 访问 Docker</label>
          <p className="remote-help">{form.auth === "password" ? form.rememberPassword ? "密码使用当前 Windows 用户的加密能力保存，不会在界面回显。" : "不保存密码，每次连接时输入；保存配置后将清除已有密码。" : "私钥口令只用于本次连接，不会保存。"}</p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="drawer-actions"><button type="button" className="button button--secondary" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="button button--primary" disabled={saving}>{saving ? "保存中…" : "保存配置"}</button></div>
        </form>
      </section>
    </div>
  );
}

export function RemoteView({ active }) {
  const [servers, setServers] = useState([]);
  const [tab, setTab] = useState("overview");
  const [interval, setIntervalSeconds] = useState(5);
  const [paused, setPaused] = useState(false);
  const [hostSummary, setHostSummary] = useState(null);
  const [serverId, setServerId] = useState("");
  const [connection, setConnection] = useState("disconnected");
  const [containers, setContainers] = useState([]);
  const [containerId, setContainerId] = useState("");
  const [containerQuery, setContainerQuery] = useState("");
  const [entries, setEntries] = useState([]);
  const [phase, setPhase] = useState("idle");
  const [tail, setTail] = useState(500);
  const [query, setQuery] = useState("");
  const [output, setOutput] = useState("all");
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [rememberPassword, setRememberPassword] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [paneWidth, setPaneWidth] = useState(340);
  const selectedServerRef = useRef("");
  const streamIdRef = useRef(null);
  const queueRef = useRef([]);
  const consoleRef = useRef(null);
  const layoutRef = useRef(null);
  const draggingRef = useRef(false);
  const requestRef = useRef(0);
  const connectAttemptRef = useRef(0);
  const server = servers.find((item) => item.id === serverId);
  const container = containers.find((item) => item.id === containerId);
  const deferredQuery = useDeferredValue(query.toLowerCase());
  const visibleEntries = useMemo(() => entries.filter((entry) => (output === "all" || output === entry.stream) && (!deferredQuery || entry.message.toLowerCase().includes(deferredQuery))), [entries, output, deferredQuery]);
  const filteredContainers = containers.filter((item) => `${item.name} ${item.image}`.toLowerCase().includes(containerQuery.toLowerCase()));

  useEffect(() => {
    let active = true;
    remoteCall("snapshot").then((value) => {
      if (!active) return;
      setServers(value.servers);
      const selected = value.connection?.serverId || value.servers[0]?.id || "";
      selectedServerRef.current = selected;
      setServerId(selected);
      setConnection(value.connection?.status || "disconnected");
    }).catch((error) => { if (active) setError(error.message); });
    const remove = remoteApi?.onEvent((event) => {
      if (event.serverId !== selectedServerRef.current) return;
      if (event.type === "connection") {
        setConnection(event.status);
        if (event.status === "error" || event.status === "disconnected") {
          streamIdRef.current = null;
          setPhase("idle");
        }
        if (event.message) setError(event.message);
      } else if (event.streamId === streamIdRef.current) {
        if (event.type === "log") {
          queueRef.current.push({ ...event, id: createId("remote-entry") });
          if (queueRef.current.length > 2000) queueRef.current.splice(0, queueRef.current.length - 2000);
        }
        if (event.type === "log-state") { setPhase(event.status); if (event.status === "error") setError(event.message); }
      }
    });
    // Batch bursts of remote output so a busy container does not render per line.
    const timer = setInterval(() => {
      if (!queueRef.current.length) return;
      const batch = queueRef.current.splice(0);
      setEntries((current) => [...current, ...batch].slice(-2000));
    }, 100);
    return () => { active = false; remove?.(); clearInterval(timer); };
  }, []);

  useLayoutEffect(() => {
    if (active && tab === "logs" && follow && consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [visibleEntries, follow, wrap, active, tab]);

  useEffect(() => { setHostSummary(null); }, [serverId, connection]);

  function resetLogs() {
    streamIdRef.current = null;
    queueRef.current = [];
    setEntries([]); setPhase("idle");
  }

  async function refreshContainers(id = serverId) {
    const request = ++requestRef.current;
    setRefreshing(true); setError("");
    try {
      const result = await remoteCall("containers", id);
      if (selectedServerRef.current !== id || request !== requestRef.current) return;
      setContainers(result);
      if (containerId && !result.some((item) => item.id === containerId)) { await remoteCall("pause"); setContainerId(""); resetLogs(); }
    } catch (error) { if (selectedServerRef.current === id && request === requestRef.current) setError(error.message); }
    finally { if (request === requestRef.current) setRefreshing(false); }
  }

  async function disconnect() {
    connectAttemptRef.current += 1;
    requestRef.current += 1;
    setRefreshing(false);
    try { await remoteCall("disconnect"); setConnection("disconnected"); setContainers([]); setContainerId(""); resetLogs(); }
    catch (error) { setError(error.message); }
  }

  async function selectServer(id) {
    await disconnect();
    requestRef.current += 1;
    setRefreshing(false);
    selectedServerRef.current = id;
    setServerId(id); setError(""); setNotice(""); setSecret("");
  }

  async function connect(event) {
    event.preventDefault();
    const id = serverId;
    const attempt = ++connectAttemptRef.current;
    setLoginOpen(false); setError(""); setConnection("connecting"); resetLogs();
    const credentials = server.auth === "key" ? { passphrase: secret } : { password: secret, rememberPassword };
    setSecret("");
    try {
      const result = await remoteCall("connect", { id, credentials });
      if (selectedServerRef.current === id && attempt === connectAttemptRef.current) {
        setServers((current) => current.map((item) => item.id === id ? { ...item, hasSavedPassword: Boolean(result.hasSavedPassword) } : item));
        await refreshContainers(id);
      }
    }
    catch (error) {
      if (selectedServerRef.current === id && attempt === connectAttemptRef.current) {
        setConnection("error"); setError(error.message);
        try {
          const snapshot = await remoteCall("snapshot");
          if (selectedServerRef.current === id && attempt === connectAttemptRef.current) setServers(snapshot.servers);
        } catch { /* Keep the connection error if refreshing metadata also fails. */ }
      }
    }
  }

  async function receiveLogs(id, count = tail) {
    setTab("logs");
    const streamId = createId("remote-log");
    resetLogs();
    streamIdRef.current = streamId;
    setContainerId(id); setPhase("loading"); setError(""); setNotice(""); setFollow(true);
    try {
      await remoteCall("follow", { serverId, containerId: id, tail: count, streamId });
      if (streamIdRef.current === streamId) setPhase((value) => value === "loading" ? "streaming" : value);
    } catch (error) { if (streamIdRef.current === streamId) { setPhase("error"); setError(error.message); } }
  }

  async function pauseLogs() {
    streamIdRef.current = null;
    try { await remoteCall("pause"); setPhase("paused"); }
    catch (error) { setError(error.message); }
  }

  async function saveServer(value) {
    setServers((current) => [...current.filter((item) => item.id !== value.id), value]);
    await selectServer(value.id);
    setEditor(null);
    setNotice("配置已保存，点击连接服务器开始查看容器。");
  }

  async function removeServer() {
    if (!window.confirm(`删除服务器配置“${server.name}”？此操作不会删除远程容器。`)) return;
    try {
      await remoteCall("remove", serverId);
      const remaining = servers.filter((item) => item.id !== serverId);
      setServers(remaining); await selectServer(remaining[0]?.id || "");
    } catch (error) { setError(error.message); }
  }

  const renderedText = visibleEntries.map((entry) => entry.message).join("\n");
  return (
    <div className="remote-page">
      <div className="remote-heading"><div><span className="section-label">远程环境</span><h1>远程监控</h1><p>通过 SSH 连接服务器，实时查看 Docker 容器日志。</p></div><button className="button button--primary" onClick={() => setEditor({})}><Plus size={18} />添加服务器</button></div>
      {!isDesktop ? <div className="remote-notice">浏览器演示模式：容器和日志均为模拟数据，真实 SSH 连接请使用桌面版。</div> : null}
      {error ? <div className="remote-alert" role="alert">{error}<button aria-label="关闭错误提示" onClick={() => setError("")}><X /></button></div> : null}
      {notice ? <div className="remote-notice" role="status">{notice}</div> : null}
      <div className="remote-connection-bar">
        <select aria-label="选择远程服务器" value={serverId} disabled={connection === "connecting"} onChange={(event) => selectServer(event.target.value)}>{!servers.length ? <option value="">尚未添加服务器</option> : servers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        {server ? <><span className="remote-address">{server.username}@{server.host}:{server.port}</span><span className={`remote-connection-state remote-connection-state--${connection}`}>● {CONNECTION_LABELS[connection]}</span>
          {connection === "connected" || connection === "connecting" ? <button className="button button--secondary" onClick={disconnect}>{connection === "connecting" ? "取消连接" : "断开连接"}</button> : <button className="button button--primary" onClick={() => { setSecret(""); setRememberPassword(Boolean(server.hasSavedPassword)); setLoginOpen(true); }}>连接服务器</button>}
          <button className="quiet-button" disabled={connection === "connecting"} onClick={() => setEditor(server)}>编辑连接</button><button className="quiet-button" disabled={connection === "connecting"} onClick={removeServer}>删除配置</button></> : null}
        <div className="remote-monitor-toolbar"><span>{hostSummary ? `${hostSummary.os} · ${hostSummary.cores ?? "—"} 核` : "服务器资源通过 SSH 只读采集"}</span><div className="panel-spacer" /><label>采集间隔 <select aria-label="监控采集间隔" value={interval} onChange={event => setIntervalSeconds(Number(event.target.value))}>{[5, 10, 30, 60].map(value => <option key={value} value={value}>{value} 秒</option>)}</select></label><button className="button button--secondary" disabled={connection !== "connected"} onClick={() => setPaused(value => !value)}>{paused ? "继续采集" : "暂停采集"}</button></div>
      </div>

      <div className="remote-monitor-tabs" role="tablist" aria-label="远程监控页面">{[["overview", "概览"], ["containers", "容器"], ["databases", "数据库"], ["logs", "日志"]].map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} aria-label={`远程${label}`} onClick={() => setTab(id)}>{label}</button>)}</div>
      <RemoteMonitor tab={tab} setTab={setTab} server={server} connection={connection} active={active} interval={interval} paused={paused} containers={containers} setContainers={setContainers} onLogs={receiveLogs} onHost={setHostSummary} onServerChange={(profiles, settings) => setServers(current => current.map(item => item.id === serverId ? { ...item, ...(profiles ? { databases: profiles } : {}), ...(settings ? { monitorSettings: settings } : {}) } : item))} />
      <div className="remote-layout" hidden={tab !== "logs"} ref={layoutRef} style={{ "--remote-list-width": `${paneWidth}px` }}>
        <section className="remote-container-panel">
          <header><div><h2>容器列表</h2><span>{containers.length} 个容器 · {containers.filter((item) => item.state === "running").length} 个运行中</span></div><button className="quiet-icon" title="刷新容器" aria-label="刷新容器" disabled={connection !== "connected" || refreshing} onClick={() => refreshContainers()}><ArrowClockwise size={19} /></button></header>
          <label className="search-field remote-container-search"><MagnifyingGlass size={17} /><input aria-label="搜索容器" value={containerQuery} onChange={(event) => setContainerQuery(event.target.value)} placeholder="搜索容器名称…" /></label>
          <div className="remote-container-list">
            {filteredContainers.map((item) => <button className={`remote-container-item${item.id === containerId ? " remote-container-item--selected" : ""}`} key={item.id} disabled={connection !== "connected"} onClick={() => receiveLogs(item.id)}><Cube size={29} /><div><strong title={item.name}>{item.name}</strong><span title={item.image}>{item.image}</span><small title={item.ports}>{item.ports || item.status}</small></div><span className={item.state === "running" ? "remote-state-running" : "remote-state-stopped"}>{item.state === "running" ? "● 运行中" : item.state === "exited" ? "● 已停止" : item.state}</span></button>)}
            {!filteredContainers.length ? <div className="remote-empty"><Cloud size={30} /><strong>{refreshing ? "正在读取容器…" : connection === "connected" ? "没有匹配的容器" : "连接服务器后查看容器"}</strong><p>{servers.length ? "选择服务器并连接，即可读取容器列表。" : "先添加一台服务器的 SSH 连接配置。"}</p></div> : null}
          </div>
        </section>
        <div className="pane-divider remote-divider" role="separator" aria-label="调整容器列表宽度" aria-orientation="vertical" aria-valuemin={260} aria-valuemax={560} aria-valuenow={paneWidth} tabIndex={0} title="左右拖动调整宽度，双击恢复" onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); draggingRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!draggingRef.current) return; const bounds = layoutRef.current.getBoundingClientRect(); setPaneWidth(Math.max(260, Math.min(560, bounds.width - 428, event.clientX - bounds.left))); }} onPointerUp={(event) => { draggingRef.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { draggingRef.current = false; }} onLostPointerCapture={() => { draggingRef.current = false; }} onDoubleClick={() => setPaneWidth(340)} onKeyDown={(event) => { if (event.key === "Home") { event.preventDefault(); setPaneWidth(340); } else if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); setPaneWidth((value) => Math.max(260, Math.min(560, value + (event.key === "ArrowLeft" ? -24 : 24)))); } }} />
        <section className="remote-log-panel">
          <header><h2>实时日志</h2>{container ? <span className="remote-container-chip" title={container.name}><Cube size={17} />{container.name}</span> : null}<span className={`remote-connection-state remote-connection-state--${connection}`}>{connection === "connected" ? "● SSH 已连接" : CONNECTION_LABELS[connection]}</span></header>
          <div className="remote-log-filters"><select aria-label="读取最近日志行数" value={tail} onChange={(event) => { const count = Number(event.target.value); setTail(count); if (containerId && connection === "connected") receiveLogs(containerId, count); }}>{[100, 500, 1000].map((value) => <option key={value} value={value}>最近 {value} 行</option>)}</select><select aria-label="筛选日志输出" value={output} onChange={(event) => setOutput(event.target.value)}><option value="all">全部输出</option><option value="stdout">标准输出</option><option value="stderr">错误输出</option></select><label className="search-field"><MagnifyingGlass size={17} /><input aria-label="搜索远程日志" placeholder="搜索日志内容…" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
          <div className="remote-log-controls"><label className="remote-check"><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />自动跟随</label><label className="remote-check"><input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} />自动换行</label><span className="panel-spacer" />{phase === "streaming" || phase === "loading" ? <button className="button button--secondary" onClick={pauseLogs}>暂停接收</button> : <button className="button button--secondary" disabled={!containerId || connection !== "connected"} onClick={() => receiveLogs(containerId)}>重新接收</button>}<button className="button button--secondary" disabled={!visibleEntries.length} onClick={async () => { try { await navigator.clipboard.writeText(renderedText); setNotice("已复制当前筛选的日志。"); } catch { setError("复制失败，请检查剪贴板权限。"); } }}>复制</button><button className="button button--secondary" disabled={!visibleEntries.length} onClick={async () => { try { if (await remoteCall("export", { text: renderedText, name: container?.name })) setNotice("日志已导出。"); } catch (error) { setError(error.message); } }}>导出</button></div>
          <div className={`remote-console${wrap ? " remote-console--wrap" : ""}`} ref={consoleRef} role="log" aria-label="远程容器日志" tabIndex={0} onScroll={(event) => { if (tab !== "logs") return; const element = event.currentTarget; const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 24; if (follow !== atBottom) setFollow(atBottom); }}>
            {visibleEntries.length ? visibleEntries.map((entry) => <div className={`remote-log-line${entry.stream === "stderr" ? " remote-log-line--stderr" : ""}`} key={entry.id}>{entry.message}</div>) : <div className="remote-empty"><Cube size={34} /><strong>{container ? phase === "loading" ? "正在读取日志…" : "暂无匹配的日志" : "选择一个容器开始查看日志"}</strong><p>支持实时跟随、关键词过滤和横向滚动。</p></div>}
          </div>
          <footer><span>{connection === "connected" ? LOG_LABELS[phase] : "等待连接服务器"}</span><span>显示 {visibleEntries.length} / {entries.length} 行 · 最多保留 2000 行</span></footer>
        </section>
      </div>
      {editor ? <ServerForm server={editor} onClose={() => setEditor(null)} onSaved={saveServer} reportError={setError} /> : null}
      {loginOpen && server ? <div className="remote-modal-backdrop" onKeyDown={(event) => { if (event.key === "Escape") { setLoginOpen(false); setSecret(""); } }}><section className="remote-modal remote-login" role="dialog" aria-modal="true" aria-labelledby="remote-login-title"><div className="remote-modal-header"><h2 id="remote-login-title">连接 {server.name}</h2><button className="quiet-icon" aria-label="关闭连接窗口" onClick={() => { setLoginOpen(false); setSecret(""); }}><X /></button></div><p className="remote-help">{server.username}@{server.host}:{server.port}</p><form onSubmit={connect}><label className="field-label"><span>{server.auth === "key" ? "私钥口令（无口令可留空）" : "SSH 密码"}</span><input autoFocus type="password" autoComplete="off" required={server.auth !== "key" && isDesktop && !server.hasSavedPassword} placeholder={server.hasSavedPassword ? "已保存密码，留空直接使用" : ""} value={secret} onChange={(event) => setSecret(event.target.value)} /></label>{server.auth === "password" ? <label className="remote-check"><input type="checkbox" checked={rememberPassword} onChange={(event) => setRememberPassword(event.target.checked)} />记住密码（本机加密保存）</label> : null}<p className="remote-help">{server.auth === "key" ? "私钥口令不会保存。" : rememberPassword ? "下次连接无需重复输入密码；首次连接仍需核对服务器指纹。" : "密码仅用于本次连接；取消勾选会清除已保存的密码。"}</p><div className="drawer-actions"><button className="button button--primary" type="submit">连接</button></div></form></section></div> : null}
    </div>
  );
}
