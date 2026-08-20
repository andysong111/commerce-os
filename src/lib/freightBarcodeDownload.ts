const INVALID_FILENAME_CHARACTERS = /[\\/:*?"<>|]+/g;

export function sanitizeFreightApplicationNoForFilename(applicationNo: string): string {
  const normalized = applicationNo
    .trim()
    .replace(INVALID_FILENAME_CHARACTERS, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "unknown";
}

export function buildFreightWorkRequestPrintTitle(applicationNo: string): string {
  return `${sanitizeFreightApplicationNoForFilename(applicationNo)}-작업요청서`;
}

export function buildFreightWorkRequestPdfFilename(applicationNo: string): string {
  return `${buildFreightWorkRequestPrintTitle(applicationNo)}.pdf`;
}
