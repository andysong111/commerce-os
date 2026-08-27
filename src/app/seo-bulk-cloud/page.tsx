import SeoBulkFetchRecovery from "./SeoBulkFetchRecovery";
import SeoBulkLongTitleV6UpgradeBridge from "./SeoBulkLongTitleV6UpgradeBridge";
import SeoBulkMallSeoRecoveryBridge from "./SeoBulkMallSeoRecoveryBridge";
import SeoBulkRunCloudClient from "./SeoBulkRunCloudClient";
import SeoBulkRunMigrationBridge from "./SeoBulkRunMigrationBridge";
import SeoBulkWindowBridge from "./SeoBulkWindowBridge";

export default function SeoBulkCloudPage() {
  return (
    <>
      <SeoBulkWindowBridge />
      <SeoBulkRunMigrationBridge />
      <SeoBulkLongTitleV6UpgradeBridge />
      <SeoBulkFetchRecovery />
      <SeoBulkMallSeoRecoveryBridge />
      <SeoBulkRunCloudClient />
    </>
  );
}
