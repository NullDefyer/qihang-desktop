import { FolderOpen, Info, MagnifyingGlass } from "@phosphor-icons/react";
import { useState } from "react";
import { SERVICE_TEMPLATES, serviceFromTemplate } from "../service-templates.js";
import { PersonalDialog } from "./PersonalDialog.jsx";
import { ServiceIcon } from "./ServiceIcon.jsx";

export function ServiceDrawer({ service, onChooseFolder, onClose, onSubmit }) {
  const [form, setForm] = useState(() => service ? { templateId: service.templateId || "custom", name: service.name || "", description: service.description || "", folder: service.folder || "", startCommand: service.startCommand || "", port: service.port || "" } : serviceFromTemplate("nacos"));
  const [query, setQuery] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const template = SERVICE_TEMPLATES.find((item) => item.id === form.templateId) || SERVICE_TEMPLATES.at(-1);
  const templates = SERVICE_TEMPLATES.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); setDirty(true); }
  function chooseTemplate(id) {
    if (id === form.templateId) return;
    if (dirty && !window.confirm("切换模板会替换当前表单内容，是否继续？")) return;
    setForm(serviceFromTemplate(id)); setDirty(false); setError("");
  }
  function submit(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.folder.trim() || !form.startCommand.trim()) { setError("请填写服务名称、服务目录和启动命令。"); return; }
    if (form.port && (!/^\d+$/.test(form.port) || Number(form.port) < 1 || Number(form.port) > 65535)) { setError("端口应在 1–65535 之间，也可以留空。"); return; }
    onSubmit({ ...form, isExample: false, name: form.name.trim(), description: form.description.trim() || "本地服务", folder: form.folder.trim(), startCommand: form.startCommand.trim(), port: form.port.trim() });
  }
  return <PersonalDialog title={service ? "编辑服务" : "添加服务"} onClose={onClose} className={service ? "service-editor" : "service-template-dialog"}>
    <form onSubmit={submit} className="service-form">
      <div className="service-template-body">
        {!service ? <aside className="service-template-sidebar" aria-label="常用中间件模板">
          <strong>常用中间件</strong>
          <label className="service-template-search"><MagnifyingGlass size={15} /><input autoFocus aria-label="搜索中间件模板" placeholder="搜索中间件名称" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="service-template-list">{templates.map((item) => <button type="button" key={item.id} aria-pressed={template.id === item.id} className={template.id === item.id ? "is-selected" : ""} onClick={() => chooseTemplate(item.id)}><ServiceIcon service={item} /><span>{item.name}</span></button>)}{!templates.length ? <p>没有匹配的模板</p> : null}</div>
        </aside> : null}
        <div className="service-template-fields">
          {!service || service.isExample ? <><div className="service-template-heading"><ServiceIcon service={template} /><strong>{template.name}</strong><span>配置模板</span></div><p className="service-template-notice"><Info size={16} />模板只填写配置，不会安装或自动启动服务。</p></> : null}
          <label className="field-label"><span>服务名称 *</span><input autoFocus={Boolean(service)} required aria-label="服务名称" value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：Redis" /></label>
          <label className="field-label"><span>描述</span><input aria-label="服务描述" value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="例如：本地缓存服务" /></label>
          <label className="field-label"><span>服务目录 *</span><div className="folder-field"><input required aria-label="服务目录" value={form.folder} onChange={(event) => update("folder", event.target.value)} placeholder="选择服务安装根目录（不是 bin 目录）" /><button type="button" onClick={async () => { try { const folder = await onChooseFolder(); if (folder) update("folder", folder); } catch (error) { setError(error.message); } }}><FolderOpen size={16} />选择文件夹</button></div></label>
          <label className="field-label"><span>启动命令 *</span><textarea required aria-label="启动命令" value={form.startCommand} onChange={(event) => update("startCommand", event.target.value)} placeholder="填写 Windows 启动命令" /><small>启动命令将在所选目录内执行，可自由修改。</small></label>
          <p className="service-template-help">{template.hint}</p>
          <label className="field-label"><span>服务端口（可选）</span><input aria-label="服务端口" inputMode="numeric" value={form.port} onChange={(event) => update("port", event.target.value.replace(/\D/g, ""))} placeholder="例如：6379" /><small>仅用于展示；实际监听端口请同步修改中间件的配置文件。</small></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
      </div>
      <div className="drawer-actions"><button type="button" className="button button--secondary" onClick={onClose}>取消</button><button className="button button--primary">保存服务</button></div>
    </form>
  </PersonalDialog>;
}
