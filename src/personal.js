import { desktop, isDesktop } from "./desktop.js";

export async function personalCall(action, value) {
  if (isDesktop) {
    if (!desktop.personal) throw new Error("请重新打开新版启航后使用。");
    const result = await desktop.personal.call(action, value);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }
  if (action === "status") return { shortcut: "页面内 Alt+Space", tray: false, notifications: false };
  if (action === "open-target" && /^https?:\/\//i.test(value)) { window.open(value, "_blank", "noopener,noreferrer"); return true; }
  if (action === "choose-target") return null;
  throw new Error("此功能需要桌面版；浏览器预览不会访问本机文件和程序。");
}
