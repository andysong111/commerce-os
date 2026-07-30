export type ShoplingPriceAdjustmentIdentity = {
  userId: string;
  email: string;
};

export type ShoplingPriceAdjustmentIdentityProbe =
  | {
      status: "verified";
      identity: ShoplingPriceAdjustmentIdentity;
    }
  | {
      status: "missing" | "invalid" | "unavailable";
      reason: string;
    };

type ResolveIdentityInput = {
  verifyBearer: () => Promise<ShoplingPriceAdjustmentIdentityProbe>;
  verifyCookie: () => Promise<ShoplingPriceAdjustmentIdentityProbe>;
  isAllowedEmail: (email: string) => boolean;
};

export type ShoplingPriceAdjustmentIdentityResult =
  | {
      ok: true;
      identity: ShoplingPriceAdjustmentIdentity;
      transport: "bearer" | "cookie";
      bearerStatus: ShoplingPriceAdjustmentIdentityProbe["status"];
      cookieStatus: "not_checked" | ShoplingPriceAdjustmentIdentityProbe["status"];
    }
  | {
      ok: false;
      reason: "forbidden" | "unauthenticated" | "unavailable";
      bearerStatus: ShoplingPriceAdjustmentIdentityProbe["status"];
      bearerReason: string;
      cookieStatus: "not_checked" | ShoplingPriceAdjustmentIdentityProbe["status"];
      cookieReason: string;
    };

function normalizeIdentity(identity: ShoplingPriceAdjustmentIdentity) {
  return {
    userId: identity.userId.trim(),
    email: identity.email.trim().toLowerCase(),
  };
}

export async function resolveShoplingPriceAdjustmentIdentity({
  verifyBearer,
  verifyCookie,
  isAllowedEmail,
}: ResolveIdentityInput): Promise<ShoplingPriceAdjustmentIdentityResult> {
  const bearer = await verifyBearer();
  if (bearer.status === "verified") {
    const identity = normalizeIdentity(bearer.identity);
    if (
      !identity.userId ||
      !identity.email ||
      !isAllowedEmail(identity.email)
    ) {
      return {
        ok: false,
        reason: "forbidden",
        bearerStatus: bearer.status,
        bearerReason: "email_not_allowed",
        cookieStatus: "not_checked",
        cookieReason: "not_checked",
      };
    }
    return {
      ok: true,
      identity,
      transport: "bearer",
      bearerStatus: bearer.status,
      cookieStatus: "not_checked",
    };
  }

  const cookie = await verifyCookie();
  if (cookie.status === "verified") {
    const identity = normalizeIdentity(cookie.identity);
    if (
      !identity.userId ||
      !identity.email ||
      !isAllowedEmail(identity.email)
    ) {
      return {
        ok: false,
        reason: "forbidden",
        bearerStatus: bearer.status,
        bearerReason: bearer.reason,
        cookieStatus: cookie.status,
        cookieReason: "email_not_allowed",
      };
    }
    return {
      ok: true,
      identity,
      transport: "cookie",
      bearerStatus: bearer.status,
      cookieStatus: cookie.status,
    };
  }

  return {
    ok: false,
    reason:
      bearer.status === "unavailable" || cookie.status === "unavailable"
        ? "unavailable"
        : "unauthenticated",
    bearerStatus: bearer.status,
    bearerReason: bearer.reason,
    cookieStatus: cookie.status,
    cookieReason: cookie.reason,
  };
}
