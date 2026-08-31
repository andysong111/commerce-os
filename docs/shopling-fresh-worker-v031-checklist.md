# Fresh Worker v0.3.1 live validation checklist

1. Keep the existing logged-in `https://shopling.co.kr/index.php` tab open.
2. Keep the original A18 control tab open.
3. Keep the operational Shopling Bridge OFF during Canary validation.
4. Press Fresh Worker once.
5. The extension must reuse the existing public launcher tab; it must not create a new Shopling public window.
6. `관리자접속` on the persistent launcher must open a new admin popup.
7. The new admin popup must enter A18 and process exactly one pending channel.
8. After success, only the admin worker window closes.
9. The same public launcher tab is reused to open the next admin popup.
10. Any missing launcher or ambiguous product identity stops before submit.
