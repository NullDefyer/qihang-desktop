import assert from "node:assert/strict";
import test from "node:test";
import { GithubClient, githubRepositoryUrl, githubSearchUrl, normalizeGithubFilters } from "../electron/github.mjs";

const payload = { total_count: 100, items: [{ id: 1, full_name: "microsoft/vscode", html_url: "https://untrusted.invalid", description: "Code editor", stargazers_count: 180000, language: "TypeScript", topics: ["editor"], pushed_at: "2026-11-08T12:00:00Z" }] };
const response = (body = payload) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

test("GitHub filters constrain endpoint, pagination and search qualifiers", () => {
  assert.equal(normalizeGithubFilters(null).minStars, 10000);
  const url = new URL(githubSearchUrl({ query: 'editor stars:0 " unsafe', language: "C++", minStars: 5000, category: "development", page: 900 }));
  assert.equal(url.origin, "https://api.github.com");
  assert.equal(url.pathname, "/search/repositories");
  assert.equal(url.searchParams.get("page"), "50");
  assert.match(url.searchParams.get("q"), /language:"C\+\+"/);
  assert.match(url.searchParams.get("q"), /"stars:0"/);
  assert.match(url.searchParams.get("q"), /stars:>=5000/);
  assert.match(url.searchParams.get("q"), /topic:developer-tools/);
  assert.equal(normalizeGithubFilters({ language: "invalid", page: -5 }).language, "");
  assert.equal(normalizeGithubFilters({ page: -5 }).page, 1);
});

test("GitHub external links are canonical and reject URL injection", () => {
  assert.equal(githubRepositoryUrl("microsoft/vscode"), "https://github.com/microsoft/vscode");
  for (const name of ["https://evil.invalid", "owner/repo?token=x", "owner/..", "owner/repo/other", "owner/repo#x", "owner\\repo", null]) assert.throws(() => githubRepositoryUrl(name));
});

test("GitHub coalesces active queries, caches five minutes, refreshes and sanitizes results", async () => {
  let calls = 0;
  let now = 100000;
  const client = new GithubClient(async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 15)); return response(); }, () => now);
  const [first, second] = await Promise.all([client.search(), client.search()]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.equal(first.items[0].url, "https://github.com/microsoft/vscode");
  assert.equal((await client.search()).cached, true);
  await client.search({ refresh: true });
  assert.equal(calls, 2);
  now += 300001;
  await client.search();
  assert.equal(calls, 3);
  const dirty = new GithubClient(async () => response({ total_count: 3, items: [payload.items[0], { full_name: "bad/../repo" }, { full_name: "owner/repo", stargazers_count: -2 }] }));
  const result = await dirty.search();
  assert.equal(result.items.length, 2);
  assert.equal(result.items[1].stars, 0);
});

test("GitHub rate limits block retries while cached pages remain available", async () => {
  let calls = 0;
  const client = new GithubClient(async () => {
    calls++;
    return calls === 1 ? response() : new Response("", { status: 429, headers: { "retry-after": "120" } });
  }, () => 100000);
  await client.search();
  await assert.rejects(client.search({ page: 2 }), /频率受限/);
  await assert.rejects(client.search({ refresh: true }), /频率受限/);
  assert.equal((await client.search()).cached, true);
  assert.equal(calls, 2);
});

test("GitHub distinguishes empty, partial, malformed and network failures", async () => {
  const empty = new GithubClient(async () => response({ total_count: 0, items: [], incomplete_results: true }));
  assert.deepEqual((await empty.search()).items, []);
  assert.equal((await empty.search()).incomplete, true);
  await assert.rejects(new GithubClient(async () => response({})).search(), /格式异常/);
  await assert.rejects(new GithubClient(async () => { throw new TypeError("fetch failed"); }).search(), /网络或系统代理/);
  await assert.rejects(new GithubClient(async () => new Response("", { status: 422 })).search(), /调整关键词/);
  await assert.rejects(new GithubClient(async () => new Response("", { status: 503 })).search(), /503/);
});
