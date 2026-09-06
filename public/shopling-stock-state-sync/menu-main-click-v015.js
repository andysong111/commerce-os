(() => {
  const REQUEST_EVENT = "commerce-os-stock-main-click";
  const TOKEN_ATTRIBUTE = "data-commerce-os-stock-click-token";
  const nativeClick = HTMLElement.prototype.click;

  function norm(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function compact(value) {
    return norm(value).replace(/\s+/g, "").replace(/[·•]/g, "");
  }

  function isShoplingMenuTarget(element) {
    if (!(element instanceof HTMLElement)) return false;
    const target = element.closest?.("a,[onclick]") || element;
    const label = compact(target.textContent || element.textContent || "");
    return (
      /^(?:\[?A?4\]?[:.\-]?)?상품조회수정$/i.test(label) ||
      /^(?:\[?A?6\]?[:.\-]?)?옵션대량수정$/i.test(label) ||
      /^(?:\[?A?21\]?[:.\-]?)?쇼핑몰상품수정$/i.test(label)
    );
  }

  HTMLElement.prototype.click = function commerceOsShoplingMenuMainClick() {
    const target = this.closest?.("a,[onclick]") || this;
    if (!isShoplingMenuTarget(target)) return nativeClick.call(this);

    const token = `stock-menu-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    target.setAttribute(TOKEN_ATTRIBUTE, token);
    window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: { token } }));
  };
})();
