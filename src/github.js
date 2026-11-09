import { desktop, isDesktop } from "./desktop.js";
import { GithubClient, githubRepositoryUrl } from "../electron/github.mjs";

const browserClient = new GithubClient();

export async function searchGithub(filters) {
  if (!isDesktop) return browserClient.search(filters);
  if (!desktop.github) throw new Error("请重新打开新版启航后使用 GitHub 页面。");
  const result = await desktop.github.search(filters);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

export async function openGithub(fullName) {
  const url = githubRepositoryUrl(fullName);
  if (!isDesktop) { window.open(url, "_blank", "noopener,noreferrer"); return; }
  const result = await desktop.github.open(fullName);
  if (!result.ok) throw new Error(result.error);
}
