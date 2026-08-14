# Manual Shopling category bulk approval — 2026-08-15

- Per-item manual category choices are staged in sessionStorage instead of forcing an immediate page refresh.
- Every staged path is validated against the current Shopling catalog.
- The review screen exposes `수동 선택 일괄 승인 (N)` and writes all valid staged choices in one state update.
- Individual approval remains available and no longer reloads the page; other staged choices remain intact.
- Staged choices survive same-tab refreshes and already-processed items are pruned safely.
