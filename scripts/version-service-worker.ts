import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export function versionServiceWorker(directory: string) {
  const workerPath = join(directory, "sw.js");
  const worker = readFileSync(workerPath, "utf8");
  if (!worker.includes("__BUILD_ID__"))
    throw new Error("Service worker is missing __BUILD_ID__ placeholder");
  const files = readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => path !== workerPath)
    .sort();
  const hash = createHash("sha256").update(worker);
  for (const path of files) {
    const content = readFileSync(path);
    hash.update(JSON.stringify([relative(directory, path), content.length]));
    hash.update(content);
  }
  const buildId = hash.digest("hex").slice(0, 16);
  const versioned = worker.replaceAll("__BUILD_ID__", buildId);
  writeFileSync(workerPath, versioned);
  return buildId;
}
