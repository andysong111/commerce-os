import {
  calendarMonthNormalRevenue,
  calendarMonthRange,
} from "@/lib/monthlyPurchasePolicy";
import {
  ShoplingReadClient,
  shoplingReadConfigFromEnv,
  splitShoplingDateRange,
} from "@/lib/shopling/shoplingReadClient";

function shoplingEnvironment() {
  return {
    SHOPLING_LOGIN_ID: process.env.SHOPLING_LOGIN_ID,
    SHOPLING_COMPANY_ID: process.env.SHOPLING_COMPANY_ID,
    SHOPLING_API_AUTH_KEY: process.env.SHOPLING_API_AUTH_KEY,
    SHOPLING_PRODUCTS_API_URL: process.env.SHOPLING_PRODUCTS_API_URL,
    SHOPLING_ORDERS_API_URL: process.env.SHOPLING_ORDERS_API_URL,
    SHOPLING_CLAIMS_API_URL: process.env.SHOPLING_CLAIMS_API_URL,
  };
}

export async function loadCalendarMonthNormalRevenue(month: string) {
  const range = calendarMonthRange(month);
  const config = shoplingReadConfigFromEnv(shoplingEnvironment());
  const client = new ShoplingReadClient(config);
  const chunks = splitShoplingDateRange(range.start, range.end, 7);
  let revenueKrw = 0;
  let fetchedRows = 0;
  for (const chunk of chunks) {
    const rows = await client.read("orders", chunk);
    fetchedRows += rows.length;
    revenueKrw += calendarMonthNormalRevenue(rows, month);
  }
  return {
    month,
    range,
    revenueKrw: Math.max(0, Math.round(revenueKrw)),
    fetchedRows,
    chunkCount: chunks.length,
  };
}
