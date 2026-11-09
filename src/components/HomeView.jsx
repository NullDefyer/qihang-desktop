import { useState } from "react";
import { Desktop, FolderSimple, Globe, Plus, MagnifyingGlass, PencilSimple, Trash, PushPin, Note, SquaresFour, TerminalWindow, FileText } from "@phosphor-icons/react";
import { createId } from "../model.js";
import { personalCall } from "../personal.js";
import { PersonalDialog } from "./PersonalDialog.jsx";
import { TranslationCard } from "./TranslationCard.jsx";
import { CountdownCard } from "./CountdownCard.jsx";
import { TodoCard } from "./TodoCard.jsx";

export function HomeView({ state, update, now, onOpenNote, onNavigate, report }) {
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState({});
  const edit = (kind, value = {}) => {
    setEditor(kind);
    setForm({ name: "", target: "", kind: "file", text: "", dueAt: "", repeat: "none", ...value });
  };
  const field = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const pinned = state.notes.filter((note) => note.pinned);
  const notes = (pinned.length ? pinned : state.notes).slice(0, 3);

  function save(event) {
    event.preventDefault();
    if (editor === "shortcut") {
      const item = { id: form.id || createId("shortcut"), name: form.name.trim(), target: form.target.trim(), kind: form.kind };
      if (!item.name || !item.target) return;
      update({ shortcuts: form.id ? state.shortcuts.map((value) => value.id === form.id ? item : value) : [...state.shortcuts, item] });
    }
    setEditor(null);
  }

  function remove() {
    if (!window.confirm("删除这条记录？")) return;
    update({ shortcuts: state.shortcuts.filter((item) => item.id !== form.id) });
    setEditor(null);
  }

  return <div className="home-page">
    <header className="home-heading"><div><h1>我的工作台</h1><p>{new Date(now).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}</p></div></header>
    <div className="home-top-grid">
      <section className="home-card quick-card"><div className="home-card-heading"><h2><SquaresFour className="home-section-icon" aria-hidden="true" weight="fill" />快捷启动</h2><button className="quiet-button" onClick={() => edit("shortcut")}><Plus />添加</button></div><div className="quick-grid">{state.shortcuts.map((item) => {
        const Icon = item.kind === "url" ? Globe : item.kind === "folder" ? FolderSimple : /终端|terminal/i.test(item.name) ? TerminalWindow : /文档|document/i.test(item.name) ? FileText : Desktop;
        return <div className="quick-item" key={item.id}><button title={item.target} onClick={async () => { try { await personalCall("open-target", item.target); } catch (error) { report(error.message); } }}><Icon size={31} weight="duotone" /><span>{item.name}</span></button><button className="quick-edit" aria-label={`编辑 ${item.name}`} onClick={() => edit("shortcut", item)}><PencilSimple size={13} /></button></div>;
      })}<button className="quick-add" onClick={() => edit("shortcut")}><Plus size={26} /><span>添加快捷方式</span></button></div>{!state.shortcuts.length ? <p className="home-help">收藏软件、文件夹、文档和网址，点击即可打开。</p> : null}</section>
      <TodoCard state={state} update={update} now={now} />
    </div>
    <div className="home-bottom-grid">
      <TranslationCard report={report} />
      <section className="home-card"><div className="home-card-heading"><h2><Note className="home-section-icon" aria-hidden="true" />置顶笔记</h2><button className="quiet-button" onClick={() => onNavigate("notes")}><MagnifyingGlass />查看</button></div><div className="home-note-list">{notes.map((note) => <button key={note.id} onClick={() => onOpenNote(note.id)}>{note.pinned ? <PushPin size={19} weight="fill" /> : <Note size={19} />}<div><strong>{note.title || "无标题"}</strong><small>{note.content.slice(0, 65) || "空白笔记"}</small></div></button>)}</div></section>
      <CountdownCard items={state.countdowns} now={now} onChange={(countdowns) => update({ countdowns })} report={report} />
    </div>
    <footer className="home-status"><span><i />本地服务 {state.services.filter((item) => item.status === "running").length} 个运行中</span><span>数据保存在本机</span><button className="quiet-button" onClick={() => onNavigate("settings")}>托盘、快捷键与备份设置</button></footer>
    {editor ? <PersonalDialog title="快捷启动" onClose={() => setEditor(null)}><form onSubmit={save}>
        <label className="field-label"><span>名称</span><input autoFocus required value={form.name} onChange={(event) => field("name", event.target.value)} /></label>
        <label className="field-label"><span>类型</span><select value={form.kind} onChange={(event) => field("kind", event.target.value)}><option value="file">软件 / 文件</option><option value="folder">文件夹</option><option value="url">网址</option></select></label>
        <label className="field-label"><span>打开目标</span><div className="folder-field"><input required value={form.target} onChange={(event) => field("target", event.target.value)} placeholder={form.kind === "url" ? "https://…" : "选择本机文件或目录"} />{form.kind !== "url" ? <button type="button" onClick={async () => { try { const target = await personalCall("choose-target", form.kind); if (target) field("target", target); } catch (error) { report(error.message); } }}>选择</button> : null}</div></label>

      <div className="drawer-actions">{form.id ? <button type="button" className="quiet-button quiet-button--danger" onClick={remove}><Trash size={17} />删除</button> : null}<button type="button" className="button button--secondary" onClick={() => setEditor(null)}>取消</button><button className="button button--primary" type="submit">保存</button></div>
    </form></PersonalDialog> : null}
  </div>;
}
