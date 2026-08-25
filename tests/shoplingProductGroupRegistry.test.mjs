import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Shopling goods_key와 상품그룹을 영구 원장에 저장하고 DM/SM 검색접두어를 유지한다", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260825132319_shopling_product_group_registry.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /shopling_product_group_registry/);
  assert.match(migration, /primary key \(owner_id, goods_key\)/);
  assert.match(migration, /'DM1_'/);
  assert.match(migration, /'DM2_'/);
  assert.match(migration, /'DM3_'/);
  assert.match(migration, /'DM4_'/);
  assert.match(migration, /'SM1_'/);
  assert.match(migration, /'SM2_'/);
  assert.match(migration, /sync_shopling_product_group_registry_from_launch_item/);
  assert.match(migration, /after insert or update of item_payload, self_code_base, model_number/);
  assert.match(migration, /code_format.*legacy_suffix/s);
  assert.match(migration, /code_format.*group_prefix/s);
});

test("현재 상품 상태에서 빠진 과거 Shopling goods_key도 성공 업로드 작업에서 복구한다", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260825133050_shopling_product_group_registry_job_backfill.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /product_launch_upload_jobs/);
  assert.match(migration, /jsonb_array_elements/);
  assert.match(migration, /r->>'goods_key'/);
  assert.match(migration, /r->>'channel_key'/);
  assert.match(migration, /r->>'ptn_goods_cd'/);
  assert.match(migration, /row_number\(\) over/);
  assert.match(migration, /on conflict \(owner_id, goods_key\) do update/);
});
