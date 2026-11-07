// Minimal in-memory stand-in for Supabase REST (PostgREST) + Storage, for tests and local previews.
// Usage: node tests/mock-supabase.cjs   (listens on MOCK_SUPABASE_PORT or 54321)
const express = require('express');
const bcrypt = require('bcrypt');

function createMockSupabase() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use(express.raw({ type: '*/*', limit: '20mb' }));
  const db = {};
  const ids = {};
  const rows = t => (db[t] = db[t] || []);
  const add = (t, r) => { const row = { id: (ids[t] = (ids[t] || 0) + 1), created_at: new Date().toISOString(), ...r }; rows(t).push(row); return row; };
  const filter = (t, q) => {
    let r = rows(t).slice();
    for (const [k, v] of Object.entries(q)) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      const s = String(v);
      if (s.startsWith('eq.')) r = r.filter(x => String(x[k]) === decodeURIComponent(s.slice(3)));
      else if (s.startsWith('neq.')) r = r.filter(x => String(x[k]) !== decodeURIComponent(s.slice(4)));
      else if (s.startsWith('in.(')) { const set = s.slice(4, -1).split(',').map(x => x.replace(/"/g, '')); r = r.filter(x => set.includes(String(x[k]))); }
    }
    if (q.order) { const [c, d] = String(q.order).split('.'); r.sort((a, b) => (a[c] > b[c] ? 1 : -1) * (d === 'desc' ? -1 : 1)); }
    if (q.limit) r = r.slice(0, Number(q.limit));
    return r;
  };
  app.get('/rest/v1/:t', (req, res) => res.json(filter(req.params.t, req.query)));
  app.post('/rest/v1/:t', (req, res) => { const body = Array.isArray(req.body) ? req.body : [req.body]; res.status(201).json(body.map(b => add(req.params.t, b))); });
  app.patch('/rest/v1/:t', (req, res) => { const m = filter(req.params.t, req.query); m.forEach(x => Object.assign(x, req.body)); res.json(m); });
  app.delete('/rest/v1/:t', (req, res) => { const m = filter(req.params.t, req.query); db[req.params.t] = rows(req.params.t).filter(x => !m.includes(x)); res.json(m); });
  const files = {};
  app.post('/storage/v1/bucket', (_req, res) => res.json({ name: 'ok' }));
  app.post('/storage/v1/object/:b/*', (req, res) => { files[req.params[0]] = req.body; res.json({ Key: req.params[0] }); });
  app.get('/storage/v1/object/public/:b/*', (req, res) => { const f = files[req.params[0]]; if (!f) return res.sendStatus(404); res.send(f); });
  const seed = () => {
    add('users', { email: 'admin@test.local', password: bcrypt.hashSync('test1234', 10), name: 'Admin', role: 'admin' });
    const P = (name, nameEn, cat, price, extra = {}) => add('products', { name, cat, category: cat, price, emoji: '🎁', desc: 'قطعة مصنوعة يدوياً', images: [], stock: 10, rating: 5, reviews: 0, is_active: true, product_details: { nameEn }, ...extra });
    P('بوكس هدايا وردي', 'Pink gift box', 'gift-boxes', 12.5, { badge: 'جديد', badgeType: 'badge-new' });
    P('بطاقة ورقية مطوية يدوياً', 'Hand-folded paper card', 'cards', 2.5);
    P('باقة ورد ورقي', 'Paper flower bouquet', 'paper-flowers', 9.9, { oldPrice: 12 });
    P('لوحة فن ورقي باسم مخصص', 'Personalised paper-art frame', 'paper-art', 15, { stock: 2 });
    add('settings', { key: 'deliveryCost', value: '2.000' });
    add('settings', { key: 'vatRate', value: '0' });
  };
  return { app, db, seed };
}

module.exports = { createMockSupabase };

if (require.main === module) {
  const { app, seed } = createMockSupabase();
  seed();
  const port = Number(process.env.MOCK_SUPABASE_PORT || 54321);
  app.listen(port, () => console.log(`Mock Supabase on http://127.0.0.1:${port}`));
}
