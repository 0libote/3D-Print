export type ItemStatus = "queued" | "printing" | "printed" | "shipped";

export function progressStage(quantity: number, printed: number, shipped: number, previous: ItemStatus): ItemStatus {
  if (shipped === quantity) return "shipped";
  if (printed === quantity) return "printed";
  if (printed > 0 || shipped > 0 || previous === "printing") return "printing";
  return "queued";
}

export function orderStatus(statuses: ItemStatus[]): "new" | "printing" | "printed" | "shipped" {
  if (statuses.length && statuses.every(status => status === "shipped")) return "shipped";
  if (statuses.length && statuses.every(status => status === "printed" || status === "shipped")) return "printed";
  if (statuses.some(status => status !== "queued")) return "printing";
  return "new";
}
