Commerce OS · Shopling A21 Price/Option Resend v0.2.7

목적
- Commerce OS에서 Shopling 저장 가격 재조회까지 VERIFIED 된 GOODSKEY만 A21 쇼핑몰상품수정에서 마켓으로 수정전송합니다.
- 판매가와 옵션은 직렬 1개씩 처리합니다.
- 결과창 검증은 하지 않습니다.

실제 Shopling form 기준
- 판매가: modify_tp=goods_normal, tsmt_sale_price_tp=J, trsmt_env_mody_price=Y
- 배송정보: 실제 '수정안함' 라디오를 DOM 증거로 고정하고 송신 직전 MAIN world에서 재검증
- 다른 일반 항목: 수정안함
- 옵션: modify_tp=goods_stock + trsmt_env_mody_opt=1
- 최종 송신함수: goods_mallMdfy_submit_sp()

v0.2.7
- v0.2.4/v0.2.5 결과 추적 레이어를 아예 로드하지 않습니다.
- Shopling 원본 송신 함수가 정상 응답하여 RESULT_WAIT에 도달하면 즉시 SUCCEEDED 처리합니다.
- 판매가 ACK 직후 옵션으로, 옵션 ACK 직후 다음 배치로 진행합니다.
- 도매창고/투비즈온 등 개별 마켓 결과는 기다리지 않고 전체 루프를 막지 않습니다.
- v0.2.6에서 발생할 수 있던 결과 추적 baseline 상태 덮어쓰기 경합을 제거했습니다.

안전장치
1) Shopling 저장 가격 VERIFIED가 아니면 시작하지 않습니다.
2) 배송정보 수정안함과 판매가/옵션 form 값은 송신 전에 검증합니다.
3) Shopling 원본 송신 함수 자체가 실패하거나 예상하지 못한 확인창이 나오면 해당 작업은 실패합니다.

사용
1) 기존 확장프로그램을 제거하고 v0.2.7 ZIP을 설치합니다.
2) 먼저 1 GOODSKEY 안전 테스트를 실행합니다.
3) 판매가가 ACK 후 즉시 SUCCEEDED → 옵션 시작, 옵션도 ACK 후 SUCCEEDED가 되면 전체 실행합니다.

주의
- SUCCEEDED는 'Shopling 수정전송 요청이 정상 접수됨'을 의미하며 개별 마켓 최종 성공을 보증하지 않습니다.
