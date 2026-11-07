const express = require('express');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const postgres = require('postgres');

const router = express.Router();

// Supabase client using fetch (no SDK dependency)
class SupabaseClient {
  constructor() {
    this.url = process.env.SUPABASE_URL;
    this.key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'product-images';
    this.storageBucketReady = false;
    
    if (!this.url || !this.key) {
      console.error('Missing Supabase credentials');
    }
  }

  async request(method, table, options = {}) {
    const url = `${this.url}/rest/v1/${table}`;
    
    const headers = {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    const config = {
      method,
      headers,
      ...options
    };

    if (options.body) {
      config.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Supabase request failed');
      }
      
      return data;
    } catch (error) {
      console.error('Supabase error:', error);
      throw error;
    }
  }

  async select(table, filter = '') {
    const url = `${this.url}/rest/v1/${table}${filter}`;
    const headers = {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
    };

    try {
      const response = await fetch(url, { headers });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Supabase select error:', error);
      return [];
    }
  }

  async insert(table, records) {
    return this.request('POST', table, { body: Array.isArray(records) ? records : [records] });
  }

  async update(table, id, updates) {
    return this.request('PATCH', `${table}?id=eq.${id}`, { body: updates });
  }

  async updateBy(table, column, value, updates) {
    return this.request('PATCH', `${table}?${column}=eq.${encodeURIComponent(value)}`, { body: updates });
  }

  async delete(table, id) {
    return this.request('DELETE', `${table}?id=eq.${id}`);
  }

  async deleteBy(table, column, value) {
    return this.request('DELETE', `${table}?${column}=eq.${encodeURIComponent(value)}`);
  }

  async ensureStorageBucket() {
    if (this.storageBucketReady) return;
    const response = await fetch(`${this.url}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: this.storageBucket,
        name: this.storageBucket,
        public: true,
        file_size_limit: 5242880,
        allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'application/pdf']
      })
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status !== 409 && !text.toLowerCase().includes('already')) {
        throw new Error(`Storage bucket setup failed: ${text}`);
      }
    }

    this.storageBucketReady = true;
  }

  async uploadFile(buffer, filename, contentType = 'application/octet-stream') {
    await this.ensureStorageBucket();
    const response = await fetch(`${this.url}/storage/v1/object/${this.storageBucket}/${filename}`, {
      method: 'POST',
      headers: {
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': contentType,
        'x-upsert': 'true'
      },
      body: buffer
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`File upload failed: ${text}`);
    }

    return `${this.url}/storage/v1/object/public/${this.storageBucket}/${filename}`;
  }
}

const supabase = new SupabaseClient();

function isAdminRole(role) {
  return role === 'admin' || role === 'moderator';
}

function isMainAdminRole(role) {
  return role === 'admin';
}

function isOrderStaffRole(role) {
  return ['admin', 'moderator', 'employee'].includes(role);
}

function isProductStaffRole(role) {
  return isAdminRole(role) || role === 'employee';
}

function isDashboardRole(role) {
  return ['admin', 'moderator', 'employee'].includes(role);
}

function whatsappVerifyToken() {
  return String(process.env.WHATSAPP_VERIFY_TOKEN || process.env.META_WHATSAPP_VERIFY_TOKEN || '').trim();
}

const recentWhatsAppEvents = [];

// Initialize API
async function initializeAPI() {
  return router;
}

const storage = multer.memoryStorage();
const productImageMaxBytes = Number(process.env.PRODUCT_IMAGE_MAX_BYTES || 12 * 1024 * 1024);
const upload = multer({
  storage,
  limits: { fileSize: productImageMaxBytes, files: 8 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpe?g|png|webp|gif|avif)$/.test(file.mimetype)) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  }
});

const receiptUpload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!/^(image\/(jpe?g|png|webp|gif|avif)|application\/pdf)$/.test(file.mimetype)) {
      return cb(new Error('Receipt must be an image or PDF'));
    }
    cb(null, true);
  }
});

// Rate limiting
function requestIpKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = req.ip || forwarded || req.socket?.remoteAddress || '127.0.0.1';
  return rateLimit.ipKeyGenerator(ip);
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX || 300),
  keyGenerator: requestIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again later.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 8),
  keyGenerator: requestIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { success: false, error: 'Too many login attempts. Please try again later.' }
});
const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.ORDER_RATE_LIMIT_MAX || 30),
  keyGenerator: requestIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many orders from this connection. Please try again later.' }
});

const ORDER_SUBMISSION_DEDUP_MS = 2 * 60 * 1000;
const recentOrderSubmissions = new Map();

function cleanupRecentOrderSubmissions() {
  const now = Date.now();
  for (const [key, entry] of recentOrderSubmissions.entries()) {
    if (!entry || entry.expiresAt <= now) {
      recentOrderSubmissions.delete(key);
    }
  }
}

function createOrderId() {
  return `MC-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function orderSubmissionKey({ clientOrderKey, phone, items, total, payment, file }) {
  const clientKey = String(clientOrderKey || '').trim().replace(/[^\w:.-]/g, '').slice(0, 120);
  if (clientKey) return `client:${clientKey}`;
  const proofHash = file?.buffer
    ? crypto.createHash('sha256').update(file.buffer).digest('hex').slice(0, 24)
    : 'missing-proof';
  const payload = JSON.stringify({
    phone,
    items: (items || []).map(item => ({
      id: String(item.id || ''),
      qty: Number(item.qty || 1),
      color: String(item.selectedColor || item.color || ''),
      price: Number(item.price || 0)
    })),
    total: Number(total || 0).toFixed(3),
    payment: String(payment || ''),
    proofHash
  });
  return `body:${crypto.createHash('sha256').update(payload).digest('hex')}`;
}
router.use(apiLimiter);

// Session middleware
const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.SESSION_SECRET) {
  console.warn('[Security] SESSION_SECRET is not set. Add a strong SESSION_SECRET in Render environment variables.');
}

function createPostgresSessionStore() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!isProd || !databaseUrl) return undefined;

  const fallbackStore = new session.MemoryStore();
  const sql = postgres(databaseUrl, {
    max: 2,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: databaseUrl.includes('supabase.') ? 'require' : undefined,
  });

  let unavailable = false;
  let closed = false;

  function useFallback(method, args) {
    if (typeof fallbackStore[method] === 'function') {
      return fallbackStore[method](...args);
    }
    const callback = args[args.length - 1];
    if (typeof callback === 'function') callback(null);
  }

  function disablePostgresSessions(error) {
    if (!unavailable) {
      unavailable = true;
      const message = error?.message || String(error || 'unknown error');
      console.warn('[Security] PostgreSQL session store unavailable; using process-local sessions until DATABASE_URL is reachable.', message);
      console.warn('[Security] On Render with Supabase, use the Supabase connection pooler DATABASE_URL if the direct database URL resolves to IPv6.');
      if (!closed) {
        closed = true;
        Promise.resolve(sql.end({ timeout: 1 })).catch(() => {});
      }
    }
  }

  const store = new session.Store();
  const ready = sql`
    create table if not exists app_sessions (
      sid text primary key,
      sess jsonb not null,
      expire timestamptz not null
    )
  `.then(() => sql`
    create index if not exists app_sessions_expire_idx on app_sessions (expire)
  `).then(() => {
    console.log('[Security] PostgreSQL session store initialized.');
  }).catch(error => {
    disablePostgresSessions(error);
  });

  store.get = (sid, callback) => {
    if (unavailable) return useFallback('get', [sid, callback]);
    ready
      .then(() => {
        if (unavailable) return useFallback('get', [sid, callback]);
        return sql`select sess, expire from app_sessions where sid = ${sid} limit 1`;
      })
      .then(rows => {
        if (unavailable) return;
        const row = rows[0];
        if (!row) return callback(null, null);
        if (row.expire && new Date(row.expire).getTime() <= Date.now()) {
          return sql`delete from app_sessions where sid = ${sid}`.then(() => callback(null, null));
        }
        callback(null, row.sess);
      })
      .catch(error => {
        disablePostgresSessions(error);
        useFallback('get', [sid, callback]);
      });
  };

  store.set = (sid, sess, callback) => {
    if (unavailable) return useFallback('set', [sid, sess, callback]);
    const maxAge = Number(sess?.cookie?.maxAge || 24 * 60 * 60 * 1000);
    const expire = new Date(Date.now() + maxAge);
    ready
      .then(() => {
        if (unavailable) return useFallback('set', [sid, sess, callback]);
        return sql`
        insert into app_sessions (sid, sess, expire)
        values (${sid}, ${sql.json(sess)}, ${expire})
        on conflict (sid) do update set sess = excluded.sess, expire = excluded.expire
      `;
      })
      .then(() => {
        if (!unavailable) callback(null);
      })
      .catch(error => {
        disablePostgresSessions(error);
        useFallback('set', [sid, sess, callback]);
      });
  };

  store.destroy = (sid, callback) => {
    if (unavailable) return useFallback('destroy', [sid, callback]);
    ready
      .then(() => {
        if (unavailable) return useFallback('destroy', [sid, callback]);
        return sql`delete from app_sessions where sid = ${sid}`;
      })
      .then(() => {
        if (!unavailable) callback(null);
      })
      .catch(error => {
        disablePostgresSessions(error);
        useFallback('destroy', [sid, callback]);
      });
  };

  store.touch = (sid, sess, callback) => {
    if (unavailable) return useFallback('touch', [sid, sess, callback]);
    const maxAge = Number(sess?.cookie?.maxAge || 24 * 60 * 60 * 1000);
    const expire = new Date(Date.now() + maxAge);
    ready
      .then(() => {
        if (unavailable) return useFallback('touch', [sid, sess, callback]);
        return sql`update app_sessions set expire = ${expire} where sid = ${sid}`;
      })
      .then(() => {
        if (!unavailable) callback(null);
      })
      .catch(error => {
        disablePostgresSessions(error);
        useFallback('touch', [sid, sess, callback]);
      });
  };

  return store;
}

const sessionStore = createPostgresSessionStore();
router.use(session({
  name: 'meemz.sid',
  secret: process.env.SESSION_SECRET || 'meemz_dev_secret_change_in_prod',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  proxy: isProd,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  }
}));

function normalizeOrigin(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function configuredAllowedOrigins(req) {
  const host = String(req.headers.host || '').trim();
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const currentOrigin = host ? `${proto}://${host}` : '';
  return new Set([
    normalizeOrigin(process.env.PUBLIC_URL || ''),
    ...String(process.env.CORS_ORIGIN || '').split(',').map(normalizeOrigin),
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    normalizeOrigin(currentOrigin)
  ].filter(Boolean));
}

router.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const originHeader = req.headers.origin || '';
  const refererHeader = req.headers.referer || '';
  let requestOrigin = normalizeOrigin(originHeader);
  if (!requestOrigin && refererHeader) {
    try {
      requestOrigin = normalizeOrigin(new URL(refererHeader).origin);
    } catch (_error) {
      return res.status(403).json({ success: false, error: 'Invalid request origin' });
    }
  }
  if (!requestOrigin) return next();
  if (!configuredAllowedOrigins(req).has(requestOrigin)) {
    return res.status(403).json({ success: false, error: 'Request origin is not allowed' });
  }
  next();
});

// Helpers
function extensionForMime(mimetype = '', fallback = '.bin') {
  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif',
    'application/pdf': '.pdf'
  };
  return map[String(mimetype || '').toLowerCase()] || fallback;
}

function safeUploadName(originalName = 'image', mimetype = '') {
  const originalExt = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '');
  const ext = extensionForMime(mimetype, originalExt || '.jpg');
  return `products/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
}

function bufferLooksLikeImage(buffer, mimetype = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const hex = buffer.subarray(0, 12).toString('hex');
  if (/^image\/jpe?g$/i.test(mimetype)) return hex.startsWith('ffd8ff');
  if (/^image\/png$/i.test(mimetype)) return hex.startsWith('89504e470d0a1a0a');
  if (/^image\/gif$/i.test(mimetype)) return buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
  if (/^image\/webp$/i.test(mimetype)) return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (/^image\/avif$/i.test(mimetype)) return buffer.subarray(4, 12).toString('ascii').includes('ftypavif') || buffer.subarray(4, 12).toString('ascii').includes('ftypavis');
  return false;
}

function bufferLooksLikePdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

async function saveImageBuffer(file) {
  if (!bufferLooksLikeImage(file.buffer, file.mimetype)) {
    throw new Error('Invalid image file content');
  }
  return supabase.uploadFile(file.buffer, safeUploadName(file.originalname, file.mimetype), file.mimetype);
}

function safeReceiptName(originalName = 'receipt', mimetype = '') {
  const originalExt = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '');
  const ext = extensionForMime(mimetype, originalExt || '.jpg');
  return `receipts/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
}

async function saveReceiptBuffer(file) {
  const valid = bufferLooksLikePdf(file.buffer) || bufferLooksLikeImage(file.buffer, file.mimetype);
  if (!valid) {
    const error = new Error('Invalid receipt file content');
    error.statusCode = 400;
    throw error;
  }
  return supabase.uploadFile(file.buffer, safeReceiptName(file.originalname, file.mimetype), file.mimetype);
}

function isRenderableProductImage(src) {
  const value = String(src || '').trim();
  return /^https?:\/\//i.test(value) && !value.includes('/uploads/');
}

function normalizeOrder(row) {
  if (!row) return row;
  const items = sanitizeOrderItems(typeof row.items === 'string' ? JSON.parse(row.items || '[]') : (row.items || []));
  const statusLabels = {
    new: 'جديد',
    processing: 'قيد التجهيز',
    payment_confirmed: 'Payment confirmed',
    waiting_for_internal_shipment: 'بانتظار الشحن الداخلي',
    internal_shipment_sent: 'تم إرسال الشحن الداخلي',
    internal_shipment_received: 'تم استلام الشحن الداخلي',
    ready_for_final_delivery: 'جاهز للتسليم النهائي',
    out_for_delivery: 'خرج للتوصيل',
    delivered: 'تم التسليم',
    shipped: 'تم الشحن',
    done: 'مكتمل',
    cancelled: 'ملغي'
  };
  return {
    ...row,
    id: row.order_id || row.id,
    dbId: row.id,
    name: row.customer_name || row.name || '',
    items,
    total: Number(row.total ?? row.total_price ?? 0),
    deliveryCost: Number(row.deliveryCost ?? row.delivery_cost ?? 0),
    vatRate: Number(row.vatRate ?? row.vat_rate ?? 0),
    vatAmount: Number(row.vatAmount ?? row.vat_amount ?? 0),
    preparedBy: row.prepared_by || null,
    preparedByName: row.prepared_by_name || '',
    commissionRate: Number(row.commission_rate || 0),
    commissionAmount: Number(row.commission_amount || 0),
    proof: row.proof || '',
    giftMessage: row.gift_message || '',
    isMultiRegion: row.is_multi_region === true || row.is_multi_region === 'true',
    collectionPoint: row.collection_point || '',
    collectionStrategy: row.collection_strategy || 'manual',
    finalDeliveryStatus: row.final_delivery_status || '',
    cancellationRequestStatus: row.cancellation_request_status || '',
    cancellationRequestedBy: row.cancellation_requested_by || null,
    cancellationRequestedByName: row.cancellation_requested_by_name || '',
    cancellationReason: row.cancellation_reason || '',
    shippingActualCost: Number(row.shipping_actual_cost || 0),
    statusLabel: row.status === 'payment_confirmed' ? 'Payment confirmed' : (statusLabels[row.status] || row.status)
  };
}

function isCancelledStatus(status) {
  return ['cancelled', 'canceled'].includes(String(status || '').toLowerCase());
}

function dedupeOrders(rows = []) {
  const seen = new Set();
  const unique = [];
  for (const row of rows || []) {
    const key = String(row?.order_id || row?.id || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

function normalizeProduct(row, options = {}) {
  if (!row) return row;
  const includeInternal = options.includeInternal === true;
  const rawImages = typeof row.images === 'string' ? JSON.parse(row.images || '[]') : (row.images || []);
  const images = rawImages.filter(isRenderableProductImage);
  const productDetails = typeof row.product_details === 'string'
    ? JSON.parse(row.product_details || '{}')
    : (row.product_details || {});
  const publicProductDetails = { ...productDetails };
  if (!includeInternal) {
    delete publicProductDetails.locations;
  }
  const firstImage = isRenderableProductImage(row.image_url) ? [row.image_url] : [];
  const product = {
    ...row,
    cat: row.cat || row.category || '',
    category: row.category || row.cat || '',
    emoji: row.emoji || '📦',
    oldPrice: row.oldPrice == null ? null : Number(row.oldPrice),
    badgeType: row.badgeType || '',
    rating: Number(row.rating || 5),
    reviews: Number(row.reviews || 0),
    desc: row.desc || row.description || '',
    productDetails: publicProductDetails,
    specs: Array.isArray(productDetails.specs) ? productDetails.specs : [],
    boxContents: Array.isArray(productDetails.boxContents) ? productDetails.boxContents : [],
    colors: Array.isArray(productDetails.colors) ? productDetails.colors : [],
    nameEn: productDetails.nameEn || '',
    descEn: productDetails.descEn || '',
    deliveryTime: productDetails.deliveryTime || '',
    images: images.length ? images : firstImage,
    isActive: row.is_active !== false && row.isActive !== false,
    stock: Number(row.stock || 0),
    price: Number(row.price || 0)
  };
  if (!includeInternal) {
    delete product.product_details;
  }
  return product;
}

function sanitizeOrderItems(items) {
  if (!Array.isArray(items)) return [];
  // Keep only the fields an order line needs (client input is untrusted).
  return items.filter(item => item && typeof item === 'object').slice(0, 100).map(item => ({
    id: item.id ?? item.product_id ?? '',
    name: String(item.name || '').slice(0, 180),
    price: Number(item.price || 0),
    qty: Math.max(1, Math.min(999, parseInt(item.qty, 10) || 1)),
    selectedColor: String(item.selectedColor || '').slice(0, 80),
    cat: String(item.cat || '').slice(0, 60),
    emoji: String(item.emoji || '').slice(0, 16)
  }));
}

function parseLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(v => v.trim())
    .filter(Boolean);
}

function parseJsonSetting(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function normalizeRegionName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function regionKey(value) {
  return normalizeRegionName(value).toLowerCase();
}

function parseRegionList(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
          const parsed = parseJsonSetting(value, null);
          return Array.isArray(parsed) ? parsed : value.split(/\r?\n|,/);
        })()
      : [];
  return [...new Set(raw.map(normalizeRegionName).filter(Boolean))].slice(0, 40);
}

// Meemz Cameo uses one flat delivery price (settings.deliveryCost); pickup is free.
// This mirrors the storefront checkout so client and server totals always match.
function deliveryCostForRegion(settings, _wilayat, delivery) {
  if (delivery === 'without') return 0;
  const flat = Number(settings.deliveryCost);
  return Number.isFinite(flat) && flat >= 0 ? flat : 2;
}

function filterRegionsToOptions(regions, options) {
  const selectedKeys = new Set(parseRegionList(regions).map(regionKey));
  const allowed = parseRegionList(options);
  if (!allowed.length || !selectedKeys.size) return [];
  return allowed.filter(region => selectedKeys.has(regionKey(region)));
}

function staffRegionsFromSettings(settings) {
  const parsed = parseJsonSetting(settings.staffRegions, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function regionOptionsFromSettings(settings) {
  return parseRegionList(settings.regionOptions);
}

function userRegions(user, staffRegionsMap = {}) {
  const fromUser = parseRegionList(user?.regions);
  if (fromUser.length) return fromUser;
  return parseRegionList(staffRegionsMap[String(user?.id || '')]);
}

async function saveStaffRegionsMap(map) {
  const value = JSON.stringify(map || {});
  const updated = await supabase.updateBy('settings', 'key', 'staffRegions', { value });
  if (!updated || !updated.length) {
    await supabase.insert('settings', { key: 'staffRegions', value });
  }
}

async function setUserRegions(userId, regions) {
  const settings = await getSettingsMap();
  const map = staffRegionsFromSettings(settings);
  map[String(userId)] = parseRegionList(regions);
  await saveStaffRegionsMap(map);
  return map[String(userId)];
}

async function removeUserRegions(userId) {
  const settings = await getSettingsMap();
  const map = staffRegionsFromSettings(settings);
  delete map[String(userId)];
  await saveStaffRegionsMap(map);
}

function buildProductDetails(body) {
  return {
    nameEn: String(body.nameEn || '').trim().slice(0, 180),
    descEn: String(body.descEn || '').trim().slice(0, 5000),
    specs: parseLines(body.specs),
    boxContents: parseLines(body.boxContents),
    colors: parseLines(body.colors),
    deliveryTime: String(body.deliveryTime || '').trim()
  };
}

function hasProductDetailsInput(body) {
  return ['nameEn', 'descEn', 'specs', 'boxContents', 'colors', 'deliveryTime'].some(key => Object.prototype.hasOwnProperty.call(body || {}, key));
}

function normalizeBrandText(value) {
  if (typeof value !== 'string') return value;
  return value;
}

function normalizeBrandValue(value) {
  if (typeof value === 'string') return normalizeBrandText(value);
  if (Array.isArray(value)) return value.map(normalizeBrandValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, normalizeBrandValue(nestedValue)]));
  }
  return value;
}

function normalizeBrandSettingRow(row) {
  return row ? { ...row, value: normalizeBrandValue(row.value) } : row;
}

async function getSettingsMap() {
  const rows = await supabase.select('settings', '');
  const settings = {};
  for (const row of rows || []) {
    settings[row.key] = normalizeBrandValue(row.value);
  }
  return settings;
}

function orderProductIds(order) {
  const items = typeof order?.items === 'string' ? JSON.parse(order.items || '[]') : (order?.items || []);
  return [...new Set((items || [])
    .map(item => String(item?.id || item?.product_id || '').replace(/[^\d]/g, ''))
    .filter(Boolean))];
}

async function productRegionsById(productIds) {
  const ids = [...new Set((productIds || []).map(id => String(id).replace(/[^\d]/g, '')).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await supabase.select('products', `?id=in.(${ids.join(',')})&select=id,product_details`);
  return new Map((rows || []).map(row => {
    const details = typeof row.product_details === 'string'
      ? JSON.parse(row.product_details || '{}')
      : (row.product_details || {});
    return [String(row.id), parseRegionList(details.locations)];
  }));
}

// Single shop: every staff member can see and prepare every order (no regions).
function orderMatchesRegions(_order, _productRegionMap, _allowedRegions) {
  return true;
}

async function filterOrdersForStaff(orders, _userId) {
  return arrayRows(orders);
}

async function canAccessOrderByRegion(order, userId, role) {
  if (isMainAdminRole(role)) return true;
  const subOrders = await subOrdersForOrder(order?.order_id || order?.id);
  if (subOrders.length) {
    const visible = await visibleSubOrdersForUser(subOrders, userId, role);
    return visible.length > 0;
  }
  if (order?.status === 'new') return false;
  const filtered = await filterOrdersForStaff([order], userId);
  return filtered.length > 0;
}

function arrayRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function isMissingRelationError(errorOrResult) {
  const text = [
    JSON.stringify(errorOrResult || {}),
    String(errorOrResult?.message || errorOrResult || '')
  ].join(' ').toLowerCase();
  return text.includes('could not find the table') ||
    text.includes('relation') && text.includes('does not exist') ||
    text.includes('schema cache') ||
    text.includes('pgrst205') ||
    text.includes('pgrst200');
}

async function safeSelectRows(table, filter = '') {
  const rows = await supabase.select(table, filter);
  if (Array.isArray(rows)) return rows;
  if (isMissingRelationError(rows)) return [];
  return [];
}

async function safeInsertRows(table, payload) {
  try {
    return await supabase.insert(table, payload);
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

async function safeUpdateRows(table, id, updates) {
  try {
    return await supabase.update(table, id, updates);
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

async function safeUpdateRowsBy(table, column, value, updates) {
  try {
    return await supabase.updateBy(table, column, value, updates);
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseJsonSetting(value, null);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

function orderItemSubtotal(item) {
  return Number(item?.price || 0) * Number(item?.qty || 1);
}

function orderItemsSubtotal(items) {
  return Number((arrayRows(items).reduce((sum, item) => sum + orderItemSubtotal(item), 0)).toFixed(3));
}

function money3(value) {
  return Number(Number(value || 0).toFixed(3));
}

function calculateServerOrderTotals(orderItems, settings, wilayat, delivery) {
  const subtotal = orderItemsSubtotal(orderItems);
  const deliveryCost = money3(deliveryCostForRegion(settings, wilayat, delivery || 'with'));
  const vatRate = Number(settings.vatRate ?? settings.vat_rate ?? 0) || 0;
  const vatAmount = money3(subtotal * (vatRate / 100));
  const total = money3(subtotal + deliveryCost + vatAmount);
  return { subtotal, deliveryCost, vatRate, vatAmount, total };
}

function isMoneyMismatch(left, right) {
  if (!Number.isFinite(Number(left)) || !Number.isFinite(Number(right))) return false;
  return Math.abs(Number(left) - Number(right)) > 0.01;
}

function omanMonthKey(value = new Date()) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Muscat',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(safeDate);
  const year = parts.find(part => part.type === 'year')?.value || String(safeDate.getUTCFullYear());
  const month = parts.find(part => part.type === 'month')?.value || String(safeDate.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function employeeEarningKey(employeeId, employeeName) {
  const id = String(employeeId || '').trim();
  if (id) return `user:${id}`;
  return `name:${regionKey(employeeName || 'غير محدد')}`;
}

function emptyEmployeeMonth(employeeId, employeeName, month) {
  return {
    employeeId: employeeId || null,
    employeeName: employeeName || 'غير محدد',
    month,
    orderCount: 0,
    subtotal: 0,
    commission: 0,
    averageCommissionRate: 0,
    _orders: new Set(),
    _rateTotal: 0,
    _rateCount: 0
  };
}

function addEmployeeEarning(map, entry) {
  const month = entry.month || omanMonthKey();
  const key = `${employeeEarningKey(entry.employeeId, entry.employeeName)}:${month}`;
  if (!map.has(key)) {
    map.set(key, emptyEmployeeMonth(entry.employeeId, entry.employeeName, month));
  }
  const row = map.get(key);
  if (!row.employeeId && entry.employeeId) row.employeeId = entry.employeeId;
  if ((!row.employeeName || row.employeeName === 'غير محدد') && entry.employeeName) row.employeeName = entry.employeeName;
  if (entry.orderId) row._orders.add(String(entry.orderId));
  row.subtotal += Number(entry.subtotal || 0);
  row.commission += Number(entry.commission || 0);
  const rate = Number(entry.commissionRate || 0);
  if (rate || entry.commissionRate === 0) {
    row._rateTotal += rate;
    row._rateCount += 1;
  }
}

function finalizeEmployeeEarningRows(map) {
  return [...map.values()]
    .map(row => ({
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      month: row.month,
      orderCount: row._orders.size || row.orderCount || 0,
      subtotal: Number(Number(row.subtotal || 0).toFixed(3)),
      commission: Number(Number(row.commission || 0).toFixed(3)),
      averageCommissionRate: row._rateCount ? Number((row._rateTotal / row._rateCount).toFixed(2)) : Number(row.averageCommissionRate || 0)
    }))
    .sort((a, b) => String(b.month).localeCompare(String(a.month)) || String(a.employeeName).localeCompare(String(b.employeeName)));
}

function buildEmployeeCommissionRows(financialOrders, financialSubOrders) {
  const rows = new Map();
  const orderById = new Map(arrayRows(financialOrders).map(order => [String(order.order_id || order.id), order]));
  const subOrderOrderIds = new Set();
  for (const subOrder of arrayRows(financialSubOrders)) {
    const employeeId = subOrder.assigned_user_id || '';
    const employeeName = subOrder.assigned_user_name || '';
    if (!employeeId && !employeeName) continue;
    const order = orderById.get(String(subOrder.order_id)) || {};
    subOrderOrderIds.add(String(subOrder.order_id));
    addEmployeeEarning(rows, {
      employeeId,
      employeeName,
      month: omanMonthKey(subOrder.prepared_at || subOrder.updated_at || order.created_at || order.updated_at),
      orderId: subOrder.order_id,
      subtotal: Number(subOrder.subtotal || orderItemsSubtotal(parseJsonArray(subOrder.items))),
      commission: Number(subOrder.commission_amount || 0),
      commissionRate: Number(subOrder.commission_rate || 0)
    });
  }
  for (const order of arrayRows(financialOrders)) {
    const orderId = String(order.order_id || order.id);
    if (subOrderOrderIds.has(orderId)) continue;
    const employeeId = order.prepared_by || '';
    const employeeName = order.prepared_by_name || '';
    if (!employeeId && !employeeName) continue;
    addEmployeeEarning(rows, {
      employeeId,
      employeeName,
      month: omanMonthKey(order.updated_at || order.created_at),
      orderId,
      subtotal: orderItemsSubtotal(parseJsonArray(order.items)),
      commission: Number(order.commission_amount || 0),
      commissionRate: Number(order.commission_rate || 0)
    });
  }
  return finalizeEmployeeEarningRows(rows);
}

function mergeMonthlyEmployeeRows(liveRows, reportRows) {
  const monthRows = new Map();
  for (const report of arrayRows(reportRows)) {
    const payload = typeof report.payload === 'string' ? parseJsonSetting(report.payload, {}) : (report.payload || {});
    if (!String(report.report_key || '').startsWith('employee_commissions_')) continue;
    const reportMonth = payload.month || String(report.report_key || '').replace('employee_commissions_', '');
    for (const employee of arrayRows(payload.employees)) {
      const month = employee.month || reportMonth;
      const key = `${employeeEarningKey(employee.employeeId, employee.employeeName)}:${month}`;
      if (monthRows.has(key)) continue;
      monthRows.set(key, {
        employeeId: employee.employeeId || null,
        employeeName: employee.employeeName || 'غير محدد',
        month,
        orderCount: Number(employee.orderCount || 0),
        subtotal: Number(employee.subtotal || 0),
        commission: Number(employee.commission || 0),
        averageCommissionRate: Number(employee.averageCommissionRate || 0)
      });
    }
  }
  for (const row of arrayRows(liveRows)) {
    monthRows.set(`${employeeEarningKey(row.employeeId, row.employeeName)}:${row.month}`, row);
  }

  const employees = new Map();
  for (const row of monthRows.values()) {
    const key = employeeEarningKey(row.employeeId, row.employeeName);
    if (!employees.has(key)) {
      employees.set(key, {
        employeeId: row.employeeId || null,
        employeeName: row.employeeName || 'غير محدد',
        totalOrders: 0,
        totalSubtotal: 0,
        totalCommission: 0,
        months: []
      });
    }
    const employee = employees.get(key);
    employee.months.push(row);
    employee.totalOrders += Number(row.orderCount || 0);
    employee.totalSubtotal += Number(row.subtotal || 0);
    employee.totalCommission += Number(row.commission || 0);
  }
  return [...employees.values()]
    .map(employee => ({
      ...employee,
      totalSubtotal: Number(employee.totalSubtotal.toFixed(3)),
      totalCommission: Number(employee.totalCommission.toFixed(3)),
      months: employee.months.sort((a, b) => String(b.month).localeCompare(String(a.month)))
    }))
    .sort((a, b) => b.totalCommission - a.totalCommission || String(a.employeeName).localeCompare(String(b.employeeName)));
}

async function saveEmployeeCommissionReport(month, employees) {
  const reportKey = `employee_commissions_${month}`;
  const payload = {
    month,
    generatedAt: new Date().toISOString(),
    employees: arrayRows(employees)
  };
  try {
    const existing = arrayRows(await safeSelectRows('accounting_reports', `?report_key=eq.${encodeURIComponent(reportKey)}&select=id`));
    if (existing[0]?.id) {
      await safeUpdateRows('accounting_reports', existing[0].id, {
        payload,
        updated_at: new Date().toISOString()
      });
    } else {
      await safeInsertRows('accounting_reports', { report_key: reportKey, payload });
    }
  } catch (error) {
    console.warn('Employee commission report save failed:', error.message);
  }
}

function productDetailsFromRow(product) {
  return typeof product?.product_details === 'string'
    ? parseJsonSetting(product.product_details, {})
    : (product?.product_details || {});
}

function productCandidateRegions(_product) {
  return [];
}

function orderItemProductId(item) {
  return String(item?.id || item?.product_id || '').replace(/[^\d]/g, '');
}

function regionGroupKey(regions) {
  const parsed = parseRegionList(regions);
  if (!parsed.length) return '__main_admin__';
  return parsed.map(regionKey).sort().join('|');
}

function publicRegionName(regions) {
  const parsed = parseRegionList(regions);
  return parsed.length ? parsed[0] : 'Meemz Cameo';
}

function enrichOrderItemsFromProducts(items, productMap) {
  return arrayRows(items).map(item => {
    const product = productMap.get(orderItemProductId(item));
    if (!product) return item;
    return {
      ...item,
      id: product.id || item.id,
      name: item.name || product.name,
      price: Number(product.price ?? item.price ?? 0),
      emoji: item.emoji || product.emoji || '📦',
      cat: item.cat || product.cat || product.category || ''
    };
  });
}

function buildSubOrderDrafts(orderRow, items, productMap) {
  const groups = new Map();
  for (const item of arrayRows(items)) {
    const product = productMap.get(orderItemProductId(item));
    const regions = productCandidateRegions(product);
    const key = regionGroupKey(regions);
    if (!groups.has(key)) {
      groups.set(key, {
        regions,
        items: [],
        subtotal: 0
      });
    }
    const group = groups.get(key);
    group.items.push(item);
    group.subtotal += orderItemSubtotal(item);
  }
  return [...groups.values()].map((group, index) => {
    const regions = parseRegionList(group.regions);
    return {
      order_id: orderRow.order_id,
      order_db_id: orderRow.id,
      sub_order_id: `${orderRow.order_id}-${index + 1}`,
      region: publicRegionName(regions),
      regions,
      items: group.items,
      subtotal: Number(group.subtotal.toFixed(3)),
      status: 'waiting_payment',
      internal_status: 'waiting_payment',
      is_shared: regions.length > 1,
      commission_rate: 0,
      commission_amount: 0
    };
  });
}

async function createSubOrdersForOrder(orderRow, items, productMap) {
  const drafts = buildSubOrderDrafts(orderRow, items, productMap);
  if (!drafts.length) return [];
  return arrayRows(await safeInsertRows('sub_orders', drafts));
}

function normalizeSubOrder(row, options = {}) {
  if (!row) return row;
  const items = sanitizeOrderItems(typeof row.items === 'string' ? JSON.parse(row.items || '[]') : (row.items || []));
  const hideFinancial = options.hideFinancial === true;
  const subOrder = {
    ...row,
    id: row.sub_order_id || row.id,
    dbId: row.id,
    items,
    regions: parseRegionList(row.regions || row.region),
    region: row.region || publicRegionName(row.regions),
    assignedUserId: row.assigned_user_id || null,
    assignedUserName: row.assigned_user_name || '',
    assignedRegion: row.assigned_region || '',
    subtotal: hideFinancial ? undefined : Number(row.subtotal || 0),
    status: row.status || 'waiting_payment',
    internalStatus: row.internal_status || row.status || 'waiting_payment',
    isShared: row.is_shared === true || row.is_shared === 'true',
    commissionRate: hideFinancial ? undefined : Number(row.commission_rate || 0),
    commissionAmount: hideFinancial ? undefined : Number(row.commission_amount || 0),
    cancellationRequestStatus: row.cancellation_request_status || '',
    cancellationRequestedByName: row.cancellation_requested_by_name || '',
    cancellationReason: row.cancellation_reason || ''
  };
  if (hideFinancial) {
    delete subOrder.commission_rate;
    delete subOrder.commission_amount;
    delete subOrder.subtotal;
  }
  return subOrder;
}

function subOrderRegions(subOrder) {
  return parseRegionList(subOrder?.regions || subOrder?.region);
}

function regionIntersects(a, b) {
  const bKeys = new Set(parseRegionList(b).map(regionKey));
  return parseRegionList(a).some(region => bKeys.has(regionKey(region)));
}

async function subOrdersForOrder(orderId) {
  const id = String(orderId || '').trim();
  if (!id) return [];
  return arrayRows(await safeSelectRows('sub_orders', `?order_id=eq.${encodeURIComponent(id)}&order=id.asc`));
}

async function loadSubOrdersForOrders(orderIds) {
  const ids = new Set((orderIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (!ids.size) return new Map();
  const rows = arrayRows(await safeSelectRows('sub_orders', '?order=id.asc'));
  const map = new Map();
  for (const row of rows) {
    if (!ids.has(String(row.order_id))) continue;
    if (!map.has(row.order_id)) map.set(row.order_id, []);
    map.get(row.order_id).push(row);
  }
  return map;
}

async function loadShipmentsForOrders(orderIds) {
  const ids = new Set((orderIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (!ids.size) return new Map();
  const rows = arrayRows(await safeSelectRows('internal_shipments', '?order=id.asc'));
  const map = new Map();
  for (const row of rows) {
    if (!ids.has(String(row.order_id))) continue;
    if (!map.has(row.order_id)) map.set(row.order_id, []);
    map.get(row.order_id).push({
      ...row,
      cost: Number(row.cost || 0)
    });
  }
  return map;
}

async function loadInternalNotesForOrders(orderIds) {
  const ids = new Set((orderIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (!ids.size) return new Map();
  const rows = arrayRows(await safeSelectRows('order_internal_notes', '?order=created_at.asc'));
  const map = new Map();
  for (const row of rows) {
    if (!ids.has(String(row.order_id))) continue;
    if (!map.has(row.order_id)) map.set(row.order_id, []);
    map.get(row.order_id).push(row);
  }
  return map;
}

async function visibleSubOrdersForUser(subOrders, _userId, _role) {
  return arrayRows(subOrders);
}

function staffCoordinationSummaries(subOrders) {
  return arrayRows(subOrders).map(subOrder => ({
    subOrderId: subOrder.sub_order_id,
    region: subOrder.region || publicRegionName(subOrder.regions),
    regions: parseRegionList(subOrder.regions || subOrder.region),
    status: subOrder.status || 'waiting_payment',
    internalStatus: subOrder.internal_status || subOrder.status || 'waiting_payment',
    assignedUserName: subOrder.assigned_user_name || ''
  }));
}

async function enrichOrdersForRole(rawOrders, role, userId) {
  const rows = arrayRows(rawOrders);
  const orderIds = rows.map(order => order.order_id || order.id).filter(Boolean);
  const [subOrderMap, shipmentMap, notesMap] = await Promise.all([
    loadSubOrdersForOrders(orderIds),
    isMainAdminRole(role) ? loadShipmentsForOrders(orderIds) : Promise.resolve(new Map()),
    isOrderStaffRole(role) ? loadInternalNotesForOrders(orderIds) : Promise.resolve(new Map())
  ]);
  const output = [];
  for (const order of rows) {
    const orderId = order.order_id || order.id;
    const subOrders = subOrderMap.get(orderId) || [];
    if (isOrderStaffRole(role) && !isMainAdminRole(role)) {
      if (!subOrders.length) {
        const legacyVisible = await filterOrdersForStaff([order], userId);
        if (!legacyVisible.length) continue;
        output.push(normalizeOrder(order));
        continue;
      }
      const visible = await visibleSubOrdersForUser(subOrders, userId, role);
      if (!visible.length) continue;
      const visibleItems = visible.flatMap(subOrder => parseJsonArray(subOrder.items));
      const normalized = normalizeOrder({ ...order, items: visibleItems });
      normalized.total = orderItemsSubtotal(visibleItems);
      normalized.deliveryCost = 0;
      normalized.vatAmount = 0;
      normalized.subOrders = visible.map(row => normalizeSubOrder(row, { hideFinancial: true }));
      normalized.coordination = staffCoordinationSummaries(subOrders);
      normalized.internalNotes = notesMap.get(orderId) || [];
      output.push(normalized);
      continue;
    }
    const normalized = normalizeOrder(order);
    if (isMainAdminRole(role)) {
      normalized.subOrders = subOrders.map(row => normalizeSubOrder(row));
      normalized.internalShipments = shipmentMap.get(orderId) || [];
      normalized.internalNotes = notesMap.get(orderId) || [];
      normalized.coordination = staffCoordinationSummaries(subOrders);
    }
    output.push(normalized);
  }
  return output;
}

function allowedRegionForStaffSubOrder(subOrder, allowedRegions) {
  const overlap = parseRegionList(subOrderRegions(subOrder)).filter(region => {
    return parseRegionList(allowedRegions).map(regionKey).includes(regionKey(region));
  });
  return overlap[0] || '';
}

async function updateOrderCommissionAggregate(orderId) {
  const subOrders = await subOrdersForOrder(orderId);
  const commissionTotal = Number(subOrders.reduce((sum, sub) => sum + Number(sub.commission_amount || 0), 0).toFixed(3));
  const firstPrepared = subOrders.find(sub => sub.assigned_user_id);
  const updates = {
    commission_amount: commissionTotal,
    commission_rate: firstPrepared ? Number(firstPrepared.commission_rate || 0) : 0
  };
  if (firstPrepared) {
    updates.prepared_by = firstPrepared.assigned_user_id;
    updates.prepared_by_name = firstPrepared.assigned_user_name || '';
  }
  await safeUpdateRowsBy('orders', 'order_id', orderId, updates);
}

async function insertInternalShipmentForSubOrder(order, subOrder, updates = {}) {
  const existing = await safeSelectRows('internal_shipments', `?sub_order_id=eq.${encodeURIComponent(subOrder.sub_order_id)}&select=*`);
  const payload = {
    order_id: order.order_id,
    sub_order_id: subOrder.sub_order_id,
    from_region: subOrder.assigned_region || subOrder.region || publicRegionName(subOrder.regions),
    from_user_id: subOrder.assigned_user_id || null,
    from_user_name: subOrder.assigned_user_name || '',
    collection_point: order.collection_point || '',
    status: updates.status || 'internal_shipment_sent',
    cost: Number(updates.cost || 0),
    sent_at: updates.sent_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (existing[0]) {
    return safeUpdateRows('internal_shipments', existing[0].id, payload);
  }
  return safeInsertRows('internal_shipments', payload);
}

function orderIsMultiRegion(_order, _subOrders) {
  return false;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function staffBrief(userId) {
  const rows = await supabase.select('users', `?id=eq.${encodeURIComponent(userId)}&select=id,name,email,role,commission_rate`);
  return arrayRows(rows)[0] || null;
}

async function normalizedOrderById(orderId, role, userId) {
  const rows = await supabase.select('orders', `?order_id=eq.${encodeURIComponent(orderId)}&select=*`);
  return (await enrichOrdersForRole(arrayRows(rows), role, userId))[0] || null;
}

async function updateSubOrderBySubId(subOrderId, updates) {
  return safeUpdateRowsBy('sub_orders', 'sub_order_id', subOrderId, {
    ...updates,
    updated_at: new Date().toISOString()
  });
}

async function updateSubOrdersForOrder(orderId, updates) {
  return safeUpdateRowsBy('sub_orders', 'order_id', orderId, {
    ...updates,
    updated_at: new Date().toISOString()
  });
}

async function orderSubOrderStatusUpdate(existingOrder, subOrders, status, req) {
  const orderId = existingOrder.order_id;
  const isMain = isMainAdminRole(req.session.userRole);
  const isMulti = orderIsMultiRegion(existingOrder, subOrders);
  const visible = isMain ? subOrders : await visibleSubOrdersForUser(subOrders, req.session.userId, req.session.userRole);
  if (!visible.length) throw httpError(403, 'Order is outside your assigned regions');

  if (status === 'payment_confirmed') {
    if (!isMain) throw httpError(403, 'Main admin only');
    await updateSubOrdersForOrder(orderId, {
      status: 'payment_confirmed',
      internal_status: isMulti ? 'waiting_for_internal_shipment' : 'payment_confirmed'
    });
    await safeUpdateRowsBy('orders', 'order_id', orderId, { status: 'payment_confirmed' });
    return { order: await normalizedOrderById(orderId, req.session.userRole, req.session.userId) };
  }

  if (status === 'cancelled') {
    if (!isMain) throw httpError(403, 'Employees can request cancellation only');
    await updateSubOrdersForOrder(orderId, {
      status: 'cancelled',
      internal_status: 'cancelled',
      cancellation_request_status: 'approved'
    });
    await safeUpdateRowsBy('orders', 'order_id', orderId, {
      status: 'cancelled',
      cancellation_request_status: 'approved'
    });
    return { order: await normalizedOrderById(orderId, req.session.userRole, req.session.userId) };
  }

  if (status === 'processing') {
    const staff = await staffBrief(req.session.userId);
    const settings = await getSettingsMap();
    const allowedRegions = userRegions({ id: req.session.userId }, staffRegionsFromSettings(settings));
    const claimable = visible.filter(subOrder => !subOrder.assigned_user_id || String(subOrder.assigned_user_id) === String(req.session.userId));
    if (!claimable.length) {
      return {
        alreadyPrepared: true,
        order: await normalizedOrderById(orderId, req.session.userRole, req.session.userId)
      };
    }
    for (const subOrder of claimable) {
      const rate = Number(staff?.commission_rate || 0);
      const subtotal = Number(subOrder.subtotal || orderItemsSubtotal(parseJsonArray(subOrder.items)));
      await updateSubOrderBySubId(subOrder.sub_order_id, {
        status: 'processing',
        internal_status: 'processing',
        assigned_user_id: req.session.userId,
        assigned_user_name: staff?.name || req.session.userEmail || '',
        assigned_region: subOrder.assigned_region || allowedRegionForStaffSubOrder(subOrder, allowedRegions),
        commission_rate: rate,
        commission_amount: Number((subtotal * rate / 100).toFixed(3)),
        prepared_at: new Date().toISOString()
      });
    }
    await safeUpdateRowsBy('orders', 'order_id', orderId, { status: 'processing' });
    await updateOrderCommissionAggregate(orderId);
    return { order: await normalizedOrderById(orderId, req.session.userRole, req.session.userId) };
  }

  if (status === 'shipped') {
    if (isMulti) {
      const staffOwned = isMain
        ? visible
        : visible.filter(subOrder => String(subOrder.assigned_user_id || '') === String(req.session.userId));
      if (!staffOwned.length) throw httpError(409, 'Prepare your part before shipping');
      for (const subOrder of staffOwned) {
        await updateSubOrderBySubId(subOrder.sub_order_id, {
          status: 'internal_shipment_sent',
          internal_status: 'internal_shipment_sent',
          sent_at: new Date().toISOString()
        });
        await insertInternalShipmentForSubOrder(existingOrder, {
          ...subOrder,
          assigned_user_id: subOrder.assigned_user_id || req.session.userId,
          assigned_user_name: subOrder.assigned_user_name || req.session.userName || req.session.userEmail || ''
        }, { status: 'internal_shipment_sent', sent_at: new Date().toISOString() });
      }
      await safeUpdateRowsBy('orders', 'order_id', orderId, { status: 'waiting_for_internal_shipment' });
      return { order: await normalizedOrderById(orderId, req.session.userRole, req.session.userId), suppressCustomerNotification: true };
    }
    await Promise.all(visible.map(subOrder => updateSubOrderBySubId(subOrder.sub_order_id, {
      status: 'shipped',
      internal_status: 'shipped',
      sent_at: new Date().toISOString()
    })));
    await safeUpdateRowsBy('orders', 'order_id', orderId, { status: 'shipped' });
    return { order: await normalizedOrderById(orderId, req.session.userRole, req.session.userId) };
  }

  if (status === 'internal_shipment_received') {
    if (!isMain) throw httpError(403, 'Main admin only');
    const subOrderId = String(req.body.subOrderId || '').trim();
    const targets = subOrderId ? subOrders.filter(subOrder => subOrder.sub_order_id === subOrderId) : subOrders.filter(subOrder => subOrder.status === 'internal_shipment_sent');
    for (const subOrder of targets) {
      await updateSubOrderBySubId(subOrder.sub_order_id, {
        status: 'internal_shipment_received',
        internal_status: 'internal_shipment_received',
        received_at: new Date().toISOString()
      });
      await safeUpdateRowsBy('internal_shipments', 'sub_order_id', subOrder.sub_order_id, {
        status: 'internal_shipment_received',
        received_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
    const latest = await subOrdersForOrder(orderId);
    const allReceived = latest.length && latest.every(subOrder => ['internal_shipment_received', 'ready_for_final_delivery', 'out_for_delivery', 'delivered', 'done'].includes(subOrder.status));
    await safeUpdateRowsBy('orders', 'order_id', orderId, {
      status: allReceived ? 'ready_for_final_delivery' : 'waiting_for_internal_shipment',
      final_delivery_status: allReceived ? 'ready_for_final_delivery' : existingOrder.final_delivery_status || ''
    });
    return { order: await normalizedOrderById(orderId, req.session.userRole, req.session.userId), suppressCustomerNotification: true };
  }

  if (['ready_for_final_delivery', 'out_for_delivery'].includes(status)) {
    if (!isMain) throw httpError(403, 'Main admin only');
    await safeUpdateRowsBy('orders', 'order_id', orderId, {
      status,
      final_delivery_status: status
    });
    return { order: await normalizedOrderById(orderId, req.session.userRole, req.session.userId) };
  }

  if (status === 'done' || status === 'delivered') {
    if (isMulti && !isMain) throw httpError(403, 'Main admin only');
    await updateSubOrdersForOrder(orderId, {
      status: 'delivered',
      internal_status: 'delivered',
      received_at: new Date().toISOString()
    });
    await safeUpdateRowsBy('orders', 'order_id', orderId, {
      status: 'delivered',
      final_delivery_status: 'delivered'
    });
    return { order: await normalizedOrderById(orderId, req.session.userRole, req.session.userId), notificationStatus: 'done' };
  }

  throw httpError(400, 'Unsupported order status');
}

function orderText(order) {
  const items = (order.items || [])
    .map(item => `${item.name || item.id} x ${item.qty || 1}`)
    .join(', ');
  return [
    `Order: ${order.order_id}`,
    `Customer: ${order.customer_name}`,
    `Phone: ${order.phone}`,
    `Address: ${order.wilayat} / ${order.area}`,
    `Items: ${items}`,
    order.gift_message ? `Gift message: ${order.gift_message}` : '',
    `Delivery: ${order.delivery}`,
    `Payment: ${order.payment}`,
    `Total: ${order.total}`
  ].filter(Boolean).join('\n');
}

function cleanPhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('968')) return digits;
  if (digits.length === 8) return `968${digits}`;
  return digits;
}

function omanLocalPhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (digits.startsWith('968') && digits.length === 11) return digits.slice(3);
  return digits.slice(-8);
}

function staffOrderWhatsAppText(order) {
  const items = (order.items || [])
    .map(item => `${item.name || item.id} × ${item.qty || 1}`)
    .join('، ');
  return [
    `طلب جديد من ميمز كاميو`,
    `رقم الطلب: ${order.order_id}`,
    `العميل: ${order.customer_name}`,
    `الهاتف: ${order.phone}`,
    `العنوان: ${order.wilayat} / ${order.area}`,
    `المنتجات: ${items}`,
    order.gift_message ? `رسالة الإهداء / التخصيص: ${order.gift_message}` : '',
    `الإجمالي: ${order.total} ر.ع`,
    `الحالة: جديد`
  ].filter(Boolean).join('\n');
}

function customerOrderWhatsAppText(order) {
  const items = (order.items || [])
    .map(item => `${item.name || item.id} × ${item.qty || 1}`)
    .join('، ');
  return [
    `مرحباً ${order.customer_name || ''} 👋`,
    `رقم الطلب: ${order.order_id}`,
    `طلبك وصل لنا، وبنجهزه بأسرع وقت ممكن.`,
    items ? `المنتجات: ${items}` : '',
    `الإجمالي: ${order.total} ر.ع`,
    'الحالة: بانتظار تأكيد التحويل',
    'سنراجع إيصال التحويل، وبعد التأكيد يبدأ تجهيز الطلب مباشرة.',
    'شكراً لثقتك بنا.'
  ].filter(Boolean).join('\n');
}

function customerStatusWhatsAppText(order, status) {
  const labels = {
    payment_confirmed: 'تم تأكيد التحويل ✅\nطلبك سيدخل مرحلة التجهيز الآن.',
    processing: 'طلبك قيد التجهيز حالياً ⚙️',
    ready_for_final_delivery: 'طلبك جاهز للتسليم النهائي ✅',
    out_for_delivery: 'طلبك خرج للتوصيل 🚚',
    delivered: 'تم تسليم طلبك ✅\nشكراً لاختيارك ميمز كاميو.',
    shipped: 'تم شحن طلبك 🚚\nسيتم التواصل معك للتسليم.',
    done: 'تم تسليم طلبك ✅\nشكراً لاختيارك ميمز كاميو.',
    cancelled: 'تم إلغاء الطلب. تواصل معنا إذا كنت تحتاج أي مساعدة.'
  };
  return [
    `تحديث طلبك من ميمز كاميو`,
    `رقم الطلب: ${order.order_id}`,
    labels[status] || `تم تحديث حالة الطلب إلى: ${status}`,
    status !== 'done' ? 'يمكنك متابعة الطلب من زر تتبع الطلب في الموقع.' : ''
  ].filter(Boolean).join('\n');
}

function whatsappPaymentLabel(order) {
  const value = String(order?.payment || '').toLowerCase();
  if (value.includes('bank') || value.includes('transfer')) return 'تحويل بنكي';
  return order?.payment || 'تحويل بنكي';
}

function whatsappStatusLabel(status, order = {}) {
  const labels = {
    new: 'جديد',
    payment_confirmed: 'تم تأكيد التحويل',
    processing: 'قيد التجهيز',
    waiting_for_internal_shipment: 'بانتظار الشحن الداخلي',
    internal_shipment_sent: 'تم إرسال الشحن الداخلي',
    internal_shipment_received: 'تم استلام الشحن الداخلي',
    ready_for_final_delivery: 'جاهز للتسليم النهائي',
    out_for_delivery: 'خرج للتوصيل',
    shipped: 'تم الشحن',
    delivered: 'تم التسليم',
    done: 'تم التسليم',
    cancelled: 'ملغي'
  };
  return labels[status] || order.statusLabel || status || 'تم تحديث الطلب';
}

function isMissingSupabaseColumn(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return text.includes('column') || text.includes('schema cache') || text.includes('could not find');
}

const SETTING_URL_KEYS = new Set([
  'instagramUrl',
  'tiktokUrl',
  'seoImage'
]);

function isSensitiveSettingKey(key = '') {
  return /(pass|password|secret|token|key|private|credential)/i.test(String(key || ''));
}

function redactSensitiveSettingRow(row) {
  if (!row || !isSensitiveSettingKey(row.key)) return row;
  return { ...row, value: row.value ? '[redacted]' : '' };
}

function sanitizeSettingValue(key, rawValue) {
  const value = rawValue == null ? '' : String(rawValue);
  if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(String(key || ''))) {
    throw new Error('Invalid setting key');
  }
  if (value.length > 60000) {
    throw new Error('Setting value is too large');
  }
  if (SETTING_URL_KEYS.has(key)) {
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
      const url = new URL(trimmed);
      return ['http:', 'https:'].includes(url.protocol) ? trimmed : '';
    } catch (_error) {
      return '';
    }
  }
  return value;
}

function removeMissingColumnsForRetry(error, payload, columns) {
  if (!isMissingSupabaseColumn(error)) return false;
  const text = String(error?.message || error || '').toLowerCase();
  for (const column of columns) {
    if (Object.prototype.hasOwnProperty.call(payload, column) && text.includes(column.toLowerCase())) {
      delete payload[column];
      return column;
    }
  }
  for (const column of columns) {
    if (Object.prototype.hasOwnProperty.call(payload, column)) {
      delete payload[column];
      return column;
    }
  }
  return false;
}

async function writeUserWithSchemaFallback(writeFn, payload) {
  const optionalColumns = ['phone', 'commission_rate'];
  while (true) {
    try {
      return await writeFn(payload);
    } catch (error) {
      const removed = removeMissingColumnsForRetry(error, payload, optionalColumns);
      if (!removed) throw error;
      console.warn(`Users ${removed} column is missing, retrying user write without it:`, error.message);
      if (!Object.keys(payload).length) return [];
    }
  }
}

async function writeOrderWithSchemaFallback(writeFn, payload) {
  const optionalColumns = [
    'gift_message',
    'is_multi_region',
    'collection_point',
    'collection_strategy',
    'final_delivery_status',
    'cancellation_request_status',
    'cancellation_requested_by',
    'cancellation_requested_by_name',
    'cancellation_reason',
    'shipping_actual_cost'
  ];
  while (true) {
    try {
      return await writeFn(payload);
    } catch (error) {
      const removed = removeMissingColumnsForRetry(error, payload, optionalColumns);
      if (!removed) throw error;
      console.warn(`Orders ${removed} column is missing, retrying order write without it:`, error.message);
      if (!Object.keys(payload).length) return [];
    }
  }
}

function reviewWhatsAppText(order) {
  const siteUrl = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  const reviewUrl = `${siteUrl}/#review=${encodeURIComponent(order.order_id)}&phone=${encodeURIComponent(order.phone || '')}`;
  return [
    `مرحباً ${order.customer_name || ''}، نتمنى تكون تجربتك مع ميمز كاميو كانت جميلة.`,
    `طلبك رقم ${order.order_id} تم تسليمه.`,
    'قيّم المنتج بالنجوم واكتب تعليقك، رأيك يساعدنا نحسن التجربة:',
    reviewUrl
  ].join('\n');
}

function firstEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function firstEnvOrDefault(defaultValue, ...names) {
  return firstEnv(...names) || defaultValue;
}

function whatsappTotal(order) {
  return Number(order?.total || 0).toFixed(3);
}

function namedTemplateParams(names, values) {
  return names.map((name, index) => ({
    name,
    value: String(values[index] ?? '').slice(0, 900)
  }));
}

function whatsappTemplateConfig(type, order = {}, statusText = '') {
  const templateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'ar';
  const reviewUrl = `${String(process.env.PUBLIC_URL || '').replace(/\/+$/, '')}/#review=${encodeURIComponent(order.order_id)}&phone=${encodeURIComponent(order.phone || '')}`;
  const configs = {
    staff_order: {
      name: firstEnvOrDefault('meemz_staff_new_order', 'WHATSAPP_STAFF_ORDER_TEMPLATE', 'WHATSAPP_NEW_ORDER_TEMPLATE', 'META_WHATSAPP_NEW_ORDER_TEMPLATE'),
      params: namedTemplateParams(
        ['order_id', 'customer_name', 'customer_phone', 'order_total', 'payment_method'],
        [order.order_id, order.customer_name, order.phone || '', whatsappTotal(order), whatsappPaymentLabel(order)]
      )
    },
    customer_order: {
      name: firstEnvOrDefault('meemz_order_confirmed', 'WHATSAPP_CUSTOMER_ORDER_TEMPLATE', 'WHATSAPP_NEW_ORDER_TEMPLATE', 'META_WHATSAPP_NEW_ORDER_TEMPLATE'),
      params: namedTemplateParams(
        ['customer_name', 'order_id', 'order_total'],
        [order.customer_name || '', order.order_id, whatsappTotal(order)]
      )
    },
    customer_status: {
      name: firstEnvOrDefault('meemz_order_status', 'WHATSAPP_CUSTOMER_STATUS_TEMPLATE', 'WHATSAPP_STATUS_TEMPLATE'),
      params: namedTemplateParams(
        ['customer_name', 'order_id', 'order_status'],
        [order.customer_name || '', order.order_id, whatsappStatusLabel(statusText, order)]
      )
    },
    review: {
      name: firstEnvOrDefault('meemz_review_request', 'WHATSAPP_REVIEW_TEMPLATE', 'WHATSAPP_CUSTOMER_REVIEW_TEMPLATE'),
      params: namedTemplateParams(
        ['customer_name', 'review_url'],
        [order.customer_name || '', reviewUrl]
      )
    }
  };
  const config = configs[type] || {};
  return {
    templateName: config.name || '',
    templateLanguage,
    params: config.params || [],
    requireTemplate: true
  };
}

async function sendWhatsAppText(to, text, options = {}) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || 'v20.0';
  const templateName = options.templateName || '';
  const templateLanguage = options.templateLanguage || process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'ar';
  const params = Array.isArray(options.params) ? options.params : [];
  const recipient = cleanPhone(to);
  if (!token) throw new Error('WHATSAPP_ACCESS_TOKEN is not configured');
  if (!phoneNumberId) throw new Error('WHATSAPP_PHONE_NUMBER_ID is not configured');
  if (!recipient) throw new Error('WhatsApp recipient phone is missing or invalid');
  if (options.requireTemplate && !templateName) throw new Error('WhatsApp template name is not configured');
  const payload = templateName
    ? {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: templateName,
          language: { code: templateLanguage },
          ...(params.length ? {
            components: [{
              type: 'body',
              parameters: params.map(param => {
                if (param && typeof param === 'object' && param.name) {
                  return {
                    type: 'text',
                    parameter_name: String(param.name),
                    text: String(param.value || '')
                  };
                }
                return { type: 'text', text: String(param || '') };
              })
            }]
          } : {})
        }
      }
    : {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: {
          preview_url: false,
          body: text
        }
      };

  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${body}`);
  }
  const result = await response.json().catch(() => ({}));
  const messageId = result?.messages?.[0]?.id || '';
  if (messageId) {
    recordWhatsAppEvent({
      message_id: messageId,
      recipient,
      event_type: 'send',
      status: 'accepted',
      error_code: '',
      error_title: '',
      error_message: '',
      payload: {
        template: templateName || '',
        language: templateLanguage,
        graphVersion,
        phoneNumberId: maskIdentifier(phoneNumberId)
      }
    }).catch(error => {
      console.warn('[WhatsApp] Could not record accepted send event:', safeExternalErrorMessage(error));
    });
  }
  return {
    success: true,
    to: recipient,
    template: templateName || '',
    messageId
  };
}

function safeExternalErrorMessage(error) {
  return String(error?.message || error || '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [hidden]')
    .replace(/access_token=[^&\s"]+/g, 'access_token=[hidden]')
    .slice(0, 1200);
}

function maskIdentifier(value = '') {
  const text = String(value || '');
  if (text.length <= 6) return text ? '[set]' : '';
  return `${text.slice(0, 3)}...${text.slice(-3)}`;
}

function maskPhoneForAdmin(value = '') {
  const digits = cleanPhone(value);
  if (!digits) return '';
  return digits.replace(/^(\d{3})\d+(\d{2})$/, '$1******$2');
}

function whatsappEventError(status = {}) {
  const error = arrayRows(status.errors)[0] || {};
  return {
    error_code: String(error.code || ''),
    error_title: String(error.title || error.type || ''),
    error_message: String(error.message || error.error_data?.details || '')
  };
}

function collectWhatsAppWebhookEvents(payload = {}) {
  const events = [];
  for (const entry of arrayRows(payload.entry)) {
    for (const change of arrayRows(entry.changes)) {
      const value = change?.value || {};
      for (const status of arrayRows(value.statuses)) {
        const errorInfo = whatsappEventError(status);
        events.push({
          message_id: String(status.id || ''),
          recipient: cleanPhone(status.recipient_id || ''),
          event_type: 'status',
          status: String(status.status || ''),
          error_code: errorInfo.error_code,
          error_title: errorInfo.error_title,
          error_message: errorInfo.error_message,
          payload: { status, field: change?.field || '', product: value.messaging_product || '' }
        });
      }

      for (const message of arrayRows(value.messages)) {
        events.push({
          message_id: String(message.id || ''),
          recipient: cleanPhone(message.from || value.contacts?.[0]?.wa_id || ''),
          event_type: 'incoming_message',
          status: String(message.type || 'received'),
          error_code: '',
          error_title: '',
          error_message: '',
          payload: { message, contacts: value.contacts || [], field: change?.field || '' }
        });
      }
    }
  }
  return events;
}

function rememberWhatsAppEvent(event) {
  const row = {
    id: `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    ...event
  };
  recentWhatsAppEvents.unshift(row);
  if (recentWhatsAppEvents.length > 100) recentWhatsAppEvents.length = 100;
  return row;
}

async function recordWhatsAppEvent(event) {
  const row = rememberWhatsAppEvent(event);
  try {
    await safeInsertRows('whatsapp_events', {
      message_id: row.message_id,
      recipient: row.recipient,
      event_type: row.event_type,
      status: row.status,
      error_code: row.error_code,
      error_title: row.error_title,
      error_message: row.error_message,
      payload: row.payload || {}
    });
  } catch (error) {
    console.warn('[WhatsApp] Could not persist webhook event:', safeExternalErrorMessage(error));
  }
  if (row.status === 'failed' || row.error_code || row.error_message) {
    console.warn('[WhatsApp] Delivery event:', {
      message_id: row.message_id,
      recipient: maskPhoneForAdmin(row.recipient),
      status: row.status,
      error_code: row.error_code,
      error_title: row.error_title,
      error_message: row.error_message
    });
  }
  return row;
}

function sanitizeWhatsAppEvent(row = {}) {
  return {
    id: row.id,
    messageId: row.message_id || row.messageId || '',
    recipient: maskPhoneForAdmin(row.recipient || ''),
    eventType: row.event_type || row.eventType || '',
    status: row.status || '',
    errorCode: row.error_code || row.errorCode || '',
    errorTitle: row.error_title || row.errorTitle || '',
    errorMessage: row.error_message || row.errorMessage || '',
    createdAt: row.created_at || row.createdAt || ''
  };
}

function publicErrorMessage(error, fallback = 'Request failed. Please try again.') {
  const statusCode = Number(error?.statusCode || 500);
  const message = String(error?.message || '').trim();
  const sensitive = /(supabase|schema cache|column|relation|database|postgres|secret|token|bearer|apikey|storage bucket)/i.test(message);
  if (statusCode < 500 && message && !sensitive) return message;
  return fallback;
}

async function notifyStaffWhatsApp(order, options = {}) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return false;
  const includeMain = options.includeMain !== false;
  const includeRegional = options.includeRegional !== false;

  const [staff, settings] = await Promise.all([
    supabase.select('users', '?select=*&order=id.asc'),
    getSettingsMap()
  ]);
  const staffRegionsMap = staffRegionsFromSettings(settings);
  const productRegionMap = await productRegionsById(orderProductIds(order));
  const recipients = [...new Set((staff || [])
    .filter(user => {
      if (!['admin', 'moderator', 'employee'].includes(user.role)) return false;
      if (isMainAdminRole(user.role)) return includeMain;
      return includeRegional && orderMatchesRegions(order, productRegionMap, userRegions(user, staffRegionsMap));
    })
    .map(user => cleanPhone(user.phone))
    .filter(Boolean))];
  if (!recipients.length) return false;

  const text = staffOrderWhatsAppText(order);
  const templateOptions = whatsappTemplateConfig('staff_order', order);
  const results = await Promise.allSettled(recipients.map(phone => sendWhatsAppText(phone, text, templateOptions)));
  results
    .filter(result => result.status === 'rejected')
    .forEach(result => console.warn('Staff WhatsApp notification failed:', result.reason?.message || result.reason));
  return results.some(result => result.status === 'fulfilled');
}

async function notifyNewOrder(order) {
  let sent = false;
  try {
    const settings = await getSettingsMap();
    if (settings.smtp_host && settings.smtp_user && settings.notifyEmail) {
      const transporter = nodemailer.createTransport({
        host: settings.smtp_host,
        port: Number(settings.smtp_port || 587),
        secure: Number(settings.smtp_port || 587) === 465,
        auth: {
          user: settings.smtp_user,
          pass: settings.smtp_pass || process.env.SMTP_PASS || ''
        }
      });

      await transporter.sendMail({
        from: settings.smtp_from || settings.smtp_user,
        to: settings.notifyEmail,
        subject: `New Meemz Cameo order ${order.order_id}`,
        text: orderText(order),
        disableFileAccess: true,
        disableUrlAccess: true
      });
      sent = true;
    }
  } catch (error) {
    console.warn('Order email notification failed:', error.message);
  }

  try {
    sent = await notifyStaffWhatsApp(order, { includeRegional: false }) || sent;
  } catch (error) {
    console.warn('Order WhatsApp notification failed:', error.message);
  }

  try {
    sent = await sendWhatsAppText(order.phone, customerOrderWhatsAppText(order), whatsappTemplateConfig('customer_order', order)) || sent;
  } catch (error) {
    console.warn('Customer WhatsApp notification failed:', error.message);
  }

  return sent;
}

function isPasswordMatch(password, storedPassword) {
  if (!storedPassword) return false;
  if (storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2y$')) {
    return bcrypt.compareSync(password, storedPassword);
  }
  return storedPassword === password;
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase().slice(0, 254);
}

function validEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function passwordResetTokenHash(token = '') {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

async function sendPasswordResetEmail(email, token) {
  const settings = await getSettingsMap();
  if (!settings.smtp_host || !settings.smtp_user) return false;
  const siteUrl = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  const resetUrl = `${siteUrl}/reset-password.html?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  const transporter = nodemailer.createTransport({
    host: settings.smtp_host,
    port: Number(settings.smtp_port || 587),
    secure: Number(settings.smtp_port || 587) === 465,
    auth: {
      user: settings.smtp_user,
      pass: settings.smtp_pass || process.env.SMTP_PASS || ''
    }
  });

  await transporter.sendMail({
    from: settings.smtp_from || settings.smtp_user,
    to: email,
    subject: 'Reset your Meemz Cameo password',
    text: [
      'Use this link to reset your Meemz Cameo password.',
      resetUrl,
      'This link expires in one hour. If you did not request it, ignore this message.'
    ].join('\n\n'),
    disableFileAccess: true,
    disableUrlAccess: true
  });
  return true;
}

// ============ LOGIN / LOGOUT ============

router.post('/password-reset-request', authLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!validEmail(email)) {
      return res.json({ success: true, ok: true });
    }

    const users = await supabase.select('users', `?email=eq.${encodeURIComponent(email)}&select=id,email`);
    const user = users && users[0];
    if (user) {
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = passwordResetTokenHash(token);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await supabase.deleteBy('password_resets', 'email', email).catch(error => {
        console.warn('Password reset cleanup failed:', error.message);
      });
      await supabase.insert('password_resets', {
        email,
        token: tokenHash,
        expires_at: expiresAt
      });
      await sendPasswordResetEmail(email, token).catch(error => {
        console.warn('Password reset email failed:', error.message);
      });
    }

    res.json({ success: true, ok: true });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.json({ success: true, ok: true });
  }
});

router.post('/password-reset', authLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const token = String(req.body.token || '').trim();
    const password = String(req.body.password || '');
    if (!validEmail(email) || token.length < 20 || password.length < 8 || password.length > 128) {
      return res.status(400).json({ success: false, error: 'Invalid reset request' });
    }

    const tokenHash = passwordResetTokenHash(token);
    const resetRows = await supabase.select('password_resets', `?token=eq.${encodeURIComponent(tokenHash)}&email=eq.${encodeURIComponent(email)}`);
    const reset = resetRows && resetRows[0];
    if (!reset || new Date(reset.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ success: false, error: 'Reset link is invalid or expired' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    await supabase.updateBy('users', 'email', email, { password: passwordHash });
    await supabase.deleteBy('password_resets', 'token', tokenHash).catch(error => {
      console.warn('Password reset token cleanup failed:', error.message);
    });
    res.json({ success: true, ok: true });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ success: false, error: 'Could not reset password' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    // Get user from Supabase
    const users = await supabase.select('users', `?email=eq.${encodeURIComponent(email)}`);

    if (!users || users.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const user = users[0];
    
    if (!isPasswordMatch(password, user.password)) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Set session
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.userRole = user.role;
    req.session.userName = user.name || '';

    res.json({ 
      success: true, 
      ok: true,
      name: user.name,
      role: user.role,
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name, 
        role: user.role 
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

router.get('/me', (req, res) => {
  if (!isDashboardRole(req.session.userRole)) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    success: true,
    user: {
      id: req.session.userId,
      email: req.session.userEmail,
      name: req.session.userName || '',
      role: req.session.userRole
    }
  });
});

router.get('/admin-page', (req, res) => {
  if (!isDashboardRole(req.session.userRole)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.resolve(process.cwd(), 'private/admin-page.html'));
});

// ============ STAFF USERS ============

router.get('/users', async (req, res) => {
  try {
    if (!isAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const [users, settings] = await Promise.all([
      supabase.select('users', '?select=*&order=id.asc'),
      getSettingsMap()
    ]);
    const staffRegionsMap = staffRegionsFromSettings(settings);
    res.json({ success: true, users: (users || []).map(user => ({
      ...user,
      regions: userRegions(user, staffRegionsMap),
      commissionRate: Number(user.commission_rate || 0)
    })), regionOptions: regionOptionsFromSettings(settings) });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    if (!isAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const email = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim();
    const phone = omanLocalPhone(req.body.phone || '');
    const password = String(req.body.password || '');
    const role = ['admin', 'moderator', 'employee'].includes(req.body.role) ? req.body.role : 'employee';
    const requestedRegions = parseRegionList(req.body.regions);
    const commissionRate = isMainAdminRole(req.session.userRole)
      ? Math.max(0, Math.min(100, Number(req.body.commissionRate || req.body.commission_rate || 0)))
      : 0;

    if (!email || !name || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 128 || name.length > 120) {
      return res.status(400).json({ success: false, error: 'Invalid staff details' });
    }
    if (phone && phone.length !== 8) {
      return res.status(400).json({ success: false, error: 'Phone must be an 8-digit Oman number' });
    }

    const existing = await supabase.select('users', `?email=eq.${encodeURIComponent(email)}&select=id`);
    if (existing && existing.length) {
      return res.status(409).json({ success: false, error: 'Email already exists' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const insertPayload = {
      email,
      name,
      phone,
      role,
      password: passwordHash
    };
    if (isMainAdminRole(req.session.userRole)) {
      insertPayload.commission_rate = commissionRate;
    }
    const savedPayload = { ...insertPayload };
    const inserted = await writeUserWithSchemaFallback(
      payload => supabase.insert('users', payload),
      insertPayload
    );
    const user = inserted && inserted[0];
    const regions = user && isMainAdminRole(req.session.userRole)
      ? await setUserRegions(user.id, requestedRegions)
      : [];
    res.json({
      success: true,
      ok: true,
      user: user ? { id: user.id, email: user.email, name: user.name, phone: user.phone || savedPayload.phone || '', role: user.role, regions, commissionRate: Number(user.commission_rate || 0), created_at: user.created_at } : null
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ success: false, error: publicErrorMessage(error, 'Could not save staff account. Please try again.') });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    if (!isAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const { id } = req.params;
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
      updates.name = String(req.body.name || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'phone')) {
      updates.phone = omanLocalPhone(req.body.phone || '');
      if (updates.phone && updates.phone.length !== 8) {
        return res.status(400).json({ success: false, error: 'Phone must be an 8-digit Oman number' });
      }
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'role')) {
      const role = String(req.body.role || '').trim();
      if (['admin', 'moderator', 'employee'].includes(role)) updates.role = role;
    }
    let savedRegions;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'regions')) {
      if (!isMainAdminRole(req.session.userRole)) {
        return res.status(403).json({ success: false, error: 'Main admin only can update regions' });
      }
      savedRegions = await setUserRegions(id, req.body.regions);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'commissionRate') || Object.prototype.hasOwnProperty.call(req.body || {}, 'commission_rate')) {
      if (!isMainAdminRole(req.session.userRole)) {
        return res.status(403).json({ success: false, error: 'Main admin only can update commission' });
      }
      updates.commission_rate = Math.max(0, Math.min(100, Number(req.body.commissionRate ?? req.body.commission_rate ?? 0)));
    }

    if (!Object.keys(updates).length && savedRegions === undefined) {
      return res.status(400).json({ success: false, error: 'No updates provided' });
    }

    const savedUpdates = { ...updates };
    const result = Object.keys(updates).length
      ? await writeUserWithSchemaFallback(
          payload => supabase.update('users', id, payload),
          updates
        )
      : await supabase.select('users', `?id=eq.${encodeURIComponent(id)}&select=*`);
    const user = result && result[0];
    res.json({
      success: true,
      ok: true,
      user: user ? { ...user, phone: user.phone || savedUpdates.phone || '', regions: savedRegions ?? parseRegionList(user.regions) } : user
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, error: publicErrorMessage(error, 'Could not update staff account. Please try again.') });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    if (!isAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const { id } = req.params;
    if (String(id) === String(req.session.userId)) {
      return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
    }

    const rows = await supabase.select('users', `?id=eq.${encodeURIComponent(id)}&select=id,role`);
    const user = rows && rows[0];
    if (user?.role === 'admin') {
      return res.status(400).json({ success: false, error: 'Cannot delete admin account' });
    }

    await supabase.delete('users', id);
    await removeUserRegions(id);
    res.json({ success: true, ok: true });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, error: publicErrorMessage(error, 'Could not delete staff account. Please try again.') });
  }
});

// ============ PRODUCTS ============

router.get('/products', async (req, res) => {
  try {
    const category = req.query.category;
    const isStaff = isProductStaffRole(req.session?.userRole);
    const filters = [];
    if (category) {
      filters.push(`category=eq.${encodeURIComponent(category)}`);
    }
    if (!isStaff) filters.push('is_active=eq.true');

    const filter = filters.length ? `?${filters.join('&')}` : '';
    const products = await supabase.select('products', filter);
    res.json({ success: true, products: (products || []).map(product => normalizeProduct(product, { includeInternal: isStaff })) });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ success: false, error: 'Could not load products. Please try again.' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const [products, doneOrders] = await Promise.all([
      supabase.select('products', '?is_active=eq.true&select=id'),
      supabase.select('orders', '?status=eq.done&select=phone')
    ]);
    const productCount = Array.isArray(products) ? products.length : 0;
    const customerCount = new Set((doneOrders || []).map(order => omanLocalPhone(order.phone || '')).filter(Boolean)).size;
    res.json({ success: true, productCount, customerCount });
  } catch (error) {
    console.error('Get public stats error:', error);
    res.status(500).json({ success: false, error: 'Could not load store stats. Please try again.' });
  }
});

router.post('/products', upload.array('images', 8), async (req, res) => {
  try {
    if (!isProductStaffRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Product staff only' });
    }

    const { name, description, price, category, cat, stock, oldPrice, emoji, badge, desc, isActive, is_active } = req.body;
    const parsedPrice = Number(price);
    
    if (!name || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ success: false, error: 'Name and price required' });
    }
    if (String(name).length > 180 || String(description || desc || '').length > 5000) {
      return res.status(400).json({ success: false, error: 'Product text is too long' });
    }

    const [images, settings] = await Promise.all([
      Promise.all((req.files || []).map(file => saveImageBuffer(file))),
      getSettingsMap()
    ]);
    const product = {
      name,
      description: description || desc || '',
      price: parsedPrice,
      category: category || cat || '',
      cat: cat || category || '',
      emoji: emoji || '📦',
      oldPrice: oldPrice ? parseFloat(oldPrice) : null,
      badge: badge || null,
      badgeType: badge === 'جديد' ? 'badge-new' : badge === 'خصم' ? 'badge-sale' : badge === 'ساخن' ? 'badge-hot' : '',
      rating: 5,
      reviews: 0,
      desc: desc || description || '',
      stock: Math.max(0, parseInt(stock) || 0),
      product_details: buildProductDetails(req.body),
      image_url: images[0] || null,
      images,
      is_active: isActive !== 'false' && is_active !== 'false'
    };

    const result = await supabase.insert('products', product);
    res.json({ success: true, ok: true, product: normalizeProduct(result[0], { includeInternal: true }) });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/products/:id', upload.array('images', 8), async (req, res) => {
  try {
    if (!isProductStaffRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Product staff only' });
    }

    const { id } = req.params;
    const { name, description, price, category, cat, stock, oldPrice, emoji, badge, desc, isActive, is_active } = req.body;

    const updates = {};
    if (name) updates.name = name;
    if (description) updates.description = description;
    if (desc) updates.desc = desc;
    if (price) updates.price = parseFloat(price);
    if (category || cat) {
      updates.category = category || cat;
      updates.cat = cat || category;
    }
    if (stock !== undefined) updates.stock = parseInt(stock) || 0;
    if (oldPrice !== undefined) updates.oldPrice = oldPrice ? parseFloat(oldPrice) : null;
    if (emoji) updates.emoji = emoji;
    if (badge !== undefined) {
      updates.badge = badge || null;
      updates.badgeType = badge === 'جديد' ? 'badge-new' : badge === 'خصم' ? 'badge-sale' : badge === 'ساخن' ? 'badge-hot' : '';
    }

    if (isActive !== undefined || is_active !== undefined) {
      updates.is_active = isActive !== 'false' && is_active !== 'false';
    }

    const detailsNeeded = hasProductDetailsInput(req.body);
    const [images, settings] = await Promise.all([
      req.files && req.files.length ? Promise.all(req.files.map(file => saveImageBuffer(file))) : Promise.resolve([]),
      detailsNeeded ? getSettingsMap() : Promise.resolve(null)
    ]);

    if (images.length) {
      updates.image_url = images[0];
      updates.images = images;
    }

    if (detailsNeeded) {
      updates.product_details = buildProductDetails(req.body);
    }

    const result = await supabase.update('products', id, updates);
    res.json({ success: true, ok: true, product: normalizeProduct(result[0], { includeInternal: true }) });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    if (!isAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const { id } = req.params;
    await supabase.delete('products', id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ IMAGE UPLOADS ============

router.post('/uploads/image', upload.single('image'), async (req, res) => {
  try {
    if (!isAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Image file is required' });
    }

    const url = await saveImageBuffer(req.file);
    res.json({ success: true, ok: true, url });
  } catch (error) {
    console.error('Upload image error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ ORDERS ============

router.get('/orders', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const status = req.query.status;
    
    let filter = isOrderStaffRole(req.session.userRole)
      ? '?order=id.desc'
      : `?user_id=eq.${req.session.userId}&order=id.desc`;
    if (isOrderStaffRole(req.session.userRole) && !isMainAdminRole(req.session.userRole)) {
      filter += '&status=neq.new';
    }
    if (status) {
      filter += `&status=eq.${encodeURIComponent(status)}`;
    }

    let orders = await supabase.select('orders', filter);
    if (isOrderStaffRole(req.session.userRole) && !isMainAdminRole(req.session.userRole)) {
      const subOrderMap = await loadSubOrdersForOrders(arrayRows(orders).map(order => order.order_id || order.id));
      const hasSubOrders = [...subOrderMap.values()].some(rows => rows.length);
      if (!hasSubOrders) {
        orders = await filterOrdersForStaff(orders || [], req.session.userId);
      }
    }
    const normalizedOrders = await enrichOrdersForRole(dedupeOrders(orders || []), req.session.userRole, req.session.userId);
    res.json({ success: true, orders: normalizedOrders });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/orders', orderLimiter, receiptUpload.single('proof'), async (req, res) => {
  let submissionKey = '';
  try {
    const { name, wilayat, area, phone, items, delivery, deliveryCost, vatRate, vatAmount, total, totalPrice, payment, clientOrderKey } = req.body;

    if (!name || !wilayat || !area || !phone || !items) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Payment receipt is required' });
    }
    const customerPhone = omanLocalPhone(phone);
    if (customerPhone.length !== 8) {
      return res.status(400).json({ success: false, error: 'Phone must be an 8-digit Oman number' });
    }

    const rawOrderItems = sanitizeOrderItems(Array.isArray(items) ? items : JSON.parse(items || '[]'));
    const productIds = [...new Set(rawOrderItems.map(orderItemProductId).filter(Boolean))];
    const productRows = productIds.length
      ? await supabase.select('products', `?id=in.(${productIds.join(',')})&select=*`)
      : [];
    const productMap = new Map(arrayRows(productRows).map(product => [String(product.id), product]));
    const orderItems = enrichOrderItemsFromProducts(rawOrderItems, productMap);
    const settingsMap = await getSettingsMap();
    const serverTotals = calculateServerOrderTotals(orderItems, settingsMap, wilayat, delivery || 'with');
    const clientTotal = parseFloat(total ?? totalPrice);
    if (
      isMoneyMismatch(clientTotal, serverTotals.total) ||
      isMoneyMismatch(parseFloat(deliveryCost), serverTotals.deliveryCost) ||
      isMoneyMismatch(parseFloat(vatAmount), serverTotals.vatAmount) ||
      isMoneyMismatch(parseFloat(vatRate), serverTotals.vatRate)
    ) {
      return res.status(409).json({ success: false, error: 'Order totals changed. Please refresh checkout and try again.' });
    }
    const orderTotal = serverTotals.total;
    submissionKey = orderSubmissionKey({
      clientOrderKey,
      phone: customerPhone,
      items: orderItems,
      total: orderTotal,
      payment: payment || 'bank_transfer',
      file: req.file
    });
    cleanupRecentOrderSubmissions();
    const existingSubmission = recentOrderSubmissions.get(submissionKey);
    if (existingSubmission && existingSubmission.expiresAt > Date.now()) {
      const existing = await existingSubmission.promise;
      return res.json({
        success: true,
        ok: true,
        duplicate: true,
        orderId: existing.orderId,
        order: existing.order
      });
    }

    const createOrderPromise = (async () => {
      for (const item of orderItems) {
        const productId = item.id;
        const qty = Number(item.qty || 1);
        if (!productId || qty <= 0) continue;
        const product = productMap.get(String(productId));
        if (!product) continue;
        const stock = Number(product.stock || 0);
        if (stock > 0 && qty > stock) {
          const error = new Error(`${product.name} is out of stock`);
          error.statusCode = 409;
          throw error;
        }
      }

      const proofUrl = await saveReceiptBuffer(req.file);
      const orderId = createOrderId();
      const giftMessage = String(req.body.giftMessage || '').trim().slice(0, 500);
      const order = {
        user_id: req.session.userId || null,
        order_id: orderId,
        customer_name: name,
        wilayat,
        area,
        phone: customerPhone,
        items: orderItems,
        delivery: delivery || 'without',
        deliveryCost: serverTotals.deliveryCost,
        vatRate: serverTotals.vatRate,
        vatAmount: serverTotals.vatAmount,
        total: orderTotal,
        status: 'new',
        payment: payment || 'bank_transfer',
        proof: proofUrl,
        gift_message: giftMessage,
        collection_strategy: 'manual',
        shipping_actual_cost: 0
      };

      const result = await writeOrderWithSchemaFallback(
        payload => supabase.insert('orders', payload),
        order
      );
      if (!result || !result[0]) {
        throw new Error('Order was not saved');
      }
      await createSubOrdersForOrder(result[0], orderItems, productMap);
      for (const item of orderItems) {
        const productId = item.id;
        const qty = Number(item.qty || 1);
        if (!productId || qty <= 0) continue;
        const product = productMap.get(String(productId));
        if (!product) continue;
        const stock = Number(product.stock || 0);
        if (stock > 0) {
          await supabase.update('products', productId, { stock: Math.max(0, stock - qty) });
        }
      }
      notifyNewOrder(result[0]).catch(error => console.warn('Order notification failed:', error.message));
      const normalized = normalizeOrder(result[0]);
      return { orderId, order: normalized };
    })();

    recentOrderSubmissions.set(submissionKey, {
      promise: createOrderPromise,
      expiresAt: Date.now() + ORDER_SUBMISSION_DEDUP_MS
    });

    const created = await createOrderPromise;
    res.json({ success: true, ok: true, orderId: created.orderId, order: created.order });
  } catch (error) {
    if (submissionKey) recentOrderSubmissions.delete(submissionKey);
    console.error('Create order error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: publicErrorMessage(error, 'Could not create the order. Please try again.')
    });
  }
});

router.get('/orders/track', async (req, res) => {
  try {
    const orderId = String(req.query.orderId || '').trim();
    const phone = String(req.query.phone || '').replace(/[^\d]/g, '');

    if (!orderId || !phone) {
      return res.status(400).json({ success: false, error: 'Order ID and phone are required' });
    }

    const rows = await supabase.select('orders', `?order_id=eq.${encodeURIComponent(orderId)}`);
    const order = rows && rows[0];
    const orderPhone = String(order?.phone || '').replace(/[^\d]/g, '');

    if (!order || !orderPhone.endsWith(phone.slice(-8))) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const normalized = normalizeOrder(order);
    res.json({
      success: true,
      order: {
        id: normalized.id,
        name: normalized.name,
        wilayat: normalized.wilayat,
        area: normalized.area,
        items: normalized.items,
        total: normalized.total,
        status: normalized.status,
        statusLabel: normalized.statusLabel,
        delivery: normalized.delivery,
        payment: normalized.payment,
        created_at: normalized.created_at
      }
    });
  } catch (error) {
    console.error('Track order error:', error);
    res.status(500).json({ success: false, error: 'Could not load order tracking. Please try again.' });
  }
});

router.put('/orders/:id', async (req, res) => {
  try {
    if (!isOrderStaffRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Staff only' });
    }

    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: 'Status required' });
    }

    const existingRows = String(id).startsWith('MC-')
      ? await supabase.select('orders', `?order_id=eq.${encodeURIComponent(id)}&select=*`)
      : await supabase.select('orders', `?id=eq.${encodeURIComponent(id)}&select=*`);
    const existingOrder = existingRows && existingRows[0];
    if (!existingOrder) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    if (!await canAccessOrderByRegion(existingOrder, req.session.userId, req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Order is outside your assigned regions' });
    }
    const existingSubOrders = await subOrdersForOrder(existingOrder.order_id || existingOrder.id);
    if (existingSubOrders.length) {
      const handled = await orderSubOrderStatusUpdate(existingOrder, existingSubOrders, status, req);
      const normalizedResult = handled.order;
      if (normalizedResult && !handled.suppressCustomerNotification) {
        if (status === 'payment_confirmed') {
          notifyStaffWhatsApp(normalizedResult, { includeMain: false, includeRegional: true })
            .catch(error => console.warn('Regional staff WhatsApp notification failed:', error.message));
        }
        const notifyStatus = handled.notificationStatus || status;
        if (['payment_confirmed', 'shipped', 'out_for_delivery', 'done', 'delivered', 'cancelled'].includes(notifyStatus)) {
          const notificationText = notifyStatus === 'done' || notifyStatus === 'delivered'
            ? reviewWhatsAppText(normalizedResult)
            : customerStatusWhatsAppText(normalizedResult, notifyStatus);
          const templateOptions = notifyStatus === 'done' || notifyStatus === 'delivered'
            ? whatsappTemplateConfig('review', normalizedResult)
            : whatsappTemplateConfig('customer_status', normalizedResult, notifyStatus);
          sendWhatsAppText(normalizedResult.phone, notificationText, templateOptions)
            .catch(error => console.warn('Customer status WhatsApp notification failed:', error.message));
        }
      }
      return res.json({ success: true, alreadyPrepared: !!handled.alreadyPrepared, order: normalizedResult });
    }
    if (status === 'payment_confirmed' && !isMainAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Main admin only' });
    }
    if (status === 'cancelled' && !isMainAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Employees can request cancellation only' });
    }
    if (['processing', 'shipped', 'done'].includes(status) && !['payment_confirmed', 'processing', 'shipped'].includes(existingOrder.status)) {
      return res.status(409).json({ success: false, error: 'Payment must be confirmed by main admin first' });
    }
    if (status === 'processing' && existingOrder.prepared_by) {
      return res.json({
        success: true,
        ok: true,
        alreadyPrepared: true,
        order: normalizeOrder(existingOrder)
      });
    }

    const updates = { status };
    if (['processing', 'shipped', 'done'].includes(status)) {
      if (existingOrder && !existingOrder.prepared_by) {
        const staffRows = await supabase.select('users', `?id=eq.${encodeURIComponent(req.session.userId)}&select=id,name,commission_rate`);
        const staff = staffRows && staffRows[0];
        const rate = Number(staff?.commission_rate || 0);
        const subtotal = orderItemsSubtotal(typeof existingOrder.items === 'string' ? JSON.parse(existingOrder.items || '[]') : (existingOrder.items || []));
        updates.prepared_by = req.session.userId;
        updates.prepared_by_name = staff?.name || req.session.userEmail || '';
        updates.commission_rate = rate;
        updates.commission_amount = Number((subtotal * rate / 100).toFixed(3));
      }
    }
    let result;
    try {
      result = String(id).startsWith('MC-')
        ? await supabase.updateBy('orders', 'order_id', id, updates)
        : await supabase.update('orders', id, updates);
    } catch (updateError) {
      if (!isMissingSupabaseColumn(updateError) || Object.keys(updates).length === 1) {
        throw updateError;
      }
      console.warn('Order status metadata columns are missing, retrying status-only update:', updateError.message);
      result = String(id).startsWith('MC-')
        ? await supabase.updateBy('orders', 'order_id', id, { status })
        : await supabase.update('orders', id, { status });
    }
    if (!result || !result[0]) {
      result = String(id).startsWith('MC-')
        ? await supabase.select('orders', `?order_id=eq.${encodeURIComponent(id)}&select=*`)
        : await supabase.select('orders', `?id=eq.${encodeURIComponent(id)}&select=*`);
    }
    const normalizedResult = result && result[0] ? normalizeOrder(result[0]) : null;
    if (normalizedResult) {
      if (status === 'payment_confirmed') {
        notifyStaffWhatsApp(normalizedResult, { includeMain: false, includeRegional: true })
          .catch(error => console.warn('Regional staff WhatsApp notification failed:', error.message));
      }
      const notificationText = status === 'done'
        ? reviewWhatsAppText(normalizedResult)
        : customerStatusWhatsAppText(normalizedResult, status);
      const templateOptions = status === 'done'
        ? whatsappTemplateConfig('review', normalizedResult)
        : whatsappTemplateConfig('customer_status', normalizedResult, status);
      sendWhatsAppText(normalizedResult.phone, notificationText, templateOptions)
        .catch(error => console.warn('Customer status WhatsApp notification failed:', error.message));
    }
    res.json({ success: true, order: normalizedResult });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.post('/orders/:id/cancellation-request', async (req, res) => {
  try {
    if (!isOrderStaffRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Staff only' });
    }
    const { id } = req.params;
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    const existingRows = String(id).startsWith('MC-')
      ? await supabase.select('orders', `?order_id=eq.${encodeURIComponent(id)}&select=*`)
      : await supabase.select('orders', `?id=eq.${encodeURIComponent(id)}&select=*`);
    const order = arrayRows(existingRows)[0];
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (!await canAccessOrderByRegion(order, req.session.userId, req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Order is outside your assigned regions' });
    }
    const staff = await staffBrief(req.session.userId);
    const subOrders = await subOrdersForOrder(order.order_id);
    const visible = await visibleSubOrdersForUser(subOrders, req.session.userId, req.session.userRole);
    await safeUpdateRowsBy('orders', 'order_id', order.order_id, {
      cancellation_request_status: 'pending',
      cancellation_requested_by: req.session.userId,
      cancellation_requested_by_name: staff?.name || req.session.userEmail || '',
      cancellation_reason: reason
    });
    await Promise.all(visible.map(subOrder => updateSubOrderBySubId(subOrder.sub_order_id, {
      cancellation_request_status: 'pending',
      cancellation_requested_by: req.session.userId,
      cancellation_requested_by_name: staff?.name || req.session.userEmail || '',
      cancellation_reason: reason
    })));
    if (reason) {
      await safeInsertRows('order_internal_notes', {
        order_id: order.order_id,
        sub_order_id: visible[0]?.sub_order_id || null,
        user_id: req.session.userId,
        user_name: staff?.name || req.session.userEmail || '',
        user_role: req.session.userRole,
        note: `طلب إلغاء: ${reason}`
      });
    }
    res.json({ success: true, ok: true, order: await normalizedOrderById(order.order_id, req.session.userRole, req.session.userId) });
  } catch (error) {
    console.error('Cancellation request error:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.put('/orders/:id/cancellation-request', async (req, res) => {
  try {
    if (!isMainAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Main admin only' });
    }
    const { id } = req.params;
    const action = String(req.body.action || '').trim();
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Invalid cancellation action' });
    }
    const rows = String(id).startsWith('MC-')
      ? await supabase.select('orders', `?order_id=eq.${encodeURIComponent(id)}&select=*`)
      : await supabase.select('orders', `?id=eq.${encodeURIComponent(id)}&select=*`);
    const order = arrayRows(rows)[0];
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (action === 'approve') {
      await updateSubOrdersForOrder(order.order_id, {
        status: 'cancelled',
        internal_status: 'cancelled',
        cancellation_request_status: 'approved'
      });
      await safeUpdateRowsBy('orders', 'order_id', order.order_id, {
        status: 'cancelled',
        cancellation_request_status: 'approved'
      });
    } else {
      await updateSubOrdersForOrder(order.order_id, { cancellation_request_status: 'rejected' });
      await safeUpdateRowsBy('orders', 'order_id', order.order_id, { cancellation_request_status: 'rejected' });
    }
    res.json({ success: true, ok: true, order: await normalizedOrderById(order.order_id, req.session.userRole, req.session.userId) });
  } catch (error) {
    console.error('Resolve cancellation request error:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.post('/orders/:id/internal-notes', async (req, res) => {
  try {
    if (!isOrderStaffRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Staff only' });
    }
    const { id } = req.params;
    const note = String(req.body.note || '').trim().slice(0, 1000);
    const subOrderId = String(req.body.subOrderId || '').trim() || null;
    if (!note) return res.status(400).json({ success: false, error: 'Note is required' });
    const rows = String(id).startsWith('MC-')
      ? await supabase.select('orders', `?order_id=eq.${encodeURIComponent(id)}&select=*`)
      : await supabase.select('orders', `?id=eq.${encodeURIComponent(id)}&select=*`);
    const order = arrayRows(rows)[0];
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (!await canAccessOrderByRegion(order, req.session.userId, req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Order is outside your assigned regions' });
    }
    const staff = await staffBrief(req.session.userId);
    await safeInsertRows('order_internal_notes', {
      order_id: order.order_id,
      sub_order_id: subOrderId,
      user_id: req.session.userId,
      user_name: staff?.name || req.session.userEmail || '',
      user_role: req.session.userRole,
      note
    });
    res.json({ success: true, ok: true, order: await normalizedOrderById(order.order_id, req.session.userRole, req.session.userId) });
  } catch (error) {
    console.error('Internal note error:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.put('/orders/:id/collection-point', async (req, res) => {
  try {
    if (!isMainAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Main admin only' });
    }
    const orderId = String(req.params.id || '').trim();
    const collectionPoint = String(req.body.collectionPoint || req.body.collection_point || '').trim().slice(0, 255);
    const strategy = String(req.body.collectionStrategy || req.body.collection_strategy || 'manual').trim().slice(0, 50) || 'manual';
    if (!collectionPoint) return res.status(400).json({ success: false, error: 'Collection point is required' });
    const result = String(orderId).startsWith('MC-')
      ? await safeUpdateRowsBy('orders', 'order_id', orderId, { collection_point: collectionPoint, collection_strategy: strategy })
      : await safeUpdateRows('orders', orderId, { collection_point: collectionPoint, collection_strategy: strategy });
    const saved = arrayRows(result)[0];
    const normalizedId = saved?.order_id || orderId;
    res.json({ success: true, ok: true, order: await normalizedOrderById(normalizedId, req.session.userRole, req.session.userId) });
  } catch (error) {
    console.error('Collection point error:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.get('/accounting', async (req, res) => {
  try {
    if (!isMainAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Main admin only' });
    }
    const [orders, subOrders, shipments, costLogs, reports] = await Promise.all([
      safeSelectRows('orders', '?order=id.desc'),
      safeSelectRows('sub_orders', '?order=id.asc'),
      safeSelectRows('internal_shipments', '?order=id.asc'),
      safeSelectRows('shipping_cost_logs', '?order=id.asc'),
      safeSelectRows('accounting_reports', '?select=*&order=report_key.desc')
    ]);
    const financialOrders = orders.filter(order => !isCancelledStatus(order.status));
    const financialOrderIds = new Set(financialOrders.map(order => String(order.order_id || order.id)));
    const financialSubOrders = subOrders.filter(subOrder => {
      return financialOrderIds.has(String(subOrder.order_id)) && !isCancelledStatus(subOrder.status);
    });
    const financialShipments = shipments.filter(shipment => financialOrderIds.has(String(shipment.order_id)));
    const financialCostLogs = costLogs.filter(log => financialOrderIds.has(String(log.order_id)));
    const completedOrders = financialOrders.filter(order => ['done', 'delivered'].includes(order.status));
    const totalSales = Number(financialOrders.reduce((sum, order) => sum + Number(order.total || 0), 0).toFixed(3));
    const productSales = Number((financialSubOrders.length
      ? financialSubOrders.reduce((sum, subOrder) => sum + Number(subOrder.subtotal || 0), 0)
      : financialOrders.reduce((sum, order) => sum + orderItemsSubtotal(parseJsonArray(order.items)), 0)
    ).toFixed(3));
    const totalCommissions = Number((financialSubOrders.length
      ? financialSubOrders.reduce((sum, subOrder) => sum + Number(subOrder.commission_amount || 0), 0)
      : financialOrders.reduce((sum, order) => sum + Number(order.commission_amount || 0), 0)
    ).toFixed(3));
    const shippingCollected = Number(financialOrders.reduce((sum, order) => sum + Number(order.deliveryCost || order.delivery_cost || 0), 0).toFixed(3));
    const shipmentCosts = financialShipments.reduce((sum, shipment) => sum + Number(shipment.cost || 0), 0);
    const loggedCosts = financialCostLogs.reduce((sum, log) => sum + Number(log.amount || 0), 0);
    const shippingActualCost = Number((shipmentCosts + loggedCosts).toFixed(3));
    const shippingDelta = Number((shippingCollected - shippingActualCost).toFixed(3));
    const multiRegionOrders = financialOrders.filter(order => orderIsMultiRegion(order, financialSubOrders.filter(sub => sub.order_id === order.order_id)));
    const singleRegionOrders = financialOrders.length - multiRegionOrders.length;
    const regionCounts = new Map();
    const collectionCounts = new Map();
    for (const subOrder of financialSubOrders) {
      for (const region of subOrderRegions(subOrder)) {
        regionCounts.set(region, (regionCounts.get(region) || 0) + 1);
      }
    }
    for (const order of financialOrders) {
      if (order.collection_point) collectionCounts.set(order.collection_point, (collectionCounts.get(order.collection_point) || 0) + 1);
    }
    const topEntries = map => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
    const shippingLosses = shippingDelta < 0 ? Math.abs(shippingDelta) : 0;
    const multiRegionRatio = financialOrders.length ? Number((multiRegionOrders.length / financialOrders.length * 100).toFixed(1)) : 0;
    const alerts = [];
    if (shippingLosses > shippingCollected * 0.25 && shippingLosses > 0) alerts.push('Shipping losses are rising');
    if (multiRegionRatio >= 35) alerts.push('Multi-region orders ratio is increasing');
    if (shippingActualCost > shippingCollected) alerts.push('Actual shipping cost is higher than collected fees');
    const currentMonth = omanMonthKey();
    const employeeCommissionRows = buildEmployeeCommissionRows(financialOrders, financialSubOrders);
    const currentMonthEmployeeEarnings = employeeCommissionRows.filter(row => row.month === currentMonth);
    await saveEmployeeCommissionReport(currentMonth, currentMonthEmployeeEarnings);
    const monthlyEmployeeEarnings = mergeMonthlyEmployeeRows(employeeCommissionRows, reports);
    res.json({
      success: true,
      accounting: {
        totalOrders: orders.length,
        completedOrders: completedOrders.length,
        totalSales,
        productSales,
        totalProfit: Number((productSales - totalCommissions).toFixed(3)),
        totalCommissions,
        currentMonth,
        currentMonthEmployeeEarnings,
        monthlyEmployeeEarnings,
        shippingCollected,
        shippingActualCost,
        netProfit: Number((productSales - totalCommissions + shippingDelta).toFixed(3)),
        shippingAnalytics: {
          singleRegionOrders,
          multiRegionOrders: multiRegionOrders.length,
          multiRegionRatio,
          shippingCollected,
          internalShipmentCosts: Number(shipmentCosts.toFixed(3)),
          finalShipmentCosts: Number(loggedCosts.toFixed(3)),
          shippingActualCost,
          shippingDelta,
          shippingProfit: shippingDelta > 0 ? shippingDelta : 0,
          shippingLoss: shippingLosses,
          totalShippingProfit: shippingDelta > 0 ? shippingDelta : 0,
          totalShippingLoss: shippingLosses,
          topSharedRegions: topEntries(regionCounts),
          topCollectionPoints: topEntries(collectionCounts),
        averageShippingCost: financialOrders.length ? Number((shippingActualCost / financialOrders.length).toFixed(3)) : 0,
          alerts
        }
      }
    });
  } catch (error) {
    console.error('Accounting error:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

// ============ VERIFIED PRODUCT REVIEWS ============

router.post('/reviews', async (req, res) => {
  try {
    const orderId = String(req.body.orderId || '').trim();
    const phone = omanLocalPhone(req.body.phone || '');
    const productId = String(req.body.productId || '').trim();
    const rating = Math.max(1, Math.min(5, Number(req.body.rating || 0)));
    const comment = String(req.body.comment || '').trim().slice(0, 500);

    if (!orderId || phone.length !== 8 || !productId || !rating) {
      return res.status(400).json({ success: false, error: 'Missing review fields' });
    }

    const rows = await supabase.select('orders', `?order_id=eq.${encodeURIComponent(orderId)}&select=*`);
    const order = rows && rows[0];
    const orderPhone = omanLocalPhone(order?.phone || '');
    const items = typeof order?.items === 'string' ? JSON.parse(order.items || '[]') : (order?.items || []);
    const boughtProduct = items.some(item => String(item.id) === String(productId));

    if (!order || !['done', 'delivered'].includes(order.status) || orderPhone !== phone || !boughtProduct) {
      return res.status(403).json({ success: false, error: 'Only delivered buyers can review this product' });
    }

    const duplicate = await supabase.select('product_reviews', `?order_id=eq.${encodeURIComponent(orderId)}&product_id=eq.${encodeURIComponent(productId)}&select=id`);
    if (duplicate && duplicate.length) {
      return res.status(409).json({ success: false, error: 'Review already submitted' });
    }

    await supabase.insert('product_reviews', {
      order_id: orderId,
      product_id: Number(productId),
      customer_name: order.customer_name || '',
      phone,
      rating,
      comment,
      verified: true
    });

    const productRows = await supabase.select('products', `?id=eq.${encodeURIComponent(productId)}&select=id,rating,reviews`);
    const product = productRows && productRows[0];
    if (product) {
      const oldReviews = Number(product.reviews || 0);
      const oldRating = Number(product.rating || 5);
      const newReviews = oldReviews + 1;
      const newRating = Number((((oldRating * oldReviews) + rating) / newReviews).toFixed(2));
      await supabase.update('products', productId, { rating: newRating, reviews: newReviews });
    }

    res.json({ success: true, ok: true });
  } catch (error) {
    console.error('Create review error:', error);
    res.status(500).json({ success: false, error: 'Could not save review. Please try again.' });
  }
});

// ============ SETTINGS ============

router.get('/settings', async (req, res) => {
  try {
    const rows = await supabase.select('settings', '');
    const settings = {};
    const internalSettingKeys = new Set([
      'regionOptions',
      'staffRegions',
      'notifyEmail',
      'smtp_host',
      'smtp_port',
      'smtp_user',
      'smtp_pass',
      'smtp_from',
      'thawani_enabled',
      'thawani_mode'
    ]);
    const includeInternal = isDashboardRole(req.session.userRole);
    for (const row of rows || []) {
      if (!includeInternal && internalSettingKeys.has(row.key)) continue;
      settings[row.key] = normalizeBrandValue(row.value);
    }
    const visibleRows = (rows || [])
      .filter(row => includeInternal || !internalSettingKeys.has(row.key))
      .map(normalizeBrandSettingRow);
    res.json({
      success: true,
      settings,
      rows: visibleRows
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ success: false, error: 'Could not load settings. Please try again.' });
  }
});

router.get('/whatsapp/webhook', (req, res) => {
  const mode = String(req.query['hub.mode'] || '');
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = req.query['hub.challenge'];
  const expectedToken = whatsappVerifyToken();

  if (!expectedToken) {
    console.warn('[WhatsApp] WHATSAPP_VERIFY_TOKEN is not configured.');
    return res.status(500).send('WhatsApp verify token is not configured');
  }

  if (mode === 'subscribe' && token === expectedToken && typeof challenge !== 'undefined') {
    return res.status(200).send(String(challenge));
  }

  console.warn('[WhatsApp] Webhook verification failed.');
  return res.sendStatus(403);
});

router.post('/whatsapp/webhook', (req, res) => {
  const events = collectWhatsAppWebhookEvents(req.body || {});
  for (const event of events) {
    recordWhatsAppEvent(event).catch(error => {
      console.warn('[WhatsApp] Webhook event handling failed:', safeExternalErrorMessage(error));
    });
  }
  res.sendStatus(200);
});

router.get('/whatsapp/status', async (req, res) => {
  try {
    if (!isMainAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Main admin only' });
    }
    const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_WHATSAPP_PHONE_NUMBER_ID;
    const staffOrderTemplate = whatsappTemplateConfig('staff_order', {}).templateName;
    const customerOrderTemplate = whatsappTemplateConfig('customer_order', {}).templateName;
    const customerStatusTemplate = whatsappTemplateConfig('customer_status', {}, 'new').templateName;
    const reviewTemplate = whatsappTemplateConfig('review', {}).templateName;
    res.json({
      success: true,
      configured: {
        accessToken: Boolean(token),
        phoneNumberId: Boolean(phoneNumberId),
        phoneNumberIdHint: maskIdentifier(phoneNumberId),
        verifyToken: Boolean(whatsappVerifyToken()),
        graphVersion: process.env.WHATSAPP_GRAPH_VERSION || 'v20.0',
        templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'ar',
        staffOrderTemplate: Boolean(staffOrderTemplate),
        staffOrderTemplateName: staffOrderTemplate || '',
        customerOrderTemplate: Boolean(customerOrderTemplate),
        customerOrderTemplateName: customerOrderTemplate || '',
        customerStatusTemplate: Boolean(customerStatusTemplate),
        customerStatusTemplateName: customerStatusTemplate || '',
        reviewTemplate: Boolean(reviewTemplate),
        reviewTemplateName: reviewTemplate || ''
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: safeExternalErrorMessage(error) });
  }
});

router.get('/whatsapp/events', async (req, res) => {
  try {
    if (!isMainAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Main admin only' });
    }
    const persisted = arrayRows(await safeSelectRows('whatsapp_events', '?select=*&order=created_at.desc&limit=50'));
    const fallback = recentWhatsAppEvents.slice(0, 50);
    const rows = persisted.length ? persisted : fallback;
    res.json({
      success: true,
      events: rows.map(sanitizeWhatsAppEvent),
      source: persisted.length ? 'database' : 'memory'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: safeExternalErrorMessage(error) });
  }
});

router.post('/whatsapp/test', async (req, res) => {
  try {
    if (!isMainAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Main admin only' });
    }
    const phone = omanLocalPhone(req.body.phone || '');
    if (phone.length !== 8) {
      return res.status(400).json({ success: false, error: 'Phone must be an 8-digit Oman number' });
    }
    const order = {
      order_id: `TEST-${Date.now()}`,
      customer_name: String(req.body.name || 'اختبار').trim().slice(0, 80) || 'اختبار',
      phone,
      total: 0,
      payment: 'bank_transfer'
    };
    const templateOptions = whatsappTemplateConfig('customer_order', order);
    if (!templateOptions.templateName) {
      return res.status(400).json({ success: false, error: 'WHATSAPP_CUSTOMER_ORDER_TEMPLATE is not configured' });
    }
    const sendResult = await sendWhatsAppText(phone, customerOrderWhatsAppText(order), templateOptions);
    res.json({
      success: true,
      ok: true,
      to: cleanPhone(phone).replace(/^(\d{3})\d+(\d{2})$/, '$1******$2'),
      template: templateOptions.templateName,
      messageId: sendResult.messageId || ''
    });
  } catch (error) {
    console.warn('WhatsApp test failed:', safeExternalErrorMessage(error));
    res.status(502).json({ success: false, error: safeExternalErrorMessage(error) });
  }
});

router.post('/settings', async (req, res) => {
  try {
    if (!isAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const updates = { ...(req.body || {}) };
    const saved = {};
    const mainAdminOnlyKeys = new Set(['regionOptions', 'staffRegions']);
    for (const key of mainAdminOnlyKeys) {
      if (Object.prototype.hasOwnProperty.call(updates, key) && !isMainAdminRole(req.session.userRole)) {
        delete updates[key];
      }
    }

    for (const [key, rawValue] of Object.entries(updates)) {
      if (!key) continue;
      const value = normalizeBrandValue(sanitizeSettingValue(key, rawValue));
      const updated = await supabase.updateBy('settings', 'key', key, { value });
      if (updated && updated.length) {
        saved[key] = normalizeBrandValue(updated[0].value);
      } else {
        const inserted = await supabase.insert('settings', { key, value });
        saved[key] = normalizeBrandValue(inserted[0]?.value ?? value);
      }
    }

    res.json({ success: true, ok: true, settings: saved });
  } catch (error) {
    console.error('Upsert setting error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ BACKUP ============

router.get('/backup', async (req, res) => {
  try {
    if (!isAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const [products, orders, settings, users, subOrders, internalShipments, shippingCostLogs, orderInternalNotes] = await Promise.all([
      supabase.select('products', '?order=id.asc'),
      supabase.select('orders', '?order=id.desc'),
      supabase.select('settings', '?order=key.asc'),
      supabase.select('users', '?select=id,email,name,role,phone,commission_rate,created_at,updated_at&order=id.asc'),
      safeSelectRows('sub_orders', '?order=id.asc'),
      safeSelectRows('internal_shipments', '?order=id.asc'),
      safeSelectRows('shipping_cost_logs', '?order=id.asc'),
      safeSelectRows('order_internal_notes', '?order=id.asc')
    ]);

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="meemz-cameo-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({
      success: true,
      exportedAt: new Date().toISOString(),
      products: products || [],
      orders: orders || [],
      settings: (settings || []).map(redactSensitiveSettingRow),
      users: users || [],
      subOrders,
      internalShipments,
      shippingCostLogs,
      orderInternalNotes
    });
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'Image file is too large' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ success: false, error: 'Too many uploaded files' });
    }
    return res.status(400).json({ success: false, error: 'Uploaded file is not accepted' });
  }
  if (/file|image|receipt|upload/i.test(String(error?.message || ''))) {
    return res.status(400).json({ success: false, error: error.message });
  }
  next(error);
});

module.exports = { router, initializeAPI };
