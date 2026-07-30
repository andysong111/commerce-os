"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
} from "react";
import {
  requestShoplingPriceAdjustmentApi,
} from "@/lib/shoplingPriceAdjustmentApiClient";

const ShoplingPriceAdjustmentAccessTokenContext =
  createContext<string | null>(null);

export function ShoplingPriceAdjustmentAuthProvider({
  accessToken,
  children,
}: {
  accessToken: string | null;
  children: ReactNode;
}) {
  return (
    <ShoplingPriceAdjustmentAccessTokenContext.Provider
      value={accessToken}
    >
      {children}
    </ShoplingPriceAdjustmentAccessTokenContext.Provider>
  );
}

export function useShoplingPriceAdjustmentApi() {
  const accessToken = useContext(
    ShoplingPriceAdjustmentAccessTokenContext,
  );
  return useCallback(
    (input: string, init?: RequestInit) =>
      requestShoplingPriceAdjustmentApi(input, init, accessToken),
    [accessToken],
  );
}
