"use client";

import { useEffect } from "react";

const SEO_BULK_WINDOW_NAME = "commerce-os-seo-bulk-cloud";

export default function SeoBulkWindowBridge() {
  useEffect(() => {
    try {
      window.name = SEO_BULK_WINDOW_NAME;
    } catch {
      // Window naming is a best-effort UX optimization only.
    }
  }, []);

  return null;
}
