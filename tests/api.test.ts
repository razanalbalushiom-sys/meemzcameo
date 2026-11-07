import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "http";
import { createRequire } from "module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createMockSupabase } = require("./mock-supabase.cjs");

let mockServer: Server;
let apiServer: Server;
let base = "";
let mock: any;

beforeAll(async () => {
  mock = createMockSupabase();
  mock.seed();
  mockServer = await new Promise<Server>(resolve => { const s = mock.app.listen(0, () => resolve(s)); });
  const mockPort = (mockServer.address() as any).port;
  process.env.SUPABASE_URL = `http://127.0.0.1:${mockPort}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  const { initializeAPI } = require("../server/api.cjs");
  const app = express();
  app.use(express.json());
  app.use("/api", await initializeAPI());
  apiServer = await new Promise<Server>(resolve => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(apiServer.address() as any).port}/api`;
});

afterAll(() => { apiServer?.close(); mockServer?.close(); });

function orderForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const fields: Record<string, string> = {
    name: "سارة", wilayat: "مسقط", area: "السيب", phone: "99112233",
    items: JSON.stringify([{ id: 1, name: "x", price: 0.001, qty: 2, locations: ["hack"], evil: "<script>" }]),
    delivery: "with", deliveryCost: "2", vatRate: "0", vatAmount: "0", total: "27",
    payment: "bank_transfer", giftMessage: "اسم: ليان", clientOrderKey: crypto.randomUUID(),
    ...overrides,
  };
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("proof", new Blob([fs.readFileSync(path.resolve(__dirname, "../public/assets/favicon.png"))], { type: "image/png" }), "receipt.png");
  return form;
}

describe("Meemz Cameo store API", () => {
  it("lists active products with English names", async () => {
    const j = await (await fetch(`${base}/products`)).json();
    expect(j.success).toBe(true);
    expect(j.products.length).toBe(4);
    expect(j.products[0].nameEn).toBe("Pink gift box");
    expect(j.products[0]).not.toHaveProperty("locations");
  });

  it("creates an order with a flat delivery price, MC- id, gift message and server prices", async () => {
    const r = await fetch(`${base}/orders`, { method: "POST", body: orderForm() });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.orderId).toMatch(/^MC-/);
    const saved = mock.db.orders.at(-1);
    expect(Number(saved.total)).toBe(27);
    expect(saved.deliveryCost).toBe(2);
    expect(saved.gift_message).toBe("اسم: ليان");
    expect(saved.items[0].price).toBe(12.5); // price comes from the product, not the client
    expect(saved.items[0]).not.toHaveProperty("evil");
    expect(saved.items[0]).not.toHaveProperty("locations");
    expect(mock.db.products[0].stock).toBe(8);
  });

  it("makes pickup free", async () => {
    const r = await fetch(`${base}/orders`, { method: "POST", body: orderForm({ delivery: "without", deliveryCost: "0", total: "25" }) });
    expect(r.status).toBe(200);
    expect(mock.db.orders.at(-1).deliveryCost).toBe(0);
  });

  it("rejects totals that do not match the server", async () => {
    const r = await fetch(`${base}/orders`, { method: "POST", body: orderForm({ total: "1" }) });
    expect(r.status).toBe(409);
  });

  it("rejects a fake receipt file", async () => {
    const form = orderForm(); form.delete("proof");
    form.append("proof", new Blob(["not really an image"], { type: "image/png" }), "receipt.png");
    expect((await fetch(`${base}/orders`, { method: "POST", body: form })).status).toBe(400);
  });

  it("requires a receipt and a valid Omani phone", async () => {
    const noProof = orderForm(); noProof.delete("proof");
    expect((await fetch(`${base}/orders`, { method: "POST", body: noProof })).status).toBe(400);
    expect((await fetch(`${base}/orders`, { method: "POST", body: orderForm({ phone: "123" }) })).status).toBe(400);
  });

  it("tracks an order only with the matching phone", async () => {
    const id = mock.db.orders[0].order_id;
    const ok = await (await fetch(`${base}/orders/track?orderId=${id}&phone=99112233`)).json();
    expect(ok.success).toBe(true);
    const bad = await fetch(`${base}/orders/track?orderId=${id}&phone=99999999`);
    expect(bad.status).toBe(404);
  });

  it("keeps admin endpoints private", async () => {
    expect((await fetch(`${base}/orders`)).status).toBe(401);
    expect((await fetch(`${base}/admin-page`)).status).toBe(403);
    const r = await fetch(`${base}/settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(r.status).toBe(403);
  });
});
