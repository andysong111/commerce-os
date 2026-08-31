Commerce OS Shopling Market Group Canary v0.2.0

목적
- Shopling 마켓 자동전송을 대량화하기 전에 신규상품 1개만 대상으로 남은 DM1~DM4 / SM1~SM2 채널을 실전 검증합니다.
- 이미 sent 처리된 채널은 서버 원장에서 다시 claim되지 않습니다.

시작 위치
- Shopling [A18] 쇼핑몰상품등록 화면.
- 별도 상품검색을 미리 할 필요가 없습니다.

안전 규칙
1. 서버 원장에서 groupLimit=1로 상품 1개만 claim합니다.
2. 각 채널은 자사상품코드로 미등록 검색합니다.
3. 같은 결과행 안에서 Shopling goods_key(상품번호) + 자사상품코드가 모두 정확히 일치해야 체크합니다.
4. 쇼핑몰 ID와 연동정보는 해당 도매/소매 저장검색을 적용합니다.
5. 상품등록송신 직전에 Commerce OS durable submit lock을 획득합니다.
6. 송신 전 실패는 현재/미시작 채널을 queued로 원복합니다.
7. 송신 경계 이후 결과가 불명확하면 confirm_needed로 멈추며 자동 재송신하지 않습니다.
8. Shopling api*.shopling.co.kr 결과 화면에서 성공건수>0, 실패건수=0을 확인한 뒤 sent로 기록합니다.

검증 중에는 기존 운영용 Shopling Bridge를 OFF로 두는 것을 권장합니다.
