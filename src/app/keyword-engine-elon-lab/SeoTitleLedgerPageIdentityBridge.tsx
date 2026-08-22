"use client";

import { useEffect } from "react";

export default function SeoTitleLedgerPageIdentityBridge() {
  useEffect(() => {
    const apply = () => {
      document.title = "SEO 상품명 재고 원장 · Commerce OS";
      const heading = document.querySelector("main h1");
      if (heading) heading.textContent = "SEO 상품명 재고 원장";
      const eyebrow = document.querySelector("main header div.text-xs");
      if (eyebrow) eyebrow.textContent = "Commerce OS · TITLE INVENTORY FACTORY";
      const paragraph = document.querySelector("main header h1 + p");
      if (paragraph) {
        paragraph.textContent =
          "1688 링크에서 상품 정체성·검색어·모델명을 확정하고, 중복 없는 쇼핑몰 상품명을 제조해 영구 재고 원장으로 축적합니다.";
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
