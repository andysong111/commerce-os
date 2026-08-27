import SeoBulkFetchRecovery from "./SeoBulkFetchRecovery";
import SeoBulkMallSeoRecoveryBridge from "./SeoBulkMallSeoRecoveryBridge";
import SeoBulkRunCloudClient from "./SeoBulkRunCloudClient";
import SeoBulkRunMigrationBridge from "./SeoBulkRunMigrationBridge";
import SeoBulkWindowBridge from "./SeoBulkWindowBridge";

export default function SeoBulkCloudPage() {
  return (
    <>
      <SeoBulkWindowBridge />
      <SeoBulkRunMigrationBridge />
      <SeoBulkFetchRecovery />
      <SeoBulkMallSeoRecoveryBridge />
      <SeoBulkRunCloudClient />
    </>
  );
}
