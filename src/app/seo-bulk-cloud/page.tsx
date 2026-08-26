import SeoBulkCloudClient from "./SeoBulkCloudClient";
import SeoBulkCompletionArchiveBridge from "./SeoBulkCompletionArchiveBridge";
import SeoBulkFetchRecovery from "./SeoBulkFetchRecovery";
import SeoBulkInventoryReregisterBridge from "./SeoBulkInventoryReregisterBridge";

export default function SeoBulkCloudPage() {
  return (
    <>
      <SeoBulkFetchRecovery />
      <SeoBulkCompletionArchiveBridge />
      <SeoBulkInventoryReregisterBridge />
      <SeoBulkCloudClient />
    </>
  );
}
