import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export async function importTranspiledTypeScript(sourceUrl) {
  const directory = await mkdtemp(join(tmpdir(), "commerce-os-ts-test-"));
  try {
    const source = await readFile(sourceUrl, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: sourceUrl.pathname,
    });
    const outputPath = join(directory, `${basename(sourceUrl.pathname, ".ts")}.mjs`);
    await writeFile(outputPath, output.outputText);
    return await import(pathToFileURL(outputPath).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
