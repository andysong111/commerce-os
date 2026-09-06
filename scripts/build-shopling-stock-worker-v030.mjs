// Compose the unchanged mutation template with the tested 2024 search policy.
// v0.3.0 only changes worker identity, direct role recognition and immediate message acknowledgement.
export function buildStockWorkerV030(base, policy) {
  function once(source, before, after) {
    if (source.split(before).length !== 2) throw new Error(`stock_worker_template_mismatch:${before.slice(0,70)}`);
    return source.replace(before, after);
  }
  let source = once(base, 'const VERSION = "0.1.8";', 'const VERSION = "0.3.0";\n  if (globalThis.__commerceStockWorkerV030) return;\n  globalThis.__commerceStockWorkerV030 = true;\n  let executionContext = {};');
  const start = '  async function searchExact(fieldLabel, token) {';
  const end = '  async function searchGoodsKey(goodsKey) {';
  if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error('stock_search_template_mismatch');
  source = source.slice(0, source.indexOf(start)) + `  async function searchExact(fieldLabel, token) {
    return globalThis.CommerceStockSearchV023.search(fieldLabel, token, {
      scope: [executionContext.jobId, executionContext.executionId, executionContext.stage].join(":"),
      getField: (label) => selectWithOption(label)[0] || null,
      selectField: selectByText, findInput: findSearchInput, setInput,
      clickSearch, rows: matchingRows, waitFor, sleep,
    });
  }\n\n` + source.slice(source.indexOf(end));
  source = once(source, '    const job = message.job || {};', '    const job = message.job || {};\n    executionContext = { jobId: job.jobId, executionId: job.executionId, stage: message.stage };');
  source = once(source, '${job.jobId || "unknown"}:${stage}:${goodsKey}:${location.href}', '${job.jobId || "unknown"}:${job.executionId || ""}:${stage}:${goodsKey}:${location.href}');
  // Do not depend on A6 title/menu text living in the same legacy frame. The unique search option is the role contract.
  source = once(source, 'if (/옵션대량수정/i.test(text) && /(일괄\\s*상태변경|상태\\s*일괄변경)/i.test(text)) return "A6";', 'if (selectWithOption("옵션자체관리코드").length) return "A6";');
  source = once(source, '    const href = String(location.href || "");', `    const href = String(location.href || "");
    if (selectWithOption("옵션자체관리코드").length) return "A6";
    if (/검색항목/.test(text) && selectWithOption("샵플링상품코드").length) {
      if (/쇼핑몰상품수정|상품\\s*수정전송/i.test(text)) return "A21_LIST";
      if (/상품조회수정/i.test(text)) return "A4";
    }`);
  const oldListener = `    void execute(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, code: "STOCK_SYNC_EXECUTE_FAILED", message: norm(error?.message || error) }));
    return true;`;
  const newListener = `    sendResponse({ ok: true, accepted: true, version: VERSION });
    void execute(message).catch(() => null);
    return;`;
  source = once(source, oldListener, newListener);
  const output = `${policy}\n${source}`;
  new Function(output);
  return output;
}
