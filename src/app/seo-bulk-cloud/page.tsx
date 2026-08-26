import SeoBulkCloudClient from "./SeoBulkCloudClient";
import SeoBulkCompletionArchiveBridge from "./SeoBulkCompletionArchiveBridge";
import SeoBulkFetchRecovery from "./SeoBulkFetchRecovery";
import SeoBulkRelaunchBridge from "./SeoBulkRelaunchBridge";

export default function SeoBulkCloudPage() {
  return (
    <>
      <SeoBulkFetchRecovery />
      <SeoBulkCompletionArchiveBridge />
      <SeoBulkRelaunchBridge />
      <SeoBulkCloudClient />
    </>
  );
}
