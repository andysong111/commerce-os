import SeoBulkCloudClient from "./SeoBulkCloudClient";
import SeoBulkCompletionArchiveBridge from "./SeoBulkCompletionArchiveBridge";
import SeoBulkExistingFinalDiversityBridge from "./SeoBulkExistingFinalDiversityBridge";
import SeoBulkFetchRecovery from "./SeoBulkFetchRecovery";
import SeoBulkInventoryReadyReregister from "./SeoBulkInventoryReadyReregister";
import SeoBulkMallSeoRecoveryBridge from "./SeoBulkMallSeoRecoveryBridge";
import SeoBulkWindowBridge from "./SeoBulkWindowBridge";

// SeoBulkInventoryReregisterBridge is rendered inside SeoBulkInventoryReadyReregister
// only after the FINAL-keyword v4 inventory sync succeeds.
export default function SeoBulkCloudPage() {
  return (
    <>
      <SeoBulkWindowBridge />
      <SeoBulkFetchRecovery />
      <SeoBulkMallSeoRecoveryBridge />
      <SeoBulkCompletionArchiveBridge />
      <SeoBulkExistingFinalDiversityBridge />
      <SeoBulkInventoryReadyReregister />
      <SeoBulkCloudClient />
    </>
  );
}
