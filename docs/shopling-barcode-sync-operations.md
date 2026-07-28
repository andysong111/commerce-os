# 샵플링 옵션 바코드 동기화 운영 메모

## OPS Center 환경변수

Production 환경에 다음을 설정합니다.

```text
SHOPLING_BARCODE_SYNC_ENABLED=1
SHOPLING_BARCODE_SYNC_ALLOWED_EMAILS=<OPS Center 로그인 이메일>
```

`OPS_OWNER_EMAILS`가 이미 설정되어 있다면 `SHOPLING_BARCODE_SYNC_ALLOWED_EMAILS` 대신 사용할 수 있습니다.

GitHub Actions 토큰은 다음 순서로 사용합니다.

1. `SHOPLING_BARCODE_SYNC_ACTIONS_TOKEN`
2. `GITHUB_ACTIONS_TOKEN`
3. 기존 `SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN`

기존 가격설정 실행기의 토큰이 새 비공개 저장소에도 Actions 권한을 갖고 있다면 별도 토큰을 추가하지 않아도 됩니다.

선택 설정은 기본값을 그대로 사용할 수 있습니다.

```text
SHOPLING_BARCODE_SYNC_REPO=andysong111/commerce-os-shopling-barcode-sync-11
SHOPLING_BARCODE_SYNC_WORKFLOW=shopling-barcode-sync.yml
SHOPLING_BARCODE_SYNC_REF=main
```

## 외부 실행 저장소

`andysong111/commerce-os-shopling-barcode-sync-11`의 Actions Secrets:

```text
SHOPLING_LOGIN_ID
SHOPLING_COMPANY_ID
SHOPLING_API_AUTH_KEY
SHOPLING_ENABLE_WRITE
```

- 전체 상품 점검: `SHOPLING_ENABLE_WRITE=false`
- 10개 테스트 및 전체 반영: `SHOPLING_ENABLE_WRITE=true`
- 전수작업 완료 직후: 다시 `SHOPLING_ENABLE_WRITE=false`

## 실행 순서

1. 전체 상품 점검
2. 결과에서 구조 차단 0개와 조회 오류 0개 확인
3. `SHOPLING_ENABLE_WRITE=true`
4. 10개 테스트 반영
5. 10개 테스트가 끝나면 **현재 실행 결과 확인**을 눌러 성공 10·실패 0·불명확 0을 확인
6. 결과 확인이 성공하면 서버가 7일 유효한 HttpOnly 테스트 통과 증명을 발급
7. 오래된 순 1,000개 또는 2,000개 반영
8. 남은 작업이 있으면 같은 버튼을 다시 실행
9. 최종 점검 후 `SHOPLING_ENABLE_WRITE=false`

전체 반영 API는 테스트 통과 증명이 없거나, 검증된 10개 상품 중 하나라도 실패한 경우 409로 차단됩니다. 브라우저에서 값을 조작하더라도 서버가 해당 GitHub Actions 결과를 다시 조회해 검증합니다.

실패·불명확 결과가 발생하면 후속 배치는 엔진에서 중단됩니다. 무조건 전체 재실행하지 말고 실패 항목만 재시도합니다.
