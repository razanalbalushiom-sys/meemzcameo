import express from "express";
import { createServer } from "http";
import net from "net";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import postgres from "postgres";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const { initializeAPI } = _require("../api.cjs");

// Note: Supabase credentials are loaded from environment variables
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function ensureSupabaseSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn("[MeemzCameo] DATABASE_URL is not configured; skipping schema bootstrap.");
    return;
  }

  const setupPath = path.resolve(process.cwd(), "SUPABASE_SETUP.sql");
  if (!fs.existsSync(setupPath)) {
    console.warn("[MeemzCameo] SUPABASE_SETUP.sql was not found; skipping schema bootstrap.");
    return;
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
    ssl: databaseUrl.includes("supabase.") ? "require" : undefined,
  });

  try {
    const setupSql = fs.readFileSync(setupPath, "utf8");
    const schemaSql = setupSql.split("-- Default admin:")[0] || setupSql;
    await sql.unsafe(schemaSql);
    console.log("[MeemzCameo] Supabase schema verified.");
  } catch (error) {
    console.warn("[MeemzCameo] Supabase schema bootstrap failed:", error instanceof Error ? error.message : error);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function startServer() {
  await ensureSupabaseSchema();
  
  const app = express();
  const server = createServer(app);
  const isProd = process.env.NODE_ENV === "production";

  // FIX #1: Trust Render's reverse proxy so req.protocol === 'https' in production
  // This is required for secure session cookies to work on Render
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    if (['TRACE', 'TRACK'].includes(req.method)) {
      return res.status(405).send('Method Not Allowed');
    }
    next();
  });

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'", "https://wa.me", "https://api.whatsapp.com"],
        "frame-ancestors": ["'none'"],
        "frame-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "script-src-attr": ["'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
        "connect-src": ["'self'", "https:"],
        "media-src": ["'self'", "blob:", "https:"],
        "object-src": ["'none'"],
        "worker-src": ["'self'", "blob:"],
        "manifest-src": ["'self'"],
        ...(isProd ? { "upgrade-insecure-requests": [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: isProd ? { maxAge: 15552000, includeSubDomains: true, preload: false } : false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }));

  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()"
    );
    next();
  });

  // Keep JSON forms small. Product images are uploaded through multer with its own limits.
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
  app.use(express.urlencoded({ limit: process.env.URLENCODED_BODY_LIMIT || "200kb", extended: true }));
  app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError) {
      return res.status(400).json({ success: false, error: "Invalid JSON body" });
    }
    next(err);
  });
  app.use(cookieParser());

  const normalizeOrigin = (value: string) => value.trim().replace(/\/+$/, "");
  const configuredOrigins = (process.env.CORS_ORIGIN || process.env.PUBLIC_URL || "")
    .split(",")
    .map(origin => normalizeOrigin(origin))
    .filter(Boolean);
  const devOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
  const allowedOrigins = new Set([...configuredOrigins, ...devOrigins]);
  app.use(cors({
    origin(origin, callback) {
      const normalizedOrigin = origin ? normalizeOrigin(origin) : "";
      if (!normalizedOrigin || allowedOrigins.has(normalizedOrigin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }));

  app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.message === "Not allowed by CORS") {
      return res.status(403).json({ success: false, error: "Origin is not allowed" });
    }
    next(err);
  });

  // Serve uploaded files
  const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'public/uploads');
  app.use('/uploads', express.static(uploadDir, {
    maxAge: isProd ? '7d' : 0,
  }));

  // Mount the store REST API (Supabase-backed)
  const storeApiRouter = await initializeAPI();
  app.use('/api', storeApiRouter);

  // Serve the static HTML files (index.html, admin.html, reset-password.html)
  const staticDir = path.resolve(process.cwd(), 'public');
  
  // Direct route for root path
  app.get('/', (req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'public/index.html'));
  });

  app.get('/admin.html', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.resolve(process.cwd(), 'public/admin.html'));
  });
  
  app.use(express.static(staticDir));
  
  // Fallback route to serve index.html for SPA (for client-side routing)
  app.get('*', (req, res) => {
    const indexPath = path.resolve(process.cwd(), 'public/index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('Not found');
    }
  });

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  
  console.log('[MeemzCameo] Connected to Supabase database');

  server.listen(port, "0.0.0.0", () => {
    console.log(`[MeemzCameo] Server running on http://localhost:${port}`);
  });

  return server;
}

export default startServer();
