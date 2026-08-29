import SeoBulkArchiveSummary from "./SeoBulkArchiveSummary";
import SeoBulkFetchRecovery from "./SeoBulkFetchRecovery";
import SeoBulkRunCloudClient from "./SeoBulkDurableRunCloudClient";
import SeoBulkCustomBlockedTermsPanel from "./SeoBulkCustomBlockedTermsPanel";
import SeoBulkLongTitleV6UpgradeBridge from "./SeoBulkLongTitleV6UpgradeBridge";
import SeoBulkMallSeoRecoveryBridge from "./SeoBulkMallSeoRecoveryBridge";
import SeoBulkRegistrationFailurePanel from "./SeoBulkRegistrationFailurePanel";
import SeoBulkRegistrationRetryAllControl from "./SeoBulkRegistrationRetryAllControl";
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
      <SeoBulkRegistrationFailurePanel />
      <SeoBulkRegistrationRetryAllControl />
      <SeoBulkCustomBlockedTermsPanel />
      <SeoBulkArchiveSummary />
      <SeoBulkRunCloudClient />
    </>
  );
}
