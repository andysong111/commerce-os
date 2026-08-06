import { Buffer } from "node:buffer";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  insertDetailPageJob,
  type DetailPageJobConfig,
  type DetailPageJobIdentity,
} from "@/lib/detailPageJobServer";

export const DETAIL_PAGE_TEST_ENGINE_VARIANT =
  "new-product-detail-ai-test-v1";
export const DETAIL_PAGE_TEST_INTAKE_VERSION = "test-studio-intake-v1";
export const DETAIL_PAGE_TEST_BUCKET = "product-launch-assets";

const MAX_IMAGE_BYTES = 900_000;
const MAX_IMAGE_COUNT = 3;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const STYLE_IDS = new Set([
  "conversion_clean",
  "premium_editorial",
  "everyday_story",
  "minimal_utility",
]);
const LAYOUT_IDS = new Set([
  "balanced_flow",
  "editorial_split",
  "conversion_grid",
]);

type TestInputImage = {
  name: string;
  mimeType: "image/jpeg";
  bytes: Buffer;
};

export type DetailPageTestStudioInput = {
  inputMode: "source_link" | "image_upload";
  sourceUrl: string;
  productName: string;
  sourceProductInfo: string;
  salesOptions: string;
  copyLanguage: string;
  styleId: string;
  layoutVariantId: string;
  images: TestInputImage[];
};

export function isDetailPageTestJob(value: unknown) {
  return Boolean(
    value &&
      typeof value === "object" &&
      String((value as Record<string, unknown>).engine_variant ?? "") ===
        DETAIL_PAGE_TEST_ENGINE_VARIANT,
  );
}

export function normalizeDetailPageTestStudioInput(
  body: unknown,
): DetailPageTestStudioInput {
  const value = record(body);
  const inputMode = String(value.inputMode ?? "");
  if (inputMode !== "source_link" && inputMode !== "image_upload") {
    throw new Error("링크 또는 이미지 직접 업로드 방식을 선택해 주세요.");
  }
  const sourceUrl =
    inputMode === "source_link" ? normalize1688Url(value.sourceUrl) : "";
  const salesOptions = safeText(value.salesOptions, 2_000);
  if (!salesOptions) {
    throw new Error("실제 판매 옵션이 필요합니다. 단일 상품은 ‘단품’으로 입력하세요.");
  }
  const productName =
    safeText(value.productName, 250) ||
    (sourceUrl ? `1688 테스트 상품 ${offerId(sourceUrl)}` : "테스트 상품");
  const styleId = safeText(value.styleId, 80);
  const layoutVariantId = safeText(value.layoutVariantId, 80);
  if (!STYLE_IDS.has(styleId) || !LAYOUT_IDS.has(layoutVariantId)) {
    throw new Error("상세페이지 테스트 스타일 또는 페이지 구성이 올바르지 않습니다.");
  }
  const images =
    inputMode === "image_upload" ? normalizeImages(value.images) : [];
  if (inputMode === "image_upload" && images.length !== MAX_IMAGE_COUNT) {
    throw new Error("이미지 직접 업로드 작업은 제품 이미지 3장이 필요합니다.");
  }
  return {
    inputMode,
    sourceUrl,
    productName,
    sourceProductInfo: safeText(value.sourceProductInfo, 8_000),
    salesOptions,
    copyLanguage: safeText(value.copyLanguage, 80) || "ko-KR",
    styleId,
    layoutVariantId,
    images,
  };
}

export async function createDetailPageTestStudioJob(options: {
  config: DetailPageJobConfig;
  identity: DetailPageJobIdentity;
  input: DetailPageTestStudioInput;
}) {
  const { config, identity, input } = options;
  const jobId = crypto.randomUUID();
  const itemId = `test-studio-${jobId}`;
  const createdAt = new Date().toISOString();
  const evidence = input.images.length
    ? await uploadTestEvidence({
        config,
        ownerId: identity.userId,
        itemId,
        jobId,
        images: input.images,
      })
    : { urls: [] as string[], names: [] as string[], mimeTypes: [] as string[] };
  const job = await insertDetailPageJob(config, {
    id: jobId,
    owner_id: identity.userId,
    owner_email: identity.email,
    launch_item_id: itemId,
    request_id: `detail-page-test:${jobId}`,
    status: "queued",
    payload: {
      kind: "detail_page",
      schema_version: 1,
      engine_variant: DETAIL_PAGE_TEST_ENGINE_VARIANT,
      intake_version: DETAIL_PAGE_TEST_INTAKE_VERSION,
      job_origin: "detail_page_studio_test",
      input_mode: input.inputMode,
      logical_status: "queued",
      stage: "test_input_registered",
      message:
        "상세페이지 스튜디오 테스트버전 입력 등록 완료 · 새 엔진 처리 대기",
      progress: 5,
      qa_status: "pending",
      attempt: 1,
      source_url: input.sourceUrl,
      source_product_info: input.sourceProductInfo,
      sales_options: input.salesOptions,
      product_name_hint: input.productName,
      copy_language: input.copyLanguage,
      creative_style_id: input.styleId,
      layout_variant_id: input.layoutVariantId,
      evidence_urls: evidence.urls,
      evidence_names: evidence.names,
      evidence_mime_types: evidence.mimeTypes,
      source_run_id: "",
      step_version: 0,
      lease_owner: "",
      lease_until: null,
      started_at: createdAt,
      test_engine_dispatch_enabled: false,
    },
    result: {
      testIntake: {
        engineVariant: DETAIL_PAGE_TEST_ENGINE_VARIANT,
        registeredAt: createdAt,
        inputMode: input.inputMode,
        evidenceCount: evidence.urls.length,
      },
    },
    error_message: "",
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: null,
  });
  if (!job) throw new Error("등록한 상세페이지 테스트 작업을 다시 읽지 못했습니다.");
  return job;
}

async function uploadTestEvidence(options: {
  config: DetailPageJobConfig;
  ownerId: string;
  itemId: string;
  jobId: string;
  images: TestInputImage[];
}) {
  await ensurePublicBucket(options.config);
  const owner = safeSegment(options.ownerId);
  const urls: string[] = [];
  const names: string[] = [];
  const mimeTypes: string[] = [];
  for (let index = 0; index < options.images.length; index += 1) {
    const image = options.images[index];
    const objectName = `test-source-${index + 1}.jpg`;
    const objectPath = `${owner}/${options.itemId}/${options.jobId}/${objectName}`;
    const headers = createSupabaseAdminHeaders(options.config.secretKey);
    headers["Content-Type"] = "image/jpeg";
    headers["x-upsert"] = "false";
    const response = await fetch(
      `${options.config.supabaseUrl}/storage/v1/object/${DETAIL_PAGE_TEST_BUCKET}/${encodePath(objectPath)}`,
      {
        method: "POST",
        headers,
        body: image.bytes,
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const responseBody = await readJson(response);
    if (!response.ok) {
      throw new Error(
        readErrorMessage(
          responseBody,
          `테스트 원본 이미지 ${index + 1} 저장 실패 · HTTP ${response.status}`,
        ),
      );
    }
    urls.push(
      `${options.config.supabaseUrl}/storage/v1/object/public/${DETAIL_PAGE_TEST_BUCKET}/${encodePath(objectPath)}?v=${options.jobId}`,
    );
    names.push(image.name);
    mimeTypes.push(image.mimeType);
  }
  return { urls, names, mimeTypes };
}

async function ensurePublicBucket(config: DetailPageJobConfig) {
  const headers = createSupabaseAdminHeaders(config.secretKey);
  const inspect = await fetch(
    `${config.supabaseUrl}/storage/v1/bucket/${DETAIL_PAGE_TEST_BUCKET}`,
    { headers, cache: "no-store", signal: AbortSignal.timeout(20_000) },
  );
  if (inspect.ok) return;
  if (![400, 404].includes(inspect.status)) {
    throw new Error(`상세페이지 입력 저장소 확인 실패 · HTTP ${inspect.status}`);
  }
  const create = await fetch(`${config.supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: DETAIL_PAGE_TEST_BUCKET,
      name: DETAIL_PAGE_TEST_BUCKET,
      public: true,
      file_size_limit: 4_000_000,
      allowed_mime_types: ["image/jpeg"],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!create.ok && create.status !== 409) {
    throw new Error(`상세페이지 입력 저장소 생성 실패 · HTTP ${create.status}`);
  }
}

function normalizeImages(value: unknown): TestInputImage[] {
  if (!Array.isArray(value) || value.length !== MAX_IMAGE_COUNT) return [];
  return value.map((item, index) => {
    const image = record(item);
    const base64 = String(image.base64 ?? "").trim();
    const mimeType = String(image.mimeType ?? "").toLowerCase();
    if (
      mimeType !== "image/jpeg" ||
      !base64 ||
      base64.length > 1_300_000 ||
      !BASE64_PATTERN.test(base64)
    ) {
      throw new Error(`${index + 1}번 테스트 이미지 전송값이 올바르지 않습니다.`);
    }
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(`${index + 1}번 테스트 이미지는 900KB 이하여야 합니다.`);
    }
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
      throw new Error(`${index + 1}번 테스트 이미지가 올바른 JPG가 아닙니다.`);
    }
    return {
      name: safeFileName(image.name, index),
      mimeType: "image/jpeg" as const,
      bytes,
    };
  });
}

function normalize1688Url(value: unknown) {
  let url: URL;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("올바른 1688 상품 상세주소가 필요합니다.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "detail.1688.com" ||
    url.username ||
    url.password ||
    !/^\/offer\/\d+\.html$/i.test(url.pathname)
  ) {
    throw new Error("https://detail.1688.com/offer/...html 형식만 사용할 수 있습니다.");
  }
  url.hash = "";
  return url.toString();
}

function offerId(value: string) {
  return new URL(value).pathname.match(/\/offer\/(\d+)\.html/i)?.[1] ?? "";
}

function safeFileName(value: unknown, index: number) {
  const stem = String(value ?? "")
    .replace(/\.[^.]+$/, "")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9가-힣_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
  return `${stem || `product-${index + 1}`}.jpg`;
}

function safeSegment(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function safeText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function encodePath(value: string) {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function readJson(response: Response) {
  return response.json().catch(() => null);
}

function readErrorMessage(value: unknown, fallback: string) {
  const data = record(value);
  return String(data.message ?? data.error ?? fallback).slice(0, 500);
}
