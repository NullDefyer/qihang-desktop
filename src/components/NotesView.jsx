import { NotePencil, Plus, Trash, PushPin, MagnifyingGlass } from "@phosphor-icons/react";
import { useState } from "react";
import { createId } from "../model.js";

function updatedLabel(timestamp) {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotesView({ notes, activeNoteId, onChange }) {
  const [query, setQuery] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const activeNote = notes.find((note) => note.id === activeNoteId) ?? notes[0];

  function createNote() {
    const note = {
      id: createId("note"),
      title: "无标题",
      content: "",
      updatedAt: Date.now(),
    };
    onChange([...notes, note], note.id);
  }

  function updateNote(patch) {
    onChange(
      notes.map((note) => note.id === activeNote.id
        ? { ...note, ...patch, updatedAt: Date.now() }
        : note),
      activeNote.id,
    );
  }

  function deleteNote() {
    if (notes.length === 1) {
      onChange([{ ...activeNote, title: "无标题", content: "", updatedAt: Date.now() }], activeNote.id);
      return;
    }
    const remaining = notes.filter((note) => note.id !== activeNote.id);
    onChange(remaining, remaining[0].id);
  }

  return (
    <div className="notes-workspace">
      <aside className="notes-list">
        <div className="notes-list-header">
          <div>
            <span>文本笔记</span>
            <strong>{notes.length} 条记录</strong>
          </div>
          <button className="icon-button icon-button--blue" type="button" title="新建笔记" onClick={createNote}>
            <Plus size={17} /> 新建
          </button>
        </div>
        <label className="search-field notes-search"><MagnifyingGlass size={17} /><input aria-label="搜索笔记" placeholder="搜索笔记…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="notes-filters" role="group" aria-label="笔记筛选"><button className="button button--secondary" aria-pressed={!pinnedOnly} onClick={() => setPinnedOnly(false)}>全部</button><button className="button button--secondary" aria-pressed={pinnedOnly} onClick={() => setPinnedOnly(true)}>已置顶</button></div>
        <div className="notes-list-body">
          {notes.filter((note) => (!pinnedOnly || note.pinned) && `${note.title}\n${note.content}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))).map((note) => (
            <button
              className={`note-list-item ${note.id === activeNote.id ? "note-list-item--active" : ""}`}
              key={note.id}
              type="button"
              onClick={() => onChange(notes, note.id)}
            >
              <strong>{note.pinned ? <PushPin size={13} weight="fill" /> : null} {note.title || "无标题"}</strong>
              <span>{note.content.slice(0, 32) || "空白笔记"}</span>
              <time>{updatedLabel(note.updatedAt)}</time>
            </button>
          ))}
        </div>
      </aside>
      <section className="note-editor">
        <div className="note-editor-header">
          <button className="quiet-button" onClick={() => updateNote({ pinned: !activeNote.pinned })}><PushPin size={17} weight={activeNote.pinned ? "fill" : "regular"} />{activeNote.pinned ? "取消置顶" : "置顶笔记"}</button>
          <div className="note-saved"><i /> 已自动保存</div>
          <button className="quiet-button quiet-button--danger" type="button" onClick={deleteNote}>
            <Trash size={17} /> 删除
          </button>
        </div>
        <div className="note-title-row">
          <NotePencil size={26} />
          <input
            aria-label="笔记标题"
            value={activeNote.title}
            onChange={(event) => updateNote({ title: event.target.value })}
            placeholder="无标题"
          />
        </div>
        <textarea
          className="note-content"
          aria-label="笔记内容"
          value={activeNote.content}
          onChange={(event) => updateNote({ content: event.target.value })}
          placeholder="在这里记录任意文本内容…"
        />
        <footer className="note-editor-footer"><span>自动保存在本机 · 最后更新：{updatedLabel(activeNote.updatedAt)}</span><span>{activeNote.content.length} 字</span></footer>
      </section>
    </div>
  );
}
