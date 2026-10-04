// Reads orders and cart from a Chrome session already signed in to Amazon, then posts to Life Stack.
import { chromium } from "playwright";

const ORIGIN = process.env.LIFESTACK_URL?.replace(/\/$/, "");
const TOKEN = process.env.LIFESTACK_TOKEN ?? "";
const CDP = process.env.AMAZON_CDP_URL || "http://127.0.0.1:9222";
const MONTHS = "https://www.amazon.com/your-orders/orders?timeFilter=months-3";
const CART = "https://www.amazon.com/gp/cart/view.html";

function isLogin(url) {
  return /\/ap\/(signin|mfa|cvf)/i.test(url) || /signin/i.test(new URL(url).pathname);
}

async function post(body) {
  const res = await fetch(`${ORIGIN}/api/v1/amazon/snapshot`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`snapshot ${res.status} ${json.error ?? ""}`.trim());
  return json;
}

async function extractOrders(page) {
  return page.evaluate(() => {
    const orderIdRe = /(\d{3}-\d{7}-\d{7})/;
    const cards = [...document.querySelectorAll(".order-card, .js-order-card, [data-csa-c-slot-id*='yourorders.order-card']")];
    const out = [];
    for (const card of cards) {
      const blob = card.innerText || "";
      const idm = blob.match(orderIdRe);
      if (!idm) continue;
      const orderId = idm[1];
      let orderDate = new Date().toISOString();
      const dateLine = blob.split("\n").find((l) => /ordered|placed/i.test(l) && /\d/.test(l));
      if (dateLine) {
        const d = Date.parse(dateLine.replace(/.*?on\s+/i, "").trim());
        if (!Number.isNaN(d)) orderDate = new Date(d).toISOString();
      }
      const statusEl = card.querySelector(".delivery-box, .yohtmlc-shipment-status-primary, [class*='delivery-box']");
      const status = (statusEl?.innerText || "").split("\n")[0]?.trim().slice(0, 40) || undefined;
      const items = [...card.querySelectorAll("a[href*='/dp/'], a[href*='/gp/product/']")];
      let line = 0;
      const seen = new Set();
      for (const a of items) {
        const href = a.getAttribute("href") || "";
        const asinM = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
        const title = (a.innerText || a.getAttribute("title") || "").replace(/\s+/g, " ").trim();
        if (!title || title.length < 2) continue;
        const key = `${asinM?.[1] ?? ""}:${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const wrap = a.closest(".a-fixed-left-grid, .yohtmlc-item, li, .order-item") || a.parentElement;
        const amount = (() => {
          const t = wrap?.innerText || "";
          const m = t.replace(/,/g, "").match(/\$(\d+(?:\.\d{1,2})?)/);
          return m ? Number(m[1]) : null;
        })();
        out.push({
          orderId,
          orderDate,
          title: title.slice(0, 300),
          quantity: 1,
          amount,
          asin: asinM ? asinM[1].toUpperCase() : undefined,
          status,
          line: line++,
        });
      }
      if (!line) {
        out.push({ orderId, orderDate, title: "Amazon order", quantity: 1, amount: moneyFrom(blob), status, line: 0 });
      }
    }
    function moneyFrom(text) {
      const m = String(text).replace(/,/g, "").match(/\$(\d+(?:\.\d{1,2})?)/);
      return m ? Number(m[1]) : null;
    }
    return out;
  });
}

async function extractCart(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-asin], .sc-list-item")].filter((el) => {
      const asin = el.getAttribute("data-asin");
      return asin && asin.length === 10 && !el.closest("[id*='sc-saved']");
    });
    return rows.map((el, i) => {
      const asin = (el.getAttribute("data-asin") || "").toUpperCase();
      const title =
        (el.querySelector(".sc-product-title, .a-truncate-full, [class*='product-title']")?.innerText ||
          el.querySelector("span.a-truncate-cut")?.innerText ||
          el.innerText.split("\n").find((l) => l.trim().length > 8) ||
          "Cart item")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 300);
      const qtyEl = el.querySelector("select[name*='quantity'], input[name*='quantity'], .sc-action-quantity-text");
      const qty = Math.max(1, Number(qtyEl?.value || qtyEl?.innerText || 1) || 1);
      const priceText = el.querySelector(".sc-product-price, .a-price .a-offscreen")?.innerText || el.innerText;
      const m = String(priceText).replace(/,/g, "").match(/\$(\d+(?:\.\d{1,2})?)/);
      return { title, quantity: Math.min(qty, 99), asin: asin || undefined, amount: m ? Number(m[1]) : null, line: i };
    });
  });
}

async function main() {
  if (!ORIGIN || !TOKEN.startsWith("ls_")) {
    console.error("set LIFESTACK_URL and LIFESTACK_TOKEN");
    process.exit(1);
  }
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP);
  } catch {
    console.error("chrome is not listening on", CDP, "- run start-chrome.sh and sign in");
    process.exit(2);
  }
  const context = browser.contexts()[0];
  if (!context) throw new Error("no chrome context");
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto(MONTHS, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (isLogin(page.url())) {
    await post({ status: "login_required" });
    console.log("login_required");
    return;
  }

  const orders = [];
  for (let start = 0; start < 100; start += 10) {
    if (start > 0) {
      await page.goto(`${MONTHS}&startIndex=${start}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (isLogin(page.url())) {
        await post({ status: "login_required" });
        console.log("login_required");
        return;
      }
    }
    const batch = await extractOrders(page);
    if (!batch.length) break;
    orders.push(...batch);
    if (batch.length < 3) break;
  }

  await page.goto(CART, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (isLogin(page.url())) {
    await post({ status: "login_required" });
    console.log("login_required");
    return;
  }
  const cart = await extractCart(page);
  const body = {
    status: "ok",
    orders: orders.map(({ line, ...rest }) => ({ ...rest, line })),
    cart: cart.map(({ line, ...item }) => item),
  };
  const res = await post(body);
  console.log(JSON.stringify({ ok: true, posted: { orders: body.orders.length, cart: body.cart.length }, server: res }));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "sync failed");
  process.exit(1);
});
