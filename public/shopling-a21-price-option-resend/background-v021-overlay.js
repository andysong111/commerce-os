const A21_MAIN_SUBMIT_V021 = "A21_MAIN_SUBMIT_V021";

function normalizeA21Value(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== A21_MAIN_SUBMIT_V021) return false;
  void (async () => {
    const tabId = sender?.tab?.id;
    const frameId = Number.isInteger(sender?.frameId) ? sender.frameId : 0;
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false, error: "v021_sender_tab_missing" });
      return;
    }
    const mode = String(message.mode || "");
    if (!["PRICE", "OPTION"].includes(mode)) {
      sendResponse({ ok: false, error: "v021_invalid_mode" });
      return;
    }

    const injected = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: "MAIN",
      args: [mode],
      func: (requestedMode) => {
        const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
        const radios = (name) => [...document.querySelectorAll('input[type="radio"]')].filter((item) => item.name === name);
        const checkedValue = (name) => {
          const checked = radios(name).filter((item) => item.checked);
          return checked.length === 1 ? String(checked[0].value ?? "") : null;
        };
        const hiddenValues = (name) => [...document.querySelectorAll('input[type="hidden"]')]
          .filter((item) => item.name === name)
          .map((item) => String(item.value ?? ""));
        const generalNames = [
          "trsmt_env_mody_item_nm",
          "trsmt_env_mody_price",
          "trsmt_env_mody_ctg",
          "trsmt_env_mody_img",
          "trsmt_env_mody_fee",
          "trsmt_env_mody_desc",
          "trsmt_env_mody_keyword",
          "trsmt_env_mody_paysvc",
          "trsmt_env_mody_dlvyinfo",
        ];

        const payload = hiddenValues("prod_join_chk[]");
        if (!payload.length || payload.some((value) => !/^\d+$/.test(value))) {
          return { ok: false, error: "v021_payload_invalid", payload };
        }

        if (requestedMode === "PRICE") {
          if (checkedValue("modify_tp") !== "goods_normal") return { ok: false, error: "v021_price_mode_invalid", actual: checkedValue("modify_tp") };
          const source = hiddenValues("tsmt_sale_price_tp");
          if (!source.length || source.some((value) => value !== "J")) return { ok: false, error: "v021_price_source_invalid", source };
          for (const name of generalNames) {
            const expected = name === "trsmt_env_mody_price" ? "Y" : "";
            const actual = checkedValue(name);
            if (actual !== expected) return { ok: false, error: "v021_price_field_invalid", name, expected, actual };
          }
        } else {
          if (checkedValue("modify_tp") !== "goods_stock") return { ok: false, error: "v021_option_mode_invalid", actual: checkedValue("modify_tp") };
          if (checkedValue("trsmt_env_mody_opt") !== "1") return { ok: false, error: "v021_option_field_invalid", actual: checkedValue("trsmt_env_mody_opt") };
        }

        const button = [...document.querySelectorAll('input[type="button"]')].find((item) =>
          norm(item.value) === "상품수정 송신" && /goods_mallMdfy_submit_sp\s*\(/.test(item.getAttribute("onclick") || ""),
        );
        if (!button) return { ok: false, error: "v021_submit_button_missing" };
        if (typeof window.goods_mallMdfy_submit_sp !== "function") {
          return { ok: false, error: "v021_shopling_submit_function_missing", onclick: button.getAttribute("onclick") || "" };
        }

        // Inline onclick을 isolated world에서 흉내 내지 않고 Shopling 원본 페이지 함수 자체를 MAIN world에서 1회 호출한다.
        window.setTimeout(() => {
          window.goods_mallMdfy_submit_sp();
        }, 80);
        return { ok: true, scheduled: true, mode: requestedMode, payloadCount: payload.length };
      },
    });
    const result = injected?.[0]?.result || null;
    if (!result?.ok) {
      sendResponse({ ok: false, error: result?.error || "v021_main_submit_failed", detail: result });
      return;
    }
    sendResponse({ ok: true, result });
  })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});
