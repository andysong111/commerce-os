import assert from "node:assert/strict";
import test from "node:test";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const { isExplicitOpsAiHelpActionIntent } = await importTranspiledTypeScript(
  new URL("../src/lib/opsAiHelpIntent.ts", import.meta.url),
);

test("blocks development wishes before calling the help model", () => {
  assert.equal(
    isExplicitOpsAiHelpActionIntent("소싱자동화 개발을 하고싶어"),
    true,
  );
  assert.equal(
    isExplicitOpsAiHelpActionIntent("이 화면에 새 버튼을 추가하고 싶어"),
    true,
  );
});

test("allows location and usage questions", () => {
  assert.equal(
    isExplicitOpsAiHelpActionIntent("상세페이지 엔진은 어디서 이용해?"),
    false,
  );
  assert.equal(
    isExplicitOpsAiHelpActionIntent("발주안 확정 버튼은 어떻게 사용해?"),
    false,
  );
});
