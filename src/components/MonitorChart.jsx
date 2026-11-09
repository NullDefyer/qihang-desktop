import { useId } from "react";

export function formatBytes(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  const index = Math.min(4, Math.max(0, Math.floor(Math.log(Math.max(1, value)) / Math.log(1024))));
  return `${(value / 1024 ** index).toFixed(index ? 2 : 0)} ${["B", "KB", "MB", "GB", "TB"][index]}`;
}
export const percent = value => value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}%`;
export const timeLabel = value => value ? new Date(value).toLocaleTimeString("zh-CN", { hour12: false }) : "未采集";

// Null samples break the trace; missing/failed data is never drawn as zero.
export function TrendChart({ title, points = [], series, ceiling = 100 }) {
  const id = useId();
  const values = points.flatMap(point => series.map(line => point[line.key])).filter(value => value != null && Number.isFinite(value));
  const max = Math.max(ceiling || 1, ...values, 1);
  const first = points[0]?.at || 0, last = points.at(-1)?.at || first + 1;
  const x = point => 45 + (point.at - first) / Math.max(1, last - first) * 650;
  const y = value => 150 - value / max * 130;
  function path(key) {
    let connect = false;
    return points.map(point => {
      if (point[key] == null || !Number.isFinite(point[key])) { connect = false; return ""; }
      const command = connect ? "L" : "M"; connect = true;
      return `${command}${x(point)},${y(point[key])}`;
    }).join(" ");
  }
  return <section className="monitor-panel trend-panel" aria-label={title}><header><h2>{title}</h2><span>本次连接 · 最近 15 分钟</span></header><div className="trend-legend">{series.map(line => <span key={line.key}><i style={{ background: line.color }} />{line.label}</span>)}</div>{!values.length ? <div className="monitor-empty">等待有效采样数据</div> : <svg viewBox="0 0 720 180" preserveAspectRatio="none" role="img" aria-labelledby={id}><title id={id}>{title}，{points.length} 个采样点</title>{[0, .5, 1].map(ratio => <g key={ratio}><line x1="45" x2="695" y1={y(max * ratio)} y2={y(max * ratio)} className="trend-grid" /><text x="38" y={y(max * ratio) + 4} textAnchor="end">{Math.round(max * ratio)}</text></g>)}{series.map(line => <path key={line.key} d={path(line.key)} fill="none" stroke={line.color} strokeWidth="2" />)}{series.map(line => { const point = points.at(-1); return point?.[line.key] != null ? <circle key={line.key} cx={x(point)} cy={y(point[line.key])} r="3" fill={line.color} /> : null; })}<text x="45" y="174">{timeLabel(first)}</text><text x="695" y="174" textAnchor="end">{timeLabel(last)}</text></svg>}</section>;
}

export function Metric({ label, value, detail, warning }) {
  return <section className={`monitor-metric${warning ? " monitor-metric--warning" : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail || "—"}</small></section>;
}
