import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, FolderOpen, MagnifyingGlass, PencilSimple, Play, Plus, Stop, Trash } from "@phosphor-icons/react";
import { createId } from "../model.js";
import { isDesktop } from "../desktop.js";
import { personalCall } from "../personal.js";
import { PersonalDialog } from "./PersonalDialog.jsx";

const STATUS = { running: "运行中", stopping: "正在停止", completed: "已完成", error: "执行失败", stopped: "已停止" };

export function CommandsPanel({ commands, onChange, report }) {
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState(null);
  const [preview, setPreview] = useState(null);
  const [task, setTask] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState(commands[0]?.id);
  const selected = commands.find((item) => item.id === selectedId) || commands[0];
  const outputRef = useRef(null);
  const followRef = useRef(true);
  const running = ["running", "stopping"].includes(task?.status);
  useEffect(() => {
    if (!isDesktop) return undefined;
    let active = true;
    let timer;
    const refresh = async () => {
      try { const result = await personalCall("command-status"); if (active) setTask(result); }
      catch (error) { if (active) report(error.message); }
      if (active) timer = setTimeout(refresh, 800);
    };
    refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [report]);
  useLayoutEffect(() => { if (outputRef.current && followRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight; }, [task?.output]);

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); report("已复制。"); } catch { report("复制失败。"); }
  }
  function save(event) {
    event.preventDefault();
    const item = { ...editor, id: editor.id || createId("command"), name: editor.name.trim(), cwd: editor.cwd.trim(), updatedAt: Date.now() };
    if (!item.name || !item.command.trim()) return;
    onChange(editor.id ? commands.map((value) => value.id === editor.id ? item : value) : [...commands, item]);
    setEditor(null);
  }
  async function showPreview(command) {
    setBusy(true);
    try { setPreview(await personalCall("command-preview", command)); }
    catch (error) { report(error.message); }
    finally { setBusy(false); }
  }
  async function execute() {
    setBusy(true);
    try { const result = await personalCall("command-run", preview); followRef.current = true; setTask(result); setPreview(null); }
    catch (error) { report(error.message); }
    finally { setBusy(false); }
  }
  async function stop() {
    setBusy(true);
    try { setTask(await personalCall("command-stop")); }
    catch (error) { report(error.message); }
    finally { setBusy(false); }
  }
  const filtered = commands.filter((item) => `${item.name}\n${item.command}\n${item.cwd}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="command-workspace">
    <div className="home-card command-library">
      <div className="home-card-heading"><h2>收藏的命令 <small>{commands.length}</small></h2><button className="button button--primary" onClick={() => setEditor({ name: "", command: "", shell: "powershell", cwd: "" })}><Plus size={15} />添加命令</button></div>
      <label className="search-field"><MagnifyingGlass size={16} /><input aria-label="搜索收藏命令" placeholder="搜索名称、命令或工作目录…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="command-list">{filtered.map((item) => <article className={`command-item${selected?.id === item.id ? " command-item--selected" : ""}`} key={item.id}>
        <header><button className="command-select" aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)} title={item.name}>{item.name}</button><span>{item.shell === "cmd" ? "CMD" : "PowerShell"}</span></header><pre title={item.command}>{item.command}</pre><small className="command-cwd" title={item.cwd}>{item.cwd || "默认用户目录"}</small>
        <div className="command-item-actions"><button className="quiet-button" onClick={() => copy(item.command)}><Copy size={14} />复制</button><button className="quiet-button" aria-label={`编辑命令 ${item.name}`} onClick={() => setEditor({ ...item })}><PencilSimple size={14} />编辑</button><button className="quiet-button" aria-label={`删除命令 ${item.name}`} onClick={() => { if (window.confirm(`删除收藏命令“${item.name}”？`)) onChange(commands.filter((value) => value.id !== item.id)); }}><Trash size={14} /></button><button className="button button--secondary" disabled={!isDesktop || busy || running} onClick={() => showPreview(item)}><Play size={13} />预览执行</button></div>
      </article>)}{!filtered.length ? <p className="home-empty">{commands.length ? "没有匹配的命令。" : "保存常用命令，需要时复制或预览执行。"}</p> : null}</div>
    </div>
    <div className="home-card command-output-panel">
      {selected ? <div className="command-selected-detail"><header><h2>{selected.name}</h2><button className="button button--secondary" onClick={() => copy(selected.command)}><Copy size={15} />复制命令</button><button className="button button--primary" disabled={!isDesktop || busy || running} onClick={() => showPreview(selected)}><Play size={15} />预览执行</button></header><pre>{selected.command}</pre><p><FolderOpen size={15} />工作目录：{selected.cwd || "默认用户目录"} · {selected.shell === "cmd" ? "CMD" : "PowerShell"}</p></div> : null}
      <div className="home-card-heading"><h2>运行输出</h2><span className={`command-task-state${task?.status === "error" ? " command-task-state--error" : ""}`}>{task ? STATUS[task.status] : "尚未执行"}</span><button className="quiet-button" disabled={!task?.output} onClick={() => copy(task.output)}><Copy size={14} />复制输出</button>{running ? <button className="button button--secondary" disabled={busy || task.status === "stopping"} onClick={stop}><Stop size={14} />停止任务</button> : null}</div>
      {task ? <div className="command-run-summary"><strong>{task.name}</strong><span>{task.shell === "cmd" ? "CMD" : "PowerShell"} · {task.cwd}</span><details><summary>查看本次执行的命令</summary><pre>{task.command}</pre></details></div> : null}
      <pre className="command-output" ref={outputRef} tabIndex={0} aria-label="命令运行输出" onScroll={(event) => { const e = event.currentTarget; followRef.current = e.scrollHeight - e.scrollTop - e.clientHeight < 24; }}>{task?.output || (running ? "等待命令输出…" : "命令执行后的输出会显示在这里。")}</pre>
      <footer>{task?.exitCode !== null && task?.exitCode !== undefined ? `退出码：${task.exitCode} · ` : ""}{task?.truncated ? "仅保留最近 512K 字符 · " : ""}输出仅在本次应用运行期间保留。{!isDesktop ? "执行与停止需使用桌面版。" : ""}</footer>
    </div>
    {editor ? <PersonalDialog title={editor.id ? "编辑收藏命令" : "添加收藏命令"} onClose={() => setEditor(null)}><form onSubmit={save}>
      <label className="field-label"><span>命令名称</span><input required maxLength={120} aria-label="命令名称" autoFocus value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} placeholder="例如：查看本机网络配置" /></label>
      <label className="field-label"><span>执行方式</span><select aria-label="命令执行方式" value={editor.shell} onChange={(event) => setEditor({ ...editor, shell: event.target.value })}><option value="powershell">PowerShell</option><option value="cmd">CMD</option></select></label>
      <label className="field-label"><span>工作目录（可选）</span><div className="folder-field"><input aria-label="命令工作目录" value={editor.cwd} onChange={(event) => setEditor({ ...editor, cwd: event.target.value })} placeholder="留空使用当前用户目录" /><button type="button" disabled={!isDesktop} onClick={async () => { try { const cwd = await personalCall("choose-target", "folder"); if (cwd) setEditor((current) => ({ ...current, cwd })); } catch (error) { report(error.message); } }}><FolderOpen size={15} />选择</button></div></label>
      <label className="field-label"><span>命令内容</span><textarea required maxLength={8000} className="command-source" aria-label="命令内容" value={editor.command} onChange={(event) => setEditor({ ...editor, command: event.target.value })} placeholder={editor.shell === "cmd" ? "例如：ipconfig" : "例如：Get-Date"} /></label>
      <p className="home-help">保存只收藏文本，不自动执行。命令以当前 Windows 用户权限运行。</p><div className="drawer-actions"><button type="button" className="button button--secondary" onClick={() => setEditor(null)}>取消</button><button className="button button--primary">保存命令</button></div>
    </form></PersonalDialog> : null}
    {preview ? <PersonalDialog title="确认执行命令" onClose={() => { if (!busy) setPreview(null); }}><div className="command-preview"><strong>{preview.name}</strong><p>执行方式：{preview.shell === "cmd" ? "CMD" : "PowerShell"}</p><p>工作目录：{preview.cwd}</p><pre>{preview.command}</pre><p className="home-help">本次将执行上面的完整命令；命令中的文件和系统操作将按其原意执行。</p><div className="drawer-actions"><button className="button button--secondary" disabled={busy} onClick={() => setPreview(null)}>取消</button><button className="button button--primary" disabled={busy} onClick={execute}>确认执行</button></div></div></PersonalDialog> : null}
  </section>;
}
