import type {
  KeywordElonIdentity,
  KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";

export type KeywordElonExperimentFixture = {
  id: string;
  label: string;
  source: KeywordElonSourceDraft;
  identity: KeywordElonIdentity;
  notes: string[];
};

const noseTapeFixture: KeywordElonExperimentFixture = {
  id: "nose-tape-step1-v1",
  label: "코 성형 테이프(코 모양 보정 패치)",
  source: {
    url: "experiment://step1-fixed/nose-tape-step1-v1",
    offerId: "",
    autoStatus: "partial",
    chineseTitle: "",
    optionText: "",
    supportingText: [
      "사이즈 61×11 mm",
      "일회용",
      "사용자 재단 가능",
      "슬림 스트립형",
      "스티커형 패치",
    ].join(" · "),
    warnings: ["EXPERIMENT_FIXTURE_REQUIRES_ORIGINAL_CHINESE_TITLE_AND_OPTIONS"],
    collectedAt: "",
  },
  identity: {
    koreanProductIdentity: "코 성형 테이프(코 모양 보정 패치)",
    coreProduct: "코 성형 테이프",
    identityAnchor: "콧볼·콧구멍 보정용 코 테이프",
    primarySeeds: [
      "코 성형 테이프",
      "콧볼·콧구멍 보정용 코 테이프",
      "코 모양 교정 패치",
      "콧볼 축소 테이프",
    ],
    conditionalSeeds: [
      "조절형 코 테이프",
      "메모리 소재 코 테이프",
      "가위로 재단 가능한 코 테이프",
      "일회용 코 패치",
    ],
    functionModifiers: [
      "콧볼 축소",
      "콧구멍 교정",
      "코 모양 보정",
      "콧대·코끝 보정",
      "피부 가림",
      "커버링",
      "모양 유지",
    ],
    designShapeModifiers: [
      "슬림 스트립형",
      "61×11mm",
      "투명 스트립",
      "단색 스트립",
      "스티커형",
      "붙이는 패치",
    ],
    specAttributes: [
      "61×11 mm",
      "일회용 제품",
      "통용 일반 사용",
      "중국 광동성 원산지",
      "사용자 재단 가능",
    ],
    variantNoise: [
      "색상·패턴",
      "포장 단위",
      "단색·혼색",
      "투명박스·컬러박스",
      "박스 유무",
    ],
    confidence: 0.88,
    reasoning: "원문 제목과 상세에서 반복되는 핵심은 코 모양 보정용 테이프/패치이며 일회용 붙이는 스트립 형태다. 크기, 조절·기억·재단 가능 같은 기능성 속성은 조건적 Seed로, 색상·무늬·포장 수량은 variant noise로 분류한다.",
    model: "step1-fixed-user-approved",
  },
  notes: [
    "사용자가 승인한 STEP 1 결과를 고정한 첫 실험 샘플",
    "시장 발굴·AI 점수화의 재현성을 높이기 위해 중국 상품명과 중국 옵션 원문을 추가해야 실제 실행 가능",
  ],
};

export const KEYWORD_ELON_EXPERIMENT_FIXTURES: Record<string, KeywordElonExperimentFixture> = {
  [noseTapeFixture.id]: noseTapeFixture,
};

export function getKeywordElonExperimentFixture(id: string) {
  return KEYWORD_ELON_EXPERIMENT_FIXTURES[id] ?? null;
}

export function keywordElonExperimentFixtureSourceReady(fixture: KeywordElonExperimentFixture) {
  return Boolean(fixture.source.chineseTitle.trim() && fixture.source.optionText.trim());
}
