"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  buildFreightWorkRequestPdfFilename,
  buildFreightWorkRequestPrintTitle,
} from "@/lib/freightBarcodeDownload";

const FREIGHT_BARCODE_ROUTE = "/freight-barcode-request";
const WORK_REQUEST_BUTTON_LABEL = "작업요청서 PDF 저장/인쇄";
const FORWARDER_ZIP_BUTTON_LABEL = "배대지 전달용 개별 PDF ZIP 다운로드";
const SERVER_SAVE_BUTTON_LABEL = "서버 이력에 저장";

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function findButtonByLabel(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => normalizeText(button.textContent) === label,
  );
}

function getApplicationNoFromPage(): string {
  const labels = Array.from(document.querySelectorAll<HTMLLabelElement>("label"));
  const applicationNoLabel = labels.find((label) =>
    normalizeText(label.textContent).includes("신청번호 수정"),
  );
  const input = applicationNoLabel?.querySelector<HTMLInputElement>("input");
  return input?.value?.trim() || "unknown";
}

function updateRecommendedFilename() {
  const applicationNo = getApplicationNoFromPage();
  const filename = buildFreightWorkRequestPdfFilename(applicationNo);

  const sections = Array.from(document.querySelectorAll<HTMLElement>("section"));
  const printSection = sections.find((section) =>
    Array.from(section.querySelectorAll("h2")).some(
      (heading) => normalizeText(heading.textContent) === "인쇄 및 전달",
    ),
  );
  const filenameTarget = printSection?.querySelector("strong");
  if (filenameTarget && filenameTarget.textContent !== filename) {
    filenameTarget.textContent = filename;
  }
}

function updateServerArchiveCopy() {
  const headings = Array.from(document.querySelectorAll<HTMLElement>("h3"));
  const serverHeading = headings.find(
    (heading) => normalizeText(heading.textContent) === "임시 서버 이력",
  );
  if (serverHeading) serverHeading.textContent = "서버 문서 보관함";

  const paragraphs = Array.from(document.querySelectorAll<HTMLParagraphElement>("p"));
  const temporaryCopy = paragraphs.find((paragraph) =>
    normalizeText(paragraph.textContent).includes(
      "서버가 재시작되면 사라지는 임시 저장소",
    ),
  );
  if (temporaryCopy) {
    temporaryCopy.textContent =
      "작업요청서 PDF 저장/인쇄 또는 배대지 개별 PDF ZIP 다운로드를 누르면 현재 작업이 서버에 자동 보관됩니다. 다시 열기로 언제든지 불러올 수 있습니다.";
  }

  const historyIntro = paragraphs.find((paragraph) =>
    normalizeText(paragraph.textContent).includes(
      "현재 작업을 임시 서버 이력에도 저장해 다시 열 수 있습니다",
    ),
  );
  if (historyIntro) {
    historyIntro.textContent =
      "기존 브라우저 로컬 이력은 그대로 유지됩니다. 문서 저장/다운로드 시 현재 작업이 서버 보관함에도 자동 저장되며, 필요하면 수동 저장도 사용할 수 있습니다.";
  }
}

function triggerServerArchiveSave() {
  const saveButton = findButtonByLabel(SERVER_SAVE_BUTTON_LABEL);
  if (!saveButton || saveButton.disabled) return;
  saveButton.click();
}

function prepareWorkRequestPrintTitle() {
  const originalTitle = document.title;
  const printTitle = buildFreightWorkRequestPrintTitle(getApplicationNoFromPage());
  document.title = printTitle;

  const restoreTitle = () => {
    if (document.title === printTitle) document.title = originalTitle;
  };
  window.addEventListener("afterprint", restoreTitle, { once: true });
}

export function FreightBarcodePrintEnhancer() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== FREIGHT_BARCODE_ROUTE) return;

    updateRecommendedFilename();
    updateServerArchiveCopy();

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>("button");
      if (!button) return;

      const label = normalizeText(button.textContent);
      if (label === WORK_REQUEST_BUTTON_LABEL) {
        prepareWorkRequestPrintTitle();
        triggerServerArchiveSave();
        return;
      }

      if (label === FORWARDER_ZIP_BUTTON_LABEL) {
        triggerServerArchiveSave();
      }
    };

    const handleInput = (event: Event) => {
      const target = event.target instanceof HTMLInputElement ? event.target : null;
      if (!target) return;
      const label = target.closest("label");
      if (label && normalizeText(label.textContent).includes("신청번호 수정")) {
        updateRecommendedFilename();
      }
    };

    document.addEventListener("click", handleClick, true);
    document.addEventListener("input", handleInput, true);

    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("input", handleInput, true);
    };
  }, [pathname]);

  return null;
}
