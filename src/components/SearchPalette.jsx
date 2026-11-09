import { useEffect, useRef, useState } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { personalCall } from "../personal.js";

export function SearchPalette({ state, onClose, onNavigate, onOpenNote, onOpenTool, report }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const records = [
    ...[{ id: "home", name: "首页" }, { id: "services", name: "服务管理" }, { id: "remote", name: "远程连接" }, { id: "notes", name: "笔记" }, { id: "tools", name: "工具箱" }, { id: "github", name: "GitHub 高星项目" }, { id: "settings", name: "设置与备份" }].map((item) => ({ ...item, kind: "页面", run: () => onNavigate(item.id) })),
    ...state.shortcuts.map((item) => ({ id: item.id, name: item.name, detail: item.target, kind: "快捷启动", run: () => personalCall("open-target", item.target) })),
    ...state.notes.map((item) => ({ id: item.id, name: item.title || "无标题", detail: item.content, kind: "笔记", run: () => onOpenNote(item.id) })),
    { id: "countdowns", name: "我的倒计时", detail: state.countdowns.map((item) => item.title).join(" "), kind: "工具", run: () => onNavigate("home") },
    { id: "translation", name: "中英文翻译", detail: "中文 英文 English translate", kind: "工具", run: () => onOpenTool("translation") },
    ...[{ id: "text", name: "文本工具", detail: "去重 排序 清理空白" }, { id: "commands", name: "命令收藏", detail: "PowerShell CMD 执行 复制" }, { id: "cache", name: "C 盘缓存清理", detail: "扫描 临时文件 浏览器缓存" }, { id: "dev", name: "开发工具", detail: "JSON 时间戳 编码 Base64 UUID" }].map((item) => ({ ...item, kind: "工具", run: () => onOpenTool(item.id) })),
    ...state.commands.map((item) => ({ id: item.id, name: item.name, detail: item.command, kind: "命令收藏", run: () => onOpenTool("commands") })),
  ];
  const results = records.filter((item) => `${item.name} ${item.detail || ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 30);
  async function run(item) {
    if (!item) return;
    try { await item.run(); onClose(); } catch (error) { report(error.message); }
  }
  return <div className="remote-modal-backdrop search-backdrop" onKeyDown={(event) => { if (event.key === "Escape") onClose(); if (event.key === "ArrowDown") { event.preventDefault(); setSelected((index) => Math.min(results.length - 1, index + 1)); } if (event.key === "ArrowUp") { event.preventDefault(); setSelected((index) => Math.max(0, index - 1)); } if (event.key === "Enter") { event.preventDefault(); run(results[selected]); } }}><section className="search-palette" role="dialog" aria-modal="true" aria-label="全局搜索"><div className="palette-input"><MagnifyingGlass size={23} /><input ref={inputRef} aria-label="全局搜索内容" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} placeholder="搜索应用、文件、笔记和工具…" /><button className="quiet-button" aria-label="关闭搜索" onClick={onClose}><X size={20} /></button></div><div className="palette-results">{results.map((item, index) => <button className={index === selected ? "palette-result palette-result--active" : "palette-result"} key={`${item.kind}-${item.id}`} onMouseEnter={() => setSelected(index)} onClick={() => run(item)}><span>{item.kind}</span><div><strong>{item.name}</strong><small>{item.detail?.slice(0, 100)}</small></div></button>)}{!results.length ? <p className="home-empty">没有匹配的结果。</p> : null}</div><footer>↑ ↓ 选择 · Enter 打开 · Esc 关闭</footer></section></div>;
}
