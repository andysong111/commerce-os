# 상세페이지 내부 원가 원장

## 목적

상세페이지 스튜디오가 성공적으로 받은 OpenAI 응답을 호출 단위로 기록하고, OPS Center의 관리자 전용 화면에서 실행별 내부 추정 원가를 확인한다. 사용자 판매가격·크레딧과는 분리한다.

## 1. 데이터베이스

Supabase SQL Editor에서 다음 파일을 순서대로 한 번씩 실행한다.

1. `supabase/migrations/202607290001_detail_page_cost_events.sql`
2. `supabase/migrations/202607300001_detail_page_cost_run_summary.sql`

첫 번째 파일은 원장 테이블과 누적 요약 함수를 만들고, 두 번째 파일은 최근 30개 실행의 전체 호출을 정확히 합산하는 함수를 만든다. 테이블과 함수는 `service_role`만 사용할 수 있다. `anon`과 `authenticated`에는 정책과 권한을 부여하지 않는다.

## 2. 상세페이지 스튜디오 환경변수

OPS Center가 사용하는 동일한 Supabase 프로젝트의 값을 상세페이지 스튜디오 Vercel Production 환경에 추가한다.

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SECRET_KEY` 또는 레거시 `SUPABASE_SERVICE_ROLE_KEY`

Secret은 서버에서만 읽으며 브라우저로 전달하지 않는다. 원장 연결이 없거나 기록에 실패해도 상세페이지 생성은 계속된다. 원장 쓰기는 1.5초 안에 완료되지 않으면 중단해 사용자 생성 요청을 지연시키지 않는다.

## 3. OPS Center 관리자 설정

기본 접근 이메일은 `andy0801a@gmail.com`이다. 필요할 때만 다음 환경변수로 변경한다.

- `DETAIL_PAGE_COST_ADMIN_EMAIL`
- `DETAIL_PAGE_USD_KRW_RATE` (기본 `1400`)

다른 로그인 계정에는 대시보드 카드와 사이드바 메뉴가 표시되지 않으며, `/detail-page-costs` 직접 접근도 404를 받는다.

## 4. 원가 범위

기록 대상:

- 상품 분석 (`gpt-5.6-terra`)
- 이미지 생성과 자동보정 (`gpt-image-2`)
- 시각 검수와 검수 재시도 (`gpt-5-mini`)
- 랜덤 발송 색상 검수 (`gpt-5-mini`)

기록하지 않는 데이터:

- 프롬프트
- 공급처 원문
- 원본 이미지와 생성 이미지
- 사용자 비밀번호나 세션

가격 버전은 이벤트에 고정 저장한다. 알 수 없는 모델은 비용을 임의 추정하지 않고 `unpriced`로 표시한다.
