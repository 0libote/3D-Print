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
