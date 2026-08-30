Commerce OS Shopling Account Title Bridge v0.5.2

목적:
Shopling 상품조회 화면을 비워 둔 상태에서도 Commerce OS 원장을 기준으로 두 가지 자동화를 실행합니다.
- 보라색 '미분산 상품 일괄 처리': OPS CENTER에 Shopling 등록완료로 기록된 goods key 전체를 기준으로 상품명 중복 여부를 검사하고, 미분산 상품만 분산·저장합니다.
- 주황색 '신규상품 전체 자동처리': 신규등록 상품만 claim하여 상품명 분산 → Shopling 미등록 마켓 확인 → 쇼핑몰 등록송신까지 처리합니다.

보라색 상품명 일괄 분산:
- 현재 Shopling 검색조건, 화면출력 25/50/100, 현재 조회결과 개수에 의존하지 않습니다.
- OPS CENTER의 shopling_product_group_registry에서 shopling_status=success인 정확한 goods key만 읽습니다.
- 현재 조회화면이 0건이어도 상품조회 UI만 열려 있으면 실행할 수 있습니다.
- 등록 goods key가 500건을 넘으면 500개씩 자동 분할하여 다음 묶음을 이어서 처리합니다.
- 이미 분산이 끝난 goods key는 개별 상품명 화면에서 중복이 없음을 확인한 뒤 '기존정상'으로 건너뜁니다. 저장할 변경이 없으면 저장하지 않습니다.
- 이 기능은 상품명 분산 전용이며 마켓 송신 claim/submit lock 원장을 건드리지 않습니다.

주황색 신규상품 원버튼 처리:
- 작업 대상은 현재 Shopling 조회결과가 아니라 Commerce OS의 Shopling 신규등록 원장입니다.
- 이전 처리상품은 영구 원장에서 자동 제외합니다.
- 자사상품코드는 DM1 같은 넓은 prefix가 아니라 DM1_PLR... 형태의 정확한 ptn_goods_cd 1건을 사용합니다.
- 실제 송신 직전에도 Shopling의 '쇼핑몰에 미등록된 상품' 조건을 다시 적용합니다.
- '상품등록송신' 클릭 전에 Commerce OS Supabase 원장에 submit lock을 먼저 기록합니다. 잠금 기록에 실패하면 클릭하지 않습니다.
- submit lock 이후 결과가 불명확하거나 창이 닫히면 자동 재전송하지 않고 확인필요로 남깁니다.
- Shopling 로그인 쿠키/비밀번호는 Commerce OS 서버로 전송하지 않습니다.
- 화면 구조나 저장검색 결과가 예상과 다르면 fail-closed로 중단합니다.
- Chrome 작업창은 최대 2개만 병렬 실행합니다.

고정 채널 매핑:
- DM1 → 도매1
- DM2 → 도매2
- DM3 → 도매3
- DM4 → 도매4
- SM1 → 소매1
- SM2 → 소매2

사용법:
1. Shopling에 로그인합니다.
2. [사입] 상품조회/수정 화면을 엽니다. 검색조건/조회결과/화면출력 수는 상관없습니다.
3. 상품명만 전체 점검하려면 보라색 '미분산 상품 일괄 처리'를 누릅니다.
4. 신규상품을 분산부터 마켓송신까지 이어서 처리하려면 주황색 '신규상품 전체 자동처리 · 동시 2창'을 누릅니다.

중복방지 원장:
- shopling_market_pipeline_ledger가 신규상품 마켓송신 goods_key별 처리상태를 영구 보존합니다.
- v0.5 도입 이전의 기존 상품은 legacy_ignored로 기준선을 고정해 자동 마켓작업 대상에서 제외합니다.
- claimed 상품은 같은 버튼을 다시 눌러도 다시 claim되지 않습니다.
- 2시간 이상 중단된 claim은 자동 재큐잉하지 않고 confirm_needed로 바꿔 중복송신을 방지합니다.
- Shopling에서 이미 등록되어 미등록 조회가 0건이면 already_registered로 종료하며 송신하지 않습니다.

자동 재시도:
- 상품명 분산은 저장 검증 실패 등에 최대 2회 재시도합니다.
- 마켓 송신 전 브라우저 단계 오류는 최대 1회 재시도합니다.
- submit lock 또는 상품등록송신 이후에는 자동 재시도하지 않습니다.

설치:
1. Commerce OS Shopling bridge v0.5.2 ZIP을 다운로드하고 압축을 풉니다.
2. chrome://extensions 에서 개발자 모드를 켭니다.
3. 기존 Commerce OS Shopling Account Title Bridge를 새 v0.5.2 폴더로 다시 로드합니다.
4. Shopling 상품조회 화면을 닫았다가 다시 엽니다.

v0.5.2:
- 보라색 '미분산 상품 일괄 처리'를 Shopling 현재 조회결과 수집 방식에서 OPS CENTER 등록 goods key 방식으로 전환.
- 화면출력 25/50/100 및 페이지네이션 수집 실패와 무관하게 실행.
- 빈 상품조회 화면에서도 실행 가능.
- 500건 초과 registry goods key는 자동 청크 처리.

v0.5.1:
- Shopling 셸/프레임 구조에서도 신규상품 주황색 패널을 DOM으로 인식하도록 보강.

v0.5.0:
- 상품검색 없이 OPS CENTER 신규등록 원장 기준으로 시작하는 원버튼 파이프라인 추가.
- 기존 상품 영구 제외 및 goods_key 단위 idempotency ledger 추가.
- exact ptn_goods_cd 단건 조회, Shopling 미등록 재검증, 송신 직전 durable submit lock 추가.

v0.4.0:
- Shopling prodlinkage 마켓 등록 흐름과 2-Lane 작업큐 추가.

v0.3.1:
- Commerce OS SEO 원장의 검증 키워드 fallback과 상품명 자동복구 추가.
