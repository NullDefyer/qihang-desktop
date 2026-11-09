import { useEffect, useState } from "react";
import { THEMES, ACCENTS } from "../themes.js";
import { personalCall } from "../personal.js";
import { isDesktop } from "../desktop.js";

export function SettingsView({ theme, onThemeChange, preferences, onPreferencesChange, onExport, onImport, onChangeDataDirectory, report }) {
  const [shortcut, setShortcut] = useState(preferences.shortcut);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const change = (key, value) => onPreferencesChange({ ...preferences, [key]: value });
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => personalCall("status").then((value) => { if (active) setStatus(value); }).catch((error) => { if (active) report(error.message); }), 600);
    return () => { active = false; clearTimeout(timer); };
  }, [preferences.shortcut, report]);
  async function run(action, success) {
    setBusy(true);
    try { const result = await action(); if (result && success) report(success); }
    catch (error) { report(error.message); }
    finally { setBusy(false); }
  }
  async function changeDirectory(kind) {
    setBusy(true);
    try {
      const result = kind === "data" ? await onChangeDataDirectory() : await personalCall("change-backup-directory");
      if (result) { setStatus((current) => ({ ...current, ...result })); report(kind === "data" ? "数据目录已更改，记录已迁移；原文件保留。" : "备份目录已更改；旧备份保留在原位置。"); }
    } catch (error) { report(error.message); }
    finally { setBusy(false); }
  }
  return <div className="settings-page"><header className="settings-heading"><h1>设置</h1><p>管理外观与本地行为。</p><span className="settings-save-hint">自动保存在本机</span></header>
    <div className="settings-grid">
      <section className="settings-section appearance-settings"><div className="settings-section-title"><h2>外观主题</h2></div>
        <div className="appearance-top"><div className="appearance-controls"><label className="setting-label">应用主题</label><div className="mode-options">{THEMES.map((item) => <button key={item.id} aria-label={`使用${item.label}主题`} aria-pressed={theme === item.id} onClick={() => onThemeChange(item.id)}>{item.label}</button>)}</div>
          <label className="setting-label">材质风格</label><div className="mode-options material-options">{[["frosted", "毛玻璃"], ["liquid", "液态玻璃"], ["plain", "简洁"]].map(([id, label]) => <button key={id} aria-label={`使用${label}材质`} aria-pressed={preferences.material === id} onClick={() => change("material", id)}>{label}</button>)}</div>
          <label className="setting-label">主题色</label><div className="accent-options">{ACCENTS.map((item) => <button key={item.id} aria-label={`使用${item.label}强调色`} aria-pressed={preferences.accent === item.id} onClick={() => change("accent", item.id)}><i style={{ background: item.sample }} /><span>{item.label}</span></button>)}</div>
        </div><div className="appearance-preview" aria-hidden="true"><div><i /><i /><i /></div><aside>⌂</aside><section><span /><span /><span /><span /></section></div></div>
        <label className="theme-intensity"><span>玻璃透明度 <output>{100 - preferences.glassOpacity}%</output></span><input aria-label="玻璃透明度" type="range" min="5" max="60" step="5" disabled={preferences.material === "plain"} value={100 - preferences.glassOpacity} onChange={(event) => change("glassOpacity", 100 - Number(event.target.value))} /></label>
        <label className="theme-intensity"><span>背景模糊 <output>{preferences.glassBlur}px</output></span><input aria-label="背景模糊" type="range" min="0" max="40" step="2" disabled={preferences.material === "plain"} value={preferences.glassBlur} onChange={(event) => change("glassBlur", Number(event.target.value))} /></label>
        <label className="theme-intensity"><span>背景强度 <output>{preferences.backgroundIntensity}%</output></span><input aria-label="背景强度" type="range" min="0" max="100" step="5" value={preferences.backgroundIntensity} onChange={(event) => change("backgroundIntensity", Number(event.target.value))} /></label>
        <label className="remote-check motion-setting"><input type="checkbox" checked={preferences.motionEffects} onChange={(event) => change("motionEffects", event.target.checked)} />动态效果 <small>关闭后减少界面动效；尊重系统减少动态效果设置。</small></label>
      </section>
      <section className="settings-section"><div className="settings-section-title"><h2>窗口与快捷键</h2></div><div className="preference-grid">
        <label className="field-label"><span>打开应用时进入</span><select value={preferences.startPage} onChange={(event) => change("startPage", event.target.value)}>{[["home", "首页"], ["services", "服务"], ["remote", "远程"], ["notes", "笔记"], ["tools", "工具箱"], ["github", "GitHub 高星项目"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field-label"><span>点击关闭窗口</span><select value={preferences.closeBehavior} onChange={(event) => change("closeBehavior", event.target.value)}><option value="tray">最小化到系统托盘</option><option value="quit">退出应用</option></select></label>
        <label className="field-label"><span>真正退出时</span><select value={preferences.exitBehavior} onChange={(event) => change("exitBehavior", event.target.value)}><option value="ask">有运行服务时询问</option><option value="stop">停止本工具启动的服务并退出</option></select></label>
        <label className="field-label"><span>全局搜索快捷键</span><input value={shortcut} onChange={(event) => setShortcut(event.target.value)} onBlur={() => change("shortcut", shortcut.trim())} placeholder="Alt+Space" /><small>留空关闭 · 当前注册：{status?.shortcut || "未注册"}</small></label>
      </div></section>
      <section className="settings-section"><div className="settings-section-title"><h2>存储目录</h2></div>{[["data", "数据目录", status?.dataDirectory], ["backup", "备份目录", status?.backupDirectory]].map(([kind, label, value]) => <div className="storage-directory-row" key={kind}><label className="field-label"><span>{label}</span><input aria-label={`当前${label}`} readOnly value={value || (isDesktop ? "正在读取目录…" : "仅桌面版可设置")} title={value} /></label><button className="button button--secondary" disabled={busy || !value} onClick={() => changeDirectory(kind)}>{kind === "data" ? "更改数据目录" : "更改备份目录"}</button><button className="quiet-button" disabled={busy || !value} onClick={() => run(() => personalCall(kind === "data" ? "open-data" : "open-backups"), "")}>打开</button></div>)}<p className="home-help">更改数据目录会迁移记录并保留原文件；两个目录独立，旧备份留在原位置。</p></section>
      <section className="settings-section"><div className="settings-section-title"><h2>备份与恢复</h2></div><label className="remote-check backup-check"><input type="checkbox" checked={preferences.autoBackup} onChange={(event) => change("autoBackup", event.target.checked)} />每日自动备份</label><p className="home-help">保留最近 14 天的备份。</p><div className="settings-actions"><button className="button button--primary" disabled={busy} onClick={() => run(onExport, "备份已导出。")}>导出配置</button><button className="button button--secondary" disabled={busy} onClick={() => run(onImport, "配置已恢复。")}>恢复配置</button><button className="button button--secondary" disabled={busy} onClick={() => run(() => personalCall("backup"), "已创建本机备份。")}>立即备份</button></div><p className="settings-info">恢复前会自动备份；导出不包含远程密码。</p><p className="home-help">服务、笔记、快捷启动、待办及倒计时随配置备份。</p></section>
    </div><section className="settings-about-strip">关于启航 · 版本 0.1.5 · 数据保存在本机 · 托盘：{status?.tray ? "已启用" : "未启用 / 浏览器预览"}</section>
  </div>;
}
