import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  getProductLaunchAdminConfig,
  readProductLaunchStorageJson,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import {
  isProductLaunchNormalizedFresh,
  isProductLaunchNormalizedSchemaError,
  readProductLaunchNormalizedWorkspace,
} from "@/lib/productLaunchTrackerNormalizedStore";

const TABLE_NAME = "product_launch_tracker_states";

type Stamp = { updated_at?: unknown; schema_version?: unknown };

export async function loadFreshProductLaunchNormalized(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return { response: Response.json(identity.body, { status: identity.status }) };
  }
  const config = getProductLaunchAdminConfig();
  if (!config.ok) {
    return { response: Response.json(config.body, { status: config.status }) };
  }

  try {
    const params = new URLSearchParams({
      select: "updated_at,schema_version",
      owner_id: `eq.${identity.value.userId}`,
      limit: "1",
    });
    const [workspace, stampResult] = await Promise.all([
      readProductLaunchNormalizedWorkspace(config.value, identity.value.userId),
      readProductLaunchStorageJson(
        `${config.value.supabaseUrl}/rest/v1/${TABLE_NAME}?${params.toString()}`,
        {
          headers: createSupabaseAdminHeaders(config.value.secretKey),
          cache: "no-store",
        },
      ),
    ]);
    const rows = Array.isArray(stampResult.body) ? stampResult.body : [];
    const stamp = (rows[0] as Stamp | undefined) ?? null;
    if (!workspace || !stamp || !isProductLaunchNormalizedFresh(workspace, stamp.updated_at)) {
      return { value: null };
    }
    return {
      value: {
        config: config.value,
        identity: identity.value,
        workspace,
        updatedAt: nullableText(stamp.updated_at),
        schemaVersion: numberOrNull(stamp.schema_version),
      },
    };
  } catch (error) {
    if (!isProductLaunchNormalizedSchemaError(error)) {
      console.error("[product-launch-normalized-availability] fallback", error);
    }
    return { value: null };
  }
}

function nullableText(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

function numberOrNull(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
