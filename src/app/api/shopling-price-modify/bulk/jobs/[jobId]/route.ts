import { NextResponse } from "next/server"; import { getBulkJob } from "@/lib/shoplingPriceModifyBulkStore";
export const runtime = "nodejs";
export async function GET(_: Request, { params }: { params: Promise<{ jobId: string }> }) { try { return NextResponse.json(await getBulkJob((await params).jobId)); } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "작업 조회 실패" }, { status: 404 }); } }
