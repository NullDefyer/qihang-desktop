import {
  DotsThree,
  PencilSimple,
  Play,
  Stop,
  Trash,
} from "@phosphor-icons/react";
import { useState } from "react";
import { formatUptime, SERVICE_STATUS } from "../model.js";
import { BrandIcon } from "./BrandIcon.jsx";

export function ServiceRow({
  service,
  selected,
  now,
  onSelect,
  onStart,
  onStop,
  onEdit,
  onDelete,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const status = SERVICE_STATUS[service.status] ?? SERVICE_STATUS.stopped;
  const isRunning = ["running", "starting", "stopping"].includes(service.status);

  return (
    <div
      className={`service-row ${selected ? "service-row--selected" : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
    >
      <div className="service-identity">
        <BrandIcon service={service} />
        <div>
          <strong>{service.name}</strong>
          <span>{service.description || "本地服务"}</span>
        </div>
      </div>
      <div className={`service-status service-status--${status.tone}`}>
        <i />
        <span>{status.label}</span>
      </div>
      <div className="service-metric">
        <span>端口</span>
        <strong>{service.port || "-"}</strong>
      </div>
      <div className="service-metric">
        <span>运行时长</span>
        <strong>{service.status === "running" ? formatUptime(service.startedAt, now) : "-"}</strong>
      </div>
      <div className="service-actions" onClick={(event) => event.stopPropagation()}>
        {isRunning ? (
          <button className="icon-button" type="button" title="停止服务" onClick={onStop}>
            <Stop size={18} weight="fill" />
          </button>
        ) : (
          <button className="icon-button" type="button" title="启动服务" onClick={onStart}>
            <Play size={18} weight="fill" />
          </button>
        )}
        <div className="row-menu-wrap">
          <button
            className="icon-button"
            type="button"
            title="更多操作"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <DotsThree size={22} weight="bold" />
          </button>
          {menuOpen ? (
            <div className="row-menu">
              <button type="button" onClick={() => { setMenuOpen(false); onEdit(); }}>
                <PencilSimple size={16} /> 编辑
              </button>
              <button className="danger-action" type="button" onClick={() => { setMenuOpen(false); onDelete(); }}>
                <Trash size={16} /> 删除
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
