import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { buildStockWorker } from "../scripts/build-shopling-stock-worker-v023.mjs";
const root = "public/shopling-stock-state-sync";
const policy = await readFile(`${root}/search-policy-v023.js`, "utf8");
const background = await readFile(`${root}/background-v023.js`, "utf8");
function fixture(storage = new Map()) {
  const row = { textContent: "일자 상품등록일 오늘 1년" };
  const inputs = ["20260831", "20260907", ""].map((value, i) => ({
    value, name: i < 2 ? `date${i}` : "keyword", type: "text", disabled: false,
    getBoundingClientRect: () => ({ top: i < 2 ? 10 : 50, left: 100 + 110 * i, width: 100, height: 20 }),
    closest: () => i < 2 ? row : { textContent: "검색항목" }, dispatchEvent() {},
  }));
  const form = { querySelectorAll: () => inputs };
  const field = { form, selectedIndex: 0, options: [{ textContent: "옵션자체관리코드" }], closest: () => form };
  inputs.forEach((i) => { i.form = form; });
  const ctx = vm.createContext({ Intl, Date, Math, Map, Set, document: form, location: { pathname: "/A6" }, sessionStorage: {
    getItem: (k) => storage.get(k), setItem: (k,v) => storage.set(k,v),
  }});
  vm.runInContext(policy, ctx);
  const helper = ctx.CommerceStockSearchV023;
  const setter = (el, value) => { el.value = value; return true; };
  return { ctx, helper, inputs, form, field, setter };
}
test("KST search range is 2024-01-01 through execution day, including UTC day boundary", () => {
  const f = fixture();
  const result = f.helper.applyPeriod(f.form, f.setter, new Date("2026-09-06T16:00:00Z"));
  assert.equal(result.ok, true);
  assert.equal(f.inputs[0].value, "20240101"); assert.equal(f.inputs[1].value, "20260907");
});
test("date controls support ISO/readonly without changing query or quantities", () => {
  const f = fixture();
  f.inputs[0].value = "2026-08-31"; f.inputs[0].type = "date"; f.inputs[0].readOnly = true;
  f.inputs[1].value = "2026-09-07"; f.inputs[1].type = "date"; f.inputs[2].value = "BZZ341-1";
  assert.equal(f.helper.applyPeriod(f.form, f.setter).ok, true);
  assert.equal(f.inputs[0].value, "2024-01-01"); assert.equal(f.inputs[2].value, "BZZ341-1");
});
test("ambiguous or rejected dates block search instead of querying a short window", () => {
  const f = fixture();
  const extra = { ...f.inputs[1], getBoundingClientRect: () => ({ top: 10, left: 320, width: 100, height: 20 }) };
  f.inputs.push(extra);
  assert.equal(f.helper.applyPeriod(f.form, f.setter).code, "SEARCH_DATE_FIELDS_AMBIGUOUS");
  f.inputs.pop();
  assert.equal(f.helper.applyPeriod(f.form, () => false).code, "SEARCH_DATE_VERIFY_FAILED");
});
test("empty array is not a ready result; resumed inner-frame search does not submit again", async () => {
  const storage = new Map(), f = fixture(storage);
  let clicks = 0, polls = 0;
  const api = (g) => ({ scope: "job:attempt:A6", getField: () => g.field, findInput: () => g.inputs[2],
    selectField: () => true, setInput: g.setter, sleep: async () => {},
    clickSearch: () => { clicks++; return true; }, rows: () => ++polls < 2 ? [] : [{ id: "exact-row" }],
    waitFor: async (cb) => { for (let i=0;i<5;i++) { const v = await cb(); if (v) { assert.ok(!Array.isArray(v) || v.length > 0); return v; } } return null; },
  });
  const first = await f.helper.search("옵션자체관리코드", "BZZ341-1", api(f));
  assert.equal(first.ok, true); assert.equal(clicks, 1); assert.ok(polls >= 2);
  const next = fixture(storage);
  next.inputs[0].value = "20240101"; next.inputs[1].value = next.helper.todayKst(); next.inputs[2].value = "BZZ341-1";
  assert.equal((await next.helper.search("옵션자체관리코드", "BZZ341-1", api(next))).ok, true);
  assert.equal(clicks, 1);
});
function engine({ loggedIn=true, missing=null, rejectDates=false }={}) {
  const tabs = new Map([[1, { id: 1, windowId: 1, url: "https://a.shopling.co.kr/", role: "MAIN" }]]);
  const saved = {}, calls = []; let clock=0, next=2, ctx;
  const names = { A4: "상품조회수정", A6: "옵션대량수정", A21_LIST: "쇼핑몰상품수정" };
  const number = { A4: "4", A6: "6", A21_LIST: "21" };
  class Clock extends Date { static now() { return clock += 100; } }
  function page(tab) {
    const nodes = Object.keys(names).filter((s) => s !== missing).map((s) => ({ tagName: "A", textContent: `[${number[s]}] ${names[s]}`, click() { calls.push(`menu:${s}`); tab.role=s; } }));
    const text = `${loggedIn ? "로그아웃" : "로그인"} ${names[tab.role] || "관리자 메인"} ${tab.role === "MAIN" ? "" : `[A${number[tab.role]}] 검색항목 상품 수정전송`}`;
    const options = tab.role === "A6" ? [{ textContent: "옵션자체관리코드" }] : [{ textContent: "샵플링상품코드" }];
    return { document: { title: "Shopling", readyState: "complete", body: { innerText: text },
      querySelectorAll: (selector) => selector === "select" ? (tab.role === "MAIN" ? [] : [{ options }]) : selector === "a[href]" ? [] : nodes },
      location: { href: tab.url }, Event: class {}, CommerceStockSearchV023: { applyPeriod: () => { calls.push(`dates:${tab.role}`); return rejectDates ? { ok:false, code:"SEARCH_DATE_VERIFY_FAILED", message:"date reject" } : { ok:true }; } },
    };
  }
  const chrome = { runtime: { onMessage: { addListener() {} } }, storage: { local: {
    get: async (key) => ({ [key]: saved[key] }), set: async (value) => Object.assign(saved, value),
  }}, tabs: { get: async (id) => { if (!tabs.has(id)) throw Error("closed"); return tabs.get(id); },
    sendMessage: async (id, message) => { const t=tabs.get(id); if(message.type === "STOCK_SYNC_PROBE") return t.worker ? { ok:true, version:"0.2.3", page:{role:t.role} } : null; calls.push(`execute:${message.stage}`); return {ok:true,accepted:true}; },
    reload: async () => { throw Error("FORBIDDEN reload"); }, update: async () => { throw Error("FORBIDDEN navigation"); },
  }, windows: { create: async () => { const t={id:next++,windowId:next+100,url:"https://a.shopling.co.kr/",role:"MAIN"}; tabs.set(t.id,t);calls.push("create");return {id:t.windowId,tabs:[t]}; } }, scripting: {
    executeScript: async ({target,files,func,args=[]}) => { const t=tabs.get(target.tabId); if(files) {t.worker=true;return [];} const scope=vm.createContext({...page(t),__args:args}); return [{frameId:7,result:vm.runInContext(`(${func.toString()})(...__args)`,scope)}]; },
  }};
  ctx = vm.createContext({ chrome, importScripts() {}, Date:Clock, Math, Map, Set, console, SHOPLING_ORIGIN:"https://a.shopling.co.kr/",
    start: async (job) => {const p=await ctx.preflightWorkTabs(job);if(!p.ok)return p;const stage=job.productKind==="OPTION"?"A6":"A4";const active={job,stage,workTabs:p.targets,goodsKeyIndex:0}; await ctx.dispatchToTarget(active,p.targets[stage]);return {ok:true};},
    finish: async ()=>({ok:true}), handlePageReady:async()=>({ok:true}),handleStepResult:async()=>({ok:true}),handleEvidence:async()=>({ok:true}),
    loadActive:async()=>null,saveActive:async()=>{},validJob:(job)=>({ok:true,job}),shoplingTabs:async()=>[...tabs.values()],
    expectedRole:(s)=>s,requiredStages:(k)=>k==="OPTION"?["A6","A21_LIST"]:["A4","A21_LIST"],currentGoodsKey:()=>"120807",sleep:async()=>{},broadcast:async()=>{},
    preflightWorkTabs:null, findExactRoleTarget:null, dispatchToTarget:null,
  });
  vm.runInContext(background,ctx);
  return { ctx, calls, tabs };
}
test("one authenticated main creates A6/A21 workers and checks BOTH dates before execute", async()=>{
  const e=engine();const result=await e.ctx.start({jobId:"j",barcode:"BZZ341-1",productKind:"OPTION",goodsKeys:["120807"]});
  assert.equal(result.ok,true);assert.equal(e.tabs.get(1).role,"MAIN");assert.equal(e.calls.filter(x=>x==="create").length,2);
  assert.ok(e.calls.indexOf("dates:A21_LIST") < e.calls.indexOf("execute:A6"));
});
test("single product creates A4 and A21, never A6", async()=>{
  const e=engine();assert.equal((await e.ctx.start({jobId:"j",productKind:"SINGLE"})).ok,true);
  assert.ok(e.calls.includes("execute:A4"));assert.ok(!e.calls.includes("menu:A6"));
});
test("logged-out source, missing A21 or invalid period cause zero product writes", async()=>{
  for(const config of [{loggedIn:false},{missing:"A21_LIST"},{rejectDates:true}]) {
    const e=engine(config);const result=await e.ctx.start({jobId:"j",productKind:"OPTION"});
    assert.equal(result.ok,false);assert.equal(e.calls.filter(x=>x.startsWith("execute:")).length,0);assert.equal(e.tabs.get(1).role,"MAIN");
  }
});
test("generated worker syntax and explicit template replacement contract", async()=>{
  const template=await readFile(`${root}/content-shopling-v018.js`,"utf8");
  const built=buildStockWorker(template,policy);
  assert.doesNotThrow(()=>new Function(built));assert.ok(built.includes('const VERSION = "0.2.3"'));
  assert.ok(built.includes("sendResponse({ ok: true, accepted: true"));assert.ok(built.includes("executionContext.executionId"));
  assert.ok(!built.includes("waitFor(() => matchingRows(token)"));
  assert.throws(()=>buildStockWorker("wrong template",policy));
});
