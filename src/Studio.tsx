import { useFeatures } from "./Features";
import { useEffect, useState } from "react";
import type { Filament, Job, Order, ProductionDetails } from "../shared/models";
import { orderCostEstimate } from "../shared/costs";
import { queueEntries } from "../shared/models";

type Api = (path: string, method?: string, value?: unknown) => Promise<any>;
const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    amount,
  );
const time = (value: string) =>
  new Date(value.replace(" ", "T") + "Z").toLocaleString("en-GB");

export function StudioOverview({
  orders,
  filaments,
  showMoney,
  currency,
}: {
  orders: Order[];
  filaments: Filament[];
  showMoney: boolean;
  currency: string;
}) {
  const entries = queueEntries(orders).filter(
    (e) => e.piece.status === "queued" || e.piece.status === "printing",
  );
  const overdue = orders.filter(
    (o) =>
      !o.is_draft &&
      !o.cancelled &&
      !o.archived &&
      o.status !== "shipped" &&
      o.ship_by &&
      o.ship_by <
        `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`,
  );
  const minutes = entries.reduce((sum, e) => sum + e.item.minutes_per_piece, 0);
  const unestimated = entries.filter(
    (e) =>
      !e.item.minutes_per_piece ||
      !e.item.grams_per_piece ||
      !e.item.filament_id,
  ).length;
  const requirements = filaments
    .map((f) => ({
      filament: f,
      grams: entries
        .filter((e) => e.item.filament_id === f.id)
        .reduce((sum, e) => sum + e.item.grams_per_piece, 0),
    }))
    .filter((r) => r.grams > 0);
  return (
    <section className="panel studio-planning">
      <h2>Production planning</h2>
      <p>
        {overdue.length} overdue {overdue.length === 1 ? "order" : "orders"} ·{" "}
        {Math.round((minutes / 60) * 10) / 10} estimated printer hours remaining
        {unestimated > 0
          ? ` · ${unestimated} pieces need estimates or a filament`
          : ""}
      </p>
      {requirements.length ? (
        <div className="material-plan">
          {requirements.map(({ filament: f, grams }) => (
            <div key={f.id}>
              <strong>{f.name}</strong>
              <span>
                {grams} g reserved · {f.remaining_grams} g on hand
              </span>
              <span className={grams > f.remaining_grams ? "error" : "muted"}>
                {grams > f.remaining_grams
                  ? `${Math.round(grams - f.remaining_grams)} g short`
                  : `${Math.round(f.remaining_grams - grams)} g available after queue`}
              </span>
              {showMoney && f.cost_per_kg > 0 && (
                <small>
                  Estimated material cost{" "}
                  {money((grams * f.cost_per_kg) / 1000, currency)}
                </small>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">
          Add grams and time estimates to products to plan material and printer
          capacity.
        </p>
      )}
    </section>
  );
}

export function JobHistory({
  api,
  jobs,
  showMoney,
  onOpen,
}: {
  api: Api;
  jobs: Job[];
  showMoney: boolean;
  onOpen: (id: number) => void;
}) {
  const features = useFeatures();
  const [older, setOlder] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const visible = [
    ...jobs,
    ...older.filter((j) => !jobs.some((current) => current.id === j.id)),
  ];
  async function loadOlder() {
    setLoading(true);
    setError("");
    try {
      const rows: Job[] = await api(`/jobs?before=${visible.at(-1)?.id || ""}`);
      setOlder((current) => [...current, ...rows]);
      setDone(rows.length < 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Print history</h1>
          <p>
            Each attempt records its operator, printer and outcome. Start pieces
            from the queue.
          </p>
        </div>
      </div>
      <section className="panel job-history">
        {visible.length ? (
          visible.map((job) => (
            <article key={job.id}>
              <div>
                <strong>
                  {job.product_name || "Removed item"}
                  {job.ordinal ? ` · piece ${job.ordinal}` : ""}
                </strong>
                <p>
                  {job.printer || "Studio printer"} ·{" "}
                  {job.operator_name || "Former team member"}
                </p>
                <small>
                  {time(job.started_at)}
                  {job.finished_at
                    ? ` → ${time(job.finished_at)}`
                    : " · Running"}
                  {job.finished_at
                    ? ` · ${Math.max(0, Math.round((Date.parse(job.finished_at + "Z") - Date.parse(job.started_at + "Z")) / 60000))} min`
                    : ""}
                </small>
                <small>
                  {job.actual_grams} g used · estimate {job.estimated_grams} g /{" "}
                  {job.estimated_minutes} min
                  {showMoney && features.cost_reporting
                    ? ` · material ${money(job.material_cost, job.currency)} · machine ${money(job.machine_cost, job.currency)} · energy ${money(job.energy_cost, job.currency)}`
                    : ""}
                </small>
                {job.notes && <p>{job.notes}</p>}
              </div>
              <span
                className={`status status-${job.status === "failed" ? "cancelled" : job.status === "running" ? "printing" : "printed"}`}
              >
                {job.status}
              </span>
              {job.order_id && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onOpen(job.order_id!)}
                >
                  Order #{job.order_id}
                </button>
              )}
            </article>
          ))
        ) : (
          <p className="queue-empty">
            Start your first piece from the print queue.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {jobs.length >= 100 && !done && (
          <button
            type="button"
            className="outline-button"
            disabled={loading}
            onClick={loadOlder}
          >
            {loading ? "Loading…" : "Load older prints"}
          </button>
        )}
      </section>
    </>
  );
}

export function ProductionFields({
  value,
  onChange,
}: {
  value: ProductionDetails;
  onChange: (value: ProductionDetails) => void;
}) {
  return (
    <fieldset className="production-fields">
      <legend>Production details</legend>
      <div className="form-grid">
        <label className="field">
          <span>Grams per piece</span>
          <input
            type="number"
            min="0"
            max="100000"
            step="0.1"
            value={value.grams_per_piece}
            onChange={(e) =>
              onChange({ ...value, grams_per_piece: Number(e.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>Minutes per piece</span>
          <input
            type="number"
            min="0"
            max="100000"
            value={value.minutes_per_piece}
            onChange={(e) =>
              onChange({ ...value, minutes_per_piece: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <label className="field">
        <span>STL / 3MF file link</span>
        <input
          type="url"
          value={value.production_url}
          onChange={(e) =>
            onChange({ ...value, production_url: e.target.value })
          }
          placeholder="https://…"
        />
      </label>
      <label className="field">
        <span>Revision or variant</span>
        <input
          maxLength={100}
          value={value.revision}
          onChange={(e) => onChange({ ...value, revision: e.target.value })}
          placeholder="e.g. v2 · large"
        />
      </label>
      <label className="field">
        <span>Print profile</span>
        <textarea
          maxLength={2000}
          value={value.print_profile}
          onChange={(e) =>
            onChange({ ...value, print_profile: e.target.value })
          }
          placeholder="Layer height, infill, supports…"
        />
      </label>
      <p className="muted">
        These details are copied into new order items. Existing orders retain
        their production revision.
      </p>
    </fieldset>
  );
}

export function OrderOperations({
  order,
  busy,
  api,
  onWork,
}: {
  order: Order;
  busy: boolean;
  api: Api;
  onWork: (work: () => Promise<unknown>) => void;
}) {
  const features = useFeatures();
  const [carrier, setCarrier] = useState(""),
    [tracking, setTracking] = useState("");
  const ready = order.items.flatMap((i) =>
    i.pieces.filter((p) => p.status === "printed"),
  );
  const [selected, setSelected] = useState<number[]>([]);
  useEffect(
    () => setSelected(ready.map((p) => p.id)),
    [order.id, order.version],
  );
  const change = (action: string) =>
    onWork(() =>
      api(`/orders/${order.id}/lifecycle`, "POST", {
        action,
        version: order.version,
      }),
    );
  function packingSlip() {
    const escape = (value: string | number) =>
      String(value).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c]!,
      );
    const content = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Order #${order.id} packing slip</title><style>body{font:16px system-ui;max-width:760px;margin:40px auto;padding:20px}table{width:100%;border-collapse:collapse}td,th{padding:12px;text-align:left;border-bottom:1px solid #ddd}p{white-space:pre-wrap}@media print{button{display:none}body{margin:0}}</style><h1>Printroom · Order #${order.id}</h1><p>${escape(order.customer)}
${escape(order.contact)}</p><p>Ship by: ${escape(order.ship_by || "Not set")}</p><table><thead><tr><th>Quantity</th><th>Product</th><th>Filament</th></tr></thead><tbody>${order.items.map((i) => `<tr><td>${i.quantity}</td><td>${escape(i.product_name)}</td><td>${escape(i.filament_name || "—")}</td></tr>`).join("")}</tbody></table><p>${escape(order.notes)}</p><button type="button" onclick="window.print()">Print packing slip</button></html>`;
    download(`order-${order.id}-packing-slip.html`, content, "text/html");
  }
  return (
    <section className="panel order-operations">
      <h2>Order management</h2>
      {features.material_tracking && (
        <p className="muted">
          Estimated material{" "}
          {order.items.reduce(
            (sum, i) => sum + i.quantity * i.grams_per_piece,
            0,
          )}{" "}
          g
        </p>
      )}
      {features.sales_tools && (
        <>
          <label className="field">
            <span>Payment</span>
            <select
              disabled={busy}
              value={order.payment_status}
              onChange={(e) =>
                onWork(() =>
                  api(`/orders/${order.id}/payment`, "PUT", {
                    payment_status: e.target.value,
                    version: order.version,
                  }),
                )
              }
            >
              {["unpaid", "deposit", "paid", "refunded"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="outline-button"
            onClick={packingSlip}
          >
            Download packing slip
          </button>
          {!order.cancelled && !order.archived && ready.length > 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onWork(() =>
                  api(`/orders/${order.id}/shipments`, "POST", {
                    piece_ids: selected,
                    carrier,
                    tracking,
                  }),
                );
              }}
            >
              <h3>Dispatch pieces</h3>
              <div className="dispatch-choices">
                {order.items.flatMap((i) =>
                  i.pieces
                    .filter((p) => p.status === "printed")
                    .map((p) => (
                      <label key={p.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(p.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, p.id]
                                : selected.filter((id) => id !== p.id),
                            )
                          }
                        />
                        {i.product_name} · piece {p.ordinal}
                      </label>
                    )),
                )}
              </div>
              <label className="field">
                <span>Carrier</span>
                <input
                  maxLength={100}
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Tracking reference</span>
                <input
                  maxLength={200}
                  value={tracking}
                  onChange={(e) => setTracking(e.target.value)}
                />
              </label>
              <button
                type="submit"
                className="auth-submit"
                disabled={busy || !selected.length}
              >
                Dispatch {selected.length} pieces
              </button>
            </form>
          )}
          {order.shipments.length > 0 && (
            <div className="shipment-list">
              <h3>Shipments</h3>
              {order.shipments.map((s) => (
                <p key={s.id}>
                  {time(s.created_at)}
                  <br />
                  {s.carrier || "Carrier not recorded"} ·{" "}
                  {s.tracking || "No tracking"}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      <div className="settings-actions">
        {order.cancelled || order.archived ? (
          <button
            type="button"
            disabled={busy}
            className="outline-button"
            onClick={() => change("restore")}
          >
            Restore order
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            className="danger-text"
            onClick={() => {
              if (
                confirm(
                  "Cancel this order? Its history will be kept and its pieces removed from the queue.",
                )
              )
                change("cancel");
            }}
          >
            Cancel order
          </button>
        )}
        {!order.archived &&
          (!!order.cancelled || order.status === "shipped") && (
            <button
              type="button"
              disabled={busy}
              className="outline-button"
              onClick={() => change("archive")}
            >
              Archive order
            </button>
          )}
      </div>
    </section>
  );
}

export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportOrders(orders: Order[]) {
  const quote = (value: unknown) =>
    `"${String(value ?? "")
      .replace(/"/g, '""')
      .replace(/^[=+@-]/, "'$&")}"`;
  const rows = [
    [
      "Order",
      "Customer",
      "Status",
      "Archived",
      "Ship by",
      "Product",
      "Filament",
      "Quantity",
      "Printed",
      "Shipped",
      "Unit price",
      "Currency",
      "Payment",
    ],
    ...orders.flatMap((o) =>
      o.items.length
        ? o.items.map((i) => [
            o.id,
            o.customer,
            o.status,
            o.archived,
            o.ship_by,
            i.product_name,
            i.filament_name,
            i.quantity,
            i.printed_quantity,
            i.shipped_quantity,
            i.unit_price,
            o.currency,
            o.payment_status,
          ])
        : [
            [
              o.id,
              o.customer,
              o.status,
              o.archived,
              o.ship_by,
              "",
              "",
              0,
              0,
              0,
              0,
              o.currency,
              o.payment_status,
            ],
          ],
    ),
  ];
  download(
    "printroom-orders.csv",
    rows.map((row) => row.map(quote).join(",")).join("\r\n"),
    "text/csv;charset=utf-8",
  );
}

export function StockHistory({
  filamentId,
  api,
}: {
  filamentId: number;
  api: Api;
}) {
  const [rows, setRows] = useState<
    {
      id: number;
      detail: string;
      grams_delta: number;
      spool_delta: number;
      created_at: string;
      actor_name: string;
    }[]
  >([]);
  useEffect(() => {
    void api(`/filaments/${filamentId}/movements`)
      .then(setRows)
      .catch(console.error);
  }, [filamentId]);
  return (
    <details className="stock-history">
      <summary>Stock movement history</summary>
      {rows.length ? (
        rows.map((r) => (
          <p key={r.id}>
            {r.detail} · {r.spool_delta > 0 ? "+" : ""}
            {r.spool_delta} spools · {r.grams_delta > 0 ? "+" : ""}
            {r.grams_delta} g<br />
            <small>
              {r.actor_name || "Former member"} · {time(r.created_at)}
            </small>
          </p>
        ))
      ) : (
        <p>No movements recorded yet.</p>
      )}
    </details>
  );
}

export function AccountPassword({ api }: { api: Api }) {
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [again, setAgain] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <details className="account-password">
      <summary>Change your password</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (password !== again) {
            setMessage("Passwords do not match");
            return;
          }
          setBusy(true);
          setMessage("");
          try {
            await api("/account/password", "PUT", {
              current_password: current,
              password,
            });
            setCurrent("");
            setPassword("");
            setAgain("");
            setMessage(
              "Password changed. Your other sessions have been signed out.",
            );
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : "Password change failed",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>Current password</span>
          <input
            type="password"
            maxLength={1024}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="field">
          <span>New password</span>
          <input
            required
            type="password"
            maxLength={1024}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Confirm new password</span>
          <input
            required
            type="password"
            maxLength={1024}
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy} className="auth-submit">
          Change password
        </button>
        <p role="status">{message}</p>
      </form>
    </details>
  );
}

export function CostSummary({ order }: { order: Order }) {
  const estimate = orderCostEstimate(order);
  return (
    <section className="panel settings-card">
      <h2>Production costs</h2>
      <p>Estimated material: {money(estimate.material, order.currency)}</p>
      <p>Estimated machine: {money(estimate.machine, order.currency)}</p>
      <p>Estimated electricity: {money(estimate.energy, order.currency)}</p>
      <p>
        Estimated contribution:{" "}
        {money(estimate.revenue - estimate.total, order.currency)}
      </p>
      <p>Recorded attempt costs: {money(order.actual_cost, order.currency)}</p>
      {order.status === "shipped" && !order.running_jobs ? (
        <p>
          Recorded contribution:{" "}
          {money(estimate.revenue - order.actual_cost, order.currency)}
        </p>
      ) : (
        <p className="muted">
          Recorded costs accumulate as attempts finish, including failed and
          stopped attempts.
        </p>
      )}
      <small>
        Contribution excludes labour, delivery, tax and other business expenses.
        Missing product estimates or zero rates leave costs incomplete.
        Historical progress without a recorded print attempt has no actual cost.
      </small>
    </section>
  );
}
