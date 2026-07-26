import { NextResponse } from "next/server"; import { runBulkDispatcher } from "@/lib/shoplingPriceModifyBulkDispatcher";
export const runtime = "nodejs"; export const maxDuration = 30;
function authorized(request: Request) { const secret = process.env.CRON_SECRET; return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`); }
async function handle(request: Request) { if (!authorized(request)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 }); try { return NextResponse.json(await runBulkDispatcher()); } catch { return NextResponse.json({ message: "dispatcher failed" }, { status: 500 }); } }
export const GET = handle; export const POST = handle;
