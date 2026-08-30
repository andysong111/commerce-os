Commerce OS Shopling Account Title Bridge v0.5.3

목적:
Shopling 상품조회 화면이 비어 있어도 Commerce OS 원장을 기준으로 상품명 분산과 신규상품 마켓 송신을 처리합니다.

보라색 '미분산 상품 일괄 처리':
- Shopling 현재 조회결과, 화면출력 25/50/100, 페이지네이션에 의존하지 않습니다.
- shopling_title_diversification_ledger에서 아직 처리하지 않은 신규 goods key만 claim합니다.
- v0.5.3 전환 시점에 이미 OPS CENTER 등록완료였던 기존 599 goods key는 baseline_processed로 영구 기준선 처리되어 다음 확장프로그램에서 다시 열지 않습니다.
- 이후 새로 등록된 goods key만 queued로 들어오며 한 번 처리되면 diversified 또는 already_normal로 영구 종료됩니다.
- 실패/중단건은 자동 반복하지 않고 별도 '실패/중단건 재시도' 버튼을 눌렀을 때만 다시 queued로 전환합니다.
- 상품명 분산은 기존처럼 저장 검증 실패 등에 최대 2회 자동재시도합니다.
- 이 기능은 마켓 송신 claim/submit lock을 건드리지 않습니다.

주황색 '신규상품 전체 자동처리 · 동시 2창':
- 신규등록 마켓 원장만 claim합니다.
- exact ptn_goods_cd 1건으로 Shopling 미등록 상품을 다시 확인합니다.
- DM1→도매1, DM2→도매2, DM3→도매3, DM4→도매4, SM1→소매1, SM2→소매2 고정 매핑입니다.
- 상품등록송신 직전에 Supabase durable submit lock이 성공해야만 클릭합니다.
- submit lock 이후 결과가 불명확하면 자동 재송신하지 않고 확인필요로 남깁니다.
- 동시 Chrome 작업창은 최대 2개입니다.
- 보라색 상품명 분산 진행 메시지는 주황색 패널에 표시하지 않습니다. 주황색 패널은 자신이 직접 시작한 신규상품 파이프라인만 표시합니다.

사용법:
1. Shopling [사입] 상품조회/수정 화면만 엽니다. 검색조건과 조회결과는 비어 있어도 됩니다.
2. 상품명 미처리 신규 goods key만 정리하려면 보라색 '미분산 상품 일괄 처리'를 누릅니다.
3. 신규상품을 상품명 분산부터 마켓송신까지 처리하려면 주황색 '신규상품 전체 자동처리 · 동시 2창'을 누릅니다.
4. 보라색 처리에서 실패/중단건이 생기면 표시되는 '실패/중단건 재시도' 버튼으로 해당 건만 명시적으로 재처리합니다.

영구 원장:
- shopling_title_diversification_ledger: 상품명 분산 idempotency 원장.
- shopling_market_pipeline_ledger: 신규상품 마켓송신 idempotency/submit-lock 원장.
- 두 원장은 서로 분리되어 상품명 점검이 마켓 중복송신을 유발하지 않습니다.

설치:
1. Commerce OS Shopling bridge v0.5.3 ZIP을 다운로드하고 압축을 풉니다.
2. chrome://extensions에서 기존 Commerce OS Shopling Account Title Bridge를 v0.5.3 폴더로 다시 로드합니다.
3. Shopling 상품조회 화면을 닫았다가 다시 엽니다.

v0.5.3:
- 상품명 분산 전용 durable ledger 추가.
- 전환 시점 기존 599 goods key를 baseline_processed로 영구 기준선 처리.
- 이후 신규 goods key만 자동 claim/처리.
- 실패/중단건만 명시적 재시도 가능.
- 보라색 분산 진행상태가 주황색 신규상품 패널에 섞여 보이던 UI 상태 분리.

v0.5.2:
- 보라색 분산을 Shopling 화면수집에서 OPS CENTER goods key 기반으로 전환.

v0.5.1:
- Shopling 셸/프레임 구조에서 주황색 패널 인식 보강.

v0.5.0:
- 신규상품 원버튼 파이프라인, exact ptn_goods_cd, Shopling 미등록 재검증, durable submit lock 추가.
