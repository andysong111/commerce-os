import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [importer, powershell] = await Promise.all([
  readFile(
    "scripts/import-encrypted-runtime-env-to-vercel.mjs",
    "utf8",
  ),
  readFile(
    "scripts/import-encrypted-runtime-env-to-vercel.ps1",
    "utf8",
  ),
]);

const targetKeys = [
  "PRODUCT_MASTER_BASE_URL",
  "PRODUCT_MASTER_INTEGRATION_SECRET",
  "SHOPLING_API_AUTH_KEY",
  "SHOPLING_COMPANY_ID",
  "SHOPLING_LOGIN_ID",
];

test("importer accepts only the existing encrypted runtime environment envelope", () => {
  assert.match(importer, /commerce-os-runtime-env-v1/);
  assert.match(importer, /PBKDF2/);
  assert.match(importer, /SHA-256/);
  assert.match(importer, /AES-GCM/);
  assert.match(importer, /createDecipheriv\("aes-256-gcm"/);
  assert.match(importer, /pbkdf2Sync/);
  assert.match(importer, /iterations < 100_000/);
  assert.match(importer, /RUNTIME_ENV_EXPORT_KEYS_MISMATCH/);
});

test("only the five Ops Center live-refresh dependencies are copied", () => {
  const targetBlock = importer.slice(
    importer.indexOf("const TARGET_KEYS"),
    importer.indexOf("const VERCEL_PROJECT"),
  );
  for (const name of targetKeys) {
    assert.match(targetBlock, new RegExp(name));
  }
  assert.doesNotMatch(
    targetBlock,
    /PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET|SYNC_JOB_SECRET/,
  );
});

test("Vercel target is fixed and every imported value is sensitive Production data", () => {
  assert.match(importer, /prj_wauTHzmL1hvG9cspdZlnGyaXBhSj/);
  assert.match(importer, /team_sZJ3mzHF0mG5yWAxoScwhPPG/);
  assert.match(importer, /commerce-os-ops-center\.vercel\.app/);
  assert.match(importer, /"env",\s*"add"/);
  assert.match(importer, /"production"/);
  assert.match(importer, /"--force"/);
  assert.match(importer, /"--sensitive"/);
  assert.match(importer, /"env", "ls", "production"/);
  assert.match(importer, /"redeploy"/);
  assert.match(importer, /"--target=production"/);
});

test("secret values use stdin, are never printed or written, and buffers are cleared", () => {
  assert.match(importer, /input,/);
  assert.match(importer, /variables\[name\] = ""/);
  assert.match(importer, /plaintext\?\.fill\(0\)/);
  assert.match(importer, /key\.fill\(0\)/);
  assert.match(importer, /combined\.fill\(0\)/);
  assert.doesNotMatch(importer, /console\.log\([^\n]*(?:value|passphrase|variables)/i);
  assert.doesNotMatch(importer, /writeFile\([^\n]*(?:plaintext|variables|value)/i);
  assert.doesNotMatch(importer, /\.env(?:\.local)?/);
});

test("PowerShell wrapper finds the existing encrypted file and hides the passphrase", () => {
  assert.match(powershell, /Commerce-OS-Migration\\purchase/);
  assert.match(powershell, /commerce-os-purchase-env-\*\.enc\.json/);
  assert.match(powershell, /Read-Host .* -AsSecureString/);
  assert.match(powershell, /SecureStringToBSTR/);
  assert.match(powershell, /ZeroFreeBSTR/);
  assert.match(powershell, /Remove-Item Env:MIGRATION_ENV_EXPORT_PASSPHRASE/);
  assert.doesNotMatch(powershell, /Write-Host[^\n]*plainPassphrase/);
});
