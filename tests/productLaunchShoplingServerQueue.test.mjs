import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientUrl = new URL(
  "../src/app/seo-bulk-cloud/SeoBulkDurableRunCloudClient.tsx",
  import.meta.url,
);
const apiUrl = new URL("../src/app/api/seo-run-jobs/route.ts", import.meta.url);
const pulseUrl = new URL(
  "../src/app/api/seo-run-shopling-wakeup/route.ts",
  import.meta.url,
);
const workerUrl = new URL(
  "../src/lib/seoRunShoplingRegistrationQueue.ts",
  import.meta.url,
);

test("Shopling 일괄등록 버튼은 브라우저 직접 실행 대신 서버 큐에 RUN을 일괄 적재한다", async () => {
  const client = await readFile(clientUrl, "utf8");
  assert.match(client, /SERVER_OWNS_SHOPLING_REGISTRATION = true/);
  assert.match(client, /action: "queue_registration"/);
  assert.match(client, /targets\.map\(\(run\) => run\.run_id\)/);
  assert.match(client, /PC를 꺼도 서버가 분 단위로 계속 소화합니다/);
});

test("SEO RUN API는 200건 이상 배치를 수용하고 등록 요청을 한 번에 queued로 전환한다", async () => {
  const source = await readFile(apiUrl, "utf8");
  assert.match(source, /const MAX_ENQUEUE_RUNS = 250/);
  assert.match(source, /stringList\(value, 500\)/);
  assert.match(source, /action === "queue_registration"/);
  assert.match(source, /registration_status: "queued"/);
  assert.match(source, /registration_job_id: ""/);
});

test("Shopling 전용 서버 pulse는 bounded 등록큐를 먼저 소화한 뒤 실제 성공 대조와 후처리를 이어간다", async () => {
  const source = await readFile(pulseUrl, "utf8");
  const queueIndex = source.indexOf(
    "registrationQueue = await processSeoRunShoplingRegistrationQueue",
  );
  const truthIndex = source.indexOf(
    "registrationTruth = await reconcileVerifiedShoplingRegistrations",
  );
  const postprocessIndex = source.indexOf(
    "postprocess = await processProductLaunchShoplingPostprocessQueue",
  );
  assert.ok(queueIndex >= 0);
  assert.ok(truthIndex > queueIndex);
  assert.ok(postprocessIndex > truthIndex);
  assert.match(source, /maxStarts: 5/);
  assert.match(source, /maxMonitors: 100/);
  assert.match(source, /maxRuns: 60/);
  assert.match(source, /maxItems: 10/);
});

test("등록큐는 같은 상품의 여러 RUN을 순차 처리하고 외부 workflow만 병렬화한다", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /earliestByItem/);
  assert.match(source, /slice\(0, maxStarts\)/);
  assert.match(source, /for \(const run of starts\)/);
  assert.match(source, /Prepare sequentially because all launch items for one owner share one legacy state row/);
  assert.match(source, /MAX_TRANSIENT_RETRIES = 3/);
  assert.match(source, /isTransientRegistrationError/);
});

test("서버 등록큐는 기존 exact-item 옵션 복구와 readback 기반 진실값 체계를 재사용한다", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /recoverProductLaunchOrderOptionsFromSuccessfulUpload/);
  assert.match(source, /buildProductLaunchShoplingPayload/);
  assert.match(source, /launch_item_id: `eq\.\$\{launchItemId\}`/);
  assert.match(source, /attachedExistingJob/);
  assert.match(source, /previous_same_self_code_job_failed/);
});

test("workflow dispatch 직전 job/selfCode를 RUN 원장에 먼저 저장해 응답 단절 후 중복 재등록을 막는다", async () => {
  const source = await readFile(workerUrl, "utf8");
  const jobInsert = source.indexOf("await insertUploadJob(config, jobRow)");
  const dispatchIdentity = source.indexOf("dispatchJobId: jobId");
  const runPatch = source.indexOf("registration_job_id: jobId", dispatchIdentity);
  const dispatchCall = source.indexOf("await dispatchLaunchWorkflow(jobId, requestId)");
  assert.ok(jobInsert >= 0);
  assert.ok(dispatchIdentity > jobInsert);
  assert.ok(runPatch > dispatchIdentity);
  assert.ok(dispatchCall > runPatch);
  assert.match(source, /let latestPayload: UnknownRecord/);
  assert.match(source, /\.\.\.latestPayload/);
  assert.match(source, /registration_job_id: text\(latestPayload\.dispatchJobId\)/);
  assert.match(source, /registration_request_id: text\(latestPayload\.dispatchRequestId\)/);
});
