const OPTION_TABLE = ".option-table";
const OPTION_BODY = "#detail-options";
const OPTION_BARCODE_HEADER_ATTR = "data-option-barcode-no-header";
const OPTION_BARCODE_CELL_ATTR = "data-option-barcode-no-cell";

let installed = false;
let observer = null;
let applying = false;

export function installOptionBarcodeColumnAlignment() {
  if (installed) return;
  installed = true;
  alignOptionTable();

  const table = document.querySelector(OPTION_TABLE);
  if (!table) return;
  observer = new MutationObserver(() => alignOptionTable());
  observer.observe(table, { childList: true, subtree: true });

  window.addEventListener(
    "pagehide",
    () => observer?.disconnect(),
    { once: true },
  );
}

export function alignOptionTable() {
  if (applying) return;
  applying = true;
  try {
    const table = document.querySelector(OPTION_TABLE);
    const headerRow = table?.querySelector("thead tr");
    const body = document.querySelector(OPTION_BODY);
    if (!headerRow || !body) return;

    let header = headerRow.querySelector(`[${OPTION_BARCODE_HEADER_ATTR}]`);
    if (!header) {
      const headers = [...headerRow.children];
      const barcodeIndex = headers.findIndex((cell) =>
        /바코드|위치코드/.test(cell.textContent || ""),
      );
      header = document.createElement("th");
      header.setAttribute(OPTION_BARCODE_HEADER_ATTR, "true");
      header.textContent = "옵션바코드 NO";
      const anchor = barcodeIndex >= 0 ? headers[barcodeIndex + 1] : null;
      if (anchor) headerRow.insertBefore(header, anchor);
      else headerRow.append(header);
    }

    const headers = [...headerRow.children];
    const optionBarcodeIndex = headers.findIndex((cell) =>
      cell.hasAttribute(OPTION_BARCODE_HEADER_ATTR),
    );
    const expectedColumns = headers.length;
    if (optionBarcodeIndex < 0) return;

    for (const row of body.querySelectorAll("tr")) {
      const emptyCell = row.querySelector("td[colspan]");
      if (emptyCell) {
        emptyCell.setAttribute("colspan", String(expectedColumns));
        continue;
      }
      if (row.querySelector('[data-field="optionBarcodeNo"]')) continue;
      const cells = [...row.children];
      if (!cells.length) continue;

      const cell = document.createElement("td");
      cell.setAttribute(OPTION_BARCODE_CELL_ATTR, "true");
      cell.innerHTML = '<input data-field="optionBarcodeNo" value="" placeholder="원장 확인 중" readonly title="Commerce OS 옵션바코드 원장 자동발급값" />';
      const anchor = cells[optionBarcodeIndex] ?? null;
      if (anchor) row.insertBefore(cell, anchor);
      else row.append(cell);
    }
  } finally {
    applying = false;
  }
}
