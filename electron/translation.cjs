async function translateText({ text, direction }, fetcher = fetch) {
  if (typeof text !== "string" || !text.trim()) throw new Error("请输入要翻译的内容。");
  if (Buffer.byteLength(text, "utf8") > 500) throw new Error("当前翻译服务单次最多支持 500 UTF-8 字节，请缩短文本后重试。");
  if (!["zh-en", "en-zh"].includes(direction)) throw new Error("请选择中译英或英译中。");
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", direction === "zh-en" ? "zh-CN|en" : "en|zh-CN");
  let response;
  try { response = await fetcher(url.href, { signal: AbortSignal.timeout(15000), cache: "no-store" }); }
  catch { throw new Error("翻译服务连接失败或超时，请检查网络后重试。"); }
  if (!response.ok) throw new Error(`翻译服务暂不可用（HTTP ${response.status}）。`);
  const data = await response.json();
  if (Number(data.responseStatus) !== 200 || data.quotaFinished || typeof data.responseData?.translatedText !== "string") {
    throw new Error(data.quotaFinished || Number(data.responseStatus) === 429 ? "翻译服务额度已用完，请稍后重试。" : "翻译服务未返回有效结果，请稍后重试。");
  }
  return { text: data.responseData.translatedText, provider: "MyMemory" };
}

module.exports = { translateText };
