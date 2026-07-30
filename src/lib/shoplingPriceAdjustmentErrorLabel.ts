const ERROR_MESSAGES: Array<[RegExp, string]> = [
  [
    /option amount contains a non-integer value/i,
    "옵션 추가금에 숫자가 아닌 값이 포함되어 있어 가격을 변경하지 않았습니다. 샵플링 옵션 추가금을 숫자로 정리한 뒤 다시 실행하세요.",
  ],
  [
    /negative option amount is not supported/i,
    "옵션 추가금에 음수 금액이 있어 가격을 변경하지 않았습니다. 음수 옵션 추가금을 0원 이상으로 수정한 뒤 다시 실행하세요.",
  ],
  [
    /goods_key was not returned by Shopling gather API/i,
    "샵플링 조회 결과에서 상품을 찾지 못했습니다. 삭제·종료된 상품인지 확인하고, 정상 상품이라면 잠시 후 다시 조회하세요.",
  ],
  [
    /current Shopling sale_price is missing or zero/i,
    "현재 판매가가 없거나 0원이라 가격을 변경할 수 없습니다. 샵플링 기본 판매가를 확인하세요.",
  ],
  [
    /option amount array is invalid/i,
    "옵션 추가금 형식이 올바르지 않아 가격을 변경하지 않았습니다. 샵플링 옵션 추가금을 숫자로 정리하세요.",
  ],
  [
    /option signature missing/i,
    "옵션 정보를 정상적으로 확인하지 못해 가격을 변경하지 않았습니다. 샵플링 옵션 구성을 확인하세요.",
  ],
  [
    /Shopling current price or option data could not be planned/i,
    "현재 판매가 또는 옵션 정보를 정상적으로 읽지 못해 가격을 변경하지 않았습니다. 샵플링 상품 설정을 확인하세요.",
  ],
];

export function humanizeShoplingPriceAdjustmentError(value: unknown) {
  const source = typeof value === "string" ? value.trim() : "";
  if (!source) {
    return "현재 판매가 또는 옵션 정보를 정상적으로 읽지 못해 가격을 변경하지 않았습니다.";
  }

  const mismatch = source.match(
    /option combination count mismatch:\s*expected=(\d+)\s+amounts=(\d+)/i,
  );
  if (mismatch) {
    return `옵션 조합은 ${mismatch[1]}개인데 옵션 추가금은 ${mismatch[2]}개만 있어 서로 맞지 않습니다. 샵플링 옵션 구성을 확인하세요.`;
  }

  for (const [pattern, message] of ERROR_MESSAGES) {
    if (pattern.test(source)) return message;
  }

  if (/[가-힣]/.test(source)) return source;

  return "현재 판매가 또는 옵션 정보가 비정상이라 가격을 변경하지 않았습니다. 샵플링 상품의 판매가와 옵션 설정을 확인하세요.";
}
