import { X } from "@phosphor-icons/react";

export function PersonalDialog({ title, onClose, children, className = "" }) {
  return <div className="remote-modal-backdrop" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}><section className={`remote-modal personal-dialog ${className}`} role="dialog" aria-modal="true" aria-label={title}><div className="remote-modal-header"><h2>{title}</h2><button className="quiet-icon" aria-label="关闭对话框" onClick={onClose}><X /></button></div>{children}</section></div>;
}
