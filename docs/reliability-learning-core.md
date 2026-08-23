# Commerce OS Reliability & Learning Core

## 목적

Commerce OS와 AI-Saurus의 실행 결과를 개인정보 최소화 이벤트로 자동 수집하고, 반복 오류를 다음 운영 자산으로 전환한다.

1. 중복 제거된 incident
2. 위험등급 기반 recovery queue
3. OpenAI 증거 분석이 포함된 learning case
4. GitHub CI에 구현할 regression case

이 시스템은 원시 로그 저장소가 아니다. 동일 오류가 두 번 이상 확인되었을 때만 학습 후보와 회귀 테스트 제안을 생성한다.

## 현재 자동 흡수 대상

### Commerce OS

- `commerce_operation_runs`
- `keyword_engine_elon_lab_stage_results`
- `product_launch_upload_jobs`
- `seo_title_dispatches`

이 네 데이터 소스는 Supabase trigger를 통해 별도 애플리케이션 코드 없이 reliability core로 들어온다.

### AI-Saurus

- `saas_generation_jobs`의 상태·단계·오류 코드·재시도·품질 신호·크레딧 수치
- AI-Saurus Supabase outbox에 먼저 영구 저장
- Vercel Cron이 OPS CENTER 수집 API로 batch 전송
- 전송 실패 시 지수 backoff, 10회 실패 시 dead letter

## 개인정보 최소화

기본 수집 금지 항목:

- 사용자 ID와 이메일
- 상품명과 고객 원문
- 1688 및 외부 원본 링크
- 프롬프트
- 이미지와 storage path
- API 키, Authorization, cookie, token
- raw input/output payload

허용 항목:

- run ID와 correlation ID
- 기능·단계·상태
- 오류 코드와 redacted 오류 메시지
- 실행시간·재시도·복구 결과
- 품질 수치와 비용 카운터
- 코드·프롬프트·엔진 버전 식별자

## 학습 루프

1. 모든 실행을 idempotent event로 수집한다.
2. `source_system + engine + signature` 기준으로 incident를 집계한다.
3. 동일 incident가 두 번 이상 발생하면 learning candidate와 regression proposal을 생성한다.
4. learning candidate를 durable analysis queue에 넣는다.
5. OpenAI Responses API가 최근 비식별 증거 최대 5건만 읽는다.
6. 원인·해결·예방 규칙·보호 불변조건·회귀 테스트 제목을 strict JSON으로 저장한다.
7. 분석은 자동 승인, 코드 변경, PR 생성, 병합 또는 배포를 수행하지 않는다.
8. 실제 회귀 테스트가 구현되고 CI를 통과한 경우에만 regression state를 상향한다.

## 자동 행동 안전 경계

허용 가능한 저위험 행동:

- retry
- resume_checkpoint
- revalidate
- quarantine

항상 사람 또는 별도 승인 계층이 필요한 영역:

- 가격과 재고
- 주문과 결제
- 사용자 권한과 인증
- 비밀키와 환경변수
- DB 스키마
- 대량 데이터 변경
- 프로덕션 코드 변경, PR 병합, 배포

위험등급이 `high` 또는 `critical`, 원인이 `unknown`, 분석 신뢰도가 0.6 미만이면 `safe_automatic_action`은 강제로 `none`이 된다.

## 서버 환경변수

### OPS CENTER

- `COMMERCE_OS_RELIABILITY_INGEST_SECRET`
  - AI-Saurus와 공유하는 긴 랜덤 비밀키
  - 수집 API는 값이 없으면 503, 잘못된 값이면 401로 닫힌다.
- `CRON_SECRET`
  - 기존 Vercel Cron 인증값 사용
- `RELIABILITY_OPENAI_API_KEY` 선택
  - 없으면 `OPENAI_API_KEY`, 그다음 `OPS_AI_HELP_OPENAI_API_KEY`를 사용한다.
- `RELIABILITY_OPENAI_MODEL` 선택
  - 없으면 `OPENAI_MODEL`, 최종 기본값은 `gpt-5-mini`

### AI-Saurus

- `OPS_CENTER_RELIABILITY_INGEST_URL`
  - 정확히 `/api/integrations/reliability/events`로 끝나는 HTTPS URL
- `OPS_CENTER_RELIABILITY_INGEST_SECRET`
  - OPS CENTER의 ingest secret과 동일한 값
- `CRON_SECRET`
  - AI-Saurus outbox Cron 인증값

비밀값은 GitHub, Notion, 로그에 평문으로 저장하지 않는다.

## 배포 완료 기준

- OPS CENTER와 AI-Saurus PR의 전용 회귀 테스트 및 기존 전체 CI 통과
- 두 Vercel 프로젝트에 서버 환경변수 설정
- production 배포
- AI-Saurus outbox backlog가 `sent`로 전환
- OPS CENTER `/reliability`에서 AI-Saurus event가 표시
- 실제 상세페이지 생성 1건으로 job → outbox → ingest → incident/learning 판단 경로 확인
- 고위험 action이 approval 또는 none으로 격리되는지 확인
