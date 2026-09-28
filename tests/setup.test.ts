import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let dataDir: string;
let port: number;
let child: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "printroom-setup-test-"));
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
  port = reservation.port;
  reservation.stop(true);
  child = Bun.spawn([process.execPath, "run", resolve("server/index.ts")], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port) },
    stdout: "ignore",
    stderr: "ignore"
  });

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://localhost:${port}/api/bootstrap`);
      if (response.ok) return;
    } catch {}
    await Bun.sleep(50);
  }
  throw new Error("Test server did not start");
}, 10_000);

afterAll(async () => {
  child?.kill();
  if (child) await child.exited;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test("concurrent first-time setup creates only one owner", async () => {
  const setup = (username: string) => fetch(`http://localhost:${port}/api/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Studio owner", username, password: "test-password" })
  });

  const responses = await Promise.all([setup("owner-one"), setup("owner-two")]);
  expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
});
