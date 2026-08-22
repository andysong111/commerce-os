"use client";

import { useEffect } from "react";

export default function SeoTitleLedgerPageIdentityBridge() {
  useEffect(() => {
    const apply = () => {
      document.title = "SEO 대량등록 클라우드 · Commerce OS";
      const heading = document.querySelector("main h1");
      if (heading) heading.textContent = "SEO 대량등록 클라우드";
      const eyebrow = document.querySelector("main header div.text-xs");
      if (eyebrow) eyebrow.textContent = "Commerce OS · SEO BULK REGISTRATION CLOUD";
      const paragraph = document.querySelector("main header h1 + p");
      if (paragraph) {
        paragraph.textContent =
          "1688 링크에서 상품 정체성·모델명·검색어를 확정하고, 중복 없는 쇼핑몰별 상품명을 대량 제조해 클라우드 재고로 축적합니다.";
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
