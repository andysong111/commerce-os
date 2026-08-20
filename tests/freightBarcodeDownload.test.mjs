import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFreightWorkRequestPdfFilename,
  buildFreightWorkRequestPrintTitle,
  sanitizeFreightApplicationNoForFilename,
} from "../src/lib/freightBarcodeDownload.ts";

test("builds work request PDF filename from application number", () => {
  assert.equal(buildFreightWorkRequestPrintTitle("656776"), "656776-작업요청서");
  assert.equal(buildFreightWorkRequestPdfFilename("656776"), "656776-작업요청서.pdf");
});

test("sanitizes invalid filename characters and empty values", () => {
  assert.equal(sanitizeFreightApplicationNoForFilename(" 656/776 "), "656-776");
  assert.equal(buildFreightWorkRequestPdfFilename("   "), "unknown-작업요청서.pdf");
});
