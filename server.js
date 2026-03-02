
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET;
const EXPOSE_RESET_TOKEN = process.env.EXPOSE_RESET_TOKEN === 'true';
const ADMIN_SEED_EMAIL = String(process.env.ADMIN_SEED_EMAIL || '').trim().toLowerCase();
const ADMIN_SEED_PASSWORD = String(process.env.ADMIN_SEED_PASSWORD || '');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'moreno_moveis.db');
const ALLOWED_SHIPPING_CITIES = ['paulo de faria', 'orindiuva', 'sao jose do rio preto'];
const FREE_SHIPPING_CITIES = ['paulo de faria', 'orindiuva'];
const CORS_ORIGINS = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET obrigatorio. Defina no arquivo .env antes de iniciar.');
}

if (NODE_ENV === 'production' && CORS_ORIGINS.length === 0) {
  throw new Error('CORS_ORIGIN obrigatorio em producao.');
}

const defaultDevOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const allowedOrigins = CORS_ORIGINS.length > 0 ? CORS_ORIGINS : (NODE_ENV === 'production' ? [] : defaultDevOrigins);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin nao permitida pelo CORS.'));
  }
};

if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function ensureColumn(tableName, columnName, definition) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = cols.some((c) => c.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function nowSql() {
  return new Date().toISOString();
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function normalizeShippingCity(city) {
  return String(city || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function parseDateBoundary(value, endOfDay = false) {
  const raw = cleanText(value || '');
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: 'Use o formato de data YYYY-MM-DD.' };
  const date = new Date(`${raw}${endOfDay ? 'T23:59:59.999' : 'T00:00:00'}`);
  if (Number.isNaN(date.getTime())) return { error: 'Data invalida informada.' };
  return { iso: date.toISOString() };
}

function calcShippingByZip(zipCode, subtotal, normalizedCity = '') {
  if (FREE_SHIPPING_CITIES.includes(normalizedCity)) {
    return { cost: 0, days: 2 };
  }

  const digits = String(zipCode || '').replace(/\D/g, '');
  if (!digits || digits.length < 8) {
    return { cost: subtotal >= 300 ? 0 : 39.9, days: subtotal >= 300 ? 4 : 8 };
  }

  const region = Number(digits[0]);
  if (subtotal >= 300) return { cost: 0, days: 4 };
  if ([0, 1, 2, 3].includes(region)) return { cost: 24.9, days: 4 };
  if ([4, 5].includes(region)) return { cost: 29.9, days: 6 };
  if ([6, 7, 8, 9].includes(region)) return { cost: 34.9, days: 8 };
  return { cost: 39.9, days: 10 };
}

function applyCouponToSubtotal(subtotal, couponCode) {
  if (!couponCode) return { discount: 0, coupon: null };

  const code = String(couponCode).trim().toUpperCase();
  const coupon = db.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').get(code);
  if (!coupon) throw new Error('Cupom invalido.');
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    throw new Error('Cupom expirado.');
  }
  if (subtotal < Number(coupon.min_total || 0)) {
    throw new Error(`Cupom exige valor minimo de ${Number(coupon.min_total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`);
  }

  let discount = coupon.type === 'percent'
    ? subtotal * (Number(coupon.value) / 100)
    : Number(coupon.value);

  discount = Math.min(discount, subtotal);
  return { discount: Number(discount.toFixed(2)), coupon };
}

function logStockMovement({ productId, delta, reason, referenceOrderId = null, changedBy = null, note = null }) {
  if (!delta) return;
  db.prepare(
    `INSERT INTO stock_movements (product_id, delta, reason, reference_order_id, changed_by, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(productId, delta, reason, referenceOrderId, changedBy, note, nowSql());
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      phone TEXT,
      cpf TEXT,
      birth_date TEXT,
      zip_code TEXT,
      street TEXT,
      number TEXT,
      complement TEXT,
      neighborhood TEXT,
      city TEXT,
      state TEXT,
      role TEXT NOT NULL DEFAULT 'client',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT,
      price REAL NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      image_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      featured INTEGER NOT NULL DEFAULT 0,
      old_price REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      discount_total REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      coupon_code TEXT,
      shipping_zip TEXT,
      shipping_city TEXT,
      shipping_street TEXT,
      shipping_number TEXT,
      shipping_complement TEXT,
      shipping_neighborhood TEXT,
      shipping_state TEXT,
      shipping_cost REAL NOT NULL DEFAULT 0,
      shipping_days INTEGER NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL,
      payment_installments INTEGER NOT NULL DEFAULT 1,
      cash_change_for REAL,
      payment_status TEXT NOT NULL,
      pix_code TEXT,
      stripe_session_id TEXT,
      status TEXT NOT NULL DEFAULT 'Aguardando confirmacao',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      phone TEXT NOT NULL,
      instagram TEXT NOT NULL,
      email TEXT NOT NULL,
      hero_title TEXT NOT NULL DEFAULT 'Design, conforto e qualidade para seu lar.',
      hero_subtitle TEXT NOT NULL DEFAULT 'Loja online oficial da Moreno Moveis.',
      banner_text TEXT NOT NULL DEFAULT 'Montagem e instalacao sem custo adicional.',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      value REAL NOT NULL,
      min_total REAL NOT NULL DEFAULT 0,
      expires_at TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS order_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      changed_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference_order_id INTEGER,
      changed_by INTEGER,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (reference_order_id) REFERENCES orders(id),
      FOREIGN KEY (changed_by) REFERENCES users(id)
    );
  `);

  ensureColumn('products', 'featured', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('products', 'old_price', 'REAL');
  ensureColumn('orders', 'subtotal', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('orders', 'discount_total', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('orders', 'coupon_code', 'TEXT');
  ensureColumn('orders', 'shipping_zip', 'TEXT');
  ensureColumn('orders', 'shipping_city', 'TEXT');
  ensureColumn('orders', 'shipping_street', 'TEXT');
  ensureColumn('orders', 'shipping_number', 'TEXT');
  ensureColumn('orders', 'shipping_complement', 'TEXT');
  ensureColumn('orders', 'shipping_neighborhood', 'TEXT');
  ensureColumn('orders', 'shipping_state', 'TEXT');
  ensureColumn('orders', 'shipping_cost', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('orders', 'shipping_days', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'payment_installments', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('orders', 'cash_change_for', 'REAL');
  ensureColumn('orders', 'payment_proof', 'TEXT');
  ensureColumn('orders', 'stock_applied', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('settings', 'hero_title', "TEXT NOT NULL DEFAULT 'Design, conforto e qualidade para seu lar.'");
  ensureColumn('settings', 'hero_subtitle', "TEXT NOT NULL DEFAULT 'Loja online oficial da Moreno Moveis.'");
  ensureColumn('settings', 'banner_text', "TEXT NOT NULL DEFAULT 'Montagem e instalacao sem custo adicional.'");

  if (ADMIN_SEED_EMAIL && ADMIN_SEED_PASSWORD && ADMIN_SEED_PASSWORD.length >= 8) {
    const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_SEED_EMAIL);
    if (!adminExists) {
      const adminHash = bcrypt.hashSync(ADMIN_SEED_PASSWORD, 10);
      db.prepare(`INSERT INTO users (name, email, password_hash, phone, city, state, role) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run('Administrador Moreno', ADMIN_SEED_EMAIL, adminHash, '(11) 99999-9999', 'Sao Paulo', 'SP', 'admin');
      console.log(`Admin inicial criado para ${ADMIN_SEED_EMAIL}.`);
    }
  } else {
    console.log('Seed de admin desativada. Defina ADMIN_SEED_EMAIL + ADMIN_SEED_PASSWORD (min. 8) para criar admin inicial.');
  }

  const productCount = db.prepare('SELECT COUNT(*) AS total FROM products').get().total;
  if (productCount === 0) {
    const insertProduct = db.prepare(`INSERT INTO products (name, description, category, price, stock, image_url, featured, old_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const starterProducts = [
      ['Sofa Verona 3 Lugares', 'Sofa confortavel com acabamento premium.', 'Sala', 2499.9, 10, 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc', 1, 2899.9],
      ['Mesa de Jantar Aurora', 'Mesa de madeira macica para 6 cadeiras.', 'Sala de Jantar', 1890.0, 8, 'https://images.unsplash.com/photo-1617806118233-18e1de247200', 0, null],
      ['Guarda-Roupa Elegance', 'Guarda-roupa com 3 portas de correr.', 'Quarto', 2199.5, 12, 'https://images.unsplash.com/photo-1615874959474-d609969a20ed', 0, null],
      ['Painel TV Horizonte', 'Painel para TV ate 70 polegadas.', 'Sala', 1299.0, 15, 'https://images.unsplash.com/photo-1582582429416-f64f0f9f4a6f', 1, 1499.0]
    ];
    for (const product of starterProducts) insertProduct.run(...product);
  }

  const categoryCount = db.prepare('SELECT COUNT(*) AS total FROM categories').get().total;
  if (categoryCount === 0) {
    const defaultCategories = ['Sala', 'Sala de Jantar', 'Quarto'];
    const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name, active) VALUES (?, 1)');
    for (const categoryName of defaultCategories) insertCategory.run(categoryName);
  }

  const usedCategories = db.prepare(`SELECT DISTINCT TRIM(COALESCE(category, '')) AS name FROM products WHERE TRIM(COALESCE(category, '')) <> ''`).all();
  const insertUsedCategory = db.prepare('INSERT OR IGNORE INTO categories (name, active) VALUES (?, 1)');
  for (const row of usedCategories) insertUsedCategory.run(row.name);

  const settingsExists = db.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (!settingsExists) {
    db.prepare(`INSERT INTO settings (id, phone, instagram, email, hero_title, hero_subtitle, banner_text) VALUES (1, ?, ?, ?, ?, ?, ?)`)
      .run('(11) 99999-9999', '@morenomoveis', 'contato@morenomoveis.com', 'Design, conforto e qualidade para seu lar.', 'Loja online oficial da Moreno Moveis.', 'Montagem e instalacao sem custo adicional.');
  }

  db.prepare(`UPDATE settings SET banner_text = ? WHERE id = 1 AND TRIM(COALESCE(banner_text, '')) = ?`)
    .run('Montagem e instalacao sem custo adicional.', 'Frete gratis em compras acima de R$ 300,00');

  const couponCount = db.prepare('SELECT COUNT(*) AS total FROM coupons').get().total;
  if (couponCount === 0) {
    db.prepare(`INSERT INTO coupons (code, type, value, min_total, active) VALUES (?, 'percent', 10, 100, 1)`).run('BEMVINDO10');
  }
}

initDb();

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token nao enviado.' });
  try {
    req.user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Token invalido.' });
  }
}

function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  return next();
}

function getPublicSettings() {
  const row = db.prepare('SELECT phone, instagram, email, hero_title, hero_subtitle, banner_text FROM settings WHERE id = 1').get();
  return {
    phone: row?.phone || '',
    instagram: row?.instagram || '',
    email: row?.email || '',
    heroTitle: row?.hero_title || '',
    heroSubtitle: row?.hero_subtitle || '',
    bannerText: row?.banner_text || ''
  };
}

function categoryExistsByName(name) {
  const normalized = cleanText(name);
  if (!normalized) return true;
  const row = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?) AND active = 1').get(normalized);
  return Boolean(row);
}

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'Moreno Moveis', timestamp: new Date().toISOString() });
});

app.get('/api/settings', (_req, res) => res.json(getPublicSettings()));

app.get('/api/categories', (_req, res) => {
  return res.json(db.prepare('SELECT id, name FROM categories WHERE active = 1 ORDER BY name ASC').all());
});

app.put('/api/admin/settings', authRequired, adminRequired, (req, res) => {
  const phone = cleanText(req.body.phone);
  const instagram = cleanText(req.body.instagram);
  const email = normalizeEmail(req.body.email);
  const heroTitle = cleanText(req.body.heroTitle);
  const heroSubtitle = cleanText(req.body.heroSubtitle);
  const bannerText = cleanText(req.body.bannerText);

  if (!phone || !instagram || !email || !heroTitle || !heroSubtitle || !bannerText) {
    return res.status(400).json({ error: 'Preencha todos os campos de configuracao.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Informe um e-mail valido.' });
  }

  db.prepare(`UPDATE settings SET phone = ?, instagram = ?, email = ?, hero_title = ?, hero_subtitle = ?, banner_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
    .run(phone, instagram, email, heroTitle, heroSubtitle, bannerText);

  return res.json({ message: 'Configuracoes atualizadas.', settings: getPublicSettings() });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password, phone, cpf, birthDate, zipCode, street, number, complement, neighborhood, city, state } = req.body;
  const normalizedEmail = normalizeEmail(email);

  if (!cleanText(name) || !normalizedEmail || !password || !cleanText(phone) || !cleanText(cpf) || !cleanText(zipCode) || !cleanText(street) || !cleanText(number) || !cleanText(neighborhood) || !cleanText(city) || !cleanText(state)) {
    return res.status(400).json({ error: 'Preencha todos os campos obrigatorios.' });
  }
  if (String(password).length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail)) return res.status(409).json({ error: 'E-mail ja cadastrado.' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`INSERT INTO users (name, email, password_hash, phone, cpf, birth_date, zip_code, street, number, complement, neighborhood, city, state, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'client')`)
    .run(cleanText(name), normalizedEmail, hash, cleanText(phone), cleanText(cpf), cleanText(birthDate) || null, cleanText(zipCode), cleanText(street), cleanText(number), cleanText(complement) || null, cleanText(neighborhood), cleanText(city), cleanText(state));

  return res.status(201).json({ id: result.lastInsertRowid, message: 'Conta criada com sucesso.' });
});

app.post('/api/auth/login', (req, res) => {
  const normalizedEmail = normalizeEmail(req.body.email);
  const password = req.body.password;
  if (!normalizedEmail || !password) return res.status(400).json({ error: 'Informe e-mail e senha.' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Credenciais invalidas.' });

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '8h' });
  return res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, city: user.city, state: user.state } });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) return res.status(400).json({ error: 'Informe o e-mail.' });

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) return res.json({ message: 'Se o e-mail existir, um link de recuperacao foi enviado.' });

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);

  const payload = { message: 'Link de recuperacao gerado (simulado).' };
  if (EXPOSE_RESET_TOKEN) payload.resetToken = token;
  return res.json(payload);
});

app.post('/api/auth/reset-password', (req, res) => {
  const token = cleanText(req.body.token);
  const newPassword = String(req.body.newPassword || '');
  if (!token || newPassword.length < 6) return res.status(400).json({ error: 'Token e nova senha (min. 6) sao obrigatorios.' });

  const row = db.prepare('SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0').get(token);
  if (!row || new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Token invalido ou expirado.' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), row.user_id);
  db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').run(row.id);
  return res.json({ message: 'Senha redefinida com sucesso.' });
});

app.get('/api/products', (req, res) => {
  const { search = '', category = '', minPrice = '', maxPrice = '', inStock = '', featured = '' } = req.query;
  const where = ['active = 1'];
  const params = [];
  const normalizedMinPrice = minPrice === '' ? null : Number(minPrice);
  const normalizedMaxPrice = maxPrice === '' ? null : Number(maxPrice);

  if (normalizedMinPrice !== null && (!Number.isFinite(normalizedMinPrice) || normalizedMinPrice < 0)) {
    return res.status(400).json({ error: 'Filtro minPrice invalido.' });
  }
  if (normalizedMaxPrice !== null && (!Number.isFinite(normalizedMaxPrice) || normalizedMaxPrice < 0)) {
    return res.status(400).json({ error: 'Filtro maxPrice invalido.' });
  }
  if (normalizedMinPrice !== null && normalizedMaxPrice !== null && normalizedMinPrice > normalizedMaxPrice) {
    return res.status(400).json({ error: 'minPrice nao pode ser maior que maxPrice.' });
  }

  if (search) {
    where.push('(LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(COALESCE(category, \'\')) LIKE ?)');
    const term = `%${String(search).toLowerCase()}%`;
    params.push(term, term, term);
  }
  if (category) {
    where.push('LOWER(COALESCE(category, \'\')) = ?');
    params.push(String(category).toLowerCase());
  }
  if (normalizedMinPrice !== null) { where.push('price >= ?'); params.push(normalizedMinPrice); }
  if (normalizedMaxPrice !== null) { where.push('price <= ?'); params.push(normalizedMaxPrice); }
  if (String(inStock) === '1') where.push('stock > 0');
  if (String(featured) === '1') where.push('featured = 1');

  const products = db.prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY featured DESC, created_at DESC`).all(...params);
  const reviewAgg = db.prepare(`SELECT product_id, ROUND(AVG(rating), 1) AS avg_rating, COUNT(*) AS total_reviews FROM reviews GROUP BY product_id`).all();
  const reviewByProductId = new Map(reviewAgg.map((r) => [r.product_id, r]));

  return res.json(products.map((p) => {
    const r = reviewByProductId.get(p.id);
    return { ...p, avg_rating: r ? Number(r.avg_rating) : null, total_reviews: r ? Number(r.total_reviews) : 0 };
  }));
});

app.get('/api/admin/products', authRequired, adminRequired, (_req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY created_at DESC').all());
});

app.get('/api/admin/categories', authRequired, adminRequired, (_req, res) => {
  return res.json(db.prepare('SELECT * FROM categories ORDER BY active DESC, name ASC').all());
});

app.post('/api/admin/categories', authRequired, adminRequired, (req, res) => {
  const name = cleanText(req.body.name);
  if (!name) return res.status(400).json({ error: 'Nome da categoria e obrigatorio.' });
  if (name.length > 80) return res.status(400).json({ error: 'Nome da categoria muito longo.' });
  const exists = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(name);
  if (exists) return res.status(409).json({ error: 'Categoria ja existe.' });

  try {
    const result = db.prepare('INSERT INTO categories (name, active) VALUES (?, 1)').run(name);
    return res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid));
  } catch {
    return res.status(409).json({ error: 'Categoria ja existe.' });
  }
});

app.put('/api/admin/categories/:id', authRequired, adminRequired, (req, res) => {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Categoria nao encontrada.' });

  const name = cleanText(req.body.name ?? existing.name);
  const active = req.body.active === undefined ? Number(existing.active) : Number(req.body.active ? 1 : 0);
  if (!name) return res.status(400).json({ error: 'Nome da categoria e obrigatorio.' });
  const duplicated = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?) AND id <> ?').get(name, req.params.id);
  if (duplicated) return res.status(409).json({ error: 'Ja existe outra categoria com esse nome.' });

  try {
    db.prepare('UPDATE categories SET name = ?, active = ? WHERE id = ?').run(name, active, req.params.id);
    return res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
  } catch {
    return res.status(409).json({ error: 'Ja existe outra categoria com esse nome.' });
  }
});

app.delete('/api/admin/categories/:id', authRequired, adminRequired, (req, res) => {
  const existing = db.prepare('SELECT id FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Categoria nao encontrada.' });
  db.prepare('UPDATE categories SET active = 0 WHERE id = ?').run(req.params.id);
  return res.json({ message: 'Categoria desativada.' });
});

app.get('/api/admin/stock-report', authRequired, adminRequired, (req, res) => {
  const productId = Number(req.query.productId || 0);
  const dateFrom = cleanText(req.query.dateFrom || '');
  const dateTo = cleanText(req.query.dateTo || '');
  const parsedDateFrom = parseDateBoundary(dateFrom, false);
  const parsedDateTo = parseDateBoundary(dateTo, true);

  if (parsedDateFrom?.error) return res.status(400).json({ error: `dateFrom invalida. ${parsedDateFrom.error}` });
  if (parsedDateTo?.error) return res.status(400).json({ error: `dateTo invalida. ${parsedDateTo.error}` });
  if (parsedDateFrom?.iso && parsedDateTo?.iso && parsedDateFrom.iso > parsedDateTo.iso) {
    return res.status(400).json({ error: 'dateFrom nao pode ser maior que dateTo.' });
  }

  const stockJoinFilters = [];
  const stockJoinParams = [];
  const movementWhere = [];
  const movementParams = [];
  const productWhere = [];
  const productParams = [];

  if (productId > 0) {
    productWhere.push('p.id = ?');
    productParams.push(productId);
    movementWhere.push('sm.product_id = ?');
    movementParams.push(productId);
  }

  if (parsedDateFrom?.iso) {
    stockJoinFilters.push('sm.created_at >= ?');
    stockJoinParams.push(parsedDateFrom.iso);
    movementWhere.push('sm.created_at >= ?');
    movementParams.push(parsedDateFrom.iso);
  }
  if (parsedDateTo?.iso) {
    stockJoinFilters.push('sm.created_at <= ?');
    stockJoinParams.push(parsedDateTo.iso);
    movementWhere.push('sm.created_at <= ?');
    movementParams.push(parsedDateTo.iso);
  }

  const joinFilterSql = stockJoinFilters.length ? ` AND ${stockJoinFilters.join(' AND ')}` : '';
  const productWhereSql = productWhere.length ? `WHERE ${productWhere.join(' AND ')}` : '';
  const movementWhereSql = movementWhere.length ? `WHERE ${movementWhere.join(' AND ')}` : '';

  const products = db.prepare(
    `SELECT
      p.id,
      p.name,
      p.stock,
      p.active,
      COALESCE(SUM(CASE WHEN sm.delta < 0 THEN -sm.delta ELSE 0 END), 0) AS sold_units
    FROM products p
    LEFT JOIN stock_movements sm ON sm.product_id = p.id${joinFilterSql}
    ${productWhereSql}
    GROUP BY p.id
    ORDER BY p.stock ASC, p.name ASC`
  ).all(...stockJoinParams, ...productParams);

  const movements = db.prepare(
    `SELECT sm.*, p.name AS product_name
     FROM stock_movements sm
     JOIN products p ON p.id = sm.product_id
     ${movementWhereSql}
     ORDER BY sm.created_at DESC
     LIMIT 80`
  ).all(...movementParams);

  return res.json({
    products: products.map((p) => ({ ...p, low_stock: Number(p.stock) <= 2 })),
    movements,
    filters: { productId: productId > 0 ? productId : null, dateFrom: dateFrom || null, dateTo: dateTo || null }
  });
});

app.get('/api/admin/users', authRequired, adminRequired, (_req, res) => {
  const users = db.prepare(
    `SELECT
      u.id,
      u.name,
      u.email,
      u.phone,
      u.cpf,
      u.city,
      u.state,
      u.role,
      u.created_at,
      COUNT(o.id) AS total_orders,
      COALESCE(SUM(o.total), 0) AS total_spent
    FROM users u
    LEFT JOIN orders o ON o.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC`
  ).all();

  return res.json(users);
});

app.post('/api/products', authRequired, adminRequired, (req, res) => {
  const { name, description, category, price, stock, imageUrl, featured, oldPrice } = req.body;
  const numericPrice = Number(price);
  const numericStock = Number(stock ?? 0);
  const numericOldPrice = oldPrice === '' || oldPrice === null || oldPrice === undefined ? null : Number(oldPrice);

  if (!cleanText(name) || !cleanText(description) || !Number.isFinite(numericPrice) || numericPrice <= 0) return res.status(400).json({ error: 'Nome, descricao e preco sao obrigatorios.' });
  if (cleanText(category) && !categoryExistsByName(category)) return res.status(400).json({ error: 'Categoria invalida. Cadastre a categoria no admin.' });
  if (!Number.isInteger(numericStock) || numericStock < 0) return res.status(400).json({ error: 'Estoque invalido.' });
  if (numericOldPrice !== null && (!Number.isFinite(numericOldPrice) || numericOldPrice <= 0)) return res.status(400).json({ error: 'Preco antigo invalido.' });

  const result = db.prepare(`INSERT INTO products (name, description, category, price, stock, image_url, featured, old_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(cleanText(name), cleanText(description), cleanText(category) || null, numericPrice, numericStock, cleanText(imageUrl) || null, featured ? 1 : 0, numericOldPrice);
  logStockMovement({
    productId: Number(result.lastInsertRowid),
    delta: numericStock,
    reason: 'admin_create',
    changedBy: req.user.id,
    note: 'Estoque inicial no cadastro'
  });
  return res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/products/:id', authRequired, adminRequired, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Produto nao encontrado.' });

  const next = {
    name: cleanText(req.body.name ?? existing.name),
    description: cleanText(req.body.description ?? existing.description),
    category: cleanText(req.body.category ?? existing.category),
    price: Number(req.body.price ?? existing.price),
    stock: Number(req.body.stock ?? existing.stock),
    imageUrl: cleanText(req.body.imageUrl ?? existing.image_url),
    active: req.body.active === undefined ? existing.active : Number(req.body.active),
    featured: req.body.featured === undefined ? existing.featured : Number(req.body.featured ? 1 : 0),
    oldPrice: req.body.oldPrice === '' || req.body.oldPrice === null || req.body.oldPrice === undefined ? existing.old_price : Number(req.body.oldPrice)
  };

  if (!next.name || !next.description || !Number.isFinite(next.price) || next.price <= 0) return res.status(400).json({ error: 'Dados invalidos para atualizar o produto.' });
  if (next.category && next.category !== existing.category && !categoryExistsByName(next.category)) return res.status(400).json({ error: 'Categoria invalida. Cadastre a categoria no admin.' });
  if (!Number.isInteger(next.stock) || next.stock < 0) return res.status(400).json({ error: 'Estoque invalido.' });
  if (next.oldPrice !== null && (!Number.isFinite(next.oldPrice) || next.oldPrice <= 0)) return res.status(400).json({ error: 'Preco antigo invalido.' });

  db.prepare(`UPDATE products SET name = ?, description = ?, category = ?, price = ?, stock = ?, image_url = ?, active = ?, featured = ?, old_price = ? WHERE id = ?`)
    .run(next.name, next.description, next.category, next.price, next.stock, next.imageUrl, next.active, next.featured, next.oldPrice, id);
  const delta = next.stock - Number(existing.stock || 0);
  if (delta !== 0) {
    logStockMovement({
      productId: Number(id),
      delta,
      reason: 'admin_update',
      changedBy: req.user.id,
      note: 'Ajuste manual de estoque'
    });
  }

  return res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
});

app.delete('/api/products/:id', authRequired, adminRequired, (req, res) => {
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Produto nao encontrado.' });
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  return res.json({ message: 'Produto removido da vitrine.' });
});

app.get('/api/products/:id/reviews', (req, res) => {
  const reviews = db.prepare(`SELECT r.id, r.rating, r.comment, r.created_at, u.name AS user_name FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.product_id = ? ORDER BY r.created_at DESC`).all(req.params.id);
  return res.json(reviews);
});

app.post('/api/products/:id/reviews', authRequired, (req, res) => {
  const rating = Number(req.body.rating);
  const comment = cleanText(req.body.comment || '');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Nota invalida. Use de 1 a 5.' });

  const purchased = db.prepare(`SELECT oi.id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = ? AND o.user_id = ? LIMIT 1`).get(req.params.id, req.user.id);
  if (!purchased) return res.status(403).json({ error: 'Voce so pode avaliar produtos comprados.' });

  db.prepare(`INSERT INTO reviews (product_id, user_id, rating, comment) VALUES (?, ?, ?, ?) ON CONFLICT(product_id, user_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, created_at = CURRENT_TIMESTAMP`)
    .run(req.params.id, req.user.id, rating, comment || null);

  return res.status(201).json({ message: 'Avaliacao salva.' });
});

app.get('/api/favorites', authRequired, (req, res) => {
  const favorites = db.prepare(`SELECT p.* FROM favorites f JOIN products p ON p.id = f.product_id WHERE f.user_id = ? AND p.active = 1 ORDER BY f.created_at DESC`).all(req.user.id);
  return res.json(favorites);
});

app.post('/api/favorites/:productId', authRequired, (req, res) => {
  const product = db.prepare('SELECT id FROM products WHERE id = ? AND active = 1').get(req.params.productId);
  if (!product) return res.status(404).json({ error: 'Produto nao encontrado.' });
  db.prepare(`INSERT INTO favorites (user_id, product_id) VALUES (?, ?) ON CONFLICT(user_id, product_id) DO NOTHING`).run(req.user.id, req.params.productId);
  return res.status(201).json({ message: 'Adicionado aos favoritos.' });
});

app.delete('/api/favorites/:productId', authRequired, (req, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND product_id = ?').run(req.user.id, req.params.productId);
  return res.json({ message: 'Removido dos favoritos.' });
});

app.get('/api/admin/coupons', authRequired, adminRequired, (_req, res) => {
  res.json(db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all());
});

app.post('/api/admin/coupons', authRequired, adminRequired, (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const type = req.body.type;
  const value = Number(req.body.value);
  const minTotal = Number(req.body.minTotal || 0);
  const expiresAt = cleanText(req.body.expiresAt || null);

  if (!code || !['percent', 'fixed'].includes(type) || !Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'Dados do cupom invalidos.' });
  if (type === 'percent' && value > 100) return res.status(400).json({ error: 'Cupom percentual deve ser <= 100.' });

  try {
    const result = db.prepare(`INSERT INTO coupons (code, type, value, min_total, expires_at, active) VALUES (?, ?, ?, ?, ?, 1)`).run(code, type, value, Number.isFinite(minTotal) ? minTotal : 0, expiresAt || null);
    return res.status(201).json(db.prepare('SELECT * FROM coupons WHERE id = ?').get(result.lastInsertRowid));
  } catch {
    return res.status(409).json({ error: 'Codigo de cupom ja existe.' });
  }
});

app.post('/api/coupons/validate', (req, res) => {
  const subtotal = Number(req.body.subtotal || 0);
  const couponCode = req.body.couponCode;
  if (!couponCode) return res.json({ valid: false, discount: 0, message: 'Informe um cupom.' });

  try {
    const applied = applyCouponToSubtotal(subtotal, couponCode);
    return res.json({ valid: true, discount: applied.discount, code: applied.coupon.code });
  } catch (error) {
    return res.json({ valid: false, discount: 0, message: error.message });
  }
});

app.post('/api/shipping/calculate', (req, res) => {
  const normalizedCity = normalizeShippingCity(req.body.shippingCity);
  if (!ALLOWED_SHIPPING_CITIES.includes(normalizedCity)) {
    return res.status(400).json({ error: 'Frete disponível somente para Paulo de Faria, Orindiúva e São José do Rio Preto.' });
  }
  const shipping = calcShippingByZip(cleanText(req.body.zipCode || ''), Number(req.body.subtotal || 0), normalizedCity);
  return res.json(shipping);
});

app.get('/api/orders/my', authRequired, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  const itemStmt = db.prepare(`SELECT oi.*, p.name AS product_name FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`);
  const historyStmt = db.prepare(`SELECT status, note, created_at FROM order_status_history WHERE order_id = ? ORDER BY created_at DESC`);
  return res.json(orders.map((order) => ({ ...order, items: itemStmt.all(order.id), history: historyStmt.all(order.id) })));
});

app.get('/api/admin/orders', authRequired, adminRequired, (_req, res) => {
  const orders = db.prepare(`SELECT o.*, u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC`).all();
  const itemStmt = db.prepare(`SELECT oi.*, p.name AS product_name FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`);
  const historyStmt = db.prepare(`SELECT status, note, created_at FROM order_status_history WHERE order_id = ? ORDER BY created_at DESC`);
  return res.json(orders.map((o) => ({ ...o, items: itemStmt.all(o.id), history: historyStmt.all(o.id) })));
});

app.put('/api/admin/orders/:id/status', authRequired, adminRequired, (req, res) => {
  const status = cleanText(req.body.status);
  const note = cleanText(req.body.note || '');
  const allowed = ['Aguardando fechamento no WhatsApp', 'Em separacao', 'Enviado', 'Venda finalizada', 'Cancelado'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Status invalido.' });

  const order = db.prepare('SELECT id, stock_applied FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido nao encontrado.' });

  if (status === 'Venda finalizada' && Number(order.stock_applied) === 0) {
    const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(req.params.id);
    const getProduct = db.prepare('SELECT id, name, stock FROM products WHERE id = ?');
    const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');

    for (const item of items) {
      const product = getProduct.get(item.product_id);
      if (!product || Number(product.stock) < Number(item.quantity)) {
        return res.status(400).json({ error: `Estoque insuficiente para finalizar. Produto: ${product?.name || item.product_id}.` });
      }
    }

    for (const item of items) {
      updateStock.run(item.quantity, item.product_id);
      logStockMovement({
        productId: item.product_id,
        delta: -Number(item.quantity),
        reason: 'order_finalized',
        referenceOrderId: Number(req.params.id),
        changedBy: req.user.id,
        note: `Saida por venda finalizada #${req.params.id}`
      });
    }

    db.prepare('UPDATE orders SET stock_applied = 1 WHERE id = ?').run(req.params.id);
  }

  const paymentStatus = status === 'Venda finalizada'
    ? 'Pago no fechamento WhatsApp'
    : status === 'Cancelado'
      ? 'Cancelado'
      : 'Aguardando fechamento WhatsApp';
  db.prepare('UPDATE orders SET status = ?, payment_status = ? WHERE id = ?').run(status, paymentStatus, req.params.id);
  db.prepare(`INSERT INTO order_status_history (order_id, status, note, changed_by, created_at) VALUES (?, ?, ?, ?, ?)`).run(req.params.id, status, note || null, req.user.id, nowSql());
  return res.json({ message: 'Status atualizado.' });
});

app.post('/api/orders', authRequired, (req, res) => {
  const {
    items,
    paymentMethod,
    paymentInstallments,
    cashChangeFor,
    paymentProof,
    couponCode,
    shippingZip,
    shippingCity,
    shippingStreet,
    shippingNumber,
    shippingComplement,
    shippingNeighborhood,
    shippingState
  } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Carrinho vazio.' });
  if (!['pix', 'cash', 'credit', 'debit'].includes(paymentMethod)) return res.status(400).json({ error: 'Forma de pagamento invalida.' });
  const normalizedShippingCity = normalizeShippingCity(shippingCity);
  if (!ALLOWED_SHIPPING_CITIES.includes(normalizedShippingCity)) {
    return res.status(400).json({ error: 'Entregamos somente em Paulo de Faria, Orindiúva e São José do Rio Preto.' });
  }
  if (!cleanText(shippingZip) || !cleanText(shippingStreet) || !cleanText(shippingNumber) || !cleanText(shippingNeighborhood) || !cleanText(shippingState)) {
    return res.status(400).json({ error: 'Preencha o endereco completo para entrega.' });
  }

  const productById = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1');
  let subtotal = 0;
  const validatedItems = [];

  for (const item of items) {
    const product = productById.get(item.productId);
    if (!product) return res.status(404).json({ error: `Produto ${item.productId} nao encontrado.` });

    const quantity = Number(item.quantity || 1);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > product.stock) return res.status(400).json({ error: `Estoque invalido para ${product.name}.` });

    subtotal += quantity * Number(product.price);
    validatedItems.push({ product, quantity });
  }

  let discountTotal = 0;
  let appliedCouponCode = null;
  try {
    const applied = applyCouponToSubtotal(subtotal, couponCode);
    discountTotal = applied.discount;
    appliedCouponCode = applied.coupon?.code || null;
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const shipping = calcShippingByZip(shippingZip, subtotal - discountTotal, normalizedShippingCity);
  const total = Number(Math.max(0, subtotal - discountTotal + shipping.cost).toFixed(2));

  const installments = paymentMethod === 'credit' ? Number(paymentInstallments || 1) : 1;
  if (!Number.isInteger(installments) || installments < 1 || installments > 8) {
    return res.status(400).json({ error: 'Parcelamento inválido. Use de 1x a 8x.' });
  }

  const parsedCashChangeFor = paymentMethod === 'cash' && cashChangeFor !== null && cashChangeFor !== undefined && cashChangeFor !== ''
    ? Number(cashChangeFor)
    : null;
  if (parsedCashChangeFor !== null && (!Number.isFinite(parsedCashChangeFor) || parsedCashChangeFor < total)) {
    return res.status(400).json({ error: 'Troco inválido. Informe um valor maior ou igual ao total.' });
  }
  const normalizedPaymentProof = cleanText(paymentProof || null);
  if (normalizedPaymentProof && String(normalizedPaymentProof).length > 500) {
    return res.status(400).json({ error: 'Comprovante muito longo. Limite de 500 caracteres.' });
  }

  const paymentStatus = 'Aguardando fechamento WhatsApp';
  const pixCode = paymentMethod === 'pix' ? `PIX-MORENO-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}` : null;

  const orderResult = db.prepare(`INSERT INTO orders (user_id, subtotal, discount_total, total, coupon_code, shipping_zip, shipping_city, shipping_street, shipping_number, shipping_complement, shipping_neighborhood, shipping_state, shipping_cost, shipping_days, payment_method, payment_installments, cash_change_for, payment_proof, payment_status, pix_code, status, stock_applied) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      req.user.id,
      Number(subtotal.toFixed(2)),
      Number(discountTotal.toFixed(2)),
      total,
      appliedCouponCode,
      cleanText(shippingZip) || null,
      cleanText(shippingCity) || null,
      cleanText(shippingStreet) || null,
      cleanText(shippingNumber) || null,
      cleanText(shippingComplement) || null,
      cleanText(shippingNeighborhood) || null,
      cleanText(shippingState) || null,
      shipping.cost,
      shipping.days,
      paymentMethod,
      installments,
      parsedCashChangeFor,
      normalizedPaymentProof,
      paymentStatus,
      pixCode,
      'Aguardando fechamento no WhatsApp',
      0
    );

  const orderId = Number(orderResult.lastInsertRowid);
  const insertItem = db.prepare(`INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)`);

  for (const item of validatedItems) {
    insertItem.run(orderId, item.product.id, item.quantity, item.product.price);
  }

  db.prepare(`INSERT INTO order_status_history (order_id, status, note, changed_by, created_at) VALUES (?, ?, ?, ?, ?)`).run(orderId, 'Aguardando fechamento no WhatsApp', normalizedPaymentProof ? 'Pedido criado e enviado para fechamento no WhatsApp (com comprovante informado)' : 'Pedido criado e enviado para fechamento no WhatsApp', req.user.id, nowSql());

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const customer = db.prepare('SELECT name, email, phone FROM users WHERE id = ?').get(req.user.id);
  const paymentLabel = paymentMethod === 'pix'
    ? 'PIX'
    : paymentMethod === 'cash'
      ? `Dinheiro${parsedCashChangeFor ? ` (troco para ${formatMoney(parsedCashChangeFor)})` : ''}`
      : paymentMethod === 'credit'
        ? `Credito em ${installments}x`
        : 'Debito';
  const itemsSummary = validatedItems.map((i) => `${i.product.name} x${i.quantity} (${formatMoney(i.product.price * i.quantity)})`).join('; ');
  const fullAddress = `${cleanText(shippingStreet) || '-'}, ${cleanText(shippingNumber) || '-'}${cleanText(shippingComplement) ? `, ${cleanText(shippingComplement)}` : ''} - ${cleanText(shippingNeighborhood) || '-'}, ${cleanText(shippingCity) || '-'}/${cleanText(shippingState) || '-'} - CEP ${cleanText(shippingZip) || '-'}`;
  return res.status(201).json({
    message: 'Pedido criado com sucesso.',
    order,
    pixCode,
    subtotal: Number(subtotal.toFixed(2)),
    discountTotal: Number(discountTotal.toFixed(2)),
    shippingCost: shipping.cost,
    shippingDays: shipping.days,
    whatsappText:
      `Novo pedido Moreno Moveis #${order.id}\n` +
      `Cliente: ${customer?.name || req.user.name || '-'}\n` +
      `Contato: ${customer?.phone || '-'} | ${customer?.email || req.user.email || '-'}\n` +
      `Itens: ${itemsSummary}\n` +
      `Pagamento: ${paymentLabel}\n` +
      `Comprovante: ${normalizedPaymentProof || 'Nao informado'}\n` +
      `Subtotal: ${formatMoney(subtotal)}\n` +
      `Desconto: ${formatMoney(discountTotal)}${appliedCouponCode ? ` (cupom ${appliedCouponCode})` : ''}\n` +
      `Frete: ${formatMoney(shipping.cost)} (${shipping.days} dias)\n` +
      `Total: ${formatMoney(order.total)}\n` +
      `Entrega: ${fullAddress}`
  });
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Moreno Moveis rodando em http://localhost:${PORT}`);
});
