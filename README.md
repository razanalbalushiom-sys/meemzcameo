# Meemz Cameo · ميمز كاميو

Online store for handmade gifts and paper art — Arabic + English storefront, cart and
bank-transfer checkout with receipt upload, order tracking, and an admin dashboard
(products, orders, staff, coupons, settings, accounting).

Built from the Resal store codebase and rebranded/simplified for Meemz Cameo:
brand palette (`#F5F0E6` cream · `#CF7486` rose · `#555D50` olive), new logo,
gift & paper-art categories, Arabic/English switch, gift-message / personalisation field
at checkout, one flat delivery price (pickup is free), and no regions, live-stream
embed, gaming content or unused template code.

## Project layout

| Path | What it is |
| --- | --- |
| `public/index.html`, `shop.html`, `product.html`, `about.html`, `my-orders.html` | Storefront pages (same markup, different `<body class>`) |
| `public/assets/store.css`, `store.js` | Storefront styles and logic (bilingual) |
| `public/assets/meemz-logo.png` | Logo (transparent PNG); `favicon.png`, `apple-touch-icon.png`, `meemz-mark.png` |
| `public/admin.html` | Dashboard login → `private/admin-page.html` (served only to logged-in staff) |
| `public/privacy.html`, `terms.html`, `data-deletion.html`, `reset-password.html` | Policy and account pages |
| `server/_core/index.ts` | Express server (security headers, static files) |
| `server/api.cjs` | REST API (`/api/...`) backed by Supabase |
| `SUPABASE_SETUP.sql` | Database schema + starter admin & settings |
| `tests/` | API tests (with an in-memory Supabase mock) and site checks |

## Go live (Supabase + Render)

1. **Supabase** — create a *new* project for Meemz Cameo. In **SQL Editor**, paste and run the whole
   `SUPABASE_SETUP.sql`. This creates the tables, the `product-images` storage bucket, the first admin
   account and starter settings.
2. **GitHub** — push this folder to a new repository (e.g. `meemz-cameo`).
3. **Render** — *New → Blueprint*, pick the repo (it reads `render.yaml`). Fill in:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Settings → API)
   - `DATABASE_URL` (Supabase → Settings → Database → connection string; optional but recommended)
   - `PUBLIC_URL` and `CORS_ORIGIN` = your site address, e.g. `https://meemz-cameo.onrender.com`
4. Open `https://<your-site>/admin.html`, log in with the admin account, then **change the password**
   and fill **Settings**: bank / phone transfer details, delivery price, Instagram, etc.
5. Add products (Arabic + optional English name/description, photos, colours, stock).

### Optional
- **WhatsApp Cloud API** automatic messages: create templates named `meemz_staff_new_order`,
  `meemz_order_confirmed`, `meemz_order_status`, `meemz_review_request` in Meta, then set the
  `WHATSAPP_*` variables. Without them the store still works — customers contact you via the
  WhatsApp buttons (+968 7996 0608).
- **Email (SMTP)** for order emails and password-reset links: fill the SMTP fields in Settings.

## Run locally

```bash
npm install
# with a real Supabase project:
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run dev
# or with the in-memory mock (sample products, admin@test.local / test1234):
node tests/mock-supabase.cjs &
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=x npm run dev
```
Open http://localhost:3000 (store) and http://localhost:3000/admin.html (dashboard).

```bash
npm test        # API + site checks
npm run check   # TypeScript
```
