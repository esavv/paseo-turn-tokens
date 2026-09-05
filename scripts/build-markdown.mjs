import { transformAsync } from "@babel/core";
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const bundle = await build({
  stdin: {
    contents: 'export { default } from "markdown-it/dist/markdown-it.js";',
    resolveDir: fileURLToPath(root),
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2020",
  write: false,
});
const source = bundle.outputFiles[0]?.text;
if (!source) throw new Error("Markdown parser build produced no output");

// Paseo 0.7.2 bypasses Metro and leaves classes intact, which Hermes cannot evaluate.
const transformed = await transformAsync(source, {
  babelrc: false,
  configFile: false,
  inputSourceMap: false,
  plugins: ["@babel/plugin-transform-classes"],
});
if (!transformed?.code) throw new Error("Markdown parser class transform produced no output");
await writeFile(new URL("src/markdown-it.generated.js", root), transformed.code + "\n");
