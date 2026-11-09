import { useEffect, useRef, useState } from "react";
import { remoteCall } from "../remote.js";
import { PersonalDialog } from "./PersonalDialog.jsx";
import { DatabaseMonitor } from "./DatabaseMonitor.jsx";
import { Metric, TrendChart, formatBytes, percent, timeLabel } from "./MonitorChart.jsx";

const HOST_SERIES = [{ key: "cpuPercent", label: "CPU %", color: "var(--primary)" }, { key: "memoryPercent", label: "内存 %", color: "var(--success)" }];
const CPU_SERIES = [{ key: "cpuPercent", label: "Docker CPU %（多核可超过 100%）", color: "var(--primary)" }];

export function RemoteMonitor({ tab, setTab, server, connection, active, interval, paused, containers, setContainers, onLogs, onHost, onServerChange }) {
  const [host, setHost] = useState(null);
  const [points, setPoints] = useState([]);
  const [stats, setStats] = useState([]);
  const [statsHistory, setStatsHistory] = useState({});
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [hostError, setHostError] = useState("");
  const [dockerError, setDockerError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [dbResults, setDbResults] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [settingsError, setSettingsError] = useState("");
  const [revision, setRevision] = useState(0);
  const alertsSince = useRef({});
  const connected = connection === "connected";
  const selected = containers.find(item => item.id === selectedId) || containers[0];
  const selectedStats = stats.find(item => selected && (selected.id.startsWith(item.id) || item.id?.startsWith(selected.id)));
  const config = server?.monitorSettings || { cpu: 90, memory: 85, disk: 85, seconds: 60 };
  useEffect(() => { setHost(null); setPoints([]); setStats([]); setStatsHistory({}); setDetail(null); setDbResults({}); setAlerts([]); alertsSince.current = {}; setSelectedId(""); setHostError(""); setDockerError(""); }, [server?.id, connected]);
  useEffect(() => {
    if (!server || !connected || paused) { alertsSince.current = {}; setAlerts([]); return undefined; }
    let disposed = false, timer;
    async function collect() {
      const results = await Promise.allSettled([remoteCall("monitor", server.id), remoteCall("stats", server.id), remoteCall("containers", server.id)]);
      if (disposed) return;
      const [machine, docker, list] = results;
      if (machine.status === "fulfilled") {
        const value = machine.value;
        setHost(value); onHost(value); setHostError("");
        setPoints(current => [...current, value].filter(item => item.at > Date.now() - 900000).slice(-180));
        const warnings = [];
        for (const [key, label, field] of [["cpu", "CPU", "cpuPercent"], ["memory", "内存", "memoryPercent"], ["disk", "磁盘", "diskPercent"]]) {
          if (value[field] != null && value[field] >= config[key]) {
            alertsSince.current[key] ??= value.at;
            if (value.at - alertsSince.current[key] >= config.seconds * 1000) warnings.push({ key, label, value: value[field], since: alertsSince.current[key], limit: config[key] });
          } else delete alertsSince.current[key];
        }
        setAlerts(warnings);
      } else { setHostError(machine.reason.message); alertsSince.current = {}; setAlerts([]); setPoints(current => [...current, { at: Date.now(), cpuPercent: null, memoryPercent: null }].slice(-180)); }
      if (docker.status === "fulfilled") {
        setStats(docker.value); setDockerError("");
        setStatsHistory(current => { const next = { ...current }; for (const item of docker.value) next[item.name] = [...(next[item.name] || []), { at: Date.now(), cpuPercent: item.cpuPercent }].filter(point => point.at > Date.now() - 900000).slice(-180); return next; });
      } else { setDockerError(docker.reason.message); setStats([]); }
      if (list.status === "fulfilled") setContainers(list.value);
      else setDockerError(list.reason.message);
      timer = setTimeout(collect, interval * 1000);
    }
    collect(); return () => { disposed = true; clearTimeout(timer); };
  }, [server?.id, connected, interval, paused, revision, config.cpu, config.memory, config.disk, config.seconds, onHost, setContainers]);
  useEffect(() => {
    let disposed = false;
    setDetail(null); setDetailError("");
    if (connected && active && tab === "containers" && selected) remoteCall("detail", { serverId: server.id, containerId: selected.id }).then(value => { if (!disposed) setDetail(value); }).catch(error => { if (!disposed) setDetailError(error.message); });
    return () => { disposed = true; };
  }, [server?.id, connected, active, tab, selected?.id, revision]);
  const filtered = containers.filter(item => (status === "all" || (status === "running" ? item.state === "running" : item.state !== "running")) && `${item.name} ${item.image}`.toLowerCase().includes(query.toLowerCase()));
  function containerRows(items) {
    return items.map(item => { const sample = stats.find(row => item.id.startsWith(row.id) || row.id?.startsWith(item.id)); return <tr key={item.id} className={tab === "containers" && item.id === selected?.id ? "selected" : ""}><td><button className="container-name" onClick={() => { setSelectedId(item.id); setTab("containers"); }}><strong>{item.name}</strong><small>{item.image}</small></button></td><td><span className={item.state === "running" ? "monitor-ok-text" : ""}>{item.state === "running" ? "● 运行中" : item.state === "exited" ? "● 已停止" : item.state}</span></td><td>{item.state === "running" ? percent(sample?.cpuPercent) : "—"}</td><td>{item.state === "running" ? sample?.memory || "—" : "—"}</td><td><button className="quiet-button" disabled={!connected} onClick={() => onLogs(item.id)}>日志</button></td></tr>; });
  }
  return <div className="monitor-area" hidden={tab === "logs"}>
    {tab === "overview" ? <div className="monitor-overview monitor-tab-content">
      <div className="monitor-metrics"><Metric label="CPU" value={percent(host?.cpuPercent)} detail={host?.cpuPercent == null ? "首次需两次有效采样" : `${host.cores ?? "—"} 核 · 负载 ${host.load?.join(" / ") || "未知"}`} /><Metric label="内存" value={percent(host?.memoryPercent)} detail={`${formatBytes(host?.memoryUsed)} / ${formatBytes(host?.memoryTotal)}`} /><Metric label="磁盘（/）" value={percent(host?.diskPercent)} warning={host?.diskPercent >= config.disk} detail={`${formatBytes(host?.diskUsed)} / ${formatBytes(host?.diskTotal)}`} /><Metric label="网络（非 loopback 接口合计）" value={`↓ ${formatBytes(host?.receiveRate)}/s`} detail={`↑ ${formatBytes(host?.sendRate)}/s · ${host?.interfaces?.join(", ") || "等待采样"}`} /></div>
      {hostError ? <div className="remote-alert" role="alert">{hostError}{host ? ` · 上次成功 ${timeLabel(host.at)}，上方为旧数据` : ""}</div> : null}
      <div className="monitor-overview-middle"><TrendChart title="资源趋势" points={points} series={HOST_SERIES} /><section className="monitor-panel monitor-alerts"><header><h2>监控提醒</h2><button className="quiet-button" disabled={!server} onClick={() => { setSettings({ ...config }); setSettingsError(""); }}>告警设置</button></header><div>{!alerts.length ? <p className="monitor-empty">{!connected ? "连接服务器后开始采集" : hostError ? "采集中断，无法判断当前阈值" : paused ? "采集已暂停" : "暂未达到持续告警条件"}</p> : alerts.map(item => <article key={item.key}><strong>{item.label}使用率持续偏高</strong><p>{percent(item.value)} ≥ {item.limit}% · 自 {timeLabel(item.since)} 起</p></article>)}</div><footer>仅在启航运行、SSH 连接且采集开启时判断；暂停或断线后重新计时。</footer></section></div>
      <div className="monitor-overview-bottom"><section className="monitor-panel"><header><h2>Docker 容器</h2><button className="quiet-button" onClick={() => setTab("containers")}>查看全部 →</button></header>{dockerError ? <p className="monitor-error-text">{dockerError}</p> : null}<div className="monitor-table-scroll"><table><thead><tr>{["容器", "状态", "CPU", "内存", "操作"].map(item => <th key={item}>{item}</th>)}</tr></thead><tbody>{containerRows(containers.slice(0, 4))}</tbody></table>{!containers.length ? <p className="monitor-empty">{connected ? "暂无容器数据" : "等待 SSH 连接"}</p> : null}</div></section><section className="monitor-panel database-summary"><header><h2>数据库连接</h2><button className="quiet-button" onClick={() => setTab("databases")}>添加 / 查看</button></header><div>{(server?.databases || []).map(item => <button key={item.id} onClick={() => setTab("databases")}><strong>{item.type.toUpperCase()} · {item.name}</strong><span>{dbResults[item.id]?.status === "connected" ? `● 正常 · ${dbResults[item.id].latency} ms` : dbResults[item.id]?.status === "error" ? "检测失败" : "待检测"}</span><small>连接 {dbResults[item.id]?.connections ?? "—"} / {dbResults[item.id]?.maxConnections ?? "未知"}</small></button>)}{!server?.databases?.length ? <p className="monitor-empty">尚未添加数据库监控</p> : null}</div><footer>通过 SSH 隧道 · 固定只读查询</footer></section></div>
    </div> : null}
    {tab === "containers" ? <div className="monitor-container-page monitor-tab-content"><div className="monitor-container-toolbar"><strong>全部 {containers.length}</strong><span className="monitor-ok-text">运行中 {containers.filter(item => item.state === "running").length}</span><span>已停止 / 其他 {containers.filter(item => item.state !== "running").length}</span><div className="panel-spacer" /><input aria-label="筛选监控容器" placeholder="搜索容器名称或镜像" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="监控容器状态" value={status} onChange={e => setStatus(e.target.value)}><option value="all">全部状态</option><option value="running">运行中</option><option value="stopped">已停止 / 其他</option></select><button className="quiet-button" disabled={!connected || paused} onClick={() => setRevision(value => value + 1)}>刷新</button></div>{dockerError ? <div role="alert" className="remote-alert">{dockerError}</div> : null}<div className="monitor-container-split"><section className="monitor-panel"><div className="monitor-table-scroll"><table><thead><tr>{["容器", "状态", "CPU", "内存", "操作"].map(item => <th key={item}>{item}</th>)}</tr></thead><tbody>{containerRows(filtered)}</tbody></table>{!filtered.length ? <p className="monitor-empty">没有匹配的容器</p> : null}</div></section><section className="monitor-container-detail">{selected ? <><header><h2>{selected.name}</h2><span>{selected.state === "running" ? "● 运行中" : selected.state}</span><button className="quiet-button" disabled={!connected} onClick={() => onLogs(selected.id)}>查看日志</button></header><section className="monitor-panel container-metadata"><span>容器 ID<code>{selected.id}</code></span><span>镜像<code>{selected.image}</code></span><span>端口<code>{selected.ports || "未发布"}</code></span><span>重启次数<code>{detail?.restartCount ?? "—"}</code></span><span>已运行<code>{selected.state === "running" && detail?.startedAt && Date.now() >= Date.parse(detail.startedAt) ? `${Math.floor((Date.now() - Date.parse(detail.startedAt)) / 86400000)} 天 ${Math.floor((Date.now() - Date.parse(detail.startedAt)) / 3600000) % 24} 小时` : "—"}</code></span><span>启动时间<code>{detail?.startedAt && !detail.startedAt.startsWith("0001") ? new Date(detail.startedAt).toLocaleString("zh-CN") : "—"}</code></span></section>{detailError ? <p className="monitor-error-text">{detailError}</p> : null}<div className="monitor-metrics monitor-metrics--two"><Metric label="CPU" value={percent(selectedStats?.cpuPercent)} detail="Docker 口径，多核可超过 100%" /><Metric label="内存" value={selectedStats?.memory || "—"} detail={`${percent(selectedStats?.memoryPercent)} · 配置上限 ${detail?.memoryLimit > 0 ? formatBytes(detail.memoryLimit) : "未限制 / 未知"}`} /></div><TrendChart title="CPU 趋势" points={statsHistory[selected.name]} series={CPU_SERIES} ceiling={100} /><section className="monitor-panel container-io"><p>网络累计（收 / 发） <strong>{selectedStats?.network || "—"}</strong></p><p>磁盘累计（读 / 写） <strong>{selectedStats?.blockIO || "—"}</strong></p></section></> : <div className="monitor-panel monitor-empty">连接服务器后选择容器查看资源详情</div>}</section></div></div> : null}
    <DatabaseMonitor visible={tab === "databases"} server={server} connected={connected} active={connected} paused={paused} interval={interval} results={dbResults} setResults={setDbResults} onProfiles={profiles => { onServerChange(profiles); setDbResults({}); }} />
    <footer className="monitor-footer"><span>{connected ? paused ? "采集已暂停" : "● SSH 已连接" : "SSH 未连接"} · {host?.os || "等待服务器信息"}</span><span>{hostError ? "采集异常" : "最后成功采集"} {timeLabel(host?.at)} · Docker 数据失败时不显示为 0</span></footer>
    {settings ? <PersonalDialog title="资源告警设置" onClose={() => setSettings(null)}><form onSubmit={async event => { event.preventDefault(); try { const value = await remoteCall("monitorSettings", { serverId: server.id, settings }); onServerChange(undefined, value); alertsSince.current = {}; setSettings(null); } catch(error) { setSettingsError(error.message); } }}>{[["cpu", "CPU 阈值 %"], ["memory", "内存阈值 %"], ["disk", "磁盘阈值 %"], ["seconds", "持续时间（秒）"]].map(([key, label]) => <label className="field-label" key={key}><span>{label}</span><input aria-label={label} type="number" required min={key === "seconds" ? 0 : 1} max={key === "seconds" ? 3600 : 100} value={settings[key]} onChange={e => setSettings(current => ({ ...current, [key]: Number(e.target.value) }))} /></label>)}<p className="remote-help">满足持续时间后在概览显示提醒；仅统计本次连接中的连续有效采样，不提供离线监控。</p>{settingsError ? <p role="alert" className="form-error">{settingsError}</p> : null}<div className="drawer-actions"><button className="button button--primary">保存设置</button></div></form></PersonalDialog> : null}
  </div>;
}
