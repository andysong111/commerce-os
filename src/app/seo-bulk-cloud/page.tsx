import SeoBulkCloudClient from "./SeoBulkCloudClient";
import SeoBulkCompletionArchiveBridge from "./SeoBulkCompletionArchiveBridge";
import SeoBulkFetchRecovery from "./SeoBulkFetchRecovery";

export default function SeoBulkCloudPage() {
  return (
    <>
      <SeoBulkFetchRecovery />
      <SeoBulkCompletionArchiveBridge />
      <SeoBulkCloudClient />
    </>
  );
}
