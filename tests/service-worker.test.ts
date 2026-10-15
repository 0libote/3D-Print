import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

test("only same-origin messages can activate a service worker update", async () => {
  const listeners = new Map<string, (event: unknown) => void>();
  let activations = 0;
  runInNewContext(await Bun.file("public/sw.js").text(), {
    self: {
      location: { origin: "https://studio.example" },
      addEventListener: (type: string, handler: (event: unknown) => void) =>
        listeners.set(type, handler),
      skipWaiting: () => activations++,
    },
  });
  const message = listeners.get("message")!;
  for (const origin of ["https://other.example", "", undefined]) {
    message({ origin, data: { type: "ACTIVATE_UPDATE" } });
  }
  expect(activations).toBe(0);
  message({ origin: "https://studio.example", data: { type: "OTHER" } });
  expect(activations).toBe(0);
  message({
    origin: "https://studio.example",
    data: { type: "ACTIVATE_UPDATE" },
  });
  expect(activations).toBe(1);
});

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { versionServiceWorker } from "../scripts/version-service-worker";

test("shell versions hash contents, include public assets and replace every token", () => {
  const root = mkdtempSync(join(tmpdir(), "printroom-shell-"));
  const worker =
    'const CACHE = "__BUILD_ID__"; const VERSION = "__BUILD_ID__";';
  const build = () => {
    writeFileSync(join(root, "sw.js"), worker);
    return versionServiceWorker(root);
  };
  try {
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "<html>one</html>");
    writeFileSync(join(root, "assets/app.js"), "original");
    writeFileSync(join(root, "icon-192.png"), "icon one");
    const first = build();
    expect(build()).toBe(first);
    expect(readFileSync(join(root, "sw.js"), "utf8")).toBe(
      worker.replaceAll("__BUILD_ID__", first),
    );
    writeFileSync(join(root, "assets/app.js"), "modified");
    const second = build();
    expect(second).not.toBe(first);
    writeFileSync(join(root, "icon-192.png"), "icon two");
    const third = build();
    expect(third).not.toBe(second);
    writeFileSync(join(root, "index.html"), "<html>two</html>");
    expect(build()).not.toBe(third);
    writeFileSync(join(root, "sw.js"), worker + "// worker logic changed");
    const changedWorker = versionServiceWorker(root);
    expect(changedWorker).not.toBe(build());
    expect(() => versionServiceWorker(root)).toThrow("missing __BUILD_ID__");
    rmSync(join(root, "sw.js"));
    expect(() => versionServiceWorker(root)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shell includes manifest, icons and locally bundled fonts", async () => {
  const worker = await Bun.file("public/sw.js").text();
  const manifest = await Bun.file("public/manifest.webmanifest").json();
  const shell = worker.match(/const SHELL = (\[[\s\S]*?\]);/)![1];
  const urls = JSON.parse(shell.replace(/,\s*\]/, "]")) as string[];
  expect(urls).toContain("/manifest.webmanifest");
  for (const icon of manifest.icons) {
    expect(["any", "maskable"]).toContain(icon.purpose);
    expect(urls).toContain(icon.src);
  }
  for (const url of urls.filter((url) => url !== "/"))
    expect(await Bun.file("public" + url).exists()).toBe(true);
});
