export type CostRates = {
  machine_hourly_rate: number;
  electricity_per_kwh: number;
  printer_watts: number;
};
export type User = {
  id: number;
  name: string;
  username: string;
  is_admin: number;
};
export type ItemStage = "queued" | "printing" | "printed" | "shipped";
export type Piece = {
  id: number;
  item_id: number;
  ordinal: number;
  status: ItemStage;
  version: number;
};
export type ProductionDetails = {
  grams_per_piece: number;
  minutes_per_piece: number;
  production_url: string;
  revision: string;
  print_profile: string;
};
export type Filament = {
  id: number;
  version: number;
  archived: number;
  name: string;
  brand: string;
  material: string;
  color: string;
  notes: string;
  image_url: string;
  spool_count: number;
  grams_per_spool: number;
  remaining_grams: number;
  cost_per_kg: number;
};
export type Product = ProductionDetails & {
  id: number;
  version: number;
  archived: number;
  name: string;
  description: string;
  image_url: string;
  price: number;
  filament_ids: number[];
};
export type Item = ProductionDetails & {
  id: number;
  version: number;
  product_id: number | null;
  product_name: string;
  filament_id: number | null;
  filament_name: string;
  color: string;
  quantity: number;
  printed_quantity: number;
  shipped_quantity: number;
  unit_price: number;
  cost_per_kg: number;
  status: ItemStage;
  pieces: Piece[];
};
export type Status =
  "draft" | "new" | "printing" | "printed" | "shipped" | "cancelled";
export type Shipment = {
  id: number;
  carrier: string;
  tracking: string;
  created_at: string;
};
export type Order = CostRates & {
  actual_cost: number;
  running_jobs: number;
  id: number;
  version: number;
  customer: string;
  contact: string;
  notes: string;
  ship_by: string;
  status: Status;
  is_draft: number;
  cancelled: number;
  archived: number;
  currency: string;
  payment_status: string;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  items: Item[];
  shipments: Shipment[];
};
export type Job = {
  id: number;
  piece_id: number | null;
  operator_name: string | null;
  printer: string;
  notes: string;
  status: "running" | "completed" | "failed" | "stopped";
  started_at: string;
  finished_at: string | null;
  product_name: string | null;
  ordinal: number | null;
  order_id: number | null;
  estimated_minutes: number;
  estimated_grams: number;
  actual_grams: number;
  material_cost: number;
  machine_cost: number;
  energy_cost: number;
  actual_minutes: number;
  currency: string;
};
export type PieceEntry = { order: Order; item: Item; piece: Piece };

export function queueEntries(orders: Order[]): PieceEntry[] {
  return orders
    .filter((o) => !o.is_draft && !o.cancelled && !o.archived)
    .flatMap((order) =>
      order.items.flatMap((item) =>
        item.pieces.map((piece) => ({ order, item, piece })),
      ),
    )
    .sort(
      (a, b) =>
        Number(b.piece.status === "printing") -
          Number(a.piece.status === "printing") ||
        (a.order.ship_by || "9999-12-31").localeCompare(
          b.order.ship_by || "9999-12-31",
        ) ||
        a.order.id - b.order.id ||
        a.item.id - b.item.id ||
        a.piece.ordinal - b.piece.ordinal,
    );
}
