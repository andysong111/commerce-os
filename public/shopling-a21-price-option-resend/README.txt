Commerce OS · Shopling A21 Price/Option Resend v0.2.6

목적
- Commerce OS에서 Shopling 쇼핑몰별 가격 재조회까지 VERIFIED 된 GOODSKEY만 A21 쇼핑몰상품수정에서 마켓으로 수정전송합니다.
- 판매가 전송과 옵션 전송은 서로 별도 작업으로 실행합니다.
- 동시 1개 작업만 직렬 실행합니다.
- 전체 실행 전 1 GOODSKEY 안전 테스트를 지원합니다.

실제 Shopling form 기준
- 판매가 모드: modify_tp=goods_normal
- 쇼핑몰별 판매가 source: tsmt_sale_price_tp=J 필수
- 판매가 수정: trsmt_env_mody_price=Y
- 배송정보: 실제 '수정안함' 라디오를 DOM 라벨/onclick 증거로 식별해 고정
- 상품명/카테고리/이미지/수수료/상세설명/키워드/유료서비스는 수정안함
- 옵션 모드: modify_tp=goods_stock
- 옵션송신: trsmt_env_mody_opt=1
- 최종 송신함수: goods_mallMdfy_submit_sp()

v0.2.6 운영 우선 정책
- v0.2.5까지의 배송정보 수정안함 및 송신 전 form 검증은 그대로 유지합니다.
- MAIN world의 Shopling 원본 수정전송 함수가 정상 응답하고 RESULT_WAIT 단계까지 도달하면 해당 작업을 SUCCEEDED로 처리합니다.
- Shopling 개별 마켓 결과창의 성공/실패 집계는 더 이상 다음 작업 진행의 게이트로 사용하지 않습니다.
- 판매가 송신 ACK 후 즉시 옵션 작업으로 진행합니다.
- 옵션 송신 ACK 후 다음 배치로 진행합니다.
- 도매창고/투비즈온 등 개별 마켓 실패는 별도 운영 예외로 취급하며 전체 송신 루프를 중단하지 않습니다.

안전장치
1) Shopling 저장 가격 재조회가 VERIFIED가 아니면 실행하지 않습니다.
2) 판매가 송신 직전 배송정보=수정안함을 MAIN world까지 재검증합니다.
3) 판매가 외 일반 수정항목은 수정안함 상태를 유지합니다.
4) 옵션 작업은 goods_stock + 옵션송신(1)만 사용합니다.
5) Shopling 원본 송신 함수 자체가 실패하거나 예상하지 못한 확인창이 발생하면 해당 작업을 실패 처리합니다.
6) 단순 개별 마켓 결과 실패는 실행 중단 사유로 사용하지 않습니다.

사용
1) 기존 A21 Resend를 제거하고 v0.2.6 ZIP 압축을 풉니다.
2) chrome://extensions → 개발자 모드 → '압축해제된 확장 프로그램을 로드합니다'.
3) Shopling 로그인 상태에서 A18 또는 A21 화면 하나를 엽니다.
4) 먼저 '1 GOODSKEY 안전 테스트'를 실행해 판매가와 옵션이 빠르게 SUCCEEDED로 넘어가는지 확인합니다.
5) 정상이라면 '전체 가격·옵션 수정전송 시작'으로 전체 GOODSKEY를 진행합니다.

주의
- 이 확장프로그램은 실제 마켓 수정전송을 실행합니다.
- v0.2.6의 SUCCEEDED는 'Shopling 수정전송 요청이 정상 접수됨'을 의미하며 개별 마켓의 최종 반영 성공을 보증하지 않습니다.
