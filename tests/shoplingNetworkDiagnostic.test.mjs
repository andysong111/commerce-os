import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [diagnostic, page] = await Promise.all([
  readFile("src/lib/shopling/shoplingNetworkDiagnostic.ts", "utf8"),
  readFile(
    "src/app/product-decision-agent/live-refresh/diagnostic/page.tsx",
    "utf8",
  ),
]);

test("diagnostic performs one bounded read-only Shopling order request", () => {
  assert.match(diagnostic, /buildShoplingReadRequestXml\("orders"/);
  assert.match(diagnostic, /start: day/);
  assert.match(diagnostic, /end: day/);
  assert.match(diagnostic, /postShoplingXml\(config\.ordersUrl, xml/);
  assert.match(diagnostic, /timeoutMs: 20_000/);
  assert.match(diagnostic, /await response\.text\(\)/);
  assert.doesNotMatch(diagnostic, /price.*change|order.*status.*change|inventory.*write/i);
});

test("diagnostic exposes only allowlisted network cause fields", () => {
  for (const field of [
    "name",
    "code",
    "message",
    "errno",
    "syscall",
    "hostname",
    "address",
    "port",
  ]) {
    assert.match(diagnostic, new RegExp(`\\b${field}:`));
  }
  assert.match(diagnostic, /\[redacted\]/);
  assert.match(diagnostic, /new URL\(url\)\.origin/);
  assert.match(diagnostic, /slice\(0, MAX_TEXT\)/);
});

test("credentials and raw request or response bodies are never displayed or persisted", () => {
  assert.doesNotMatch(page, /SHOPLING_API_AUTH_KEY|SHOPLING_LOGIN_ID|SHOPLING_COMPANY_ID/);
  assert.doesNotMatch(page, /request XML|response body/i);
  assert.doesNotMatch(diagnostic, /console\.(?:log|error|warn)/);
  assert.doesNotMatch(diagnostic, /commerce_operation_runs|Supabase|insert|upsert|writeFile/);
  assert.doesNotMatch(diagnostic, /return\s+xml/);
});

test("operator page states that the diagnostic is read-only and shows transport scope", () => {
  assert.match(page, /읽기 전용 연결 진단/);
  assert.match(page, /상품·가격·주문상태를 변경하지 않습니다/);
  assert.match(page, /요청 XML, 주문 응답 원문/);
  assert.match(page, /Shopling 한정 DH 호환/);
  assert.match(page, /서버 인증서 검증과 TLS 1\.2/);
});
