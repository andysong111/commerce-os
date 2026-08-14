# Shopling category accuracy learning v1

- 승인 이력 → 유사 상품 category prior
- 실제 후보 leaf 단계 항상 검증
- 네이버는 후보 1~3 재랭킹 용도로만 사용
- 텍스트 신뢰도 55% 미만 + 대표이미지 URL 존재 시 이미지 fallback
- 승인 결과 Top-1 / Top-3 정확도 측정
- 검토함 수동 대→중→소→세 카테고리 선택
- 실제 카탈로그 전체 경로 복붙 검증 및 승인

안전 원칙: 실제 Shopling snapshot에 존재하는 경로만 자동/수동 후보로 사용한다.
