Commerce OS Shopling Account Title Bridge v0.5.5

운영 원칙:
- 운영자가 누르는 버튼은 주황색 '신규상품 전체 자동처리' 하나입니다.
- 기존 보라색 '미분산 상품 일괄 처리' UI는 중복 작업 흐름을 만들기 때문에 v0.5.5부터 숨깁니다.
- Shopling 현재 조회결과, 화면출력 25/50/100, 검색조건에 의존하지 않고 Commerce OS 원장을 기준으로 처리합니다.

주황색 '신규상품 전체 자동처리':
1. 신규등록 마켓 원장에서 아직 처리하지 않은 상품군만 claim합니다.
2. claim된 goods key의 쇼핑몰별 상품명을 점검하고 필요한 경우에만 분산 저장합니다.
3. 상품명 점검 완료 후 마켓 단계로 자동 전환합니다.
4. exact ptn_goods_cd 1건으로 Shopling의 '쇼핑몰 미등록 상품'을 다시 확인합니다.
5. DM1→도매1, DM2→도매2, DM3→도매3, DM4→도매4, SM1→소매1, SM2→소매2로 고정 매핑합니다.
6. 상품등록송신 직전에 Supabase durable submit lock이 성공해야만 클릭합니다.
7. 이미 등록된 상품은 Shopling 미등록 재확인에서 건너뛰고, submit lock 이후 결과가 불명확하면 자동 재송신하지 않고 확인필요로 남깁니다.
8. 마켓 단계에서는 최대 2개의 Chrome 작업창을 사용합니다.

안정성:
- Chrome MV3 서비스워커가 유휴 상태로 들어가도 chrome.alarms 기반 상품명 작업 감시기가 1분 주기로 상태를 확인합니다.
- 상품명 작업이 약 75초 이상 같은 단계에서 멈추면 해당 작업 탭을 안전하게 다시 열어 복구합니다.
- 저장 이후 단계에서 멈춘 경우에는 재수정하지 않고 검증 페이지부터 다시 열어 중복 수정을 피합니다.
- 반복 복구에도 실패한 goods key만 실패 처리하고 다음 goods key로 계속 진행합니다.
- 다른 Chrome 탭, 다른 Windows 가상 데스크톱으로 이동해도 됩니다. Chrome 자체를 종료하거나 확장프로그램을 실행 중 재로드하면 브라우저 자동화는 중단됩니다.

중복방지:
- shopling_market_pipeline_ledger가 신규상품 마켓송신의 영구 idempotency 원장입니다.
- 이전 완료상품은 다시 신규 claim 대상이 되지 않습니다.
- exact ptn_goods_cd + Shopling 미등록 재확인 + 송신 직전 Commerce OS 영구 잠금의 3중 방어를 사용합니다.
- 기존 599 goods key의 상품명 기준선은 별도 title ledger에 보존됩니다.

사용법:
1. SEO 대량등록 클라우드에서 Shopling 등록이 완료되면 Shopling [사입] 상품조회/수정 화면만 엽니다.
2. 상품을 미리 검색할 필요가 없습니다.
3. 주황색 '신규상품 전체 자동처리'를 한 번 누릅니다.
4. 상품명 점검 → 마켓 자동전송이 끝날 때까지 Chrome은 켜둡니다. 다른 탭/가상 데스크톱 사용은 가능합니다.
5. 최종 확인필요/실패 건만 확인합니다.

설치:
1. Commerce OS Shopling bridge v0.5.5 ZIP을 다운로드하고 압축을 풉니다.
2. chrome://extensions에서 기존 Commerce OS Shopling Account Title Bridge를 v0.5.5 폴더로 다시 로드합니다.
3. Shopling 상품조회 화면을 닫았다가 다시 엽니다.

v0.5.5:
- 운영 UI를 주황색 원버튼 하나로 통합하고 보라색 수동 분산 패널을 숨김.
- chrome.alarms 기반 상품명 배치 백그라운드 감시/복구 추가.
- 상품명 진행상태를 주황색 패널에서 직접 보여주며 백그라운드 감시 활성 여부 표시.
- 기존 exact code / Shopling 미등록 재확인 / durable submit lock 유지.

v0.5.4:
- 상품명 완료 → 마켓 전송 시작 연결 복구 모듈 추가.

v0.5.3:
- 상품명 분산 durable ledger 및 기존 599 goods key 기준선 처리.

v0.5.0:
- 신규상품 원버튼 파이프라인, exact ptn_goods_cd, Shopling 미등록 재검증, durable submit lock 추가.
