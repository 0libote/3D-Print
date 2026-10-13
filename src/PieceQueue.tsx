import { useFeatures } from "./Features";
import { useState } from "react";
import { Printer, Truck } from "lucide-react";
import type { PieceEntry } from "../shared/models";

export type PieceAction =
  "start" | "complete" | "fail" | "stop" | "ship" | "reprint";
type Props = {
  entries: PieceEntry[];
  activePieceId?: number;
  busy: boolean;
  pendingKey?: string | null;
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
  pendingKey = null,
  onAction,
  onOpen,
  emptyText,
  mode = "print",
}: Props) {
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
      {mode === "print" && features.production_tools && (
        <div className="queue-printer">
          <label>
            Printer{" "}
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
          </label>
          <span>
            {activePieceId
              ? "One piece is printing. Finish or stop it before starting another."
              : "Printer available · one piece at a time"}
          </span>
        </div>
      )}
      {!entries.length ? (
        <p className="queue-empty">{emptyText}</p>
      ) : (
        entries.slice(0, limit).map((entry) => {
          const { order, item, piece } = entry;
          const active = piece.status === "printing";
          return (
            <div
              className={`piece-row${active ? " active-piece" : ""}`}
              key={piece.id}
            >
              <span
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
                    Ship by {order.ship_by}
                  </small>
                )}
              </button>
              <div className="piece-actions">
                <span
                  className={`status status-${active ? "printing" : piece.status === "queued" ? "new" : piece.status}`}
                >
                  {active
                    ? "Printing now"
                    : piece.status === "queued"
                      ? "Queued"
                      : "Ready to ship"}
                </span>
                {piece.status === "queued" && (
                  <button
                    type="button"
                    className="progress-button"
                    disabled={
                      busy ||
                      !!activePieceId ||
                      pendingKey === `${piece.id}:start`
                    }
                    onClick={() => onAction(entry, "start", printer)}
                  >
                    <Printer size={14} /> Start print
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
                      disabled={busy || pendingKey === `${piece.id}:complete`}
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
                      disabled={busy || pendingKey === `${piece.id}:fail`}
                      onClick={() => {
                        const notes = prompt(
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
                      disabled={busy || pendingKey === `${piece.id}:stop`}
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
                      disabled={busy || pendingKey === `${piece.id}:ship`}
                      onClick={() => onAction(entry, "ship")}
                    >
                      <Truck size={14} /> Ship piece
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy || pendingKey === `${piece.id}:reprint`}
                      onClick={() => {
                        if (
                          confirm(
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
