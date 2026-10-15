type DeadlineOrder = { id: number; customer: string; ship_by: string };

export function dueReminders(
  orders: DeadlineOrder[],
  now: Date,
  timeZone: string,
) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  if (Number(parts.hour) < 9) return [];
  const today = Date.parse(`${parts.year}-${parts.month}-${parts.day}`);
  return orders.flatMap((order) => {
    const days = (Date.parse(order.ship_by) - today) / 86400000;
    if (!Number.isFinite(days) || days > 2) return [];
    const overdue = days < 0;
    const kind = overdue
      ? ("deadline_overdue" as const)
      : ("deadline_soon" as const);
    const detail = overdue
      ? `Order #${order.id} for ${order.customer} is overdue (ship by ${order.ship_by}).`
      : `Order #${order.id} for ${order.customer} is due to ship ${days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`} (${order.ship_by}).`;
    return [{ order, kind, detail }];
  });
}
