import { useEffect, useState, useRef } from "react";
import type { Order } from "../shared/models";
import { countPieces } from "../shared/models";
import { exportOrders } from "./Studio";
import { Deadline } from "./Deadline";
import { Plus, Search, X } from "lucide-react";

const statusLabels: Record<string, string> = {
  draft: "Draft",
  new: "Queued",
  printing: "In progress",
  printed: "Ready to ship",
  shipped: "Shipped",
  cancelled: "Cancelled",
};

const labels = {
  all: "All orders",
  draft: "Drafts",
  active: "Active sales",
  shipped: "Shipped",
  cancelled: "Cancelled",
  archived: "Archived",
};
export type OrderFilter = keyof typeof labels;
type Filter = OrderFilter;
type Filters = { filter: Filter; query: string };
type Result = {
  orders: Order[];
  total: number;
  next: number | null;
  counts: Record<Filter, number>;
};
type Api = (
  path: string,
  method?: string,
  value?: unknown,
  query?: Record<string, string | number>,
) => Promise<any>;
export function OrdersBrowser({
  api,
  revision,
  showMoney,
  filters,
  onFiltersChange,
  onOpen,
  onCreate,
}: {
  api: Api;
  revision: unknown;
  showMoney: boolean;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onOpen: (id: number) => void;
  onCreate: () => void;
}) {
  const { filter, query } = filters;
  const [result, setResult] = useState<Result | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);

  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    ++generation.current;
    let cancelled = false;
    setBusy(true);
    setError("");
    const timer = setTimeout(() => {
      void api("/orders", "GET", undefined, { filter, q: query })
        .then((next: Result) => {
          if (!cancelled) setResult(next);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filter, query, revision]);
  async function more() {
    if (busy || !result?.next) return;
    const current = generation.current;
    setBusy(true);
    try {
      const next: Result = await api("/orders", "GET", undefined, {
        filter,
        q: query,
        before: result.next,
      });
      if (current === generation.current)
        setResult({ ...next, orders: [...result.orders, ...next.orders] });
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  async function exportAll() {
    if (exportProgress !== null) return;
    setExportProgress(0);
    setError("");
    try {
      let next: Result = await api("/orders", "GET", undefined, {
        filter,
        q: query,
      });
      const orders = [...next.orders];
      setExportProgress(orders.length);
      while (next.next) {
        next = await api("/orders", "GET", undefined, {
          filter,
          q: query,
          before: next.next,
        });
        orders.push(...next.orders);
        setExportProgress(orders.length);
      }
      exportOrders(orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportProgress(null);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">DRAFT TO DELIVERY</span>
          <h1>Orders</h1>
          <p>Prepare drafts, confirm sales and track every piece.</p>
        </div>
        <button className="auth-submit" onClick={onCreate}>
          <Plus aria-hidden="true" size={17} /> New draft
        </button>
      </div>
      <div className="orders-toolbar">
        <div className="filter-tabs">
          {(Object.keys(labels) as Filter[]).map((key) => (
            <button
              key={key}
              className={key === filter ? "selected" : ""}
              aria-pressed={key === filter}
              onClick={(event) => {
                onFiltersChange({ ...filters, filter: key });
                event.currentTarget.scrollIntoView({
                  block: "nearest",
                  inline: "nearest",
                  behavior: "smooth",
                });
              }}
            >
              {labels[key]}
              <span aria-live="polite">{result?.counts[key] ?? "…"}</span>
            </button>
          ))}
        </div>
        <div className="search">
          <Search aria-hidden="true" size={18} />
          <input
            type="search"
            aria-label="Search orders"
            maxLength={200}
            placeholder="Search orders, products or customers…"
            value={query}
            onChange={(e) =>
              onFiltersChange({ ...filters, query: e.target.value })
            }
          />
          {query && (
            <button
              type="button"
              className="icon-button"
              aria-label="Clear order search"
              onClick={() => onFiltersChange({ ...filters, query: "" })}
            >
              <X aria-hidden="true" size={17} />
            </button>
          )}
        </div>
      </div>
      <p className="muted orders-results">
        {result?.total ?? 0} matching orders{" "}
        <button
          className="text-button"
          disabled={exportProgress !== null}
          onClick={() => void exportAll()}
        >
          {exportProgress !== null
            ? `Exporting… ${exportProgress} orders loaded`
            : "Export CSV"}
        </button>
      </p>
      {exportProgress !== null && (
        <p role="status">Preparing CSV: {exportProgress} orders loaded…</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section
        className="panel table-panel orders-list"
        aria-label="Orders"
        aria-busy={busy}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ORDER</th>
                <th>CUSTOMER</th>
                <th>PIECES</th>
                <th>SHIP BY</th>
                <th>STATUS</th>
                {showMoney && <th>TOTAL</th>}
              </tr>
            </thead>
            <tbody>
              {result?.orders.map((order) => (
                <tr key={order.id}>
                  <td data-label="Order" className="order-cell-id">
                    <button
                      className="text-button order-open"
                      aria-label={`Open order #${String(order.id).padStart(4, "0")} for ${order.customer}`}
                      onClick={() => onOpen(order.id)}
                    >
                      #{String(order.id).padStart(4, "0")}
                    </button>
                  </td>
                  <td data-label="Customer" className="order-cell-customer">
                    <strong>{order.customer}</strong>
                  </td>
                  <td data-label="Pieces" className="order-cell-pieces">
                    {order.items.reduce((sum, i) => sum + i.quantity, 0)}
                  </td>
                  <td data-label="Ship by" className="order-cell-deadline">
                    <Deadline order={order} />
                  </td>
                  <td data-label="Status" className="order-cell-status">
                    {(() => {
                      const counts = countPieces(order);
                      const hasActive = order.items.some((item) =>
                        item.pieces.some(
                          (piece) => piece.status === "printing",
                        ),
                      );
                      const label = order.archived
                        ? "Archived"
                        : order.cancelled
                          ? "Cancelled"
                          : order.is_draft
                            ? "Draft"
                            : hasActive
                              ? "Now printing"
                              : (statusLabels[order.status] ?? order.status);
                      const tone = order.archived
                        ? "shipped"
                        : order.cancelled
                          ? "cancelled"
                          : order.is_draft
                            ? "draft"
                            : hasActive
                              ? "printing"
                              : order.status;
                      return (
                        <span className="order-status-wrap">
                          <span
                            className={`status status-${tone}${hasActive ? " is-active" : ""}`}
                          >
                            <i aria-hidden="true" />
                            {label}
                          </span>
                          {!order.is_draft &&
                            !order.cancelled &&
                            !order.archived &&
                            counts.total > 0 && (
                              <small className="order-status-sub">
                                {counts.shipped}/{counts.total} shipped
                                {counts.printed
                                  ? ` · ${counts.printed} ready`
                                  : ""}
                                {hasActive
                                  ? ""
                                  : counts.queued
                                    ? ` · ${counts.queued} queued`
                                    : ""}
                              </small>
                            )}
                        </span>
                      );
                    })()}
                  </td>
                  {showMoney && (
                    <td data-label="Total" className="order-cell-total">
                      {new Intl.NumberFormat("en-GB", {
                        style: "currency",
                        currency: order.currency,
                      }).format(
                        order.items.reduce(
                          (sum, i) => sum + i.unit_price * i.quantity,
                          0,
                        ),
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!busy && !error && !result?.orders.length && (
          <p className="queue-empty">No matching orders.</p>
        )}
        {busy && (
          <p role="status" className="queue-empty">
            Loading…
          </p>
        )}
        {result?.next && (
          <button
            className="outline-button queue-more"
            disabled={busy}
            onClick={() => void more()}
          >
            Load more orders
          </button>
        )}
      </section>
    </>
  );
}
