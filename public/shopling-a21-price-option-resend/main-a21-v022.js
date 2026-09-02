(() => {
  const VERSION = "0.2.2";
  const REQUEST_EVENT = "commerce-os-a21-v022-main-submit-request";
  const RESPONSE_EVENT = "commerce-os-a21-v022-main-submit-response";
  const GENERAL_NAMES = [
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
  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const radios = (name) => [...document.querySelectorAll('input[type="radio"]')].filter((item) => item.name === name);
  const checkedValue = (name) => {
    const checked = radios(name).filter((item) => item.checked);
    return checked.length === 1 ? String(checked[0].value ?? "") : null;
  };
  const hiddenValues = (name) => [...document.querySelectorAll('input[type="hidden"]')]
    .filter((item) => item.name === name)
    .map((item) => String(item.value ?? ""));

  function respond(nonce, payload) {
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
      detail: JSON.stringify({ nonce, version: VERSION, ...payload }),
    }));
  }

  function validate(mode) {
    const payload = hiddenValues("prod_join_chk[]");
    if (!payload.length || payload.some((value) => !/^\d+$/.test(value))) {
      return { ok: false, error: "v022_payload_invalid", payload };
    }
    if (mode === "PRICE") {
      if (checkedValue("modify_tp") !== "goods_normal") return { ok: false, error: "v022_price_mode_invalid", actual: checkedValue("modify_tp") };
      const source = hiddenValues("tsmt_sale_price_tp");
      if (!source.length || source.some((value) => value !== "J")) return { ok: false, error: "v022_price_source_invalid", source };
      for (const name of GENERAL_NAMES) {
        const expected = name === "trsmt_env_mody_price" ? "Y" : "";
        const actual = checkedValue(name);
        if (actual !== expected) return { ok: false, error: "v022_price_field_invalid", name, expected, actual };
      }
      // 배송정보는 반드시 수정안함(blank)이어야 한다.
      if (checkedValue("trsmt_env_mody_dlvyinfo") !== "") {
        return { ok: false, error: "v022_delivery_must_remain_unchanged", actual: checkedValue("trsmt_env_mody_dlvyinfo") };
      }
    } else if (mode === "OPTION") {
      if (checkedValue("modify_tp") !== "goods_stock") return { ok: false, error: "v022_option_mode_invalid", actual: checkedValue("modify_tp") };
      if (checkedValue("trsmt_env_mody_opt") !== "1") return { ok: false, error: "v022_option_field_invalid", actual: checkedValue("trsmt_env_mody_opt") };
    } else {
      return { ok: false, error: "v022_invalid_mode" };
    }
    if (typeof window.goods_mallMdfy_submit_sp !== "function") {
      return { ok: false, error: "v022_shopling_submit_function_missing" };
    }
    return { ok: true, payloadCount: payload.length };
  }

  document.addEventListener(REQUEST_EVENT, (event) => {
    let request = null;
    try { request = JSON.parse(String(event?.detail || "{}")); } catch { /* ignore */ }
    const nonce = String(request?.nonce || "");
    const mode = String(request?.mode || "");
    if (!nonce) return;

    const validation = validate(mode);
    if (!validation.ok) return respond(nonce, validation);

    const originalConfirm = window.confirm;
    const originalAlert = window.alert;
    const dialogs = [];
    let unexpected = null;
    let sawSubmitConfirm = false;
    let sawDeliveryNotice = false;

    window.confirm = (message) => {
      const text = norm(message);
      dialogs.push({ type: "confirm", text: text.slice(0, 500) });
      if (/수정전송\s*할\s*상품을\s*선택하셨습니까/i.test(text)) {
        sawSubmitConfirm = true;
        return true;
      }
      unexpected = `unexpected_confirm:${text.slice(0, 200)}`;
      return false;
    };
    window.alert = (message) => {
      const text = norm(message);
      dialogs.push({ type: "alert", text: text.slice(0, 500) });
      if (/배송정보\(A17\s*정보\).*수정되지\s*않고\s*유지/i.test(text) || /배송정보.*수정되지\s*않고\s*유지/i.test(text)) {
        sawDeliveryNotice = true;
        return;
      }
      unexpected = `unexpected_alert:${text.slice(0, 200)}`;
      throw new Error(unexpected);
    };

    try {
      window.goods_mallMdfy_submit_sp();
      if (unexpected) return respond(nonce, { ok: false, error: unexpected, dialogs });
      respond(nonce, {
        ok: true,
        invoked: true,
        mode,
        payloadCount: validation.payloadCount,
        sawSubmitConfirm,
        sawDeliveryNotice,
        deliveryInfoUnchanged: mode === "PRICE" ? checkedValue("trsmt_env_mody_dlvyinfo") === "" : true,
        dialogs,
      });
    } catch (error) {
      respond(nonce, { ok: false, error: error instanceof Error ? error.message : String(error), dialogs });
    } finally {
      window.confirm = originalConfirm;
      window.alert = originalAlert;
    }
  });
})();
