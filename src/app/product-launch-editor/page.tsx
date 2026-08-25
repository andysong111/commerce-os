import Link from "next/link";
import ProductLaunchEditorTransport from "./ProductLaunchEditorTransport";
import ProductLaunchStandaloneEditor from "./ProductLaunchStandaloneEditor";

export default async function ProductLaunchEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ itemId?: string | string[] }>;
}) {
  const resolved = await searchParams;
  const itemId = Array.isArray(resolved.itemId) ? resolved.itemId[0] : resolved.itemId;

  if (!itemId) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
          <h1 className="text-xl font-black">상품 ID가 없습니다.</h1>
          <p className="mt-2 text-sm">상품출시 진행관리에서 상품 상세를 다시 열어 주세요.</p>
          <Link
            href="/product-launch-tracker"
            className="mt-5 inline-block rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white"
          >
            상품출시 진행관리로 이동
          </Link>
        </div>
      </main>
    );
  }

  return (
    <ProductLaunchEditorTransport>
      <ProductLaunchStandaloneEditor itemId={itemId.slice(0, 180)} />
    </ProductLaunchEditorTransport>
  );
}
