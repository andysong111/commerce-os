import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE_VERSION = "lifecycle-dom-v0.5.5";
const OPERATION_TYPE = "SHOPLING_LIFECYCLE_DOM_DIAGNOSTIC";
const MAX_CANDIDATES = 120;
const MAX_OPTIONS = 30;
const MAX_PAYLOAD_BYTES = 120_000;

function text(value: unknown, max = 300) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanPath(value: unknown) {
  const raw = text(value, 240);
  if (!raw.startsWith("/")) return "/";
  return raw.replace(/[\r\n]/g, "");
}

function cleanOption(value: unknown) {
  const row = record(value);
  return {
    text: text(row.text, 120),
    value: text(row.value, 120),
    selected: row.selected === true,
  };
}

function cleanCandidate(value: unknown) {
  const row = record(value);
  const rawOptions = Array.isArray(row.options) ? row.options : [];
  return {
    tag: text(row.tag, 30).toLowerCase(),
    id: text(row.id, 120),
    name: text(row.name, 120),
    type: text(row.type, 60).toLowerCase(),
    role: text(row.role, 60).toLowerCase(),
    selector: text(row.selector, 240),
    text: text(row.text, 240),
    ariaLabel: text(row.ariaLabel, 160),
    title: text(row.title, 160),
    label: text(row.label, 200),
    value: text(row.value, 120),
    hrefPath: cleanPath(row.hrefPath),
    onclick: text(row.onclick, 300),
    formActionPath: cleanPath(row.formActionPath),
    formMethod: text(row.formMethod, 20).toUpperCase(),
    options: rawOptions.slice(0, MAX_OPTIONS).map(cleanOption),
  };
}

function cleanForm(value: unknown) {
  const row = record(value);
  return {
    id: text(row.id, 120),
    name: text(row.name, 120),
    actionPath: cleanPath(row.actionPath),
    method: text(row.method, 20).toUpperCase(),
    relevantControlCount: Math.max(0, Math.min(500, Math.trunc(Number(row.relevantControlCount) || 0))),
  };
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_PAYLOAD_BYTES) {
    return json({ ok: false, error: "diagnostic_payload_too_large" }, 413);
  }

  let parsed: unknown = null;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const payload = record(parsed);
  if (text(payload.bridge, 80) !== BRIDGE_VERSION) {
    return json({ ok: false, error: "unsupported_bridge_version" }, 400);
  }

  const rawCandidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const rawForms = Array.isArray(payload.forms) ? payload.forms : [];
  const snapshot = {
    bridge: BRIDGE_VERSION,
    pathname: cleanPath(payload.pathname),
    topFrame: payload.topFrame === true,
    frameDepth: Math.max(0, Math.min(20, Math.trunc(Number(payload.frameDepth) || 0))),
    readyState: text(payload.readyState, 30),
    candidateCount: Math.min(rawCandidates.length, MAX_CANDIDATES),
    candidates: rawCandidates.slice(0, MAX_CANDIDATES).map(cleanCandidate),
    forms: rawForms.slice(0, 30).map(cleanForm),
    capturedAt: text(payload.capturedAt, 40),
  };

  const fingerprint = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
  const now = new Date().toISOString();
  const supabase = await createSupabaseAdminClient();
  if (!supabase) return json({ ok: false, error: "supabase_admin_unavailable" }, 503);

  const result = await supabase.from("commerce_operation_runs").upsert(
    {
      operation_type: OPERATION_TYPE,
      status: "SUCCEEDED",
      source: "shopling-browser-extension",
      source_event_id: `shopling-lifecycle-dom:${fingerprint}`,
      correlation_id: `shopling-lifecycle-dom:${snapshot.pathname}`.slice(0, 240),
      actor_type: "SYSTEM",
      input_snapshot: {
        bridge: BRIDGE_VERSION,
        pathname: snapshot.pathname,
        topFrame: snapshot.topFrame,
        frameDepth: snapshot.frameDepth,
      },
      result_snapshot: snapshot,
      error_message: null,
      started_at: now,
      finished_at: now,
      updated_at: now,
    },
    { onConflict: "source_event_id", ignoreDuplicates: true },
  );
  if (result.error) {
    return json({ ok: false, error: "diagnostic_store_failed", message: result.error.message }, 503);
  }

  return json({
    ok: true,
    bridge: BRIDGE_VERSION,
    fingerprint,
    pathname: snapshot.pathname,
    candidateCount: snapshot.candidateCount,
    readOnly: true,
  });
}
