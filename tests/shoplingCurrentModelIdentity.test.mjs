import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildShoplingCurrentModelLookupXml,
  isExactAaaModelNo,
  resolveShoplingCurrentModelIdentities,
} from "../src/lib/shopling/shoplingCurrentModelIdentityResolver.ts";

const [reader, audit, page] = await Promise.all([
  readFile("src/lib/shopling/shoplingCurrentModelIdentity.ts", "utf8"),
  readFile("src/lib/stage8ShoplingLiveModelIdentityAudit.ts", "utf8"),
  readFile("src/app/stage8-shopling-live-model-identity/page.tsx", "utf8"),
]);

test("explicit product lookup requests model_no and model_nm without options", () => {
  const xml = buildShoplingCurrentModelLookupXml(
    { loginId: "login", companyId: "company", authKey: "secret" },
    ["121111", "121112"],
    "goods_key,ptn_goods_cd,prod_nm,model_no,model_nm,sale_status",
  );
  assert.match(xml, /<prod_id><!\[CDATA\[121111,121112\]\]><\/prod_id>/);
  assert.match(xml, /model_no/);
  assert.match(xml, /model_nm/);
  assert.match(xml, /<opt_yn>N<\/opt_yn>/);
  assert.doesNotMatch(xml, /start_dt|end_dt|search_tp/);
});

test("current model resolver distinguishes exact aaa blank non-aaa conflict and missing", () => {
  const snapshot = resolveShoplingCurrentModelIdentities(
    ["100", "101", "102", "103", "104"],
    [
      { goods_key: "100", model_no: "aaa316", model_nm: "계란펀칭기" },
      { goods_key: "101", model_no: "", model_nm: "공란" },
      { goods_key: "102", model_no: "LEGACY-BGC3-1", model_nm: "세탁기청소솔" },
      { goods_key: "103", model_no: "aaa090", model_nm: "꿩안경" },
      { goods_key: "103", model_no: "aaa129", model_nm: "꿩안경 세트" },
    ],
    "2026-08-10T00:00:00.000Z",
  );
  assert.deepEqual(snapshot.rows.map((row) => row.state), [
    "EXACT_AAA",
    "BLANK",
    "NON_AAA",
    "CONFLICT",
    "MISSING",
  ]);
  assert.equal(snapshot.exactAaaCount, 1);
  assert.equal(snapshot.blankCount, 1);
  assert.equal(snapshot.nonAaaCount, 1);
  assert.equal(snapshot.conflictCount, 1);
  assert.equal(snapshot.missingCount, 1);
});

test("aaa model family accepts the existing hyphenated model convention", () => {
  assert.equal(isExactAaaModelNo("aaa316"), true);
  assert.equal(isExactAaaModelNo("AAA171-1"), true);
  assert.equal(isExactAaaModelNo("caaa209"), false);
  assert.equal(isExactAaaModelNo("LEGACY-BGG1-1"), false);
});

test("live audit preserves true multi-model sets and never promotes them automatically", () => {
  assert.match(audit, /EXACT_SINGLE_MODEL_SET/);
  assert.match(audit, /EXACT_MULTI_MODEL_SET/);
  assert.match(audit, /PARTIAL_MODEL_EVIDENCE/);
  assert.match(audit, /GOODS_KEY_MODEL_CONFLICT/);
  assert.match(audit, /priorComparison/);
  assert.match(audit, /modelRecoveryPromotionAllowed: false/);
  assert.match(audit, /historicalOrderJoinAllowed: false/);
  assert.match(audit, /inventoryPromotionAllowed: false/);
  assert.match(page, /Shopling model_no를 읽었다고 즉시 과거 발주이력을 합치지 않습니다/);
});

test("live model reader is read only and limits the request to explicit product ids", () => {
  assert.match(reader, /postShoplingXml/);
  assert.match(reader, /parseShoplingReadResponse\("products"/);
  assert.match(reader, /buildShoplingCurrentModelLookupXml/);
  assert.match(reader, /SHOPLING_CURRENT_MODEL_LOOKUP_BATCH_SIZE/);
  assert.doesNotMatch(reader, /prod_modify_api|priceModify|method:\s*["']PUT["']/i);
  assert.doesNotMatch(audit, /\.(insert|upsert|delete)\(/);
  assert.match(page, /SHOPLING WRITE 0/);
});
