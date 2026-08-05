const tableBody = document.querySelector("#launch-table-body");
const EMPTY_CELL_INPUT_SELECTOR = [
  ".barcode-input",
  ".inline-category-editor",
  ".inline-options-editor",
].join(", ");

let cleanupQueued = false;

clearEmptyCellExamples();

if (tableBody) {
  new MutationObserver(queueCleanup).observe(tableBody, {
    childList: true,
    subtree: true,
  });
}

window.addEventListener("product-launch-tracker:external-state", queueCleanup);

function queueCleanup() {
  if (cleanupQueued) return;
  cleanupQueued = true;
  window.requestAnimationFrame(() => {
    cleanupQueued = false;
    clearEmptyCellExamples();
  });
}

function clearEmptyCellExamples() {
  const root = tableBody ?? document;
  for (const input of root.querySelectorAll(EMPTY_CELL_INPUT_SELECTOR)) {
    if (input instanceof HTMLInputElement) {
      input.removeAttribute("placeholder");
    }
  }
}
