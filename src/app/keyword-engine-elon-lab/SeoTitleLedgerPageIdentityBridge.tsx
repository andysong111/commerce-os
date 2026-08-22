"use client";

import { useEffect } from "react";

const PAGE_TITLE = "SEO 대량등록 클라우드 · Commerce OS";
const HEADING = "SEO 대량등록 클라우드";
const EYEBROW = "Commerce OS · SEO BULK REGISTRATION CLOUD";
const DESCRIPTION =
  "1688 링크에서 상품 정체성·모델명·검색어를 확정하고, 중복 없는 쇼핑몰별 상품명을 대량 제조해 클라우드 재고로 축적합니다.";

export default function SeoTitleLedgerPageIdentityBridge() {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (document.title !== PAGE_TITLE) document.title = PAGE_TITLE;

      const heading = document.querySelector("main h1");
      if (heading && heading.textContent !== HEADING) heading.textContent = HEADING;

      const eyebrow = document.querySelector("main header div.text-xs");
      if (eyebrow && eyebrow.textContent !== EYEBROW) eyebrow.textContent = EYEBROW;

      const paragraph = document.querySelector("main header h1 + p");
      if (paragraph && paragraph.textContent !== DESCRIPTION) {
        paragraph.textContent = DESCRIPTION;
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return null;
}
