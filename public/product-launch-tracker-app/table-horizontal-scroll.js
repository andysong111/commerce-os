const tableWrap = document.querySelector(".table-wrap");
const table = tableWrap?.querySelector("table");

if (tableWrap && table) {
  const style = document.createElement("style");
  style.textContent = `
    .table-horizontal-scroll {
      height: 20px;
      overflow-x: auto;
      overflow-y: hidden;
      border-bottom: 1px solid #dbe3ef;
      background: #f8fafc;
      scrollbar-gutter: stable;
    }
    .table-horizontal-scroll[hidden] { display: none; }
    .table-horizontal-scroll-track { height: 1px; }
    .table-horizontal-scroll::-webkit-scrollbar { height: 14px; }
    .table-horizontal-scroll::-webkit-scrollbar-track { background: #eef2f7; }
    .table-horizontal-scroll::-webkit-scrollbar-thumb {
      min-width: 72px;
      border: 3px solid #eef2f7;
      border-radius: 999px;
      background: #94a3b8;
    }
    .table-horizontal-scroll::-webkit-scrollbar-thumb:hover { background: #64748b; }
  `;
  document.head.append(style);

  const scrollbar = document.createElement("div");
  scrollbar.id = "launch-table-horizontal-scroll";
  scrollbar.className = "table-horizontal-scroll";
  scrollbar.setAttribute("role", "region");
  scrollbar.setAttribute("aria-label", "상품 표 가로 스크롤");
  scrollbar.title = "드래그하여 표를 좌우로 이동하세요.";

  const track = document.createElement("div");
  track.className = "table-horizontal-scroll-track";
  scrollbar.append(track);
  tableWrap.before(scrollbar);

  let syncingFromTop = false;
  let syncingFromTable = false;

  scrollbar.addEventListener("scroll", () => {
    if (syncingFromTable) return;
    syncingFromTop = true;
    tableWrap.scrollLeft = scrollbar.scrollLeft;
    syncingFromTop = false;
  });

  tableWrap.addEventListener("scroll", () => {
    if (syncingFromTop) return;
    syncingFromTable = true;
    scrollbar.scrollLeft = tableWrap.scrollLeft;
    syncingFromTable = false;
  });

  tableWrap.addEventListener(
    "wheel",
    (event) => {
      if (!event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      tableWrap.scrollLeft += event.deltaY;
    },
    { passive: false },
  );

  const refresh = () => {
    const contentWidth = Math.max(table.scrollWidth, tableWrap.clientWidth);
    track.style.width = `${contentWidth}px`;
    const needsHorizontalScroll = table.scrollWidth > tableWrap.clientWidth + 1;
    scrollbar.hidden = !needsHorizontalScroll;
    if (!needsHorizontalScroll) {
      scrollbar.scrollLeft = 0;
      tableWrap.scrollLeft = 0;
    } else {
      scrollbar.scrollLeft = tableWrap.scrollLeft;
    }
  };

  const resizeObserver = new ResizeObserver(refresh);
  resizeObserver.observe(tableWrap);
  resizeObserver.observe(table);

  const mutationObserver = new MutationObserver(refresh);
  mutationObserver.observe(table, { childList: true, subtree: true, attributes: true });

  window.addEventListener("resize", refresh, { passive: true });
  window.requestAnimationFrame(refresh);
}
