import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@astryxdesign/core/Button";
import * as stylex from "@stylexjs/stylex";
import { Chart } from "@tanstack/charts/react";
import { barY, defineChart } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { Boxes, ClipboardList, LayoutDashboard, Layers3, LogOut, Package, Plus, Search, Trash2, X, ArrowRight, Printer, Truck, Check, Pencil, Users, Moon, Sun, ArrowLeft, ListTodo, CheckCircle2, Settings2, Bell, Minus } from "lucide-react";
import "./styles.css";
import "./workspace.css";
import "./mobile.css";
if (import.meta.env.DEV) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/virtual:stylex.css";
  document.head.appendChild(link);
  const runtime = "virtual:stylex:runtime";
  void import(/* @vite-ignore */ runtime);
}

type User = { id: number; name: string; username: string; is_admin: number };
type Filament = { id: number; name: string; brand: string; material: string; color: string; notes: string; image_url: string; spool_count: number; grams_per_spool: number };
type Product = { id: number; name: string; description: string; image_url: string; price: number; filament_ids: number[] };
type ItemStage = "queued" | "printing" | "printed" | "shipped";
type Item = { id: number; product_id: number | null; product_name: string; filament_id: number | null; filament_name: string; color: string; quantity: number; unit_price: number; status: ItemStage };
type Order = { id: number; customer: string; contact: string; notes: string; status: Status; is_draft: number; confirmed_at: string | null; created_at: string; updated_at: string; items: Item[] };
type Status = "draft" | "new" | "printing" | "printed" | "shipped";
type NoticePreferences = { draft_created: number; sale_confirmed: number; print_stage: number; order_shipped: number };
type Data = { needsSetup: boolean; user: User | null; users: User[]; filaments: Filament[]; products: Product[]; orders: Order[]; settings: { show_money: boolean; currency: string }; notifications: { preferences: NoticePreferences; vapidPublicKey: string; subscribed: boolean } | null };
type Page = "overview" | "queue" | "orders" | "products" | "filaments" | "team" | "settings";
type Dialog = { type: "order"; value?: Order } | { type: "product"; value?: Product } | { type: "filament"; value?: Filament } | { type: "item"; order: Order } | { type: "user" } | { type: "password"; value: User } | null;
const statusNames: Record<Status, string> = { draft: "Draft", new: "Queued", printing: "Printing", printed: "Printed", shipped: "Shipped" };
const itemStageNames: Record<ItemStage, string> = { queued: "Queued", printing: "Printing", printed: "Printed", shipped: "Shipped" };
const itemStages: ItemStage[] = ["queued", "printing", "printed", "shipped"];
const money = (n: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(n);
const date = (s: string) => new Date(s.replace(" ", "T") + (s.includes("Z") ? "" : "Z")).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const styles = stylex.create({ brand: { letterSpacing: "-0.045em", fontWeight: 800 } });
async function api(path: string, method = "GET", value?: unknown) {
  const res = await fetch("/api" + path, { method, credentials: "same-origin", headers: value instanceof FormData ? undefined : { "Content-Type": "application/json" }, body: value === undefined ? undefined : value instanceof FormData ? value : JSON.stringify(value) });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || "Request failed");
  return result;
}
function App() {
  const [data, setData] = useState<Data | null>(null);
  const [page, setPage] = useState<Page>("overview");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedOrder, setSelectedOrder] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [orderFilter, setOrderFilter] = useState<"all" | "draft" | "active" | "shipped">("all");
  const [queueFilter, setQueueFilter] = useState<"all" | ItemStage>("all");
  const [theme, setTheme] = useState<"light" | "dark">(() => localStorage.getItem("printroom-theme") === "dark" ? "dark" : "light");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => setData(await api("/bootstrap"));
  const signOut = () => action(async () => {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager?.getSubscription();
      if (subscription) {
        await api("/push-subscriptions", "DELETE", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
    }
    await api("/logout", "POST");
  }, false);
  useEffect(() => { refresh().catch(e => setError(e.message)); if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(console.error); const orderId = Number(new URLSearchParams(location.search).get("order")); if (orderId > 0) { setPage("orders"); setSelectedOrder(orderId); history.replaceState(null, "", location.pathname); } }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("printroom-theme", theme); }, [theme]);
  async function action(work: () => Promise<unknown>, close = true) {
    setBusy(true); setError("");
    try { await work(); await refresh(); if (close) setDialog(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  }
  if (!data) return <div className="loading">Loading Printroom… {error}</div>;
  if (!data.user) return <Auth setup={data.needsSetup} onDone={refresh} />;

  const chosen = data.orders.find(o => o.id === selectedOrder) || null;
  const sales = data.orders.filter(o => !o.is_draft);
  const allPrints = sales.flatMap(order => order.items.map(item => ({ order, item })));
  const queue = allPrints.filter(entry => entry.item.status !== "shipped");
  const ready = queue.filter(entry => entry.item.status === "printed");
  const filteredOrders = data.orders.filter(order => {
    const matchesSearch = `${order.id} ${order.customer} ${order.items.map(item => item.product_name).join(" ")}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = orderFilter === "all" || (orderFilter === "draft" && !!order.is_draft) || (orderFilter === "active" && !order.is_draft && order.status !== "shipped") || (orderFilter === "shipped" && order.status === "shipped");
    return matchesSearch && matchesStatus;
  });
  const tabs: { id: Page; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard size={20} /> },
    { id: "queue", label: "Print queue", icon: <ListTodo size={20} />, count: queue.length },
    { id: "orders", label: "Orders", icon: <ClipboardList size={20} />, count: data.orders.filter(o => o.is_draft).length },
    { id: "products", label: "Products", icon: <Boxes size={20} /> },
    { id: "filaments", label: "Filaments", icon: <Layers3 size={20} /> },
    ...(data.user.is_admin ? [{ id: "team" as Page, label: "Team", icon: <Users size={20} /> }] : []),
    { id: "settings", label: "Settings", icon: <Settings2 size={20} /> }
  ];
  const openOrder = (id: number) => { setPage("orders"); setSelectedOrder(id); };
  const moveItem = (itemId: number, stage: ItemStage) => action(() => api(`/items/${itemId}/status`, "PUT", { status: stage }), false);
  const createOrder = (value: unknown) => action(async () => { const result = await api("/orders", "POST", value); setPage("orders"); setSelectedOrder(result.id); });

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Printer size={23} strokeWidth={2.3} /></div><span {...stylex.props(styles.brand)}>printroom<span className="brand-dot">.</span></span></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{tabs.map(tab => <button key={tab.id} data-page={tab.id} className={page === tab.id ? "nav active" : "nav"} onClick={() => { setPage(tab.id); setSelectedOrder(null); }}>
        {tab.icon}<span>{tab.label}</span>{!!tab.count && <b>{tab.count}</b>}
      </button>)}</nav>
      <div className="sidebar-bottom">
        <div className="mini-card"><div className="mini-icon"><Package size={19} /></div><strong>Make something good.</strong><p>Your print studio, all in one place.</p></div>
        <div className="profile"><span className="avatar">{data.user.name.slice(0, 1).toUpperCase()}</span><span className="profile-text"><strong>{data.user.name}</strong><small>{data.user.username}</small></span><button title="Sign out" onClick={signOut}><LogOut size={18} /></button></div>
      </div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{chosen && page === "orders" ? `Order #${String(chosen.id).padStart(4, "0")}` : tabs.find(tab => tab.id === page)?.label}</strong></div>
        <div className="top-right"><span className="today">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span><button className="theme-toggle" type="button" title={theme === "dark" ? "Use light mode" : "Use dark mode"} aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button><span className="top-avatar">{data.user.name.slice(0, 1).toUpperCase()}</span></div>
      </header>
      <div className="content workspace-content">
        {page === "overview" && <>
          <div className="page-heading"><div><span className="eyebrow">YOUR STUDIO AT A GLANCE</span><h1>Good morning, {data.user.name.split(" ")[0]} <span className="wave">✳</span></h1><p>Keep the next prints moving.</p></div><Button label="New draft" variant="primary" icon={<Plus size={17} />} onClick={() => setDialog({ type: "order" })} /></div>
          <div className="stat-grid"><Stat icon={<ClipboardList size={22}/>} label="Draft orders" value={data.orders.filter(o => o.is_draft).length} sub="Waiting to confirm" tone="violet"/><Stat icon={<Printer size={22}/>} label="In the print queue" value={queue.length} sub="Active print items" tone="orange"/><Stat icon={<Check size={22}/>} label="Ready to ship" value={ready.length} sub="Finished print items" tone="green"/><Stat icon={<Truck size={22}/>} label="Shipped sales" value={sales.filter(o => o.status === "shipped").length} sub="Completed orders" tone="blue"/></div>
          <section className="panel feature-queue"><div className="panel-head"><div><span className="eyebrow">FULFILLMENT</span><h2>Print queue</h2><p>Move each item as it passes through your studio.</p></div><button className="text-button" onClick={() => setPage("queue")}>Full queue <ArrowRight size={16}/></button></div><PrintQueue entries={queue.slice(0, 6)} onStage={moveItem} onOpen={openOrder} emptyText="Confirm a draft sale to add its prints to this queue."/></section>
          <div className="overview-grid dashboard-bottom"><section className="panel"><div className="panel-head"><div><h2>Sales activity</h2><p>Confirmed orders over the last 7 days</p></div></div><ActivityChart orders={sales}/></section><section className="panel recent-panel"><div className="panel-head"><div><h2>Recent orders</h2><p>Drafts and sales in one place</p></div><button className="text-button" onClick={() => setPage("orders")}>All orders <ArrowRight size={16}/></button></div><div className="recent-list">{data.orders.slice(0, 5).map(order => <button key={order.id} onClick={() => openOrder(order.id)}><span className="queue-icon"><Package size={19}/></span><span><strong>#{String(order.id).padStart(4, "0")} · {order.customer}</strong><small>{order.items.length} {order.items.length === 1 ? "item" : "items"} · {date(order.created_at)}</small></span><StatusBadge status={order.status}/></button>)}{!data.orders.length && <Empty small icon={<ClipboardList/>} title="No orders yet" text="Create a draft to get started."/>}</div></section></div>
        </>}
        {page === "queue" && <><div className="page-heading"><div><span className="eyebrow">FULFILLMENT BOARD</span><h1>Print queue</h1><p>{queue.length} active {queue.length === 1 ? "item" : "items"} across your confirmed sales.</p></div><Button label="New draft" variant="primary" icon={<Plus size={17}/>} onClick={() => setDialog({ type: "order" })}/></div><div className="filter-tabs">{(["all", ...itemStages] as const).map(stage => <button key={stage} className={queueFilter === stage ? "selected" : ""} onClick={() => setQueueFilter(stage)}>{stage === "all" ? "All active" : itemStageNames[stage]}<span>{stage === "all" ? queue.length : allPrints.filter(entry => entry.item.status === stage).length}</span></button>)}</div><section className="panel queue-page-panel"><PrintQueue entries={queueFilter === "shipped" ? allPrints.filter(entry => entry.item.status === "shipped") : queue.filter(entry => queueFilter === "all" || entry.item.status === queueFilter)} onStage={moveItem} onOpen={openOrder} emptyText={queueFilter === "all" ? "Confirm a draft sale to add its prints here." : `No ${itemStageNames[queueFilter].toLowerCase()} items right now.`}/></section></>}
        {page === "orders" && (chosen ? <OrderDetail order={chosen} showMoney={data.settings.show_money} currency={data.settings.currency} busy={busy} onBack={() => setSelectedOrder(null)} onEdit={() => setDialog({ type: "order", value: chosen })} onAddItem={() => setDialog({ type: "item", order: chosen })} onConfirm={() => action(() => api(`/orders/${chosen.id}/confirm`, "POST"), false)} onStage={moveItem} onDeleteItem={itemId => { if (confirm("Remove this item?")) action(() => api(`/items/${itemId}`, "DELETE"), false); }} onDelete={() => { if (confirm("Delete this order and all its items?")) action(async () => { await api(`/orders/${chosen.id}`, "DELETE"); setSelectedOrder(null); }, false); }}/>
          : <><div className="page-heading"><div><span className="eyebrow">DRAFT TO DELIVERY</span><h1>Orders</h1><p>Prepare drafts, confirm sales and follow every item to shipping.</p></div><Button label="New draft" variant="primary" icon={<Plus size={17}/>} onClick={() => setDialog({ type: "order" })}/></div><div className="orders-toolbar"><div className="filter-tabs">{(["all", "draft", "active", "shipped"] as const).map(filter => <button key={filter} className={orderFilter === filter ? "selected" : ""} onClick={() => setOrderFilter(filter)}>{({ all: "All orders", draft: "Drafts", active: "Active sales", shipped: "Shipped" })[filter]}<span>{filter === "all" ? data.orders.length : filter === "draft" ? data.orders.filter(o => o.is_draft).length : filter === "active" ? sales.filter(o => o.status !== "shipped").length : sales.filter(o => o.status === "shipped").length}</span></button>)}</div><div className="search"><Search size={19}/><input aria-label="Search orders" placeholder="Search orders or customers…" value={search} onChange={event => setSearch(event.target.value)}/></div></div><section className="panel table-panel"><OrderTable orders={filteredOrders} showMoney={data.settings.show_money} currency={data.settings.currency} onOpen={setSelectedOrder}/></section></>)}
        {page === "products" && <><div className="page-heading"><div><span className="eyebrow">WHAT YOU MAKE</span><h1>Products</h1><p>Your print catalogue and offered colour options.</p></div><Button label="Add product" variant="primary" icon={<Plus size={17}/>} onClick={() => setDialog({ type: "product" })}/></div>{data.products.length ? <div className="product-grid">{data.products.map(product => <article className="product-card" key={product.id}><div className="product-image">{product.image_url ? <img src={product.image_url} alt={product.name}/> : <Boxes size={42} strokeWidth={1.4}/>}</div><div className="product-body"><div className="product-title"><h3>{product.name}</h3>{data.settings.show_money && <strong>{money(product.price, data.settings.currency)}</strong>}</div><p>{product.description || "No description yet"}</p><div className="product-foot"><div className="swatches">{product.filament_ids.map(fid => { const filament = data.filaments.find(f => f.id === fid); return filament ? <span key={fid} title={filament.name} style={{ background: filament.color }}/> : null; })}{product.filament_ids.length === 0 && <small>No colours selected</small>}</div><button className="icon-button" title="Edit product" onClick={() => setDialog({ type: "product", value: product })}><Pencil size={18}/></button></div></div></article>)}</div> : <Empty icon={<Boxes/>} title="Build your catalogue" text="Add a product, then choose which filament colours you can offer." action="Add product" onAction={() => setDialog({ type: "product" })}/>}</>}
        {page === "filaments" && <><div className="page-heading"><div><span className="eyebrow">YOUR COLOUR LIBRARY</span><h1>Filaments</h1><p>Keep the materials and shades you own in one place.</p></div><Button label="Add filament" variant="primary" icon={<Plus size={17}/>} onClick={() => setDialog({ type: "filament" })}/></div>{data.filaments.length ? <div className="filament-grid">{data.filaments.map(filament => <article className="filament-card" key={filament.id}><div className="filament-swatch" style={{ background: filament.color }}>{filament.image_url ? <img src={filament.image_url} alt={`${filament.name} spool`}/> : <div className="filament-ring"/>}</div><div className="filament-info"><span className="material">{filament.material}</span><h3>{filament.name}</h3><p>{filament.brand || "Unbranded"} · {filament.color.toUpperCase()}</p>{filament.notes && <small>{filament.notes}</small>}<div className="stock-count"><strong>{filament.spool_count} {filament.spool_count === 1 ? "spool" : "spools"}</strong><small>{filament.grams_per_spool} g each · ~{(filament.spool_count * filament.grams_per_spool / 1000).toFixed(2)} kg</small></div><div className="stock-actions"><button type="button" aria-label={`Remove one ${filament.name} spool`} onClick={() => action(() => api(`/filaments/${filament.id}/stock`, "PUT", { spool_count: Math.max(0, filament.spool_count - 1), grams_per_spool: filament.grams_per_spool }), false)} disabled={filament.spool_count === 0}><Minus size={15}/></button><button type="button" aria-label={`Add one ${filament.name} spool`} onClick={() => action(() => api(`/filaments/${filament.id}/stock`, "PUT", { spool_count: filament.spool_count + 1, grams_per_spool: filament.grams_per_spool }), false)}><Plus size={15}/></button></div></div><button className="icon-button" title="Edit filament" onClick={() => setDialog({ type: "filament", value: filament })}><Pencil size={18}/></button></article>)}</div> : <Empty icon={<Layers3/>} title="Start your colour library" text="Add your first spool to make it available for products." action="Add filament" onAction={() => setDialog({ type: "filament" })}/>}</>}
        {page === "settings" && <SettingsPanel data={data} refresh={refresh} onTeam={() => setPage("team")} onProducts={() => setPage("products")} onSignOut={signOut} />}
        {page === "team" && <><div className="page-heading"><div><span className="eyebrow">SHARED WORKSPACE</span><h1>Team</h1><p>Manage access to your shared orders and catalogue.</p></div><Button label="Add user" variant="primary" icon={<Plus size={17}/>} onClick={() => setDialog({ type: "user" })}/></div><section className="panel team-list">{data.users.map(user => <div className="team-row" key={user.id}><span className="avatar">{user.name.slice(0,1).toUpperCase()}</span><span><strong>{user.name}</strong><small>@{user.username}</small></span><span className="team-role">{user.is_admin ? "Owner" : "Member"}</span><div className="team-actions"><button className="outline-button" onClick={() => setDialog({ type: "password", value: user })}>Change password</button>{user.id !== data.user!.id && <button className="danger-text" onClick={() => { if (confirm(`Delete ${user.name}? They will lose access immediately. Existing orders and products will remain.`)) void action(() => api(`/users/${user.id}`, "DELETE"), false); }}>Delete</button>}</div></div>)}</section></>}
      </div>
    </main>
    {dialog && <div className="overlay modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(null); }}><div className="modal"><div className="modal-top"><div><span className="eyebrow">PRINTROOM</span><h2>{dialog.type === "password" ? `Change ${dialog.value.name}'s password` : dialog.type === "item" ? "Add print item" : dialog.type === "order" ? (dialog.value ? "Edit order" : "New draft order") : `${"value" in dialog && dialog.value ? "Edit" : "Add"} ${dialog.type}`}</h2></div><button className="icon-button" onClick={() => setDialog(null)} aria-label="Close"><X size={21}/></button></div>
      {dialog.type === "order" && <OrderForm value={dialog.value} busy={busy} onSubmit={value => dialog.value ? action(() => api(`/orders/${dialog.value!.id}`, "PUT", value)) : createOrder(value)}/>}
      {dialog.type === "filament" && <FilamentForm value={dialog.value} busy={busy} onSubmit={value => action(() => api(dialog.value ? `/filaments/${dialog.value.id}` : "/filaments", dialog.value ? "PUT" : "POST", value))} onDelete={dialog.value ? () => { if (confirm("Delete this filament?")) action(() => api(`/filaments/${dialog.value!.id}`, "DELETE")); } : undefined}/>}
      {dialog.type === "product" && <ProductForm value={dialog.value} filaments={data.filaments} showMoney={data.settings.show_money} currency={data.settings.currency} busy={busy} onSubmit={value => action(() => api(dialog.value ? `/products/${dialog.value.id}` : "/products", dialog.value ? "PUT" : "POST", value))} onDelete={dialog.value ? () => { if (confirm("Delete this product?")) action(() => api(`/products/${dialog.value!.id}`, "DELETE")); } : undefined}/>}
      {dialog.type === "item" && <ItemForm products={data.products} filaments={data.filaments} showMoney={data.settings.show_money} currency={data.settings.currency} busy={busy} onSubmit={value => action(() => api(`/orders/${dialog.order.id}/items`, "POST", value))}/>}
      {dialog.type === "user" && <UserForm busy={busy} onSubmit={value => action(() => api("/users", "POST", value))}/>}
      {dialog.type === "password" && <PasswordForm key={dialog.value.id} user={dialog.value} busy={busy} onSubmit={password => action(() => api(`/users/${dialog.value.id}/password`, "PUT", { password }))}/>}
      {error && <p className="error modal-error">{error}</p>}
    </div></div>}
    {error && !dialog && <div className="toast" role="alert">{error}<button onClick={() => setError("")}><X size={16}/></button></div>}
  </div>;
}

function StageSelect({ item, onChange, disabled = false }: { item: Item; onChange: (status: ItemStage) => void; disabled?: boolean }) {
  return <select className={`stage-select stage-${item.status}`} aria-label={`Stage for ${item.product_name}`} value={item.status} disabled={disabled} onChange={event => onChange(event.target.value as ItemStage)}>{itemStages.map(stage => <option key={stage} value={stage}>{itemStageNames[stage]}</option>)}</select>;
}

function PrintQueue({ entries, onStage, onOpen, emptyText }: { entries: { order: Order; item: Item }[]; onStage: (itemId: number, stage: ItemStage) => void; onOpen: (orderId: number) => void; emptyText: string }) {
  if (!entries.length) return <Empty small icon={<Printer/>} title="Queue is clear" text={emptyText}/>;
  return <div className="print-queue"><div className="queue-header"><span>PRINT ITEM</span><span>ORDER</span><span>QUANTITY</span><span>STAGE</span></div>{entries.map(({ order, item }) => <div className="print-row" key={item.id}><div className="print-item"><span className="print-swatch" style={{ background: item.color }}/><span><strong>{item.product_name}</strong><small>{item.filament_name || "No filament selected"}</small></span></div><button className="print-order" onClick={() => onOpen(order.id)}>#{String(order.id).padStart(4, "0")} · {order.customer}<ArrowRight size={15}/></button><span className="print-quantity">× {item.quantity}</span><StageSelect item={item} onChange={stage => onStage(item.id, stage)}/></div>)}</div>;
}

function OrderDetail({ order, showMoney, currency, busy, onBack, onEdit, onAddItem, onConfirm, onStage, onDeleteItem, onDelete }: { order: Order; showMoney: boolean; currency: string; busy: boolean; onBack: () => void; onEdit: () => void; onAddItem: () => void; onConfirm: () => void; onStage: (itemId: number, stage: ItemStage) => void; onDeleteItem: (itemId: number) => void; onDelete: () => void }) {
  const total = order.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  const completed = order.items.filter(item => item.status === "shipped").length;
  return <div className="order-detail-page"><button className="back-link" onClick={onBack}><ArrowLeft size={18}/> All orders</button><div className="order-detail-heading"><div><span className="eyebrow">{order.is_draft ? "DRAFT ORDER" : "CONFIRMED SALE"}</span><div className="detail-title-row"><h1>Order #{String(order.id).padStart(4, "0")}</h1><StatusBadge status={order.status}/></div><p>{order.is_draft ? "Add prints, then confirm this draft to start fulfillment." : `Confirmed ${date(order.confirmed_at || order.created_at)} · ${completed} of ${order.items.length} items shipped`}</p></div><div className="detail-heading-actions"><button className="outline-button" onClick={onEdit}><Pencil size={16}/> Edit details</button>{!!order.is_draft && <Button label={busy ? "Confirming…" : "Confirm sale"} variant="primary" icon={<CheckCircle2 size={18}/>} isDisabled={busy || !order.items.length} onClick={onConfirm}/>}</div></div>
    {!!order.is_draft && <div className="draft-callout"><span><ClipboardList size={24}/></span><div><strong>This order is still a draft</strong><p>It will enter the sales and print queue when you confirm it. Add at least one print item first.</p></div></div>}
    <div className="order-detail-grid"><div className="order-main-column"><section className="panel detail-items-panel"><div className="panel-head"><div><h2>Print items</h2><p>{order.items.length} {order.items.length === 1 ? "item" : "items"} in this order</p></div><button className="text-button" onClick={onAddItem}><Plus size={17}/> Add item</button></div>{order.items.length ? <div className="detail-item-list">{order.items.map(item => <div className="detail-item-card" key={item.id}><span className="print-swatch large" style={{ background: item.color }}/><div className="detail-item-copy"><strong>{item.product_name}</strong><small>{item.filament_name || "No filament selected"} · Quantity {item.quantity}</small></div><div className="detail-item-stage"><small>PRINT STAGE</small>{order.is_draft ? <span className="draft-stage">Available after confirmation</span> : <StageSelect item={item} onChange={stage => onStage(item.id, stage)}/>}</div>{showMoney && <strong className="detail-item-price">{money(item.unit_price * item.quantity, currency)}</strong>}<button className="icon-button" title="Remove item" onClick={() => onDeleteItem(item.id)}><Trash2 size={17}/></button></div>)}</div> : <Empty small icon={<Package/>} title="No print items yet" text="Add a product to this order before confirming the sale."/>}</section>{order.notes && <section className="panel detail-notes"><h2>Order notes</h2><p>{order.notes}</p></section>}</div>
      <aside className="order-side-column"><section className="panel detail-info-panel"><span className="eyebrow">CUSTOMER</span><h2>{order.customer}</h2><p>{order.contact || "No contact details added"}</p><button className="text-button" onClick={onEdit}>Edit customer <ArrowRight size={15}/></button></section><section className="panel detail-info-panel"><span className="eyebrow">ORDER SUMMARY</span><div className="summary-line"><span>Items</span><strong>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</strong></div><div className="summary-line"><span>Created</span><strong>{date(order.created_at)}</strong></div>{showMoney && <div className="summary-total"><span>Total sale</span><strong>{money(total, currency)}</strong></div>}</section><section className="panel detail-info-panel"><span className="eyebrow">FULFILLMENT</span><h2>{order.is_draft ? "Waiting for confirmation" : statusNames[order.status]}</h2><p>{order.is_draft ? "This draft does not appear in the print queue." : "Each print item moves through the queue independently."}</p>{!order.is_draft && <div className="progress-track"><span style={{ width: `${order.items.length ? Math.round(completed / order.items.length * 100) : 0}%` }}/></div>}{!order.is_draft && <small>{completed} / {order.items.length} items shipped</small>}</section><button className="delete-order" onClick={onDelete}><Trash2 size={17}/> Delete order</button></aside></div>
  </div>;
}

function Auth({ setup, onDone }: { setup: boolean; onDone: () => Promise<void> }) {
  const [name, setName] = useState(""), [username, setUsername] = useState(""), [password, setPassword] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(""); try { await api(setup ? "/setup" : "/login", "POST", { name, username, password }); await onDone(); } catch (e) { setError(e instanceof Error ? e.message : "Sign in failed"); } finally { setBusy(false); } }
  return <div className="auth"><div className="auth-art"><div className="auth-brand"><span className="brand-icon"><Printer size={22}/></span><strong>printroom<span className="brand-dot">.</span></strong></div><div className="auth-visual"><span className="orb orb-1"/><span className="orb orb-2"/><span className="orb orb-3"/><div className="visual-card"><Printer size={60} strokeWidth={1.1}/><div className="visual-lines"><i/><i/><i/></div></div></div><div className="auth-copy"><span>YOUR CREATIVE WORKSPACE</span><h1>From idea to<br/>finished print.</h1><p>A calm home for your orders, products and every colour on your shelf.</p></div></div><div className="auth-side"><form className="auth-form" onSubmit={submit}><span className="eyebrow">{setup ? "LET'S GET STARTED" : "WELCOME BACK"}</span><h2>{setup ? "Set up your studio" : "Sign in to Printroom"}</h2><p>{setup ? "Create the first account for your print hub." : "Your print studio is ready when you are."}</p>{setup && <Field label="Your name"><input required value={name} onChange={e => setName(e.target.value)} placeholder="Alex Maker"/></Field>}<Field label="Username"><input required autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="yourname"/></Field><Field label="Password"><input type="password" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password"/></Field>{error && <p className="error">{error}</p>}<button className="auth-submit" disabled={busy}>{busy ? "Please wait…" : setup ? "Create studio" : "Sign in"} <ArrowRight size={17}/></button><small className="auth-help">Your session stays signed in on this browser for 30 days.</small></form></div></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Stat({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: number; sub: string; tone: string }) { return <div className="stat"><div className={`stat-icon ${tone}`}>{icon}</div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>; }
function StatusBadge({ status }: { status: Status }) { return <span className={`status status-${status}`}><i/>{statusNames[status]}</span>; }
function Empty({ icon, title, text, action, onAction, small = false }: { icon: React.ReactNode; title: string; text: string; action?: string; onAction?: () => void; small?: boolean }) { return <div className={small ? "empty small" : "empty"}><span>{icon}</span><h3>{title}</h3><p>{text}</p>{action && <Button label={action} variant="primary" icon={<Plus size={16}/>} onClick={onAction}/>}</div>; }
function OrderTable({ orders, showMoney, currency, onOpen }: { orders: Order[]; showMoney: boolean; currency: string; onOpen: (id: number) => void }) {
  return orders.length ? <div className="table-wrap"><table><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>PRINT ITEMS</th><th>CREATED</th><th>STATUS</th>{showMoney && <th>TOTAL</th>}<th/></tr></thead><tbody>{orders.map(order => <tr key={order.id} onClick={() => onOpen(order.id)}><td className="order-id">#{String(order.id).padStart(4, "0")}</td><td><strong>{order.customer}</strong></td><td>{order.items.length} {order.items.length === 1 ? "item" : "items"}</td><td>{date(order.created_at)}</td><td><StatusBadge status={order.status}/></td>{showMoney && <td className="amount">{money(order.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0), currency)}</td>}<td><ArrowRight size={18}/></td></tr>)}</tbody></table></div> : <Empty small icon={<ClipboardList/>} title="No orders here" text="Create a draft or change the filter to see more orders."/>;
}
function ActivityChart({ orders }: { orders: Order[] }) {
  const rows = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); const key = d.toISOString().slice(0, 10); return { day: d.toLocaleDateString("en-GB", { weekday: "short" }), count: orders.filter(o => (o.confirmed_at || o.created_at).slice(0, 10) === key).length }; }), [orders]);
  const chart = useMemo(() => defineChart({ marks: [barY(rows, { x: "day", y: "count" })], scales: { x: { scale: () => scaleBand().padding(0.55) }, y: { scale: scaleLinear, nice: true, grid: true } } }), [rows]);
  return <div className="chart"><Chart definition={chart} height={260} ariaLabel="Sales confirmed over the last seven days"/></div>;
}
function OrderForm({ value, busy, onSubmit }: { value?: Order; busy: boolean; onSubmit: (v: unknown) => void }) {
  const [customer, setCustomer] = useState(value?.customer || ""), [contact, setContact] = useState(value?.contact || ""), [notes, setNotes] = useState(value?.notes || "");
  return <form onSubmit={e => { e.preventDefault(); onSubmit({ customer, contact, notes }); }}><div className="form-grid"><Field label="Customer name"><input autoFocus required value={customer} onChange={e => setCustomer(e.target.value)} placeholder="e.g. Jamie Smith"/></Field><Field label="Email or contact"><input value={contact} onChange={e => setContact(e.target.value)} placeholder="Optional"/></Field></div><Field label="Notes"><textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any requests or delivery details…"/></Field><div className="form-actions"><button className="auth-submit" disabled={busy}>{busy ? "Saving…" : value ? "Save changes" : "Create draft"} <ArrowRight size={16}/></button></div></form>;
}
function FilamentForm({ value, busy, onSubmit, onDelete }: { value?: Filament; busy: boolean; onSubmit: (v: unknown) => void; onDelete?: () => void }) {
  const [name, setName] = useState(value?.name || ""), [brand, setBrand] = useState(value?.brand || ""), [material, setMaterial] = useState(value?.material || "PLA"), [color, setColor] = useState(value?.color || "#d48c68"), [notes, setNotes] = useState(value?.notes || "");
  const [spoolCount, setSpoolCount] = useState(value?.spool_count ?? 0), [gramsPerSpool, setGramsPerSpool] = useState(value?.grams_per_spool ?? 1000), [imageUrl, setImageUrl] = useState(value?.image_url || ""), [uploading, setUploading] = useState(false);
  async function upload(file?: File) { if (!file) return; setUploading(true); try { const form = new FormData(); form.append("file", file); const result = await api("/upload", "POST", form); setImageUrl(result.url); } catch (e) { alert(e instanceof Error ? e.message : "Upload failed"); } finally { setUploading(false); } }
  return <form onSubmit={e => { e.preventDefault(); onSubmit({ name, brand, material, color, notes, image_url: imageUrl, spool_count: spoolCount, grams_per_spool: gramsPerSpool }); }}>
    <div className="form-grid"><Field label="Colour name"><input required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Terracotta"/></Field><Field label="Brand"><input value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Bambu Lab"/></Field></div>
    <div className="form-grid"><Field label="Material"><select value={material} onChange={e => setMaterial(e.target.value)}>{["PLA", "PETG", "ABS", "ASA", "TPU", "Other"].map(m => <option key={m}>{m}</option>)}</select></Field><Field label="Swatch colour"><div className="color-input"><input type="color" value={color} onChange={e => setColor(e.target.value)}/><span>{color.toUpperCase()}</span></div></Field></div>
    <div className="form-grid"><Field label="Spools in stock"><input type="number" min="0" step="1" value={spoolCount} onChange={e => setSpoolCount(Number(e.target.value))}/></Field><Field label="Approx. grams per spool"><input type="number" min="1" step="1" value={gramsPerSpool} onChange={e => setGramsPerSpool(Number(e.target.value))}/></Field></div>
    <Field label="Spool photo"><div className="upload-row">{imageUrl && <img src={imageUrl} alt="Spool preview"/>}<label className="upload-button">{uploading ? "Uploading…" : imageUrl ? "Change photo" : "Upload photo"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => upload(e.target.files?.[0])}/></label>{imageUrl && <button type="button" className="danger-text" onClick={() => setImageUrl("")}>Remove photo</button>}</div></Field>
    <Field label="Notes"><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Finish, storage details…"/></Field><p className="muted">Stock is manual. Use the + and − buttons on each filament card to adjust spool count later.</p>
    <div className="form-actions">{onDelete && <button type="button" className="danger-text" onClick={onDelete}>Delete filament</button>}<button className="auth-submit" disabled={busy || uploading}>{busy ? "Saving…" : value ? "Save changes" : "Add filament"} <ArrowRight size={16}/></button></div>
  </form>;
}
function ProductForm({ value, filaments, showMoney, currency, busy, onSubmit, onDelete }: { value?: Product; filaments: Filament[]; showMoney: boolean; currency: string; busy: boolean; onSubmit: (v: unknown) => void; onDelete?: () => void }) {
  const [name, setName] = useState(value?.name || ""), [description, setDescription] = useState(value?.description || ""), [price, setPrice] = useState(String(value?.price ?? "")), [imageUrl, setImageUrl] = useState(value?.image_url || ""), [ids, setIds] = useState<number[]>(value?.filament_ids || []), [uploading, setUploading] = useState(false);
  async function upload(file?: File) { if (!file) return; setUploading(true); try { const form = new FormData(); form.append("file", file); const result = await api("/upload", "POST", form); setImageUrl(result.url); } catch (e) { alert(e instanceof Error ? e.message : "Upload failed"); } finally { setUploading(false); } }
  return <form onSubmit={e => { e.preventDefault(); onSubmit({ name, description, price: Number(price || 0), image_url: imageUrl, filament_ids: ids }); }}><div className="form-grid"><Field label="Product name"><input required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Desk organiser"/></Field>{showMoney && <Field label={`Price (${currency})`}><input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00"/></Field>}</div><Field label="Description"><textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="A short description of this print…"/></Field><Field label="Example image"><div className="upload-row">{imageUrl && <img src={imageUrl} alt="Product preview"/>}<label className="upload-button">{uploading ? "Uploading…" : imageUrl ? "Change image" : "Upload image"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => upload(e.target.files?.[0])}/></label><small>PNG, JPEG or WebP · max 5 MB</small></div></Field><div className="field"><span>Offered filaments</span>{filaments.length ? <div className="choice-grid">{filaments.map(f => <label key={f.id} className={ids.includes(f.id) ? "choice selected" : "choice"}><input type="checkbox" checked={ids.includes(f.id)} onChange={e => setIds(e.target.checked ? [...ids, f.id] : ids.filter(x => x !== f.id))}/><i style={{ background: f.color }}/><span>{f.name}</span></label>)}</div> : <p className="muted">Add filaments first to offer colour options.</p>}</div><div className="form-actions">{onDelete && <button type="button" className="danger-text" onClick={onDelete}>Delete product</button>}<button className="auth-submit" disabled={busy || uploading}>{busy ? "Saving…" : value ? "Save changes" : "Add product"} <ArrowRight size={16}/></button></div></form>;
}
function ItemForm({ products, filaments, showMoney, currency, busy, onSubmit }: { products: Product[]; filaments: Filament[]; showMoney: boolean; currency: string; busy: boolean; onSubmit: (v: unknown) => void }) {
  const [productId, setProductId] = useState(products[0]?.id || 0), [filamentId, setFilamentId] = useState(0), [quantity, setQuantity] = useState(1);
  const product = products.find(p => p.id === productId), choices = filaments.filter(f => product?.filament_ids.includes(f.id));
  return <form onSubmit={e => { e.preventDefault(); onSubmit({ product_id: productId, filament_id: filamentId || null, quantity }); }}>{products.length ? <><Field label="Product"><select value={productId} onChange={e => { setProductId(Number(e.target.value)); setFilamentId(0); }}>{products.map(p => <option key={p.id} value={p.id}>{p.name}{showMoney ? ` · ${money(p.price, currency)}` : ""}</option>)}</select></Field><div className="form-grid"><Field label="Filament"><select value={filamentId} onChange={e => setFilamentId(Number(e.target.value))}><option value={0}>No filament selected</option>{choices.map(f => <option key={f.id} value={f.id}>{f.name} ({f.material})</option>)}</select></Field><Field label="Quantity"><input type="number" min="1" max="10000" value={quantity} onChange={e => setQuantity(Number(e.target.value))}/></Field></div><div className="form-actions"><button className="auth-submit" disabled={busy}>{busy ? "Adding…" : "Add to order"} <ArrowRight size={16}/></button></div></> : <p className="muted">Add a product to your catalogue before adding print items.</p>}</form>;
}
const noticeLabels: { key: keyof NoticePreferences; title: string; help: string }[] = [
  { key: "draft_created", title: "New draft", help: "Someone starts an order draft" },
  { key: "sale_confirmed", title: "Sale confirmed", help: "A draft enters the print queue" },
  { key: "print_stage", title: "Print stage changes", help: "A print moves through fulfillment" },
  { key: "order_shipped", title: "Order shipped", help: "All items in an order are shipped" }
];
function SettingsPanel({ data, refresh, onTeam, onProducts, onSignOut }: { data: Data; refresh: () => Promise<void>; onTeam: () => void; onProducts: () => void; onSignOut: () => void }) {
  const [showMoney, setShowMoney] = useState(data.settings.show_money), [currency, setCurrency] = useState(data.settings.currency);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [subscribed, setSubscribed] = useState(false);
  useEffect(() => { if ("serviceWorker" in navigator) void navigator.serviceWorker.getRegistration().then(registration => registration?.pushManager?.getSubscription()).then(subscription => setSubscribed(!!subscription)).catch(console.error); }, []);
  const prefs = data.notifications?.preferences;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const supported = window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  async function run(work: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage("");
    try { await work(); await refresh(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Something went wrong"); }
    finally { setBusy(false); }
  }
  function enable() {
    if (!supported) { setMessage("Notifications need HTTPS and a browser with Web Push support."); return; }
    if (isIOS && !standalone) { setMessage("On iPhone, open Printroom in Safari, tap Share → Add to Home Screen, then open it from the new icon and return here."); return; }
    // Request permission directly inside the button click to keep the user gesture on iOS.
    const permission = Notification.requestPermission();
    void run(async () => {
      if (await permission !== "granted") throw new Error("Notifications were not allowed. You can change this in your device settings.");
      const registration = await navigator.serviceWorker.ready;
      const key = data.notifications?.vapidPublicKey;
      if (!key) throw new Error("Push is unavailable on this server.");
      const bytes = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - key.length % 4) % 4)), char => char.charCodeAt(0));
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      await api("/push-subscriptions", "POST", { subscription: subscription.toJSON() });
      setSubscribed(true);
    }, "Notifications enabled on this device.");
  }
  function disable() {
    void run(async () => {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) { await api("/push-subscriptions", "DELETE", { endpoint: subscription.endpoint }); await subscription.unsubscribe(); }
      setSubscribed(false);
    }, "Notifications disabled on this device.");
  }
  function changePref(key: keyof NoticePreferences, checked: boolean) {
    if (!prefs) return;
    void run(() => api("/notification-preferences", "PUT", Object.fromEntries(noticeLabels.map(entry => [entry.key, entry.key === key ? checked : !!prefs[entry.key]]))), "Notification choices saved.");
  }
  return <div className="settings-page">
    <div className="page-heading"><div><span className="eyebrow">MAKE IT YOURS</span><h1>Settings</h1><p>Choose how your studio works for you.</p></div></div>
    <div className="settings-grid">
      <section className="panel settings-card"><div className="settings-title"><Settings2 size={21}/><div><h2>Workspace</h2><p>Shared across everyone in this studio.</p></div></div>
        <label className="setting-toggle"><span><strong>Show money</strong><small>Display prices and order totals throughout Printroom.</small></span><input type="checkbox" checked={showMoney} disabled={!data.user?.is_admin || busy} onChange={e => setShowMoney(e.target.checked)}/></label>
        <Field label="Currency"><select value={currency} disabled={!data.user?.is_admin || busy} onChange={e => setCurrency(e.target.value)}>{["GBP", "USD", "EUR", "CAD", "AUD", "NZD", "JPY", "CHF", "SEK", "NOK", "DKK", "INR"].map(code => <option key={code} value={code}>{code}</option>)}</select></Field>
        {data.user?.is_admin ? <button className="auth-submit settings-save" disabled={busy} onClick={() => void run(() => api("/settings", "PUT", { show_money: showMoney, currency }), "Workspace settings saved.")}>Save workspace settings</button> : <p className="muted">An owner can change workspace settings.</p>}
      </section>
      <section className="panel settings-card"><div className="settings-title"><Bell size={21}/><div><h2>Notifications</h2><p>These choices are just for {data.user?.name}.</p></div></div>
        <div className="notification-status"><strong>{subscribed ? "Set up on this device" : "Not set up on this device"}</strong><small>{isIOS ? "On iPhone, install Printroom to your Home Screen first." : "Push notifications arrive even when Printroom is closed."}</small></div>
        <div className="settings-actions">{subscribed ? <button className="outline-button" disabled={busy} onClick={disable}>Turn off on this device</button> : <button className="auth-submit" disabled={busy} onClick={enable}>Set up notifications</button>}{subscribed && <button className="outline-button" disabled={busy} onClick={() => void run(() => api("/notifications/test", "POST"), "Test notification sent.")}>Send test</button>}</div>
        {!supported && <p className="muted">Open Printroom over HTTPS to enable notifications. Localhost also works for testing.</p>}
        <div className="preference-list">{noticeLabels.map(entry => <label className="setting-toggle" key={entry.key}><span><strong>{entry.title}</strong><small>{entry.help}</small></span><input type="checkbox" disabled={busy} checked={!!prefs?.[entry.key]} onChange={e => changePref(entry.key, e.target.checked)}/></label>)}</div>
      </section>
      <section className="panel settings-card"><div className="settings-title"><Users size={21}/><div><h2>Account and catalogue</h2><p>Signed in as @{data.user?.username}</p></div></div><div className="settings-actions"><button className="outline-button" onClick={onProducts}>Manage products</button>{!!data.user?.is_admin && <button className="outline-button" onClick={onTeam}>Manage team</button>}<button className="outline-button" onClick={onSignOut}>Sign out</button></div></section>
    </div>{message && <p className="settings-message" role="status">{message}</p>}
  </div>;
}

function UserForm({ busy, onSubmit }: { busy: boolean; onSubmit: (v: unknown) => void }) {
  const [name, setName] = useState(""), [username, setUsername] = useState(""), [password, setPassword] = useState("");
  return <form onSubmit={e => { e.preventDefault(); onSubmit({ name, username, password }); }}><Field label="Name"><input required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Alex Maker"/></Field><Field label="Username"><input required autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="alex"/></Field><Field label="Temporary password"><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Any length"/></Field><p className="muted">Share the password with this person so they can sign in.</p><div className="form-actions"><button className="auth-submit" disabled={busy}>{busy ? "Adding…" : "Add user"}<ArrowRight size={16}/></button></div></form>;
}
function PasswordForm({ user, busy, onSubmit }: { user: User; busy: boolean; onSubmit: (password: string) => void }) {
  const [password, setPassword] = useState(""), [again, setAgain] = useState(""), [mismatch, setMismatch] = useState(false);
  return <form onSubmit={event => { event.preventDefault(); if (password !== again) { setMismatch(true); return; } onSubmit(password); }}>
    <p className="muted">Set a new password for @{user.username}. {user.is_admin ? "Other owner sessions" : "Their active sessions"} will be signed out.</p>
    <Field label="New password"><input type="password" autoComplete="new-password" value={password} onChange={event => { setPassword(event.target.value); setMismatch(false); }} placeholder="Any length"/></Field>
    <Field label="Confirm new password"><input type="password" autoComplete="new-password" value={again} onChange={event => { setAgain(event.target.value); setMismatch(false); }} placeholder="Enter it again"/></Field>
    {mismatch && <p className="error" role="alert">Passwords do not match.</p>}
    <div className="form-actions"><button className="auth-submit" disabled={busy}>{busy ? "Saving…" : "Change password"}<ArrowRight size={16}/></button></div>
  </form>;
}
createRoot(document.getElementById("root")!).render(<App/>);
