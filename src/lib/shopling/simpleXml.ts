type XmlRecord = Record<string, unknown>;

type XmlNode = {
  name: string;
  children: Array<{ name: string; value: unknown }>;
  text: string[];
};

const ENTITY_PATTERN = /&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g;

function decodeXmlEntities(value: string) {
  return value.replace(ENTITY_PATTERN, (_match, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    const hexadecimal = entity.startsWith("#x");
    const raw = entity.slice(hexadecimal ? 2 : 1);
    const codePoint = Number.parseInt(raw, hexadecimal ? 16 : 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
  });
}

function appendChild(target: XmlRecord, name: string, value: unknown) {
  const current = target[name];
  if (current === undefined) {
    target[name] = value;
    return;
  }
  if (Array.isArray(current)) {
    current.push(value);
    return;
  }
  target[name] = [current, value];
}

function finalizeNode(node: XmlNode): unknown {
  const record: XmlRecord = {};
  for (const child of node.children) {
    appendChild(record, child.name, child.value);
  }
  const text = node.text.join("").trim();
  if (!node.children.length) return text;
  if (text) record["#text"] = text;
  return record;
}

function tagName(value: string) {
  return value
    .replace(/^<\/?/, "")
    .replace(/\/?>$/, "")
    .trim()
    .split(/\s+/, 1)[0];
}

/**
 * Shopling 조회 응답에 필요한 XML 하위집합만 파싱한다.
 * 선언·주석·CDATA·반복 태그·기본 엔티티를 지원하고 DTD/외부 엔티티는 무시한다.
 */
export function parseSimpleXml(value: string): XmlRecord {
  const source = String(value ?? "").replace(/^\uFEFF/, "").trim();
  if (!source) throw new Error("XML_EMPTY");

  const tokens =
    source.match(
      /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<[^>]+>|[^<]+/g,
    ) ?? [];
  const root: XmlNode = { name: "$root", children: [], text: [] };
  const stack: XmlNode[] = [root];

  for (const token of tokens) {
    if (
      token.startsWith("<?") ||
      token.startsWith("<!--") ||
      token.startsWith("<!DOCTYPE")
    ) {
      continue;
    }
    if (token.startsWith("<![CDATA[")) {
      stack.at(-1)?.text.push(token.slice(9, -3));
      continue;
    }
    if (token.startsWith("</")) {
      if (stack.length <= 1) throw new Error("XML_UNEXPECTED_CLOSE");
      const closingName = tagName(token);
      const node = stack.pop()!;
      if (node.name !== closingName) {
        throw new Error(`XML_TAG_MISMATCH:${node.name}:${closingName}`);
      }
      stack.at(-1)!.children.push({
        name: node.name,
        value: finalizeNode(node),
      });
      continue;
    }
    if (token.startsWith("<")) {
      if (token.startsWith("<!")) continue;
      const name = tagName(token);
      if (!name) throw new Error("XML_TAG_NAME_REQUIRED");
      if (token.endsWith("/>")) {
        stack.at(-1)!.children.push({ name, value: "" });
      } else {
        stack.push({ name, children: [], text: [] });
      }
      continue;
    }

    const decoded = decodeXmlEntities(token);
    if (decoded.trim()) stack.at(-1)?.text.push(decoded);
  }

  if (stack.length !== 1) {
    throw new Error(`XML_UNCLOSED_TAG:${stack.at(-1)?.name ?? "unknown"}`);
  }
  const result = finalizeNode(root);
  return result && typeof result === "object" && !Array.isArray(result)
    ? (result as XmlRecord)
    : {};
}
