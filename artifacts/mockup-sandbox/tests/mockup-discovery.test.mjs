import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mockupPreviewPlugin } from "../mockupPreviewPlugin.ts";

test("preview discovery retains nested TSX files and excludes private and hidden files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mockup-discovery-"));
  try {
    for (const name of [
      "Public.tsx",
      "nested/Example.tsx",
      "_Private.tsx",
      "_private/Nested.tsx",
      "nested/_Private.tsx",
      ".hidden.tsx",
      ".hidden/Nested.tsx",
      "Other.ts",
    ]) {
      const file = path.join(root, "src/components/mockups", name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "export default function Example() { return null; }\n");
    }
    const plugin = mockupPreviewPlugin();
    plugin.configResolved({ root });
    await plugin.buildStart();
    const generatedPath = path.join(root, "src/.generated/mockup-components.ts");
    const source = await readFile(generatedPath, "utf8");
    const keys = [...source.matchAll(/^\s+"([^"]+)":/gm)].map((m) => m[1]).sort();
    assert.deepEqual(keys, [
      "./components/mockups/Public.tsx",
      "./components/mockups/nested/Example.tsx",
    ]);
    assert.ok(source.includes('import("../components/mockups/nested/Example.tsx")'));

    await rm(path.join(root, "src/components/mockups/Public.tsx"));
    await plugin.buildStart();
    assert.ok(!(await readFile(generatedPath, "utf8")).includes("Public.tsx"));

    await rm(path.join(root, "src/components/mockups"), { recursive: true });
    await plugin.buildStart();
    assert.ok((await readFile(generatedPath, "utf8")).includes("export const modules: ModuleMap = {\n\n};"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
