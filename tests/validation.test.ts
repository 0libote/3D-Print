import { expect, test } from "bun:test";
import { positiveNumber } from "../server/validation";

test("optional positive numbers preserve absence and validate supplied values", () => {
  expect(positiveNumber(undefined, "Amount")).toBeUndefined();
  expect(positiveNumber(0, "Amount")).toBe(0);
  expect(positiveNumber("12.5", "Amount")).toBe(12.5);
  for (const value of [-1, NaN, Infinity, 1000001])
    expect(() => positiveNumber(value, "Amount")).toThrow();
});
