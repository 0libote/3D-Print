import { expect, test } from "bun:test";
import { apiPath } from "../shared/api-path";

test("API requests stay local and encode search values without changing routes", () => {
  expect(apiPath("/orders/12/items")).toBe("/api/orders/12/items");
  const query = "https://other.example/../logout?x=1&name=O'Brian 🖨";
  const result = new URL(
    apiPath(`/orders?filter=all&q=${encodeURIComponent(query)}`),
    "https://studio.example",
  );
  expect(result.origin).toBe("https://studio.example");
  expect(result.pathname).toBe("/api/orders");
  expect(result.searchParams.get("q")).toBe(query);
  for (const path of [
    "//other.example",
    "/../logout",
    "/orders/%2e%2e/logout",
    "https://other.example",
    "/orders#fragment",
  ])
    expect(() => apiPath(path)).toThrow("Invalid API path");
});
