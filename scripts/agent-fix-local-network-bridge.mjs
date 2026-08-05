import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, search, replacement, label) {
  const source = readFileSync(path, "utf8");
  const count = source.split(search).length - 1;
  if (count !== 1) {
    throw new Error(`${path}: ${label} expected once, found ${count}`);
  }
  writeFileSync(path, source.replace(search, replacement));
}

function replaceAllRequired(path, search, replacement, minimum, label) {
  const source = readFileSync(path, "utf8");
  const count = source.split(search).length - 1;
  if (count < minimum) {
    throw new Error(`${path}: ${label} expected at least ${minimum}, found ${count}`);
  }
  writeFileSync(path, source.split(search).join(replacement));
}

const targetAddressFiles = [
  "public/product-launch-tracker-app/detail-page-dock.js",
  "public/product-launch-tracker-app/category-local-update.js",
  "public/product-launch-tracker-app/category-local-result-recovery.js",
  "src/components/OpsCategoryUpdateCancelControl.tsx",
  "tests/productLaunchTrackerDetailPageDock.test.mjs",
  "tests/shoplingCategoryLocalUpdate.test.mjs",
];

for (const path of targetAddressFiles) {
  replaceAllRequired(
    path,
    'targetAddressSpace: "loopback"',
    'targetAddressSpace: "local"',
    1,
    "Chrome Local Network Access target address space",
  );
}

const dockPath = "public/product-launch-tracker-app/detail-page-dock.js";
replaceOnce(
  dockPath,
  'const LOCAL_BRIDGE_RELAY_BODY_LIMIT = 16 * 1024;\nconst POLL_INTERVAL_MS = 2500;',
  'const LOCAL_BRIDGE_RELAY_BODY_LIMIT = 16 * 1024;\nconst LOCAL_BRIDGE_START_PROTOCOL = "seungjun-ops-bridge://start";\nconst LOCAL_BRIDGE_START_WAIT_MS = 12 * 1000;\nconst LOCAL_BRIDGE_RETRY_INTERVAL_MS = 1000;\nconst POLL_INTERVAL_MS = 2500;',
  "local bridge recovery constants",
);

replaceOnce(
  dockPath,
  `async function ensureLocalCollectorReady() {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), LOCAL_BRIDGE_TIMEOUT_MS);
  try {
    const response = await fetch(LOCAL_BRIDGE_HEALTH_URL, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
      targetAddressSpace: "local",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(\`status=\${response.status}\`);
    if (
      payload.ok !== true ||
      payload.service !== "product-detail-page-auto-local-ops-bridge"
    ) {
      throw new Error("unexpected-local-bridge");
    }
    if (payload.evidence_import_supported !== true) {
      throw new Error(
        "로컬 수집기 업데이트가 필요합니다. 최신 수집기를 실행한 뒤 다시 시도하세요.",
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("업데이트")) throw error;
    throw new Error(
      "로컬 수집기에 연결하지 못했습니다. Chrome 주소창 왼쪽 사이트 설정에서 ‘로컬 네트워크 액세스’를 허용하고, 수집기 PowerShell 창을 켠 뒤 다시 누르세요.",
    );
  } finally {
    window.clearTimeout(timer);
  }
}`,
  `async function probeLocalCollectorReady(timeoutMs = LOCAL_BRIDGE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(LOCAL_BRIDGE_HEALTH_URL, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
      targetAddressSpace: "local",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(\`status=\${response.status}\`);
    if (
      payload.ok !== true ||
      payload.service !== "product-detail-page-auto-local-ops-bridge"
    ) {
      throw new Error("unexpected-local-bridge");
    }
    if (payload.evidence_import_supported !== true) {
      throw new Error(
        "로컬 수집기 업데이트가 필요합니다. 최신 수집기를 실행한 뒤 다시 시도하세요.",
      );
    }
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

function requestLocalCollectorStart() {
  window.location.href = LOCAL_BRIDGE_START_PROTOCOL;
}

async function waitForLocalCollectorReady() {
  const deadline = Date.now() + LOCAL_BRIDGE_START_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, LOCAL_BRIDGE_RETRY_INTERVAL_MS));
    try {
      await probeLocalCollectorReady(2_000);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes("업데이트")) throw error;
    }
  }
  return false;
}

async function ensureLocalCollectorReady() {
  try {
    await probeLocalCollectorReady();
    return;
  } catch (error) {
    if (error instanceof Error && error.message.includes("업데이트")) throw error;
  }

  const shouldStart = window.confirm(
    "승준컴 로컬 수집기가 꺼져 있거나 Chrome 연결 권한이 아직 허용되지 않았습니다.\n\n확인을 누르면 수집기를 자동 실행하고 약 12초 동안 다시 연결합니다.",
  );
  if (shouldStart) {
    showRunStatus("승준컴 로컬 수집기 자동 실행 요청 · 연결을 다시 확인하고 있습니다.", "progress");
    requestLocalCollectorStart();
    if (await waitForLocalCollectorReady()) return;
  }

  throw new Error(
    shouldStart
      ? "수집기 자동 실행 후에도 연결되지 않았습니다. Chrome 주소창 왼쪽 사이트 설정에서 ‘로컬 네트워크 액세스’를 허용한 뒤 다시 누르세요. 권한이 이미 허용되어 있다면 승준컴 브릿지 프로토콜 설치 또는 PowerShell 수집기 실행 상태를 확인하세요."
      : "상세페이지 생성에는 승준컴 로컬 수집기가 필요합니다. 다시 실행할 때 자동 실행 확인창에서 ‘확인’을 누르거나 수집기 PowerShell 창을 켜주세요.",
  );
}`,
  "local collector recovery flow",
);

const dockTestPath = "tests/productLaunchTrackerDetailPageDock.test.mjs";
replaceOnce(
  dockTestPath,
  '  assert.match(dockSource, /Chrome 주소창 왼쪽 사이트 설정/);\n  assert.match(nextConfig, /Permissions-Policy/);',
  '  assert.match(dockSource, /Chrome 주소창 왼쪽 사이트 설정/);\n  assert.match(dockSource, /seungjun-ops-bridge:\\/\\/start/);\n  assert.match(dockSource, /waitForLocalCollectorReady/);\n  assert.match(dockSource, /수집기를 자동 실행하고 약 12초 동안 다시 연결합니다/);\n  assert.doesNotMatch(dockSource, /targetAddressSpace: "loopback"/);\n  assert.match(nextConfig, /Permissions-Policy/);',
  "local bridge recovery test coverage",
);
