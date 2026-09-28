import { describe, expect, test } from "bun:test";
import { orderStatus, progressStage } from "../shared/order-progress";

describe("piece progress stage", () => {
  test("keeps untouched work queued and preserves an explicitly started stage", () => {
    expect(progressStage(3, 0, 0, "queued")).toBe("queued");
    expect(progressStage(3, 0, 0, "printing")).toBe("printing");
  });

  test("derives partial and complete stages from piece counts", () => {
    expect(progressStage(3, 1, 0, "queued")).toBe("printing");
    expect(progressStage(3, 3, 0, "printing")).toBe("printed");
    expect(progressStage(3, 3, 3, "printed")).toBe("shipped");
  });
});

describe("order status", () => {
  test("keeps empty and all queued orders in the queue", () => {
    expect(orderStatus([])).toBe("new");
    expect(orderStatus(["queued", "queued"])).toBe("new");
  });

  test("rolls mixed item stages up without marking unfinished work complete", () => {
    expect(orderStatus(["queued", "printing"])).toBe("printing");
    expect(orderStatus(["printed", "shipped"])).toBe("printed");
    expect(orderStatus(["shipped", "shipped"])).toBe("shipped");
    expect(orderStatus(["printed", "queued"])).toBe("printing");
  });
});
