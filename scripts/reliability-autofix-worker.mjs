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
function assertNoNewCapabilities(oldText,newText,path){ const before=oldText.toLowerCase(),after=newText.toLowerCase(); for(const token of CAPABILITY_TOKENS){ if(countOccurrences(after,token)>countOccurrences(before,token)) throw new Error(`Autofix cannot introduce new capability '${token}' in ${path}`); } }
function isTestLike(path){ return path.startsWith("tests/") || path.includes(".test."); }
function assertNoTestWeakening(oldText,newText,path){
  if(!isTestLike(path)) return;
  const before=oldText.toLowerCase(),after=newText.toLowerCase();
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
function applyProposal(proposal, context) {
  const edits=proposal?.edits; if(!Array.isArray(edits)||edits.length<1||edits.length>6)throw new Error("Unsafe autofix edit count");
  const contextPaths=new Set(context.map(item=>item.path));
  for(const edit of edits){ const path=String(edit.path||"").replaceAll("\\","/").replace(/^\.\//,""); const oldText=String(edit.old_text??""); const newText=String(edit.new_text??"");
    if(!safePath(path)||!newText)throw new Error(`Unsafe autofix path: ${path}`); assertNoNewCapabilities(oldText,newText,path); assertNoTestWeakening(oldText,newText,path); const absolute=resolve(ROOT,path); if(!absolute.startsWith(`${resolve(ROOT)}/`))throw new Error(`Path escape: ${path}`);
    if(!oldText){ if(!isExecutedTestPath(path)||existsSync(absolute))throw new Error(`New files must be executable regression tests: ${path}`); mkdirSync(dirname(absolute),{recursive:true}); writeFileSync(absolute,newText,"utf8"); }
    else { if(!contextPaths.has(path)||!existsSync(absolute))throw new Error(`Edit path was not provided as trusted context: ${path}`); const current=readFileSync(absolute,"utf8"); if(countOccurrences(current,oldText)!==1)throw new Error(`old_text must match exactly once: ${path}`); writeFileSync(absolute,current.replace(oldText,newText),"utf8"); }
  }
  execFileSync("git",["diff","--check"],{stdio:"inherit"}); const numstat=execFileSync("git",["diff","--numstat"],{encoding:"utf8"}).trim(); if(!numstat)throw new Error("Autofix proposal produced no diff");
  const changed=[]; let lineBudget=0; for(const line of numstat.split("\n")){ const [aRaw,dRaw,path]=line.split("\t"); if(!safePath(path))throw new Error(`Diff touched forbidden path: ${path}`); const a=Number(aRaw),d=Number(dRaw); if(!Number.isFinite(a)||!Number.isFinite(d))throw new Error(`Binary or uncountable diff is forbidden: ${path}`); lineBudget+=a+d; changed.push(path); }
  if(changed.length>4||lineBudget>260)throw new Error(`Autofix diff exceeds safety budget: files=${changed.length}, lines=${lineBudget}`);
  const sourceChanged=changed.some(path=>path.startsWith("src/")&&!path.includes(".test.")); const executedTestChanged=changed.some(isExecutedTestPath);
  if(!sourceChanged)throw new Error("Autofix must change service source code; test-only proposals are not deployable improvements");
  if(!executedTestChanged)throw new Error("Source autofix must include a regression test that npm test actually executes");
  return changed;
}
async function claim(){ const payload=await api({action:"claim"}); if(!payload.job){output("has_job","false");return;} if(payload.job.target_repo!==REPOSITORY)throw new Error("Claimed job repository mismatch"); writeFileSync(JOB_FILE,JSON.stringify(payload.job,null,2)); output("has_job","true"); output("job_id",payload.job.job_id); output("improvement_id",payload.job.improvement_id); }
async function generate(){ const job=readJob(); const context=collectContext(job); const payload=await api({action:"generate",job_id:job.job_id,files:context}); const proposal=payload.proposal; writeFileSync(PROPOSAL_FILE,JSON.stringify(proposal,null,2)); const changed=applyProposal(proposal,context); output("changed_paths",JSON.stringify(changed)); output("summary",String(proposal.summary||"AI low-risk reliability fix").slice(0,500)); }
async function finish(){ const job=readJob(); const status=process.env.AUTOFIX_STATUS||"failed"; const changedPaths=process.env.AUTOFIX_CHANGED_PATHS?JSON.parse(process.env.AUTOFIX_CHANGED_PATHS):[]; await api({action:"finish",job_id:job.job_id,status,branch_name:process.env.AUTOFIX_BRANCH||null,pr_number:process.env.AUTOFIX_PR?Number(process.env.AUTOFIX_PR):null,commit_sha:process.env.AUTOFIX_COMMIT||null,merge_sha:process.env.AUTOFIX_MERGE||null,patch_summary:process.env.AUTOFIX_SUMMARY||null,changed_paths:changedPaths,error:process.env.AUTOFIX_ERROR||null}); }
const command=process.argv[2]; if(command==="claim")await claim(); else if(command==="generate")await generate(); else if(command==="finish")await finish(); else throw new Error(`Unknown command: ${command}`);
