# Shopling Market Canary v0.1.2

Evidence from the operator's successful manual path:

1. Product list / product edit screen contains the dedicated `쇼핑몰 미등록 검색` section and `쇼핑몰 상품등록하기` button.
2. Shopling opens `/prodlinkage/goods_mallReg_idChoice.phtml`; saved search `도매1` selects the intended mall IDs, then the top `선택` button continues.
3. Shopling opens `/prodlinkage/goods_mallReg_preProdChoice.phtml`; saved search `도매1` applies the linkage settings.
4. Expected linkage selections are: 쇼핑몰별 상품판매가, 상품설명, 쇼핑몰별 상품명, 검색어, 옵션명, 매핑된 카테고리로 전송, and when mapping is absent use the Shopling default category.
5. `상품등록송신` is clicked only after the Commerce OS durable submit lock succeeds.

The v0.1.2 Canary no longer creates its own Chrome worker window and no longer depends on the shared batch market pipeline. It drives the currently open Shopling product-list frame and follows the popup windows created by Shopling itself.
