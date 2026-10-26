import { useDecision } from "./useDecision";
import { useFeatures } from "./Features";
import { useEffect, useState } from "react";
import { Printer, Truck } from "lucide-react";
import type { PieceEntry } from "../shared/models";
import { Deadline } from "./Deadline";

export type PieceAction =
  "start" | "complete" | "fail" | "stop" | "ship" | "reprint";
type Props = {
  entries: PieceEntry[];
  activePieceId?: number;
  busy: boolean;
  pending?: Record<string, boolean>;
  onAction: (
    entry: PieceEntry,
    action: PieceAction,
    printer?: string,
    notes?: string,
    actualGrams?: number,
  ) => void;
  onOpen: (id: number) => void;
  emptyText: string;
  mode?: "print" | "ship";
};
export function PieceQueue({
  entries,
  activePieceId,
  busy,
  pending = {},
  onAction,
  onOpen,
  emptyText,
  mode = "print",
}: Props) {
  const { confirm, prompt, decision } = useDecision();
  const features = useFeatures();
  const [printer, setPrinter] = useState(() => {
    try {
      const saved = localStorage.getItem("printroom-printer");
      return saved && /^[\p{L}\p{N} ._()-]{1,100}$/u.test(saved)
        ? saved
        : "Studio printer";
    } catch {
      return "Studio printer";
    }
  });
  const [weights, setWeights] = useState<Record<number, string>>({});
  const [limit, setLimit] = useState(50);
  const entryKey = entries
    .map(
      (entry) =>
        `${entry.piece.id}:${entry.piece.version}:${entry.piece.status}:${entry.item.version}:${entry.item.grams_per_piece}`,
    )
    .join(",");
  useEffect(() => {
    setLimit(50);
    setWeights({});
  }, [entryKey]);
  const gramsFor = (id: number, fallback: number) => {
    const raw = Number(weights[id] ?? fallback);
    const base = Number.isFinite(raw)
      ? raw
      : Number.isFinite(fallback)
        ? fallback
        : 0;
    return Math.min(100000, Math.max(0, base));
  };
  return (
    <div className="piece-queue">
      {decision}
      {mode === "print" && (
        <div
          className={`queue-printer${activePieceId ? " is-busy" : " is-free"}`}
          role="status"
        >
          <label>
            {features.production_tools ? "Printer" : "Status"}{" "}
            {features.production_tools && (
              <input
                aria-label="Printer name"
                value={printer}
                maxLength={100}
                onChange={(e) => {
                  setPrinter(e.target.value);
                  if (/^[\p{L}\p{N} ._()-]{0,100}$/u.test(e.target.value)) {
                    try {
                      localStorage.setItem("printroom-printer", e.target.value);
                    } catch {
                      // Printer selection still works when storage is unavailable.
                    }
                  }
                }}
              />
            )}
          </label>
          <span>
            {activePieceId
              ? "● Printing now — finish or stop it before starting another."
              : "○ Printer idle — pick the next queued piece to start."}
          </span>
        </div>
      )}
      {!entries.length ? (
        <p className="queue-empty">{emptyText}</p>
      ) : (
        entries.slice(0, limit).map((entry) => {
          const { order, item, piece } = entry;
          const rowPending = busy || !!pending[`order:${order.id}`];
          const active = piece.status === "printing";
          const blockedByOther = !!activePieceId && !active;
          return (
            <div
              className={`piece-row${active ? " active-piece" : ""}`}
              key={piece.id}
              aria-current={active ? "true" : undefined}
              style={{ ["--ticket-color" as string]: item.color }}
            >
              <span
                role="img"
                aria-label={`Colour ${item.color}`}
                className="print-swatch"
                style={{ background: item.color }}
              />
              <div className="piece-copy">
                <strong>{item.product_name}</strong>
                <span>
                  Piece {piece.ordinal} of {item.quantity} ·{" "}
                  {item.filament_name || "No filament selected"}
                </span>
                {features.production_tools && (
                  <small>
                    {item.minutes_per_piece
                      ? `${item.minutes_per_piece} min`
                      : "Time not estimated"}
                    {item.grams_per_piece ? ` · ${item.grams_per_piece} g` : ""}
                    {item.revision ? ` · ${item.revision}` : ""}
                  </small>
                )}
                {features.production_tools && item.production_url && (
                  <a
                    href={item.production_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Production file
                  </a>
                )}
              </div>
              <button
                type="button"
                className="print-order"
                onClick={() => onOpen(order.id)}
              >
                #{String(order.id).padStart(4, "0")} · {order.customer}
                {order.ship_by && (
                  <small className="piece-deadline">
                    <Deadline order={order} />
                  </small>
                )}
              </button>
              <div className="piece-actions">
                <span
                  className={`status status-${active ? "printing" : piece.status === "queued" ? "new" : piece.status}${active ? " is-active" : ""}`}
                  aria-live={active ? "polite" : undefined}
                >
                  <i aria-hidden="true" />
                  {active
                    ? "● Now printing"
                    : piece.status === "queued"
                      ? "Queued"
                      : "Ready to ship"}
                </span>
                {piece.status === "queued" && (
                  <button
                    type="button"
                    className="progress-button"
                    disabled={
                      rowPending ||
                      !!pending.printer ||
                      !!activePieceId ||
                      rowPending
                    }
                    title={
                      activePieceId
                        ? "Finish or stop the current print first"
                        : "Start this piece on the printer"
                    }
                    onClick={() => onAction(entry, "start", printer)}
                  >
                    <Printer aria-hidden="true" size={14} />{" "}
                    {blockedByOther ? "Waiting — printer busy" : "Start print"}
                  </button>
                )}
                {active && (
                  <>
                    {features.material_tracking && (
                      <label className="piece-weight">
                        Material used (g)
                        <input
                          aria-label={`Material used for piece ${piece.ordinal}`}
                          type="number"
                          min="0"
                          max="100000"
                          step="0.1"
                          value={
                            weights[piece.id] ?? String(item.grams_per_piece)
                          }
                          onChange={(e) =>
                            setWeights({
                              ...weights,
                              [piece.id]: e.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      className="auth-submit"
                      disabled={rowPending}
                      onClick={() =>
                        onAction(
                          entry,
                          "complete",
                          undefined,
                          undefined,
                          gramsFor(piece.id, item.grams_per_piece),
                        )
                      }
                    >
                      Complete piece
                    </button>
                    <button
                      type="button"
                      className="outline-button"
                      disabled={rowPending}
                      onClick={async () => {
                        const notes = await prompt(
                          "Why did this print fail? It will return to the queue. The material weight shown will be deducted.",
                        );
                        if (notes !== null)
                          onAction(
                            entry,
                            "fail",
                            undefined,
                            notes,
                            gramsFor(piece.id, item.grams_per_piece),
                          );
                      }}
                    >
                      Failed · requeue
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={rowPending}
                      onClick={() => onAction(entry, "stop")}
                    >
                      Stop without recording material use
                    </button>
                  </>
                )}
                {piece.status === "printed" && (
                  <>
                    <button
                      type="button"
                      className="progress-button"
                      disabled={rowPending}
                      onClick={() => onAction(entry, "ship")}
                    >
                      <Truck aria-hidden="true" size={14} /> Ship piece
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={rowPending}
                      onClick={async () => {
                        if (
                          await confirm(
                            "Requeue this unshipped piece for a replacement print?",
                          )
                        )
                          onAction(entry, "reprint");
                      }}
                    >
                      Reprint
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
      {entries.length > limit && (
        <button
          type="button"
          className="outline-button queue-more"
          onClick={() => setLimit(limit + 50)}
        >
          Show 50 more pieces ({entries.length - limit} remaining)
        </button>
      )}
    </div>
  );
}
