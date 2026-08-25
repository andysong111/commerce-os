import SeoBulkCloudClient from "./SeoBulkCloudClient";
import SeoBulkFetchRecovery from "./SeoBulkFetchRecovery";

export default function SeoBulkCloudPage() {
  return (
    <>
      <SeoBulkFetchRecovery />
      <SeoBulkCloudClient />
    </>
  );
}
