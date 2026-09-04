import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parseJsonLinesFile } from "../src/usage.jsonl.server";

async function withJsonlFile(content: string, test: (filePath: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "paseo-token-usage-"));
  const filePath = join(directory, "session.jsonl");
  try {
    await writeFile(filePath, content);
    await test(filePath);
  } finally {
    await rm(directory, { recursive: true });
  }
}

it("ignores an incomplete final JSONL write", async () => {
  await withJsonlFile('{"id":1}\n{"id":', async (filePath) => {
    await expect(parseJsonLinesFile(filePath, "Test session")).resolves.toEqual([{ id: 1 }]);
  });
});

it("rejects a malformed terminated JSONL record", async () => {
  await withJsonlFile('{"id":1}\ninvalid\n', async (filePath) => {
    await expect(parseJsonLinesFile(filePath, "Test session")).rejects.toThrow(
      "Test session contains invalid JSON on line 2",
    );
  });
});
