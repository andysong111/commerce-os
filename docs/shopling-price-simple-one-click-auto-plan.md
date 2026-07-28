# 샵플링 가격설정 — 쉬운 화면과 한 번 클릭 자동 실행 계획

## 1. 점수 체계

### 가격변경 엔진 안정성

현재 공식 점수는 90/100이다.

다음이 실제 안전 상품 200~500개에서 모두 확인되면 기존 안정성 로드맵은 100/100으로 판정한다.

- 입력 상품 수와 최종 처리 상품 수 일치
- 누락 0
- 중복 실행 0
- 실패 범위 정확
- 실패 상품만 재실행
- 일시중지·재접속·재개 정상
- Shopling 실제 수정일·가격 표본 일치
- JSON·CSV·감사 로그 정상

### 운영 사용성·무인 자동화

이번 작업은 새 범위다.

목표는 사용자가 기술 용어와 여러 단계 버튼을 이해하지 않아도 다음 한 흐름으로 끝내는 것이다.

1. 상품번호를 붙여넣거나 파일 업로드
2. 대상 수 확인
3. `전체 가격 자동 변경 시작` 한 번 클릭
4. 첫 10개 안전 점검
5. 이상이 없으면 나머지를 50개씩 자동 실행
6. 브라우저를 닫아도 서버가 계속 진행
7. 실패·불확실 상태에서는 즉시 자동 중단
8. 다음 날 접속해 완료·실패 결과 확인

이 범위가 운영 실증까지 통과해야 전체 제품 사용성도 100/100으로 본다.

---

## 2. 사용자 화면 원칙

기본 경로:

`/shopling-price-modify-runner`

기본 화면에는 아래만 표시한다.

### A. 상품번호 입력

- 엑셀·CSV 파일 선택
- 직접 붙여넣기
- 설명: `쉼표, 공백, 줄바꿈이 섞여 있어도 자동으로 구분합니다.`

### B. 실행 전 확인

표시 항목을 최소화한다.

- 변경할 상품: N개
- 제외된 중복: N개
- 잘못된 번호: N개
- 실행 묶음: N개
- 안전 방식: 첫 10개 확인 후 50개씩 자동 실행

기술 세부 정보는 `상세 보기` 안에 숨긴다.

### C. 주 버튼 하나

버튼 문구:

`전체 가격 자동 변경 시작`

버튼 아래 설명:

`먼저 10개를 시험 실행합니다. 10개가 모두 성공하면 나머지를 50개씩 자동 처리합니다. 실패하거나 전송 상태가 불확실하면 즉시 멈춥니다.`

확인창은 한 번만 표시한다.

확인창에 포함할 내용:

- 실제 변경 대상 수
- 현재 적용할 가격정책 요약
- 첫 10개 시험 후 자동 진행
- 브라우저를 닫아도 서버 자동 실행 계속
- 실패·불확실 시 자동 중단
- 실제 Shopling 가격을 변경한다는 경고

### D. 진행 상태

4단계만 표시한다.

1. 입력 확인
2. 첫 10개 시험
3. 나머지 자동 실행
4. 완료

상태 문구 예:

- `첫 10개 상품을 확인하고 있습니다.`
- `50개씩 자동으로 변경 중입니다. 3/21 묶음 완료`
- `현재 묶음이 끝난 뒤 멈춥니다.`
- `실패 상품 2개가 있어 자동으로 멈췄습니다.`
- `모든 상품의 가격 변경이 완료되었습니다.`

### E. 상황별 보조 버튼

평상시에는 보이지 않는다.

- 실행 중: `현재 묶음 후 멈추기`
- 일시중지: `계속 실행`
- 실패: `실패 상품만 다시 실행`
- 완료: `결과 파일 받기`
- 항상 작은 링크: `고급 관리 열기`

---

## 3. 용어 교체

기본 화면에서는 기술 용어를 사용하지 않는다.

| 기존 용어 | 기본 화면 문구 |
|---|---|
| goods_key | 상품번호 |
| Bulk | 대량 |
| 카나리 | 첫 10개 시험 실행 |
| normal chunk | 50개 실행 묶음 |
| retry | 실패 상품만 다시 실행 |
| validation_only | 가격 변경 없는 성능 검사 |
| audit log | 작업 기록 |
| archive | 작업 보관 |
| dispatch_uncertain | 전송 상태 확인 필요 · 재실행 금지 |

기술 용어는 고급 관리 화면과 진단 JSON에서만 유지한다.

---

## 4. 화면 분리

### 기본 화면

`/shopling-price-modify-runner`

새 컴포넌트:

`ShoplingPriceModifySimpleAutoRunner.tsx`

기본 화면은 새 컴포넌트만 중심으로 표시한다.

### 고급 관리 화면

`/shopling-price-modify-runner/advanced`

현재 기능을 그대로 이동·보존한다.

- 기존 대량 입력·미리보기
- 수동 시험 실행
- 수동 결과 확인
- 일반 실행 승인
- 실패 상품 재시도
- 일시중지·재개
- 운영 리포트·CSV·감사 로그
- 20,000개 검증
- 작업 보관
- 기존 50개 이하 즉시 실행

기존 로직을 삭제하거나 기능을 약화하지 않는다.

---

## 5. 서버 자동 실행 구조

브라우저의 setTimeout 루프에만 의존하지 않는다.

Vercel Cron이 Production에서 매분 자동 실행 작업을 진행한다.

설정 파일:

`vercel.json`

예정 경로:

`GET /api/cron/shopling-price-bulk-auto`

예정 스케줄:

`* * * * *`

보안:

- Production 환경변수 `CRON_SECRET` 필수
- `Authorization: Bearer ${CRON_SECRET}`가 정확히 일치할 때만 실행
- CRON_SECRET이 없으면 fail closed
- 사용자 세션을 사용하지 않음
- Supabase service role로 소유자와 작업을 조회

한 번의 Cron 호출은 제한된 작업 수만 처리한다.

- 최대 5개 작업 claim
- 작업별 최대 4개 상태 전이
- 외부 GitHub Actions가 시작되면 즉시 다음 작업으로 이동
- 함수 장기 실행 금지

---

## 6. DB migration 006

새 migration만 추가한다.

권장 파일:

`supabase/migrations/202607280002_shopling_price_bulk_one_click_auto.sql`

기존 migration 001~005는 수정하지 않는다.

### jobs 컬럼

- `automation_mode text not null default 'manual'`
  - 허용값: `manual`, `auto`
- `automation_started_at timestamptz null`
- `automation_last_tick_at timestamptz null`
- `automation_finished_at timestamptz null`
- `automation_lease_until timestamptz null`
- `automation_worker_id text null`
- `automation_stop_reason text null`

기존 행은 모두 `manual`이다.

`validation_only`는 `automation_mode='auto'`가 될 수 없다.

### RPC

1. `enable_shopling_price_bulk_auto_execution`
   - owner 일치
   - live + prepared 작업만 허용
   - auto 모드 설정

2. `claim_next_shopling_price_bulk_auto_job`
   - service_role 전용
   - `for update skip locked`
   - lease 만료 작업만 claim
   - archived/validation_only/paused/terminal 작업 제외
   - 자동 진행 대상 상태만 선택

3. `release_shopling_price_bulk_auto_job`
   - worker 일치
   - lease 해제
   - last tick 갱신

4. `finish_shopling_price_bulk_auto_job`
   - normal_succeeded면 automation_finished_at 기록

5. `stop_shopling_price_bulk_auto_job`
   - 실패, 불확실, 최대 재시도 등 안전 중단 사유 기록

모든 RPC는 security definer, search_path public, public/anon/authenticated revoke, service_role execute만 허용한다.

---

## 7. 한 번 클릭 생성 API

새 API:

`POST /api/shopling-price-modify/bulk/auto-jobs`

인증:

- 현재 로그인 사용자

body:

- 기존 입력 통계와 goods_keys
- `confirmation: CONFIRM_ONE_CLICK_AUTO_PRICE_CHANGE`

처리:

1. 기존 prepared job 생성 RPC 재사용
2. auto execution 활성화
3. 첫 10개 시험 실행 즉시 시작 시도
4. 작업번호와 상태 반환
5. 이후 Cron이 독립적으로 계속 진행

제한:

- 최대 20,000개
- validation_only 생성 불가
- 잘못된 번호 또는 중복 통계 불일치 차단
- 실제 가격 변경 확인 문구 필수

---

## 8. 자동 오케스트레이터

새 서버 모듈:

`src/lib/shoplingPriceModifyBulkAutoOrchestrator.ts`

상태별 동작:

### prepared

- 시험 청크 reserve
- GitHub Actions dispatch
- running 또는 uncertain 저장

### canary_running

- 동일 request_id 결과만 조회
- pending이면 대기
- 10/10 성공이면 자동으로 normal 승인
- 실패면 즉시 중단

### canary_succeeded

- normal 청크가 있으면 자동 승인
- normal 청크가 없으면 완료

### normal_running

- 활성 청크가 있으면 동일 request_id 결과 조회
- 성공이면 다음 pending 청크 예약·dispatch
- 실패면 즉시 중단
- uncertain이면 새 dispatch 금지, 기존 결과만 조회

### dispatch_uncertain

- 새 request_id 생성 금지
- 현재 활성 청크 종류에 맞는 결과만 조회
- 결과를 찾으면 finish
- 결과를 못 찾으면 안전 정지 유지

### paused / failed / terminal / validation_only / archived

- 아무 작업도 실행하지 않음

자동 모드는 실패 상품을 자동 재시도하지 않는다.

실패 상품 재실행은 사용자의 `실패 상품만 다시 실행` 확인 후 진행한다.

---

## 9. 안전장치

- 첫 10개가 전부 성공해야 전체 자동 실행
- 50개씩 한 묶음만 직렬 실행
- 기존 request_id 정확 일치
- 성공 확인 전 다음 묶음 금지
- 실패·unknown scope·uncertain 즉시 자동 중단
- 여러 Cron·여러 탭이 동시에 접근해도 DB claim과 기존 reserve RPC가 중복 dispatch 차단
- paused 작업은 claim 금지
- archived 작업은 claim 금지
- validation_only는 구조적으로 claim 금지
- 성공 상품 자동 재실행 금지
- 자동 무한 재시도 금지
- CRON_SECRET 누락 시 503 또는 401로 fail closed

---

## 10. 실행 시간 표시

정확한 완료 시각을 보장하지 않는다.

UI는 최근 완료 작업의 실제 처리 속도를 이용할 수 있을 때만 예상 시간을 표시한다.

예:

`최근 처리 속도 기준 약 5시간 예상`

표본이 없으면:

`상품 수와 Shopling 응답 속도에 따라 수 시간이 걸릴 수 있습니다.`

현재 실측 61개 작업은 약 1,094초, 약 3.35개/분 수준이었다. 이 수치는 참고값이며 고정값으로 사용하지 않는다.

---

## 11. 필수 테스트

### UI

- 기본 화면에 기술 용어 버튼 없음
- 주 버튼은 `전체 가격 자동 변경 시작` 하나
- 쉬운 설명 존재
- 진행 4단계 표시
- 고급 관리 링크 존재
- 고급 경로에서 기존 기능 유지
- 기존 50개 이하 즉시 실행 유지

### one-click API

- session owner만 생성
- 20,000개 허용, 20,001개 거부
- confirmation 필수
- auto mode 저장
- 첫 시험 실행 시작
- 생성 중 일부 실패 시 진단 가능

### Cron 보안

- CRON_SECRET 미설정 차단
- 잘못된 Authorization 차단
- 정확한 Bearer만 허용
- user-agent만으로 인증하지 않음

### claim·동시성

- 동일 작업을 동시 Cron 두 개가 claim해도 하나만 성공
- lease 만료 전 재claim 금지
- lease 만료 후 복구 가능
- paused/archived/validation_only/terminal 제외

### 자동 진행

- prepared → canary_running
- canary 10/10 → normal_running
- canary 실패 → 중단
- normal 성공 → 다음 청크
- normal 마지막 성공 → normal_succeeded
- uncertain → 결과 조회만, 새 dispatch 0
- 브라우저 요청 없이 Cron만으로 진행

### 회귀

- 기존 manual Bulk 흐름 유지
- 기존 retry/pause/resume 유지
- Stage 6 report/audit/archive 유지
- 실제 GitHub Actions와 Shopling 쓰기는 테스트에서 금지
- migration 001~005 변경 없음

필수 실행:

- 신규 focused tests
- 기존 Bulk 전체 focused tests
- npm run lint
- npm run build
- npx tsc --noEmit
- git diff --check

---

## 12. 배포 순서

1. PR 코드·테스트·Preview 검수
2. Production Vercel에 `CRON_SECRET` 생성
3. Supabase migration 006 수동 적용
4. DB 객체 확인
5. PR merge
6. Production 배포 및 Cron 등록 확인
7. 안전 상품 61개 one-click 회귀 테스트
8. 브라우저 종료 후 자동 진행 확인
9. 200~500개 실제 테스트
10. 수천 개 실운영은 단계적으로 500 → 1,000 → 3,000 순서로 확대

---

## 13. 최종 통과 기준

### 엔진 안정성 100/100

- 안전 상품 200~500개 실제 실행 성공
- 누락 0
- 중복 0
- 실제 가격 표본 일치

### 운영 사용성·무인 자동화 100/100

- 사용자는 입력 후 버튼 한 번만 클릭
- 첫 10개 시험 후 자동 진행
- 브라우저를 닫아도 완료
- 실패·uncertain 자동 중단
- 다음 날 상태 복구
- 쉬운 용어와 간단 설명
- 고급 기능은 별도 화면에 보존
