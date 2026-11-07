-- Supabase Database Setup for Meemz Cameo (ميمز كاميو)
-- Run this file in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  phone VARCHAR(50),
  commission_rate DECIMAL(5, 2) DEFAULT 0,
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10, 3) NOT NULL,
  category VARCHAR(100),
  cat VARCHAR(100),
  emoji VARCHAR(32) DEFAULT '🎁',
  "oldPrice" DECIMAL(10, 3),
  badge VARCHAR(50),
  "badgeType" VARCHAR(50),
  rating DECIMAL(3, 2) DEFAULT 5,
  reviews INT DEFAULT 0,
  "desc" TEXT,
  product_details JSONB DEFAULT '{}'::jsonb,
  images JSONB DEFAULT '[]'::jsonb,
  image_url VARCHAR(500),
  is_active BOOLEAN DEFAULT true,
  stock INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(cat);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  order_id VARCHAR(50) UNIQUE,
  customer_name VARCHAR(255),
  wilayat VARCHAR(255),
  area VARCHAR(255),
  phone VARCHAR(50),
  delivery VARCHAR(50),
  "deliveryCost" DECIMAL(10, 3) DEFAULT 0,
  "vatRate" DECIMAL(5, 2) DEFAULT 0,
  "vatAmount" DECIMAL(10, 3) DEFAULT 0,
  total DECIMAL(10, 3) NOT NULL DEFAULT 0,
  gift_message TEXT,
  total_price DECIMAL(10, 3),
  status VARCHAR(50) DEFAULT 'new',
  items JSONB DEFAULT '[]'::jsonb,
  payment VARCHAR(50) DEFAULT 'bank_transfer',
  proof TEXT,
  prepared_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  prepared_by_name VARCHAR(255),
  commission_rate DECIMAL(5, 2) DEFAULT 0,
  commission_amount DECIMAL(10, 3) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_prepared_by ON orders(prepared_by);

CREATE TABLE IF NOT EXISTS product_reviews (
  id BIGSERIAL PRIMARY KEY,
  order_id VARCHAR(50) NOT NULL,
  product_id BIGINT REFERENCES products(id) ON DELETE CASCADE,
  customer_name VARCHAR(255),
  phone VARCHAR(50),
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  verified BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id ON product_reviews(product_id);

CREATE TABLE IF NOT EXISTS settings (
  id BIGSERIAL PRIMARY KEY,
  key VARCHAR(255) UNIQUE NOT NULL,
  value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_resets (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Existing-project migrations.
ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_user_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_id VARCHAR(50) UNIQUE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wilayat VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS area VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "deliveryCost" DECIMAL(10, 3) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "vatRate" DECIMAL(5, 2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_message TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "vatAmount" DECIMAL(10, 3) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total DECIMAL(10, 3) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_price DECIMAL(10, 3);
ALTER TABLE orders ALTER COLUMN total_price DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment VARCHAR(50) DEFAULT 'bank_transfer';
ALTER TABLE orders ALTER COLUMN payment SET DEFAULT 'bank_transfer';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS proof TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prepared_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prepared_by_name VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_rate DECIMAL(5, 2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_amount DECIMAL(10, 3) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_multi_region BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS collection_point VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS collection_strategy VARCHAR(50) DEFAULT 'manual';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS final_delivery_status VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_request_status VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_requested_by_name VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_actual_cost DECIMAL(10, 3) DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_orders_prepared_by ON orders(prepared_by);
CREATE INDEX IF NOT EXISTS idx_orders_is_multi_region ON orders(is_multi_region);
CREATE INDEX IF NOT EXISTS idx_orders_cancellation_request_status ON orders(cancellation_request_status);

CREATE TABLE IF NOT EXISTS sub_orders (
  id BIGSERIAL PRIMARY KEY,
  order_id VARCHAR(50) NOT NULL,
  order_db_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
  sub_order_id VARCHAR(80) UNIQUE NOT NULL,
  region VARCHAR(255),
  regions JSONB DEFAULT '[]'::jsonb,
  assigned_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  assigned_user_name VARCHAR(255),
  assigned_region VARCHAR(255),
  items JSONB DEFAULT '[]'::jsonb,
  subtotal DECIMAL(10, 3) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'waiting_payment',
  internal_status VARCHAR(50) DEFAULT 'waiting_payment',
  is_shared BOOLEAN DEFAULT false,
  commission_rate DECIMAL(5, 2) DEFAULT 0,
  commission_amount DECIMAL(10, 3) DEFAULT 0,
  cancellation_requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  cancellation_requested_by_name VARCHAR(255),
  cancellation_request_status VARCHAR(50),
  cancellation_reason TEXT,
  prepared_at TIMESTAMP,
  sent_at TIMESTAMP,
  received_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sub_orders_order_id ON sub_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_sub_orders_order_db_id ON sub_orders(order_db_id);
CREATE INDEX IF NOT EXISTS idx_sub_orders_assigned_user_id ON sub_orders(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_sub_orders_status ON sub_orders(status);

CREATE TABLE IF NOT EXISTS internal_shipments (
  id BIGSERIAL PRIMARY KEY,
  order_id VARCHAR(50) NOT NULL,
  sub_order_id VARCHAR(80),
  from_region VARCHAR(255),
  from_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  from_user_name VARCHAR(255),
  collection_point VARCHAR(255),
  status VARCHAR(50) DEFAULT 'waiting_for_internal_shipment',
  cost DECIMAL(10, 3) DEFAULT 0,
  tracking_ref VARCHAR(255),
  note TEXT,
  sent_at TIMESTAMP,
  received_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_internal_shipments_order_id ON internal_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_internal_shipments_sub_order_id ON internal_shipments(sub_order_id);
CREATE INDEX IF NOT EXISTS idx_internal_shipments_status ON internal_shipments(status);

CREATE TABLE IF NOT EXISTS shipping_cost_logs (
  id BIGSERIAL PRIMARY KEY,
  order_id VARCHAR(50) NOT NULL,
  sub_order_id VARCHAR(80),
  shipment_id BIGINT REFERENCES internal_shipments(id) ON DELETE SET NULL,
  cost_type VARCHAR(50) DEFAULT 'internal',
  from_region VARCHAR(255),
  to_region VARCHAR(255),
  amount DECIMAL(10, 3) DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shipping_cost_logs_order_id ON shipping_cost_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_shipping_cost_logs_sub_order_id ON shipping_cost_logs(sub_order_id);

CREATE TABLE IF NOT EXISTS order_internal_notes (
  id BIGSERIAL PRIMARY KEY,
  order_id VARCHAR(50) NOT NULL,
  sub_order_id VARCHAR(80),
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  user_name VARCHAR(255),
  user_role VARCHAR(50),
  note TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_order_internal_notes_order_id ON order_internal_notes(order_id);
CREATE INDEX IF NOT EXISTS idx_order_internal_notes_sub_order_id ON order_internal_notes(sub_order_id);

CREATE TABLE IF NOT EXISTS whatsapp_events (
  id BIGSERIAL PRIMARY KEY,
  message_id TEXT,
  recipient TEXT,
  event_type VARCHAR(50),
  status VARCHAR(50),
  error_code TEXT,
  error_title TEXT,
  error_message TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_events_message_id ON whatsapp_events(message_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_events_created_at ON whatsapp_events(created_at);

CREATE TABLE IF NOT EXISTS accounting_reports (
  id BIGSERIAL PRIMARY KEY,
  report_key VARCHAR(120) UNIQUE,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_rate DECIMAL(5, 2) DEFAULT 0;

ALTER TABLE products ADD COLUMN IF NOT EXISTS cat VARCHAR(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS emoji VARCHAR(32) DEFAULT '🎁';
ALTER TABLE products ADD COLUMN IF NOT EXISTS "oldPrice" DECIMAL(10, 3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS badge VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS "badgeType" VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS rating DECIMAL(3, 2) DEFAULT 5;
ALTER TABLE products ADD COLUMN IF NOT EXISTS reviews INT DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS "desc" TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_details JSONB DEFAULT '{}'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INT DEFAULT 0;

-- Security: only the server (service_role key) may read/write store data.
-- Row Level Security with no policies blocks the public anon/publishable keys from the REST API.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_cost_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_internal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_reports ENABLE ROW LEVEL SECURITY;

-- Default admin: seed section — run once in the Supabase SQL editor (the server only auto-runs the schema above this line).
-- Login: admin@meemzcameo.com  (change the password from the dashboard / reset flow after first login)
INSERT INTO users (email, password, name, role)
VALUES ('admin@meemzcameo.com', '$2b$10$YXY83yoiLhBXBiq87yNC2ucKloDAjL1zQ/MJCbRI/SNPmnxczxTsm', 'Meemz Admin', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Starter settings for Meemz Cameo (only inserted if missing)
INSERT INTO settings (key, value)
VALUES
  ('siteName', 'ميمز كاميو'),
  ('siteNameEn', 'Meemz Cameo'),
  ('deliveryCost', '2.000'),
  ('vatRate', '0'),
  ('waNumber', '+96879960608'),
  ('instagramUrl', 'https://instagram.com/meemz.cameo'),
  ('categories', '[{"id": "gift-boxes", "icon": "gift", "name": "بوكسات الهدايا", "nameEn": "Gift boxes", "active": true}, {"id": "paper-flowers", "icon": "flower", "name": "ورد ورقي", "nameEn": "Paper flowers", "active": true}, {"id": "paper-art", "icon": "frame", "name": "لوحات وفن ورقي", "nameEn": "Paper art & frames", "active": true}, {"id": "cards", "icon": "card", "name": "بطاقات وتغليف", "nameEn": "Cards & wrapping", "active": true}, {"id": "occasions", "icon": "ribbon", "name": "توزيعات المناسبات", "nameEn": "Occasion favours", "active": true}, {"id": "custom", "icon": "scissors", "name": "طلبات خاصة", "nameEn": "Custom orders", "active": true}]')
ON CONFLICT (key) DO NOTHING;
