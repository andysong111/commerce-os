type UnknownRecord = Record<string, unknown>;

export type ProductLaunchTrackerRow = {
  trackerRowNumber: number;
  item: UnknownRecord;
};

export type ProductLaunchTrackerSelectionInput = {
  rowExpression?: unknown;
  itemIds?: unknown;
  maxItems?: number;
};

const ROW_EXPRESSION_PATTERN = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/;

export function parseProductLaunchTrackerRowExpression(value: unknown) {
  const expression = String(value ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!expression || !ROW_EXPRESSION_PATTERN.test(expression)) {
    throw new Error(
      "상품출시진행관리 행번호 형식이 올바르지 않습니다. 예: 2430 또는 2430-2434,2440",
    );
  }

  const rows: number[] = [];
  const seen = new Set<number>();
  for (const part of expression.split(",")) {
    const [startText, endText] = part.split("-");
    const start = Number(startText);
    const end = endText === undefined ? start : Number(endText);
    if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(end)) {
      throw new Error("행번호는 1 이상의 정수여야 합니다.");
    }
    if (end < start) {
      throw new Error("행 범위의 종료 번호는 시작 번호보다 작을 수 없습니다.");
    }
    if (end - start > 500) {
      throw new Error("한 행 범위는 최대 501개까지만 입력할 수 있습니다.");
    }
    for (let row = start; row <= end; row += 1) {
      if (!seen.has(row)) {
        seen.add(row);
        rows.push(row);
      }
    }
  }
  return rows;
}

export function assignProductLaunchTrackerRowNumbers(itemsInput: unknown) {
  const items = Array.isArray(itemsInput) ? itemsInput.map(asRecord) : [];
  const used = new Set<number>();
  const preferred = items.map((item) => preferredRowNumber(item));

  for (const row of preferred) {
    if (row !== null && !used.has(row)) used.add(row);
  }
  let nextFallback = Math.max(0, ...used) + 1;

  return items.map((item, index): ProductLaunchTrackerRow => {
    const candidate = preferred[index];
    let trackerRowNumber: number;
    if (candidate !== null && firstIndexOf(preferred, candidate) === index) {
      trackerRowNumber = candidate;
    } else {
      while (used.has(nextFallback)) nextFallback += 1;
      trackerRowNumber = nextFallback;
      used.add(trackerRowNumber);
      nextFallback += 1;
    }
    return { trackerRowNumber, item };
  });
}

export function resolveProductLaunchTrackerSelection(
  itemsInput: unknown,
  input: ProductLaunchTrackerSelectionInput,
) {
  const rows = assignProductLaunchTrackerRowNumbers(itemsInput);
  const maxItems = normalizeMaxItems(input.maxItems);
  const itemIds = normalizeItemIds(input.itemIds);
  const requestedRows =
    String(input.rowExpression ?? "").trim() !== ""
      ? parseProductLaunchTrackerRowExpression(input.rowExpression)
      : [];

  if (!itemIds.length && !requestedRows.length) {
    throw new Error("상품출시진행관리 행번호 또는 선택 상품 ID가 필요합니다.");
  }

  const byId = new Map(
    rows.map((entry) => [String(entry.item.id ?? "").trim(), entry] as const),
  );
  const byRow = new Map(rows.map((entry) => [entry.trackerRowNumber, entry] as const));
  const selected: ProductLaunchTrackerRow[] = [];
  const seenIds = new Set<string>();
  const missingIds: string[] = [];
  const missingRows: number[] = [];

  for (const itemId of itemIds) {
    const entry = byId.get(itemId);
    if (!entry) {
      missingIds.push(itemId);
      continue;
    }
    appendUnique(selected, seenIds, entry);
  }
  for (const rowNumber of requestedRows) {
    const entry = byRow.get(rowNumber);
    if (!entry) {
      missingRows.push(rowNumber);
      continue;
    }
    appendUnique(selected, seenIds, entry);
  }

  if (missingIds.length || missingRows.length) {
    const messages = [
      missingRows.length ? `찾을 수 없는 진행관리 행번호: ${missingRows.join(", ")}` : "",
      missingIds.length ? `찾을 수 없는 진행관리 상품 ID: ${missingIds.join(", ")}` : "",
    ].filter(Boolean);
    throw new Error(messages.join(" · "));
  }
  if (selected.length > maxItems) {
    throw new Error(
      `한 번에 최대 ${maxItems}개 상품까지만 상품출시플로우로 진행할 수 있습니다.`,
    );
  }
  return selected;
}

export function formatProductLaunchTrackerRowExpression(values: number[]) {
  const rows = [...new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0))]
    .sort((left, right) => left - right);
  if (!rows.length) return "";
  const parts: string[] = [];
  let start = rows[0];
  let previous = rows[0];
  for (const current of rows.slice(1)) {
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    parts.push(start === previous ? String(start) : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  parts.push(start === previous ? String(start) : `${start}-${previous}`);
  return parts.join(",");
}

function preferredRowNumber(item: UnknownRecord) {
  const explicit = positiveInteger(item.trackerRowNumber);
  if (explicit !== null) return explicit;
  const source = asRecord(item.source);
  const rows = Array.isArray(source.rows) ? source.rows : [];
  for (const value of rows) {
    const row = positiveInteger(value);
    if (row !== null) return row;
  }
  return null;
}

function appendUnique(
  target: ProductLaunchTrackerRow[],
  seenIds: Set<string>,
  entry: ProductLaunchTrackerRow,
) {
  const itemId = String(entry.item.id ?? "").trim();
  const key = itemId || `row:${entry.trackerRowNumber}`;
  if (seenIds.has(key)) return;
  seenIds.add(key);
  target.push(entry);
}

function normalizeItemIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function normalizeMaxItems(value: unknown) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, 100) : 20;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function firstIndexOf(values: Array<number | null>, target: number) {
  return values.findIndex((value) => value === target);
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}
