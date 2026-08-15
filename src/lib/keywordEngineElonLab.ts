export const KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS = [
  "121073",
  "121065",
  "121059",
  "121053",
  "121050",
  "121045",
] as const;

export type KeywordEngineElonLabReviewStatus = "pending" | "pass" | "improve";
export type KeywordEngineElonLabRunStatus = "not_run" | "ready" | "error";

export type KeywordEngineElonLabStage = {
  index: number;
  key: string;
  title: string;
  input: string;
  output: string;
  purpose: string;
  implemented: boolean;
};

export const KEYWORD_ENGINE_ELON_LAB_STAGES: readonly KeywordEngineElonLabStage[] = [
  { index: 0, key: "goods_key_input", title: "goods_key 입력·검증", input: "고정 테스트 goods_key 6개", output: "숫자형 goods_key 검증 결과와 테스트 대상 목록", purpose: "시험 대상을 고정해 이후 모든 단계의 비교 기준을 동일하게 유지합니다.", implemented: true },
  { index: 1, key: "shopling_product_context", title: "Shopling 상품 Context 조회", input: "goods_key", output: "prod_nm, model_no, model_nm, site_srch, sale_status, dtl_desc 길이·미리보기, 현재 엔진 seed 후보", purpose: "현재 키워드 엔진이 실제로 어떤 상품정보를 출발점으로 보고 있는지 확인합니다.", implemented: true },
  { index: 2, key: "seed_selection", title: "Seed 결정", input: "Shopling 상품 Context", output: "선택된 seed와 선택 근거", purpose: "상품명·모델명 중 어떤 값을 키워드 탐색의 원점으로 삼을지 검수합니다.", implemented: true },
  { index: 3, key: "seed_cleaning", title: "Seed 잡음 제거", input: "선택된 seed", output: "정제 전/후 seed와 제거된 표현", purpose: "색상랜덤·배송문구 등 검색의도를 흐리는 표현을 제거합니다.", implemented: true },
  { index: 4, key: "probe_generation", title: "Probe 단어 분해", input: "정제 seed", output: "전체 seed + 구성 probe 목록", purpose: "연관검색 탐색에 사용할 시작 질의를 분해합니다.", implemented: true },
  { index: 5, key: "related_query_collection", title: "연관검색어 수집", input: "probe 목록", output: "네이버 자동완성/연관 후보와 출처", purpose: "원 상품 주변의 실제 검색 언어 후보를 확보합니다.", implemented: false },
  { index: 6, key: "seed_candidate_grading", title: "Seed 확장 후보 등급", input: "원 seed + 연관검색어", output: "A/B/C 등급, 구조점수, 의미판정", purpose: "원 상품 의도를 보존한 질의만 남깁니다.", implemented: false },
  { index: 7, key: "active_query_selection", title: "Active Query 확정", input: "등급화된 seed 후보", output: "실제 시장수집에 사용할 active/blocked query", purpose: "외부 데이터 수집에 투입할 질의를 확정합니다.", implemented: false },
  { index: 8, key: "naver_shopping_collection", title: "네이버 쇼핑 상품 수집", input: "active query", output: "상품명·상품ID·몰·브랜드·카테고리", purpose: "시장 상품 언어와 카테고리 증거를 수집합니다.", implemented: false },
  { index: 9, key: "market_title_collection", title: "외부 마켓 상품명 수집", input: "active query", output: "마켓별 상품명과 수집 성공/실패", purpose: "네이버 외 판매시장 표현을 비교합니다.", implemented: false },
  { index: 10, key: "market_title_relevance", title: "시장 상품명 관련성 Gate", input: "수집된 시장 상품명 + seed", output: "strong/weak/uncertain/irrelevant", purpose: "다른 상품의 제목이 후보 생성에 섞이지 않게 합니다.", implemented: false },
  { index: 11, key: "category_path_analysis", title: "카테고리 경로 분석", input: "시장 상품 rows", output: "주요 category path와 분포", purpose: "상품이 실제 시장에서 속하는 범위를 파악합니다.", implemented: false },
  { index: 12, key: "title_token_extraction", title: "상품명 Token 추출", input: "관련 시장 상품명", output: "token, 빈도(freq), 원천", purpose: "시장 상품명에서 반복되는 상품 언어를 분해합니다.", implemented: false },
  { index: 13, key: "core_product_terms", title: "핵심 상품어 추론", input: "seed + token rows", output: "core_product_terms", purpose: "속성이 아닌 실제 상품 정체성 단어를 고정합니다.", implemented: false },
  { index: 14, key: "compound_identity", title: "복합 상품명 구조 분석", input: "seed + core terms + 시장증거", output: "core_category_noun, modifier, attribute, 위험도", purpose: "복합 상품명을 상품 핵심명사와 속성으로 분해합니다.", implemented: false },
  { index: 15, key: "recall_merge", title: "Recall Source 병합", input: "seed·시장·SearchAd·확장 source", output: "통합 후보군과 source별 개수", purpose: "후보를 넓게 모으되 출처를 유지합니다.", implemented: false },
  { index: 16, key: "recall_quality_filter", title: "Recall 품질 필터", input: "통합 후보군", output: "통과/제거 후보와 제거 이유", purpose: "코드·HTML·브랜드·속성잡음·카테고리 이탈을 줄입니다.", implemented: false },
  { index: 17, key: "embedding_semantic_filter", title: "Embedding 의미 유사도", input: "정제 후보 + seed", output: "similarity와 통과 후보", purpose: "원 상품과 의미적으로 가까운 후보만 남깁니다.", implemented: false },
  { index: 18, key: "searchad_spacing_preserved", title: "SearchAd 1차 조회", input: "띄어쓰기 유지 후보", output: "PC/모바일 검색량, compIdx, plAvgDepth, CTR·클릭", purpose: "후보별 수요와 광고시장 데이터를 붙입니다.", implemented: false },
  { index: 19, key: "sparse_recovery_gate", title: "후보 부족 판단", input: "후보·시장·SearchAd 개수", output: "sparse recovery 발동 여부와 사유", purpose: "정상 데이터가 부족할 때만 복구 경로를 엽니다.", implemented: false },
  { index: 20, key: "sparse_candidate_generation", title: "Sparse 후보 생성", input: "seed·상세설명·core·attribute", output: "core+attribute 등 복구 후보", purpose: "데이터 부족 상품에서도 최소한의 안전 후보를 생성합니다.", implemented: false },
  { index: 21, key: "sparse_refilter", title: "Sparse 후보 재검증", input: "복구 후보", output: "품질/의미/SearchAd 재검증 결과", purpose: "fallback이 곧바로 최종 후보가 되지 않도록 다시 검증합니다.", implemented: false },
  { index: 22, key: "primary_market_noun", title: "시장 핵심명사 판정", input: "검색량 포함 후보 + 시장상품명", output: "primary_market_noun score", purpose: "상품을 실제로 지칭하는 중심 명사를 찾습니다.", implemented: false },
  { index: 23, key: "semantic_pre_scoring", title: "상품 관계 분류", input: "후보 + seed", output: "same_product/same_category/attribute/cross/different", purpose: "점수 계산 전에 상품관계를 명시적으로 분류합니다.", implemented: false },
  { index: 24, key: "keyword_scoring", title: "기본 키워드 점수", input: "의미통과 후보 + SearchAd", output: "score 상위 후보", purpose: "검색량·관련성·구체성·잡음을 조합해 기본 순위를 만듭니다.", implemented: false },
  { index: 25, key: "semantic_routing", title: "Title/Search/Low/Drop Routing", input: "점수화 후보", output: "4개 bucket과 routing 이유", purpose: "상품명용과 검색어용을 분리하고 위험 후보를 격리합니다.", implemented: false },
  { index: 26, key: "llm_identity_judge", title: "애매 후보 LLM 재판정", input: "모호도가 높은 후보", output: "LLM identity label·confidence·routing 변경", purpose: "규칙만으로 애매한 후보에 한해 보조 판정을 사용합니다.", implemented: false },
  { index: 27, key: "routing_safety_net", title: "후보 부족 Safety Net", input: "routing 결과", output: "승격 후보와 승격 이유", purpose: "안전 조건을 만족하는 경우에만 부족한 bucket을 보완합니다.", implemented: false },
  { index: 28, key: "opportunity_keywords", title: "Opportunity 후보 계산", input: "title/search 후보", output: "opportunity keywords와 세부점수", purpose: "수요·시장성·경쟁을 종합한 후보군을 만듭니다.", implemented: false },
  { index: 29, key: "candidate_postprocess", title: "후보 후처리", input: "routing 후보", output: "중복정리·정돈된 title/search 후보", purpose: "중복·형태 차이를 정리합니다.", implemented: false },
  { index: 30, key: "final_bucket_safety", title: "최종 Bucket 안전검사", input: "후처리 후보", output: "브랜드·중복·품질 차단 후 최종 bucket", purpose: "최종 조립 직전 안전성을 다시 확인합니다.", implemented: false },
  { index: 31, key: "mvp_site_srch_selection", title: "MVP 검색어 1차 선택", input: "최종 search 후보", output: "seller-quality 우선 최대 10개", purpose: "최종 검색어 조립의 1차 후보를 고릅니다.", implemented: false },
  { index: 32, key: "independent_candidates", title: "독립 후보 추가 탐색", input: "부족한 검색어 + core context", output: "Controlled/SearchAd related 독립 후보", purpose: "10개 부족 시 동일 후보 반복이 아닌 독립 정보를 보충합니다.", implemented: false },
  { index: 33, key: "manual_candidate_pool", title: "수동검토 후보 Pool", input: "미선택 안전 후보", output: "후보·검색량·경쟁도·거절이유", purpose: "자동선택 외 후보를 사람이 검토할 수 있게 보존합니다.", implemented: false },
  { index: 34, key: "auto_promotion", title: "안전 후보 자동승격", input: "선택 검색어 + manual pool", output: "최대 10개와 승격 audit", purpose: "조건을 충족한 후보만 부족분에 자동 추가합니다.", implemented: false },
  { index: 35, key: "canonical_title_legacy", title: "Canonical 상품명 생성(현행 Legacy)", input: "seed + 안전 후보", output: "30~49 byte canonical title", purpose: "현행 키워드 엔진에 섞여 있는 상품명 생성 책임을 관찰합니다.", implemented: false },
  { index: 36, key: "site_srch_quality_audit", title: "검색어 품질 Audit", input: "최대 10개 검색어", output: "품질·신뢰도·위험·정체성 비율", purpose: "최종 검색어가 상품을 벗어나지 않는지 검사합니다.", implemented: false },
  { index: 37, key: "no_space_conversion", title: "붙여쓰기 Surface 변환", input: "선택 검색어", output: "공백 제거 후보 + 기존 SearchAd 지표 제거", purpose: "샵플링 입력형태인 붙여쓰기 검색어를 별도 후보로 만듭니다.", implemented: false },
  { index: 38, key: "exact_no_space_searchad", title: "붙여쓰기 SearchAd Exact 재조회", input: "붙여쓰기 후보", output: "exact match 검색량·compIdx 재측정", purpose: "띄어쓰기 키워드의 지표를 재사용하지 않고 실제 최종 문자열을 검증합니다.", implemented: false },
  { index: 39, key: "final_ten_ranking", title: "최종 10개 Ranking", input: "exact 검증 후보", output: "최종 검색어 최대 10개와 순위", purpose: "검증된 최종 검색어를 확정합니다.", implemented: false },
  { index: 40, key: "approval_gate", title: "최종 승인 Gate", input: "최종 검색어·품질·위험 상태", output: "PASS/REVIEW_REQUIRED와 block reason", purpose: "조건 미달 결과의 자동 적용을 차단합니다.", implemented: false },
  { index: 41, key: "artifact_generation", title: "Artifact 생성", input: "최종 record", output: "approval/manual/result/audit/meta CSV·JSON", purpose: "OPS Center가 읽을 수 있는 검토 산출물을 생성합니다.", implemented: false },
] as const;

export const KEYWORD_ENGINE_ELON_LAB_CURRENT_IMPLEMENTED_STAGE = 4;

export function isKeywordEngineElonLabGoodsKey(
  value: unknown,
): value is (typeof KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS)[number] {
  return KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.includes(
    String(value ?? "").trim() as (typeof KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS)[number],
  );
}
