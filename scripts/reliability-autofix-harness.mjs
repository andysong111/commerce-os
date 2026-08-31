function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function importedTypeScriptCompilerAliases(source) {
  const aliases = new Set();
  const pattern = /(?:^|\n)\s*import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s+["']typescript["']/g;
  for (const match of String(source || "").matchAll(pattern)) aliases.add(match[1]);
  return [...aliases];
}

function hasImportedTranspileHelper(source) {
  return /(?:^|\n)\s*import\s*\{[^}\n]*\bimportTranspiledTypeScript\b[^}\n]*\}\s*from\s*["'][^"']*transpileTypeScript\.mjs["']/m.test(
    String(source || ""),
  );
}

export function looksLikeExecutableTypeScriptHarness(content) {
  const source = String(content || "");

  for (const alias of importedTypeScriptCompilerAliases(source)) {
    const call = new RegExp(`\\b${escapeRegExp(alias)}\\.transpileModule\\s*\\(`);
    if (call.test(source)) return true;
  }

  return (
    hasImportedTranspileHelper(source) &&
    /\bimportTranspiledTypeScript\s*\(/.test(source)
  );
}
