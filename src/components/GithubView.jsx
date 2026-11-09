import { ArrowSquareOut, ArrowClockwise, CaretLeft, CaretRight, Copy, GithubLogo, MagnifyingGlass, Star, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { GITHUB_CATEGORIES, GITHUB_LANGUAGES, normalizeGithubFilters } from "../../electron/github.mjs";
import { openGithub, searchGithub } from "../github.js";

const INITIAL = normalizeGithubFilters();
const LANGUAGE_COLORS = { JavaScript: "#bd9000", TypeScript: "#3178c6", Python: "#3572a5", Java: "#b07219", Go: "#00a5bd", Rust: "#b66b36", Dart: "#008b80", Vue: "#2b9c70", "C++": "#bf3772" };
const count = (value) => value >= 10000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k` : value.toLocaleString("zh-CN");

export function GithubView({ report }) {
  const [filters, setFilters] = useState(INITIAL);
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const listRef = useRef(null);
  const refreshRef = useRef(0);

  useEffect(() => {
    let active = true;
    const force = refresh !== refreshRef.current;
    refreshRef.current = refresh;
    setBusy(true); setError(""); setResult(null);
    searchGithub({ ...filters, refresh: force }).then((value) => {
      if (active) { setResult(value); listRef.current?.scrollTo(0, 0); }
    }).catch((failure) => { if (active) setError(failure.message); }).finally(() => { if (active) setBusy(false); });
    // Ignore responses from a superseded filter request or an unmounted page.
    return () => { active = false; };
  }, [filters, refresh]);

  const change = (key, value) => setFilters((current) => normalizeGithubFilters({ ...current, [key]: value, query, page: 1 }));
  const pages = Math.max(1, Math.ceil(Math.min(1000, result?.total || 0) / 20));
  async function open(item) { try { await openGithub(item.fullName); } catch (failure) { report(failure.message); } }
  async function copy(item) { try { await navigator.clipboard.writeText(item.url); report("已复制项目链接。"); } catch { report("复制失败，请重试。"); } }

  return <div className="github-page">
    <header className="github-heading"><div><h1>GitHub 高星项目</h1><p>发现值得关注的开源项目</p></div><div><span>{result ? `${result.cached ? "缓存于" : "更新于"} ${new Date(result.fetchedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "GitHub 公开项目"}</span><button className="button button--secondary" disabled={busy} onClick={() => setRefresh((value) => value + 1)}><ArrowClockwise size={17} />刷新</button></div></header>
    <form className="github-filters" onSubmit={(event) => { event.preventDefault(); change("query", query); }}>
      <label className="search-field"><MagnifyingGlass size={19} /><input aria-label="搜索 GitHub 项目" maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目、作者或关键词…" /></label><button className="button button--primary" type="submit">搜索</button>
      <label>语言<select aria-label="GitHub 项目语言" value={filters.language} onChange={(event) => change("language", event.target.value)}>{GITHUB_LANGUAGES.map((language) => <option value={language} key={language}>{language || "全部语言"}</option>)}</select></label>
      <label>最低星数<select aria-label="GitHub 最低星数" value={filters.minStars} onChange={(event) => change("minStars", event.target.value)}>{[1000, 5000, 10000, 50000, 100000].map((stars) => <option value={stars} key={stars}>{stars / 1000}k+</option>)}</select></label>
      <label>排序<select aria-label="GitHub 项目排序" value={filters.sort} onChange={(event) => change("sort", event.target.value)}><option value="stars">星数从高到低</option><option value="updated">最近推送优先</option></select></label>
    </form>
    <div className="github-categories" role="group" aria-label="GitHub 项目分类">{GITHUB_CATEGORIES.map((category) => <button className="button button--secondary" key={category.id} aria-pressed={filters.category === category.id} onClick={() => change("category", category.id)}>{category.label}</button>)}</div>
    <section className="github-results" aria-label="GitHub 项目列表" aria-busy={busy}>
      <div className="github-list" ref={listRef}>
        {busy ? <div className="github-empty" role="status"><GithubLogo size={40} /><strong>正在获取高星项目…</strong><p>正在查询 GitHub 公开项目，请稍候。</p></div> : error ? <div className="github-empty" role="alert"><WarningCircle size={38} /><strong>暂时无法获取项目</strong><p>{error}</p><button className="button button--primary" onClick={() => setRefresh((value) => value + 1)}>重试</button></div> : result?.items.length ? result.items.map((item) => <article className="github-repository" key={item.fullName}>
          <div className="github-repo-icon">{item.avatarUrl ? <img src={item.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.nextElementSibling.hidden = false; }} /> : null}<span hidden={Boolean(item.avatarUrl)}><GithubLogo size={28} weight="duotone" /></span></div>
          <div className="github-repo-content"><button className="github-repo-name" onClick={() => open(item)} title={`在浏览器中打开 ${item.fullName}`}>{item.fullName}</button><p>{item.description || "此项目暂未提供简介。"}</p><div className="github-topics">{item.topics.map((topic) => <span key={topic}>{topic}</span>)}</div><div className="github-meta"><span><i style={{ background: LANGUAGE_COLORS[item.language] || "var(--text-muted)" }} />{item.language || "未标注语言"}</span><span title={`${item.stars.toLocaleString("zh-CN")} stars`}><Star size={16} />{count(item.stars)}</span><span>最近推送 {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString("zh-CN") : "未知"}</span></div></div>
          <div className="github-repo-actions"><button className="button button--secondary" onClick={() => open(item)} aria-label={`打开 ${item.fullName}`}>GitHub<ArrowSquareOut size={17} /></button><button className="button button--secondary" onClick={() => copy(item)} aria-label={`复制 ${item.fullName} 链接`}><Copy size={17} /><span>复制链接</span></button></div>
        </article>) : <div className="github-empty"><MagnifyingGlass size={38} /><strong>没有匹配的项目</strong><p>试试减少关键词、降低星数或更换分类。</p></div>}
      </div>
      <footer className="github-pagination"><small>{result ? `匹配 ${result.total.toLocaleString("zh-CN")} 个项目${result.total > 1000 ? " · GitHub 仅开放前 1000 条" : ""}${result.incomplete ? " · 当前为部分搜索结果，可稍后刷新" : ""}` : "公开搜索 · 无需登录"} · 每页 20 条</small><div><button className="button button--secondary" disabled={busy || filters.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}><CaretLeft size={14} />上一页</button><span>{filters.page} / {pages}</span><button className="button button--secondary" disabled={busy || !result || filters.page >= pages} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>下一页<CaretRight size={14} /></button></div></footer>
    </section>
    <p className="github-help">来源：GitHub Search API · 星数以查询时为准 · 分类按项目 topic 筛选 · 查询缓存 5 分钟，刷新可重新获取。</p>
  </div>;
}
