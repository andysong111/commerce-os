import { PageHeader } from "@/components/PageHeader";
import { ShoplingBarcodeSyncRunner } from "@/components/shopling-barcode-sync/ShoplingBarcodeSyncRunner";

export default function ShoplingBarcodeSyncPage() {
  return (
    <>
      <PageHeader
        title="샵플링 옵션 바코드 동기화"
        description="옵션자체관리코드를 같은 옵션 위치의 바코드로 안전하게 맞춥니다."
      />
      <ShoplingBarcodeSyncRunner />
    </>
  );
}
