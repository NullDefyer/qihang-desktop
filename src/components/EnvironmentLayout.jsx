import { useEffect, useRef, useState } from "react";

// Wide windows place logs beside services; compact windows stack them.
// Measure the content box and preserve the pointer's grab offset in both axes.
export function EnvironmentLayout({ children }) {
  const layoutRef = useRef(null);
  const offsetRef = useRef(null);
  const [height, setHeight] = useState(44);
  const [dragging, setDragging] = useState(false);
  const [horizontal, setHorizontal] = useState(() => window.matchMedia("(min-width: 1150px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1150px)");
    const update = () => { setHorizontal(media.matches); offsetRef.current = null; setDragging(false); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  function resizeTo(position) {
    const layout = layoutRef.current;
    const bounds = layout.getBoundingClientRect();
    const style = getComputedStyle(layout);
    const padding = parseFloat(horizontal ? style.paddingLeft : style.paddingTop);
    const total = horizontal ? layout.clientWidth - padding - parseFloat(style.paddingRight) : layout.clientHeight - padding - parseFloat(style.paddingBottom);
    const minimum = horizontal ? 280 : 140;
    const reserve = horizontal ? 350 : 165;
    const pixels = Math.max(minimum, Math.min(total - reserve, position - (horizontal ? bounds.left : bounds.top) - padding));
    setHeight(pixels / total * 100);
  }
  const stop = () => { offsetRef.current = null; setDragging(false); };
  return <div className={`environment-layout${dragging ? " environment-layout--resizing" : ""}`} data-axis={horizontal ? "horizontal" : "vertical"} ref={layoutRef} style={{ "--service-height": `${height}%` }}>
    {children[0]}
    <div className="pane-divider" role="separator" aria-label={horizontal ? "调整服务卡片和日志宽度" : "调整服务卡片和日志高度"} aria-orientation={horizontal ? "vertical" : "horizontal"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(height)} tabIndex={0} title={horizontal ? "左右拖动调整宽度，双击恢复" : "上下拖动调整高度，双击恢复"}
      onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); offsetRef.current = horizontal ? event.clientX - bounds.left : event.clientY - bounds.top; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }}
      onPointerMove={(event) => { if (offsetRef.current !== null) resizeTo((horizontal ? event.clientX : event.clientY) - offsetRef.current); }}
      onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); stop(); }} onPointerCancel={stop} onLostPointerCapture={stop} onDoubleClick={() => setHeight(44)}
      onKeyDown={(event) => { if (event.key === "Home") { event.preventDefault(); setHeight(44); } else if ((horizontal ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"]).includes(event.key)) { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); resizeTo((horizontal ? bounds.left : bounds.top) + (["ArrowUp", "ArrowLeft"].includes(event.key) ? -24 : 24)); } }} />
    {children[1]}
  </div>;
}
