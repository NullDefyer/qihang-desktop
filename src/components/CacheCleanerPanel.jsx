import { useState } from "react";
import { Broom, MagnifyingGlass } from "@phosphor-icons/react";
import { isDesktop } from "../desktop.js";
import { personalCall } from "../personal.js";

export function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function CacheCleanerPanel({ report }) {
  const [scan, setScan] = useState(null);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const items = scan?.categories.filter((item) => selected.includes(item.id)) || [];
  const count = items.reduce((sum, item) => sum + item.count, 0);
  const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
  async function scanCache() {
    setBusy("scan"); setError(""); setScan(null); setSelected([]); setResult(null);
    try { setScan(await personalCall("cache-scan")); }
    catch (error) { setError(error.message); }
    finally { setBusy(""); }
  }
  async function cleanCache() {
    setBusy("clean"); setError("");
    try {
      const value = await personalCall("cache-clean", { scanId: scan.scanId, categories: selected });
      if (value) { setResult(value); setScan(null); setSelected([]); report("缓存清理完成。"); }
    } catch (error) { setError(error.message); }
    finally { setBusy(""); }
  }
  return <section className="home-card cache-cleaner-panel">
    <div className="home-card-heading"><h2>C 盘缓存清理</h2><button className="button button--primary" disabled={!isDesktop || Boolean(busy)} onClick={scanCache}><MagnifyingGlass size={15} />{busy === "scan" ? "正在扫描…" : scan || result ? "重新扫描" : "扫描缓存"}</button></div>
    <p className="cache-policy">仅扫描 C 盘已知临时目录、Edge / Chrome 缓存和 DirectX 着色器缓存，处理至少 7 天未修改的文件。不会清理下载、桌面、文档、浏览器账号或收藏夹。占用文件和无权限项目会跳过。</p>
    {!isDesktop ? <p className="remote-alert">缓存扫描和清理仅在 Windows 桌面版可用，浏览器不会访问本机文件。</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {busy === "scan" ? <div className="home-empty">正在检查已知缓存目录，扫描最多持续约 20 秒…</div> : null}
    {result ? <div className="cache-result" role="status"><strong>已清理 {formatBytes(result.bytes)}</strong><span>删除 {result.deleted} 个文件，跳过 {result.skipped} 个已变化、占用或无权限文件。</span></div> : null}
    {scan ? <><div className="cache-selection"><span>扫描于 {new Date(scan.scannedAt).toLocaleTimeString("zh-CN", { hour12: false })} · 勾选要清理的分类</span><button className="quiet-button" disabled={Boolean(busy)} onClick={() => setSelected(scan.categories.filter((item) => item.count).map((item) => item.id))}>全选可清理项</button><button className="quiet-button" disabled={Boolean(busy)} onClick={() => setSelected([])}>取消全选</button></div>
      <div className="cache-categories">{scan.categories.map((item) => <article className="cache-category" key={item.id}><label><input type="checkbox" aria-label={`清理${item.name}`} checked={selected.includes(item.id)} disabled={!item.count || Boolean(busy)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><strong>{item.name}</strong><span>{formatBytes(item.bytes)}</span></label><p>{item.count} 个过期文件{item.skipped ? ` · 跳过 ${item.skipped} 项` : ""}{item.incomplete ? " · 已达扫描上限，仅显示已扫描部分" : ""}{!item.roots.length ? " · 目录不存在、不在 C 盘或不可访问" : ""}</p><details><summary>查看目录与文件样例</summary>{item.roots.map((root) => <code key={root}>{root}</code>)}{item.samples.map((file) => <div className="cache-file" key={file.path}><code title={file.path}>{file.path}</code><span>{formatBytes(file.size)}</span></div>)}{item.count > item.samples.length ? <small>仅预览前 {item.samples.length} 个文件；本分类共 {item.count} 个。</small> : null}</details></article>)}</div>
      <div className="cache-clean-actions"><div><strong>已选择 {formatBytes(bytes)}</strong><small>{count} 个文件 · 先确认，再清理 · 不经过回收站</small></div><button className="button button--primary" disabled={!count || Boolean(busy)} onClick={cleanCache}><Broom size={16} />{busy === "clean" ? "正在处理…" : "清理所选缓存"}</button></div></> : null}
    {!scan && !busy && !result ? <div className="home-empty">先扫描查看分类、文件样例及预计可清理大小；不会自动删除。</div> : null}
  </section>;
}
