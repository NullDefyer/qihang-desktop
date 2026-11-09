// Public GitHub search only. Both runtimes share validation, cache and errors;
// Electron injects net.fetch so Windows/system proxy settings remain effective.
export const GITHUB_LANGUAGES = ["", "JavaScript", "TypeScript", "Python", "Java", "Go", "Rust", "C++", "C#", "C", "Dart", "Vue", "Shell"];
export const GITHUB_CATEGORIES = [
  { id: "all", label: "全部", topic: "" },
  { id: "development", label: "开发工具", topic: "developer-tools" },
  { id: "ai", label: "人工智能", topic: "artificial-intelligence" },
  { id: "productivity", label: "效率工具", topic: "productivity" },
  { id: "learning", label: "学习资源", topic: "learning-resources" },
];
const STAR_LIMITS = [1000, 5000, 10000, 50000, 100000];
const CACHE_MS = 5 * 60 * 1000;

export function normalizeGithubFilters(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  return {
    query: typeof input.query === "string" ? input.query.trim().slice(0, 160) : "",
    language: GITHUB_LANGUAGES.includes(input.language) ? input.language : "",
    minStars: STAR_LIMITS.includes(Number(input.minStars)) ? Number(input.minStars) : 10000,
    category: GITHUB_CATEGORIES.some((item) => item.id === input.category) ? input.category : "all",
    sort: input.sort === "updated" ? "updated" : "stars",
    page: Math.max(1, Math.min(50, Math.floor(Number(input.page)) || 1)),
  };
}

// Never open remote-provided URLs. Construct an exact HTTPS repository URL
// from a validated owner/repository identifier, also at the IPC boundary.
export function githubRepositoryUrl(fullName) {
  if (typeof fullName !== "string" || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})\/[a-zA-Z0-9_.-]{1,100}$/.test(fullName)) throw new Error("GitHub 项目地址无效。");
  if ([".", ".."].includes(fullName.split("/")[1])) throw new Error("GitHub 项目地址无效。");
  return `https://github.com/${fullName}`;
}

export function githubSearchUrl(value) {
  const filters = normalizeGithubFilters(value);
  // Quote search words to prevent a pasted qualifier from overriding filters.
  const words = filters.query.replace(/["\\\x00-\x1f]/g, " ").split(/\s+/).filter(Boolean).map((word) => `"${word}"`).join(" ");
  const topic = GITHUB_CATEGORIES.find((item) => item.id === filters.category).topic;
  const q = [words, `stars:>=${filters.minStars}`, "is:public", "fork:false", "archived:false", filters.language ? `language:"${filters.language}"` : "", topic ? `topic:${topic}` : ""].filter(Boolean).join(" ");
  const url = new URL("https://api.github.com/search/repositories");
  url.search = new URLSearchParams({ q, sort: filters.sort, order: "desc", per_page: "20", page: String(filters.page) }).toString();
  return url.href;
}

function repository(item) {
  let url;
  try { url = githubRepositoryUrl(item?.full_name); } catch { return null; }
  const count = (value) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return {
    id: item.id, fullName: item.full_name, url,
    avatarUrl: Number.isSafeInteger(item.owner?.id) && item.owner.id > 0 ? `https://avatars.githubusercontent.com/u/${item.owner.id}?s=80&v=4` : "",
    description: typeof item.description === "string" ? item.description.slice(0, 1000) : "",
    language: typeof item.language === "string" ? item.language.slice(0, 40) : "",
    stars: count(item.stargazers_count), forks: count(item.forks_count),
    updatedAt: Number.isFinite(Date.parse(item.pushed_at)) ? item.pushed_at : null,
    topics: Array.isArray(item.topics) ? item.topics.filter((topic) => typeof topic === "string").slice(0, 4) : [],
  };
}

export class GithubClient {
  constructor(fetcher = globalThis.fetch, clock = Date.now) {
    this.fetcher = fetcher;
    this.clock = clock;
    this.cache = new Map();
    this.pending = new Map();
    this.retryAt = 0;
  }

  async search(value) {
    const url = githubSearchUrl(value);
    const cached = this.cache.get(url);
    // Refresh may bypass the cache, never GitHub's rate limit or an active request.
    if (!value?.refresh && cached && this.clock() - cached.fetchedAt < CACHE_MS) return { ...cached, cached: true };
    if (this.pending.has(url)) return this.pending.get(url);
    if (this.retryAt > this.clock()) throw new Error(`GitHub 请求频率受限，请在 ${new Date(this.retryAt).toLocaleTimeString("zh-CN", { hour12: false })} 后重试。`);
    if (this.pending.size >= 3) throw new Error("正在查询 GitHub，请稍候再试。");
    const request = this.fetchSearch(url).finally(() => this.pending.delete(url));
    this.pending.set(url, request);
    return request;
  }

  async fetchSearch(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetcher(url, { signal: controller.signal, redirect: "error", headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
      if (!response.ok) {
        if (response.status === 403 || response.status === 429) {
          const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
          const retry = Number(response.headers.get("retry-after")) * 1000;
          this.retryAt = Math.max(this.clock() + 60000, Number.isFinite(reset) ? reset : 0, this.clock() + (Number.isFinite(retry) ? retry : 0));
          throw new Error(`GitHub 请求频率受限，请在 ${new Date(this.retryAt).toLocaleTimeString("zh-CN", { hour12: false })} 后重试。`);
        }
        if (response.status === 422) throw new Error("GitHub 无法处理此搜索，请缩短或调整关键词。");
        throw new Error(`GitHub 暂时不可用（HTTP ${response.status}），请稍后重试。`);
      }
      const body = await response.json();
      if (!Array.isArray(body.items) || !Number.isFinite(body.total_count)) throw new Error("GitHub 返回的数据格式异常，请稍后重试。");
      const result = {
        items: body.items.slice(0, 20).map(repository).filter(Boolean),
        total: Math.max(0, body.total_count), incomplete: body.incomplete_results === true,
        fetchedAt: this.clock(), cached: false,
      };
      this.cache.delete(url);
      this.cache.set(url, result);
      if (this.cache.size > 30) this.cache.delete(this.cache.keys().next().value);
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("连接 GitHub 超时，请检查网络或系统代理后重试。");
      if (error instanceof TypeError) throw new Error("无法连接 GitHub，请检查网络或系统代理后重试。");
      if (error instanceof SyntaxError) throw new Error("GitHub 返回的数据格式异常，请稍后重试。");
      throw error;
    } finally { clearTimeout(timer); }
  }
}
