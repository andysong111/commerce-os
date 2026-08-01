# Shopling Category Update Progress

The product-launch tracker shows a persistent progress dialog when `샵플링 카테고리 업데이트` is requested.

- All user-visible `최신화` wording is normalized to `업데이트`.
- The dialog appears before the dispatch request leaves the browser.
- The GitHub Actions request id is captured from the dispatch response.
- `/api/shopling-categories/status` is polled every seven seconds.
- Elapsed time remains visible.
- The dialog changes to success, manual-login-required, or failed when the matching request status is committed.
- The operator can minimize the dialog while the remote job continues.
- Active request state is stored in local storage so a page reload resumes status polling for up to two hours.
