# OPS Center AI 사용상담원

## 목적

OPS Center 화면 우측 하단에서 현재 화면의 사용법, 버튼 의미, 입력 순서, 오류 확인법과 실행 전 주의사항만 안내하는 읽기 전용 상담원입니다.

상담원은 신규 개발, 코드 수정, GitHub 작업, 배포, 데이터베이스 쓰기, 샵플링 변경, 1688 주문·결제, 가격·재고 변경 도구를 갖지 않습니다.

## 답변 근거

- 현재 브라우저 경로와 화면 제목
- 배포된 OPS Center의 `extendedModuleRegistry`
- `src/lib/opsAiKnowledge.ts`에 정의된 운영 가이드
- `VERCEL_GIT_COMMIT_SHA` 또는 `NEXT_PUBLIC_OPS_BUILD_SHA`로 표시되는 운영 빌드 버전

기능을 수정할 때는 모듈 레지스트리와 해당 운영 가이드를 함께 갱신합니다. 배포 후 상담원은 새 빌드의 지식만 사용합니다.

## 환경변수

필수:

- `OPS_AI_HELP_OPENAI_API_KEY` 또는 기존 `OPENAI_API_KEY`

권장:

- `OPS_AI_HELP_MODEL=gpt-5-mini`
- `OPS_AI_HELP_ALLOWED_EMAILS` 또는 기존 `OPS_OWNER_EMAILS`
- `OPS_AI_HELP_ENABLED=1`

선택:

- `OPS_AI_HELP_RATE_MAX=30`
- `OPS_AI_HELP_RATE_WINDOW_MS=600000`
- `OPS_AI_HELP_CACHE_TTL_MS=21600000`

로그인 임시 해제 상태에서는 기존 `OPS_LOGIN_BYPASS_EMAIL` 운영자만 사용하며, 같은 OPS Center 출처의 브라우저 요청만 허용합니다.

## 비용 제어

- 질문과 현재 화면에 관련된 근거 최대 7개만 모델에 전달합니다.
- 동일 질문·동일 화면·동일 배포 버전은 서버 메모리 캐시에서 재사용합니다.
- 최근 대화는 최대 6개, 질문은 최대 1,000자로 제한합니다.
- 응답은 최대 900 출력 토큰으로 제한합니다.
- OpenAI 요청에는 `store: false`를 사용합니다.

## 운영 점검

1. 화면 우측 하단에 `사용법 물어보기` 버튼이 표시되는지 확인합니다.
2. `이 화면은 무엇을 하는 곳이야?` 질문이 현재 화면 기준으로 답변되는지 확인합니다.
3. `이 기능을 개발해줘`가 범위 밖 요청으로 차단되는지 확인합니다.
4. 같은 질문을 다시 했을 때 `반복질문 캐시 사용`이 표시되는지 확인합니다.
5. 답변 하단의 근거 버전이 현재 배포 커밋과 일치하는지 확인합니다.
