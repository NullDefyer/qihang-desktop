import { useState } from "react";
import { Bell, Broom, Translate, FolderSimple, TextT, Timer, Code, Terminal, MagnifyingGlass } from "@phosphor-icons/react";
import { TranslationCard } from "./TranslationCard.jsx";
import { transformText } from "../tools.js";
import { CommandsPanel } from "./CommandsPanel.jsx";
import { CacheCleanerPanel } from "./CacheCleanerPanel.jsx";

const TOOLS = [
  { id: "todos", title: "待办提醒", detail: "定时提醒 · 每天 / 每周重复", icon: Bell, home: true },
  { id: "translation", title: "中英文翻译", detail: "中文与英文互译 · 复制译文", icon: Translate },
  { id: "files", title: "文件整理", detail: "批量重命名 · 分类整理 · 重复文件", icon: FolderSimple, planned: true },
  { id: "text", title: "文本工具", detail: "统计 · 去重 · 排序 · 清理空白", icon: TextT },
  { id: "countdowns", title: "我的倒计时", detail: "自定义内容 · 时间或时长 · 到时提醒", icon: Timer, home: true },
  { id: "dev", title: "开发工具", detail: "JSON · 时间戳 · 编码 · UUID", icon: Code },
  { id: "commands", title: "命令收藏", detail: "保存 · 复制 · 预览执行 · 运行输出", icon: Terminal },
  { id: "cache", title: "C 盘缓存清理", detail: "扫描预览 · 分类勾选 · 确认清理", icon: Broom },
];

export function ToolboxView({ initialTool, commands, onCommandsChange, onNavigate, report }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [tool, setTool] = useState(TOOLS.some((item) => item.id === initialTool && !item.planned) ? initialTool : null);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [action, setAction] = useState(initialTool === "dev" ? "json" : "dedupe");
  function run() {
    try {
      if (action === "uuid") setOutput(crypto.randomUUID());
      else if (action === "timestamp") { const numeric = /^-?\d+$/.test(input.trim()); const date = numeric ? new Date(Number(input) * (input.trim().replace("-", "").length <= 10 ? 1000 : 1)) : new Date(input); if (!Number.isFinite(date.getTime())) throw new Error("请输入日期时间、秒或毫秒时间戳。"); setOutput(`${date.toLocaleString("zh-CN")}\nISO：${date.toISOString()}\n秒：${Math.floor(date.getTime() / 1000)}\n毫秒：${date.getTime()}`); }
      else setOutput(transformText(input, action));
    } catch (error) { report(error.message); }
  }
  return <div className="tools-page"><header className="home-heading"><div><h1>{tool === "translation" ? "中英文翻译" : tool === "cache" ? "C 盘缓存清理" : "工具箱"}</h1><p>常用小工具，一处收纳</p></div><label className="search-field"><MagnifyingGlass size={18} /><input aria-label="搜索工具" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工具…" /></label></header>{tool ? <button className="tool-back quiet-button" onClick={() => setTool(null)}>‹ 返回工具箱</button> : null}<div className="tool-categories" role="group" aria-label="工具分类">{[["all", "全部"], ["dev", "开发辅助"], ["daily", "日常工具"]].map(([id, label]) => <button className="button button--secondary" aria-pressed={category === id} onClick={() => setCategory(id)} key={id}>{label}</button>)}</div><div className="tools-grid">{TOOLS.filter((item) => `${item.title}${item.detail}`.includes(query) && (category === "all" || (category === "dev") === ["dev", "commands"].includes(item.id))).map(({ id, title, detail, icon: Icon, planned, home }) => <button key={id} className={`tool-card${tool === id ? " tool-card--active" : ""}`} disabled={planned} onClick={() => { if (home) onNavigate("home"); else { setTool(id); setInput(""); setOutput(""); setAction(id === "dev" ? "json" : "dedupe"); } }}><Icon size={28} /><div><strong>{title}</strong><small>{detail}</small>{planned ? <em>后续批次</em> : null}</div></button>)}</div>
    {tool === "text" || tool === "dev" ? <section className="home-card tool-editor"><div className="home-card-heading"><h2>{tool === "text" ? "文本处理" : "开发格式工具"}</h2><button className="quiet-button tool-clear" onClick={() => { setInput(""); setOutput(""); }}>清空</button><select aria-label="处理操作" value={action} onChange={(event) => setAction(event.target.value)}>{(tool === "text" ? [["dedupe", "按行去重"], ["sort", "按行排序"], ["trim", "清理多余空白"]] : [["json", "JSON 格式化"], ["timestamp", "时间戳转换"], ["encode", "URL 编码"], ["decode", "URL 解码"], ["base64", "Base64 编码"], ["unbase64", "Base64 解码"], ["uuid", "生成 UUID"]]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="tool-text-columns"><label className="field-label"><span>输入 · {input.length} 字符 / {input ? input.split(/\r?\n/).length : 0} 行</span><textarea aria-label="工具输入" value={input} onChange={(event) => { setInput(event.target.value); setOutput(""); }} placeholder={action === "timestamp" ? "例如：2026-10-30T12:00:00+08:00 或 1793332800" : "在此粘贴文本"} /></label><label className="field-label"><span>处理结果</span><textarea aria-label="工具输出" readOnly value={output} /></label></div><div className="drawer-actions"><button className="button button--secondary" disabled={!output} onClick={async () => { try { await navigator.clipboard.writeText(output); report("已复制处理结果。"); } catch { report("复制失败。"); } }}>复制结果</button><button className="button button--primary" onClick={run}>处理</button></div></section> : null}
    {tool === "commands" ? <CommandsPanel commands={commands} onChange={onCommandsChange} report={report} /> : null}
    {tool === "cache" ? <CacheCleanerPanel report={report} /> : null}
    {tool === "translation" ? <TranslationCard report={report} /> : null}
    <footer className="home-status"><span>标注“后续批次”的工具尚未开放</span><button className="quiet-button" onClick={() => onNavigate("settings")}>托盘 · 快捷键 · 配置备份</button></footer>
  </div>;
}
