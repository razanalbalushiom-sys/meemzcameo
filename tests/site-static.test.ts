import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const storePages: Record<string, string> = {
  "public/index.html": "home-page",
  "public/shop.html": "shop-page",
  "public/product.html": "product-page",
  "public/about.html": "about-page",
  "public/my-orders.html": "my-orders-page",
};
const allSources = [
  ...Object.keys(storePages), "public/assets/store.js", "public/assets/store.css", "public/admin.html",
  "public/privacy.html", "public/terms.html", "public/data-deletion.html", "public/reset-password.html",
  "private/admin-page.html", "server/api.cjs", "server/_core/index.ts", "render.yaml", "SUPABASE_SETUP.sql",
];

describe("Meemz Cameo storefront", () => {
  it("serves every store page from the shared stylesheet and script", () => {
    for (const [page, bodyClass] of Object.entries(storePages)) {
      const html = read(page);
      expect(html).toContain(`<body class="${bodyClass}">`);
      expect(html).toContain('<link rel="stylesheet" href="/assets/store.css"/>');
      expect(html).toContain('<script src="/assets/store.js"></script>');
      expect(html).toContain('onclick="openOrderModal(event)"');
      expect(html).toContain('id="cartDrawer" onclick="event.stopPropagation()"');
      expect(html).toContain('id="orderModal" onclick="event.stopPropagation()"');
    }
  });

  it("uses the Meemz Cameo brand palette and logo", () => {
    const css = read("public/assets/store.css");
    expect(css).toContain("--cream:#F5F0E6");
    expect(css).toContain("--rose:#CF7486");
    expect(css).toContain("--olive:#555D50");
    expect(fs.existsSync(path.join(root, "public/assets/meemz-logo.png"))).toBe(true);
  });

  it("supports Arabic and English", () => {
    const js = read("public/assets/store.js");
    expect(js).toContain("function setLang(");
    expect(js).toContain("function T(ar, en)");
    expect(read("public/index.html")).toContain('onclick="toggleLang()"');
  });

  it("formats prices safely and sends the gift message with orders", () => {
    const js = read("public/assets/store.js");
    expect(js).toContain("Number.isFinite(value)?value:0");
    expect(js).toContain("form.append('giftMessage'");
  });

  it("has no leftovers from the previous store", () => {
    for (const file of allSources) {
      const src = read(file);
      expect(src, file).not.toMatch(/Resal|رسال ستور|resal-store-om|razan\.albalushiom/i);
      expect(src, file).not.toMatch(/liveYoutubeUrl|tiktokEmbedUrl|livePopupOverlay/);
    }
  });

  it("removes region and delivery-zone controls from the dashboard", () => {
    const admin = read("private/admin-page.html");
    expect(admin).not.toContain('id="settingShippingZones"');
    expect(admin).not.toContain('id="settingRegionOptions"');
    expect(admin).not.toContain('<label class="form-label">مناطق توفر المنتج</label>');
    expect(admin).toContain('id="newPNameEn"');
    expect(admin).toContain("o.giftMessage");
  });
});
