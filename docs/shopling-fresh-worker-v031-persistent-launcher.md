# Shopling Fresh Worker v0.3.1 — persistent launcher

## Field finding
Opening a new Shopling public/admin root window for each channel is unstable. The reliable user flow starts from the already logged-in public Shopling main tab that the operator keeps open, then clicks `관리자접속`, which opens a new admin window.

## v0.3.1 contract
- The operator keeps one logged-in `https://shopling.co.kr/index.php` tab open.
- The extension never creates or closes that launcher tab/window.
- Each channel reuses the same launcher tab only to click `관리자접속`.
- The admin popup created by Shopling is adopted through `openerTabId === launcherTabId`.
- Only the resulting admin worker window is disposable.
- After success, the admin worker is closed and the same launcher tab is used to open the next admin worker.
- If no persistent launcher tab exists, the run stops before Shopling submit and reports `persistent_shopling_launcher_missing`.
- Product identity, unregistered search, saved-profile application, durable submit lock, and real result-page confirmation are unchanged.

## Live DB checkpoint
AAA442 DM1 and DM2 are sent. DM3, DM4, SM1, SM2 are queued/pending with no submit lock after the failed direct/public-new-window attempts.
