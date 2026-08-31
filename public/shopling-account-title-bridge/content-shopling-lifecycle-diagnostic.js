(() => {
  "use strict";

  const REPORT_MESSAGE = "commerce-os-shopling-lifecycle-dom-diagnostic-report";
  const KEYWORD = /(판매\s*중|판매\s*상태|판매상태|품절|삭제|판매\s*중지|판매중지|중지|선택\s*상품\s*변경|상품\s*변경|상태\s*변경|판매\s*여부)/i;
  const MAX_CANDIDATES = 120;
  const MAX_OPTIONS = 30;
  let lastSignature = "";
  let timer = 0;

  function text(value, max = 300) {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  }

  function pathOnly(value) {
    try {
      const url = new URL(String(value || ""), location.href);
      if (url.origin !== location.origin) return "";
      return url.pathname;
    } catch {
      return "";
    }
  }

  function cssEscape(value) {
    try {
      return CSS.escape(String(value));
    } catch {
      return String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&");
    }
  }

  function selectorFor(element) {
    if (!(element instanceof Element)) return "";
    const tag = element.tagName.toLowerCase();
    if (element.id) return `${tag}#${cssEscape(element.id)}`;
    const name = element.getAttribute("name");
    if (name) return `${tag}[name="${String(name).replace(/"/g, '\\"')}"]`;
    const type = element.getAttribute("type");
    const classes = [...element.classList].filter(Boolean).slice(0, 3);
    return [tag, type ? `[type="${String(type).replace(/"/g, '\\"')}"]` : "", ...classes.map((value) => `.${cssEscape(value)}`)].join("");
  }

  function associatedLabel(element) {
    if (!(element instanceof Element)) return "";
    const labels = element.labels ? [...element.labels] : [];
    if (labels.length) return text(labels.map((label) => label.textContent).join(" "), 200);
    const id = element.id;
    if (id) {
      const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
      if (label) return text(label.textContent, 200);
    }
    const closest = element.closest("label");
    if (closest) return text(closest.textContent, 200);
    const previous = element.previousElementSibling;
    if (previous && /^(LABEL|TH|TD|SPAN|DIV)$/i.test(previous.tagName)) {
      const previousText = text(previous.textContent, 200);
      if (KEYWORD.test(previousText)) return previousText;
    }
    return "";
  }

  function optionSnapshot(select) {
    if (!(select instanceof HTMLSelectElement)) return [];
    return [...select.options].slice(0, MAX_OPTIONS).map((option) => ({
      text: text(option.textContent, 120),
      value: text(option.value, 120),
      selected: option.selected,
    }));
  }

  function directText(element) {
    if (!(element instanceof Element)) return "";
    if (element instanceof HTMLInputElement) return text(element.value, 240);
    return text(element.textContent, 240);
  }

  function candidateSignal(element) {
    const optionText = element instanceof HTMLSelectElement
      ? [...element.options].map((option) => text(option.textContent, 120)).join(" ")
      : "";
    return [
      directText(element),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("name"),
      element.id,
      associatedLabel(element),
      optionText,
      element.getAttribute("onclick"),
    ].map((value) => text(value, 500)).join(" | ");
  }

  function captureCandidate(element) {
    const form = element.closest("form");
    return {
      tag: element.tagName.toLowerCase(),
      id: text(element.id, 120),
      name: text(element.getAttribute("name"), 120),
      type: text(element.getAttribute("type"), 60),
      role: text(element.getAttribute("role"), 60),
      selector: text(selectorFor(element), 240),
      text: directText(element),
      ariaLabel: text(element.getAttribute("aria-label"), 160),
      title: text(element.getAttribute("title"), 160),
      label: associatedLabel(element),
      value: element instanceof HTMLInputElement || element instanceof HTMLButtonElement
        ? text(element.value, 120)
        : "",
      hrefPath: element instanceof HTMLAnchorElement ? pathOnly(element.href) : "",
      onclick: text(element.getAttribute("onclick"), 300),
      formActionPath: form ? pathOnly(form.getAttribute("action") || location.pathname) : "",
      formMethod: form ? text(form.getAttribute("method") || "GET", 20).toUpperCase() : "",
      options: optionSnapshot(element),
    };
  }

  function captureForms(candidates) {
    const candidateElements = new Set(candidates.map((entry) => entry.element));
    return [...document.forms]
      .map((form) => {
        const relevantControlCount = [...form.elements].filter((element) => candidateElements.has(element)).length;
        if (!relevantControlCount) return null;
        return {
          id: text(form.id, 120),
          name: text(form.getAttribute("name"), 120),
          actionPath: pathOnly(form.getAttribute("action") || location.pathname),
          method: text(form.getAttribute("method") || "GET", 20).toUpperCase(),
          relevantControlCount,
        };
      })
      .filter(Boolean)
      .slice(0, 30);
  }

  function frameDepth() {
    let depth = 0;
    let current = window;
    try {
      while (current !== current.top && depth < 20) {
        depth += 1;
        current = current.parent;
      }
    } catch {
      return depth;
    }
    return depth;
  }

  function scan() {
    if (location.hostname !== "a.shopling.co.kr") return null;
    const elements = [
      ...document.querySelectorAll("button, input, select, a, [onclick], [role='button']"),
    ];
    const matched = [];
    const seen = new Set();
    for (const element of elements) {
      if (!(element instanceof Element)) continue;
      if (!KEYWORD.test(candidateSignal(element))) continue;
      const selector = selectorFor(element);
      const dedupe = `${element.tagName}:${selector}:${directText(element)}:${associatedLabel(element)}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      matched.push({ element, data: captureCandidate(element) });
      if (matched.length >= MAX_CANDIDATES) break;
    }
    const candidates = matched.map((entry) => entry.data);
    return {
      pathname: location.pathname,
      topFrame: window === window.top,
      frameDepth: frameDepth(),
      readyState: document.readyState,
      candidates,
      forms: captureForms(matched),
      capturedAt: new Date().toISOString(),
    };
  }

  function signature(snapshot) {
    if (!snapshot) return "";
    return JSON.stringify({
      pathname: snapshot.pathname,
      topFrame: snapshot.topFrame,
      frameDepth: snapshot.frameDepth,
      candidates: snapshot.candidates,
      forms: snapshot.forms,
    });
  }

  function send(snapshot) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: REPORT_MESSAGE, ...snapshot }, (response) => {
          void chrome.runtime.lastError;
          resolve(response || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async function run() {
    timer = 0;
    const snapshot = scan();
    if (!snapshot) return;
    const nextSignature = signature(snapshot);
    if (!nextSignature || nextSignature === lastSignature) return;
    const response = await send(snapshot);
    if (response?.ok) lastSignature = nextSignature;
  }

  function schedule(delay = 900) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), delay);
  }

  schedule(400);
  window.addEventListener("load", () => schedule(300), { once: true });
  const observer = new MutationObserver(() => schedule(900));
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["style", "class", "disabled", "selected"],
  });
})();
