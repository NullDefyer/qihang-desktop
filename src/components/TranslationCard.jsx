import { useRef, useState } from "react";
import { Copy, Translate } from "@phosphor-icons/react";
import { personalCall } from "../personal.js";

function decodeEntities(text) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (original, entity) => {
    if (entity[0] !== "#") return entities[entity.toLowerCase()] || original;
    const value = parseInt(entity.slice(entity[1].toLowerCase() === "x" ? 2 : 1), entity[1].toLowerCase() === "x" ? 16 : 10);
    return value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : original;
  });
}

export function TranslationCard({ report }) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [direction, setDirection] = useState("zh-en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(0);
  const bytes = new TextEncoder().encode(input).length;
  function invalidate() { requestRef.current += 1; setBusy(false); setOutput(""); setError(""); }
  async function translate() {
    const request = ++requestRef.current;
    setBusy(true); setError(""); setOutput("");
    try {
      const result = await personalCall("translate", { text: input, direction });
      if (request === requestRef.current) setOutput(decodeEntities(result.text));
    } catch (error) { if (request === requestRef.current) setError(error.message); }
    finally { if (request === requestRef.current) setBusy(false); }
  }
  return <section className="home-card translation-card">

    <div className="home-card-heading">
      <h2><Translate className="home-section-icon" aria-hidden="true" />中英文翻译</h2>
      <div className="translation-toolbar">
        <select aria-label="翻译方向" value={direction} onChange={(event) => { invalidate(); setDirection(event.target.value); }}><option value="zh-en">中文 → English</option><option value="en-zh">English → 中文</option></select>
      </div>
    </div>
    <label className="field-label"><span>原文 · {bytes}/500 字节</span><textarea aria-label="翻译原文" value={input} onChange={(event) => { invalidate(); setInput(event.target.value); }} placeholder="输入中文或英文…" /></label>
    <div className="translation-actions"><button className="button button--primary" disabled={busy || !input.trim() || bytes > 500} onClick={translate}>{busy ? "翻译中…" : "翻译"}</button><button className="quiet-button" disabled={!output} onClick={async () => { try { await navigator.clipboard.writeText(output); report("已复制译文。"); } catch { report("复制失败，请重试。"); } }}><Copy size={16} />复制译文</button></div>
    {error ? <p className="translation-error" role="alert">{error}</p> : null}
    <label className="field-label translation-result"><span>译文</span><textarea aria-label="翻译结果" readOnly value={output} placeholder="翻译结果显示在这里" /></label>
    <p className="home-help">在线服务：MyMemory。仅点击翻译时发送原文；不保存翻译记录。单次 500 字节，服务有额度限制。</p>
  </section>;
}
