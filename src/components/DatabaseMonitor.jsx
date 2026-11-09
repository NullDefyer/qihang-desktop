import { useEffect, useRef, useState } from "react";
import { remoteCall } from "../remote.js";
import { PersonalDialog } from "./PersonalDialog.jsx";
import { Metric, TrendChart, formatBytes, timeLabel } from "./MonitorChart.jsx";

function DatabaseForm({ profile, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ name: "", type: "mysql", host: "127.0.0.1", port: 3306, username: "", database: "", ...profile, password: "", rememberPassword: Boolean(profile?.hasSavedPassword) }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const field = (key, value) => setForm(current => ({ ...current, [key]: value }));
  return <PersonalDialog title={profile?.id ? "编辑数据库监控" : "添加数据库监控"} onClose={onClose}><form onSubmit={async event => { event.preventDefault(); setSaving(true); try { await onSave(form); } catch(error) { setError(error.message); } finally { setSaving(false); } }}>
    <label className="field-label"><span>连接名称</span><input aria-label="数据库连接名称" autoFocus required value={form.name} onChange={e => field("name", e.target.value)} /></label>
    <label className="field-label"><span>数据库类型</span><select aria-label="数据库类型" value={form.type} onChange={e => setForm(current => ({ ...current, type: e.target.value, port: e.target.value === "redis" ? 6379 : 3306 }))}><option value="mysql">MySQL / MariaDB</option><option value="redis">Redis</option></select></label>
    <div className="remote-form-grid"><label className="field-label"><span>SSH 服务器可访问的数据库地址</span><input aria-label="数据库地址" required value={form.host} onChange={e => field("host", e.target.value)} /></label><label className="field-label"><span>端口</span><input aria-label="数据库端口" type="number" required min="1" max="65535" value={form.port} onChange={e => field("port", Number(e.target.value))} /></label></div>
    <label className="field-label"><span>只读监控用户名{form.type === "redis" ? "（可选）" : ""}</span><input aria-label="数据库用户名" required={form.type === "mysql"} value={form.username} onChange={e => field("username", e.target.value)} /></label>
    {form.type === "mysql" ? <label className="field-label"><span>默认数据库（可选）</span><input aria-label="默认数据库" value={form.database} onChange={e => field("database", e.target.value)} /></label> : null}
    <label className="field-label"><span>密码（未保存时仅用于本次 SSH 会话）</span><input aria-label="数据库密码" autoComplete="new-password" type="password" value={form.password} placeholder={profile?.hasSavedPassword ? "留空使用已保存密码" : "无密码可留空"} onChange={e => field("password", e.target.value)} /></label>
    <label className="remote-check"><input type="checkbox" checked={form.rememberPassword} onChange={e => field("rememberPassword", e.target.checked)} />记住密码（当前 Windows 用户加密）</label>
    <p className="remote-help">通过已连接的 SSH 隧道访问，无需开放数据库公网端口。仅执行固定只读查询，不显示 SQL 内容；权限不足会明确标记。当前不支持要求独立 TLS 的数据库端点。</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}<div className="drawer-actions"><button type="button" className="button button--secondary" onClick={onClose}>取消</button><button disabled={saving} className="button button--primary">{saving ? "保存中…" : "保存监控"}</button></div>
  </form></PersonalDialog>;
}

export function DatabaseMonitor({ server, connected, active, paused, interval, results, setResults, onProfiles, visible }) {
  const profiles = server?.databases || [];
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [section, setSection] = useState("sessions");
  const [editor, setEditor] = useState(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState({});
  const passwords = useRef(new Map());
  const profile = profiles.find(item => item.id === selected) || profiles[0];
  const result = results[profile?.id];
  useEffect(() => { passwords.current.clear(); setSelected(""); setHistory({}); setError(""); setEditor(null); }, [server?.id]);
  useEffect(() => { if (!connected) passwords.current.clear(); }, [connected]);
  useEffect(() => {
    if (!server || !connected || !active || paused || !profiles.length) return undefined;
    let disposed = false, timer;
    async function collect() {
      // One database at a time bounds SSH forwarding and connection pressure.
      for (const item of profiles) {
        if (disposed) break;
        try {
          const value = await remoteCall("databaseMonitor", { serverId: server.id, id: item.id, password: passwords.current.get(item.id) });
          if (disposed) return;
          setResults(current => ({ ...current, [item.id]: { ...value, status: "connected", checkedAt: Date.now() } }));
          setHistory(current => ({ ...current, [item.id]: [...(current[item.id] || []), { at: value.at, connections: value.connections }].filter(point => point.at > Date.now() - 900000).slice(-180) }));
        } catch(error) {
          if (!disposed) setResults(current => ({ ...current, [item.id]: { ...current[item.id], status: "error", error: error.message, checkedAt: Date.now() } }));
        }
      }
      if (!disposed) timer = setTimeout(collect, interval * 1000);
    }
    collect(); return () => { disposed = true; clearTimeout(timer); };
  }, [server?.id, profiles, connected, active, paused, interval, revision, setResults]);
  const sessions = result?.sessions?.filter(row => Object.values(row).join(" ").toLowerCase().includes(sessionQuery.toLowerCase())) || [];
  return <div className="database-monitor" hidden={!visible}>
    <section className="monitor-panel database-sidebar"><header><h2>数据库监控</h2><button className="quiet-button" disabled={!server} onClick={() => setEditor({})}>＋ 添加</button></header><label className="monitor-search"><input aria-label="搜索数据库连接" placeholder="搜索连接…" value={query} onChange={e => setQuery(e.target.value)} /></label><div className="database-profile-list">{profiles.filter(item => item.name.toLowerCase().includes(query.toLowerCase())).map(item => <button key={item.id} className={item.id === profile?.id ? "selected" : ""} onClick={() => setSelected(item.id)}><strong>{item.type === "mysql" ? "MySQL" : "Redis"} · {item.name}</strong><small>{item.host}:{item.port} · SSH 隧道</small><span className={results[item.id]?.status === "error" ? "monitor-error-text" : ""}>{!connected ? "SSH 未连接" : results[item.id]?.status === "connected" ? "● 连接正常" : results[item.id]?.status === "error" ? "● 检测失败" : "尚未检测"}</span></button>)}</div><p className="remote-help">使用只读监控账号；仅在启航运行并连接时采集。</p></section>
    <section className="database-detail">
      {!profile ? <div className="monitor-panel monitor-empty">还没有数据库监控配置<button className="button button--primary" disabled={!server} onClick={() => setEditor({})}>添加数据库监控</button></div> : <>
        <header className="database-detail-heading"><h2>{profile.name}</h2><span>{profile.type.toUpperCase()} {result?.version || ""}</span><span>{result?.status === "connected" ? "● 连接正常" : "等待有效检测"}</span><div className="panel-spacer" /><button className="quiet-button" onClick={() => setEditor(profile)}>编辑监控 / 密码</button><button className="quiet-button" disabled={!connected || paused} onClick={() => setRevision(value => value + 1)}>立即检测</button><button className="quiet-button" onClick={async () => { if (!window.confirm(`删除数据库监控“${profile.name}”？不会删除数据库。`)) return; try { await remoteCall("databaseRemove", { serverId: server.id, id: profile.id }); passwords.current.delete(profile.id); onProfiles(profiles.filter(item => item.id !== profile.id)); } catch(error) { setError(error.message); } }}>删除</button></header>
        {result?.status === "error" ? <div className="remote-alert" role="alert">{result.error} · 最后检测 {timeLabel(result.checkedAt)}{result.at ? ` · 上次成功 ${timeLabel(result.at)}（下方为旧数据）` : ""}</div> : null}
        <div className="monitor-metrics"><Metric label="连接占用" value={`${result?.connections ?? "—"} / ${result?.maxConnections ?? "未知"}`} detail={result?.maxConnections > 0 && result?.connections != null ? `${(100 * result.connections / result.maxConnections).toFixed(1)}%` : "缺少权限时不显示为 0"} /><Metric label={profile.type === "mysql" ? "活跃连接" : "内存使用"} value={profile.type === "mysql" ? result?.active ?? "—" : formatBytes(result?.memoryUsed)} detail={profile.type === "mysql" ? "包含监控连接" : "来自 INFO used_memory"} /><Metric label={profile.type === "mysql" ? "空闲连接" : "每秒操作"} value={profile.type === "mysql" ? result?.idle ?? "—" : result?.operations ?? "—"} detail={profile.type === "mysql" ? "总连接减活跃线程" : "ops / s"} /><Metric label="查询响应" value={result?.latency == null ? "—" : `${result.latency} ms`} detail="SSH 隧道内查询耗时" /></div>
        <TrendChart title="连接数趋势" points={history[profile.id]} series={[{ key: "connections", label: "当前连接数", color: "var(--primary)" }]} ceiling={result?.maxConnections || 100} />
        <section className="monitor-panel database-sessions"><header><div className="monitor-subtabs"><button className={section === "sessions" ? "selected" : ""} onClick={() => setSection("sessions")}>会话列表</button>{profile.type === "mysql" ? <button className={section === "locks" ? "selected" : ""} onClick={() => setSection("locks")}>长事务与锁等待</button> : null}</div><input aria-label="搜索数据库会话" placeholder="搜索用户 / 来源 / 状态" value={sessionQuery} onChange={e => setSessionQuery(e.target.value)} /></header>
          {section === "sessions" || profile.type === "redis" ? result?.sessions == null ? <p className="monitor-empty">{result?.errors?.sessions || "等待检测会话信息"}</p> : <div className="monitor-table-scroll"><table><thead><tr>{["会话 ID", "用户", "来源", "状态 / 命令", "持续 / 空闲秒"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{sessions.map((row, index) => <tr key={index}><td>{row.ID}</td><td>{row.USER}</td><td>{row.HOST}</td><td>{row.COMMAND}</td><td>{row.TIME}</td></tr>)}</tbody></table>{!sessions.length ? <p className="monitor-empty">没有匹配的会话</p> : null}</div> : <div className="database-locks"><h3>进行中的事务</h3>{result?.transactions == null ? <p>{result?.errors?.transactions || "等待采样"}</p> : result.transactions.length ? <table><thead><tr><th>ID</th><th>线程</th><th>开始时间</th><th>状态</th></tr></thead><tbody>{result.transactions.map(row => <tr key={row.trx_id}><td>{row.trx_id}</td><td>{row.trx_mysql_thread_id}</td><td>{String(row.trx_started)}</td><td>{row.trx_state}</td></tr>)}</tbody></table> : <p>当前无进行中的事务</p>}<h3>锁等待</h3>{result?.locks == null ? <p>{result?.errors?.locks || "等待采样"}</p> : result.locks.length ? <table><thead><tr><th>库</th><th>表</th><th>锁类型</th></tr></thead><tbody>{result.locks.map((row, i) => <tr key={i}><td>{row.OBJECT_SCHEMA}</td><td>{row.OBJECT_NAME}</td><td>{row.LOCK_TYPE}</td></tr>)}</tbody></table> : <p>当前无锁等待</p>}</div>}
          <footer>SQL 内容不采集 · 最多显示 100 个会话 / 事务 / 锁 · 缺少权限或版本不支持时明确标记</footer>
        </section>
      </>}
      {error ? <p role="alert" className="form-error">{error}</p> : null}
    </section>
    {editor ? <DatabaseForm profile={editor} onClose={() => setEditor(null)} onSave={async form => { const value = await remoteCall("databaseSave", { serverId: server.id, profile: form }); if (form.password || !form.hasSavedPassword) passwords.current.set(value.id, form.password); onProfiles([...profiles.filter(item => item.id !== value.id), value]); setSelected(value.id); setHistory(current => ({ ...current, [value.id]: [] })); setEditor(null); setRevision(value => value + 1); }} /> : null}
  </div>;
}
