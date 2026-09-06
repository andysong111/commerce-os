// Compose the unchanged mutation template with the tested 2024 search policy.
// v0.3.2 keeps the price-engine workspace/result-row handling and fixes the live A6
// mutation contract: the same '옵션상태' select contains 판매중/단종/품절/미사용.
export function buildStockWorkerV030(base, policy) {
  function once(source, before, after) {
    if (source.split(before).length !== 2) throw new Error(`stock_worker_template_mismatch:${before.slice(0,70)}`);
    return source.replace(before, after);
  }
  let source = once(base, 'const VERSION = "0.1.8";', 'const VERSION = "0.3.2";\n  if (globalThis.__commerceStockWorkerV032) return;\n  globalThis.__commerceStockWorkerV032 = true;\n  let executionContext = {};');
  const start = '  async function searchExact(fieldLabel, token) {';
  const end = '  async function searchGoodsKey(goodsKey) {';
  if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error('stock_search_template_mismatch');
  source = source.slice(0, source.indexOf(start)) + `  async function searchExact(fieldLabel, token) {
    return globalThis.CommerceStockSearchV023.search(fieldLabel, token, {
      scope: [executionContext.jobId, executionContext.executionId, executionContext.stage].join(":"),
      getField: (label) => selectWithOption(label)[0] || null,
      selectField: selectByText, findInput: findSearchInput, setInput,
      clickSearch, rows: matchingRows, waitFor, sleep,
      resultCount: () => {
        const match = bodyText().match(/총\\s*조회수\\s*[:：]?\\s*([\\d,]+)\\s*건/i);
        return match ? Number(match[1].replace(/,/g, "")) : null;
      },
    });
  }\n\n` + source.slice(source.indexOf(end));
  source = once(source, '    const job = message.job || {};', '    const job = message.job || {};\n    executionContext = { jobId: job.jobId, executionId: job.executionId, stage: message.stage };');
  source = once(source, '${job.jobId || "unknown"}:${stage}:${goodsKey}:${location.href}', '${job.jobId || "unknown"}:${job.executionId || ""}:${stage}:${goodsKey}:${location.href}');
  // Price-resend worker does not reject a legacy <tr> just because getBoundingClientRect/offsetParent is odd.
  // Keep exact-token + checkbox gates, only remove the visibility prerequisite.
  source = once(
    source,
    '      .filter((row) => visible(row) && regex.test(norm(row.textContent).toUpperCase()))',
    '      .filter((row) => regex.test(norm(row.textContent).toUpperCase()))',
  );
  // Live A6 evidence: there is one toolbar select whose placeholder is '옵션상태' and whose
  // same option list contains 판매중/단종/품절/미사용. Select the target on that control directly.
  const oldA6Status = `    const targetLabel = desiredKorean(job.desiredStatus);
    const selector = selectWithOption("옵션상태")[0] || null;
    if (!selector || !selectByText(selector, "옵션상태")) {
      return { ok: false, code: "A6_OPTION_STATUS_FIELD_NOT_FOUND", message: "A6 선택정보의 옵션상태를 찾지 못했습니다." };
    }
    const targetSelects = selectWithOption(targetLabel).filter((select) => select !== selector);
    targetSelects.sort((left, right) => {
      const base = selector.getBoundingClientRect();
      return Math.abs(left.getBoundingClientRect().top - base.top) - Math.abs(right.getBoundingClientRect().top - base.top);
    });
    const statusSelect = targetSelects[0] || null;
    if (!statusSelect || !selectByText(statusSelect, targetLabel, true)) {
      return { ok: false, code: "A6_TARGET_STATUS_NOT_FOUND", message: \`A6 옵션상태 \${targetLabel} 선택값을 찾지 못했습니다.\` };
    }
    const button = buttonByText(/^(?:일괄\\s*상태변경|상태\\s*일괄변경)$/i);`;
  const newA6Status = `    const targetLabel = desiredKorean(job.desiredStatus);
    const statusSelects = selectWithOption("옵션상태").filter((select) => {
      const labels = [...select.options].map((option) => norm(option.textContent));
      return labels.includes("옵션상태") && labels.includes("판매중") && labels.includes("품절");
    });
    const button = buttonByText(/^(?:일괄\\s*상태변경|상태\\s*일괄변경)$/i);
    if (!button) return { ok: false, code: "A6_BULK_STATUS_BUTTON_NOT_FOUND", message: "A6 상태 일괄변경 버튼을 찾지 못했습니다." };
    if (!statusSelects.length) {
      return { ok: false, code: "A6_OPTION_STATUS_FIELD_NOT_FOUND", message: "A6 옵션상태 변경 드롭다운(판매중/품절)을 찾지 못했습니다." };
    }
    const buttonRect = button.getBoundingClientRect();
    statusSelects.sort((left, right) => {
      const lr = left.getBoundingClientRect();
      const rr = right.getBoundingClientRect();
      const ls = Math.abs(lr.top - buttonRect.top) + Math.abs(lr.right - buttonRect.left) / 4;
      const rs = Math.abs(rr.top - buttonRect.top) + Math.abs(rr.right - buttonRect.left) / 4;
      return ls - rs;
    });
    const statusSelect = statusSelects[0];
    if (!selectByText(statusSelect, targetLabel, true)) {
      return { ok: false, code: "A6_TARGET_STATUS_NOT_FOUND", message: \`A6 옵션상태 드롭다운에서 \${targetLabel}을 선택하지 못했습니다.\` };
    }
    const selectedStatus = norm(statusSelect.options?.[statusSelect.selectedIndex]?.textContent);
    if (selectedStatus !== targetLabel) {
      return { ok: false, code: "A6_TARGET_STATUS_VERIFY_FAILED", message: \`A6 옵션상태가 \${targetLabel}로 유지되지 않아 일괄 변경을 차단했습니다.\`, evidence: { selectedStatus, targetLabel } };
    }`;
  source = once(source, oldA6Status, newA6Status);
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
