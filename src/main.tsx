import { apiPath } from "../shared/api-path";
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
  Ellipsis,
} from "lucide-react";
import "./styles.css";
import "./workspace.css";
import "./production.css";
import "./mobile.css";
import {
  queueEntries,
  countPieces,
  activePieceEntry,
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
import { OrdersBrowser, type OrderFilter } from "./OrdersBrowser";
import { useDecision } from "./useDecision";
import { Modal } from "./Modal";
import { Deadline, shipDate } from "./Deadline";
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
  printing: "In progress",
  printed: "Ready to ship",
  shipped: "Shipped",
  cancelled: "Cancelled",
};
const itemStageNames: Record<ItemStage, string> = {
  queued: "Queued",
  printing: "Now printing",
  printed: "Ready to ship",
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
const styles = stylex.create({
  brand: { letterSpacing: "-0.045em", fontWeight: 800 },
});
async function api(
  path: string,
  method = "GET",
  value?: unknown,
  query?: Record<string, string | number>,
) {
  const url = new URL(apiPath(path), window.location.origin);
  for (const [key, value] of Object.entries(query || {}))
    url.searchParams.set(key, String(value));
  const res = await fetch(url, {
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
  let result: any = null;
  try {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      result = await res.json();
    } else {
      const text = await res.text();
      if (text) {
        try {
          result = JSON.parse(text);
        } catch {
          result = null;
        }
      }
    }
  } catch {
    result = null;
  }
  if (!res.ok)
    throw new Error(result?.error || `Request failed (${res.status})`);
  return result;
}
function App() {
  const [data, setData] = useState<Data | null>(null);
  const [page, setPage] = useState<Page>("overview");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [orderFilters, setOrderFilters] = useState({
    filter: "all" as OrderFilter,
    query: "",
  });
  const [selectedOrder, setSelectedOrder] = useState<number | null>(null);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const heading = document.querySelector("main h1");
    if (heading instanceof HTMLElement) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [page, selectedOrder]);
  const [catalogueFilters, setCatalogueFilters] = useState({
    products: { search: "", archived: false },
    filaments: { search: "", archived: false },
  });
  const catalogueTab = page === "filaments" ? "filaments" : "products";
  const { search: catalogueSearch, archived: showArchivedCatalogue } =
    catalogueFilters[catalogueTab];
  const setCatalogueSearch = (search: string) =>
    setCatalogueFilters((current) => ({
      ...current,
      [catalogueTab]: { ...current[catalogueTab], search },
    }));
  const setShowArchivedCatalogue = (archived: boolean) =>
    setCatalogueFilters((current) => ({
      ...current,
      [catalogueTab]: { ...current[catalogueTab], archived },
    }));
  const [queueFilter, setQueueFilter] = useState<"all" | "queued" | "printing">(
    "all",
  );
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("printroom-theme") === "dark" ? "dark" : "light",
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const pendingRef = useRef(new Set<string>());
  const refreshNeeded = useRef(false);
  const activeMutations = useRef(new Set<string>());
  const settledKeys = useRef(new Set<string>());
  const { confirm, decision } = useDecision();
  const dialogKey =
    dialog && (dialog.type === "item" || dialog.type === "edit_item")
      ? `order:${dialog.order.id}`
      : dialog && "value" in dialog && dialog.value
        ? `${dialog.type === "password" ? "user" : dialog.type}:${dialog.value.id}`
        : `create:${dialog?.type ?? "order"}`;
  const busy = !!pending[dialog ? dialogKey : `order:${selectedOrder}`];
  const [updateWorker, setUpdateWorker] = useState<ServiceWorker | null>(null);
  const [live, setLive] = useState(false);
  const requestNumber = useRef(0);
  const selectedRef = useRef(selectedOrder);
  selectedRef.current = selectedOrder;
  const [orderActivity, setOrderActivity] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [activityRetry, setActivityRetry] = useState(0);
  const activityGeneration = useRef(0);
  function releaseSettled() {
    for (const id of settledKeys.current) pendingRef.current.delete(id);
    settledKeys.current.clear();
    setPending(
      Object.fromEntries([...pendingRef.current].map((id) => [id, true])),
    );
  }
  const refresh = async () => {
    if (activeMutations.current.size) {
      refreshNeeded.current = true;
      return;
    }
    refreshNeeded.current = false;
    const current = ++requestNumber.current;
    try {
      const next = await api(
        `/bootstrap${selectedRef.current ? `?order=${selectedRef.current}` : ""}`,
      );
      if (current === requestNumber.current) {
        setData(next);
        releaseSettled();
      }
    } catch (error) {
      if (current === requestNumber.current) releaseSettled();
      throw error;
    }
  };

  useEffect(() => {
    const generation = ++activityGeneration.current;
    setOrderActivity([]);
    setActivityError("");
    setActivityLoading(!!selectedOrder);
    if (selectedOrder)
      void api(`/orders/${selectedOrder}/activity`)
        .then((rows) => {
          if (generation === activityGeneration.current) setOrderActivity(rows);
        })
        .catch((e) => {
          if (generation === activityGeneration.current)
            setActivityError(e.message);
        })
        .finally(() => {
          if (generation === activityGeneration.current)
            setActivityLoading(false);
        });
    return () => {
      ++activityGeneration.current;
    };
  }, [
    selectedOrder,
    data?.orders.find((o) => o.id === selectedOrder)?.version,
    activityRetry,
  ]);
  async function moreActivity() {
    if (!selectedOrder || activityLoading) return;
    const generation = activityGeneration.current;
    setActivityLoading(true);
    setActivityError("");
    try {
      const rows = await api(
        `/orders/${selectedOrder}/activity?before=${orderActivity.at(-1)?.id || ""}`,
      );
      if (generation === activityGeneration.current)
        setOrderActivity((current) => [...current, ...rows]);
    } catch (e) {
      if (generation === activityGeneration.current)
        setActivityError(
          e instanceof Error ? e.message : "Could not load activity",
        );
    } finally {
      if (generation === activityGeneration.current) setActivityLoading(false);
    }
  }
  useEffect(() => {
    if (selectedOrder) void refresh().catch((e) => setError(e.message));
  }, [selectedOrder]);
  const signOut = () =>
    action(
      async () => {
        try {
          if ("serviceWorker" in navigator) {
            const registration =
              await navigator.serviceWorker.getRegistration();
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
      },
      false,
      "session",
    );
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
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#151719" : "#f7f7f5");
  }, [theme]);
  async function action(
    work: () => Promise<unknown>,
    close = true,
    key = dialog ? dialogKey : `order:${selectedOrder}`,
    reload = true,
    locks: string[] = [],
  ) {
    if ([key, ...locks].some((id) => pendingRef.current.has(id))) return;
    const openedDialog = dialog;
    activeMutations.current.add(key);
    for (const id of [key, ...locks]) pendingRef.current.add(id);
    ++requestNumber.current;
    setPending(
      Object.fromEntries([...pendingRef.current].map((id) => [id, true])),
    );
    setError("");
    try {
      await work();
      if (close)
        setDialog((current) => (current === openedDialog ? null : current));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      activeMutations.current.delete(key);
      for (const id of [key, ...locks]) settledKeys.current.add(id);
      refreshNeeded.current ||= reload;
      // Keep conflicts disabled until the final response has reconciled the batch.
      if (!activeMutations.current.size) {
        if (refreshNeeded.current) {
          try {
            await refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Refresh failed");
          }
        } else {
          releaseSettled();
        }
      }
    }
  }

  function adjustStock(filament: Filament, delta: number) {
    void action(
      async () => {
        setData(
          (current) =>
            current && {
              ...current,
              filaments: current.filaments.map((f) =>
                f.id === filament.id
                  ? {
                      ...f,
                      spool_count: f.spool_count + delta,
                      remaining_grams: Math.max(
                        0,
                        f.remaining_grams + delta * f.grams_per_spool,
                      ),
                      version: f.version + 1,
                    }
                  : f,
              ),
            },
        );
        try {
          await api(`/filaments/${filament.id}/stock`, "PUT", { delta });
        } catch (error) {
          setData(
            (current) =>
              current && {
                ...current,
                filaments: current.filaments.map((f) =>
                  f.id === filament.id ? filament : f,
                ),
              },
          );
          throw error;
        }
      },
      false,
      `filament:${filament.id}`,
      false,
    );
  }
  if (!data)
    return (
      <div className="loading">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              className="outline-button"
              onClick={() => {
                setError("");
                void refresh().catch((e) => setError(e.message));
              }}
            >
              Retry
            </button>
          </>
        ) : (
          <p role="status">Loading Printroom…</p>
        )}
      </div>
    );
  if (!data.user) return <Auth setup={data.needsSetup} onDone={refresh} />;

  const chosen = data.orders.find((o) => o.id === selectedOrder) || null;
  const allPrints = queueEntries(data.orders);
  const queue = allPrints.filter(
    (entry) =>
      entry.piece.status === "queued" || entry.piece.status === "printing",
  );
  const queuedOnly = allPrints.filter(
    (entry) => entry.piece.status === "queued",
  );
  const ready = allPrints.filter((entry) => entry.piece.status === "printed");
  const activeEntry = activePieceEntry(data.orders);
  const activePieceId = activeEntry?.piece.id;
  const activeOrderIds = new Set(
    allPrints
      .filter((entry) => entry.piece.status === "printing")
      .map((entry) => entry.order.id),
  );
  const pieceAction = (
    entry: PieceEntry,
    step: PieceAction,
    printer = "",
    notes = "",
    actualGrams?: number,
  ) => {
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
      `order:${entry.order.id}`,
      true,
      step === "start" ? ["printer"] : [],
    );
  };
  const tabs: {
    id: Page;
    label: string;
    icon: React.ReactNode;
    count?: number;
    alert?: boolean;
    mobileLabel?: string;
  }[] = [
    {
      id: "overview",
      label: "Overview",
      icon: <LayoutDashboard aria-hidden="true" size={20} />,
    },
    {
      id: "queue",
      label: activeEntry ? "Printing now" : "Queue",
      mobileLabel: "Queue",
      icon: <ListTodo aria-hidden="true" size={20} />,
      count: queue.length,
      alert: !!activeEntry,
    },
    {
      id: "orders",
      label: "Orders",
      icon: <ClipboardList aria-hidden="true" size={20} />,
      count: data.orders.filter((o) => o.is_draft).length,
    },
    ...(data.settings.production_tools
      ? [
          {
            id: "jobs" as Page,
            label: "Print history",
            icon: <Printer aria-hidden="true" size={20} />,
          },
        ]
      : []),
    {
      id: "products",
      label: "Products",
      icon: <Boxes aria-hidden="true" size={20} />,
    },
    {
      id: "filaments",
      label: "Filaments",
      icon: <Layers3 aria-hidden="true" size={20} />,
    },
    ...(data.user.is_admin
      ? [
          {
            id: "team" as Page,
            label: "Team",
            icon: <Users aria-hidden="true" size={20} />,
          },
        ]
      : []),
    {
      id: "settings",
      label: "Settings",
      icon: <Settings2 aria-hidden="true" size={20} />,
    },
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
              <Printer aria-hidden="true" size={23} strokeWidth={2.3} />
            </div>
            <span {...stylex.props(styles.brand)}>
              printroom<span className="brand-dot">.</span>
            </span>
          </div>
          <div className="workspace-label">WORKSPACE</div>
          <nav aria-label="Workspace">
            {tabs.map((tab) => (
              <button
                type="button"
                key={tab.id}
                data-page={tab.id}
                aria-current={page === tab.id ? "page" : undefined}
                title={tab.label}
                className={`nav${page === tab.id ? " active" : ""}`}
                onClick={() => {
                  setPage(tab.id);
                  setSelectedOrder(null);
                }}
              >
                {tab.icon}
                <span
                  className={tab.mobileLabel ? "desktop-nav-label" : undefined}
                >
                  {tab.label}
                </span>
                {tab.mobileLabel && (
                  <span className="mobile-only">{tab.mobileLabel}</span>
                )}
                {tab.id === "queue" && tab.alert && (
                  <i
                    className="nav-printing-dot"
                    aria-label="A print is running"
                    title="A print is running"
                  />
                )}
                {!!tab.count && (
                  <b aria-hidden="true">{tab.count > 99 ? "99+" : tab.count}</b>
                )}
              </button>
            ))}
            <button
              type="button"
              className={`nav mobile-only${page === "products" || page === "filaments" ? " active" : ""}`}
              aria-current={
                page === "products" || page === "filaments" ? "page" : undefined
              }
              onClick={() => {
                setPage(page === "filaments" ? "filaments" : "products");
                setSelectedOrder(null);
              }}
            >
              <Boxes aria-hidden="true" size={20} />
              <span>Catalogue</span>
            </button>
            <button
              type="button"
              className={`nav mobile-only${["settings", "team", "jobs"].includes(page) ? " active" : ""}`}
              aria-label="More"
              aria-haspopup="dialog"
              aria-expanded={mobileMenu}
              onClick={() => setMobileMenu(true)}
            >
              <Ellipsis aria-hidden="true" size={20} />
              <span>More</span>
            </button>
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
              <button
                type="button"
                title="Sign out"
                aria-label="Sign out"
                disabled={Object.keys(pending).length > 0}
                onClick={signOut}
              >
                <LogOut aria-hidden="true" size={18} />
              </button>
            </div>
          </div>
        </aside>
        <main className="main">
          <header className="topbar">
            <span className="mobile-only mobile-brand">
              <Printer aria-hidden="true" size={19} />
              printroom<span className="brand-dot">.</span>
            </span>
            <div className="top-right">
              <span
                role="status"
                aria-live="polite"
                className={`live-status${live ? " connected" : ""}`}
                title={
                  live
                    ? "Changes from your team appear automatically"
                    : "Changes are checked periodically"
                }
              >
                <i aria-hidden="true" />
                {live ? "Live" : "Reconnecting"}
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
                {theme === "dark" ? (
                  <Sun aria-hidden="true" size={19} />
                ) : (
                  <Moon aria-hidden="true" size={19} />
                )}
              </button>
            </div>
          </header>
          <div className="content workspace-content">
            {(page === "products" || page === "filaments") && (
              <nav
                className="mobile-only catalogue-tabs"
                aria-label="Catalogue"
              >
                {(["products", "filaments"] as const).map((tab) => (
                  <button
                    type="button"
                    key={tab}
                    aria-current={page === tab ? "page" : undefined}
                    onClick={() => setPage(tab)}
                  >
                    {tab === "products" ? (
                      <Boxes aria-hidden="true" size={18} />
                    ) : (
                      <Layers3 aria-hidden="true" size={18} />
                    )}
                    {tab === "products" ? "Products" : "Filaments"}
                  </button>
                ))}
              </nav>
            )}
            {page === "overview" && (
              <>
                <div className="page-heading">
                  <div>
                    <h1>Overview</h1>
                  </div>
                  <Button
                    label="New draft"
                    variant="primary"
                    icon={<Plus aria-hidden="true" size={17} />}
                    onClick={() => setDialog({ type: "order" })}
                  />
                </div>
                <div className="stat-grid">
                  <Stat
                    label={activeEntry ? "Now printing" : "Printer"}
                    value={activeEntry ? 1 : 0}
                    sub={
                      activeEntry
                        ? `${activeEntry.item.product_name} · order #${String(activeEntry.order.id).padStart(4, "0")}`
                        : "Idle · ready to start"
                    }
                    alert={!!activeEntry}
                  />
                  <Stat
                    label="Queued pieces"
                    value={queuedOnly.length}
                    sub="Waiting to start"
                  />
                  <Stat
                    label="Ready to ship"
                    value={ready.length}
                    sub="Printed · not yet shipped"
                  />
                  <Stat
                    label="Draft orders"
                    value={data.orders.filter((o) => o.is_draft).length}
                    sub="Not yet in the queue"
                  />
                </div>
                <NowPrintingBanner entry={activeEntry} onOpen={openOrder} />
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
                      Full queue <ArrowRight aria-hidden="true" size={16} />
                    </button>
                  </div>
                  <PieceQueue
                    entries={queue.slice(0, 6)}
                    activePieceId={activePieceId}
                    busy={false}
                    pending={pending}
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
                      All orders <ArrowRight aria-hidden="true" size={16} />
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
                          <Package aria-hidden="true" size={19} />
                        </span>
                        <span>
                          <strong>
                            #{String(order.id).padStart(4, "0")} ·{" "}
                            {order.customer}
                          </strong>
                          <small>
                            {(() => {
                              const counts = countPieces(order);
                              if (order.is_draft)
                                return `${order.items.length} ${order.items.length === 1 ? "item" : "items"} · draft · not in queue`;
                              if (!counts.total)
                                return `No pieces · ${date(order.created_at)}`;
                              if (activeOrderIds.has(order.id))
                                return `${counts.queued} queued · 1 now printing · ${counts.printed} ready · ${counts.shipped} shipped`;
                              return `${counts.queued + counts.printing} to print · ${counts.printed} ready · ${counts.shipped} shipped`;
                            })()}
                          </small>
                        </span>
                        <OrderStatusBadge
                          order={order}
                          isActive={activeOrderIds.has(order.id)}
                        />
                      </button>
                    ))}
                    {!data.orders.length && (
                      <Empty
                        small
                        icon={<ClipboardList aria-hidden="true" />}
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
                    <h1>{activeEntry ? "Now printing" : "Print queue"}</h1>
                    <p>
                      {activeEntry
                        ? `${activeEntry.item.product_name} · order #${String(activeEntry.order.id).padStart(4, "0")} is on the printer. ${queuedOnly.length} queued behind it · ${ready.length} ready to ship.`
                        : queuedOnly.length
                          ? `${queuedOnly.length} ${queuedOnly.length === 1 ? "piece" : "pieces"} queued · printer idle · ${ready.length} ready to ship.`
                          : `Printer idle · ${ready.length} ${ready.length === 1 ? "piece" : "pieces"} ready to ship.`}{" "}
                      Nearest ship-by dates first.
                    </p>
                  </div>
                  <Button
                    label="New draft"
                    variant="primary"
                    icon={<Plus aria-hidden="true" size={17} />}
                    onClick={() => setDialog({ type: "order" })}
                  />
                </div>
                <NowPrintingBanner entry={activeEntry} onOpen={openOrder} />
                <div
                  className="filter-tabs"
                  role="group"
                  aria-label="Filter active prints"
                >
                  {(["all", "queued", "printing"] as const).map((stage) => (
                    <button
                      type="button"
                      key={stage}
                      aria-pressed={queueFilter === stage}
                      className={queueFilter === stage ? "selected" : ""}
                      onClick={() => setQueueFilter(stage)}
                    >
                      {stage === "all"
                        ? "All to print"
                        : stage === "printing"
                          ? "Now printing"
                          : itemStageNames[stage]}
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
                    busy={false}
                    pending={pending}
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
                    busy={false}
                    pending={pending}
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
                  busy={!!pending[`order:${chosen.id}`]}
                  pending={pending}
                  isActive={activeOrderIds.has(chosen.id)}
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
                  activityLoading={activityLoading}
                  activityError={activityError}
                  onRetryActivity={() =>
                    setActivityRetry((current) => current + 1)
                  }
                  onMoreActivity={() => void moreActivity()}
                  onOrderWork={(work) =>
                    void action(work, false, `order:${chosen.id}`)
                  }
                  onDeleteItem={async (itemId) => {
                    if (await confirm("Remove this item?"))
                      void action(
                        () => api(`/items/${itemId}`, "DELETE"),
                        false,
                        `order:${chosen.id}`,
                      );
                  }}
                  onDelete={async () => {
                    if (await confirm("Delete this order and all its items?"))
                      void action(
                        async () => {
                          await api(`/orders/${chosen.id}`, "DELETE");
                          setSelectedOrder((current) =>
                            current === chosen.id ? null : current,
                          );
                        },
                        false,
                        `order:${chosen.id}`,
                      );
                  }}
                />
              ) : (
                <OrdersBrowser
                  api={api}
                  revision={data}
                  showMoney={data.settings.show_money}
                  filters={orderFilters}
                  onFiltersChange={setOrderFilters}
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
                    icon={<Plus aria-hidden="true" size={17} />}
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
                  <Search aria-hidden="true" size={18} />
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
                              <Boxes
                                aria-hidden="true"
                                size={42}
                                strokeWidth={1.4}
                              />
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
                                      role="img"
                                      aria-label={`${filament.name}: ${filament.color}`}
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
                                  disabled={!!pending[`product:${product.id}`]}
                                  onClick={() =>
                                    void action(
                                      () =>
                                        api(
                                          `/products/${product.id}/restore`,
                                          "POST",
                                          { version: product.version },
                                        ),
                                      false,
                                      `product:${product.id}`,
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
                                disabled={!!pending[`product:${product.id}`]}
                                onClick={() =>
                                  setDialog({ type: "product", value: product })
                                }
                              >
                                <Pencil aria-hidden="true" size={18} />
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                  </div>
                ) : (
                  <Empty
                    icon={<Boxes aria-hidden="true" />}
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
                    icon={<Plus aria-hidden="true" size={17} />}
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
                  <Search aria-hidden="true" size={18} />
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
                              <div
                                className="filament-ring"
                                aria-hidden="true"
                              />
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
                            <div className="stock-count" aria-live="polite">
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
                                onClick={() => adjustStock(filament, -1)}
                                disabled={
                                  !!pending[`filament:${filament.id}`] ||
                                  filament.spool_count === 0
                                }
                              >
                                <Minus aria-hidden="true" size={15} />
                              </button>
                              <button
                                type="button"
                                aria-label={`Add one ${filament.name} spool`}
                                disabled={
                                  !!pending[`filament:${filament.id}`] ||
                                  filament.spool_count >= 100000
                                }
                                onClick={() => adjustStock(filament, 1)}
                              >
                                <Plus aria-hidden="true" size={15} />
                              </button>
                            </div>
                          </div>
                          {!!filament.archived && (
                            <button
                              type="button"
                              className="outline-button"
                              disabled={!!pending[`filament:${filament.id}`]}
                              onClick={() =>
                                void action(
                                  () =>
                                    api(
                                      `/filaments/${filament.id}/restore`,
                                      "POST",
                                      { version: filament.version },
                                    ),
                                  false,
                                  `filament:${filament.id}`,
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
                            aria-label={`Edit filament ${filament.name}`}
                            disabled={!!pending[`filament:${filament.id}`]}
                            onClick={() =>
                              setDialog({ type: "filament", value: filament })
                            }
                          >
                            <Pencil aria-hidden="true" size={18} />
                          </button>
                        </article>
                      ))}
                  </div>
                ) : (
                  <Empty
                    icon={<Layers3 aria-hidden="true" />}
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
                    icon={<Plus aria-hidden="true" size={17} />}
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
                          disabled={!!pending[`user:${user.id}`]}
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
                            disabled={!!pending[`user:${user.id}`]}
                            onClick={async () => {
                              if (
                                await confirm(
                                  `Delete ${user.name}? They will lose access immediately. Existing orders and products will remain.`,
                                )
                              )
                                void action(
                                  () => api(`/users/${user.id}`, "DELETE"),
                                  false,
                                  `user:${user.id}`,
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
        {mobileMenu && (
          <Modal busy={false} onClose={() => setMobileMenu(false)}>
            <div className="modal-top">
              <div>
                <h2>Workspace</h2>
                <p className="mobile-menu-account">
                  {data.user.name} · @{data.user.username}
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close menu"
                onClick={() => setMobileMenu(false)}
              >
                <X aria-hidden="true" size={21} />
              </button>
            </div>
            <nav
              className="mobile-menu-links"
              aria-label="More workspace pages"
            >
              {tabs
                .filter((tab) => ["settings", "team", "jobs"].includes(tab.id))
                .map((tab) => (
                  <button
                    type="button"
                    key={tab.id}
                    aria-current={page === tab.id ? "page" : undefined}
                    onClick={() => {
                      setPage(tab.id);
                      setSelectedOrder(null);
                      setMobileMenu(false);
                    }}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                    <ArrowRight aria-hidden="true" size={17} />
                  </button>
                ))}
              <button
                type="button"
                disabled={Object.keys(pending).length > 0}
                onClick={() => {
                  setMobileMenu(false);
                  void signOut();
                }}
              >
                <LogOut aria-hidden="true" size={20} />
                <span>Sign out</span>
              </button>
            </nav>
          </Modal>
        )}
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
                <X aria-hidden="true" size={21} />
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
                    ? async () => {
                        if (
                          await confirm(
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
                    ? async () => {
                        if (
                          await confirm(
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
            {error && (
              <p role="alert" className="error modal-error">
                {error}
              </p>
            )}
          </Modal>
        )}
        {decision}
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
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X aria-hidden="true" size={16} />
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
  loading = false,
  error = "",
  onRetry,
}: {
  entries: ActivityEntry[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onOpen?: (id: number) => void;
}) {
  if (loading)
    return (
      <p role="status" className="muted activity-empty">
        Loading activity…
      </p>
    );
  if (error)
    return (
      <p role="alert" className="error">
        {error}{" "}
        <button type="button" className="text-button" onClick={onRetry}>
          Retry
        </button>
      </p>
    );
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
              #{entry.order_id} <ArrowRight aria-hidden="true" size={14} />
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
  pending,
  onBack,
  onEdit,
  onAddItem,
  onConfirm,
  activePieceId,
  onAction,
  onEditItem,
  activity,
  onMoreActivity,
  activityLoading,
  activityError,
  onRetryActivity,
  onOrderWork,
  onDeleteItem,
  onDelete,
  isActive = false,
}: {
  order: Order;
  showMoney: boolean;
  currency: string;
  busy: boolean;
  pending?: Record<string, boolean>;
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
  activityLoading: boolean;
  activityError: string;
  onRetryActivity: () => void;
  onOrderWork: (work: () => Promise<unknown>) => void;
  onDeleteItem: (itemId: number) => void;
  onDelete: () => void;
  isActive?: boolean;
}) {
  const features = useFeatures();
  const counts = countPieces(order);
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
  const activeItem = order.items.find((item) =>
    item.pieces.some((piece) => piece.id === activePieceId),
  );
  const activePiece = activeItem?.pieces.find(
    (piece) => piece.id === activePieceId,
  );
  return (
    <div className="order-detail-page">
      <button type="button" className="back-link" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={18} /> All orders
      </button>
      <div className="order-detail-heading">
        <div>
          <span className="eyebrow">
            {order.is_draft ? "DRAFT ORDER" : "CONFIRMED SALE"}
          </span>
          <div className="detail-title-row">
            <h1>Order #{String(order.id).padStart(4, "0")}</h1>
            <OrderStatusBadge order={order} isActive={isActive} />
          </div>
          <p>
            {order.is_draft
              ? "Add prints, then confirm this draft to start fulfillment."
              : isActive && activeItem && activePiece
                ? `Now printing: ${activeItem.product_name} · piece ${activePiece.ordinal} of ${activeItem.quantity} · ${completed} of ${totalQuantity} pieces shipped`
                : `Confirmed ${date(order.confirmed_at || order.created_at)} · ${completed} of ${totalQuantity} pieces shipped`}
          </p>
          <div className="detail-deadline">
            <Deadline order={order} />
          </div>
        </div>
        <div className="detail-heading-actions">
          <button
            type="button"
            className="outline-button"
            disabled={busy}
            onClick={onEdit}
          >
            <Pencil aria-hidden="true" size={16} /> Edit details
          </button>
          {!!order.is_draft && (
            <Button
              label={busy ? "Confirming…" : "Confirm sale"}
              variant="primary"
              icon={<CheckCircle2 aria-hidden="true" size={18} />}
              isDisabled={
                busy ||
                !!order.cancelled ||
                !!order.archived ||
                !order.items.length
              }
              onClick={onConfirm}
            />
          )}
          {!!order.is_draft &&
            (busy ||
              !!order.cancelled ||
              !!order.archived ||
              !order.items.length) && (
              <p className="muted">
                {busy
                  ? "An update to this order is pending."
                  : order.archived
                    ? "Restore this archived order to confirm it."
                    : order.cancelled
                      ? "Restore this cancelled order to confirm it."
                      : "Add at least one print item to confirm this sale."}
              </p>
            )}
        </div>
      </div>
      {!!order.is_draft && (
        <div className="draft-callout">
          <span>
            <ClipboardList aria-hidden="true" size={24} />
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
                <div>
                  <h2>
                    {isActive
                      ? "Now printing in this order"
                      : counts.printed
                        ? "Pieces ready to ship"
                        : "Individual pieces"}
                  </h2>
                  <p>
                    {counts.queued} queued · {counts.printing} now printing ·{" "}
                    {counts.printed} ready to ship · {counts.shipped} shipped
                  </p>
                </div>
              </div>
              <PieceQueue
                entries={queueEntries([order]).filter(
                  (e) => e.piece.status !== "shipped",
                )}
                activePieceId={activePieceId}
                busy={busy}
                pending={pending}
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
                <Plus aria-hidden="true" size={17} /> Add item
              </button>
            </div>
            {(busy || !!order.cancelled || !!order.archived) && (
              <p className="muted">
                {busy
                  ? "Wait for this order update before adding an item."
                  : "Restore this order before adding an item."}
              </p>
            )}
            {order.items.length ? (
              <div className="detail-item-list">
                {order.items.map((item) => (
                  <div className="detail-item-card" key={item.id}>
                    <span
                      role="img"
                      aria-label={`Colour ${item.color}`}
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
                      aria-label={`Edit item ${item.product_name}`}
                      disabled={busy || !!order.cancelled || !!order.archived}
                      onClick={() => onEditItem(item)}
                    >
                      <Pencil aria-hidden="true" size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title="Remove item"
                      aria-label={`Remove item ${item.product_name}`}
                      disabled={busy || !!order.cancelled || !!order.archived}
                      onClick={() => onDeleteItem(item.id)}
                    >
                      <Trash2 aria-hidden="true" size={17} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                small
                icon={<Package aria-hidden="true" />}
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
            <ActivityList
              entries={activity}
              loading={activityLoading}
              error={activityError}
              onRetry={onRetryActivity}
            />
            {activity.length >= 50 && (
              <button
                type="button"
                className="outline-button"
                disabled={activityLoading}
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
              Edit customer <ArrowRight aria-hidden="true" size={15} />
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
                : isActive
                  ? "Now printing"
                  : statusNames[order.status]}
            </h2>
            <p>
              {order.is_draft
                ? "This draft does not appear in the print queue."
                : isActive
                  ? "One piece of this order is on the printer. Other pieces wait in the queue."
                  : order.status === "printing"
                    ? "Work has started, but the printer is currently free."
                    : "Each print item moves through the queue independently."}
            </p>
            {!order.is_draft && (
              <dl className="fulfillment-breakdown">
                <div>
                  <dt>Queued</dt>
                  <dd>{counts.queued}</dd>
                </div>
                <div>
                  <dt>Now printing</dt>
                  <dd>{counts.printing}</dd>
                </div>
                <div>
                  <dt>Ready to ship</dt>
                  <dd>{counts.printed}</dd>
                </div>
                <div>
                  <dt>Shipped</dt>
                  <dd>{counts.shipped}</dd>
                </div>
              </dl>
            )}
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
              <Trash2 aria-hidden="true" size={17} /> Delete draft
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
            <Printer aria-hidden="true" size={22} />
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
              required
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
            <ArrowRight aria-hidden="true" size={17} />
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
  const generatedId = React.useId();
  let targetId = generatedId;
  let assigned = false;
  const decorate = (nodes: React.ReactNode): React.ReactNode =>
    React.Children.map(nodes, (child) => {
      if (!React.isValidElement(child)) return child;
      const element = child as React.ReactElement<{
        children?: React.ReactNode;
        id?: string;
      }>;
      if (
        ["input", "select", "textarea"].includes(String(element.type)) &&
        !assigned
      ) {
        assigned = true;
        if (element.props.id) {
          targetId = element.props.id;
          return child;
        }
        return React.cloneElement(element, { id: generatedId });
      }
      return element.props.children
        ? React.cloneElement(element, {
            children: decorate(element.props.children),
          })
        : element;
    });
  const decorated = decorate(children);
  return (
    <div className="field">
      <label htmlFor={targetId}>{label}</label>
      {decorated}
    </div>
  );
}
function Stat({
  label,
  value,
  sub,
  alert = false,
}: {
  label: string;
  value: number;
  sub?: string;
  alert?: boolean;
}) {
  return (
    <div className={`stat${alert ? " stat-alert" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}
function NowPrintingBanner({
  entry,
  onOpen,
}: {
  entry: PieceEntry | null | undefined;
  onOpen: (id: number) => void;
}) {
  if (!entry) return null;
  return (
    <section
      className="panel now-printing-banner"
      aria-live="polite"
      data-testid="now-printing"
    >
      <span className="now-printing-pulse" aria-hidden="true" />
      <div className="now-printing-copy">
        <span className="eyebrow">Now on the printer</span>
        <strong>
          {entry.item.product_name} · piece {entry.piece.ordinal} of{" "}
          {entry.item.quantity}
        </strong>
        <small>
          Order #{String(entry.order.id).padStart(4, "0")} ·{" "}
          {entry.order.customer} · {entry.item.filament_name || "No filament"}
        </small>
      </div>
      <button
        type="button"
        className="outline-button"
        onClick={() => onOpen(entry.order.id)}
      >
        Open order <ArrowRight aria-hidden="true" size={15} />
      </button>
    </section>
  );
}
function OrderStatusBadge({
  order,
  isActive = false,
}: {
  order: Order;
  isActive?: boolean;
}) {
  if (order.archived)
    return (
      <span className="status status-shipped">
        <i aria-hidden="true" />
        Archived
      </span>
    );
  if (order.cancelled)
    return (
      <span className="status status-cancelled">
        <i aria-hidden="true" />
        Cancelled
      </span>
    );
  if (order.is_draft)
    return (
      <span className="status status-draft">
        <i aria-hidden="true" />
        Draft
      </span>
    );
  const counts = countPieces(order);
  const detail =
    counts.total > 0
      ? `${counts.shipped}/${counts.total} shipped`
      : statusNames[order.status];
  return (
    <span className="order-status-wrap">
      <span
        className={`status status-${order.status}${isActive ? " is-active" : ""}`}
        title={isActive ? "A piece of this order is on the printer" : undefined}
      >
        <i aria-hidden="true" />
        {isActive ? "Now printing" : statusNames[order.status]}
      </span>
      <small className="order-status-sub">{detail}</small>
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
          icon={<Plus aria-hidden="true" size={16} />}
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
          <ArrowRight aria-hidden="true" size={16} />
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
  const [uploadError, setUploadError] = useState("");
  const [remaining, setRemaining] = useState(
      value?.remaining_grams ??
        (value?.spool_count ?? 0) * (value?.grams_per_spool ?? 1000),
    ),
    [cost, setCost] = useState(value?.cost_per_kg ?? 0);
  async function upload(file?: File) {
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api("/upload", "POST", form);
      setImageUrl(result.url);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
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
      {uploadError && (
        <p role="alert" className="error">
          {uploadError}
        </p>
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
          <ArrowRight aria-hidden="true" size={16} />
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
  const [uploadError, setUploadError] = useState("");
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
    setUploadError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api("/upload", "POST", form);
      setImageUrl(result.url);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
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
      {uploadError && (
        <p role="alert" className="error">
          {uploadError}
        </p>
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
      <fieldset className="field offered-filaments">
        <legend>Offered filaments</legend>
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
                <i
                  role="img"
                  aria-label={`Colour ${f.color}`}
                  style={{ background: f.color }}
                />
                <span>{f.name}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="muted">Add filaments first to offer colour options.</p>
        )}
      </fieldset>
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
          <ArrowRight aria-hidden="true" size={16} />
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
              <ArrowRight aria-hidden="true" size={16} />
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
            <Settings2 aria-hidden="true" size={21} />
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
            <Bell aria-hidden="true" size={21} />
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
            <Users aria-hidden="true" size={21} />
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
          <ArrowRight aria-hidden="true" size={16} />
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
          <ArrowRight aria-hidden="true" size={16} />
        </button>
      </div>
    </form>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
