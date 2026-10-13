import { useEffect, useState } from "react";
import type { Order } from "../shared/models";
import { exportOrders } from "./Studio";

const labels = {
  all: "All orders",
  draft: "Drafts",
  active: "Active sales",
  shipped: "Shipped",
  cancelled: "Cancelled",
  archived: "Archived",
};
type Filter = keyof typeof labels;
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
  onOpen,
  onCreate,
}: {
  api: Api;
  revision: unknown;
  showMoney: boolean;
  onOpen: (id: number) => void;
  onCreate: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all"),
    [query, setQuery] = useState(""),
    [result, setResult] = useState<Result | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);

  useEffect(() => {
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
    if (!result?.next) return;
    setBusy(true);
    try {
      const next: Result = await api("/orders", "GET", undefined, {
        filter,
        q: query,
        before: result.next,
      });
      setResult({ ...next, orders: [...result.orders, ...next.orders] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setBusy(false);
    }
  }
  async function exportAll() {
    setBusy(true);
    try {
      let next: Result = await api("/orders", "GET", undefined, {
        filter,
        q: query,
      });
      const orders = [...next.orders];
      while (next.next) {
        next = await api("/orders", "GET", undefined, {
          filter,
          q: query,
          before: next.next,
        });
        orders.push(...next.orders);
      }
      exportOrders(orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
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
          New draft
        </button>
      </div>
      <div className="orders-toolbar">
        <div className="filter-tabs">
          {(Object.keys(labels) as Filter[]).map((key) => (
            <button
              key={key}
              className={key === filter ? "selected" : ""}
              onClick={() => setFilter(key)}
            >
              {labels[key]}
              <span>{result?.counts[key] ?? "…"}</span>
            </button>
          ))}
        </div>
        <div className="search">
          <input
            aria-label="Search orders"
            maxLength={200}
            placeholder="Search orders, products or customers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <p className="muted">
        {result?.total ?? 0} matching orders{" "}
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void exportAll()}
        >
          Export CSV
        </button>
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="panel table-panel orders-list">
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
                  <td data-label="Order">
                    <button
                      className="text-button"
                      onClick={() => onOpen(order.id)}
                    >
                      #{String(order.id).padStart(4, "0")}
                    </button>
                  </td>
                  <td data-label="Customer">
                    <strong>{order.customer}</strong>
                  </td>
                  <td data-label="Pieces">
                    {order.items.reduce((sum, i) => sum + i.quantity, 0)}
                  </td>
                  <td data-label="Ship by">{order.ship_by || "No deadline"}</td>
                  <td data-label="Status">
                    {order.archived
                      ? "Archived"
                      : order.status === "new"
                        ? "Queued"
                        : order.status}
                  </td>
                  {showMoney && (
                    <td data-label="Total">
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
        {!busy && !result?.orders.length && (
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
