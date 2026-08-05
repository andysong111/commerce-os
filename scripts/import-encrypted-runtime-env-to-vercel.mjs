import {
  createDecipheriv,
  pbkdf2Sync,
} from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const SOURCE_KEYS = [
  "PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET",
  "PRODUCT_MASTER_BASE_URL",
  "SHOPLING_API_AUTH_KEY",
  "SHOPLING_COMPANY_ID",
  "SHOPLING_LOGIN_ID",
  "SYNC_JOB_SECRET",
  "PRODUCT_MASTER_INTEGRATION_SECRET",
];

const TARGET_KEYS = [
  "PRODUCT_MASTER_BASE_URL",
  "PRODUCT_MASTER_INTEGRATION_SECRET",
  "SHOPLING_API_AUTH_KEY",
  "SHOPLING_COMPANY_ID",
  "SHOPLING_LOGIN_ID",
];

const VERCEL_PROJECT = {
  projectId: "prj_wauTHzmL1hvG9cspdZlnGyaXBhSj",
  orgId: "team_sZJ3mzHF0mG5yWAxoScwhPPG",
  scope: "a2bsangsa",
  productionAlias: "https://commerce-os-ops-center.vercel.app",
};

const [encryptedFileArgument] = process.argv.slice(2);
if (!encryptedFileArgument) {
  throw new Error(
    "Usage: node scripts/import-encrypted-runtime-env-to-vercel.mjs <encrypted-env-file>",
  );
}
const passphrase = String(
  process.env.MIGRATION_ENV_EXPORT_PASSPHRASE || "",
);
if (!passphrase) {
  throw new Error("MIGRATION_ENV_EXPORT_PASSPHRASE_REQUIRED");
}

function fail(code) {
  throw new Error(code);
}

function runNpxVercel(tempProject, args, input) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(
    npx,
    [
      "--yes",
      "vercel@latest",
      "--scope",
      VERCEL_PROJECT.scope,
      "--cwd",
      tempProject,
      "--no-color",
      ...args,
    ],
    {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      env: {
        ...process.env,
        VERCEL_TELEMETRY_DISABLED: "1",
      },
    },
  );
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      status: result.status ?? -1,
      stdout: String(result.stdout || ""),
    };
  }
  return {
    ok: true,
    status: 0,
    stdout: String(result.stdout || ""),
  };
}

const encryptedPath = resolve(encryptedFileArgument);
const envelope = JSON.parse(await readFile(encryptedPath, "utf8"));
if (
  envelope?.format !== "commerce-os-runtime-env-v1" ||
  envelope?.kdf?.name !== "PBKDF2" ||
  envelope?.kdf?.hash !== "SHA-256" ||
  envelope?.cipher?.name !== "AES-GCM"
) {
  fail("INVALID_RUNTIME_ENV_EXPORT_FORMAT");
}

const iterations = Number(envelope.kdf.iterations);
if (!Number.isInteger(iterations) || iterations < 100_000) {
  fail("INVALID_RUNTIME_ENV_EXPORT_KDF");
}

const salt = Buffer.from(String(envelope.kdf.salt), "base64");
const iv = Buffer.from(String(envelope.cipher.iv), "base64");
const combined = Buffer.from(String(envelope.cipher.data), "base64");
if (salt.length < 16 || iv.length !== 12 || combined.length <= 16) {
  fail("INVALID_RUNTIME_ENV_EXPORT_CIPHER");
}

const encrypted = combined.subarray(0, combined.length - 16);
const authTag = combined.subarray(combined.length - 16);
const key = pbkdf2Sync(passphrase, salt, iterations, 32, "sha256");
const decipher = createDecipheriv("aes-256-gcm", key, iv);
decipher.setAuthTag(authTag);
let plaintext;
let payload;
try {
  plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  payload = JSON.parse(plaintext.toString("utf8"));
} catch {
  fail("RUNTIME_ENV_DECRYPT_FAILED");
} finally {
  key.fill(0);
}

const variables = payload?.variables;
if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
  plaintext?.fill(0);
  fail("RUNTIME_ENV_EXPORT_VARIABLES_MISSING");
}
const names = Object.keys(variables).sort();
const expected = [...SOURCE_KEYS].sort();
if (
  names.length !== expected.length ||
  names.some((name, index) => name !== expected[index])
) {
  plaintext?.fill(0);
  fail("RUNTIME_ENV_EXPORT_KEYS_MISMATCH");
}
for (const name of SOURCE_KEYS) {
  if (typeof variables[name] !== "string" || !variables[name]) {
    plaintext?.fill(0);
    fail(`RUNTIME_ENV_EXPORT_VALUE_MISSING:${name}`);
  }
}

const tempProject = await mkdtemp(
  join(tmpdir(), "commerce-os-vercel-env-import-"),
);
try {
  const vercelDirectory = join(tempProject, ".vercel");
  await mkdir(vercelDirectory, { recursive: true });
  await writeFile(
    join(vercelDirectory, "project.json"),
    JSON.stringify({
      projectId: VERCEL_PROJECT.projectId,
      orgId: VERCEL_PROJECT.orgId,
    }),
    "utf8",
  );

  const whoami = runNpxVercel(tempProject, ["whoami"]);
  if (!whoami.ok) fail("VERCEL_CLI_AUTH_REQUIRED");

  for (const name of TARGET_KEYS) {
    const value = variables[name];
    const result = runNpxVercel(
      tempProject,
      [
        "env",
        "add",
        name,
        "production",
        "--force",
        "--sensitive",
      ],
      `${value}\n`,
    );
    variables[name] = "";
    if (!result.ok) fail(`VERCEL_ENV_SET_FAILED:${name}:${result.status}`);
  }

  const listed = runNpxVercel(tempProject, ["env", "ls", "production"]);
  if (
    !listed.ok ||
    TARGET_KEYS.some((name) => !listed.stdout.includes(name))
  ) {
    fail("VERCEL_ENV_VERIFY_FAILED");
  }

  const redeploy = runNpxVercel(
    tempProject,
    [
      "redeploy",
      VERCEL_PROJECT.productionAlias,
      "--target=production",
      "--no-wait",
    ],
  );
  if (!redeploy.ok) fail(`VERCEL_REDEPLOY_FAILED:${redeploy.status}`);

  console.log(
    `[runtime-env-vercel-import] ${TARGET_KEYS.length} sensitive Production variables updated`,
  );
  console.log(
    "[runtime-env-vercel-import] production redeploy requested; no secret values were printed",
  );
} finally {
  plaintext?.fill(0);
  for (const name of SOURCE_KEYS) {
    if (variables && typeof variables === "object") variables[name] = "";
  }
  encrypted.fill(0);
  authTag.fill(0);
  combined.fill(0);
  await rm(tempProject, { recursive: true, force: true });
}
