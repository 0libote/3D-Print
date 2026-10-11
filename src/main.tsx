import { FeaturesContext, useFeatures } from "./Features";
import { featureDefaults, type Features } from "../shared/features";
import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@astryxdesign/core/Button";
import * as stylex from "@stylexjs/stylex";
import {
  Boxes,
  ClipboardList,
  LayoutDashboard,
  Layers3,
  LogOut,
  Package,
  Plus,
  Search,
  Trash2,
  X,
  ArrowRight,
  Printer,
  Pencil,
  Users,
  Moon,
  Sun,
  ArrowLeft,
  ListTodo,
  CheckCircle2,
  Settings2,
  Bell,
  Minus,
} from "lucide-react";
import "./styles.css";
import "./workspace.css";
import "./mobile.css";
import "./production.css";
import {
  queueEntries,
  type User,
  type Filament,
  type Product,
  type Item,
  type Order,
  type Status,
  type ItemStage,
  type Job,
  type PieceEntry,
} from "../shared/models";
import { PieceQueue, type PieceAction } from "./PieceQueue";
import { OrdersBrowser } from "./OrdersBrowser";
import { Modal } from "./Modal";
import {
  StudioOverview,
  CostSummary,
  JobHistory,
  OrderOperations,
  ProductionFields,
  StockHistory,
  AccountPassword,
} from "./Studio";
if (import.meta.env.DEV) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/virtual:stylex.css";
  document.head.appendChild(link);
  const runtime = "virtual:stylex:runtime";
  void import(/* @vite-ignore */ runtime);
}

type NoticePreferences = {
  draft_created: number;
  sale_confirmed: number;
  print_stage: number;
  order_shipped: number;
  deadline_soon: number;
  deadline_overdue: number;
};
type ActivityEntry = {
  id: number;
  actor_name: string;
  order_id: number | null;
  kind: string;
  detail: string;
  created_at: string;
};
type Data = {
  needsSetup: boolean;
  user: User | null;
  users: User[];
  filaments: Filament[];
  products: Product[];
  orders: Order[];
  jobs: Job[];
  totals: { shipped_orders: number } | null;
  activity: ActivityEntry[];
  settings: Features & {
    show_money: boolean;
    currency: string;
    machine_hourly_rate: number;
    electricity_per_kwh: number;
    printer_watts: number;
  };
  notifications: {
    preferences: NoticePreferences;
    vapidPublicKey: string;
    subscribed: boolean;
  } | null;
};
type Page =
  | "overview"
  | "queue"
  | "orders"
  | "products"
  | "filaments"
  | "team"
  | "settings"
  | "jobs";
type Dialog =
  | { type: "order"; value?: Order }
  | { type: "product"; value?: Product }
  | { type: "filament"; value?: Filament }
  | { type: "item"; order: Order }
  | { type: "edit_item"; order: Order; value: Item }
  | { type: "user" }
  | { type: "password"; value: User }
  | null;
const statusNames: Record<Status, string> = {
  draft: "Draft",
  new: "Queued",
  printing: "Printing",
  printed: "Printed",
  shipped: "Shipped",
  cancelled: "Cancelled",
};
const itemStageNames: Record<ItemStage, string> = {
  queued: "Queued",
  printing: "Printing",
  printed: "Printed",
  shipped: "Shipped",
};
const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(n);
const date = (s: string) =>
  new Date(
    s.replace(" ", "T") + (s.includes("Z") ? "" : "Z"),
  ).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const shipDate = (s: string) =>
  new Date(`${s}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
function Deadline({ order }: { order: Order }) {
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
const styles = stylex.create({
  brand: { letterSpacing: "-0.045em", fontWeight: 800 },
});
async function api(path: string, method = "GET", value?: unknown) {
  if (
    !/^\/[a-z0-9/-]+(?:\?[a-z0-9=&%+_-]*)?$/i.test(path) ||
    path.includes("..")
  )
    throw new Error("Invalid API path");
  const res = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers:
      value instanceof FormData
        ? undefined
        : { "Content-Type": "application/json" },
    body:
      value === undefined
        ? undefined
        : value instanceof FormData
          ? value
          : JSON.stringify(value),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || "Request failed");
  return result;
}
function App() {
  const [data, setData] = useState<Data | null>(null);
  const [page, setPage] = useState<Page>("overview");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedOrder, setSelectedOrder] = useState<number | null>(null);
  const [showArchivedCatalogue, setShowArchivedCatalogue] = useState(false);
  const [catalogueSearch, setCatalogueSearch] = useState("");
  const [queueFilter, setQueueFilter] = useState<"all" | "queued" | "printing">(
    "all",
  );
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("printroom-theme") === "dark" ? "dark" : "light",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [updateWorker, setUpdateWorker] = useState<ServiceWorker | null>(null);
  const [live, setLive] = useState(false);
  const requestNumber = useRef(0),
    mutation = useRef(false);
  const selectedRef = useRef(selectedOrder);
  selectedRef.current = selectedOrder;
  const [orderActivity, setOrderActivity] = useState<ActivityEntry[]>([]);
  const refresh = async () => {
    const current = ++requestNumber.current;
    const next = await api(
      `/bootstrap${selectedRef.current ? `?order=${selectedRef.current}` : ""}`,
    );
    if (current === requestNumber.current) setData(next);
  };
  useEffect(() => {
    setOrderActivity([]);
    if (selectedOrder)
      void api(`/orders/${selectedOrder}/activity`)
        .then(setOrderActivity)
        .catch((e) => setError(e.message));
  }, [
    selectedOrder,
    data?.orders.find((o) => o.id === selectedOrder)?.version,
  ]);
  useEffect(() => {
    if (selectedOrder) void refresh().catch((e) => setError(e.message));
  }, [selectedOrder]);
  const signOut = () =>
    action(async () => {
      try {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();
          const subscription =
            await registration?.pushManager?.getSubscription();
          if (subscription) {
            try {
              await api("/push-subscriptions", "DELETE", {
                endpoint: subscription.endpoint,
              });
            } finally {
              await subscription.unsubscribe();
            }
          }
        }
      } catch (error) {
        console.warn("Push cleanup failed", error);
      }
      await api("/logout", "POST");
    }, false);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    if (!import.meta.env.DEV && "serviceWorker" in navigator)
      void navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          if (registration.waiting) setUpdateWorker(registration.waiting);
          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            worker?.addEventListener("statechange", () => {
              if (
                worker.state === "installed" &&
                navigator.serviceWorker.controller
              )
                setUpdateWorker(worker);
            });
          });
        })
        .catch(console.error);
    const orderId = Number(new URLSearchParams(location.search).get("order"));
    if (orderId > 0) {
      setPage("orders");
      setSelectedOrder(orderId);
      history.replaceState(null, "", location.pathname);
    }
  }, []);
  useEffect(() => {
    if (!data?.user) {
      setLive(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh().catch(console.error);
      }, 120);
    };
    const onFocus = () => update();
    const onVisible = () => {
      if (document.visibilityState === "visible") update();
    };
    let connected = false;
    const poll = setInterval(() => {
      if (!connected) onVisible();
    }, 30_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const events = new EventSource("/api/events");
    events.onopen = () => {
      connected = true;
      setLive(true);
      update();
    };
    events.onerror = () => {
      connected = false;
      setLive(false);
    };
    events.onmessage = update;
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      events.close();
    };
  }, [data?.user?.id]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("printroom-theme", theme);
  }, [theme]);
  async function action(work: () => Promise<unknown>, close = true) {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
      if (close) setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  if (!data) return <div className="loading">Loading Printroom… {error}</div>;
  if (!data.user) return <Auth setup={data.needsSetup} onDone={refresh} />;

  const chosen = data.orders.find((o) => o.id === selectedOrder) || null;
  const allPrints = queueEntries(data.orders);
  const queue = allPrints.filter(
    (entry) =>
      entry.piece.status === "queued" || entry.piece.status === "printing",
  );
  const ready = allPrints.filter((entry) => entry.piece.status === "printed");
  const activePieceId = queue.find((entry) => entry.piece.status === "printing")
    ?.piece.id;
  const pieceAction = (
    entry: PieceEntry,
    step: PieceAction,
    printer = "",
    notes = "",
    actualGrams?: number,
  ) =>
    void action(
      () =>
        api(`/pieces/${entry.piece.id}/action`, "POST", {
          action: step,
          version: entry.piece.version,
          printer,
          notes,
          actual_grams: actualGrams,
        }),
      false,
    );
  const tabs: {
    id: Page;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }[] = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard size={20} /> },
    {
      id: "queue",
      label: "Queue",
      icon: <ListTodo size={20} />,
      count: queue.length,
    },
    {
      id: "orders",
      label: "Orders",
      icon: <ClipboardList size={20} />,
      count: data.orders.filter((o) => o.is_draft).length,
    },
    ...(data.settings.production_tools
      ? [
          {
            id: "jobs" as Page,
            label: "Print history",
            icon: <Printer size={20} />,
          },
        ]
      : []),
    { id: "products", label: "Products", icon: <Boxes size={20} /> },
    { id: "filaments", label: "Filaments", icon: <Layers3 size={20} /> },
    ...(data.user.is_admin
      ? [{ id: "team" as Page, label: "Team", icon: <Users size={20} /> }]
      : []),
    { id: "settings", label: "Settings", icon: <Settings2 size={20} /> },
  ];
  const openOrder = (id: number) => {
    setPage("orders");
    setSelectedOrder(id);
  };
  const createOrder = (value: unknown) =>
    action(async () => {
      const result = await api("/orders", "POST", value);
      setPage("orders");
      setSelectedOrder(result.id);
    });

  return (
    <FeaturesContext.Provider value={data.settings}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-icon">
              <Printer size={23} strokeWidth={2.3} />
            </div>
            <span {...stylex.props(styles.brand)}>
              printroom<span className="brand-dot">.</span>
            </span>
          </div>
          <div className="workspace-label">WORKSPACE</div>
          <nav>
            {tabs.map((tab) => (
              <button
                type="button"
                key={tab.id}
                data-page={tab.id}
                aria-label={tab.label}
                aria-current={page === tab.id ? "page" : undefined}
                title={tab.label}
                className={page === tab.id ? "nav active" : "nav"}
                onClick={() => {
                  setPage(tab.id);
                  setSelectedOrder(null);
                }}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {!!tab.count && <b>{tab.count}</b>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="profile">
              <span className="avatar">
                {data.user.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="profile-text">
                <strong>{data.user.name}</strong>
                <small>{data.user.username}</small>
              </span>
              <button type="button" title="Sign out" onClick={signOut}>
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </aside>
        <main className="main">
          <header className="topbar">
            <div className="top-right">
              <span
                className={`live-status${live ? " connected" : ""}`}
                title={
                  live
                    ? "Changes from your team appear automatically"
                    : "Changes are checked periodically"
                }
              >
                <i />
                {live ? "Live" : ""}
              </span>
              <button
                className="theme-toggle"
                type="button"
                title={theme === "dark" ? "Use light mode" : "Use dark mode"}
                aria-label={
                  theme === "dark" ? "Use light mode" : "Use dark mode"
                }
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
              </button>
            </div>
          </header>
          <div className="content workspace-content">
            {page === "overview" && (
              <>
                <div className="page-heading">
                  <div>
                    <h1>Overview</h1>
                  </div>
                  <Button
                    label="New draft"
                    variant="primary"
                    icon={<Plus size={17} />}
                    onClick={() => setDialog({ type: "order" })}
                  />
                </div>
                <div className="stat-grid">
                  <Stat
                    label="Draft orders"
                    value={data.orders.filter((o) => o.is_draft).length}
                  />
                  <Stat label="Pieces to print" value={queue.length} />
                  <Stat label="Pieces to ship" value={ready.length} />
                  <Stat
                    label="Shipped orders"
                    value={data.totals?.shipped_orders || 0}
                  />
                </div>
                {data.settings.material_tracking && (
                  <StudioOverview
                    orders={data.orders}
                    filaments={data.filaments.filter((f) => !f.archived)}
                    showMoney={
                      data.settings.show_money && data.settings.cost_reporting
                    }
                    currency={data.settings.currency}
                  />
                )}
                <section className="panel feature-queue">
                  <div className="panel-head">
                    <div>
                      <h2>Print queue</h2>
                    </div>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setPage("queue")}
                    >
                      Full queue <ArrowRight size={16} />
                    </button>
                  </div>
                  <PieceQueue
                    entries={queue.slice(0, 6)}
                    activePieceId={activePieceId}
                    busy={busy}
                    onAction={pieceAction}
                    onOpen={openOrder}
                    emptyText="Confirm a draft sale to add its prints to this queue."
                  />
                </section>
                <section className="panel recent-panel">
                  <div className="panel-head">
                    <div>
                      <h2>Recent orders</h2>
                    </div>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setPage("orders")}
                    >
                      All orders <ArrowRight size={16} />
                    </button>
                  </div>
                  <div className="recent-list">
                    {data.orders.slice(0, 5).map((order) => (
                      <button
                        type="button"
                        key={order.id}
                        onClick={() => openOrder(order.id)}
                      >
                        <span className="queue-icon">
                          <Package size={19} />
                        </span>
                        <span>
                          <strong>
                            #{String(order.id).padStart(4, "0")} ·{" "}
                            {order.customer}
                          </strong>
                          <small>
                            {order.items.length}{" "}
                            {order.items.length === 1 ? "item" : "items"} ·{" "}
                            {date(order.created_at)}
                          </small>
                        </span>
                        <StatusBadge status={order.status} />
                      </button>
                    ))}
                    {!data.orders.length && (
                      <Empty
                        small
                        icon={<ClipboardList />}
                        title="No orders yet"
                        text="Create a draft to get started."
                      />
                    )}
                  </div>
                </section>
              </>
            )}
            {page === "queue" && (
              <>
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">FULFILLMENT BOARD</span>
                    <h1>Print queue</h1>
                    <p>
                      {queue.length} {queue.length === 1 ? "piece" : "pieces"}{" "}
                      waiting or printing. The nearest ship-by dates appear
                      first.
                    </p>
                  </div>
                  <Button
                    label="New draft"
                    variant="primary"
                    icon={<Plus size={17} />}
                    onClick={() => setDialog({ type: "order" })}
                  />
                </div>
                <div className="filter-tabs">
                  {(["all", "queued", "printing"] as const).map((stage) => (
                    <button
                      type="button"
                      key={stage}
                      className={queueFilter === stage ? "selected" : ""}
                      onClick={() => setQueueFilter(stage)}
                    >
                      {stage === "all" ? "All active" : itemStageNames[stage]}
                      <span>
                        {stage === "all"
                          ? queue.length
                          : queue.filter(
                              (entry) => entry.piece.status === stage,
                            ).length}
                      </span>
                    </button>
                  ))}
                </div>
                <section className="panel queue-page-panel">
                  <PieceQueue
                    entries={queue.filter(
                      (entry) =>
                        queueFilter === "all" ||
                        entry.piece.status === queueFilter,
                    )}
                    activePieceId={activePieceId}
                    busy={busy}
                    onAction={pieceAction}
                    onOpen={openOrder}
                    emptyText="Confirm a draft sale to add prints here. Each completed piece moves to Ready to ship below."
                  />
                </section>
                <section className="panel queue-page-panel ready-panel">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">NEXT STEP</span>
                      <h2>Ready to ship</h2>
                      <p>
                        {ready.length}{" "}
                        {ready.length === 1 ? "piece is" : "pieces are"} waiting
                        to ship.
                      </p>
                    </div>
                  </div>
                  <PieceQueue
                    entries={ready}
                    activePieceId={activePieceId}
                    busy={busy}
                    onAction={pieceAction}
                    mode="ship"
                    onOpen={openOrder}
                    emptyText="Printed pieces will appear here until you mark them shipped."
                  />
                </section>
              </>
            )}
            {page === "orders" &&
              (chosen ? (
                <OrderDetail
                  order={chosen}
                  showMoney={data.settings.show_money}
                  currency={chosen.currency}
                  busy={busy}
                  onBack={() => setSelectedOrder(null)}
                  onEdit={() => setDialog({ type: "order", value: chosen })}
                  onAddItem={() => setDialog({ type: "item", order: chosen })}
                  onConfirm={() =>
                    action(
                      () => api(`/orders/${chosen.id}/confirm`, "POST"),
                      false,
                    )
                  }
                  activePieceId={activePieceId}
                  onAction={pieceAction}
                  onEditItem={(item) =>
                    setDialog({ type: "edit_item", order: chosen, value: item })
                  }
                  activity={orderActivity}
                  onMoreActivity={() =>
                    void api(
                      `/orders/${chosen.id}/activity?before=${orderActivity.at(-1)?.id || ""}`,
                    )
                      .then((next) =>
                        setOrderActivity([...orderActivity, ...next]),
                      )
                      .catch((e) => setError(e.message))
                  }
                  onOrderWork={(work) => void action(work, false)}
                  onDeleteItem={(itemId) => {
                    if (confirm("Remove this item?"))
                      void action(
                        () => api(`/items/${itemId}`, "DELETE"),
                        false,
                      );
                  }}
                  onDelete={() => {
                    if (confirm("Delete this order and all its items?"))
                      void action(async () => {
                        await api(`/orders/${chosen.id}`, "DELETE");
                        setSelectedOrder(null);
                      }, false);
                  }}
                />
              ) : (
                <OrdersBrowser
                  api={api}
                  revision={data}
                  showMoney={data.settings.show_money}
                  onOpen={setSelectedOrder}
                  onCreate={() => setDialog({ type: "order" })}
                />
              ))}
            {page === "jobs" && (
              <JobHistory
                api={api}
                jobs={data.jobs}
                showMoney={data.settings.show_money}
                onOpen={openOrder}
              />
            )}
            {page === "products" && (
              <>
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">WHAT YOU MAKE</span>
                    <h1>Products</h1>
                    <p>Your print catalogue and offered colour options.</p>
                  </div>
                  <Button
                    label="Add product"
                    variant="primary"
                    icon={<Plus size={17} />}
                    onClick={() => setDialog({ type: "product" })}
                  />
                </div>
                <label className="catalogue-archive-toggle">
                  <input
                    type="checkbox"
                    checked={showArchivedCatalogue}
                    onChange={(e) => setShowArchivedCatalogue(e.target.checked)}
                  />{" "}
                  Show archived catalogue entries
                </label>
                <div className="search catalogue-search">
                  <Search size={18} />
                  <input
                    aria-label="Search products"
                    placeholder="Search products…"
                    value={catalogueSearch}
                    onChange={(e) => setCatalogueSearch(e.target.value)}
                  />
                </div>
                {data.products.length ? (
                  <div className="product-grid">
                    {data.products
                      .filter(
                        (p) =>
                          !!p.archived === showArchivedCatalogue &&
                          `${p.name} ${p.description} ${p.revision}`
                            .toLowerCase()
                            .includes(catalogueSearch.toLowerCase()),
                      )
                      .map((product) => (
                        <article className="product-card" key={product.id}>
                          <div
                            className={`product-image${product.image_url ? "" : " placeholder"}`}
                          >
                            {product.image_url ? (
                              <img src={product.image_url} alt={product.name} />
                            ) : (
                              <Boxes size={42} strokeWidth={1.4} />
                            )}
                          </div>
                          <div className="product-body">
                            <div className="product-title">
                              <h3>{product.name}</h3>
                              {data.settings.show_money && (
                                <strong>
                                  {money(product.price, data.settings.currency)}
                                </strong>
                              )}
                            </div>
                            <p>{product.description || "No description yet"}</p>
                            <div className="product-foot">
                              <div className="swatches">
                                {product.filament_ids.map((fid) => {
                                  const filament = data.filaments.find(
                                    (f) => f.id === fid,
                                  );
                                  return filament ? (
                                    <span
                                      key={fid}
                                      title={filament.name}
                                      style={{ background: filament.color }}
                                    />
                                  ) : null;
                                })}
                                {product.filament_ids.length === 0 && (
                                  <small>No colours selected</small>
                                )}
                              </div>
                              {!!product.archived && (
                                <button
                                  type="button"
                                  className="outline-button"
                                  disabled={busy}
                                  onClick={() =>
                                    void action(
                                      () =>
                                        api(
                                          `/products/${product.id}/restore`,
                                          "POST",
                                          { version: product.version },
                                        ),
                                      false,
                                    )
                                  }
                                >
                                  Restore
                                </button>
                              )}
                              <button
                                type="button"
                                className="icon-button"
                                title="Edit product"
                                aria-label={`Edit product ${product.name}`}
                                onClick={() =>
                                  setDialog({ type: "product", value: product })
                                }
                              >
                                <Pencil size={18} />
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                  </div>
                ) : (
                  <Empty
                    icon={<Boxes />}
                    title="Build your catalogue"
                    text="Add a product, then choose which filament colours you can offer."
                    action="Add product"
                    onAction={() => setDialog({ type: "product" })}
                  />
                )}
              </>
            )}
            {page === "filaments" && (
              <>
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">YOUR COLOUR LIBRARY</span>
                    <h1>Filaments</h1>
                    <p>Keep the materials and shades you own in one place.</p>
                  </div>
                  <Button
                    label="Add filament"
                    variant="primary"
                    icon={<Plus size={17} />}
                    onClick={() => setDialog({ type: "filament" })}
                  />
                </div>
                <label className="catalogue-archive-toggle">
                  <input
                    type="checkbox"
                    checked={showArchivedCatalogue}
                    onChange={(e) => setShowArchivedCatalogue(e.target.checked)}
                  />{" "}
                  Show archived catalogue entries
                </label>
                <div className="search catalogue-search">
                  <Search size={18} />
                  <input
                    aria-label="Search filaments"
                    placeholder="Search filaments…"
                    value={catalogueSearch}
                    onChange={(e) => setCatalogueSearch(e.target.value)}
                  />
                </div>
                {data.filaments.length ? (
                  <div className="filament-grid">
                    {data.filaments
                      .filter(
                        (f) =>
                          !!f.archived === showArchivedCatalogue &&
                          `${f.name} ${f.brand} ${f.material}`
                            .toLowerCase()
                            .includes(catalogueSearch.toLowerCase()),
                      )
                      .map((filament) => (
                        <article className="filament-card" key={filament.id}>
                          <div
                            className="filament-swatch"
                            style={{ background: filament.color }}
                          >
                            {filament.image_url ? (
                              <img
                                src={filament.image_url}
                                alt={`${filament.name} spool`}
                              />
                            ) : (
                              <div className="filament-ring" />
                            )}
                          </div>
                          <div className="filament-info">
                            <span className="material">
                              {filament.material}
                            </span>
                            <h3>{filament.name}</h3>
                            <p>
                              {filament.brand || "Unbranded"} ·{" "}
                              {filament.color.toUpperCase()}
                            </p>
                            {filament.notes && <small>{filament.notes}</small>}
                            <div className="stock-count">
                              <strong>
                                {filament.spool_count}{" "}
                                {filament.spool_count === 1
                                  ? "spool"
                                  : "spools"}
                              </strong>
                              <small>
                                {filament.grams_per_spool} g each ·{" "}
                                {data.settings.material_tracking
                                  ? `${filament.remaining_grams.toFixed(0)} g remaining`
                                  : ""}
                              </small>
                            </div>
                            <div className="stock-actions">
                              <button
                                type="button"
                                aria-label={`Remove one ${filament.name} spool`}
                                onClick={() =>
                                  action(
                                    () =>
                                      api(
                                        `/filaments/${filament.id}/stock`,
                                        "PUT",
                                        { delta: -1 },
                                      ),
                                    false,
                                  )
                                }
                                disabled={busy || filament.spool_count === 0}
                              >
                                <Minus size={15} />
                              </button>
                              <button
                                type="button"
                                aria-label={`Add one ${filament.name} spool`}
                                disabled={busy}
                                onClick={() =>
                                  action(
                                    () =>
                                      api(
                                        `/filaments/${filament.id}/stock`,
                                        "PUT",
                                        { delta: 1 },
                                      ),
                                    false,
                                  )
                                }
                              >
                                <Plus size={15} />
                              </button>
                            </div>
                          </div>
                          {!!filament.archived && (
                            <button
                              type="button"
                              className="outline-button"
                              disabled={busy}
                              onClick={() =>
                                void action(
                                  () =>
                                    api(
                                      `/filaments/${filament.id}/restore`,
                                      "POST",
                                      { version: filament.version },
                                    ),
                                  false,
                                )
                              }
                            >
                              Restore
                            </button>
                          )}
                          <button
                            type="button"
                            className="icon-button"
                            title="Edit filament"
                            onClick={() =>
                              setDialog({ type: "filament", value: filament })
                            }
                          >
                            <Pencil size={18} />
                          </button>
                        </article>
                      ))}
                  </div>
                ) : (
                  <Empty
                    icon={<Layers3 />}
                    title="Start your colour library"
                    text="Add your first spool to make it available for products."
                    action="Add filament"
                    onAction={() => setDialog({ type: "filament" })}
                  />
                )}
              </>
            )}
            {page === "settings" && (
              <SettingsPanel
                data={data}
                refresh={refresh}
                onTeam={() => setPage("team")}
                onProducts={() => setPage("products")}
                onJobs={() => setPage("jobs")}
                onSignOut={signOut}
              />
            )}
            {page === "team" && (
              <>
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">SHARED WORKSPACE</span>
                    <h1>Team</h1>
                    <p>Manage access to your shared orders and catalogue.</p>
                  </div>
                  <Button
                    label="Add user"
                    variant="primary"
                    icon={<Plus size={17} />}
                    onClick={() => setDialog({ type: "user" })}
                  />
                </div>
                <section className="panel team-list">
                  {data.users.map((user) => (
                    <div className="team-row" key={user.id}>
                      <span className="avatar">
                        {user.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span>
                        <strong>{user.name}</strong>
                        <small>@{user.username}</small>
                      </span>
                      <span className="team-role">
                        {user.is_admin ? "Owner" : "Member"}
                      </span>
                      <div className="team-actions">
                        <button
                          type="button"
                          className="outline-button"
                          onClick={() =>
                            setDialog({ type: "password", value: user })
                          }
                        >
                          Change password
                        </button>
                        {user.id !== data.user!.id && (
                          <button
                            type="button"
                            className="danger-text"
                            onClick={() => {
                              if (
                                confirm(
                                  `Delete ${user.name}? They will lose access immediately. Existing orders and products will remain.`,
                                )
                              )
                                void action(
                                  () => api(`/users/${user.id}`, "DELETE"),
                                  false,
                                );
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </section>
              </>
            )}
          </div>
        </main>
        {dialog && (
          <Modal busy={busy} onClose={() => setDialog(null)}>
            <div className="modal-top">
              <div>
                <span className="eyebrow">PRINTROOM</span>
                <h2 id="dialog-heading">
                  {dialog.type === "password"
                    ? `Change ${dialog.value.name}'s password`
                    : dialog.type === "item"
                      ? "Add print item"
                      : dialog.type === "edit_item"
                        ? "Edit print item"
                        : dialog.type === "order"
                          ? dialog.value
                            ? "Edit order"
                            : "New draft order"
                          : `${"value" in dialog && dialog.value ? "Edit" : "Add"} ${dialog.type}`}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setDialog(null)}
                aria-label="Close"
                disabled={busy}
              >
                <X size={21} />
              </button>
            </div>
            {dialog.type === "order" && (
              <OrderForm
                value={dialog.value}
                busy={busy}
                onSubmit={(value) =>
                  dialog.value
                    ? action(() =>
                        api(`/orders/${dialog.value!.id}`, "PUT", value),
                      )
                    : createOrder(value)
                }
              />
            )}
            {dialog.type === "filament" && (
              <FilamentForm
                value={dialog.value}
                busy={busy}
                onSubmit={(value) =>
                  action(() =>
                    api(
                      dialog.value
                        ? `/filaments/${dialog.value.id}`
                        : "/filaments",
                      dialog.value ? "PUT" : "POST",
                      value,
                    ),
                  )
                }
                onDelete={
                  dialog.value
                    ? () => {
                        if (
                          confirm(
                            "Archive this filament? Existing orders keep their details.",
                          )
                        )
                          void action(() =>
                            api(`/filaments/${dialog.value!.id}`, "DELETE"),
                          );
                      }
                    : undefined
                }
              />
            )}
            {dialog.type === "product" && (
              <ProductForm
                value={dialog.value}
                filaments={data.filaments.filter((f) => !f.archived)}
                showMoney={data.settings.show_money}
                currency={data.settings.currency}
                busy={busy}
                onSubmit={(value) =>
                  action(() =>
                    api(
                      dialog.value
                        ? `/products/${dialog.value.id}`
                        : "/products",
                      dialog.value ? "PUT" : "POST",
                      value,
                    ),
                  )
                }
                onDelete={
                  dialog.value
                    ? () => {
                        if (
                          confirm(
                            "Archive this product? Existing orders keep their details.",
                          )
                        )
                          void action(() =>
                            api(`/products/${dialog.value!.id}`, "DELETE"),
                          );
                      }
                    : undefined
                }
              />
            )}
            {dialog.type === "edit_item" && (
              <ItemForm
                draft={!!dialog.order.is_draft}
                value={dialog.value}
                products={data.products}
                filaments={data.filaments.filter((f) => !f.archived)}
                showMoney={data.settings.show_money}
                currency={data.settings.currency}
                busy={busy}
                onSubmit={(value) =>
                  action(() => api(`/items/${dialog.value.id}`, "PUT", value))
                }
              />
            )}
            {dialog.type === "item" && (
              <ItemForm
                products={data.products}
                filaments={data.filaments.filter((f) => !f.archived)}
                showMoney={data.settings.show_money}
                currency={data.settings.currency}
                busy={busy}
                onSubmit={(value) =>
                  action(() =>
                    api(`/orders/${dialog.order.id}/items`, "POST", value),
                  )
                }
              />
            )}
            {dialog.type === "user" && (
              <UserForm
                busy={busy}
                onSubmit={(value) => action(() => api("/users", "POST", value))}
              />
            )}
            {dialog.type === "password" && (
              <PasswordForm
                key={dialog.value.id}
                user={dialog.value}
                busy={busy}
                onSubmit={(password) =>
                  action(() =>
                    api(`/users/${dialog.value.id}/password`, "PUT", {
                      password,
                    }),
                  )
                }
              />
            )}
            {error && <p className="error modal-error">{error}</p>}
          </Modal>
        )}
        {updateWorker && !dialog && (
          <div className="update-notice" role="status">
            An update is ready.{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                navigator.serviceWorker.addEventListener(
                  "controllerchange",
                  () => location.reload(),
                  { once: true },
                );
                updateWorker.postMessage({ type: "ACTIVATE_UPDATE" });
              }}
            >
              Reload to update
            </button>
          </div>
        )}
        {error && !dialog && (
          <div className="toast" role="alert">
            {error}
            <button type="button" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </FeaturesContext.Provider>
  );
}

function ActivityList({
  entries,
  onOpen,
}: {
  entries: ActivityEntry[];
  onOpen?: (id: number) => void;
}) {
  if (!entries.length)
    return (
      <p className="muted activity-empty">
        Changes to orders will appear here.
      </p>
    );
  return (
    <div className="activity-list">
      {entries.map((entry) => (
        <div className="activity-row" key={entry.id}>
          <span className="activity-avatar">
            {entry.actor_name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{entry.actor_name}</strong>
            <p>{entry.detail}</p>
            <small>
              {date(entry.created_at)} ·{" "}
              {new Date(
                entry.created_at.replace(" ", "T") + "Z",
              ).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
          </div>
          {onOpen && entry.order_id && (
            <button
              type="button"
              className="text-button"
              onClick={() => onOpen(entry.order_id!)}
            >
              #{entry.order_id} <ArrowRight size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function OrderDetail({
  order,
  showMoney,
  currency,
  busy,
  onBack,
  onEdit,
  onAddItem,
  onConfirm,
  activePieceId,
  onAction,
  onEditItem,
  activity,
  onMoreActivity,
  onOrderWork,
  onDeleteItem,
  onDelete,
}: {
  order: Order;
  showMoney: boolean;
  currency: string;
  busy: boolean;
  onBack: () => void;
  onEdit: () => void;
  onAddItem: () => void;
  onConfirm: () => void;
  activePieceId?: number;
  onAction: (
    entry: PieceEntry,
    step: PieceAction,
    printer?: string,
    notes?: string,
    actualGrams?: number,
  ) => void;
  onEditItem: (item: Item) => void;
  activity: ActivityEntry[];
  onMoreActivity: () => void;
  onOrderWork: (work: () => Promise<unknown>) => void;
  onDeleteItem: (itemId: number) => void;
  onDelete: () => void;
}) {
  const features = useFeatures();
  const total = order.items.reduce(
    (sum, item) => sum + item.unit_price * item.quantity,
    0,
  );
  const completed = order.items.reduce(
    (sum, item) => sum + item.shipped_quantity,
    0,
  );
  const totalQuantity = order.items.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  return (
    <div className="order-detail-page">
      <button type="button" className="back-link" onClick={onBack}>
        <ArrowLeft size={18} /> All orders
      </button>
      <div className="order-detail-heading">
        <div>
          <span className="eyebrow">
            {order.is_draft ? "DRAFT ORDER" : "CONFIRMED SALE"}
          </span>
          <div className="detail-title-row">
            <h1>Order #{String(order.id).padStart(4, "0")}</h1>
            <StatusBadge status={order.status} />
          </div>
          <p>
            {order.is_draft
              ? "Add prints, then confirm this draft to start fulfillment."
              : `Confirmed ${date(order.confirmed_at || order.created_at)} · ${completed} of ${totalQuantity} pieces shipped`}
          </p>
          <div className="detail-deadline">
            <Deadline order={order} />
          </div>
        </div>
        <div className="detail-heading-actions">
          <button type="button" className="outline-button" onClick={onEdit}>
            <Pencil size={16} /> Edit details
          </button>
          {!!order.is_draft && (
            <Button
              label={busy ? "Confirming…" : "Confirm sale"}
              variant="primary"
              icon={<CheckCircle2 size={18} />}
              isDisabled={
                busy ||
                !!order.cancelled ||
                !!order.archived ||
                !order.items.length
              }
              onClick={onConfirm}
            />
          )}
        </div>
      </div>
      {!!order.is_draft && (
        <div className="draft-callout">
          <span>
            <ClipboardList size={24} />
          </span>
          <div>
            <strong>This order is still a draft</strong>
            <p>
              It will enter the sales and print queue when you confirm it. Add
              at least one print item first.
            </p>
          </div>
        </div>
      )}
      <div className="order-detail-grid">
        <div className="order-main-column">
          {!order.is_draft && !order.cancelled && !order.archived && (
            <section className="panel">
              <div className="panel-head">
                <h2>Individual pieces</h2>
              </div>
              <PieceQueue
                entries={queueEntries([order]).filter(
                  (e) => e.piece.status !== "shipped",
                )}
                activePieceId={activePieceId}
                busy={busy}
                onAction={onAction}
                onOpen={() => {}}
                emptyText="All pieces shipped."
              />
            </section>
          )}
          <section className="panel detail-items-panel">
            <div className="panel-head">
              <div>
                <h2>Print items</h2>
                <p>
                  {order.items.length}{" "}
                  {order.items.length === 1 ? "item" : "items"} in this order
                </p>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy || !!order.cancelled || !!order.archived}
                onClick={onAddItem}
              >
                <Plus size={17} /> Add item
              </button>
            </div>
            {order.items.length ? (
              <div className="detail-item-list">
                {order.items.map((item) => (
                  <div className="detail-item-card" key={item.id}>
                    <span
                      className="print-swatch large"
                      style={{ background: item.color }}
                    />
                    <div className="detail-item-copy">
                      <strong>{item.product_name}</strong>
                      <small>
                        {item.filament_name || "No filament selected"} ·{" "}
                        {item.printed_quantity}/{item.quantity} printed ·{" "}
                        {item.shipped_quantity}/{item.quantity} shipped
                      </small>
                    </div>
                    {features.production_tools && (
                      <div className="detail-item-stage">
                        <small>
                          {item.print_profile || "No print profile"}
                        </small>
                        {item.production_url && (
                          <a
                            href={item.production_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Production file {item.revision}
                          </a>
                        )}
                      </div>
                    )}
                    {showMoney && (
                      <strong className="detail-item-price">
                        {money(item.unit_price * item.quantity, currency)}
                      </strong>
                    )}
                    <button
                      type="button"
                      className="icon-button"
                      title="Edit item"
                      disabled={busy || !!order.cancelled || !!order.archived}
                      onClick={() => onEditItem(item)}
                    >
                      <Pencil size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title="Remove item"
                      disabled={busy || !!order.cancelled || !!order.archived}
                      onClick={() => onDeleteItem(item.id)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                small
                icon={<Package />}
                title="No print items yet"
                text="Add a product to this order before confirming the sale."
              />
            )}
          </section>
          {order.notes && (
            <section className="panel detail-notes">
              <h2>Order notes</h2>
              <p>{order.notes}</p>
            </section>
          )}
          <section className="panel activity-panel">
            <div className="panel-head">
              <div>
                <h2>Order activity</h2>
                <p>Who changed this order and when</p>
              </div>
            </div>
            <ActivityList entries={activity} />
            {activity.length >= 50 && (
              <button
                type="button"
                className="outline-button"
                onClick={onMoreActivity}
              >
                Load older activity
              </button>
            )}
          </section>
        </div>
        <aside className="order-side-column">
          <section className="panel detail-info-panel">
            <span className="eyebrow">CUSTOMER</span>
            <h2>{order.customer}</h2>
            <p>{order.contact || "No contact details added"}</p>
            <button type="button" className="text-button" onClick={onEdit}>
              Edit customer <ArrowRight size={15} />
            </button>
          </section>
          <section className="panel detail-info-panel">
            <span className="eyebrow">ORDER SUMMARY</span>
            <div className="summary-line">
              <span>Items</span>
              <strong>
                {order.items.reduce((sum, item) => sum + item.quantity, 0)}
              </strong>
            </div>
            <div className="summary-line">
              <span>Created</span>
              <strong>{date(order.created_at)}</strong>
            </div>
            <div className="summary-line">
              <span>Ship by</span>
              <strong>
                {order.ship_by ? shipDate(order.ship_by) : "Not set"}
              </strong>
            </div>
            {showMoney && (
              <div className="summary-total">
                <span>Total sale</span>
                <strong>{money(total, currency)}</strong>
              </div>
            )}
          </section>
          <section className="panel detail-info-panel">
            <span className="eyebrow">FULFILLMENT</span>
            <h2>
              {order.is_draft
                ? "Waiting for confirmation"
                : statusNames[order.status]}
            </h2>
            <p>
              {order.is_draft
                ? "This draft does not appear in the print queue."
                : "Each print item moves through the queue independently."}
            </p>
            {!order.is_draft && (
              <div className="progress-track">
                <span
                  style={{
                    width: `${order.items.length ? Math.round((completed / totalQuantity) * 100) : 0}%`,
                  }}
                />
              </div>
            )}
            {!order.is_draft && (
              <small>
                {completed} / {totalQuantity} pieces shipped
              </small>
            )}
          </section>
          {showMoney && features.cost_reporting && (
            <CostSummary order={order} />
          )}
          <OrderOperations
            order={order}
            busy={busy}
            api={api}
            onWork={onOrderWork}
          />
          {!!order.is_draft && (
            <button
              type="button"
              className="delete-order"
              disabled={busy}
              onClick={onDelete}
            >
              <Trash2 size={17} /> Delete draft
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}

function Auth({
  setup,
  onDone,
}: {
  setup: boolean;
  onDone: () => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(setup ? "/setup" : "/login", "POST", {
        name,
        username,
        password,
      });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth">
      <div className="auth-side">
        <div className="auth-brand">
          <span className="brand-icon">
            <Printer size={22} />
          </span>
          <strong>
            printroom<span className="brand-dot">.</span>
          </strong>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <h2>{setup ? "Set up your studio" : "Sign in"}</h2>
          <p>
            {setup
              ? "Create the owner account for this studio."
              : "Use your studio account to continue."}
          </p>
          {setup && (
            <Field label="Your name">
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Maker"
              />
            </Field>
          )}
          <Field label="Username">
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="yourname"
            />
          </Field>
          <Field label="Password">
            <input
              required={setup}
              maxLength={1024}
              type="password"
              autoComplete={setup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
            />
          </Field>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? "Please wait…" : setup ? "Create studio" : "Sign in"}{" "}
            <ArrowRight size={17} />
          </button>
        </form>
      </div>
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const labelId = React.useId();
  const decorate = (nodes: React.ReactNode): React.ReactNode =>
    React.Children.map(nodes, (child) => {
      if (!React.isValidElement(child)) return child;
      const element = child as React.ReactElement<{
        children?: React.ReactNode;
        "aria-labelledby"?: string;
      }>;
      if (["input", "select", "textarea"].includes(String(element.type)))
        return React.cloneElement(element, { "aria-labelledby": labelId });
      return element.props.children
        ? React.cloneElement(element, {
            children: decorate(element.props.children),
          })
        : element;
    });
  return (
    <div className="field">
      <span id={labelId}>{label}</span>
      {decorate(children)}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`status status-${status}`}>
      <i />
      {statusNames[status]}
    </span>
  );
}
function Empty({
  icon,
  title,
  text,
  action,
  onAction,
  small = false,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
  small?: boolean;
}) {
  return (
    <div className={small ? "empty small" : "empty"}>
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <Button
          label={action}
          variant="primary"
          icon={<Plus size={16} />}
          onClick={onAction}
        />
      )}
    </div>
  );
}
function OrderForm({
  value,
  busy,
  onSubmit,
}: {
  value?: Order;
  busy: boolean;
  onSubmit: (v: unknown) => void;
}) {
  const [customer, setCustomer] = useState(value?.customer || ""),
    [contact, setContact] = useState(value?.contact || ""),
    [notes, setNotes] = useState(value?.notes || ""),
    [shipBy, setShipBy] = useState(value?.ship_by || "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          customer,
          contact,
          notes,
          ship_by: shipBy,
          version: value?.version,
        });
      }}
    >
      <div className="form-grid">
        <Field label="Customer name">
          <input
            autoFocus
            required
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="e.g. Jamie Smith"
          />
        </Field>
        <Field label="Email or contact">
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Optional"
          />
        </Field>
      </div>
      <Field label="Ship by">
        <input
          type="date"
          value={shipBy}
          onChange={(e) => setShipBy(e.target.value)}
        />
      </Field>
      <Field label="Notes">
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any requests or delivery details…"
        />
      </Field>
      <div className="form-actions">
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? "Saving…" : value ? "Save changes" : "Create draft"}{" "}
          <ArrowRight size={16} />
        </button>
      </div>
    </form>
  );
}
function FilamentForm({
  value,
  busy,
  onSubmit,
  onDelete,
}: {
  value?: Filament;
  busy: boolean;
  onSubmit: (v: unknown) => void;
  onDelete?: () => void;
}) {
  const features = useFeatures();
  const [name, setName] = useState(value?.name || ""),
    [brand, setBrand] = useState(value?.brand || ""),
    [material, setMaterial] = useState(value?.material || "PLA"),
    [color, setColor] = useState(value?.color || "#d48c68"),
    [notes, setNotes] = useState(value?.notes || "");
  const [spoolCount, setSpoolCount] = useState(value?.spool_count ?? 0),
    [gramsPerSpool, setGramsPerSpool] = useState(
      value?.grams_per_spool ?? 1000,
    ),
    [imageUrl, setImageUrl] = useState(value?.image_url || ""),
    [uploading, setUploading] = useState(false);
  const [remaining, setRemaining] = useState(
      value?.remaining_grams ??
        (value?.spool_count ?? 0) * (value?.grams_per_spool ?? 1000),
    ),
    [cost, setCost] = useState(value?.cost_per_kg ?? 0);
  async function upload(file?: File) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api("/upload", "POST", form);
      setImageUrl(result.url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          name,
          brand,
          material,
          color,
          notes,
          image_url: imageUrl,
          spool_count: spoolCount,
          grams_per_spool: gramsPerSpool,
          remaining_grams: remaining,
          cost_per_kg: cost,
          version: value?.version,
        });
      }}
    >
      <div className="form-grid">
        <Field label="Colour name">
          <input
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Terracotta"
          />
        </Field>
        <Field label="Brand">
          <input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="e.g. Bambu Lab"
          />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Material">
          <select
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
          >
            {["PLA", "PETG", "ABS", "ASA", "TPU", "Other"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Swatch colour">
          <div className="color-input">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
            <span>{color.toUpperCase()}</span>
          </div>
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Spools in stock">
          <input
            type="number"
            min="0"
            step="1"
            value={spoolCount}
            onChange={(e) => setSpoolCount(Number(e.target.value))}
          />
        </Field>
        <Field label="Approx. grams per spool">
          <input
            type="number"
            min="1"
            step="1"
            value={gramsPerSpool}
            onChange={(e) => setGramsPerSpool(Number(e.target.value))}
          />
        </Field>
      </div>
      {(features.material_tracking || features.cost_reporting) && (
        <div className="form-grid">
          {features.material_tracking && (
            <Field label="Remaining material (grams)">
              <input
                type="number"
                min="0"
                value={remaining}
                onChange={(e) => setRemaining(Number(e.target.value))}
              />
            </Field>
          )}
          {features.cost_reporting && (
            <Field label="Material cost per kg">
              <input
                type="number"
                min="0"
                step="0.01"
                value={cost}
                onChange={(e) => setCost(Number(e.target.value))}
              />
            </Field>
          )}
        </div>
      )}
      <Field label="Spool photo">
        <div className="upload-row">
          {imageUrl && <img src={imageUrl} alt="Spool preview" />}
          <label className="upload-button">
            {uploading
              ? "Uploading…"
              : imageUrl
                ? "Change photo"
                : "Upload photo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </label>
          {imageUrl && (
            <button
              type="button"
              className="danger-text"
              onClick={() => setImageUrl("")}
            >
              Remove photo
            </button>
          )}
        </div>
      </Field>
      <Field label="Notes">
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Finish, storage details…"
        />
      </Field>
      {features.material_tracking && (
        <>
          <p className="muted">
            Spool adjustments change remaining grams. Completed and failed
            prints consume the estimated grams per piece. Correct the remaining
            weight after weighing your spool.
          </p>
          {value && <StockHistory filamentId={value.id} api={api} />}
        </>
      )}
      <div className="form-actions">
        {onDelete && (
          <button type="button" className="danger-text" onClick={onDelete}>
            Archive filament
          </button>
        )}
        <button
          type="submit"
          className="auth-submit"
          disabled={busy || uploading}
        >
          {busy ? "Saving…" : value ? "Save changes" : "Add filament"}{" "}
          <ArrowRight size={16} />
        </button>
      </div>
    </form>
  );
}
function ProductForm({
  value,
  filaments,
  showMoney,
  currency,
  busy,
  onSubmit,
  onDelete,
}: {
  value?: Product;
  filaments: Filament[];
  showMoney: boolean;
  currency: string;
  busy: boolean;
  onSubmit: (v: unknown) => void;
  onDelete?: () => void;
}) {
  const features = useFeatures();
  const [name, setName] = useState(value?.name || ""),
    [description, setDescription] = useState(value?.description || ""),
    [price, setPrice] = useState(String(value?.price ?? "")),
    [imageUrl, setImageUrl] = useState(value?.image_url || ""),
    [ids, setIds] = useState<number[]>(value?.filament_ids || []),
    [uploading, setUploading] = useState(false);
  const [details, setDetails] = useState({
    grams_per_piece: value?.grams_per_piece || 0,
    minutes_per_piece: value?.minutes_per_piece || 0,
    production_url: value?.production_url || "",
    revision: value?.revision || "",
    print_profile: value?.print_profile || "",
  });
  async function upload(file?: File) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api("/upload", "POST", form);
      setImageUrl(result.url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          name,
          description,
          price: Number(price || 0),
          image_url: imageUrl,
          filament_ids: ids,
          version: value?.version,
          ...details,
        });
      }}
    >
      <div className="form-grid">
        <Field label="Product name">
          <input
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Desk organiser"
          />
        </Field>
        {showMoney && (
          <Field label={`Price (${currency})`}>
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
          </Field>
        )}
      </div>
      <Field label="Description">
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A short description of this print…"
        />
      </Field>
      {(features.production_tools ||
        features.material_tracking ||
        features.cost_reporting) && (
        <ProductionFields value={details} onChange={setDetails} />
      )}
      <Field label="Example image">
        <div className="upload-row">
          {imageUrl && <img src={imageUrl} alt="Product preview" />}
          <label className="upload-button">
            {uploading
              ? "Uploading…"
              : imageUrl
                ? "Change image"
                : "Upload image"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </label>
          <small>PNG, JPEG or WebP · max 5 MB</small>
        </div>
      </Field>
      <div className="field">
        <span>Offered filaments</span>
        {filaments.length ? (
          <div className="choice-grid">
            {filaments.map((f) => (
              <label
                key={f.id}
                className={ids.includes(f.id) ? "choice selected" : "choice"}
              >
                <input
                  type="checkbox"
                  checked={ids.includes(f.id)}
                  onChange={(e) =>
                    setIds(
                      e.target.checked
                        ? [...ids, f.id]
                        : ids.filter((x) => x !== f.id),
                    )
                  }
                />
                <i style={{ background: f.color }} />
                <span>{f.name}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="muted">Add filaments first to offer colour options.</p>
        )}
      </div>
      <div className="form-actions">
        {onDelete && (
          <button type="button" className="danger-text" onClick={onDelete}>
            Archive product
          </button>
        )}
        <button
          type="submit"
          className="auth-submit"
          disabled={busy || uploading}
        >
          {busy ? "Saving…" : value ? "Save changes" : "Add product"}{" "}
          <ArrowRight size={16} />
        </button>
      </div>
    </form>
  );
}
function ItemForm({
  value,
  draft = false,
  products,
  filaments,
  showMoney,
  currency,
  busy,
  onSubmit,
}: {
  value?: Item;
  draft?: boolean;
  products: Product[];
  filaments: Filament[];
  showMoney: boolean;
  currency: string;
  busy: boolean;
  onSubmit: (v: unknown) => void;
}) {
  const [productId, setProductId] = useState(
      value ? value.product_id || 0 : products[0]?.id || 0,
    ),
    [filamentId, setFilamentId] = useState(value?.filament_id || 0),
    [count, setCount] = useState(value?.quantity || 1);
  const [printed, setPrinted] = useState(value?.printed_quantity || 0),
    [shipped, setShipped] = useState(value?.shipped_quantity || 0);
  const product = products.find((p) => p.id === productId),
    choices = filaments.filter((f) => product?.filament_ids.includes(f.id));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          product_id: productId || null,
          filament_id: filamentId || null,
          quantity: count,
          printed_quantity: draft ? 0 : printed,
          shipped_quantity: draft ? 0 : shipped,
          version: value?.version,
        });
      }}
    >
      {products.length || value ? (
        <>
          <Field label="Product">
            <select
              value={productId}
              onChange={(e) => {
                setProductId(Number(e.target.value));
                setFilamentId(0);
              }}
            >
              {value && !products.some((p) => p.id === value.product_id) && (
                <option value={value.product_id || 0}>
                  {value.product_name} (historical)
                </option>
              )}
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {showMoney ? ` · ${money(p.price, currency)}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Filament">
              <select
                value={filamentId}
                onChange={(e) => setFilamentId(Number(e.target.value))}
              >
                <option value={0}>
                  {value?.filament_id === null && value.filament_name
                    ? `${value.filament_name} (historical)`
                    : "No filament selected"}
                </option>
                {value?.filament_id &&
                  !choices.some((f) => f.id === value.filament_id) && (
                    <option value={value.filament_id}>
                      {value.filament_name} (historical)
                    </option>
                  )}
                {choices.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.material})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantity">
              <input
                type="number"
                min="1"
                max="10000"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </Field>
          </div>
          {value && !draft && (
            <>
              <p className="muted">
                Adjust these counts to correct progress. Shipped cannot exceed
                printed, and printed cannot exceed quantity.
              </p>
              <div className="form-grid">
                <Field label="Printed">
                  <input
                    type="number"
                    min="0"
                    max={count}
                    value={printed}
                    onChange={(e) => setPrinted(Number(e.target.value))}
                  />
                </Field>
                <Field label="Shipped">
                  <input
                    type="number"
                    min="0"
                    max={printed}
                    value={shipped}
                    onChange={(e) => setShipped(Number(e.target.value))}
                  />
                </Field>
              </div>
            </>
          )}
          <div className="form-actions">
            <button type="submit" className="auth-submit" disabled={busy}>
              {busy ? "Saving…" : value ? "Save item" : "Add to order"}{" "}
              <ArrowRight size={16} />
            </button>
          </div>
        </>
      ) : (
        <p className="muted">
          Add a product to your catalogue before adding print items.
        </p>
      )}
    </form>
  );
}

const noticeLabels: {
  key: keyof NoticePreferences;
  title: string;
  help: string;
}[] = [
  {
    key: "draft_created",
    title: "New draft",
    help: "Someone starts an order draft",
  },
  {
    key: "sale_confirmed",
    title: "Sale confirmed",
    help: "A draft enters the print queue",
  },
  {
    key: "print_stage",
    title: "Print stage changes",
    help: "A print moves through fulfillment",
  },
  {
    key: "order_shipped",
    title: "Order shipped",
    help: "All items in an order are shipped",
  },
  {
    key: "deadline_soon",
    title: "Deadline approaching",
    help: "A confirmed sale is due to ship within two days",
  },
  {
    key: "deadline_overdue",
    title: "Deadline overdue",
    help: "A confirmed sale has passed its ship-by date",
  },
];
function SettingsPanel({
  data,
  refresh,
  onTeam,
  onProducts,
  onJobs,
  onSignOut,
}: {
  data: Data;
  refresh: () => Promise<void>;
  onTeam: () => void;
  onProducts: () => void;
  onJobs: () => void;
  onSignOut: () => void;
}) {
  const [showMoney, setShowMoney] = useState(data.settings.show_money),
    [currency, setCurrency] = useState(data.settings.currency);
  const [rates, setRates] = useState({
    machine_hourly_rate: data.settings.machine_hourly_rate,
    electricity_per_kwh: data.settings.electricity_per_kwh,
    printer_watts: data.settings.printer_watts,
  });
  const [features, setFeatures] = useState<Features>(
    Object.fromEntries(
      Object.keys(featureDefaults).map((key) => [
        key,
        data.settings[key as keyof Features],
      ]),
    ) as Features,
  );
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [subscribed, setSubscribed] = useState(false);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.pushManager?.getSubscription())
        .then(async (subscription) =>
          setSubscribed(
            subscription
              ? (
                  await api(
                    `/push-subscriptions/status?endpoint=${encodeURIComponent(subscription.endpoint)}`,
                  )
                ).subscribed
              : false,
          ),
        )
        .catch(console.error);
  }, []);
  const prefs = data.notifications?.preferences;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const supported =
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  async function run(work: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await work();
      await refresh();
      setMessage(success);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }
  function enable() {
    if (!supported) {
      setMessage(
        "Notifications need HTTPS and a browser with Web Push support.",
      );
      return;
    }
    if (isIOS && !standalone) {
      setMessage(
        "On iPhone, open Printroom in Safari, tap Share → Add to Home Screen, then open it from the new icon and return here.",
      );
      return;
    }
    // Request permission directly inside the button click to keep the user gesture on iOS.
    const permission = Notification.requestPermission();
    void run(async () => {
      if ((await permission) !== "granted")
        throw new Error(
          "Notifications were not allowed. You can change this in your device settings.",
        );
      const registration = await navigator.serviceWorker.ready;
      const key = data.notifications?.vapidPublicKey;
      if (!key) throw new Error("Push is unavailable on this server.");
      const bytes = Uint8Array.from(
        atob(
          key.replace(/-/g, "+").replace(/_/g, "/") +
            "=".repeat((4 - (key.length % 4)) % 4),
        ),
        (char) => char.charCodeAt(0),
      );
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
      await api("/push-subscriptions", "POST", {
        subscription: subscription.toJSON(),
      });
      setSubscribed(true);
    }, "Notifications enabled on this device.");
  }
  function disable() {
    void run(async () => {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api("/push-subscriptions", "DELETE", {
          endpoint: subscription.endpoint,
        });
        await subscription.unsubscribe();
      }
      setSubscribed(false);
    }, "Notifications disabled on this device.");
  }
  function changePref(key: keyof NoticePreferences, checked: boolean) {
    if (!prefs) return;
    void run(
      () =>
        api(
          "/notification-preferences",
          "PUT",
          Object.fromEntries(
            noticeLabels.map((entry) => [
              entry.key,
              entry.key === key ? checked : !!prefs[entry.key],
            ]),
          ),
        ),
      "Notification choices saved.",
    );
  }
  return (
    <div className="settings-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h1>Settings</h1>
          <p>Choose how your studio works for you.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="settings-title">
            <Settings2 size={21} />
            <div>
              <h2>Workspace</h2>
              <p>Shared across everyone in this studio.</p>
            </div>
          </div>
          <label className="setting-toggle">
            <span>
              <strong>Show money</strong>
              <small>
                Display prices and order totals throughout Printroom.
              </small>
            </span>
            <input
              type="checkbox"
              checked={showMoney}
              disabled={!data.user?.is_admin || busy}
              onChange={(e) => setShowMoney(e.target.checked)}
            />
          </label>
          <Field label="Currency">
            <select
              value={currency}
              disabled={!data.user?.is_admin || busy}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {[
                "GBP",
                "USD",
                "EUR",
                "CAD",
                "AUD",
                "NZD",
                "JPY",
                "CHF",
                "SEK",
                "NOK",
                "DKK",
                "INR",
              ].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </Field>
          <h3>Optional tools</h3>
          <p className="muted">
            All start off. Enable only what your studio needs. Turning a tool
            off keeps its saved data.
          </p>
          {(
            [
              ["production_tools", "Production details and print history"],
              [
                "material_tracking",
                "Material planning and automatic consumption",
              ],
              ["cost_reporting", "Production costs and contribution"],
              ["sales_tools", "Payments, shipment tracking and packing slips"],
            ] as const
          ).map(([key, label]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                type="checkbox"
                checked={features[key]}
                disabled={!data.user?.is_admin || busy}
                onChange={(e) =>
                  setFeatures({ ...features, [key]: e.target.checked })
                }
              />
            </label>
          ))}
          {features.cost_reporting && (
            <>
              <p className="muted">
                Production cost assumptions are saved with new orders. Machine
                cost covers wear and overhead; electricity is calculated
                separately.
              </p>
              {(
                [
                  [
                    "machine_hourly_rate",
                    `Machine cost per hour (${currency})`,
                  ],
                  ["electricity_per_kwh", `Electricity per kWh (${currency})`],
                  ["printer_watts", "Average printer power (watts)"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    type="number"
                    min="0"
                    max="1000000"
                    step="any"
                    value={rates[key]}
                    disabled={!data.user?.is_admin || busy}
                    onChange={(e) =>
                      setRates({ ...rates, [key]: Number(e.target.value) })
                    }
                  />
                </Field>
              ))}
            </>
          )}
          {data.user?.is_admin ? (
            <button
              type="button"
              className="auth-submit settings-save"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    api("/settings", "PUT", {
                      ...rates,
                      ...features,
                      show_money: showMoney,
                      currency,
                    }),
                  "Workspace settings saved.",
                )
              }
            >
              Save workspace settings
            </button>
          ) : (
            <p className="muted">An owner can change workspace settings.</p>
          )}
        </section>
        <section className="panel settings-card">
          <div className="settings-title">
            <Bell size={21} />
            <div>
              <h2>Notifications</h2>
              <p>These choices are just for {data.user?.name}.</p>
            </div>
          </div>
          <div className="notification-status">
            <strong>
              {subscribed
                ? "Set up on this device"
                : "Not set up on this device"}
            </strong>
            <small>
              {isIOS
                ? "On iPhone, install Printroom to your Home Screen first."
                : "Push notifications arrive even when Printroom is closed."}
            </small>
          </div>
          <div className="settings-actions">
            {subscribed ? (
              <button
                type="button"
                className="outline-button"
                disabled={busy}
                onClick={disable}
              >
                Turn off on this device
              </button>
            ) : (
              <button
                type="button"
                className="auth-submit"
                disabled={busy}
                onClick={enable}
              >
                Set up notifications
              </button>
            )}
            {subscribed && (
              <button
                type="button"
                className="outline-button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => api("/notifications/test", "POST"),
                    "Test notification sent.",
                  )
                }
              >
                Send test
              </button>
            )}
          </div>
          {!supported && (
            <p className="muted">
              Open Printroom over HTTPS to enable notifications. Localhost also
              works for testing.
            </p>
          )}
          <div className="preference-list">
            {noticeLabels.map((entry) => (
              <label className="setting-toggle" key={entry.key}>
                <span>
                  <strong>{entry.title}</strong>
                  <small>{entry.help}</small>
                </span>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={!!prefs?.[entry.key]}
                  onChange={(e) => changePref(entry.key, e.target.checked)}
                />
              </label>
            ))}
          </div>
        </section>
        <section className="panel settings-card">
          <div className="settings-title">
            <Users size={21} />
            <div>
              <h2>Account and catalogue</h2>
              <p>Signed in as @{data.user?.username}</p>
            </div>
          </div>
          <div className="settings-actions">
            <button
              type="button"
              className="outline-button"
              onClick={onProducts}
            >
              Manage products
            </button>
            {!!data.user?.is_admin && (
              <button type="button" className="outline-button" onClick={onTeam}>
                Manage team
              </button>
            )}
            {data.settings.production_tools && (
              <button type="button" className="outline-button" onClick={onJobs}>
                Print history
              </button>
            )}
            <button
              type="button"
              className="outline-button"
              onClick={onSignOut}
            >
              Sign out
            </button>
          </div>
          <AccountPassword api={api} />
        </section>
      </div>
      {message && (
        <p className="settings-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

function UserForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (v: unknown) => void;
}) {
  const [name, setName] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, username, password });
      }}
    >
      <Field label="Name">
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Alex Maker"
        />
      </Field>
      <Field label="Username">
        <input
          required
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="alex"
        />
      </Field>
      <Field label="Temporary password">
        <input
          required
          maxLength={1024}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter a password"
        />
      </Field>
      <p className="muted">
        Share the password with this person so they can sign in.
      </p>
      <div className="form-actions">
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? "Adding…" : "Add user"}
          <ArrowRight size={16} />
        </button>
      </div>
    </form>
  );
}
function PasswordForm({
  user,
  busy,
  onSubmit,
}: {
  user: User;
  busy: boolean;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState(""),
    [again, setAgain] = useState(""),
    [mismatch, setMismatch] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (password !== again) {
          setMismatch(true);
          return;
        }
        onSubmit(password);
      }}
    >
      <p className="muted">
        Set a new password for @{user.username}.{" "}
        {user.is_admin ? "Other owner sessions" : "Their active sessions"} will
        be signed out.
      </p>
      <Field label="New password">
        <input
          required
          maxLength={1024}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setMismatch(false);
          }}
          placeholder="Enter a password"
        />
      </Field>
      <Field label="Confirm new password">
        <input
          required
          maxLength={1024}
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(event) => {
            setAgain(event.target.value);
            setMismatch(false);
          }}
          placeholder="Enter it again"
        />
      </Field>
      {mismatch && (
        <p className="error" role="alert">
          Passwords do not match.
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? "Saving…" : "Change password"}
          <ArrowRight size={16} />
        </button>
      </div>
    </form>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
