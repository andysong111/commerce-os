Commerce OS Shopling Account Title Bridge v0.5.0

목적:
Shopling 상품조회 화면을 비워 둔 상태에서도 버튼 한 번으로 OPS CENTER가 새로 등록한 상품만 찾아 상품명 분산 → 미등록 마켓 확인 → 쇼핑몰 등록송신까지 처리합니다.

핵심 원칙:
- 작업 대상은 현재 Shopling 조회결과가 아니라 Commerce OS의 Shopling 등록 원장입니다.
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
2. [사입] 상품조회/수정 화면(/prod/prodList.phtml)만 엽니다. 검색조건이나 조회결과는 비어 있어도 됩니다.
3. 주황색 'Commerce OS · 신규상품 원버튼 처리' 패널에서 '신규상품 전체 자동처리 · 동시 2창'을 한 번 누릅니다.
4. Commerce OS가 신규등록 원장에서 아직 처리되지 않은 상품군만 claim합니다.
5. claim된 정확한 goods key만 기존 상품명 분산 엔진으로 처리하고 저장 검증합니다.
6. 상품명 분산 성공 goods key만 마켓 전송 단계로 넘어갑니다.
7. 각 채널은 정확한 자사상품코드 + 쇼핑몰 미등록 조건으로 조회합니다.
8. 정확일치 상품행이 1개일 때만 '쇼핑몰 상품등록하기'를 실행합니다.
9. 도매1~소매2 저장검색과 쇼핑몰 연동정보를 적용합니다.
10. Commerce OS 영구 submit lock 성공 후에만 '상품등록송신'을 클릭합니다.
11. 완료 후 신규송신 / 이미등록·미등록없음 / 확인필요 / 실패 수량만 확인합니다.

중복방지 원장:
- shopling_market_pipeline_ledger가 goods_key별 처리상태를 영구 보존합니다.
- v0.5 도입 이전의 기존 상품은 legacy_ignored로 기준선을 고정해 자동작업 대상에서 제외합니다.
- v0.4 Production 배포 이후 새로 등록된 현재 미처리 상품은 첫 v0.5 실행 후보로 남겼습니다.
- claimed 상품은 같은 버튼을 다시 눌러도 다시 claim되지 않습니다.
- 2시간 이상 중단된 claim은 자동 재큐잉하지 않고 confirm_needed로 바꿔 중복송신을 방지합니다.
- Shopling에서 이미 등록되어 미등록 조회가 0건이면 already_registered로 종료하며 송신하지 않습니다.

자동 재시도:
- 상품명 분산은 기존 정책대로 저장 검증 실패 등에 최대 2회 재시도합니다.
- 마켓 송신 전 브라우저 단계 오류는 최대 1회 재시도합니다.
- submit lock 또는 상품등록송신 이후에는 자동 재시도하지 않습니다.

설치:
1. Commerce OS Shopling bridge v0.5.0 ZIP을 다운로드하고 압축을 풉니다.
2. chrome://extensions 에서 개발자 모드를 켭니다.
3. 기존 Commerce OS Shopling Account Title Bridge를 새 v0.5.0 폴더로 다시 로드합니다.
4. Shopling 상품조회 화면을 새로고침합니다.

v0.5.0:
- 상품검색 없이 OPS CENTER 신규등록 원장 기준으로 시작하는 원버튼 파이프라인 추가.
- 기존 상품 영구 제외 및 goods_key 단위 idempotency ledger 추가.
- exact ptn_goods_cd 단건 조회로 이전 DM1 prefix 전체검색 제거.
- Shopling 미등록 재검증 + 송신 직전 durable submit lock 이중 중복방지 추가.
- 상품명 분산 실패 상품은 마켓 송신에서 자동 제외.
- /prod/prodList.phtml 빈 조회화면도 시작 화면으로 직접 인식.

v0.4.0:
- Shopling prodlinkage 마켓 등록 흐름과 2-Lane 작업큐 추가.

v0.3.1:
- Commerce OS SEO 원장의 검증 키워드 fallback과 상품명 자동복구 추가.
