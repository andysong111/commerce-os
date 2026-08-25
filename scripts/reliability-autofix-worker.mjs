import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const ROOT = process.cwd();
const ENDPOINT = process.env.RELIABILITY_AUTOFIX_ENDPOINT ||
  "https://commerce-os-ops-center.vercel.app/api/integrations/reliability/autofix";
const TOKEN = process.env.RELIABILITY_AUTOFIX_OIDC_TOKEN || "";
const REPOSITORY = process.env.GITHUB_REPOSITORY || "";
const JOB_FILE = process.env.RELIABILITY_AUTOFIX_JOB_FILE || "/tmp/reliability-autofix-job.json";
const PROPOSAL_FILE = process.env.RELIABILITY_AUTOFIX_PROPOSAL_FILE || "/tmp/reliability-autofix-proposal.json";
const MISSING_REGRESSION_TEST_MESSAGE =
  "Source autofix must include a regression test that npm test actually executes";
const REGRESSION_TEST_REVISION_FEEDBACK =
  "이전 제안은 서비스 소스 코드를 수정했지만 npm test가 실제 실행하는 회귀 테스트를 포함하지 않았습니다. 같은 문제를 재현하고 수정 후 통과하는 실행 가능한 회귀 테스트를 반드시 포함한 완전한 대체 제안을 작성하세요. 위험 경계나 수정 범위를 넓히지 마세요.";
const INCOMPATIBLE_TEST_HARNESS_MESSAGE =
  "Regression test directly imports a TypeScript source that uses unresolved @/ aliases";
const INCOMPATIBLE_TEST_HARNESS_REVISION_FEEDBACK =
  "이전 제안의 회귀 테스트가 npm test의 Node 실행환경에서 직접 로드할 수 없는 TypeScript 소스를 import했습니다. 특히 대상 소스가 @/ 경로 별칭을 사용하면 새 .mjs/.ts 테스트에서 그 소스를 직접 import하지 마세요. 제공된 기존 실행 테스트 중 같은 소스를 이미 transpile/load하는 테스트를 보강하고, 그 테스트의 기존 fixture 형식과 helper를 그대로 재사용한 완전한 대체 제안을 작성하세요. 위험 경계나 수정 범위는 넓히지 마세요.";

const FORBIDDEN = [
  ".github/", "supabase/migrations/", "vercel.json", ".env", "package.json",
  "package-lock.json", "pnpm-lock", "yarn.lock", "auth", "billing", "payment",
  "paddle", "stripe", "credit", "price", "pricing", "inventory", "purchase",
  "order", "secret", "credential", "permission", "role", "admin.ts", "middleware",
];
const CAPABILITY_TOKENS = [
  "child_process", "node:child_process", "exec(", "execfile(", "spawn(", "eval(",
  "new function(", "process.env", "node:fs", "node:http", "node:https", "node:net",
  "node:tls", "node:dns", "fetch(", "authorization", "bearer ", "github_token",
  "actions_id_token",
];
const TEST_ASSERTION_TOKENS = [
  "assert.", "assert(", "expect(", ".tobe(", ".toequal(", ".tomatch(",
  ".tothrow(", "assert.rejects", "assert.throws",
];
const TEST_WEAKENING_TOKENS = [
  ".skip(", ".todo(", ".only(", "test.skip", "it.skip", "describe.skip",
  "test.todo", "it.todo", "test.only", "it.only", "describe.only",
];

class MissingExecutedRegressionTestError extends Error {
  constructor() {
    super(MISSING_REGRESSION_TEST_MESSAGE);
    this.name = "MissingExecutedRegressionTestError";
  }
}

class IncompatibleExecutedRegressionTestError extends Error {
  constructor(path, targetPath) {
    super(`${INCOMPATIBLE_TEST_HARNESS_MESSAGE}: ${path} -> ${targetPath}`);
    this.name = "IncompatibleExecutedRegressionTestError";
  }
}

function safePath(raw) {
  const path = String(raw || "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.includes("../")) return false;
  if (!(path.startsWith("src/") || path.startsWith("tests/") || path.includes(".test."))) return false;
  if (path.startsWith("src/") && !path.startsWith("src/lib/")) return false;
  const lower = path.toLowerCase();
  return !FORBIDDEN.some((part) => lower.includes(part));
}
function output(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const normalized = typeof value === "string" ? value : JSON.stringify(value);
  writeFileSync(file, `${name}=${normalized.replaceAll("\n", " ")}\n`, { flag: "a" });
}
async function api(body) {
  if (!TOKEN) throw new Error("RELIABILITY_AUTOFIX_OIDC_TOKEN is missing");
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(110_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(payload?.message || `autofix API status=${response.status}`);
  return payload;
}
function readJob() { return JSON.parse(readFileSync(JOB_FILE, "utf8")); }
function tokens(job) {
  const raw = [job.engine, job.error_code, job.target_test_name, job.title].filter(Boolean).join(" ");
  const result = new Set();
  for (const token of raw.split(/[^A-Za-z0-9_]+/g)) if (token.length >= 4) result.add(token.toLowerCase());
  if (job.error_code) result.add(String(job.error_code).toLowerCase());
  if (job.engine) result.add(String(job.engine).toLowerCase());
  return [...result].slice(0, 24);
}
function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "coverage", "artifacts"].includes(entry)) continue;
    const absolute = join(dir, entry); const stats = statSync(absolute);
    if (stats.isDirectory()) walk(absolute, files);
    else if (stats.isFile() && stats.size <= 180_000) files.push(absolute);
  }
  return files;
}
function collectContext(job) {
  const searchTokens = tokens(job); const candidates = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "tests"))];
  const scored = [];
  for (const absolute of candidates) {
    const path = relative(ROOT, absolute).replaceAll("\\", "/"); if (!safePath(path)) continue;
    const content = readFileSync(absolute, "utf8"); const haystack = `${path}\n${content}`.toLowerCase(); let score = 0;
    for (const token of searchTokens) if (haystack.includes(token)) score += token.includes("_") ? 6 : 2;
    if (/\.test\.|\/tests\//.test(path)) score += score > 0 ? 2 : 0;
    if (score > 0) scored.push({ path, content, score });
  }
  scored.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path)); const selected=[]; let total=0;
  for (const item of scored) { const content=item.content.slice(0,24_000); if(total+content.length>130_000)continue; selected.push({path:item.path,content}); total+=content.length; if(selected.length>=14)break; }
  if (!selected.length) throw new Error("No safe repository context matched the incident");
  return selected;
}
function countOccurrences(haystack, needle) { if(!needle)return 0; let count=0,index=0; while((index=haystack.indexOf(needle,index))>=0){count+=1;index+=needle.length;} return count; }
function isTestLike(path){ return path.startsWith("tests/") || path.includes(".test."); }
function assertNoTestWeakening(beforeText,afterText,path){
  if(!isTestLike(path)) return;
  const before=beforeText.toLowerCase(),after=afterText.toLowerCase();
  for(const token of TEST_ASSERTION_TOKENS){ if(countOccurrences(after,token)<countOccurrences(before,token)) throw new Error(`Autofix cannot reduce test assertions '${token}' in ${path}`); }
  for(const token of TEST_WEAKENING_TOKENS){ if(countOccurrences(after,token)>countOccurrences(before,token)) throw new Error(`Autofix cannot weaken test execution '${token}' in ${path}`); }
}
function isExecutedTestPath(path){
  if(!isTestLike(path)) return false;
  const pkg=JSON.parse(readFileSync(join(ROOT,"package.json"),"utf8"));
  const testScript=String(pkg?.scripts?.test||"").toLowerCase();
  const lower=path.toLowerCase();
  if(testScript.includes("tests/*.test.mjs") && /^tests\/[^/]+\.test\.mjs$/i.test(path)) return true;
  if(testScript.includes("vitest run") && /\.test\.[cm]?[jt]sx?$/i.test(path)) return true;
  return testScript.includes(lower) || testScript.includes(basename(lower));
}
function directTypeScriptImports(source) {
  const imports = new Set();
  const pattern = /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+\.tsx?)["']/g;
  for (const match of String(source || "").matchAll(pattern)) imports.add(match[1]);
  return [...imports];
}
function sourceUsesUnresolvedAlias(path) {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${resolve(ROOT)}/`) || !existsSync(absolute)) return false;
  const source = readFileSync(absolute, "utf8");
  return /(?:from\s+["']@\/|import\s*\(\s*["']@\/|^\s*import\s+["']@\/)/m.test(source);
}
function assertExecutedTestHarnessCompatible(path, source) {
  if (!isExecutedTestPath(path)) return;
  for (const specifier of directTypeScriptImports(source)) {
    if (!specifier.startsWith(".")) continue;
    const targetAbsolute = resolve(ROOT, dirname(path), specifier);
    if (!targetAbsolute.startsWith(`${resolve(ROOT)}/`)) continue;
    const targetPath = relative(ROOT, targetAbsolute).replaceAll("\\", "/");
    if (!targetPath.startsWith("src/") || !sourceUsesUnresolvedAlias(targetPath)) continue;
    throw new IncompatibleExecutedRegressionTestError(path, targetPath);
  }
}
function proposalPath(edit) {
  return String(edit?.path || "").replaceAll("\\", "/").replace(/^\.\//, "");
}
function preflightProposal(edits) {
  for (const edit of edits) {
    const path = proposalPath(edit);
    const oldText = String(edit?.old_text ?? "");
    const newText = String(edit?.new_text ?? "");
    if (!safePath(path) || !newText) throw new Error(`Unsafe autofix path: ${path}`);
    if (!oldText && (!isExecutedTestPath(path) || existsSync(resolve(ROOT, path)))) {
      throw new Error(`New files must be executable regression tests: ${path}`);
    }
    assertExecutedTestHarnessCompatible(path, newText);
  }
  const sourceProposed = edits.some((edit) => {
    const path = proposalPath(edit);
    return path.startsWith("src/") && !path.includes(".test.");
  });
  if (!sourceProposed) {
    throw new Error("Autofix must change service source code; test-only proposals are not deployable improvements");
  }
  const executedTestProposed = edits.some((edit) => isExecutedTestPath(proposalPath(edit)));
  if (!executedTestProposed) throw new MissingExecutedRegressionTestError();
}
function planProposalFiles(edits, context) {
  const contextPaths = new Set(context.map((item) => item.path));
  const planned = new Map();
  for (const edit of edits) {
    const path = proposalPath(edit);
    const oldText = String(edit.old_text ?? "");
    const newText = String(edit.new_text ?? "");
    const absolute = resolve(ROOT, path);
    if (!absolute.startsWith(`${resolve(ROOT)}/`)) throw new Error(`Path escape: ${path}`);
    let state = planned.get(path);
    if (!state) {
      const existed = existsSync(absolute);
      if (oldText && (!contextPaths.has(path) || !existed)) {
        throw new Error(`Edit path was not provided as trusted context: ${path}`);
      }
      const original = existed ? readFileSync(absolute, "utf8") : "";
      state = { path, absolute, existed, original, current: original };
      planned.set(path, state);
    }
    if (!oldText) {
      if (state.current) throw new Error(`New test file can only be created once: ${path}`);
      state.current = newText;
    } else {
      if (countOccurrences(state.current, oldText) !== 1) {
        throw new Error(`old_text must match exactly once: ${path}`);
      }
      state.current = state.current.replace(oldText, newText);
    }
  }
  return planned;
}
function assertProposalCapabilityBudget(planned) {
  const positiveExpansion = new Map(CAPABILITY_TOKENS.map((token) => [token, 0]));
  for (const state of planned.values()) {
    const before = state.original.toLowerCase();
    const after = state.current.toLowerCase();
    for (const token of CAPABILITY_TOKENS) {
      const beforeCount = countOccurrences(before, token);
      const afterCount = countOccurrences(after, token);
      if (beforeCount === 0 && afterCount > 0) {
        throw new Error(`Autofix cannot introduce new capability '${token}' in ${state.path}`);
      }
      positiveExpansion.set(token, positiveExpansion.get(token) + Math.max(0, afterCount - beforeCount));
    }
    assertNoTestWeakening(state.original, state.current, state.path);
  }
  for (const [token, expansion] of positiveExpansion) {
    if (expansion > 2) {
      throw new Error(`Autofix cannot excessively expand capability '${token}' across the proposal`);
    }
  }
}
function applyProposal(proposal, context) {
  const edits=proposal?.edits; if(!Array.isArray(edits)||edits.length<1||edits.length>6)throw new Error("Unsafe autofix edit count");
  preflightProposal(edits);
  const planned = planProposalFiles(edits, context);
  const changedStates = [...planned.values()].filter((state) => state.original !== state.current);
  const sourceChangedBeforeWrite = changedStates.some((state) => state.path.startsWith("src/") && !state.path.includes(".test."));
  if (!sourceChangedBeforeWrite) {
    throw new Error("Autofix must change service source code; test-only proposals are not deployable improvements");
  }
  const executedTestChangedBeforeWrite = changedStates.some((state) => isExecutedTestPath(state.path));
  if (!executedTestChangedBeforeWrite) throw new MissingExecutedRegressionTestError();
  assertProposalCapabilityBudget(planned);
  for (const state of changedStates) {
    mkdirSync(dirname(state.absolute), { recursive: true });
    writeFileSync(state.absolute, state.current, "utf8");
    if (!state.existed) execFileSync("git", ["add", "-N", "--", state.path]);
  }
  execFileSync("git",["diff","--check"],{stdio:"inherit"}); const numstat=execFileSync("git",["diff","--numstat"],{encoding:"utf8"}).trim(); if(!numstat)throw new Error("Autofix proposal produced no diff");
  const changed=[]; let lineBudget=0; for(const line of numstat.split("\n")){ const [aRaw,dRaw,path]=line.split("\t"); if(!safePath(path))throw new Error(`Diff touched forbidden path: ${path}`); const a=Number(aRaw),d=Number(dRaw); if(!Number.isFinite(a)||!Number.isFinite(d))throw new Error(`Binary or uncountable diff is forbidden: ${path}`); lineBudget+=a+d; changed.push(path); }
  if(changed.length>4||lineBudget>260)throw new Error(`Autofix diff exceeds safety budget: files=${changed.length}, lines=${lineBudget}`);
  const sourceChanged=changed.some(path=>path.startsWith("src/")&&!path.includes(".test.")); const executedTestChanged=changed.some(isExecutedTestPath);
  if(!sourceChanged)throw new Error("Autofix diff lost the required service source change");
  if(!executedTestChanged)throw new Error("Autofix diff lost the required executable regression test");
  return changed;
}
async function claim(){ const payload=await api({action:"claim"}); if(!payload.job){output("has_job","false");return;} if(payload.job.target_repo!==REPOSITORY)throw new Error("Claimed job repository mismatch"); writeFileSync(JOB_FILE,JSON.stringify(payload.job,null,2)); output("has_job","true"); output("job_id",payload.job.job_id); output("improvement_id",payload.job.improvement_id); }
async function generate(){
  const job=readJob();
  const context=collectContext(job);
  let payload=await api({action:"generate",job_id:job.job_id,files:context});
  let proposal=payload.proposal;
  let changed;
  try {
    changed=applyProposal(proposal,context);
  } catch (error) {
    let revisionFeedback;
    if (error instanceof MissingExecutedRegressionTestError) {
      revisionFeedback=REGRESSION_TEST_REVISION_FEEDBACK;
    } else if (error instanceof IncompatibleExecutedRegressionTestError) {
      revisionFeedback=`${INCOMPATIBLE_TEST_HARNESS_REVISION_FEEDBACK}\n검출된 호환성 오류: ${error.message}`;
    } else {
      throw error;
    }
    payload=await api({
      action:"generate",
      job_id:job.job_id,
      files:context,
      revision_feedback:revisionFeedback,
    });
    proposal=payload.proposal;
    changed=applyProposal(proposal,context);
  }
  writeFileSync(PROPOSAL_FILE,JSON.stringify(proposal,null,2));
  output("changed_paths",JSON.stringify(changed));
  output("summary",String(proposal.summary||"AI low-risk reliability fix").slice(0,500));
}
async function finish(){ const job=readJob(); const status=process.env.AUTOFIX_STATUS||"failed"; const changedPaths=process.env.AUTOFIX_CHANGED_PATHS?JSON.parse(process.env.AUTOFIX_CHANGED_PATHS):[]; await api({action:"finish",job_id:job.job_id,status,branch_name:process.env.AUTOFIX_BRANCH||null,pr_number:process.env.AUTOFIX_PR?Number(process.env.AUTOFIX_PR):null,commit_sha:process.env.AUTOFIX_COMMIT||null,merge_sha:process.env.AUTOFIX_MERGE||null,patch_summary:process.env.AUTOFIX_SUMMARY||null,changed_paths:changedPaths,error:process.env.AUTOFIX_ERROR||null}); }
const command=process.argv[2]; if(command==="claim")await claim(); else if(command==="generate")await generate(); else if(command==="finish")await finish(); else throw new Error(`Unknown command: ${command}`);
