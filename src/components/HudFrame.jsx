import { useLayoutEffect, useRef, useState } from "react";

// Draw frames in measured pixels so chamfers and light strokes retain their
// thickness when panels resize. Decorative SVG never clips interactive content.
export function HudFrame({ variant = "panel" }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { width: w, height: h } = size;
  const cut = Math.min(variant === "shell" ? 24 : 13, w / 5, h / 5);
  const contour = (inset) => `M${cut + inset} ${inset} H${w - cut - inset} L${w - inset} ${cut + inset} V${h - cut - inset} L${w - cut - inset} ${h - inset} H${cut + inset} L${inset} ${h - cut - inset} V${cut + inset} Z`;
  const corners = `M1 ${cut + 26} V${cut} L${cut} 1 H${cut + 36} M${w - cut - 36} 1 H${w - cut} L${w - 1} ${cut} V${cut + 28} M${w - 1} ${h - cut - 26} V${h - cut} L${w - cut} ${h - 1} H${w - cut - 36} M${cut + 36} ${h - 1} H${cut} L1 ${h - cut} V${h - cut - 28}`;
  const traces = `M${w * 0.3} 5 H${w * 0.38} L${w * 0.38 + 5} 1 M${w * 0.68} ${h - 5} H${w * 0.76} L${w * 0.76 + 4} ${h - 1} M${w - 5} ${cut + 5} V${cut + 24} M5 ${h - cut - 24} V${h - cut - 5}`;
  return <div className={`hud-frame hud-frame--${variant}`} ref={ref} aria-hidden="true">
    {w > 30 && h > 30 ? <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} focusable="false">
      <path className="hud-frame-outline" d={contour(1)} />
      <path className="hud-frame-inset" d={contour(5)} />
      <path className="hud-frame-bloom" d={corners} />
      <path className="hud-frame-corners" d={corners} />
      <path className="hud-frame-traces" d={traces} />
    </svg> : null}
  </div>;
}
