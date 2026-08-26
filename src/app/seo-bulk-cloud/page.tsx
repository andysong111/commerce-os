import SeoBulkCloudClient from "./SeoBulkCloudClient";
import SeoBulkCompletionArchiveBridge from "./SeoBulkCompletionArchiveBridge";
import SeoBulkExistingFinalDiversityBridge from "./SeoBulkExistingFinalDiversityBridge";
import SeoBulkFetchRecovery from "./SeoBulkFetchRecovery";
import SeoBulkInventoryReregisterBridge from "./SeoBulkInventoryReregisterBridge";

export default function SeoBulkCloudPage() {
  return (
    <>
      <SeoBulkFetchRecovery />
      <SeoBulkCompletionArchiveBridge />
      <SeoBulkExistingFinalDiversityBridge />
      <SeoBulkInventoryReregisterBridge />
      <SeoBulkCloudClient />
    </>
  );
}
