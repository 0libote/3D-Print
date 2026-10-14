import type { Database } from "bun:sqlite";
import { orderStatus, type ItemStatus } from "../shared/order-progress";

export class RequestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export type Piece = {
  id: number;
  item_id: number;
  ordinal: number;
  status: ItemStatus;
  version: number;
};
type Counts = {
  quantity: number;
  printed_quantity: number;
  shipped_quantity: number;
  status: ItemStatus;
};

export function production(db: Database) {
  const pieces = (itemId: number) =>
    db
      .query<Piece, [number]>(
        "SELECT * FROM order_pieces WHERE item_id=? ORDER BY ordinal",
      )
      .all(itemId);
  function sync(itemId: number) {
    const rows = pieces(itemId);
    const printed = rows.filter(
      (p) => p.status === "printed" || p.status === "shipped",
    ).length;
    const shipped = rows.filter((p) => p.status === "shipped").length;
    const status: ItemStatus =
      shipped === rows.length
        ? "shipped"
        : printed === rows.length
          ? "printed"
          : rows.some((p) => p.status === "printing")
            ? "printing"
            : "queued";
    db.query(
      "UPDATE order_items SET printed_quantity=?,shipped_quantity=?,status=?,version=version+1 WHERE id=?",
    ).run(printed, shipped, status, itemId);
    const item = db
      .query<{ order_id: number }, [number]>(
        "SELECT order_id FROM order_items WHERE id=?",
      )
      .get(itemId);
    if (!item) return;
    const states = db
      .query<{ status: ItemStatus }, [number]>(
        "SELECT status FROM order_items WHERE order_id=?",
      )
      .all(item.order_id);
    // Partial completed work also means an order is in progress, even with no active print.
    const aggregate = orderStatus(states.map((s) => s.status));
    const partial =
      aggregate === "new" &&
      !!db
        .query(
          "SELECT id FROM order_items WHERE order_id=? AND printed_quantity>0 LIMIT 1",
        )
        .get(item.order_id);
    db.query(
      "UPDATE orders SET status=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND is_draft=0",
    ).run(partial ? "printing" : aggregate, item.order_id);
  }
  function reconcile(itemId: number, counts: Counts) {
    const existing = pieces(itemId);
    const byOrdinal = new Map(existing.map((piece) => [piece.ordinal, piece]));
    if (existing.some((p) => p.status === "printing"))
      throw new RequestError(
        "Finish or stop the active print before editing this item",
        409,
      );
    const previousPrinted = existing.filter(
      (p) => p.status === "printed" || p.status === "shipped",
    ).length;
    const previousShipped = existing.filter(
      (p) => p.status === "shipped",
    ).length;
    const preserve =
      previousPrinted === counts.printed_quantity &&
      previousShipped === counts.shipped_quantity;
    if (
      preserve &&
      existing.some((p) => p.ordinal > counts.quantity && p.status !== "queued")
    )
      throw new RequestError(
        "Cannot remove a completed piece by reducing quantity. Correct its progress first",
        409,
      );
    // Preserve piece IDs so job/shipment history remains attached to the same piece.
    for (let ordinal = 1; ordinal <= counts.quantity; ordinal++) {
      const status = preserve
        ? byOrdinal.get(ordinal)?.status || "queued"
        : ordinal <= counts.shipped_quantity
          ? "shipped"
          : ordinal <= counts.printed_quantity
            ? "printed"
            : "queued";
      db.query(
        "INSERT INTO order_pieces(item_id,ordinal,status) VALUES(?,?,?) ON CONFLICT(item_id,ordinal) DO UPDATE SET status=excluded.status,version=version+1",
      ).run(itemId, ordinal, status);
    }
    db.query("DELETE FROM order_pieces WHERE item_id=? AND ordinal>?").run(
      itemId,
      counts.quantity,
    );
    sync(itemId);
  }
  function transition(
    pieceId: number,
    action: string,
    version: number,
    actorId: number,
    printer: string,
    notes: string,
    actualGrams?: number,
  ) {
    const runTransition = db.transaction(() => {
      const materialTracking =
        db
          .query<{ value: string }, []>(
            "SELECT value FROM app_settings WHERE key='material_tracking'",
          )
          .get()?.value === "true";
      const costReporting =
        db
          .query<{ value: string }, []>(
            "SELECT value FROM app_settings WHERE key='cost_reporting'",
          )
          .get()?.value === "true";
      const piece = db
        .query<
          Piece & {
            order_id: number;
            is_draft: number;
            cancelled: number;
            archived: number;
            product_name: string;
            filament_id: number | null;
            grams_per_piece: number;
            minutes_per_piece: number;
            machine_hourly_rate: number;
            electricity_per_kwh: number;
            printer_watts: number;
            cost_per_kg: number;
            currency: string;
          },
          [number]
        >(
          `SELECT p.*,i.order_id,i.product_name,i.filament_id,i.grams_per_piece,i.minutes_per_piece,i.cost_per_kg,o.currency,o.machine_hourly_rate,o.electricity_per_kwh,o.printer_watts,o.is_draft,o.cancelled,o.archived FROM order_pieces p JOIN order_items i ON i.id=p.item_id JOIN orders o ON o.id=i.order_id WHERE p.id=?`,
        )
        .get(pieceId);
      if (!piece) throw new RequestError("Piece not found", 404);
      if (piece.version !== version)
        throw new RequestError(
          "This piece changed. Refresh and try again",
          409,
        );
      if (piece.is_draft || piece.cancelled || piece.archived)
        throw new RequestError(
          "Only an active confirmed order can move through production",
          409,
        );
      const active = db
        .query<{ id: number; piece_id: number }, []>(
          "SELECT id,piece_id FROM print_jobs WHERE status='running'",
        )
        .get();
      let next: ItemStatus;
      if (action === "start") {
        if (piece.status !== "queued")
          throw new RequestError("Only queued pieces can start", 409);
        if (active)
          throw new RequestError(
            "A piece is already printing. Finish or stop it first",
            409,
          );
        const stock =
          materialTracking && piece.filament_id
            ? db
                .query<{ remaining_grams: number }, [number]>(
                  "SELECT remaining_grams FROM filaments WHERE id=?",
                )
                .get(piece.filament_id)
            : null;
        if (stock && stock.remaining_grams < piece.grams_per_piece)
          throw new RequestError(
            "Not enough recorded filament for this piece",
            409,
          );
        db.query(
          "INSERT INTO print_jobs(piece_id,operator_id,printer,notes,product_name_snapshot,order_id_snapshot,ordinal_snapshot,estimated_minutes,estimated_grams,currency,machine_hourly_rate,electricity_per_kwh,printer_watts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          pieceId,
          actorId,
          printer,
          notes,
          piece.product_name,
          piece.order_id,
          piece.ordinal,
          piece.minutes_per_piece,
          piece.grams_per_piece,
          piece.currency,
          costReporting ? piece.machine_hourly_rate : 0,
          costReporting ? piece.electricity_per_kwh : 0,
          costReporting ? piece.printer_watts : 0,
        );
        next = "printing";
      } else if (
        action === "complete" ||
        action === "fail" ||
        action === "stop"
      ) {
        if (piece.status !== "printing" || active?.piece_id !== pieceId)
          throw new RequestError("This piece is not the active print", 409);
        const stock =
          materialTracking && piece.filament_id
            ? db
                .query<{ remaining_grams: number }, [number]>(
                  "SELECT remaining_grams FROM filaments WHERE id=?",
                )
                .get(piece.filament_id)
            : null;
        const used =
          !materialTracking || action === "stop"
            ? 0
            : (actualGrams ?? piece.grams_per_piece);
        if (stock && used > stock.remaining_grams)
          throw new RequestError(
            "Not enough recorded filament. Correct the remaining grams first",
            409,
          );
        if (stock && used > 0) {
          const decremented = db
            .query(
              "UPDATE filaments SET remaining_grams=remaining_grams-?,version=version+1 WHERE id=? AND remaining_grams>=?",
            )
            .run(used, piece.filament_id, used);
          if (!decremented.changes)
            throw new RequestError(
              "Not enough recorded filament. Correct the remaining grams first",
              409,
            );
          db.query(
            "INSERT INTO stock_movements(filament_id,actor_id,grams_delta,detail) VALUES(?,?,?,?)",
          ).run(
            piece.filament_id,
            actorId,
            -used,
            `${action === "fail" ? "Failed" : "Completed"} print of ${piece.product_name}, piece ${piece.ordinal}`,
          );
        }
        db.query(
          "UPDATE print_jobs SET status=?,finished_at=CURRENT_TIMESTAMP,actual_minutes=MAX(0,(julianday('now')-julianday(started_at))*1440),machine_cost=MAX(0,(julianday('now')-julianday(started_at))*24)*machine_hourly_rate,energy_cost=MAX(0,(julianday('now')-julianday(started_at))*24)*printer_watts/1000*electricity_per_kwh,actual_grams=?,material_cost=?,notes=CASE WHEN ?='' THEN notes ELSE ? END WHERE id=?",
        ).run(
          action === "complete"
            ? "completed"
            : action === "fail"
              ? "failed"
              : "stopped",
          used,
          costReporting ? (used * piece.cost_per_kg) / 1000 : 0,
          notes,
          notes,
          active.id,
        );
        next = action === "complete" ? "printed" : "queued";
      } else if (action === "ship") {
        if (piece.status !== "printed")
          throw new RequestError("Print this piece before shipping it", 409);
        next = "shipped";
      } else if (action === "reprint") {
        if (piece.status !== "printed")
          throw new RequestError(
            "Only unshipped printed pieces can be reprinted",
            409,
          );
        next = "queued";
      } else throw new RequestError("Unknown piece action");
      db.query(
        "UPDATE order_pieces SET status=?,version=version+1 WHERE id=?",
      ).run(next, pieceId);
      sync(piece.item_id);
      return { ...piece, status: next };
    });
    try {
      return runTransition();
    } catch (error) {
      if (error instanceof RequestError) throw error;
      // Only the single-active-print guards (one_active_piece,
      // one_running_job) may surface here as UNIQUE violations on the
      // status columns. Any other constraint failure is unexpected and
      // must not be misreported as an active print.
      if (
        error instanceof Error &&
        /UNIQUE constraint failed:\s*(order_pieces|print_jobs)\.status|one_active_piece|one_running_job/i.test(
          error.message,
        )
      )
        throw new RequestError(
          "A piece is already printing. Finish or stop it first",
          409,
        );
      throw error;
    }
  }
  return { pieces, sync, reconcile, transition };
}
