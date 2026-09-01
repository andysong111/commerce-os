import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0310/download/route.ts", import.meta.url);

test("v0.3.10 retries A18 start once after an automatic reload", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /const VERSION = "0\.3\.10"/);
  assert.match(source, /startWithA18Recovery/);
  assert.match(source, /chrome\.tabs\.reload\(tab\.id\)/);
  assert.match(source, /waitTabComplete\(tab\.id, 12000\)/);
  assert.match(source, /await sleep\(700\)/);
  assert.match(source, /const second = await sendStart\(tab\.id, jobIds\)/);
});

test("v0.3.10 preserves selection mode and keeps A18 out of target selection", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /getV039Package/);
  assert.match(source, /SEO 대량등록 Shopling 업로드 목록/);
  assert.match(source, /A18 화면 상품목록과 무관/);
  assert.match(source, /3\+3 채널 처리/);
  assert.match(source, /content\.includes\("document\.documentElement\.appendChild\(box\)"\)/);
});
