# 20260818 키워드엔진 체크포인트

- Checkpoint branch: `checkpoint/20260818-keyword-engine`
- Frozen commit: `2457071d0347285ed7cc2433c05a1e99640169e6`
- Purpose: 수요 중심 STEP 2 개편 전, 1688 링크 → STEP 1 상품 정체성/Seed → STEP 2 후보 발굴/SearchAd/AI 점수화 → FINAL 상품명·키워드까지 실제 완주한 상태를 보존합니다.

## 보존된 핵심 동작

1. 1688 전용 브라우저 수집기로 중국 상품명·옵션명·옵션값 수집
2. 판매자 모델명/goods_key를 사용하지 않고 1688 원본만으로 상품 정체성과 Seed 확정
3. AI + SearchAd 기반 후보 대량 발굴
4. 브라우저 분할 점수화 및 12→6→3 적응형 timeout 축소
5. localStorage 결과 보존·재개
6. 품질 커트라인 기본 70점, 최소 10개·상한 없음
7. 고득점 키워드 기반 상품명 생성
8. Shopling/Supabase 쓰기 없음

이 체크포인트 이후 변경은 `agent/keyword-lab-demand-first-v3`에서 시작합니다.
