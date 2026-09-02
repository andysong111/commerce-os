Commerce OS · Shopling A21 Price/Option Resend v0.2.2

목적
- Commerce OS에서 Shopling 쇼핑몰별 가격 재조회까지 VERIFIED 된 GOODSKEY만 A21 쇼핑몰상품수정에서 마켓으로 수정전송합니다.
- 판매가 전송과 옵션 전송은 서로 별도 작업으로 실행합니다.
- 정확도 우선으로 동시 1개 작업만 직렬 실행합니다.
- 전체 실행 전 1 GOODSKEY 안전 테스트를 지원합니다.

실제 Shopling form 기준
- 판매가 모드: modify_tp=goods_normal
- 쇼핑몰별 판매가 source: tsmt_sale_price_tp=J 필수
- 판매가 수정: trsmt_env_mody_price=Y
- 배송정보: trsmt_env_mody_dlvyinfo='' (수정안함) 필수
- 상품명/카테고리/이미지/수수료/상세설명/키워드/유료서비스도 빈값(수정안함)
- 옵션 모드: modify_tp=goods_stock
- 옵션송신: trsmt_env_mody_opt=1
- 최종 송신함수: goods_mallMdfy_submit_sp()

v0.2.2 변경
- v0.2.1의 MAIN-submit runtime message가 기존 background listener의 unsupported_message 응답과 충돌하던 문제를 제거했습니다.
- 송신 요청은 isolated content script와 MAIN-world content script 사이의 DOM CustomEvent bridge로 전달합니다.
- Shopling 원본 함수 실행 전에 MAIN world에서 판매가/옵션 form 값을 다시 검증합니다.
- 판매가 작업은 배송정보가 반드시 수정안함이어야 하며 그렇지 않으면 송신하지 않습니다.
- 원본 함수에서 나타나는 예상 안내창만 자동 처리합니다.
  · '수정전송 할 상품을 선택하셨습니까?' confirm → 확인
  · '배송정보(A17 정보)가 수정되지 않고 유지됩니다' alert → 안내로 기록 후 계속
- 위 두 종류가 아닌 예상하지 못한 confirm/alert는 자동 승인하지 않고 송신을 중단합니다.

안전장치
1) Shopling 가격 재조회가 VERIFIED가 아니면 실행하지 않습니다.
2) A18 빈 화면에서도 새 작업창이 [21] 쇼핑몰상품수정으로 자동 진입합니다.
3) 처음에는 '1 GOODSKEY 안전 테스트'로 판매가→옵션 2개 작업만 검증할 수 있습니다.
4) 전체 실행은 최대 200 GOODSKEY씩 검색합니다.
5) 화면출력 500을 초과하면 전송 전에 더 작은 묶음으로 자동 분할합니다.
6) 검색한 모든 GOODSKEY가 결과에 있고 총 조회수와 실제 선택행 수가 같아야 전송합니다.
7) 판매가 송신 직전 tsmt_sale_price_tp=J, 판매가=Y, 배송정보 포함 나머지 일반항목=수정안함을 다시 검증합니다.
8) 옵션 송신 직전 modify_tp=goods_stock, trsmt_env_mody_opt=1을 다시 검증합니다.
9) prod_join_chk[] 전송대상이 없으면 송신하지 않습니다.
10) MAIN world에서도 동일한 form 값을 다시 검증합니다.
11) Shopling 원본 goods_mallMdfy_submit_sp 함수가 없으면 송신하지 않습니다.
12) 예상하지 못한 확인/경고창은 자동 승인하지 않습니다.
13) Shopling 결과 화면을 background가 직접 읽어 성공을 확인하지 못하면 성공으로 기록하지 않습니다.
14) 기존에 열려 있던 상품수정 송신 팝업은 실행 시작 시 기준선으로 제외합니다.

사용
1) chrome://extensions에서 개발자 모드를 켭니다.
2) 기존 A21 Resend를 제거하고 ZIP 압축을 풉니다.
3) '압축해제된 확장 프로그램을 로드합니다'로 압축을 푼 폴더를 선택합니다.
4) 기존 수동 송신 팝업은 닫고 Shopling 로그인 상태에서 A18 또는 A21 화면 하나를 엽니다.
5) 확장프로그램 아이콘을 눌러 VERIFIED 수량을 확인합니다.
6) 먼저 '1 GOODSKEY 안전 테스트'를 실행합니다.
7) 테스트에서 판매가/옵션 모두 SUCCEEDED 확인 후 '전체 가격·옵션 수정전송 시작'을 사용합니다.
8) 실행 중 관리되는 Shopling 작업창/송신창을 임의로 조작하지 않습니다.

주의
- 이 확장프로그램은 실제 마켓 수정전송을 실행합니다.
- 설치만으로 자동 실행되지 않으며 사용자가 테스트/전체 시작 버튼을 눌러야 합니다.
