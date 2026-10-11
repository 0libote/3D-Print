import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrateProduction } from "../server/migrations";
import { production } from "../server/production";

test("production migration preserves partial counts, repairs drafts and is idempotent", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE app_settings(key TEXT,value TEXT); INSERT INTO app_settings VALUES('currency','USD');
    CREATE TABLE orders(id INTEGER PRIMARY KEY,status TEXT,is_draft INTEGER,ship_by TEXT,updated_at TEXT);
    CREATE TABLE products(id INTEGER PRIMARY KEY);
    CREATE TABLE filaments(id INTEGER PRIMARY KEY,spool_count INTEGER,grams_per_spool REAL);
    CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,printed_quantity INTEGER,shipped_quantity INTEGER,status TEXT,filament_id INTEGER,product_name TEXT);
    INSERT INTO orders VALUES(1,'printing',0,'',''),(2,'new',1,'',''),(3,'shipped',0,'','');
    INSERT INTO order_items VALUES(1,1,3,2,1,'printing',1,'Widget'),(2,2,2,2,2,'shipped',1,'Widget'),(3,3,1,1,1,'shipped',1,'Widget');
    INSERT INTO filaments VALUES(1,2,1000);
  `);
  migrateProduction(db);
  migrateProduction(db);
  expect(
    production(db)
      .pieces(1)
      .map((p) => p.status),
  ).toEqual(["shipped", "printed", "queued"]);
  expect(
    production(db)
      .pieces(2)
      .map((p) => p.status),
  ).toEqual(["queued", "queued"]);
  expect(production(db).pieces(3)[0].status).toBe("shipped");
  expect(
    db.query("SELECT status,currency FROM orders WHERE id=1").get(),
  ).toEqual({ status: "printing", currency: "USD" });
  expect(db.query("SELECT remaining_grams FROM filaments").get()).toEqual({
    remaining_grams: 2000,
  });
  expect(
    db.query("SELECT COUNT(*) AS count FROM schema_migrations").get(),
  ).toEqual({ count: 4 });
  db.close();
});
