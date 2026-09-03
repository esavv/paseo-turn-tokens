import { access, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function resolveUserPath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return isAbsolute(value) ? value : resolve(value);
}

export async function findFileByName(root: string, fileName: string): Promise<string | null> {
  return findFile(root, (candidate) => candidate === fileName);
}

export async function findFileBySuffix(root: string, suffix: string): Promise<string | null> {
  return findFile(root, (candidate) => candidate.endsWith(suffix));
}

async function findFile(
  root: string,
  matches: (fileName: string) => boolean,
): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (entry.isFile() && matches(entry.name)) return join(root, entry.name);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = await findFile(join(root, entry.name), matches);
    if (match) return match;
  }
  return null;
}

export async function parseJsonLinesFile(filePath: string, sourceName: string): Promise<unknown[]> {
  const source = await readFile(filePath, "utf8");
  const lines = source.split(/\r?\n/u);
  const hasTerminatedFinalLine = source.endsWith("\n") || source.endsWith("\r");
  let lastContentIndex = lines.length - 1;
  while (lastContentIndex >= 0 && !lines[lastContentIndex]?.trim()) lastContentIndex -= 1;

  const records: unknown[] = [];
  for (let index = 0; index <= lastContentIndex; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      if (index === lastContentIndex && !hasTerminatedFinalLine) continue;
      throw new Error(`${sourceName} contains invalid JSON on line ${index + 1}`);
    }
  }
  return records;
}
