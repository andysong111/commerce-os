Commerce OS · Shopling A21 Price/Option Resend v0.1.9

목적
- Commerce OS에서 Shopling 쇼핑몰별 가격 재조회까지 VERIFIED 된 GOODSKEY만 A21 쇼핑몰상품수정에서 마켓으로 수정전송합니다.
- 판매가 전송과 옵션 전송은 서로 별도 작업으로 실행합니다.

실제 Shopling form 기준
- 판매가 모드: modify_tp=goods_normal
- 쇼핑몰별 판매가 source: tsmt_sale_price_tp=J 필수
- 판매가 수정: trsmt_env_mody_price=Y
- 나머지 일반항목: 빈값(수정안함)
- 옵션 모드: modify_tp=goods_stock
- 옵션송신: trsmt_env_mody_opt=1
- 최종 송신버튼: value='상품수정 송신', onclick=goods_mallMdfy_submit_sp()

안전장치
1) Shopling 가격 재조회가 VERIFIED가 아니면 실행하지 않습니다.
2) A18 빈 화면에서도 새 작업창이 [21] 쇼핑몰상품수정으로 자동 진입합니다.
3) 검색은 최대 200 GOODSKEY씩 시작합니다.
4) 화면출력은 500으로 맞추고 실제 조회수가 500건을 넘으면 전송 전에 자동 분할합니다.
5) 검색한 모든 GOODSKEY가 결과에 있고, 총 조회수와 실제 선택행 수가 같아야 전송합니다.
6) 판매가 송신 직전 tsmt_sale_price_tp=J와 각 일반항목의 정확한 radio name/value를 다시 검증합니다.
7) 옵션 송신 직전 modify_tp=goods_stock, trsmt_env_mody_opt=1을 다시 검증합니다.
8) prod_join_chk[] 전송대상이 없으면 송신하지 않습니다.
9) 정확한 goods_mallMdfy_submit_sp() 버튼을 찾지 못하면 송신하지 않습니다.
10) Shopling 결과 화면에서 성공을 확인하지 못하면 성공으로 기록하지 않습니다.
11) 동시 작업창은 최대 4개입니다.

사용
1) chrome://extensions에서 개발자 모드를 켭니다.
2) 기존 A21 Resend를 제거하고 ZIP 압축을 풉니다.
3) '압축해제된 확장 프로그램을 로드합니다'로 압축을 푼 폴더를 선택합니다.
4) Shopling 로그인 상태에서 A18 또는 A21 화면을 엽니다.
5) 확장프로그램 아이콘을 눌러 VERIFIED 수량을 확인합니다.
6) 'A21 가격·옵션 수정전송 시작'을 누릅니다.
7) 실행 중 Shopling 작업창/송신창을 임의로 조작하지 않습니다.

주의
- 이 확장프로그램은 실제 마켓 수정전송을 실행합니다.
- 설치만으로 자동 실행되지 않으며 사용자가 시작 버튼을 눌러야 합니다.
