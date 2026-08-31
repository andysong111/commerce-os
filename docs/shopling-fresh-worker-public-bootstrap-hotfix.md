# Shopling Fresh Worker public bootstrap hotfix

Observed in live v0.3.0: opening `https://a.shopling.co.kr/` as the worker root caused the newly-created Chrome window to close almost immediately before the extension could enter A18.

The human-proven Shopling path is:

`https://shopling.co.kr/index.php` → `관리자접속` → new admin window → `[18] 쇼핑몰상품등록`.

The Fresh Worker now starts from that public page. Existing opener-based worker tracking adopts the admin popup, then closes the public bootstrap window after the admin window is confirmed.

No market row is allowed to submit until the normal goods_key + self-code dual identity check and durable submit lock are reached.
