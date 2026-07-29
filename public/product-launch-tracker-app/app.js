import {
  applyStageStatus,
  createLaunchItem,
  getNextStage,
  getOverallStatus,
  getProgress,
  hydrateLaunchItem,
  normalizeBarcode,
  normalizeModelNumber,
  normalizeOptions,
  parsePastedRows,
  sortLaunchItems,
  STATUS_OPTIONS,
  STAGES,
  toCsv,
} from "./lib/tracker-core.mjs";

const STORAGE_KEY = "commerce-os-product-launch-tracker:v1";
const state = {
  meta: null,
  seedItems: [],
  items: [],
  selectedIds: new Set(),
  visibleItems: [],
  sort: {
    key: null,
    direction: "desc",
  },
  filters: {
    search: "",
    batch: "",
    assignee: "",
    overall: "",
    unfinishedOnly: true,
  },
};

const elements = {
  summary: document.querySelector("#summary"),
  sourceMeta: document.querySelector("#source-meta"),
  saveStatus: document.querySelector("#save-status"),
  search: document.querySelector("#search-input"),
  batch: document.querySelector("#batch-filter"),
  assignee: document.querySelector("#assignee-filter"),
  overall: document.querySelector("#overall-filter"),
  unfinishedOnly: document.querySelector("#unfinished-only-filter"),
  visibleCount: document.querySelector("#visible-count"),
  selectedCount: document.querySelector("#selected-count"),
  bulkStage: document.querySelector("#bulk-stage"),
  bulkStatus: document.querySelector("#bulk-status"),
  tableBody: document.querySelector("#launch-table-body"),
  tableHead: document.querySelector("#launch-table-head"),
  emptyState: document.querySelector("#empty-state"),
  selectVisible: document.querySelector("#select-visible"),
  detailDialog: document.querySelector("#detail-dialog"),
  detailForm: document.querySelector("#detail-form"),
  detailTitle: document.querySelector("#detail-dialog-title"),
  detailStages: document.querySelector("#detail-stages"),
  detailSource: document.querySelector("#detail-source"),
  archiveButton: document.querySelector("#archive-button"),
  addDialog: document.querySelector("#add-dialog"),
  addForm: document.querySelector("#add-form"),
  pastePreview: document.querySelector("#paste-preview"),
  exportDialog: document.querySelector("#export-dialog"),
  backupInput: document.querySelector("#backup-file-input"),
  toast: document.querySelector("#toast"),
};

await bootstrap();

async function bootstrap() {
  try {
    const response = await fetch("./data/launch-items.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`초기 데이터 응답 오류: ${response.status}`);
    const seed = await response.json();
    state.meta = seed.meta;
    state.seedItems = seed.items.map(hydrateLaunchItem);
    state.items = loadStoredItems(seed);
    bindControls();
    fillStaticOptions();
    render();
    elements.saveStatus.textContent = "이 브라우저에 자동 저장";
  } catch (error) {
    console.error(error);
    elements.saveStatus.textContent = "데이터 불러오기 실패";
    elements.tableBody.innerHTML = `
      <tr><td colspan="16" class="empty-state">초기 데이터를 불러오지 못했습니다. 페이지를 새로고침해 주세요.</td></tr>
    `;
  }
}

function loadStoredItems(seed) {
  const stored = safeJsonParse(localStorage.getItem(STORAGE_KEY));
  if (!stored?.items || !Array.isArray(stored.items)) {
    return structuredClone(seed.items).map(hydrateLaunchItem);
  }

  const storedById = new Map(
    stored.items.map((item) => [item.id, hydrateLaunchItem(item)]),
  );
  const merged = seed.items.map((item) =>
    hydrateLaunchItem(storedById.get(item.id) ?? item),
  );
  const seedIds = new Set(seed.items.map((item) => item.id));
  for (const item of stored.items) {
    if (!seedIds.has(item.id)) merged.push(hydrateLaunchItem(item));
  }
  return merged;
}

function bindControls() {
  elements.search.addEventListener("input", (event) => {
    state.filters.search = event.target.value;
    renderTable();
  });
  elements.batch.addEventListener("change", (event) => {
    state.filters.batch = event.target.value;
    renderTable();
  });
  elements.assignee.addEventListener("change", (event) => {
    state.filters.assignee = event.target.value;
    renderTable();
  });
  elements.overall.addEventListener("change", (event) => {
    state.filters.overall = event.target.value;
    if (event.target.value === "완료" || event.target.value === "보관됨") {
      state.filters.unfinishedOnly = false;
      elements.unfinishedOnly.checked = false;
    }
    renderTable();
  });
  elements.unfinishedOnly.addEventListener("change", (event) => {
    state.filters.unfinishedOnly = event.target.checked;
    if (event.target.checked && ["완료", "보관됨"].includes(state.filters.overall)) {
      state.filters.overall = "";
      elements.overall.value = "";
    }
    renderTable();
  });
  document.querySelector("#add-items-button").addEventListener("click", openAddDialog);
  document
    .querySelector("#export-menu-button")
    .addEventListener("click", () => elements.exportDialog.showModal());
  document
    .querySelector("#bulk-apply-button")
    .addEventListener("click", applyBulkStatus);
  document
    .querySelector("#clear-selection-button")
    .addEventListener("click", clearSelection);
  elements.selectVisible.addEventListener("change", toggleVisibleSelection);
  elements.tableHead.addEventListener("click", handleSortClick);
  elements.tableBody.addEventListener("change", handleTableChange);
  elements.tableBody.addEventListener("keydown", handleTableKeydown);
  elements.tableBody.addEventListener("click", handleTableClick);
  elements.detailForm.addEventListener("submit", saveDetailForm);
  elements.archiveButton.addEventListener("click", archiveCurrentItem);
  elements.addForm.addEventListener("submit", savePastedItems);
  elements.addForm.elements.paste.addEventListener("input", updatePastePreview);
  document.querySelector("#export-json-button").addEventListener("click", exportJson);
  document.querySelector("#export-csv-button").addEventListener("click", exportCsv);
  document
    .querySelector("#import-json-button")
    .addEventListener("click", () => elements.backupInput.click());
  elements.backupInput.addEventListener("change", importBackup);
  document.querySelector("#reset-seed-button").addEventListener("click", resetToSeed);
}

function fillStaticOptions() {
  elements.bulkStage.innerHTML = STAGES.map(
    ({ key, label }) => `<option value="${key}">${label}</option>`,
  ).join("");
  elements.bulkStatus.innerHTML = STATUS_OPTIONS.map(
    (status) => `<option value="${status}">${status}</option>`,
  ).join("");
  refreshFilterOptions();
}

function refreshFilterOptions() {
  const currentBatch = elements.batch.value;
  const currentAssignee = elements.assignee.value;
  const batches = unique(state.items.map((item) => item.workBatch).filter(Boolean)).sort(
    localeSort,
  );
  const assignees = unique(
    state.items.flatMap((item) =>
      STAGES.map(({ key }) => item.stages[key]?.assignee).filter(Boolean),
    ),
  ).sort(localeSort);
  elements.batch.innerHTML = optionList("전체 작업 묶음", batches);
  elements.assignee.innerHTML = optionList("전체 담당자", assignees);
  elements.batch.value = batches.includes(currentBatch) ? currentBatch : "";
  elements.assignee.value = assignees.includes(currentAssignee) ? currentAssignee : "";
}

function optionList(allLabel, values) {
  return [
    `<option value="">${allLabel}</option>`,
    ...values.map((value) => `<option value="${escapeAttribute(value)}">${escapeHtml(value)}</option>`),
  ].join("");
}

function render() {
  refreshFilterOptions();
  renderSummary();
  renderTable();
  elements.sourceMeta.textContent = `${state.meta.sourceFile} · 상품 ${number(
    state.meta.launchItemCount,
  )}건 이관`;
}

function renderSummary() {
  const counts = {
    전체: state.items.filter((item) => !item.archivedAt).length,
    "진행 중": state.items.filter((item) => getOverallStatus(item) === "진행 중").length,
    보류: state.items.filter((item) => getOverallStatus(item) === "보류").length,
    완료: state.items.filter((item) => getOverallStatus(item) === "완료").length,
    "검토 표시": state.items.filter((item) => item.migrationReview && !item.archivedAt)
      .length,
  };
  const tones = ["", "blue", "amber", "emerald", "amber"];
  elements.summary.innerHTML = Object.entries(counts)
    .map(
      ([label, value], index) => `
        <article class="summary-card" data-tone="${tones[index]}">
          <span>${label}</span>
          <strong>${number(value)}</strong>
        </article>
      `,
    )
    .join("");
}

function renderTable() {
  const search = state.filters.search.trim().toLocaleLowerCase("ko-KR");
  state.visibleItems = sortLaunchItems(
    state.items.filter((item) => {
      const overall = getOverallStatus(item);
      if (state.filters.unfinishedOnly && ["완료", "보관됨"].includes(overall)) {
        return false;
      }
      if (state.filters.batch && item.workBatch !== state.filters.batch) return false;
      if (
        state.filters.assignee &&
        !STAGES.some(({ key }) => item.stages[key]?.assignee === state.filters.assignee)
      ) {
        return false;
      }
      if (state.filters.overall && overall !== state.filters.overall) return false;
      if (search && !searchableText(item).includes(search)) return false;
      return true;
    }),
    state.sort,
  );

  elements.tableBody.innerHTML = state.visibleItems.map(renderRow).join("");
  updateSortHeaders();
  elements.visibleCount.textContent = `${number(state.visibleItems.length)}건`;
  elements.selectedCount.textContent = `선택 ${number(state.selectedIds.size)}건`;
  elements.emptyState.hidden = state.visibleItems.length > 0;
  const visibleIds = state.visibleItems.map((item) => item.id);
  elements.selectVisible.checked =
    visibleIds.length > 0 && visibleIds.every((id) => state.selectedIds.has(id));
  elements.selectVisible.indeterminate =
    !elements.selectVisible.checked && visibleIds.some((id) => state.selectedIds.has(id));
}

function handleSortClick(event) {
  const button = event.target.closest("button[data-sort-key]");
  if (!button) return;
  const key = button.dataset.sortKey;
  state.sort = {
    key,
    direction:
      state.sort.key === key && state.sort.direction === "asc" ? "desc" : "asc",
  };
  renderTable();
}

function updateSortHeaders() {
  for (const header of elements.tableHead.querySelectorAll("th[data-sort-key]")) {
    const button = header.querySelector("button[data-sort-key]");
    const indicator = button.querySelector(".sort-indicator");
    const active = header.dataset.sortKey === state.sort.key;
    const direction = active ? state.sort.direction : null;
    const nextDirection = direction === "asc" ? "내림차순" : "오름차순";
    header.setAttribute(
      "aria-sort",
      direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none",
    );
    indicator.textContent = direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕";
    button.title = `${nextDirection} 정렬`;
    button.setAttribute(
      "aria-label",
      `${button.dataset.sortLabel} 열${
        active ? `, 현재 ${direction === "asc" ? "오름차순" : "내림차순"}` : ""
      }. 클릭하면 ${nextDirection} 정렬`,
    );
  }
}

function renderRow(item) {
  const selected = state.selectedIds.has(item.id);
  const progress = getProgress(item);
  return `
    <tr data-id="${escapeAttribute(item.id)}" class="${selected ? "is-selected" : ""} ${
      item.archivedAt ? "is-archived" : ""
    }">
      <td class="check-column">
        <input class="row-check" type="checkbox" ${selected ? "checked" : ""} aria-label="${
          escapeAttribute(item.modelNumber)
        } 선택" />
      </td>
      <td class="cell-truncate" title="${escapeAttribute(item.workBatch)}">${escapeHtml(
        item.workBatch,
      )}</td>
      <td>${item.warehouseLocation ? escapeHtml(item.warehouseLocation) : muted("미입력")}</td>
      <td>
        <input
          class="barcode-input"
          value="${escapeAttribute(item.barcode)}"
          placeholder="BAA1-1"
          autocomplete="off"
          aria-label="${escapeAttribute(item.modelNumber)} 바코드"
        />
      </td>
      <td><span class="model-number">${escapeHtml(item.modelNumber)}</span>${
        item.migrationReview
          ? '<span class="review-dot" title="이관 검토 표시"></span>'
          : ""
      }</td>
      <td class="product-name cell-truncate" title="${escapeAttribute(item.productName)}">${escapeHtml(
        item.productName,
      )}</td>
      <td class="options-cell cell-truncate" title="${escapeAttribute(
        item.options.join(", "),
      )}">${item.options.length ? escapeHtml(item.options.join(", ")) : muted("단품/미입력")}</td>
      ${STAGES.map(({ key }) => statusSelect(item, key)).join("")}
      <td class="next-stage">${escapeHtml(getNextStage(item))}
        <span class="progress-text">${progress.completed}/${progress.total} 완료</span>
      </td>
      <td class="cell-truncate" title="${escapeAttribute(item.notes)}">${
        item.notes ? escapeHtml(item.notes) : muted("—")
      }</td>
      <td><button class="row-action" type="button" data-action="detail">${
        item.archivedAt ? "복구·수정" : "상세"
      }</button></td>
    </tr>
  `;
}

function statusSelect(item, key) {
  const status = item.stages[key]?.status ?? "미시작";
  const className = `status-${status.replaceAll(" ", "-")}`;
  return `
    <td>
      <select class="status-select ${className}" data-stage="${key}" aria-label="${
        escapeAttribute(item.modelNumber)
      } ${key} 상태">
        ${STATUS_OPTIONS.map(
          (option) =>
            `<option value="${option}" ${option === status ? "selected" : ""}>${option}</option>`,
        ).join("")}
      </select>
    </td>
  `;
}

function handleTableChange(event) {
  const row = event.target.closest("tr[data-id]");
  if (!row) return;
  const id = row.dataset.id;
  if (event.target.matches(".row-check")) {
    if (event.target.checked) state.selectedIds.add(id);
    else state.selectedIds.delete(id);
    renderTable();
    return;
  }
  if (event.target.matches(".barcode-input")) {
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) return;
    const barcode = normalizeBarcode(event.target.value);
    if (barcode === item.barcode) {
      event.target.value = barcode;
      return;
    }
    replaceItem({
      ...item,
      barcode,
      updatedAt: new Date().toISOString(),
      updatedBy: "승준",
    });
    showToast(`${item.modelNumber} 바코드를 저장했습니다.`);
    return;
  }
  if (event.target.matches(".status-select")) {
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) return;
    const status = event.target.value;
    const stageKey = event.target.dataset.stage;
    let reason = "";
    if (status === "보류") {
      reason = window.prompt("보류 사유를 입력해 주세요.", item.notes ?? "")?.trim() ?? "";
      if (!reason) {
        renderTable();
        showToast("보류 사유가 없어 변경하지 않았습니다.");
        return;
      }
    }
    const changed = applyStageStatus(item, stageKey, status);
    if (reason) {
      changed.stages[stageKey].note = reason;
      changed.notes = appendNote(changed.notes, reason);
    }
    replaceItem(changed);
  }
}

function handleTableKeydown(event) {
  if (event.key === "Enter" && event.target.matches(".barcode-input")) {
    event.preventDefault();
    event.target.blur();
  }
}

function handleTableClick(event) {
  const button = event.target.closest("button[data-action='detail']");
  if (!button) return;
  const row = button.closest("tr[data-id]");
  openDetail(row.dataset.id);
}

function toggleVisibleSelection(event) {
  for (const item of state.visibleItems) {
    if (event.target.checked) state.selectedIds.add(item.id);
    else state.selectedIds.delete(item.id);
  }
  renderTable();
}

function clearSelection() {
  state.selectedIds.clear();
  renderTable();
}

function applyBulkStatus() {
  if (!state.selectedIds.size) {
    showToast("일괄 변경할 상품을 먼저 선택해 주세요.");
    return;
  }
  const stageKey = elements.bulkStage.value;
  const status = elements.bulkStatus.value;
  let reason = "";
  if (status === "보류") {
    reason = window.prompt("선택 항목에 공통으로 기록할 보류 사유를 입력해 주세요.")?.trim() ?? "";
    if (!reason) return;
  }
  state.items = state.items.map((item) => {
    if (!state.selectedIds.has(item.id)) return item;
    const changed = applyStageStatus(item, stageKey, status);
    if (reason) {
      changed.stages[stageKey].note = reason;
      changed.notes = appendNote(changed.notes, reason);
    }
    return changed;
  });
  persist();
  render();
  showToast(`${number(state.selectedIds.size)}건의 상태를 ${status}(으)로 변경했습니다.`);
}

function openDetail(id) {
  const item = state.items.find((candidate) => candidate.id === id);
  if (!item) return;
  const form = elements.detailForm;
  for (const name of [
    "id",
    "workBatch",
    "warehouseLocation",
    "barcode",
    "modelNumber",
    "goodsKey",
    "productName",
    "notes",
  ]) {
    form.elements[name].value = item[name] ?? "";
  }
  form.elements.options.value = item.options.join(", ");
  elements.detailTitle.textContent = `${item.modelNumber} · ${item.productName}`;
  elements.detailStages.innerHTML = STAGES.map(
    ({ key, label }) => `
      <section class="stage-card">
        <h3>${label}</h3>
        <label class="field">
          <span>상태</span>
          <select name="stage.${key}.status">
            ${STATUS_OPTIONS.map(
              (status) =>
                `<option value="${status}" ${
                  item.stages[key].status === status ? "selected" : ""
                }>${status}</option>`,
            ).join("")}
          </select>
        </label>
        <label class="field">
          <span>담당자</span>
          <input name="stage.${key}.assignee" value="${escapeAttribute(
            item.stages[key].assignee,
          )}" placeholder="예: 경주님" />
        </label>
      </section>
    `,
  ).join("");
  elements.detailSource.innerHTML = `
    <strong>원본 이력</strong><br />
    ${escapeHtml(item.source?.file ?? state.meta.sourceFile ?? "직접 추가")} · ${escapeHtml(
      item.source?.sheet ?? state.meta.sourceSheet ?? "",
    )}<br />
    원본 행: ${escapeHtml((item.source?.rows ?? []).join(", ") || "없음")}
    ${
      item.source?.sheetRowRefs?.length
        ? `<br />기존 시트 행번호: ${escapeHtml(item.source.sheetRowRefs.join(", "))}`
        : ""
    }
    ${
      item.migrationReview
        ? "<br /><strong>이 항목은 같은 모델번호의 복수 출시 기록이 있어 검토 표시가 붙었습니다.</strong>"
        : ""
    }
  `;
  elements.archiveButton.textContent = item.archivedAt ? "보관에서 복구" : "보관 처리";
  elements.detailDialog.showModal();
}

function saveDetailForm(event) {
  event.preventDefault();
  if (event.submitter?.value !== "save") return;
  const formData = new FormData(elements.detailForm);
  const id = formData.get("id");
  const item = state.items.find((candidate) => candidate.id === id);
  if (!item) return;
  if (
    STAGES.some(
      ({ key }) =>
        formData.get(`stage.${key}.status`) === "보류" &&
        !String(formData.get("notes") ?? "").trim(),
    )
  ) {
    showToast("보류 상태에는 비고·보류 사유가 필요합니다.");
    return;
  }

  let changed = {
    ...item,
    workBatch: String(formData.get("workBatch") ?? "").trim(),
    warehouseLocation: String(formData.get("warehouseLocation") ?? "").trim(),
    barcode: normalizeBarcode(formData.get("barcode")),
    modelNumber: normalizeModelNumber(formData.get("modelNumber")),
    goodsKey: String(formData.get("goodsKey") ?? "").trim(),
    productName: String(formData.get("productName") ?? "").trim(),
    options: normalizeOptions(formData.get("options")),
    notes: String(formData.get("notes") ?? "").trim(),
  };
  for (const { key } of STAGES) {
    changed = applyStageStatus(
      changed,
      key,
      String(formData.get(`stage.${key}.status`) ?? "미시작"),
    );
    changed.stages[key].assignee = String(
      formData.get(`stage.${key}.assignee`) ?? "",
    ).trim();
  }
  replaceItem(changed);
  elements.detailDialog.close();
  showToast("상품 기록을 저장했습니다.");
}

function archiveCurrentItem() {
  const id = elements.detailForm.elements.id.value;
  const item = state.items.find((candidate) => candidate.id === id);
  if (!item) return;
  const action = item.archivedAt ? "복구" : "보관";
  if (!window.confirm(`${item.modelNumber} 항목을 ${action}하시겠습니까?`)) return;
  replaceItem({
    ...item,
    archivedAt: item.archivedAt ? null : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: "승준",
  });
  elements.detailDialog.close();
  showToast(`${item.modelNumber} 항목을 ${action}했습니다.`);
}

function openAddDialog() {
  elements.addForm.reset();
  updatePastePreview();
  elements.addDialog.showModal();
}

function updatePastePreview() {
  const parsed = parsePastedRows(elements.addForm.elements.paste.value);
  elements.pastePreview.textContent = `붙여넣은 상품 ${number(parsed.length)}건`;
}

function savePastedItems(event) {
  event.preventDefault();
  if (event.submitter?.value !== "save") return;
  const parsed = parsePastedRows(elements.addForm.elements.paste.value);
  if (!parsed.length) {
    showToast("추가할 상품이 없습니다.");
    return;
  }
  const created = parsed.map((row) =>
    createLaunchItem({
      ...row,
      updatedBy: "승준",
      sourceFile: "직접 붙여넣기",
    }),
  );
  state.items.push(...created);
  persist();
  render();
  elements.addDialog.close();
  showToast(`${number(created.length)}건을 추가했습니다.`);
}

function exportJson() {
  download(
    `신규상품출시진행관리_백업_${dateStamp()}.json`,
    JSON.stringify(
      {
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        sourceMeta: state.meta,
        items: state.items,
      },
      null,
      2,
    ),
    "application/json;charset=utf-8",
  );
  showToast("전체 백업 파일을 내려받았습니다.");
}

function exportCsv() {
  download(
    `신규상품출시진행관리_${dateStamp()}.csv`,
    `\uFEFF${toCsv(state.visibleItems)}`,
    "text/csv;charset=utf-8",
  );
  showToast("현재 목록 CSV를 내려받았습니다.");
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    const items = Array.isArray(backup) ? backup : backup.items;
    if (!Array.isArray(items) || !items.length) throw new Error("items가 없습니다.");
    if (!window.confirm(`백업 상품 ${number(items.length)}건으로 현재 기록을 교체할까요?`)) {
      return;
    }
    state.items = items.map(hydrateLaunchItem);
    state.selectedIds.clear();
    persist();
    render();
    elements.exportDialog.close();
    showToast("백업 파일을 복원했습니다.");
  } catch (error) {
    console.error(error);
    showToast("올바른 백업 파일이 아닙니다.");
  }
}

function resetToSeed() {
  if (
    !window.confirm(
      "현재 수정 내용이 모두 사라집니다. 업로드된 엑셀의 최초 이관 상태로 되돌릴까요?",
    )
  ) {
    return;
  }
  state.items = structuredClone(state.seedItems);
  state.selectedIds.clear();
  persist();
  render();
  elements.exportDialog.close();
  showToast("최초 이관 데이터로 되돌렸습니다.");
}

function replaceItem(changed) {
  state.items = state.items.map((item) => (item.id === changed.id ? changed : item));
  persist();
  render();
}

function persist() {
  elements.saveStatus.textContent = "저장 중";
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      schemaVersion: 2,
      sourceImportedAt: state.meta.importedAt,
      savedAt: new Date().toISOString(),
      items: state.items,
    }),
  );
  window.setTimeout(() => {
    elements.saveStatus.textContent = "방금 저장됨";
  }, 80);
}

function searchableText(item) {
  return [
    item.workBatch,
    item.warehouseLocation,
    item.barcode,
    item.modelNumber,
    item.productName,
    item.options.join(" "),
    item.notes,
    item.goodsKey,
    ...STAGES.flatMap(({ key }) => [
      item.stages[key]?.status,
      item.stages[key]?.assignee,
    ]),
  ]
    .join(" ")
    .toLocaleLowerCase("ko-KR");
}

function appendNote(current, next) {
  if (!current) return next;
  if (current.includes(next)) return current;
  return `${current} · ${next}`;
}

function muted(text) {
  return `<span class="cell-muted">${text}</span>`;
}

function unique(values) {
  return [...new Set(values)];
}

function localeSort(left, right) {
  return String(left).localeCompare(String(right), "ko-KR", {
    numeric: true,
    sensitivity: "base",
  });
}

function number(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function dateStamp() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

let toastTimer;
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2800);
}
