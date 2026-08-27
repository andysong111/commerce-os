import SeoBulkCloudClient from "./SeoBulkCloudClient";
import SeoBulkCompletionArchiveBridge from "./SeoBulkCompletionArchiveBridge";
import SeoBulkExistingFinalDiversityBridge from "./SeoBulkExistingFinalDiversityBridge";
import SeoBulkFetchRecovery from "./SeoBulkFetchRecovery";
import SeoBulkInventoryReregisterBridge from "./SeoBulkInventoryReregisterBridge";
import SeoBulkMallSeoRecoveryBridge from "./SeoBulkMallSeoRecoveryBridge";
import SeoBulkWindowBridge from "./SeoBulkWindowBridge";

export default function SeoBulkCloudPage() {
  return (
    <>
      <SeoBulkWindowBridge />
      <SeoBulkFetchRecovery />
      <SeoBulkMallSeoRecoveryBridge />
      <SeoBulkCompletionArchiveBridge />
      <SeoBulkExistingFinalDiversityBridge />
      <SeoBulkInventoryReregisterBridge />
      <SeoBulkCloudClient />
    </>
  );
}
