-- Commerce OS operation ledger read-model indexes.
-- The operation ledger is append-oriented and is repeatedly read by operation_type,
-- correlation_id and recency. Keep these reads indexed so background workers do not
-- fall back to repeated sequential scans as the ledger grows.

create index if not exists commerce_operation_runs_correlation_started_idx
  on public.commerce_operation_runs (correlation_id, started_at desc)
  where correlation_id is not null;

create index if not exists commerce_operation_runs_type_correlation_started_idx
  on public.commerce_operation_runs (operation_type, correlation_id, started_at desc)
  where correlation_id is not null;
