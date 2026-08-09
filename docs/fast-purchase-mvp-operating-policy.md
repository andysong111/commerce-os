# 빠른 발주안 MVP 운영정책

목표는 완벽한 재고확정을 기다리지 않고 현재 증거만으로 오늘 사용할 수 있는 보수적 발주 판단을 제공하는 것이다.

- DRAFT_EVIDENCE_READY: 추정재고 밴드 양끝 모두 발주 방향이면 두 권장수량 중 작은 값만 발주 검토수량으로 사용한다.
- HOLD_EVIDENCE_READY: 양끝 모두 보류면 오늘 발주하지 않는다.
- INVENTORY_SENSITIVE: 재고 가정에 따라 발주/보류가 뒤집히므로 수동 검토로 남기고 수량은 0으로 둔다.
- INSUFFICIENT_EVIDENCE: 데이터 보류로 남긴다.

이 MVP는 Product Master 재고를 VERIFIED로 승격하지 않는다. 중국 주문 Draft, 결제, 자동발주, 재고 write는 하지 않는다. 실제 입고와 품절 0-reset이 쌓이면서 이후 정확도를 높인다.
