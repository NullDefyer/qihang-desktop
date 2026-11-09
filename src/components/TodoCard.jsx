import { useEffect, useRef, useState } from "react";
import { Bell, CheckCircle, MagnifyingGlass, PencilSimple, Plus, Trash, X } from "@phosphor-icons/react";
import { createId } from "../model.js";
import { completeTodo, reopenTodo } from "../todos.js";
import { PersonalDialog } from "./PersonalDialog.jsx";

function dateLabel(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "时间未记录";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function TodoCard({ state, update, now }) {
  const [tab, setTab] = useState("pending");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [undo, setUndo] = useState(null);
  const listRef = useRef(null);
  const pending = state.todos.filter((item) => !item.completed);
  const history = state.todoHistory.filter((item) => (kind === "all" || kind === item.type) && item.text.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => (Date.parse(b.occurredAt) || 0) - (Date.parse(a.occurredAt) || 0));
  useEffect(() => {
    if (!undo) return undefined;
    const timer = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(timer);
  }, [undo]);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = 0; }, [tab, query, kind]);

  function edit(todo = {}) {
    const date = new Date(todo.dueAt);
    const dueAt = todo.dueAt && Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
    setForm({ ...todo, text: todo.text || "", dueAt, repeat: todo.repeat || "none" }); setError("");
  }
  function save(event) {
    event.preventDefault();
    const text = form.text.trim();
    if (!text) { setError("请填写待办内容。"); return; }
    const dueAt = form.dueAt ? new Date(form.dueAt).toISOString() : null;
    update((current) => {
      const existing = current.todos.find((item) => item.id === form.id);
      const todo = { ...existing, id: existing?.id || createId("todo"), text, dueAt, repeat: form.repeat, completed: false, completedAt: null, remindedAt: existing?.dueAt === dueAt ? existing.remindedAt : null };
      return { todos: existing ? current.todos.map((item) => item.id === todo.id ? todo : item) : [...current.todos, todo] };
    });
    setForm(null); setTab("pending");
  }
  function removeTodo(todo) {
    update((current) => ({ todos: current.todos.filter((item) => item.id !== todo.id) }));
    setUndo({ text: todo.text, todo });
  }
  function removeHistory(record) {
    const archived = record.type === "completed" ? state.todos.find((item) => item.id === record.todoId && item.completed) : null;
    update((current) => ({ todoHistory: current.todoHistory.filter((item) => item.id !== record.id), todos: current.todos.filter((item) => !(item.id === archived?.id && item.completed)) }));
    setUndo({ text: record.text, record, todo: archived });
  }
  function restoreDeleted() {
    update((current) => ({
      todos: undo.todo && !current.todos.some((item) => item.id === undo.todo.id) ? [...current.todos, undo.todo] : current.todos,
      todoHistory: undo.record && !current.todoHistory.some((item) => item.id === undo.record.id) ? [undo.record, ...current.todoHistory] : current.todoHistory,
    }));
    setUndo(null);
  }
  function openHistory(record) {
    const existing = state.todos.find((item) => item.id === record.todoId && !item.completed);
    if (existing) edit(existing);
    else { update((current) => reopenTodo(current, record, now)); setTab("pending"); }
  }

  return <section className="home-card todo-card" aria-label="待办与提醒">
    <div className="home-card-heading"><h2>待办与提醒 <small>{pending.length} 项待完成</small></h2><button className="quiet-button" onClick={() => edit()}><Plus />新待办</button></div>
    <div className="todo-navigation"><div className="todo-tabs" role="tablist" aria-label="待办视图"><button id="todo-pending-tab" role="tab" aria-controls="todo-records" aria-selected={tab === "pending"} onClick={() => setTab("pending")}>待完成 <span>{pending.length}</span></button><button id="todo-history-tab" role="tab" aria-controls="todo-records" aria-selected={tab === "history"} onClick={() => setTab("history")}>历史 <span>{state.todoHistory.length}</span></button></div>
    {tab === "history" ? <div className="todo-history-filters"><label><MagnifyingGlass size={14} /><input aria-label="搜索历史记录" placeholder="搜索历史记录" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="历史记录类型" value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">全部记录</option><option value="completed">已完成</option><option value="reminded">提醒记录</option></select></div> : null}
    </div>
    <div className="todo-list" id="todo-records" role="tabpanel" aria-labelledby={tab === "pending" ? "todo-pending-tab" : "todo-history-tab"} ref={listRef}>
      {tab === "pending" ? pending.map((todo) => {
        const overdue = todo.dueAt && new Date(todo.dueAt).getTime() < now;
        const label = `${todo.dueAt ? `${overdue ? "逾期 · " : ""}${dateLabel(todo.dueAt)}` : "未设置提醒"}${todo.repeat === "daily" ? " · 每天" : todo.repeat === "weekly" ? " · 每周" : ""}`;
        return <div className="todo-row" key={todo.id}><input type="checkbox" aria-label={`完成 ${todo.text}`} checked={false} onChange={() => update((current) => completeTodo(current, todo.id, now))} /><button className="todo-row-content" onClick={() => edit(todo)} title={todo.text}><span>{todo.text}</span><small className={overdue ? "todo-overdue" : ""}>{todo.dueAt ? <Bell size={12} /> : null}{label}</small></button><div className="todo-row-actions"><button className="quiet-icon" aria-label={`编辑待办 ${todo.text}`} title="编辑" onClick={() => edit(todo)}><PencilSimple size={16} /></button><button className="quiet-icon" aria-label={`删除待办 ${todo.text}`} title="删除" onClick={() => removeTodo(todo)}><Trash size={16} /></button></div></div>;
      }) : history.map((record) => {
        const active = state.todos.find((item) => item.id === record.todoId && !item.completed);
        const label = record.type === "completed" ? "已完成" : record.notificationShown === false ? "已到时（系统通知不可用）" : "已提醒";
        return <div className="todo-row todo-history-row" key={record.id}>{record.type === "completed" ? <CheckCircle className="todo-completed-icon" size={19} weight="fill" /> : <Bell className="todo-reminded-icon" size={19} />}<div className="todo-history-content"><span title={record.text}>{record.text}</span><small title={record.scheduledAt ? `原提醒时间 ${dateLabel(record.scheduledAt)}` : undefined}>{label} · {dateLabel(record.occurredAt)}{record.type === "reminded" && active ? " · 待办未完成" : ""}</small></div><div className="todo-row-actions">{record.type === "completed" || active ? <button className="todo-history-open" aria-label={`${active ? "查看待办" : "重新打开"} ${record.text}`} onClick={() => openHistory(record)}>{active ? "查看待办" : "重新打开"}</button> : null}<button className="quiet-icon" aria-label={`删除历史 ${record.text}`} title="仅删除此条历史" onClick={() => removeHistory(record)}><Trash size={16} /></button></div></div>;
      })}
      {!(tab === "pending" ? pending : history).length ? <div className="home-empty">{tab === "pending" ? "暂无待办，点击“新待办”添加。" : query || kind !== "all" ? "没有匹配的历史记录。" : "暂无历史，完成或到时提醒后会记录在这里。"}</div> : null}
    </div>
    <p className="home-help todo-help" title={tab === "pending" ? "已完成的待办自动归入历史。提醒在启航运行或驻留托盘时生效。" : "仅删除所选历史记录，删除提醒记录不影响原待办。重新打开时，已过期的提醒时间会清空，可重新设置。"}>{tab === "pending" ? "完成后归入历史 · 提醒在启航运行或驻留托盘时生效。" : "仅删除所选历史，提醒记录删除不影响原待办。"}</p>
    {undo ? <div className="todo-undo" role="status"><CheckCircle size={18} /><span title={undo.text}>已删除“{undo.text}”</span><button onClick={restoreDeleted}>撤销</button><button className="quiet-icon" aria-label="关闭撤销提示" onClick={() => setUndo(null)}><X size={16} /></button></div> : null}
    {form ? <PersonalDialog title={form.id ? "编辑待办" : "待办与提醒"} onClose={() => setForm(null)}><form onSubmit={save}>
      <label className="field-label"><span>待办内容</span><input autoFocus required aria-label="待办内容" value={form.text} onChange={(event) => setForm((current) => ({ ...current, text: event.target.value }))} /></label>
      <label className="field-label"><span>提醒时间（可选）</span><input type="datetime-local" aria-label="提醒时间" value={form.dueAt} onChange={(event) => setForm((current) => ({ ...current, dueAt: event.target.value }))} /></label>
      <label className="field-label"><span>重复</span><select aria-label="提醒重复" value={form.repeat} onChange={(event) => setForm((current) => ({ ...current, repeat: event.target.value }))}><option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option></select></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}<div className="drawer-actions">{form.id ? <button type="button" className="quiet-button quiet-button--danger" onClick={() => { const todo = state.todos.find((item) => item.id === form.id); if (todo) removeTodo(todo); setForm(null); }}><Trash size={17} />删除</button> : null}<button type="button" className="button button--secondary" onClick={() => setForm(null)}>取消</button><button className="button button--primary">保存</button></div>
    </form></PersonalDialog> : null}
  </section>;
}
