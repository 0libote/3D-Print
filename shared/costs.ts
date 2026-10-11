import type { Order } from "./models";

export function orderCostEstimate(order: Order) {
  let material = 0,
    hours = 0,
    revenue = 0;
  for (const item of order.items) {
    material +=
      (item.quantity * item.grams_per_piece * item.cost_per_kg) / 1000;
    hours += (item.quantity * item.minutes_per_piece) / 60;
    revenue += item.quantity * item.unit_price;
  }
  const machine = hours * order.machine_hourly_rate;
  const energy =
    ((hours * order.printer_watts) / 1000) * order.electricity_per_kwh;
  return {
    material,
    machine,
    energy,
    revenue,
    total: material + machine + energy,
  };
}
