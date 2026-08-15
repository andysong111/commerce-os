type UnknownRecord = Record<string, unknown>;

type DetailPageSourceJob = {
  status?: unknown;
  qaStatus?: unknown;
  stage?: unknown;
  error?: unknown;
  message?: unknown;
  sourceUrl?: unknown;
  payload?: unknown;
};

const EXPLICIT_LINK_FAILURE = /商品已下架|已下架|商品不存在|页面不存在|页面为空|空白页面|链接失效|无法访问|访问失败|not\s+found|\b404\b|\bgone\b|unavailable|blank\s+page|empty\s+page|page\s+is\s+empty|link.{0,20}unavailable|접근\s*불가|페이지.{0,20}(비어|없음|없습니다|찾을\s*수\s*없)|상품.{0,20}(내려|삭제|존재하지)|링크.{0,20}(만료|실패|접근)/i;
const INFRASTRUCTURE_FAILURE = /studio|preview|보호\s*인증|로컬\s*수집기|local\s*bridge|local\s*network|권한|worker|서버\s*작업|인증\s*실패/i;

export function isDetailPageSourceLinkUnavailable(jobValue: unknown) {
  const job = record(jobValue) as DetailPageSourceJob;
  const failed = text(job.status) === "failed" || text(job.qaStatus) === "failed";
  if (!failed || text(job.stage) !== "source_collection") return false;

  const payload = record(job.payload);
  const evidence = Array.isArray(payload.evidence_urls)
    ? payload.evidence_urls.map(text).filter(Boolean)
    : [];
  if (evidence.length) return false;

  const reason = [
    job.error,
    job.message,
    payload.source_error,
    payload.sourceError,
    payload.collection_error,
    payload.collectionError,
  ]
    .map(text)
    .filter(Boolean)
    .join(" ");

  if (EXPLICIT_LINK_FAILURE.test(reason)) return true;
  if (INFRASTRUCTURE_FAILURE.test(reason)) return false;

  // Studio 자체 연결 오류가 아니라 source_collection에서 원본 근거를 한 장도
  // 만들지 못한 종료 작업은, 상품이 내려갔거나 빈 페이지·응답 지연 등 원인과
  // 관계없이 운영자가 다음 링크로 교체할 수 있도록 "링크 접근 불가"로 묶는다.
  return Boolean(text(job.sourceUrl) || text(payload.source_url));
}

export function detailPageSourceLinkFailureLabel(jobValue: unknown) {
  return isDetailPageSourceLinkUnavailable(jobValue) ? "링크 접근 불가" : "";
}

export function detailPageSourceLinkFailureDetail(jobValue: unknown) {
  if (!isDetailPageSourceLinkUnavailable(jobValue)) return "";
  const job = record(jobValue) as DetailPageSourceJob;
  const raw = text(job.error) || text(job.message);
  return raw && raw !== "1688 상품정보·이미지 수집에 실패했습니다."
    ? raw
    : "1688 고정링크 1번에서 상품 본문 또는 원본 이미지를 수집하지 못했습니다.";
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : value == null
      ? ""
      : String(value).trim();
}
