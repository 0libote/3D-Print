import type { Database } from "bun:sqlite";

export function migrateProduction(db: Database) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  if (!db.query("SELECT version FROM schema_migrations WHERE version=1").get())
    db.transaction(() => {
      for (const table of ["orders", "products", "filaments", "order_items"])
        db.exec(
          `ALTER TABLE ${table} ADD COLUMN version INTEGER NOT NULL DEFAULT 0`,
        );
      for (const column of [
        "cancelled INTEGER NOT NULL DEFAULT 0",
        "archived INTEGER NOT NULL DEFAULT 0",
        "currency TEXT NOT NULL DEFAULT 'GBP'",
        "payment_status TEXT NOT NULL DEFAULT 'unpaid'",
      ])
        db.exec(`ALTER TABLE orders ADD COLUMN ${column}`);
      db.exec(
        "UPDATE orders SET currency=COALESCE((SELECT value FROM app_settings WHERE key='currency'),'GBP')",
      );
      for (const column of [
        "grams_per_piece REAL NOT NULL DEFAULT 0",
        "minutes_per_piece REAL NOT NULL DEFAULT 0",
        "production_url TEXT NOT NULL DEFAULT ''",
        "revision TEXT NOT NULL DEFAULT ''",
        "print_profile TEXT NOT NULL DEFAULT ''",
      ]) {
        db.exec(`ALTER TABLE products ADD COLUMN ${column}`);
        db.exec(`ALTER TABLE order_items ADD COLUMN ${column}`);
      }
      db.exec(
        "ALTER TABLE filaments ADD COLUMN remaining_grams REAL NOT NULL DEFAULT 0; ALTER TABLE filaments ADD COLUMN cost_per_kg REAL NOT NULL DEFAULT 0;",
      );
      db.exec(
        "UPDATE filaments SET remaining_grams=spool_count*grams_per_spool",
      );
      db.exec(`
      CREATE TABLE order_pieces(id INTEGER PRIMARY KEY,item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','printing','printed','shipped')),version INTEGER NOT NULL DEFAULT 0,UNIQUE(item_id,ordinal));
      CREATE UNIQUE INDEX one_active_piece ON order_pieces(status) WHERE status='printing';
      CREATE TABLE print_jobs(id INTEGER PRIMARY KEY,piece_id INTEGER REFERENCES order_pieces(id) ON DELETE SET NULL,operator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,printer TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'running' CHECK(status IN('running','completed','failed','stopped')),started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,finished_at TEXT);
      CREATE UNIQUE INDEX one_running_job ON print_jobs(status) WHERE status='running';
      CREATE TABLE stock_movements(id INTEGER PRIMARY KEY,filament_id INTEGER REFERENCES filaments(id) ON DELETE SET NULL,actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,spool_delta INTEGER NOT NULL DEFAULT 0,grams_delta REAL NOT NULL DEFAULT 0,detail TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE shipments(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,carrier TEXT NOT NULL DEFAULT '',tracking TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX order_items_order_idx ON order_items(order_id);
      CREATE INDEX pieces_item_idx ON order_pieces(item_id);
      CREATE INDEX orders_deadline_idx ON orders(is_draft,cancelled,archived,ship_by);
    `);
      // Old line-level "printing" did not identify a single active piece. Migrate
      // unfinished pieces as queued; keep all completed/shipped work intact.
      const items = db
        .query<
          {
            id: number;
            quantity: number;
            printed_quantity: number;
            shipped_quantity: number;
            is_draft: number;
          },
          []
        >(
          "SELECT i.*,o.is_draft FROM order_items i JOIN orders o ON o.id=i.order_id",
        )
        .all();
      const insert = db.query(
        "INSERT INTO order_pieces(item_id,ordinal,status) VALUES(?,?,?)",
      );
      for (const item of items) {
        const printed = item.is_draft
          ? 0
          : Math.min(item.quantity, item.printed_quantity);
        const shipped = item.is_draft
          ? 0
          : Math.min(printed, item.shipped_quantity);
        for (let n = 1; n <= item.quantity; n++)
          insert.run(
            item.id,
            n,
            n <= shipped ? "shipped" : n <= printed ? "printed" : "queued",
          );
        db.query(
          "UPDATE order_items SET printed_quantity=?,shipped_quantity=?,status=? WHERE id=?",
        ).run(
          printed,
          shipped,
          shipped === item.quantity
            ? "shipped"
            : printed === item.quantity
              ? "printed"
              : "queued",
          item.id,
        );
      }
      db.exec(`UPDATE orders SET status=CASE
      WHEN EXISTS(SELECT 1 FROM order_items WHERE order_id=orders.id) AND NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=orders.id AND status<>'shipped') THEN 'shipped'
      WHEN EXISTS(SELECT 1 FROM order_items WHERE order_id=orders.id) AND NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=orders.id AND status NOT IN('printed','shipped')) THEN 'printed'
      WHEN EXISTS(SELECT 1 FROM order_items WHERE order_id=orders.id AND printed_quantity>0) THEN 'printing'
      ELSE 'new' END`);
      db.query("INSERT INTO schema_migrations(version) VALUES(1)").run();
    })();
  if (!db.query("SELECT version FROM schema_migrations WHERE version=2").get())
    db.transaction(() => {
      db.exec(`ALTER TABLE order_items ADD COLUMN cost_per_kg REAL NOT NULL DEFAULT 0;
      ALTER TABLE print_jobs ADD COLUMN product_name_snapshot TEXT NOT NULL DEFAULT '';
      ALTER TABLE print_jobs ADD COLUMN order_id_snapshot INTEGER;
      ALTER TABLE print_jobs ADD COLUMN ordinal_snapshot INTEGER;
      ALTER TABLE print_jobs ADD COLUMN estimated_minutes REAL NOT NULL DEFAULT 0;
      ALTER TABLE print_jobs ADD COLUMN estimated_grams REAL NOT NULL DEFAULT 0;
      ALTER TABLE print_jobs ADD COLUMN actual_grams REAL NOT NULL DEFAULT 0;
      ALTER TABLE print_jobs ADD COLUMN material_cost REAL NOT NULL DEFAULT 0;
      ALTER TABLE print_jobs ADD COLUMN currency TEXT NOT NULL DEFAULT 'GBP';
      CREATE TABLE shipment_pieces(shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,piece_id INTEGER REFERENCES order_pieces(id) ON DELETE SET NULL,product_name TEXT NOT NULL,ordinal INTEGER NOT NULL);
      UPDATE order_items SET cost_per_kg=COALESCE((SELECT cost_per_kg FROM filaments WHERE filaments.id=order_items.filament_id),0);
      UPDATE print_jobs SET product_name_snapshot=COALESCE((SELECT product_name FROM order_items i JOIN order_pieces p ON p.item_id=i.id WHERE p.id=print_jobs.piece_id),'Removed item'),order_id_snapshot=(SELECT order_id FROM order_items i JOIN order_pieces p ON p.item_id=i.id WHERE p.id=print_jobs.piece_id),ordinal_snapshot=(SELECT ordinal FROM order_pieces WHERE id=print_jobs.piece_id);
    `);
      db.query("INSERT INTO schema_migrations(version) VALUES(2)").run();
    })();
  if (!db.query("SELECT version FROM schema_migrations WHERE version=3").get())
    db.transaction(() => {
      db.exec(
        "ALTER TABLE products ADD COLUMN archived INTEGER NOT NULL DEFAULT 0; ALTER TABLE filaments ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;",
      );
      db.query("INSERT INTO schema_migrations(version) VALUES(3)").run();
    })();
  if (!db.query("SELECT version FROM schema_migrations WHERE version=4").get())
    db.transaction(() => {
      for (const table of ["orders", "print_jobs"])
        for (const column of [
          "machine_hourly_rate",
          "electricity_per_kwh",
          "printer_watts",
        ])
          db.exec(
            `ALTER TABLE ${table} ADD COLUMN ${column} REAL NOT NULL DEFAULT 0`,
          );
      db.exec(
        "ALTER TABLE print_jobs ADD COLUMN machine_cost REAL NOT NULL DEFAULT 0; ALTER TABLE print_jobs ADD COLUMN energy_cost REAL NOT NULL DEFAULT 0; ALTER TABLE print_jobs ADD COLUMN actual_minutes REAL NOT NULL DEFAULT 0",
      );
      db.query("INSERT INTO schema_migrations(version) VALUES(4)").run();
    })();
}
