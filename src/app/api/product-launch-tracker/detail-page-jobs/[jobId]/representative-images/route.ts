import { NextRequest } from "next/server";
import { zipSync } from "fflate";
import {
  getDetailPageJobConfig,
  isValidDetailPageJobId,
  publicDetailPageJob,
  readDetailPageJob,
  resolveDetailPageJobIdentity,
} from "@/lib/detailPageJobServer";
import { detailPageReviewAssets } from "@/lib/detailPageAiReview";

const ASSET_TIMEOUT_MS = 30_000;
const MAX_ASSET_BYTES = 5_000_000;
const MAX_REPRESENTATIVE_IMAGES = 20;

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const identity = await resolveDetailPageJobIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getDetailPageJobConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const { jobId } = await context.params;
  if (!isValidDetailPageJobId(jobId)) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_DETAIL_PAGE_JOB",
        message: "작업 ID가 올바르지 않습니다.",
      },
      { status: 400 },
    );
  }

  try {
    const job = await readDetailPageJob(config.value, jobId);
    if (!job || job.owner_id !== identity.value.userId) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_JOB_NOT_FOUND",
          message: "상세페이지 작업을 찾지 못했습니다.",
        },
        { status: 404 },
      );
    }

    const representatives = detailPageReviewAssets(
      publicDetailPageJob(job),
    ).representatives.slice(0, MAX_REPRESENTATIVE_IMAGES);
    if (!representatives.length) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_REPRESENTATIVE_IMAGES_MISSING",
          message: "다운로드할 대표·부가 이미지가 없습니다.",
        },
        { status: 409 },
      );
    }

    const ownedPrefix = ownedAssetPrefix(config.value.supabaseUrl, job);
    const downloaded = await Promise.all(
      representatives.map(async (asset, index) => {
        if (!isOwnedAssetUrl(asset.url, ownedPrefix)) {
          throw new Error(`대표·부가 이미지 ${index + 1}의 저장 주소가 안전한 OPS 자산 경로가 아닙니다.`);
        }
        const response = await fetch(asset.url, {
          cache: "no-store",
          signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new Error(`대표·부가 이미지 ${index + 1} 다운로드 실패 (HTTP ${response.status})`);
        }
        const contentType = (response.headers.get("content-type") || "")
          .split(";", 1)[0]
          .trim()
          .toLowerCase();
        if (!/^image\/(?:jpeg|jpg|png|webp)$/.test(contentType)) {
          throw new Error(`대표·부가 이미지 ${index + 1} 형식이 올바르지 않습니다.`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length || bytes.length > MAX_ASSET_BYTES) {
          throw new Error(`대표·부가 이미지 ${index + 1} 저장 크기가 올바르지 않습니다.`);
        }
        return {
          filename: representativeFilename(index, contentType),
          bytes,
        };
      }),
    );

    const files = Object.fromEntries(
      downloaded.map((item) => [item.filename, item.bytes]),
    );
    // JPEG/PNG/WebP are already compressed. Store them without recompression to
    // keep the server path fast and memory usage predictable.
    const zip = zipSync(files, { level: 0 });
    const filename = `detail-page-${safeFilenameSegment(job.launch_item_id || job.id.slice(0, 8))}-representative-images.zip`;

    return new Response(zip, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_REPRESENTATIVE_DOWNLOAD_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "대표·부가 이미지 ZIP을 만들지 못했습니다.",
      },
      { status: 502 },
    );
  }
}

function representativeFilename(index: number, contentType: string) {
  const extension = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : "jpg";
  const order = String(index + 1).padStart(2, "0");
  return index === 0
    ? `${order}_main.${extension}`
    : `${order}_sub_${index}.${extension}`;
}

function ownedAssetPrefix(
  supabaseUrl: string,
  job: {
    owner_id: string;
    launch_item_id: string;
    id: string;
  },
) {
  const base = new URL(supabaseUrl);
  return {
    origin: base.origin,
    pathname: `/storage/v1/object/public/product-launch-assets/${safePathSegment(job.owner_id)}/${safePathSegment(job.launch_item_id)}/${safePathSegment(job.id)}/`,
  };
}

function isOwnedAssetUrl(
  value: string,
  ownedPrefix: { origin: string; pathname: string },
) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === ownedPrefix.origin &&
      url.pathname.startsWith(ownedPrefix.pathname)
    );
  } catch {
    return false;
  }
}

function safePathSegment(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function safeFilenameSegment(value: string) {
  return safePathSegment(value).replace(/^[-_]+|[-_]+$/g, "") || "images";
}
