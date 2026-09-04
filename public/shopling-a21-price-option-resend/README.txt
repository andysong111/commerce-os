Commerce OS · Shopling A21 Price/Option Resend v0.4.4

목적
- Commerce OS에서 Shopling 저장 가격 재조회까지 VERIFIED 된 GOODSKEY만 A21 쇼핑몰상품수정에서 마켓으로 수정전송합니다.
- 판매가와 옵션은 동시에 겹치지 않게 1개 작업씩 처리합니다.
- 마켓별 성공/실패 결과는 검증하지 않습니다.
- 판매가와 옵션 각각의 Shopling 최종 완료문구를 정확히 확인한 뒤 다음 단계로 진행합니다.

v0.4.4 핵심
- v0.4.3 대량 배치 실기에서 화면에는 완료 footer가 보이는데도 top document만 읽는 완료 판정이 footer를 놓쳐 V043_DEFINITIVE_COMPLETION_TIMEOUT으로 실패 처리되는 사례가 확인됐습니다.
- v0.4.4는 결과창의 top document 하나만 보지 않고 Chrome DevTools Protocol Runtime execution context를 모두 수집해 child frame까지 직접 읽습니다.
- Runtime frame DOM에서 footer를 놓치는 경우를 대비해 Chrome Accessibility.getFullAXTree도 함께 읽어 실제 렌더링된 완료문구를 보조 판정합니다.
- PRICE 작업은 '상품 수정 전송이 완료되었습니다.'를, OPTION 작업은 '상품옵션 수정 전송이 완료되었습니다.'를 각각 최종완료 근거로 인정합니다.
- 모든 frame/접근성 트리에서 '처리중입니다' 또는 '잠시만 기다려주시기 바랍니다'가 남아 있으면 다음 단계로 넘어가지 않습니다.
- 기대 footer가 frame DOM 또는 Accessibility에서 확인되고 document complete까지 확인된 상태가 2.5초 연속 유지된 뒤에만 completeJob()을 실제 실행합니다.
- 현재 resultTabId를 최우선으로 보되 필요하면 현재 작업의 popup/opener 관계와 실행 중 생성된 Shopling 탭을 재탐색합니다.
- 일부 성공/실패 결과표, 성공건수/실패건수, 개별 마켓 결과는 완료 근거로 사용하지 않습니다.
- 전체 실행은 모든 PRICE 배치를 먼저 처리한 뒤 OPTION 배치를 처리합니다.

안전장치
1) Shopling 저장 가격 VERIFIED가 아니면 시작하지 않습니다.
2) 배송정보 수정안함과 판매가/옵션 form 값은 송신 전에 검증합니다.
3) 판매가 작업은 판매가 전용 완료 footer 전에는 다음 큐로 넘어가지 않습니다.
4) 옵션 작업은 옵션 전용 완료 footer 전에는 완료 처리하지 않습니다.
5) 결과문서 또는 접근성 트리에 처리중 표시가 있으면 안정화 타이머를 즉시 초기화합니다.
6) 최종 완료 조건이 2.5초 연속 유지된 뒤에만 다음 큐로 넘어갑니다.
7) top document에서 footer를 못 찾아도 child frame과 Accessibility를 계속 확인합니다.
8) 최종 완료를 30분 동안 모든 frame/접근성 트리에서도 확인하지 못하면 V044_FRAME_AX_COMPLETION_TIMEOUT으로 안전 중단합니다.

사용
1) 기존 확장프로그램을 제거하고 v0.4.4 ZIP을 설치합니다.
2) 이전 실행은 안전 중지하고 남아 있는 Shopling 결과창을 닫습니다.
3) 먼저 1 GOODSKEY 안전 테스트를 실행합니다.
4) 판매가 결과창의 실제 최종 완료 뒤 판매가 SUCCEEDED → 옵션 송신으로 넘어가는지 확인합니다.
5) 옵션 결과창의 실제 최종 완료 뒤 옵션도 SUCCEEDED가 되는지 확인합니다.
6) 두 단계가 모두 끝나 최종 상태가 SUCCEEDED이면 전체 가격·옵션 수정전송을 실행합니다.

주의
- SUCCEEDED는 Shopling 결과창의 해당 작업별 최종 footer와 document complete까지 확인됐다는 의미이며 개별 마켓 최종 성공을 보증하지 않습니다.
- PARTIAL_FAILURE에서 V043_DEFINITIVE_COMPLETION_TIMEOUT으로 끝난 기존 배치는 실제 전송 자체가 실패했다는 뜻이 아니라 완료 감지를 놓쳤을 가능성이 있으므로 전체를 무조건 재전송하지 마세요.
