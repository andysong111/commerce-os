Commerce OS Shopling Account Title Bridge v0.3.1

목적:
Shopling에 로그인한 Chrome의 상품조회 메인 화면에서 현재 조회된 상품 전체의 goods key를 자동 수집하고, 같은 goods key 안의 같은 쇼핑몰 여러 로그인 ID에 동일 상품명이 반복되는 경우만 계정별로 분산한 뒤 Shopling에 저장하고 재검증합니다.

핵심 원칙:
- 상품조회 메인 화면의 '미분산 상품 일괄 처리' 버튼 하나로 실행합니다.
- 현재 조회조건의 결과 전체를 대상으로 합니다. 총 조회수보다 goods key 수집량이 적으면 일부만 처리하지 않고 중단합니다.
- 빈 상품명, 가격, 옵션, 검색어, 이미지, 상세설명은 수정하지 않습니다.
- Shopling 비밀번호나 쿠키를 Commerce OS 서버로 전송하지 않습니다.
- 이미 분산된 goods key는 저장 없이 건너뜁니다.
- 한 번에 한 goods key만 처리합니다.

상품명 분산 순서:
1. 현재 Shopling 상품명 안의 단어 순서 변경으로 먼저 분산합니다.
2. 부족하면 같은 goods key의 다른 Shopling 상품명에 이미 들어 있는 단어만 보강합니다.
3. 그래도 부족하면 Commerce OS SEO 원장에서 해당 goods key의 최신 FINAL/허용 후보를 조회해 검증된 키워드만 마지막 fallback으로 사용합니다.
4. SEO 원장에서도 safetyPass=false, titleEligible=false, categoryAligned=false, blocked/prohibited 후보는 제외합니다.
5. 새로운 키워드를 임의 생성하지 않으며 UTF-8 100bytes를 넘기지 않습니다.

자동 복구:
- 상품명 화면/저장 검증 timeout은 60초입니다.
- timeout, 저장 후 중복 잔존, 저장 버튼 탐지 실패, 키워드 pool 부족은 동일 goods key를 최대 2회 추가 자동 재시도합니다.
- 저장 후 동일 goods key를 다시 열어 중복이 실제로 사라졌는지 검증합니다.
- 실행 종료 후 최종 실패 goods key와 사유를 chrome.storage.local에 보존합니다.

설치:
1. ZIP을 다운로드하고 압축을 풉니다.
2. chrome://extensions 에서 개발자 모드를 켭니다.
3. 기존 Commerce OS Shopling Account Title Bridge를 삭제합니다.
4. '압축해제된 확장 프로그램을 로드'로 manifest.json이 있는 폴더를 선택합니다.

일괄 사용:
1. Shopling [사입] 상품조회/수정 메인 화면에서 원하는 조건으로 조회합니다.
2. 우측 아래 '미분산 상품 일괄 처리'를 한 번 누릅니다.
3. 완료 상태에서 분산저장/자동복구/기존정상/최종확인 수량을 확인합니다.
4. 최종확인이 있으면 상세 목록에 goods key와 사유가 표시됩니다.

v0.3.1:
- Shopling 화면의 키워드만으로 부족한 상품은 Commerce OS Supabase SEO 원장의 최신 검증 후보를 읽어 마지막 fallback으로 사용합니다.
- extension background에서만 Commerce OS read-only keyword-pool API를 호출하며 Shopling 쿠키/비밀번호는 전송하지 않습니다.
- 기존 v0.3.0 자동 재시도와 실패 상세기록은 그대로 유지합니다.

v0.3.0:
- 같은 goods key 내부 Shopling 제목의 검증 키워드 fallback, 60초 timeout, 최대 2회 자동 재시도, 실패 상세기록을 추가했습니다.

v0.2.1:
- Shopling 상품조회 내부 frame에 일괄 버튼을 표시하고 총 조회수 대비 부분 실행 방지 안전장치를 추가했습니다.
