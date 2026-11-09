import { useState } from "react";
import { Plus, PencilSimple, Trash, Clock, Play, Pause, ArrowCounterClockwise } from "@phosphor-icons/react";
import { createId, countdownRemaining } from "../model.js";
import { PersonalDialog } from "./PersonalDialog.jsx";
import { DigitalClock } from "./DigitalClock.jsx";

function clock(seconds) {
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function CountdownCard({ items, now, onChange, report }) {
  const [form, setForm] = useState(null);
  function edit(item) {
    setForm(item ? { ...item, minutes: Math.round(item.durationSeconds / 60) || 25, target: item.deadline ? new Date(item.deadline - new Date(item.deadline).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "" } : { title: "", mode: "date", minutes: 25, target: "" });
  }
  function save(event) {
    event.preventDefault();
    const seconds = Math.round(Number(form.minutes) * 60);
    const deadline = form.mode === "date" ? new Date(form.target).getTime() : now + seconds * 1000;
    if (!form.title.trim() || !Number.isFinite(deadline) || deadline <= now || (form.mode === "duration" && (!Number.isFinite(seconds) || seconds < 1 || seconds > 31536000))) { report("请填写名称和有效的未来时间，或 1 秒至 1 年的计时时长。"); return; }
    const item = { id: form.id || createId("countdown"), title: form.title.trim(), mode: form.mode, deadline, durationSeconds: form.mode === "duration" ? seconds : Math.ceil((deadline - now) / 1000), remaining: Math.ceil((deadline - now) / 1000), status: "running", notifiedAt: null };
    onChange(form.id ? items.map((value) => value.id === form.id ? item : value) : [...items, item]);
    setForm(null);
  }
  function patch(id, value) { onChange(items.map((item) => item.id === id ? { ...item, ...value } : item)); }
  return <section className="home-card countdown-card"><div className="home-card-heading"><h2><Clock className="home-section-icon" aria-hidden="true" />我的倒计时</h2><button className="quiet-button" onClick={() => edit()}><Plus />添加</button></div><div className="countdown-list">{items.map((item) => {
    const remaining = countdownRemaining(item, now);
    const finished = item.status === "finished" || (item.status === "running" && remaining === 0);
    const days = Math.floor(remaining / 86400);
    const running = item.status === "running" && !finished;
    const action = running ? "暂停" : finished ? "重新开始" : "继续";
    const status = finished ? "已到时间" : item.status === "paused" ? "已暂停" : "时长倒计时";
    const detail = item.mode === "date" ? `目标：${new Date(item.deadline).toLocaleString("zh-CN")}` : status;
    return <article className={`countdown-item countdown-row${finished ? " countdown-item--finished" : ""}${item.status === "paused" ? " countdown-item--paused" : ""}`} key={item.id} title={detail}>
      <strong className="countdown-name" title={`${item.title} · ${detail}`}>{item.title}<span className="sr-only">{finished || item.status === "paused" ? `，${status}` : ""}</span></strong>
      <span className="countdown-days" aria-label={`剩余 ${days} 天`}><strong>{days}</strong><span>天</span></span>
      <div className="countdown-clock">{finished ? <span className="countdown-finished">已到时间</span> : <DigitalClock value={clock(remaining)} />}</div>
      <div className="countdown-item-tools">
        {item.mode === "duration" ? <>
          <button className="quiet-button" aria-label={`${action}倒计时 ${item.title}`} title={action} onClick={() => patch(item.id, running ? { status: "paused", remaining, deadline: null } : { status: "running", deadline: now + (finished ? item.durationSeconds : remaining) * 1000, remaining: finished ? item.durationSeconds : remaining, notifiedAt: null })}>{running ? <Pause size={14} /> : <Play size={14} />}<span className="sr-only">{action}</span></button>
          <button className="quiet-button" aria-label={`重置倒计时 ${item.title}`} title="重置" onClick={() => patch(item.id, { status: "paused", deadline: null, remaining: item.durationSeconds, notifiedAt: null })}><ArrowCounterClockwise size={14} /><span className="sr-only">重置</span></button>
        </> : null}
        <button className="quiet-button" aria-label={`编辑倒计时 ${item.title}`} onClick={() => edit(item)}><PencilSimple size={14} /></button>
        <button className="quiet-button" aria-label={`删除倒计时 ${item.title}`} onClick={() => { if (window.confirm(`删除倒计时“${item.title}”？`)) onChange(items.filter((value) => value.id !== item.id)); }}><Trash size={14} /></button>
      </div>
    </article>;
  })}{!items.length ? <div className="home-empty">添加会议、出发或其他事项的倒计时，也可以设置一个计时时长。</div> : null}</div><p className="home-help">到时发送桌面提醒，应用需运行或驻留托盘。</p>{form ? <PersonalDialog title={form.id ? "编辑倒计时" : "添加倒计时"} onClose={() => setForm(null)}><form onSubmit={save}><label className="field-label"><span>倒计时内容</span><input autoFocus required value={form.title} onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))} placeholder="例如：下午会议、下班、煮茶" /></label><label className="field-label"><span>倒计时方式</span><select value={form.mode} onChange={(event) => setForm((value) => ({ ...value, mode: event.target.value }))}><option value="date">指定日期和时间</option><option value="duration">按时长计时</option></select></label>{form.mode === "date" ? <label className="field-label"><span>目标时间</span><input type="datetime-local" required value={form.target} onChange={(event) => setForm((value) => ({ ...value, target: event.target.value }))} /></label> : <label className="field-label"><span>时长（分钟，可填小数）</span><input type="number" min="0.02" max="525600" step="0.01" required value={form.minutes} onChange={(event) => setForm((value) => ({ ...value, minutes: event.target.value }))} /></label>}<div className="drawer-actions"><button className="button button--secondary" type="button" onClick={() => setForm(null)}>取消</button><button className="button button--primary" type="submit">保存并开始</button></div></form></PersonalDialog> : null}</section>;
}
