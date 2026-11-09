import { Copy, DownloadSimple, MagnifyingGlass, Trash } from "@phosphor-icons/react";
import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import { personalCall } from "../personal.js";
import { isDesktop } from "../desktop.js";

export function LogPanel({ logs, services, selectedServiceId, onSelectService, onClear }) {
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [notice, setNotice] = useState("");
  const consoleRef = useRef(null);
  const followTailRef = useRef(true);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const visibleLogs = useMemo(() => logs.filter((entry) => (selectedServiceId === "all" || entry.serviceId === selectedServiceId) && (!deferredQuery || entry.message.toLowerCase().includes(deferredQuery))), [deferredQuery, logs, selectedServiceId]);
  useLayoutEffect(() => { followTailRef.current = true; setFollow(true); }, [deferredQuery, selectedServiceId]);
  useLayoutEffect(() => { if (consoleRef.current && followTailRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight; }, [visibleLogs, follow, wrap]);
  const selected = services.find((item) => item.id === selectedServiceId);
  async function share(exportFile) {
    const text = visibleLogs.map((entry) => `${new Date(entry.timestamp).toLocaleString("zh-CN")} [${entry.stream}] ${entry.message}`).join("\n");
    try {
      if (!exportFile) { await navigator.clipboard.writeText(text); setNotice("已复制筛选日志"); return; }
      if (isDesktop) { if (await personalCall("export-local-logs", text)) setNotice("已导出筛选日志"); return; }
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = "qihang-local-logs.txt"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setNotice(error.message || "操作失败，请重试。"); }
  }
  return <section className="log-panel">
    <div className="panel-tabs"><strong className="console-panel-title">{selected?.name ? `${selected.name} · ` : ""}启动日志</strong><span className="panel-spacer" /><button className="quiet-icon" aria-label="复制本地日志" title="复制筛选日志" disabled={!visibleLogs.length} onClick={() => share(false)}><Copy size={16} /></button><button className="quiet-icon" aria-label="导出本地日志" title="导出筛选日志" disabled={!visibleLogs.length} onClick={() => share(true)}><DownloadSimple size={16} /></button><small>{visibleLogs.length} 行</small></div>
    <div className="log-toolbar"><select aria-label="筛选服务" value={selectedServiceId} onChange={(event) => onSelectService(event.target.value)}><option value="all">全部服务</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select><label className="search-field"><MagnifyingGlass size={16} /><input aria-label="搜索本地日志" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索日志内容…" /></label><label className="remote-check"><input type="checkbox" checked={follow} onChange={(event) => { followTailRef.current = event.target.checked; setFollow(event.target.checked); }} />自动跟随</label><label className="remote-check"><input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} />换行</label><button className="quiet-icon" type="button" title="清空日志" onClick={onClear}><Trash size={16} /></button></div>
    <div className={`log-console${wrap ? " log-console--wrap" : ""}`} ref={consoleRef} role="log" aria-label="服务日志，可上下和左右滚动" aria-live="polite" tabIndex={0} onScroll={(event) => { const element = event.currentTarget; const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 24; followTailRef.current = atBottom; setFollow(atBottom); }}>
      {visibleLogs.length ? visibleLogs.map((entry) => {
        const level = entry.message.match(/\b(ERROR|WARN|INFO|OK|DEBUG|TRACE)\b/)?.[1] || (entry.stream === "stderr" ? "ERR" : entry.stream === "system" ? "SYS" : "OUT");
        return <div className={`log-line log-line--${entry.stream}`} key={entry.id}><time>{new Date(entry.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}</time><strong className="log-level" data-level={level}>{level}</strong><span>{entry.message}</span></div>;
      }) : <div className="log-empty"><span>暂无启动日志</span><p>启动服务后，输出会实时显示在这里。</p></div>}
    </div><footer className="log-footer"><span role="status">{notice || "最多缓存 500 行"}</span><span>{follow ? "已跟随最新日志" : "正在阅读历史日志"}</span></footer>
  </section>;
}
