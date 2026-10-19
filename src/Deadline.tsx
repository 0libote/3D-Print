import type { Order } from "../shared/models";

export const shipDate = (s: string) =>
  new Date(`${s}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
export function Deadline({ order }: { order: Order }) {
  if (!order.ship_by)
    return <span className="deadline-empty">No deadline</span>;
  const pending =
    order.status !== "shipped" && !order.cancelled && !order.archived;
  const overdue = pending && order.ship_by < todayKey();
  const today = pending && order.ship_by === todayKey();
  const days = (Date.parse(order.ship_by) - Date.parse(todayKey())) / 86400000;
  const soon = pending && days > 0 && days <= 2;
  return (
    <span
      className={`deadline${overdue ? " overdue" : today ? " today" : soon ? " upcoming" : ""}`}
    >
      {overdue
        ? "Overdue · "
        : today
          ? "Due today · "
          : soon
            ? days === 1
              ? "Due tomorrow · "
              : "Due in 2 days · "
            : "Ship by "}
      {shipDate(order.ship_by)}
    </span>
  );
}
