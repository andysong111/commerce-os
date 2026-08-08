# Temporary Stage8 canonical sales-event canary

This branch is operational-only. It waits for the Product Master `sku_sales_events` migration to be visible, then writes exactly one canonical Shopling sales event through the existing guarded Ops Center API and requires the persisted readback contract to pass before accepting `READY_FULL`. It does not write Shopling, price, order, inventory, receipt-cost, or discontinuation data. Do not merge this branch.
