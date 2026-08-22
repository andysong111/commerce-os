"use client";

import { useEffect } from "react";

import { buildKeywordElonBrowserWindowName } from "@/lib/keywordEngineElonLabBrowserContext";
import { validate1688Url } from "@/lib/keywordEngineElonLabV2";

function buttonStarts1688Collection(button: HTMLButtonElement) {
  const label = String(button.textContent || "").replace(/\s+/g, " ").trim();
  return (
    label.includes("FINAL RESULT 받기") ||
    label.includes("1688 브라우저 자동수집")
  );
}

function nearby1688Url(button: HTMLButtonElement) {
  const candidates = [
    button.parentElement?.querySelector("input"),
    button.closest("section")?.querySelector("input"),
  ];
  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLInputElement)) continue;
    const value = candidate.value.trim();
    if (validate1688Url(value)) return value;
  }
  return "";
}

export default function KeywordElonBrowserContextBridge() {
  useEffect(() => {
    const prepare = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest("button");
      if (!(button instanceof HTMLButtonElement) || !buttonStarts1688Collection(button)) {
        return;
      }
      const sourceUrl = nearby1688Url(button);
      if (!sourceUrl) return;
      try {
        const returnUrl = new URL(
          "/keyword-engine-elon-lab",
          window.location.origin,
        ).toString();
        window.name = buildKeywordElonBrowserWindowName(sourceUrl, returnUrl);
      } catch {
        // The normal click handler will show the validation error.
      }
    };
    document.addEventListener("click", prepare, true);
    return () => document.removeEventListener("click", prepare, true);
  }, []);

  return null;
}
