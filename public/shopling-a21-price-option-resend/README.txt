Commerce OS · Shopling A21 Price/Option Resend v0.3.0

목적
- Commerce OS에서 Shopling 저장 가격 재조회까지 VERIFIED 된 GOODSKEY만 A21 쇼핑몰상품수정에서 마켓으로 수정전송합니다.
- 판매가와 옵션은 동시에 겹치지 않게 1개 작업씩 처리합니다.
- 마켓별 성공/실패 결과는 검증하지 않습니다.
- Shopling 결과창의 명시적 '상품 수정 전송이 완료되었습니다.' 문구가 나타난 뒤에만 다음 작업으로 진행합니다.

실제 Shopling form 기준
- 판매가: modify_tp=goods_normal, tsmt_sale_price_tp=J, trsmt_env_mody_price=Y
- 배송정보: 실제 '수정안함' 라디오를 DOM 증거로 고정하고 송신 직전 MAIN world에서 재검증
- 다른 일반 항목: 수정안함
- 옵션: modify_tp=goods_stock + trsmt_env_mody_opt=1
- 최종 송신함수: goods_mallMdfy_submit_sp()

v0.3.0
- v0.2.8/v0.2.9의 로딩 observer/baseline 귀속 방식은 사용하지 않습니다.
- 시작 전에 남아 있는 Shopling 수정전송 결과창을 자동 정리합니다.
- 송신 후 모든 Shopling 탭/프레임을 500ms마다 직접 확인합니다.
- 결과창에 '상품 수정 전송이 완료되었습니다.' 문구가 1.5초 이상 안정적으로 보이면 해당 작업을 SUCCEEDED 처리합니다.
- 처리중 문구가 보이는 동안에는 완료 처리하지 않습니다.
- 성공건수/실패건수 내용은 판정하지 않습니다.
- 전체 실행은 모든 PRICE 배치를 먼저 처리한 뒤 OPTION 배치를 처리합니다.
- 예: 205 GOODSKEY이면 판매가 200 → 판매가 5 → 옵션 200 → 옵션 5 순서입니다.

안전장치
1) Shopling 저장 가격 VERIFIED가 아니면 시작하지 않습니다.
2) 배송정보 수정안함과 판매가/옵션 form 값은 송신 전에 검증합니다.
3) Shopling 원본 송신 함수 자체가 실패하거나 예상하지 못한 확인창이 나오면 해당 작업은 실패합니다.
4) Shopling 완료문구가 나타나기 전에는 다음 송신으로 넘어가지 않습니다.
5) 완료문구가 20분 동안 확인되지 않으면 V030_COMPLETION_TIMEOUT으로 중단합니다.

사용
1) 기존 확장프로그램을 제거하고 v0.3.0 ZIP을 설치합니다.
2) 먼저 1 GOODSKEY 안전 테스트를 실행합니다.
3) 판매가 송신 → 결과창 '상품 수정 전송이 완료되었습니다.' → 판매가 SUCCEEDED → 옵션 송신 → 같은 완료문구 → 옵션 SUCCEEDED 순서인지 확인합니다.
4) 정상이라면 전체 가격·옵션 수정전송을 실행합니다.

주의
- SUCCEEDED는 'Shopling 수정전송 결과창의 완료문구가 확인됨'을 의미하며 개별 마켓 최종 성공을 보증하지 않습니다.
