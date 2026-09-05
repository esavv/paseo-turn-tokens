import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { expect, it } from "vitest";

it("bundles the Markdown renderer for Paseo's client runtime and compiles for Hermes", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["src/markdown.client.tsx"],
    bundle: true,
    platform: "neutral",
    target: "es2020",
    format: "cjs",
    supported: { "async-await": false },
    external: ["react", "react/jsx-runtime", "react-native"],
    write: false,
    metafile: true,
  });
  const code = result.outputFiles[0]?.text;
  if (!code) throw new Error("No Markdown client bundle");
  const externals = Object.values(result.metafile.outputs).flatMap((output) => output.imports);
  expect(
    externals.every((entry) => ["react", "react/jsx-runtime", "react-native"].includes(entry.path)),
  ).toBe(true);

  // Match Paseo's CommonJS wrapper and eager host-module interop.
  const wrapped = `(function(require) { const module = { exports: {} }; const exports = module.exports;
${code.replaceAll("get: () => from[key]", "value: from[key]")}
return module.exports; })`;
  const evaluate: unknown = runInNewContext(wrapped, {});
  if (typeof evaluate !== "function") throw new Error("Invalid client wrapper");
  const modules: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "react-native": { Text: "Text", View: "View", ScrollView: "ScrollView", Linking: {} },
  };
  const exported: unknown = evaluate((id: string) => {
    if (!(id in modules)) throw new Error(`Unexpected host module: ${id}`);
    return modules[id];
  });
  if (
    !exported ||
    typeof exported !== "object" ||
    !("MarkdownMessage" in exported) ||
    typeof exported.MarkdownMessage !== "function"
  ) {
    throw new Error("Missing Markdown renderer export");
  }
  const tree: unknown = exported.MarkdownMessage({
    text: "# Heading\n\n**Bold** and `code`",
    theme: { colors: { foreground: "white", surface2: "black" } },
    layout: { platform: "ios", compact: true },
  });
  expect(React.isValidElement(tree)).toBe(true);
  expect(JSON.stringify(tree)).toContain('"accessibilityRole":"header"');

  const platform =
    process.platform === "darwin"
      ? "osx-bin"
      : process.platform === "win32"
        ? "win64-bin"
        : "linux64-bin";
  const binary = process.platform === "win32" ? "hermesc.exe" : "hermesc";
  const compiler = path.join(root, "node_modules/react-native/sdks/hermesc", platform, binary);
  const check = spawnSync(compiler, ["-dump-bytecode", "-"], {
    input: wrapped,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  expect(check.error, check.error?.message).toBeUndefined();
  expect(check.status, check.stderr).toBe(0);
}, 30_000);
