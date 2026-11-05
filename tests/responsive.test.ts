import { expect, test } from "bun:test";

/**
 * Responsive regression suite.
 *
 * The app must not break between browser sizes (320px phones through 1920px
 * desktops). These tests statically audit the stylesheets and markup for the
 * layout guarantees behind that: no page-level horizontal overflow, grids
 * whose fixed tracks fit their narrowest viewport, wrapping flex rows,
 * single-column forms on phones,_wrap-safe long text and 44px touch targets.
 *
 * They run in CI with `bun test` (no browser needed). Live multi-width
 * overflow scans with headless Chromium were used during development to find
 * the issues these tests now pin; see the viewport matrix below.
 */

const WIDTHS = [320, 360, 390, 414, 768, 820, 1024, 1280, 1440, 1920];

const cssFiles = [
  "src/styles.css",
  "src/workspace.css",
  "src/production.css",
  "src/mobile.css",
  "src/base.css",
  "src/tokens.css",
];
const tsxFiles = [
  "src/main.tsx",
  "src/OrdersBrowser.tsx",
  "src/PieceQueue.tsx",
  "src/Studio.tsx",
  "src/Modal.tsx",
  "src/Deadline.tsx",
];

async function read(path: string) {
  return Bun.file(path).text();
}
async function css() {
  return (await Promise.all(cssFiles.map(read))).join("\n/* file */\n");
}

type Block = { selector: string; body: string; media: string | null };

// Minimal CSS parser: splits top-level rules and one level of @media blocks.
function blocks(text: string): Block[] {
  const out: Block[] = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  const pushRules = (chunk: string, media: string | null) => {
    const re = /([^{}@]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk))) {
      const selector = m[1].trim().replace(/\s+/g, " ");
      if (selector) out.push({ selector, body: m[2], media });
    }
  };
  while (i < clean.length) {
    const at = clean.indexOf("@media", i);
    if (at < 0) {
      pushRules(clean.slice(i), null);
      break;
    }
    pushRules(clean.slice(i, at), null);
    const open = clean.indexOf("{", at);
    let depth = 0,
      j = open;
    for (; j < clean.length; j++) {
      if (clean[j] === "{") depth++;
      else if (clean[j] === "}") {
        depth--;
        if (!depth) break;
      }
    }
    pushRules(clean.slice(open + 1, j), clean.slice(at, open).trim());
    i = j + 1;
  }
  return out;
}

function decls(body: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const prop = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (!prop || !value) continue;
    map.set(prop, [...(map.get(prop) ?? []), value]);
  }
  return map;
}

function pxValues(value: string): number[] {
  return [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
}

test("viewport matrix covers phones through desktop", () => {
  expect(WIDTHS).toEqual([
    320, 360, 390, 414, 768, 820, 1024, 1280, 1440, 1920,
  ]);
});

test("html and body clip horizontal overflow", async () => {
  const base = await read("src/base.css");
  expect(base.replace(/\s+/g, " ")).toMatch(
    /html,\s*body\s*\{[^}]*overflow-x:\s*clip/,
  );
});

test("no 100vw widths (they overflow beside a scrollbar)", async () => {
  const all = await css();
  expect(all).not.toMatch(/100vw/);
});

test("no transition: all and no layout-property animation", async () => {
  const all = await css();
  expect(all).not.toMatch(/transition\s*:[^;{]*\ball\b/);
  for (const b of blocks(all)) {
    for (const v of decls(b.body).get("transition") ?? []) {
      expect(v).not.toMatch(/(^|[\s,])(width|height|top|left)(\s|,|$)/);
    }
  }
});

test("images cannot exceed their container", async () => {
  const base = await read("src/base.css");
  expect(base).toMatch(/img,\s*video\s*\{[^}]*max-width:\s*100%/);
});

test("Hallmark stamp stays the first line of the stylesheet", async () => {
  const first = (await read("src/styles.css"))
    .split("\n")
    .find((line) => line.trim().length > 0);
  expect(first!.startsWith("/* Hallmark")).toBe(true);
});

test("mobile bottom bar exists below 761px and rail between 761 and 1023", async () => {
  const mobile = await read("src/mobile.css");
  expect(mobile).toMatch(/@media\s*\(max-width:\s*760px\)/);
  expect(mobile).toMatch(
    /@media\s*\(min-width:\s*761px\)\s*and\s*\(max-width:\s*1023px\)/,
  );
});

test("small phones get a two-column fulfillment breakdown", async () => {
  const all = blocks(await css());
  const narrow = all.filter(
    (b) =>
      b.selector === ".fulfillment-breakdown" &&
      b.media?.includes("max-width") &&
      /repeat\(2,/.test(b.body),
  );
  expect(narrow.length).toBeGreaterThan(0);
  const width = Number(narrow[0].media!.match(/max-width:\s*(\d+)px/)![1]);
  expect(width).toBeGreaterThanOrEqual(480);
});

test("forms collapse to one column on phones", async () => {
  const all = blocks(await css());
  const single = all.filter(
    (b) =>
      b.selector === ".form-grid" &&
      b.media?.includes("max-width") &&
      /grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(b.body),
  );
  expect(single.length).toBeGreaterThan(0);
  const width = Number(single[0].media!.match(/max-width:\s*(\d+)px/)![1]);
  expect(width).toBeLessThanOrEqual(600);
  // Desktop keeps two columns.
  expect(
    all.some((b) => b.selector === ".form-grid" && /1fr 1fr/.test(b.body)),
  ).toBe(true);
});

test("filament cards wrap (archived cards carry extra buttons)", async () => {
  const all = blocks(await css());
  expect(
    all.some(
      (b) =>
        b.selector === ".filament-card" && /flex-wrap:\s*wrap/.test(b.body),
    ),
  ).toBe(true);
});

test("order heading actions wrap instead of overflowing 320px", async () => {
  const all = blocks(await css());
  expect(
    all.some(
      (b) =>
        b.selector === ".detail-heading-actions" &&
        /flex-wrap:\s*wrap/.test(b.body),
    ),
  ).toBe(true);
});

test("page headings wrap on mid-width viewports", async () => {
  const all = blocks(await css());
  expect(
    all.some(
      (b) => b.selector === ".page-heading" && /flex-wrap:\s*wrap/.test(b.body),
    ),
  ).toBe(true);
});

test("image-bearing grids use minmax(0, 1fr) tracks", async () => {
  const all = await css();
  for (const selector of [".product-grid", ".filament-grid", ".stat-grid"]) {
    const hit = blocks(all).filter((b) => b.selector.includes(selector));
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.some((b) => /minmax\(0,\s*1fr\)/.test(b.body))).toBe(true);
  }
  const card = blocks(all).find(
    (b) => b.selector === ".product-card" && b.media === null,
  );
  expect(card!.body).toMatch(/112px minmax\(0,\s*1fr\)/);
});

test("four-column piece tickets only start at 1024px", async () => {
  const all = blocks(await css());
  const wide = all.filter(
    (b) => b.selector === ".piece-row" && /minmax\(180px/.test(b.body),
  );
  expect(wide.length).toBeGreaterThan(0);
  const min = Math.min(
    ...wide.map((b) => Number(b.media!.match(/min-width:\s*(\d+)px/)![1])),
  );
  expect(min).toBeGreaterThanOrEqual(1024);
});

test("piece ticket fixed tracks fit the narrowest desktop content", async () => {
  // 761px viewport - 84px rail - 80px content padding = 597px available.
  const all = blocks(await css());
  const rows = all.filter(
    (b) => b.selector === ".piece-row" && /minmax\(180px/.test(b.body),
  );
  for (const row of rows) {
    const cols = row.body.match(/grid-template-columns:([^;]+);/)![1];
    const fixed = pxValues(cols).reduce((a, n) => a + n, 0);
    expect(fixed).toBeLessThanOrEqual(460);
  }
});

test("order item rows fit the order detail column", async () => {
  const all = blocks(await css());
  const rows = all.filter(
    (b) =>
      b.selector === ".detail-item-card" && /minmax\(\s*140px/.test(b.body),
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    const cols = row.body.match(/grid-template-columns:([^;]+);/)![1];
    const fixed = pxValues(cols).reduce((a, n) => a + n, 0);
    // Two 44px icon buttons + 52px swatch + 140px stage floor.
    expect(fixed).toBeLessThanOrEqual(420);
  }
});

test("queue action text buttons can wrap on phones", async () => {
  const all = blocks(await css());
  expect(
    all.some(
      (b) =>
        b.selector === ".piece-actions .text-button" &&
        /white-space:\s*normal/.test(b.body),
    ),
  ).toBe(true);
});

test("flex children that carry long text have min-width 0", async () => {
  const all = await css();
  const required: Record<string, string> = {
    ".filament-info": "filament names and stock counts",
    ".job-history article > div": "operator names and notes",
    ".mobile-page-title": "truncated top-bar title",
    ".recent-list > button > span:nth-child(2)": "recent order text",
    ".detail-item-copy": "product names",
  };
  for (const [selector, why] of Object.entries(required)) {
    const hit = blocks(all).filter((b) => b.selector === selector);
    expect(`${selector} (${why}): ${hit.length}`).not.toBe(
      `${selector} (${why}): 0`,
    );
    expect(hit.some((b) => /min-width:\s*0/.test(b.body))).toBe(true);
  }
});

test("long text containers wrap anywhere-safe words", async () => {
  const all = await css();
  // Every container that renders user-controlled text (names, emails,
  // notes, tracking references) must break unspaced tokens instead of
  // overflowing its card or column. Found live with headless Chromium at
  // 320px using an 80-character email address.
  for (const selector of [
    ".recent-list small",
    ".piece-copy strong",
    ".activity-row p",
    ".detail-info-panel p",
    ".filament-info p",
    ".filament-info small",
    ".team-row small",
    ".shipment-list p",
    ".dispatch-choices label",
    ".choice span",
    ".stat small",
    ".team-row strong",
    ".activity-row strong",
    ".material-plan strong",
  ]) {
    const hit = blocks(all).filter((b) =>
      b.selector
        .split(",")
        .map((s) => s.trim())
        .includes(selector),
    );
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.some((b) => /overflow-wrap:\s*break-word/.test(b.body))).toBe(
      true,
    );
  }
});

test("grid items hosting user content can shrink below min-content", async () => {
  // A grid item defaults to min-width: auto, which floors it at its content's
  // min-content size. One unbreakable token (an 81-character email kept a
  // 435px min-content) then stretches an auto track and every sibling panel
  // with it — while overflow-wrap: break-word alone does NOT shrink
  // min-content (only anywhere does that). Found live with headless Chromium.
  const all = blocks(await css());
  for (const selector of [
    ".order-side-column > .panel",
    ".product-card",
    ".filament-card",
  ]) {
    const hit = all.filter((b) =>
      b.selector
        .split(",")
        .map((s) => s.trim())
        .includes(selector),
    );
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.some((b) => /min-width:\s*0/.test(b.body))).toBe(true);
  }
});

test("orders table scrolls inside its panel on desktop", async () => {
  const all = blocks(await css());
  expect(
    all.some(
      (b) =>
        b.selector === ".orders-list .table-wrap" &&
        b.media?.includes("min-width") &&
        /overflow:\s*auto/.test(b.body),
    ),
  ).toBe(true);
});

test("touch targets are 44px", async () => {
  const touch = await read("src/tokens.css");
  expect(touch).toMatch(/--touch:\s*44px/);
  const all = blocks(await css());
  for (const selector of [
    ".icon-button",
    ".theme-toggle",
    ".auth-submit",
    ".outline-button",
    ".progress-button",
    ".nav",
  ]) {
    const hit = all.filter((b) =>
      b.selector
        .split(",")
        .map((s) => s.trim())
        .includes(selector),
    );
    expect(hit.length).toBeGreaterThan(0);
    expect(
      hit.some((b) => /(min-)?(width|height):\s*var\(--touch\)/.test(b.body)),
    ).toBe(true);
  }
});

const NOWRAP_ALLOWLIST: RegExp[] = [
  /^\.auth-submit$/,
  /^\.outline-button$/,
  /^\.progress-button$/,
  /^\.text-button$/,
  /^\.danger-text$/,
  /\.filter-tabs button/,
  /^\.status$/,
  /^\.deadline/,
  /^\.live-status$/,
  /^\.team-role$/,
  /\.profile-text (strong|small)/,
  /\.workspace-context strong/,
  /\.crumb-id/,
  /\.order-open/,
  /\.mobile-page-title$/,
  /\.orders-list (th|td)/,
  /\.detail-title-row/,
  /\.summary/,
  /\.nav/,
  /\.choice$/,
  /count|total|price|code|id|deadline|pieces|status|customer/,
];

test("white-space: nowrap only appears in allowlisted pill, badge and table contexts", async () => {
  const offenders: string[] = [];
  for (const b of blocks(await css())) {
    if (!/white-space:\s*nowrap/.test(b.body)) continue;
    for (const raw of b.selector.split(",")) {
      const selector = raw.trim();
      if (!NOWRAP_ALLOWLIST.some((re) => re.test(selector)))
        offenders.push(selector);
    }
  }
  expect(offenders).toEqual([]);
});

test("no wide fixed min-widths outside a desktop media query", async () => {
  const offenders: string[] = [];
  for (const b of blocks(await css())) {
    if (b.media?.includes("min-width")) continue;
    for (const v of decls(b.body).get("min-width") ?? []) {
      for (const px of pxValues(v)) {
        if (px >= 180) offenders.push(`${b.selector}: min-width ${px}px`);
      }
    }
  }
  expect(offenders).toEqual([]);
});

test("every image has alt text", async () => {
  const missing: string[] = [];
  for (const file of tsxFiles) {
    const src = await read(file);
    for (const m of src.matchAll(/<img\b[^>]*>/g)) {
      if (!/alt=/.test(m[0])) missing.push(`${file}: ${m[0].slice(0, 60)}`);
    }
  }
  expect(missing).toEqual([]);
});

test("no wide fixed inline widths in markup", async () => {
  const offenders: string[] = [];
  for (const file of tsxFiles) {
    for (const [index, line] of (await read(file)).split("\n").entries()) {
      // Skip media-query strings, packing-slip <style> blocks and max-widths.
      if (/matchMedia|max-width|min-width/.test(line)) continue;
      for (const m of line.matchAll(/width:\s*["']?(\d+)px/g)) {
        if (Number(m[1]) >= 200)
          offenders.push(`${file}:${index + 1}: ${m[0]}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});

test("order deep links keep working (?order=id)", async () => {
  const main = await read("src/main.tsx");
  expect(main).toMatch(/get\("order"\)/);
  expect(main).toMatch(/setSelectedOrder\(orderId\)/);
});

test("accessible dialogs keep focus containment and Escape", async () => {
  const modal = await read("src/Modal.tsx");
  expect(modal).toMatch(/Escape/);
  expect(modal).toMatch(/role.*dialog|aria-modal/);
});
