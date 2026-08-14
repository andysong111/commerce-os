import { buildFrozenColumnGeometry } from "./lib/table-inline-ops.mjs";

const tableWrap = document.querySelector(".table-wrap");
const table = tableWrap?.querySelector("table");
const tableHead = document.querySelector("#launch-table-head");
const tableBody = document.querySelector("#launch-table-body");

if (tableWrap && table && tableHead && tableBody) {
  installStyles();
  keepHeaderAboveFrozenBody();

  let firstFrame = 0;
  let secondFrame = 0;
  const scheduleRepair = () => {
    window.cancelAnimationFrame(firstFrame);
    window.cancelAnimationFrame(secondFrame);
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(repairFrozenColumns);
    });
  };

  const observer = new MutationObserver(scheduleRepair);
  observer.observe(tableHead, { childList: true, subtree: true });
  observer.observe(tableBody, { childList: true, subtree: true });

  window.addEventListener("resize", scheduleRepair, { passive: true });
  window.addEventListener("product-launch-tracker:page-loaded", scheduleRepair);
  window.addEventListener("product-launch-tracker:item-patched", scheduleRepair);
  document.addEventListener(
    "change",
    (event) => {
      if (
        event.target instanceof HTMLSelectElement &&
        event.target.id === "freeze-through-column"
      ) {
        scheduleRepair();
      }
    },
    true,
  );
  document.fonts?.ready.then(scheduleRepair).catch(() => {});
  scheduleRepair();

  function keepHeaderAboveFrozenBody() {
    // `thead` used to have z-index 5 while frozen body cells used z-index 20.
    // That made tall option rows paint over the frozen header labels. Keep the
    // whole header stacking context above every body cell, not only each <th>.
    tableWrap.style.position = "relative";
    tableWrap.style.isolation = "isolate";
    tableHead.style.position = "sticky";
    tableHead.style.top = "0px";
    tableHead.style.zIndex = "100";
    tableHead.style.isolation = "isolate";
  }

  function repairFrozenColumns() {
    keepHeaderAboveFrozenBody();
    const headRow = tableHead.querySelector("tr");
    if (!headRow) return;

    const rows = [headRow, ...tableBody.querySelectorAll("tr[data-id]")];
    const allCells = rows.flatMap((row) => [...row.children]);
    for (const cell of allCells) clearOwnedGeometry(cell);

    // Force one clean table layout before measuring. The original implementation
    // measured only the header width, which can be narrower than an editable body cell.
    void table.offsetWidth;

    const frozenHeaders = [...headRow.children].filter((cell) =>
      cell.classList.contains("is-frozen-table-column"),
    );
    if (!frozenHeaders.length) {
      tableWrap.classList.remove("has-frozen-column-pane");
      tableWrap.style.removeProperty("--frozen-pane-width");
      table.removeAttribute("data-frozen-geometry-ready");
      return;
    }

    const geometry = buildFrozenColumnGeometry(
      frozenHeaders.map((header) => {
        const key = String(header.dataset.columnKey ?? "");
        const widths = rows
          .map((row) => row.querySelector(`[data-column-key='${cssEscape(key)}']`))
          .filter(Boolean)
          .flatMap((cell) => [cell.offsetWidth, cell.getBoundingClientRect().width]);
        return { key, widths };
      }),
    );

    for (const cell of allCells) {
      cell.classList.remove("is-last-frozen-table-column");
    }

    for (const column of geometry) {
      const width = `${column.width}px`;
      const left = `${column.left}px`;
      for (const row of rows) {
        const cell = row.querySelector(
          `[data-column-key='${cssEscape(column.key)}']`,
        );
        if (!cell) continue;
        cell.dataset.frozenGeometryOwned = "true";
        cell.style.setProperty("--frozen-column-left", left);
        cell.style.setProperty("--frozen-column-width", width);
        cell.style.position = "sticky";
        cell.style.left = left;
        cell.style.width = width;
        cell.style.minWidth = width;
        cell.style.maxWidth = width;
        cell.style.zIndex = row === headRow ? "120" : "20";
        cell.style.backgroundClip = "border-box";
        cell.style.isolation = "isolate";
      }
    }

    const lastColumn = geometry.at(-1);
    if (lastColumn) {
      for (const row of rows) {
        row
          .querySelector(`[data-column-key='${cssEscape(lastColumn.key)}']`)
          ?.classList.add("is-last-frozen-table-column");
      }
      tableWrap.style.setProperty("--frozen-pane-width", `${lastColumn.right}px`);
    }
    tableWrap.classList.add("has-frozen-column-pane");
    table.dataset.frozenGeometryReady = "true";
  }
}

function clearOwnedGeometry(cell) {
  if (cell.dataset.frozenGeometryOwned !== "true") return;
  cell.style.removeProperty("--frozen-column-left");
  cell.style.removeProperty("--frozen-column-width");
  cell.style.removeProperty("width");
  cell.style.removeProperty("min-width");
  cell.style.removeProperty("max-width");
  cell.style.removeProperty("background-clip");
  cell.style.removeProperty("isolation");
  if (!cell.classList.contains("is-frozen-table-column")) {
    cell.style.removeProperty("position");
    cell.style.removeProperty("left");
    cell.style.removeProperty("z-index");
  }
  delete cell.dataset.frozenGeometryOwned;
}

function cssEscape(value) {
  return window.CSS?.escape
    ? window.CSS.escape(String(value))
    : String(value).replace(/["\\]/g, "\\$&");
}

function installStyles() {
  if (document.querySelector("#frozen-column-scroll-fix-styles")) return;
  const style = document.createElement("style");
  style.id = "frozen-column-scroll-fix-styles";
  style.textContent = `
    .table-wrap {
      position: relative;
      isolation: isolate;
    }
    .table-wrap.has-frozen-column-pane table {
      position: relative;
      isolation: isolate;
    }
    #launch-table-head {
      position: sticky !important;
      top: 0 !important;
      z-index: 100 !important;
      isolation: isolate;
    }
    #launch-table-head > tr {
      position: relative;
      z-index: 100;
    }
    #launch-table-head > tr > th:not(.is-frozen-table-column),
    #launch-table-body > tr > td:not(.is-frozen-table-column) {
      position: relative;
      z-index: 0;
    }
    #launch-table-head > tr > th:not(.is-frozen-table-column) {
      z-index: 101 !important;
      background: #f1f5f9 !important;
    }
    #launch-table-head > tr > th.is-frozen-table-column {
      z-index: 120 !important;
      background: #eef4ff !important;
      background-clip: border-box !important;
      box-shadow: inset -1px 0 0 #dbe3ef;
    }
    #launch-table-head .sort-button,
    #launch-table-head .column-drag-handle {
      position: relative;
      z-index: 1;
    }
    #launch-table-body > tr > td.is-frozen-table-column {
      z-index: 20 !important;
      background: #fff !important;
      background-clip: border-box !important;
      box-shadow: inset -1px 0 0 #edf1f6;
    }
    #launch-table-body > tr:hover > td.is-frozen-table-column {
      background: #f8fbff !important;
    }
    #launch-table-body > tr.is-selected > td.is-frozen-table-column,
    #launch-table-body > tr.is-selected:hover > td.is-frozen-table-column {
      background: #eff6ff !important;
    }
    #launch-table-body > tr.is-archived > td.is-frozen-table-column {
      background: #f8fafc !important;
    }
    #launch-table-head > tr > th.is-last-frozen-table-column,
    #launch-table-body > tr > td.is-last-frozen-table-column {
      border-right-color: #94a3b8 !important;
      box-shadow: 7px 0 11px -8px rgba(15, 23, 42, .55), inset -1px 0 0 #94a3b8;
    }
  `;
  document.head.append(style);
}
