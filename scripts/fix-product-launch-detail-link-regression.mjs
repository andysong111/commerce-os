import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
  fs.writeFileSync(path, content);
}

function replaceOnce(path, before, after) {
  const source = read(path);
  if (!source.includes(before)) {
    throw new Error(`missing patch anchor: ${path}\n${before.slice(0, 240)}`);
  }
  write(path, source.replace(before, after));
}

const optimizedApp = "public/product-launch-tracker-app/optimized-app.js";
replaceOnce(
  optimizedApp,
  `      <td class="row-actions" data-column-key="actions"><button class="row-action" type="button" data-action="detail">\${item.archivedAt ? "복구·수정" : "상세"}</button></td>`,
  `      <td class="row-actions" data-column-key="manage"><button class="row-action" type="button" data-action="detail">\${item.archivedAt ? "복구·수정" : "상품 상세"}</button></td>`,
);

const optimizedModel = "src/lib/productLaunchTrackerOptimized.ts";
replaceOnce(
  optimizedModel,
  `  chinaProductLinks: unknown[];`,
  `  chinaProductLinks: string[];`,
);
replaceOnce(
  optimizedModel,
  `  const chinaProductLinks = Array.isArray(item.chinaProductLinks)\n    ? item.chinaProductLinks.filter(isRecord).map((entry) => ({ ...entry }))\n    : [];`,
  `  const detailPageSource = asRecord(item.detailPageSource);\n  const rawChinaProductLinks = [\n    item.primaryChinaProductLink,\n    detailPageSource.primaryUrl,\n    ...(Array.isArray(item.chinaProductLinks) ? item.chinaProductLinks : []),\n    ...(Array.isArray(detailPageSource.urls) ? detailPageSource.urls : []),\n  ];\n  const chinaProductLinks = [\n    ...new Set(\n      rawChinaProductLinks\n        .map((entry) => {\n          if (!isRecord(entry)) return text(entry);\n          return text(entry.url ?? entry.href ?? entry.value);\n        })\n        .filter(Boolean),\n    ),\n  ].slice(0, 5);`,
);

const optimizedRoute = "src/app/api/product-launch-tracker/optimized/route.ts";
replaceOnce(
  optimizedRoute,
  `    const mode = request.nextUrl.searchParams.get("mode") || "page";\n    if (mode === "item") {`,
  `    const mode = request.nextUrl.searchParams.get("mode") || "page";\n    if (mode === "items") {\n      const requestedIds = [\n        ...new Set(\n          request.nextUrl.searchParams\n            .getAll("id")\n            .flatMap((value) => value.split(","))\n            .map((value) => value.trim())\n            .filter(Boolean),\n        ),\n      ];\n      if (!requestedIds.length) {\n        return Response.json(\n          {\n            ok: false,\n            code: "PRODUCT_LAUNCH_TRACKER_ITEM_IDS_REQUIRED",\n            message: "불러올 상품 ID가 필요합니다.",\n          },\n          { status: 400 },\n        );\n      }\n      if (requestedIds.length > 100) {\n        return Response.json(\n          {\n            ok: false,\n            code: "PRODUCT_LAUNCH_TRACKER_ITEM_LIMIT_EXCEEDED",\n            message: "한 번에 최대 100개 상품까지 불러올 수 있습니다.",\n          },\n          { status: 400 },\n        );\n      }\n      const items: unknown[] = [];\n      const missingIds: string[] = [];\n      for (const itemId of requestedIds) {\n        const item = getProductLaunchTrackerItem(loaded.index, itemId);\n        if (item) items.push(item);\n        else missingIds.push(itemId);\n      }\n      if (missingIds.length) {\n        return Response.json(\n          {\n            ok: false,\n            code: "PRODUCT_LAUNCH_TRACKER_ITEMS_NOT_FOUND",\n            message: "일부 상품 기록을 찾지 못했습니다. 목록을 새로고침한 뒤 다시 선택하세요.",\n            missingIds,\n          },\n          { status: 404 },\n        );\n      }\n      return Response.json({\n        ok: true,\n        stateExists: true,\n        items,\n        updatedAt: loaded.updatedAt,\n        schemaVersion: loaded.schemaVersion,\n      });\n    }\n\n    if (mode === "item") {`,
);

const dock = "public/product-launch-tracker-app/detail-page-dock.js";
replaceOnce(
  dock,
  `const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";\nconst ENGINE_CONFIG_API`,
  `const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";\nconst OPTIMIZED_TRACKER_API = "/api/product-launch-tracker/optimized";\nconst ENGINE_CONFIG_API`,
);
replaceOnce(
  dock,
  `    const selected = state.items.filter((item) => selectedIds.includes(String(item.id)));\n    if (selected.length !== selectedIds.length) {\n      const message = "선택 상태와 상품 데이터가 일치하지 않습니다. Ctrl+F5 후 다시 선택하세요.";\n      showRunStatus(message, "error");\n      showMessage(message, 15_000);\n      return;\n    }`,
  `    const selected = await loadAuthoritativeSelectedItems(state, selectedIds);`,
);
replaceOnce(
  dock,
  `function readState() {\n  try {`,
  `async function loadAuthoritativeSelectedItems(state, selectedIds) {\n  const localItems = Array.isArray(state?.items) ? state.items : [];\n  const orderSelected = (items) => {\n    const byId = new Map(items.map((item) => [String(item?.id ?? ""), item]));\n    const selected = selectedIds.map((itemId) => byId.get(itemId)).filter(Boolean);\n    if (selected.length !== selectedIds.length) {\n      throw new Error(\n        "선택 상태와 상품 데이터가 일치하지 않습니다. 목록을 새로고침한 뒤 다시 선택하세요.",\n      );\n    }\n    return selected;\n  };\n\n  if (state?.partialPage !== true) return orderSelected(localItems);\n\n  const params = new URLSearchParams({ mode: "items" });\n  selectedIds.forEach((itemId) => params.append("id", itemId));\n  const response = await fetch(\n    \\`\${OPTIMIZED_TRACKER_API}?\${params.toString()}\\`,\n    { credentials: "same-origin", cache: "no-store" },\n  );\n  const payload = await response.json().catch(() => ({}));\n  if (!response.ok || payload?.ok !== true || !Array.isArray(payload.items)) {\n    throw new Error(\n      payload?.message ||\n        "선택 상품의 최신 상세정보를 서버에서 불러오지 못했습니다.",\n    );\n  }\n  return orderSelected(payload.items);\n}\n\nfunction readState() {\n  try {`,
);

const optimizedTests = "tests/productLaunchTrackerOptimized.test.mjs";
write(
  optimizedTests,
  `${read(optimizedTests)}\n\ntest("list summary preserves canonical China product links for partial-page cache", () => {\n  const source = state(1);\n  source.items[0].chinaProductLinks = [\n    "https://detail.1688.com/offer/904143560486.html",\n  ];\n  let summary = summarizeProductLaunchTrackerItem(source.items[0]);\n  assert.deepEqual(summary.chinaProductLinks, [\n    "https://detail.1688.com/offer/904143560486.html",\n  ]);\n\n  source.items[0].chinaProductLinks = [];\n  source.items[0].primaryChinaProductLink =\n    "https://detail.1688.com/offer/111.html";\n  source.items[0].detailPageSource = {\n    primaryUrl: "https://detail.1688.com/offer/111.html",\n    urls: [\n      "https://detail.1688.com/offer/111.html",\n      "https://detail.1688.com/offer/222.html",\n    ],\n  };\n  summary = summarizeProductLaunchTrackerItem(source.items[0]);\n  assert.deepEqual(summary.chinaProductLinks, [\n    "https://detail.1688.com/offer/111.html",\n    "https://detail.1688.com/offer/222.html",\n  ]);\n});\n`,
);

const contractTests = "tests/productLaunchTrackerOptimizedContracts.test.mjs";
replaceOnce(
  contractTests,
  `const stateRoutePath = fileURLToPath(new URL("../src/app/api/product-launch-tracker/state/route.ts", import.meta.url));\nconst [app, entry, route, stateRoute] = await Promise.all(\n  [appPath, entryPath, routePath, stateRoutePath].map((path) => readFile(path, "utf8")),\n);`,
  `const stateRoutePath = fileURLToPath(new URL("../src/app/api/product-launch-tracker/state/route.ts", import.meta.url));\nconst dockPath = fileURLToPath(new URL("../public/product-launch-tracker-app/detail-page-dock.js", import.meta.url));\nconst [app, entry, route, stateRoute, dock] = await Promise.all(\n  [appPath, entryPath, routePath, stateRoutePath, dockPath].map((path) =>\n    readFile(path, "utf8"),\n  ),\n);`,
);
write(
  contractTests,
  `${read(contractTests)}\n\ntest("optimized table keeps the product detail action aligned with the manage column", () => {\n  assert.match(app, /data-column-key="manage"/);\n  assert.doesNotMatch(app, /data-column-key="actions"/);\n  assert.match(app, /상품 상세/);\n});\n\ntest("detail-page generation resolves full selected items when local cache is partial", () => {\n  assert.match(route, /mode === "items"/);\n  assert.match(route, /requestedIds\.length > 100/);\n  assert.match(dock, /loadAuthoritativeSelectedItems/);\n  assert.match(dock, /state\?\.partialPage !== true/);\n  assert.match(dock, /mode: "items"/);\n  assert.match(dock, /cache: "no-store"/);\n});\n`,
);

console.log("product launch detail action and China-link regression patch applied");
