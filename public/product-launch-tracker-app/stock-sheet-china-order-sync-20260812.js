// One-time, non-destructive import of China order metadata from
// Google Sheet "실재고 상품 관리표" > "실재고 사전".
// Source columns: B=model number, E=sale option, F=China option,
// BD:BG=China order links 1..4.
// Generated for 2026-08-12. 1688 detail URLs are canonicalized to the
// stable offer URL while preserving source link priority.

const OPTIMIZED_API = "/api/product-launch-tracker/optimized";
const SYNC_VERSION = "2026-08-12-v1";
const SYNC_KEY = `commerce-os:stock-sheet-china-order-sync:${SYNC_VERSION}`;

const TARGETS = [
  {
    "modelNumber": "AAA220",
    "productName": "늘어나는 대형샤워볼80g 색상랜덤",
    "links": [
      "https://detail.1688.com/offer/544951340971.html"
    ],
    "options": {
      "단품": "可拉伸浴球米色"
    }
  },
  {
    "modelNumber": "AAA360",
    "productName": "흡착형 샤워기거치대 실버그레이",
    "links": [
      "https://detail.1688.com/offer/888199095327.html"
    ],
    "options": {
      "단품": "主页A款-吸盘花洒支架【石墨灰】"
    }
  },
  {
    "modelNumber": "AAA384",
    "productName": "스케이트보드 곰돌이",
    "links": [
      "https://detail.1688.com/offer/924768377477.html"
    ],
    "options": {
      "대쉬보드형": "【仪表台款】动动熊（黑色）",
      "네비게이션형": "【悬浮屏款】动动熊（黑色）"
    }
  },
  {
    "modelNumber": "AAA404",
    "productName": "열리는 수납 모형책 F",
    "links": [
      "https://detail.1688.com/offer/723077337775.html"
    ],
    "options": {
      "뉴욕": "打开款-112",
      "에펠탑": "打开款-05",
      "보그": "打开款-384",
      "샤넬": "打开款-2A8",
      "킨포크": "打开款-407",
      "랄프": "打开款-411"
    }
  },
  {
    "modelNumber": "AAA406",
    "productName": "열리는 수납 모형책 D",
    "links": [
      "https://detail.1688.com/offer/862277637726.html"
    ],
    "options": {
      "갤러리": "BH-2A51",
      "미니멀리즘": "FH-23",
      "추상": "FH-25",
      "피카소": "FH-32"
    }
  },
  {
    "modelNumber": "AAA407",
    "productName": "열리는 수납 모형책 E",
    "links": [
      "https://detail.1688.com/offer/862277637726.html"
    ],
    "options": {
      "마티스 A": "FH-24",
      "마티스 B": "BH-2A38",
      "마티스 C": "BH-2A37",
      "마티스 D": "BH-2A20",
      "플라워": "BH-2A55"
    }
  },
  {
    "modelNumber": "AAA410",
    "productName": "곰돌이 털모자 A형",
    "links": [
      "https://detail.1688.com/offer/824979277566.html"
    ],
    "options": {
      "브라운": "波纹圆耳【卡其色】",
      "화이트": "波纹圆耳【米白色】",
      "핑크": "波纹圆耳【粉色】",
      "그레이": "波纹圆耳【灰蓝色】"
    }
  },
  {
    "modelNumber": "AAA412",
    "productName": "여우귀 넥워머",
    "links": [
      "https://detail.1688.com/offer/824979277566.html"
    ],
    "options": {
      "베이지": "狐狸耳朵【卡其色】",
      "화이트": "狐狸耳朵【米色】"
    }
  },
  {
    "modelNumber": "AAA413",
    "productName": "곰돌이 목도리 넥워머",
    "links": [
      "https://detail.1688.com/offer/824979277566.html"
    ],
    "options": {
      "브라운": "小熊三件套【咖色】",
      "베이지": "小熊三件套【米色】",
      "화이트": "小熊三件套【白色】"
    }
  },
  {
    "modelNumber": "AAA414",
    "productName": "곰돌이 방울 털모자",
    "links": [
      "https://detail.1688.com/offer/824979277566.html"
    ],
    "options": {
      "브라운": "毛绒绒系绳【卡其色】",
      "베이지": "毛绒绒系绳【米色】",
      "화이트": "毛绒绒系绳【白色】",
      "핑크": "毛绒绒系绳【粉色】"
    }
  },
  {
    "modelNumber": "AAA434",
    "productName": "브래지어 세탁망 색상랜덤",
    "links": [
      "https://detail.1688.com/offer/818663415651.html"
    ],
    "options": {
      "단품": "文胸袋【灰边款】"
    }
  },
  {
    "modelNumber": "AAA435",
    "productName": "캐릭터 패브릭 수납정리함",
    "links": [
      "https://detail.1688.com/offer/971296179111.html"
    ],
    "options": {
      "오렌지": "红色猫咪",
      "핑크": "格子猫咪",
      "블루": "藏青猫咪"
    }
  },
  {
    "modelNumber": "AAA436",
    "productName": "끼우는 슬라이딩서랍 화이트",
    "links": [
      "https://detail.1688.com/offer/604057736438.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA437",
    "productName": "붙이는 서랍레일 1쌍",
    "links": [
      "https://detail.1688.com/offer/660406880248.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA439",
    "productName": "잘라쓰는 뒤꿈치 롱패드1쌍",
    "links": [
      "https://detail.1688.com/offer/837992222780.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA442",
    "productName": "세탁기원형받침대 4P세트",
    "links": [
      "https://detail.1688.com/offer/656949712525.html"
    ],
    "options": {
      "단품": "圆形单层四只【垫高3.3CM】"
    }
  },
  {
    "modelNumber": "AAA444",
    "productName": "투명 라면정리함",
    "links": [
      "https://detail.1688.com/offer/973001358435.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA446",
    "productName": "볼펜꽂이 미니 가죽노트",
    "links": [
      "https://detail.1688.com/offer/747421210237.html"
    ],
    "options": {
      "하늘": "A7/100张】皮面口袋本【浅蓝】【带笔套】",
      "블랙": "A7/100张】皮面口袋本【黑色】【带笔套】",
      "그레이": "A7/100张】皮面口袋本【灰色】【带笔套】",
      "그린": "A7/100张】皮面口袋本【浅绿】【带笔套】",
      "네이비": "A7/100张】皮面口袋本【深蓝】【带笔套】",
      "핑크": "A7/100张】皮面口袋本【浅粉】【带笔套】",
      "브라운": "A7/100张】皮面口袋本【棕色】【带笔套】",
      "전용미니펜 5자루": "不送笔需要笔拍这个x1支【无标】"
    }
  },
  {
    "modelNumber": "AAA447",
    "productName": "계란노른자섞기 스피너",
    "links": [
      "https://detail.1688.com/offer/978779688105.html"
    ],
    "options": {
      "단품": "T型手环黄色"
    }
  },
  {
    "modelNumber": "AAA448",
    "productName": "책상정리 미니서랍 화이트",
    "links": [
      "https://detail.1688.com/offer/609572019478.html"
    ],
    "options": {
      "1단": "象牙白一抽",
      "2단": "象牙白二抽",
      "3단": "象牙白三抽"
    }
  },
  {
    "modelNumber": "AAA449",
    "productName": "투명 굿즈서랍 수납함",
    "links": [
      "https://detail.1688.com/offer/795820294420.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA450",
    "productName": "MBTI 키보드키링 일자형",
    "links": [
      "https://qr.1688.com/s/SPWppBtQ"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA452",
    "productName": "반자동 책갈피 3p 색상랜덤",
    "links": [
      "https://detail.1688.com/offer/1000747239107.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA454",
    "productName": "메모리폼 다리쿠션 그레이",
    "links": [
      "https://detail.1688.com/offer/871620453832.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA455",
    "productName": "발편한 등산화",
    "links": [
      "https://detail.1688.com/offer/984019281478.html"
    ],
    "options": {
      "블랙 260": "黑色 41",
      "블랙 270": "黑色 43",
      "블랙 280": "黑色",
      "그레이 260": "灰色 41",
      "그레이 270": "灰色 43",
      "그레이 280": "灰色 45",
      "카키 260": "卡其色 41",
      "카키 270": "卡其色 43",
      "카키 280": "卡其色 45"
    }
  },
  {
    "modelNumber": "AAA456",
    "productName": "메쉬 여성운동화",
    "links": [
      "https://detail.1688.com/offer/621027427923.html"
    ],
    "options": {
      "블랙 230": "黑色 36",
      "블랙 240": "黑色 38",
      "블랙 250": "黑色 40",
      "핑크 230": "粉色 36",
      "핑크 240": "粉色 38",
      "핑크 250": "粉色 40",
      "화이트 230": "白色 36",
      "화이트 240": "白色 38",
      "화이트 250": "白色 40"
    }
  },
  {
    "modelNumber": "AAA457",
    "productName": "시바견 문콕 스티커 1p",
    "links": [
      "https://detail.1688.com/offer/993906452442.html"
    ],
    "options": {
      "단품": "1号大肚皮小狗"
    }
  },
  {
    "modelNumber": "AAA458",
    "productName": "돌기형 eva 폼롤러",
    "links": [
      "https://detail.1688.com/offer/1040564652768.html"
    ],
    "options": {
      "핑크": "45浮点空心-浅粉[45*13]",
      "블루": "45浮点空心-蓝[45*13]"
    }
  },
  {
    "modelNumber": "AAA459",
    "productName": "공기주입기 게이지형 색상랜덤",
    "links": [
      "https://detail.1688.com/offer/987727815359.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA460",
    "productName": "공기주입기 펌프 색상랜덤",
    "links": [
      "https://detail.1688.com/offer/668987412257.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA461",
    "productName": "3단 우산형건조대 화이트",
    "links": [
      "https://detail.1688.com/offer/1021562180413.html"
    ],
    "options": {
      "단품": "白色3层"
    }
  },
  {
    "modelNumber": "AAA465",
    "productName": "쿨수건 사각파우치포함",
    "links": [
      "https://detail.1688.com/offer/871946975163.html"
    ],
    "options": {
      "블루": "天蓝（eva方盒）,30*80cm毛巾±2cm（成人款）",
      "핑크": "玫红（eva方盒）,30*80cm毛巾±2cm（成人款）"
    }
  },
  {
    "modelNumber": "AAA465",
    "productName": "쿨수건 원형파우치포함",
    "links": [
      "https://detail.1688.com/offer/871946975163.html"
    ],
    "options": {
      "블루": "天蓝（eva圆盒）,30*80cm毛巾±2cm（成人款）",
      "핑크": "玫红（eva圆盒）.30*80cm毛巾±2cm（成人款）"
    }
  },
  {
    "modelNumber": "AAA466",
    "productName": "쿨넥밴드 색상랜덤",
    "links": [
      "https://detail.1688.com/offer/806011841158.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA467",
    "productName": "모자세탁망 색상랜덤",
    "links": [
      "https://detail.1688.com/offer/992639652273.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA468",
    "productName": "키보드 주차번호판",
    "links": [
      "https://detail.1688.com/offer/798963978173.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA469",
    "productName": "304스텐 욕실청소건 블랙",
    "links": [
      "https://detail.1688.com/offer/913931320996.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA470",
    "productName": "304스텐 욕실청소건 실버",
    "links": [
      "https://detail.1688.com/offer/913931320996.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA471",
    "productName": "사각 샤워헤드기 블랙",
    "links": [
      "https://detail.1688.com/offer/737668440561.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA473",
    "productName": "스타트버튼 배트맨커버 블랙",
    "links": [
      "https://detail.1688.com/offer/666359994856.html"
    ],
    "options": {
      "단품": "黑色"
    }
  },
  {
    "modelNumber": "AAA475",
    "productName": "실리콘 차량용핸들커버 블랙",
    "links": [
      "https://detail.1688.com/offer/820990091535.html",
      "https://detail.1688.com/offer/829982084080.html"
    ],
    "options": {
      "단품": "几何纹-黑色"
    }
  },
  {
    "modelNumber": "AAA476",
    "productName": "문콕방지 실리콘 스티커 6개입",
    "links": [
      "https://detail.1688.com/offer/836779025825.html"
    ],
    "options": {
      "단품": "直径50*8mm 6个袋装"
    }
  },
  {
    "modelNumber": "AAA477",
    "productName": "무소음 차량용 스퀴지",
    "links": [
      "https://detail.1688.com/offer/930562247475.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA478",
    "productName": "차량용 자석거치대",
    "links": [
      "https://detail.1688.com/offer/1007962155871.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA479",
    "productName": "헤드레스트 스웨이드 후크",
    "links": [
      "https://detail.1688.com/offer/923750431449.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA480",
    "productName": "재사용 EVA 우비 140g",
    "links": [
      "https://detail.1688.com/offer/865764545538.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA481",
    "productName": "스트라이프 버킷햇",
    "links": [
      "https://detail.1688.com/offer/925139466743.html",
      "https://detail.1688.com/offer/1027209601206.html"
    ],
    "options": {
      "단품": "白标渔夫"
    }
  },
  {
    "modelNumber": "AAA482",
    "productName": "밀짚 스티치버킷햇",
    "links": [
      "https://detail.1688.com/offer/899285929235.html"
    ],
    "options": {
      "퍼플": "紫色",
      "카키": "卡其色",
      "라임": "米色",
      "블랙": "黑色",
      "블루": "蓝色"
    }
  },
  {
    "modelNumber": "AAA483",
    "productName": "대형 에어 반달쿠션",
    "links": [
      "https://detail.1688.com/offer/702959747316.html"
    ],
    "options": {
      "블루": "抱枕-蓝色",
      "그레이": "抱枕-灰色"
    }
  },
  {
    "modelNumber": "AAA484",
    "productName": "크루아상 쿠션",
    "links": [
      "https://detail.1688.com/offer/976998053162.html",
      "https://detail.1688.com/offer/1037999344071.html"
    ],
    "options": {
      "단품": "65*30*25cm"
    }
  },
  {
    "modelNumber": "AAA485",
    "productName": "길이조절 등드름브러쉬 색상랜덤",
    "links": [
      "https://detail.1688.com/offer/969917225300.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA486",
    "productName": "실리콘 미세세안브러쉬 색상랜덤",
    "links": [
      "https://detail.1688.com/offer/965163735031.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA487",
    "productName": "소프트 실리콘 두피브러쉬",
    "links": [
      "https://detail.1688.com/offer/966906772794.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA488",
    "productName": "실리콘 땅콩 골프공커버",
    "links": [
      "https://detail.1688.com/offer/967933892132.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA489",
    "productName": "걸이형 모공브러쉬 블랙",
    "links": [
      "https://detail.1688.com/offer/617861114823.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA491",
    "productName": "발바닥 지압스텝퍼 색상랜덤",
    "links": [
      "https://detail.1688.com/offer/1035127380138.html"
    ],
    "options": {}
  },
  {
    "modelNumber": "AAA492",
    "productName": "미니짐볼 300g 색상랜덤",
    "links": [
      "https://detail.1688.com/offer/1014746573501.html"
    ],
    "options": {}
  }
];

const TARGET_BY_KEY = new Map(
  TARGETS.map((entry) => [targetKey(entry.modelNumber, entry.productName), entry]),
);

void runStockSheetChinaOrderSync();

async function runStockSheetChinaOrderSync() {
  try {
    if (localStorage.getItem(SYNC_KEY) === "done") return;

    const summaries = await fetchUnfinishedSummaries();
    const selected = summaries
      .map((summary) => ({
        summary,
        target: TARGET_BY_KEY.get(targetKey(summary.modelNumber, summary.productName)),
      }))
      .filter((entry) => Boolean(entry.target));

    if (!selected.length) {
      localStorage.setItem(SYNC_KEY, "done");
      return;
    }

    const items = await fetchItems(selected.map((entry) => entry.summary.id));
    const itemById = new Map(items.map((item) => [String(item.id ?? ""), item]));
    let changedCount = 0;
    const changedIds = [];
    const failures = [];

    for (const entry of selected) {
      const item = itemById.get(String(entry.summary.id ?? ""));
      if (!item) continue;
      const patch = buildPatch(item, entry.target);
      if (!patch) continue;
      try {
        await patchItem(item.id, patch);
        changedCount += 1;
        changedIds.push(String(item.id));
      } catch (error) {
        failures.push({
          id: String(item.id ?? ""),
          modelNumber: String(item.modelNumber ?? ""),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    window.__commerceOsStockSheetChinaOrderSync = {
      version: SYNC_VERSION,
      matched: selected.length,
      changed: changedCount,
      changedIds,
      failures,
      completedAt: new Date().toISOString(),
    };

    if (!failures.length) {
      localStorage.setItem(SYNC_KEY, "done");
    }

    if (changedCount) {
      window.dispatchEvent(
        new CustomEvent("product-launch-tracker:stock-sheet-china-order-sync-complete", {
          detail: window.__commerceOsStockSheetChinaOrderSync,
        }),
      );
      const status = document.querySelector("#save-status");
      if (status) status.textContent = `실재고 중국 주문정보 ${changedCount}건 동기화 완료`;
    }
    if (failures.length) console.warn("Stock sheet China order sync partial failures", failures);
  } catch (error) {
    console.error("Stock sheet China order sync failed", error);
  }
}

async function fetchUnfinishedSummaries() {
  const result = [];
  let page = 1;
  let pageCount = 1;
  do {
    const params = new URLSearchParams({
      mode: "page",
      page: String(page),
      pageSize: "100",
      unfinishedOnly: "true",
      direction: "desc",
    });
    const body = await requestJson(`${OPTIMIZED_API}?${params.toString()}`);
    if (body?.stateExists === false) return [];
    result.push(...(Array.isArray(body?.items) ? body.items : []));
    pageCount = Math.max(1, Number(body?.pageCount) || 1);
    page += 1;
  } while (page <= pageCount);
  return result;
}

async function fetchItems(ids) {
  const uniqueIds = [...new Set(ids.map((value) => String(value ?? "").trim()).filter(Boolean))];
  const output = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    const params = new URLSearchParams({ mode: "items" });
    for (const id of uniqueIds.slice(offset, offset + 100)) params.append("id", id);
    const body = await requestJson(`${OPTIMIZED_API}?${params.toString()}`);
    output.push(...(Array.isArray(body?.items) ? body.items : []));
  }
  return output;
}

function buildPatch(item, target) {
  const existingLinks = readExistingLinks(item);
  const links = mergeLinks(target.links, existingLinks);
  const currentOptions = Array.isArray(item?.orderOptions) ? item.orderOptions : [];
  const mappedEntries = Object.entries(target.options ?? {});
  const normalizedMap = new Map(
    mappedEntries.map(([saleOption, chinaOption]) => [normalizeOption(saleOption), chinaOption]),
  );
  const singleFallback =
    currentOptions.length === 1 && mappedEntries.length === 1
      ? String(mappedEntries[0][1] ?? "").trim()
      : "";

  let optionChanged = false;
  const orderOptions = currentOptions.map((option) => {
    const current = option && typeof option === "object" ? option : {};
    const saleOption = String(current.saleOption ?? current.value ?? "").trim();
    const mapped = normalizedMap.get(normalizeOption(saleOption)) ?? singleFallback;
    if (!mapped || String(current.chinaOption ?? "").trim() === mapped) return current;
    optionChanged = true;
    return { ...current, chinaOption: mapped };
  });

  const linkChanged = !sameLinks(existingLinks, links);
  if (!linkChanged && !optionChanged) return null;

  const patch = {};
  if (linkChanged) {
    const primaryUrl = links[0] ?? "";
    patch.chinaProductLinks = links;
    patch.primaryChinaProductLink = primaryUrl;
    patch.detailPageSource = {
      ...(isRecord(item?.detailPageSource) ? item.detailPageSource : {}),
      primaryUrl,
      urls: links,
      pinnedIndex: primaryUrl ? 0 : null,
      source: "product_launch_tracker",
      updatedAt: new Date().toISOString(),
    };
  }
  if (optionChanged) patch.orderOptions = orderOptions;
  return patch;
}

async function patchItem(itemId, patch) {
  await requestJson(OPTIMIZED_API, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: "patch_item",
      itemId: String(itemId),
      patch,
    }),
  });
}

function readExistingLinks(item) {
  const detailPageSource = isRecord(item?.detailPageSource) ? item.detailPageSource : {};
  return uniqueLinks([
    item?.primaryChinaProductLink,
    detailPageSource.primaryUrl,
    ...(Array.isArray(item?.chinaProductLinks) ? item.chinaProductLinks : []),
    ...(Array.isArray(detailPageSource.urls) ? detailPageSource.urls : []),
  ]);
}

function mergeLinks(sourceLinks, existingLinks) {
  return uniqueLinks([...(Array.isArray(sourceLinks) ? sourceLinks : []), ...existingLinks]).slice(0, 5);
}

function uniqueLinks(values) {
  const seen = new Set();
  const result = [];
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    const key = linkIdentity(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function linkIdentity(value) {
  const text = String(value ?? "").trim();
  const offer = text.match(/detail\.1688\.com\/offer\/(\d+)\.html/i);
  if (offer) return `1688-offer:${offer[1]}`;
  return text.toLowerCase().replace(/\/$/, "");
}

function sameLinks(left, right) {
  const a = uniqueLinks(left).map(linkIdentity);
  const b = uniqueLinks(right).map(linkIdentity);
  return JSON.stringify(a) === JSON.stringify(b);
}

function targetKey(modelNumber, productName) {
  return `${normalizeModel(modelNumber)}|${normalizeProduct(productName)}`;
}

function normalizeModel(value) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeProduct(value) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeOption(value) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.message || `요청 실패 (${response.status})`);
  }
  return body;
}
