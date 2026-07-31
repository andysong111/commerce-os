const EXPLICIT_ACTION_INTENT_PATTERNS = [
  /(?:개발|구현|제작|추가|수정|변경|삭제|배포|머지|커밋)(?:을|를)?\s*(?:직접\s*)?(?:하고|해보고|진행하고)?\s*(?:싶|원하|부탁)/i,
  /(?:만들|고치|바꾸|없애|붙이)(?:고|어|아)?\s*(?:싶|줘|주세요|달라)/i,
  /(?:기능|화면|버튼|자동화|연동).{0,24}(?:개발하고\s*싶|추가하고\s*싶|만들고\s*싶|구현하고\s*싶)/i,
  /(?:실제|바로|지금).{0,18}(?:주문|결제|등록|변경|반영|전송|실행)(?:해|하고\s*싶|해줘|해주세요)/i,
];

const USAGE_QUESTION_PATTERNS = [
  /어디서|어디에|어떻게|사용법|이용|쓰는\s*법|무엇|뭐야|의미|설명|순서|왜|오류|에러|안\s*돼|반응이\s*없/i,
];

export function isExplicitOpsAiHelpActionIntent(value: unknown) {
  const question = String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!question) return false;
  if (USAGE_QUESTION_PATTERNS.some((pattern) => pattern.test(question))) {
    return false;
  }
  return EXPLICIT_ACTION_INTENT_PATTERNS.some((pattern) => pattern.test(question));
}
