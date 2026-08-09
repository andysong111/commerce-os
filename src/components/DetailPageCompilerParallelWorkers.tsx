"use client";

import { DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE } from "@/lib/detailPageCompilerWorkerPool";

export function DetailPageCompilerParallelWorkers() {
  return (
    <>
      {Array.from(
        { length: Math.max(0, DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE - 1) },
        (_, index) => index + 1,
      ).map((slot) => (
        <iframe
          key={slot}
          title={`Compiler 백그라운드 병렬 실행기 ${slot + 1}`}
          src={`/product-launch-tracker-app/index.html?detail_page_mode=worker&compiler_worker_slot=${slot}&compiler_worker_slots=${DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE}`}
          allow="local-network; loopback-network; local-network-access"
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none fixed -left-[2400px] top-0 z-[-1] h-[900px] w-[1280px] border-0 opacity-0"
        />
      ))}
    </>
  );
}
