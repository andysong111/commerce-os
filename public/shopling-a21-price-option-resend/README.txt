Commerce OS · Shopling A21 Price/Option Resend v0.3.6

목적
- Commerce OS에서 Shopling 저장 가격 재조회까지 VERIFIED 된 GOODSKEY만 A21 쇼핑몰상품수정에서 마켓으로 수정전송합니다.
- 판매가와 옵션은 동시에 겹치지 않게 1개 작업씩 처리합니다.
- 마켓별 성공/실패 결과는 검증하지 않습니다.
- Shopling 결과 팝업의 실제 로딩이 끝난 뒤 다음 작업으로 진행합니다.

v0.3.6 핵심
- 실기 화면에서 v0.3.5는 결과 팝업이 화면에 존재하고 로딩도 끝났는데 background가 결과창/결과표를 찾지 못하는 상태가 확인됐습니다.
- 이 결과창은 일반 Shopling URL 탭이 아니라 about:blank 또는 opener-origin 기반 팝업/프레임으로 만들어질 수 있어 background의 chrome.scripting 조회가 접근하지 못할 수 있습니다.
- v0.3.6은 Shopling 결과 문서 자체에 result-loading-v036.js를 document_start부터 주입합니다.
- match_about_blank=true + match_origin_as_fallback=true로 Shopling에서 생성된 about:blank 팝업/프레임까지 감지 대상에 포함합니다.
- 결과 문서 내부에서 '처리중입니다/잠시만 기다려주시기 바랍니다'와 결과표 증거를 직접 읽습니다.
- 로딩 문구가 사라지고 결과표가 약 1.8초 안정되면 결과 문서가 background에 A21_RESULT_COMPLETE_V036을 직접 보내 SUCCEEDED → 다음 작업으로 진행합니다.
- v0.3.5의 background 외부 스캔 방식은 fallback으로 유지합니다.
- Shopling window.open/form target/스크롤 동작은 변경하지 않습니다.
- '상품 수정 전송이 완료되었습니다.' footer는 필요하지 않습니다.
- 전체 실행은 모든 PRICE 배치를 먼저 처리한 뒤 OPTION 배치를 처리합니다.
- 205 GOODSKEY: 판매가 200 → 판매가 5 → 옵션 200 → 옵션 5.

안전장치
1) Shopling 저장 가격 VERIFIED가 아니면 시작하지 않습니다.
2) 배송정보 수정안함과 판매가/옵션 form 값은 송신 전에 검증합니다.
3) Shopling 원본 송신 함수 자체가 실패하거나 예상하지 못한 확인창이 나오면 해당 작업은 실패합니다.
4) 결과 팝업의 로딩이 끝나기 전에는 다음 송신으로 넘어가지 않습니다.
5) 개별 마켓 성공/실패 내용은 진행 차단 조건으로 사용하지 않습니다.

사용
1) 기존 확장프로그램을 제거하고 v0.3.6 ZIP을 설치합니다.
2) 현재 실행 중인 이전 버전은 안전 중지하고 남아 있는 Shopling 결과창을 닫습니다.
3) 먼저 1 GOODSKEY 안전 테스트를 실행합니다.
4) 결과창 로딩 중에는 확장 UI에 '결과문서 직접 감지 · 로딩 중'이 표시되는지 확인합니다.
5) 로딩이 사라지면 '로딩 종료 · 안정화 중' → 판매가 SUCCEEDED → 옵션 송신으로 넘어가는지 확인합니다.
6) 옵션도 동일하게 끝나면 전체 가격·옵션 수정전송을 실행합니다.

주의
- SUCCEEDED는 Shopling 결과 팝업의 로딩 종료와 결과화면 안정화까지 확인됐다는 의미이며 개별 마켓 최종 성공을 보증하지 않습니다.
