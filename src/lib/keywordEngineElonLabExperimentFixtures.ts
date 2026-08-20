import type {
  KeywordElonIdentity,
  KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";

export type KeywordElonExperimentFixture = {
  id: string;
  label: string;
  source: KeywordElonSourceDraft;
  identity: KeywordElonIdentity;
  sourceMode: "original" | "step1-derived";
  notes: string[];
};

function derivedFixture(id: string, identity: KeywordElonIdentity, notes: string[] = []): KeywordElonExperimentFixture {
  return {
    id,
    label: identity.koreanProductIdentity,
    sourceMode: "step1-derived",
    source: {
      url: `experiment://step1-fixed/${id}`,
      offerId: "",
      autoStatus: "partial",
      chineseTitle: identity.koreanProductIdentity,
      optionText: [
        ...identity.conditionalSeeds,
        ...identity.designShapeModifiers,
        ...identity.specAttributes,
      ].join(" / "),
      supportingText: [
        identity.identityAnchor,
        ...identity.functionModifiers,
        ...identity.specAttributes,
      ].join(" · "),
      warnings: ["EXPERIMENT_SOURCE_DERIVED_FROM_APPROVED_STEP1"],
      collectedAt: "",
    },
    identity,
    notes: [
      "사용자가 승인한 STEP 1 결과를 고정한 실험 샘플",
      "중국 원문 대신 승인된 STEP 1 정체성·Seed·기능·스펙으로 실험용 source를 재구성",
      "목표는 STEP 2/3 점수 조합의 상대 비교와 범용 기준 탐색",
      ...notes,
    ],
  };
}

const noseTapeIdentity: KeywordElonIdentity = {
  koreanProductIdentity: "코 성형 테이프(코 모양 보정 패치)",
  coreProduct: "코 성형 테이프",
  identityAnchor: "콧볼·콧구멍 보정용 코 테이프",
  primarySeeds: ["코 성형 테이프", "콧볼·콧구멍 보정용 코 테이프", "코 모양 교정 패치", "콧볼 축소 테이프"],
  conditionalSeeds: ["조절형 코 테이프", "메모리 소재 코 테이프", "가위로 재단 가능한 코 테이프", "일회용 코 패치"],
  functionModifiers: ["콧볼 축소", "콧구멍 교정", "코 모양 보정", "콧대·코끝 보정", "피부 가림", "커버링", "모양 유지"],
  designShapeModifiers: ["슬림 스트립형", "61×11mm", "투명 스트립", "단색 스트립", "스티커형", "붙이는 패치"],
  specAttributes: ["61×11 mm", "일회용 제품", "통용 일반 사용", "중국 광동성 원산지", "사용자 재단 가능"],
  variantNoise: ["색상·패턴", "포장 단위", "단색·혼색", "투명박스·컬러박스", "박스 유무"],
  confidence: 0.88,
  reasoning: "코 모양 보정용 일회용 테이프·패치로 확정한 사용자 승인 STEP 1 결과.",
  model: "step1-fixed-user-approved",
};

const shoehornIdentity: KeywordElonIdentity = {
  koreanProductIdentity: "플라스틱 휴대용 신발주걱 (직손잡이, 15cm)",
  coreProduct: "신발주걱",
  identityAnchor: "플라스틱 휴대용 신발주걱(직선 손잡이·15cm)",
  primarySeeds: ["신발주걱", "플라스틱 휴대용 신발주걱(직선 손잡이·15cm)", "플라스틱 신발주걱", "휴대용 신발주걱 15cm", "직손잡이 신발주걱"],
  conditionalSeeds: ["내측 홈(안쪽 홈) 있는 신발주걱", "걸이구멍(걸이용) 있는 휴대용 신발주걱", "세트 구성 신발주걱(2~7개)"],
  functionModifiers: ["신발 착용 보조", "신발 신고 벗기 보조", "뒤축 보호", "걸이 수납 기능", "슬라이딩을 돕는 내측 홈"],
  designShapeModifiers: ["직선 직손잡이 디자인", "짧은 길이 휴대용", "슬림 평면형"],
  specAttributes: ["재질 플라스틱", "길이 약 15cm", "무게 약 12g"],
  variantNoise: ["색상", "포장형태", "세트 수량 2~7개"],
  confidence: 0.90,
  reasoning: "핵심 상품은 플라스틱 15cm 직선 손잡이형 휴대용 신발주걱이며 색상·포장·세트수는 변형 Noise로 분리.",
  model: "step1-fixed-user-approved",
};

const spongeBrushIdentity: KeywordElonIdentity = {
  koreanProductIdentity: "스펀지 청소브러시",
  coreProduct: "스펀지 청소브러시",
  identityAnchor: "손잡이형 스펀지 청소브러시 (주방·욕조·타일용)",
  primarySeeds: ["스펀지 청소브러시", "손잡이형 스펀지 청소브러시", "주방용 스펀지 브러시", "냄비 그릇 세척 스펀지", "욕조 타일용 스펀지 청소브러시"],
  conditionalSeeds: ["두꺼운 섬유 패드형 스펀지 브러시", "습식 건식 겸용 스펀지 브러시", "손잡이 패드 일체형 청소 스펀지"],
  functionModifiers: ["오염 기름때 제거", "냄비 그릇 세척", "욕조 타일 표면 청소"],
  designShapeModifiers: ["손잡이형", "패드형 스펀지 헤드"],
  specAttributes: ["재질 해면 스펀지", "습식 건식 겸용", "외박스 300개"],
  variantNoise: ["색상", "외박스 규격", "상품코드", "중량 표기", "무역 플랫폼 판매지역 정보"],
  confidence: 0.88,
  reasoning: "해면 재질 손잡이형 청소브러시로 주방·욕실 표면 세척 용도가 명확한 사용자 승인 STEP 1 결과.",
  model: "step1-fixed-user-approved",
};

const thimbleIdentity: KeywordElonIdentity = {
  koreanProductIdentity: "조절식 금속 골무(바느질·자수용 바늘 누르기)",
  coreProduct: "골무",
  identityAnchor: "조절식 금속 바느질 골무",
  primarySeeds: ["골무", "조절식 금속 바느질 골무", "조절식 골무", "금속 골무", "바느질 골무", "자수용 골무"],
  conditionalSeeds: ["반지형 링타입 골무", "압침기 바늘 누르기 기능 골무", "복고풍 빈티지 디자인 골무"],
  functionModifiers: ["사이즈 조절", "바늘 누름 압착", "바늘 밀기", "손가락 보호", "금속 재질"],
  designShapeModifiers: ["반지형 오픈형 링 타입", "복고풍 빈티지 스타일"],
  specAttributes: ["재질 금속", "사이즈 S M", "단중량 약 7g", "색상별 100개 배수", "10000개 박스포장"],
  variantNoise: ["색상", "색상별 출고 단위", "도매 대량 포장"],
  confidence: 0.87,
  reasoning: "조절 가능한 링형 금속 골무로 바느질·자수 시 바늘을 밀고 손가락을 보호하는 용도.",
  model: "step1-fixed-user-approved",
};

const openTopHatIdentity: KeywordElonIdentity = {
  koreanProductIdentity: "오픈탑(무탑) 접이식 챙모자(자외선 차단 썬햇)",
  coreProduct: "챙모자",
  identityAnchor: "오픈탑(머리 위가 트인) 접이식 자외선 차단 챙모자",
  primarySeeds: ["챙모자", "오픈탑 접이식 자외선 차단 챙모자", "오픈탑 챙모자", "오픈탑 썬햇 자외선차단", "접이식 챙모자", "넓은챙 썬햇"],
  conditionalSeeds: ["레이스 리본 오픈탑 챙모자", "스트로우 밀짚 접이식 챙모자", "아이스실크 쿨원단 오픈탑 챙모자", "블랙코팅 오픈탑 챙모자", "헤어밴드형 오픈탑 챙모자"],
  functionModifiers: ["자외선 차단", "통기성", "접이식 휴대형", "조절 가능", "UPF50+ 상품표기"],
  designShapeModifiers: ["오픈탑 무탑 디자인", "넓은 챙", "스트로우 밀짚 스타일", "조개형 베이비쉘 형태", "헤어밴드형 스타일"],
  specAttributes: ["주원단 폴리에스터", "주원단 함량 51%-60%", "블랙 코팅 안감", "접이식 가능", "조절 가능", "중량 약 200g", "사계절"],
  variantNoise: ["색상", "스타일별 이름 코드", "최소주문수량", "가격", "재고", "할인 쿠폰"],
  confidence: 0.90,
  reasoning: "머리 윗부분이 트인 오픈탑 넓은챙 자외선 차단 모자로 기능·원단·접이식 속성을 분리한 STEP 1 결과.",
  model: "step1-fixed-user-approved",
};

const pimpleExtractorIdentity: KeywordElonIdentity = {
  koreanProductIdentity: "스테인리스 여드름 압출기(핀셋·압출바늘 포함) 세트",
  coreProduct: "여드름 압출기",
  identityAnchor: "스테인리스 여드름 압출기 세트(핀셋·압출용 바늘 포함)",
  primarySeeds: ["여드름 압출기", "스테인리스 여드름 압출기 세트", "블랙헤드 압출기", "여드름 압출용 핀셋", "여드름 압출 바늘", "스테인리스 압출기 세트"],
  conditionalSeeds: ["직형 휘형 곡형 핀셋 세트", "U자형 갈고리형 삼각형 바늘 포함 세트", "더블헤드 압출 바늘 세트", "핀셋 여러종류 바늘 케이스 구성"],
  functionModifiers: ["블랙헤드 여드름 압출", "모공 내부 압출", "피지 제거", "방녹 위생적 스테인리스"],
  designShapeModifiers: ["직형 곡형 핀셋", "U형 갈고리형 삼각형 바늘", "초날카로운 팁", "더블헤드 압출팁"],
  specAttributes: ["재질 스테인리스", "핀셋 및 다양한 압출용 바늘 구성", "4.0 5.0 등 규격", "미용 도구"],
  variantNoise: ["플라스틱 케이스 철제 케이스", "단품 3개 세트 수량", "옵션 번호 모델명"],
  confidence: 0.87,
  reasoning: "스테인리스 핀셋·압출바늘로 구성된 여드름·블랙헤드 압출 미용도구 세트.",
  model: "step1-fixed-user-approved",
};

const hikingShoesIdentity: KeywordElonIdentity = {
  koreanProductIdentity: "남성용 가을용 아웃도어 저(로우)컷 캐주얼 등산·운동화(경량·소프트솔)",
  coreProduct: "운동화",
  identityAnchor: "남성용 저컷 아웃도어·등산 캐주얼 운동화",
  primarySeeds: ["운동화", "남성용 저컷 아웃도어 등산 캐주얼 운동화", "남성 아웃도어 운동화", "남성 등산화 로우컷", "남성 경량 트레킹화 소프트솔", "남성 가을용 캐주얼 운동화"],
  conditionalSeeds: ["경량 등산화", "소프트솔 쿠션 운동화", "로우탑 스니커즈형 아웃도어화", "가을 아웃도어 캐주얼 슈즈"],
  functionModifiers: ["경량", "소프트솔 쿠션창", "아웃도어 등산 사용성", "캐주얼 스타일"],
  designShapeModifiers: ["저컷 로우컷", "스니커즈형 디자인", "트레킹 아웃도어 외형"],
  specAttributes: ["가을용", "남성", "소프트솔", "저컷 로우컷", "아웃도어 등산 캐주얼"],
  variantNoise: ["도매 판매형태", "스타일 UI 코드", "상품 상태 안내문구"],
  confidence: 0.86,
  reasoning: "남성용 가을 아웃도어·등산 용도의 저컷 캐주얼 운동화로 경량·소프트솔 속성을 포함.",
  model: "step1-fixed-user-approved",
};

const drawerDeskIdentity: KeywordElonIdentity = {
  koreanProductIdentity: "서랍형 데스크·화장대 수납함 (플라스틱, 적층형)",
  coreProduct: "서랍형 수납함",
  identityAnchor: "데스크·화장대용 서랍형 수납함",
  primarySeeds: ["서랍형 수납함", "데스크 화장대용 서랍형 수납함", "데스크 수납함", "화장대 화장품 정리함", "플라스틱 서랍 수납함"],
  conditionalSeeds: ["적층 스택 가능 모듈식 조합 수납함", "1단 2단 3단 서랍형", "문구 화장품 겸용 탁상 정리함"],
  functionModifiers: ["탁상 정리 수납", "화장품 정리", "문구 정리"],
  designShapeModifiers: ["서랍형", "적층식 스택 가능", "모듈식 자유 조합"],
  specAttributes: ["플라스틱 HIPS PS PE", "서랍 pull-out", "문구 화장품 수납", "플라스틱 신소재 100%"],
  variantNoise: ["색상", "포장 최소주문 박스 단위 36개"],
  confidence: 0.89,
  reasoning: "데스크·화장대 위 문구·화장품을 정리하는 플라스틱 적층형 서랍 수납함.",
  model: "step1-fixed-user-approved",
};

const drawerModuleIdentity: KeywordElonIdentity = {
  koreanProductIdentity: "서랍형 수납함",
  coreProduct: "서랍형 수납함",
  identityAnchor: "데스크용 서랍식 수납함(화장품·문구용, 다층·적층 가능)",
  primarySeeds: ["서랍형 수납함", "데스크용 서랍식 수납함", "데스크용 서랍형 수납함", "화장품 서랍 수납함", "적층형 다층 서랍 수납함"],
  conditionalSeeds: ["1단 2단 3단 서랍형", "모듈형 중첩 적층 조합 가능", "추출식 슬라이드 서랍 방식", "플라스틱 재질 수납함 HIPS PS PE"],
  functionModifiers: ["데스크 위 정리 정돈", "화장품 보관", "문구 보관 오거나이저", "소형 서랍 수납"],
  designShapeModifiers: ["서랍식 추출 디자인", "다층 1단 2단 3단 구조", "적층 스택형 모듈"],
  specAttributes: ["플라스틱 HIPS PS PE", "신소재 비율 100%", "책상용 화장품 문구 수납", "도매용 박스 단위 36개"],
  variantNoise: ["색상", "색상별 1단 2단 3단 가격차이", "도매 박스 단위", "플랫폼 배송 프로모션 문구"],
  confidence: 0.90,
  reasoning: "책상 위 화장품·문구 정리를 위한 모듈형 다층 플라스틱 서랍 수납함.",
  model: "step1-fixed-user-approved",
};

const eggPiercerIdentity: KeywordElonIdentity = {
  koreanProductIdentity: "계란 천공기 (계란 구멍 뚫는 펀칭 도구)",
  coreProduct: "계란 천공기",
  identityAnchor: "펀칭 계란 구멍 뚫기 도구",
  primarySeeds: ["계란 천공기", "펀칭 계란 구멍 뚫기 도구", "삶은계란 구멍 뚫는 도구", "계란 찜용 구멍뚫이", "오리알 구멍뚫기 도구"],
  conditionalSeeds: ["자석부착 계란천공기", "펀칭 바늘형 계란천공기", "휴대용 미니 계란 구멍뚫이"],
  functionModifiers: ["삶을 때 껍질 파열 방지", "찜 스팀용 구멍 뚫기", "오리알 사용 가능", "계란 표면 작은 구멍"],
  designShapeModifiers: ["바늘형", "자석 흡착식", "미니 휴대용", "일본식 스타일"],
  specAttributes: ["재질 PP", "OPP 비닐봉투 포장", "단중량 약 20g", "크기 약 5.5×5.5×2cm", "자석 포함"],
  variantNoise: ["색상 흰색", "판매 플랫폼 옵션", "주요 판매 지역", "스타일 표기", "포장 단가 최소주문수량"],
  confidence: 0.91,
  reasoning: "계란을 삶거나 찔 때 표면에 작은 구멍을 내는 바늘형 펀칭 도구로 자석 흡착 기능이 있는 STEP 1 결과.",
  model: "step1-fixed-user-approved",
};

const fixtures = [
  derivedFixture("nose-tape-step1-v1", noseTapeIdentity, ["위험어 Gate 검증에 유용한 미용·신체보정 상품"]),
  derivedFixture("shoehorn-step1-v1", shoehornIdentity),
  derivedFixture("sponge-brush-step1-v1", spongeBrushIdentity),
  derivedFixture("adjustable-thimble-step1-v1", thimbleIdentity),
  derivedFixture("open-top-sunhat-step1-v1", openTopHatIdentity),
  derivedFixture("pimple-extractor-step1-v1", pimpleExtractorIdentity, ["위험어 Gate 민감도 검증용 미용 도구"]),
  derivedFixture("mens-hiking-shoes-step1-v1", hikingShoesIdentity),
  derivedFixture("drawer-desk-step1-v1", drawerDeskIdentity),
  derivedFixture("drawer-module-step1-v1", drawerModuleIdentity, ["유사 상품 간 점수 안정성 비교용"]),
  derivedFixture("egg-piercer-step1-v1", eggPiercerIdentity),
];

export const KEYWORD_ELON_EXPERIMENT_FIXTURES: Record<string, KeywordElonExperimentFixture> = Object.fromEntries(
  fixtures.map((fixture) => [fixture.id, fixture]),
);

export const KEYWORD_ELON_EXPERIMENT_FIXTURE_IDS = fixtures.map((fixture) => fixture.id);

export function getKeywordElonExperimentFixture(id: string) {
  return KEYWORD_ELON_EXPERIMENT_FIXTURES[id] ?? null;
}

export function keywordElonExperimentFixtureSourceReady(fixture: KeywordElonExperimentFixture) {
  return Boolean(
    fixture.identity.coreProduct.trim()
    && fixture.identity.primarySeeds.length
    && fixture.source.chineseTitle.trim()
    && fixture.source.optionText.trim(),
  );
}
