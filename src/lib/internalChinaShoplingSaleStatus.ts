export function normalizeShoplingSaleStatus(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase();
}

// Shopling product normalization already treats sale_status B (or omitted) as active.
// Keep the price-review gate on the exact same invariant.
export function shoplingSaleStatusActive(value: unknown) {
  const status = normalizeShoplingSaleStatus(value);
  return !status || status === "B";
}
