import SeoBulkFetchRecovery from "./SeoBulkFetchRecovery";
import SeoBulkMallSeoRecoveryBridge from "./SeoBulkMallSeoRecoveryBridge";
import SeoBulkRunCloudClient from "./SeoBulkRunCloudClient";
import SeoBulkWindowBridge from "./SeoBulkWindowBridge";

export default function SeoBulkCloudPage() {
  return (
    <>
      <SeoBulkWindowBridge />
      <SeoBulkFetchRecovery />
      <SeoBulkMallSeoRecoveryBridge />
      <SeoBulkRunCloudClient />
    </>
  );
}
