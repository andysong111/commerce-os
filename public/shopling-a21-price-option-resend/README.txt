Commerce OS · Shopling A21 Price/Option Resend v0.2.9

목적
- Commerce OS에서 Shopling 저장 가격 재조회까지 VERIFIED 된 GOODSKEY만 A21 쇼핑몰상품수정에서 마켓으로 수정전송합니다.
- 판매가와 옵션은 동시에 겹치지 않게 1개 작업씩 처리합니다.
- 마켓별 성공/실패 결과는 검증하지 않습니다.
- Shopling이 안내하는 '결과가 나올 때까지 창을 닫지 마세요' 조건을 지켜, 처리중 로딩이 끝난 뒤 다음 작업으로 진행합니다.

실제 Shopling form 기준
- 판매가: modify_tp=goods_normal, tsmt_sale_price_tp=J, trsmt_env_mody_price=Y
- 배송정보: 실제 '수정안함' 라디오를 DOM 증거로 고정하고 송신 직전 MAIN world에서 재검증
- 다른 일반 항목: 수정안함
- 옵션: modify_tp=goods_stock + trsmt_env_mody_opt=1
- 최종 송신함수: goods_mallMdfy_submit_sp()

v0.2.9
- v0.2.8의 content observer는 유지하지만, 이벤트가 누락되는 경우를 대비해 service worker가 Shopling 탭을 직접 폴링합니다.
- 결과화면에서 '처리중입니다 / 잠시만 기다려주시기 바랍니다' 오버레이가 보이는 동안에는 절대 다음 작업으로 넘어가지 않습니다.
- 결과화면이 존재하고 처리중 오버레이가 2초 이상 사라진 상태가 안정적으로 확인되면 해당 작업을 SUCCEEDED 처리합니다.
- 성공건수/실패건수 내용은 판정하지 않습니다.
- 전체 실행은 모든 PRICE 배치를 먼저 처리한 뒤 OPTION 배치를 처리합니다.
- 예: 205 GOODSKEY이면 판매가 200 → 판매가 5 → 옵션 200 → 옵션 5 순서입니다.
- 각 단계는 앞 작업의 Shopling 처리 로딩이 끝난 뒤 다음 작업을 시작하므로 송신창이 겹치지 않습니다.

안전장치
1) Shopling 저장 가격 VERIFIED가 아니면 시작하지 않습니다.
2) 배송정보 수정안함과 판매가/옵션 form 값은 송신 전에 검증합니다.
3) Shopling 원본 송신 함수 자체가 실패하거나 예상하지 못한 확인창이 나오면 해당 작업은 실패합니다.
4) 결과 성공/실패는 무시하지만 '처리중' 로딩이 끝나기 전에는 다음 송신으로 넘어가지 않습니다.
5) 로딩 종료가 20분 동안 확인되지 않으면 V029_LOADING_TIMEOUT으로 중단합니다.

사용
1) 기존 확장프로그램을 제거하고 v0.2.9 ZIP을 설치합니다.
2) 이전 Shopling 결과창은 닫아두면 식별이 가장 깔끔합니다.
3) 먼저 1 GOODSKEY 안전 테스트를 실행합니다.
4) 판매가 송신 → 처리중 로딩 종료 → 판매가 SUCCEEDED → 옵션 송신 → 처리중 로딩 종료 → 옵션 SUCCEEDED 순서인지 확인합니다.
5) 정상이라면 전체 가격·옵션 수정전송을 실행합니다.

주의
- SUCCEEDED는 'Shopling 결과화면에서 처리중 로딩 종료가 확인됨'을 의미하며 개별 마켓 최종 성공을 보증하지 않습니다.
