require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

const activeSessions = new Map();

// Railway/HTTPS proxy trust
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// iFrame entegrasyonu için header'lar (Domain Kısıtlaması)
app.use((req, res, next) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';

  // Güvenlik Header'ları
  res.setHeader('Content-Security-Policy', `frame-ancestors ${allowedOrigin}`);

  // ALLOWALL yerine ALLOW-FROM (Eski tarayıcılar için)
  if (allowedOrigin === '*') {
    res.setHeader('X-Frame-Options', 'ALLOWALL');
  } else {
    res.setHeader('X-Frame-Options', `ALLOW-FROM ${allowedOrigin}`);
  }

  next();
});

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token || !activeSessions.has(token)) {
    return res.status(401).json({ error: 'Yetkisiz erişim' });
  }

  next();
}

// MySQL Bağlantı Havuzu
const dbConfig = process.env.MYSQL_URL || process.env.DATABASE_URL || {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'beni_ara',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

console.log('Connecting to database using:', typeof dbConfig === 'string' ? 'Connection String' : `Host: ${dbConfig.host}`);

const pool = mysql.createPool(dbConfig);

// Veritabanı ve Tablo Kurulumu
async function initializeDatabase() {
  try {
    // Tabloları oluştur
    await pool.query(`
      CREATE TABLE IF NOT EXISTS call_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        username VARCHAR(255),
        phone VARCHAR(20) NOT NULL,
        message TEXT,
        status VARCHAR(50) DEFAULT 'boşta',
        assigned_to VARCHAR(255),
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS request_notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        request_id INT NOT NULL,
        note TEXT NOT NULL,
        created_by VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES call_requests(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        action VARCHAR(255) NOT NULL,
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        setting_key VARCHAR(255) UNIQUE NOT NULL,
        setting_value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS media (
        id INT AUTO_INCREMENT PRIMARY KEY,
        media_key VARCHAR(255) UNIQUE NOT NULL,
        media_data LONGBLOB NOT NULL,
        mime_type VARCHAR(100) NOT NULL DEFAULT 'image/png',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Default ayarları ekle (yoksa)
    const defaultSettings = [
      ['redirect_url', 'https://makibet.com'],
      ['primary_color', '#43EA80'],
      ['secondary_color', '#38F8D4'],
      ['form_title', 'Maki Aranma Talep'],
      ['form_subtitle', 'Formu doldurun, en kısa sürede arayalım'],
      ['button_text', 'Gönder'],
      ['back_button_text', 'Güncel Siteye Geri Dön'],
      ['page_title', 'Maki Aranma Talep'],
      ['logo_data', ''],
      ['background_data', ''],
    ];
    for (const [key, value] of defaultSettings) {
      await pool.query(
        `INSERT IGNORE INTO settings (setting_key, setting_value) VALUES (?, ?)`,
        [key, value]
      );
    }

    // TEXT kolonunu MEDIUMTEXT yap (base64 gorsel icin yeterli boyut)
    try {
      await pool.query('ALTER TABLE settings MODIFY COLUMN setting_value MEDIUMTEXT');
    } catch (e) { /* zaten dogru tipte olabilir */ }

    console.log('MySQL Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
  }
}

initializeDatabase();

let bot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
}

async function logAction(username, action, details) {
  try {
    await pool.query('INSERT INTO audit_logs (username, action, details) VALUES (?, ?, ?)', [username, action, details]);
  } catch (err) {
    console.error('Audit log failed:', err);
  }
}

// Ayarlar API'si
app.get('/api/settings', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM settings');
    const settings = {};
    rows.forEach(r => { settings[r.setting_key] = r.setting_value; });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Ayarlar alınamadı' });
  }
});

app.put('/api/settings', authMiddleware, async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'key gerekli' });
    await pool.query(
      'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
      [key, value, value]
    );
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const session = activeSessions.get(token);
    const username = session ? session.username : 'unknown';
    await logAction(username, 'Ayar Güncellendi', `${key} = ${value}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ayar güncellenemedi' });
  }
});


function sendTelegramNotification(request) {
  if (!bot || !process.env.TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured');
    return;
  }

  const message = `
🔔 *Yeni Aranma Talebi*

👤 *İsim:* ${request.name}
📱 *Telefon:* ${request.phone}
${request.username ? `💬 *Kullanıcı Adı:* ${request.username}\n` : ''}${request.message ? `📝 *Mesaj:* ${request.message}\n` : ''}
🆔 *Talep ID:* ${request.id}
  `;

  bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' })
    .catch(err => console.error('Telegram error:', err));
}

// İlk kurulum: admin var mı?
app.get('/api/setup/status', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT COUNT(*) as count FROM users WHERE role = ?', ['admin']);
    res.json({ needsSetup: rows[0].count === 0 });
  } catch (error) {
    res.status(500).json({ error: 'Durum kontrol edilemedi' });
  }
});

// İlk kurulum: ilk admin oluştur (yalnızca admin yoksa çalışır)
app.post('/api/setup', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT COUNT(*) as count FROM users WHERE role = ?', ['admin']);
    if (rows[0].count > 0) {
      return res.status(403).json({ error: 'Kurulum zaten tamamlanmış' });
    }

    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Kullanıcı adı ve şifre zorunludur' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Şifre en az 6 karakter olmalıdır' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, 'admin']);
    console.log('First admin created via setup:', username);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Kurulum tamamlanamadı' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    const user = rows[0];

    if (user && await bcrypt.compare(password, user.password)) {
      const token = crypto.randomBytes(32).toString('hex');
      activeSessions.set(token, { username: user.username, role: user.role, loginTime: Date.now() });

      setTimeout(() => activeSessions.delete(token), 24 * 60 * 60 * 1000);

      res.json({ success: true, token, role: user.role });
    } else {
      res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Giriş işlemi sırasında hata oluştu' });
  }
});

function adminMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token || !activeSessions.has(token)) {
    return res.status(401).json({ error: 'Yetkisiz erişim' });
  }

  const session = activeSessions.get(token);
  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'Bu işlem için admin yetkisi gereklidir' });
  }

  req.user = session;
  next();
}

app.get('/api/users', adminMiddleware, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Kullanıcılar alınamadı' });
  }
});

app.post('/api/users', adminMiddleware, async (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre gereklidir' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, role || 'user']);
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Bu kullanıcı adı zaten kullanılıyor' });
    } else {
      res.status(500).json({ error: 'Kullanıcı oluşturulamadı' });
    }
  }
});

app.put('/api/users/:id', adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const { username, password, role } = req.body;

  try {
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?', [username, hashedPassword, role, id]);
    } else {
      await pool.query('UPDATE users SET username = ?, role = ? WHERE id = ?', [username, role, id]);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: 'Kullanıcı güncellenemedi' });
  }
});

app.delete('/api/users/:id', adminMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const [userRows] = await pool.query('SELECT username, role FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const targetUser = userRows[0].username;
    const userRole = userRows[0].role;

    if (userRole === 'admin') {
      const [adminCountRows] = await pool.query('SELECT COUNT(*) as count FROM users WHERE role = ?', ['admin']);
      if (adminCountRows[0].count <= 1) {
        return res.status(400).json({ error: 'Son admin kullanıcısı silinemez' });
      }
    }

    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    logAction(req.user.username, 'Kullanıcı Silindi', `Kullanıcı: ${targetUser}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Kullanıcı silinemedi' });
  }
});

app.post('/api/requests', async (req, res) => {
  const { name, username, phone, message } = req.body;

  if (!name || !phone || !username || !message) {
    return res.status(400).json({ error: 'Tüm alanlar zorunludur' });
  }

  try {
    const [result] = await pool.query(`
      INSERT INTO call_requests (name, username, phone, message, status)
      VALUES (?, ?, ?, ?, 'boşta')
    `, [name, username, phone, message]);

    const newRequest = {
      id: result.insertId,
      name,
      username,
      phone,
      message,
      status: 'boşta'
    };

    sendTelegramNotification(newRequest);

    res.json({ success: true, id: result.insertId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Talep oluşturulamadı' });
  }
});

app.get('/api/requests', authMiddleware, async (req, res) => {
  try {
    const [requests] = await pool.query('SELECT * FROM call_requests ORDER BY created_at DESC');
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: 'Talepler getirilemedi' });
  }
});

app.put('/api/requests/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status, assigned_to, reason } = req.body;

  try {
    const [oldRows] = await pool.query('SELECT status FROM call_requests WHERE id = ?', [id]);
    const oldStatus = oldRows[0] ? oldRows[0].status : 'bilinmiyor';

    await pool.query(`
      UPDATE call_requests 
      SET status = ?, assigned_to = ?, reason = ?
      WHERE id = ?
    `, [status, assigned_to || null, reason || null, id]);

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const session = activeSessions.get(token);
    logAction(session.username, 'Talep Güncellendi', `ID: ${id}, Eski Durum: ${oldStatus}, Yeni Durum: ${status}`);

    res.json({ success: true });
  } catch (error) {
    console.error('PUT /api/requests/:id error:', error);
    res.status(500).json({ error: 'Talep güncellenemedi: ' + error.message });
  }
});

app.delete('/api/requests/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM call_requests WHERE id = ?', [id]);

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const session = activeSessions.get(token);
    logAction(session.username, 'Talep Silindi', `ID: ${id}`);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Talep silinemedi' });
  }
});

// Elite Dashboard: Bulk Actions
app.post('/api/requests/bulk', authMiddleware, async (req, res) => {
  const { ids, action, status } = req.body;
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const session = activeSessions.get(token);

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Geçersiz ID listesi' });
  }

  try {
    if (action === 'delete') {
      await pool.query('DELETE FROM call_requests WHERE id IN (?)', [ids]);
      logAction(session.username, 'Toplu Silme', `${ids.length} adet talep silindi. IDler: ${ids.join(',')}`);
    } else if (action === 'update' && status) {
      await pool.query('UPDATE call_requests SET status = ? WHERE id IN (?)', [status, ids]);
      logAction(session.username, 'Toplu Güncelleme', `${ids.length} adet talep "${status}" yapıldı.`);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Toplu işlem başarısız oldu' });
  }
});

// Elite Dashboard: Hourly Stats for Chart
app.get('/api/stats/hourly', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        DATE_FORMAT(created_at, '%H:00') as hour,
        COUNT(*) as count
      FROM call_requests
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY hour
      ORDER BY hour ASC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'İstatistikler alınamadı' });
  }
});

// Elite Dashboard: Audit Logs
app.get('/api/admin/audit-logs', adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Loglar alınamadı' });
  }
});

app.get('/api/requests/:id/notes', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const [notes] = await pool.query('SELECT * FROM request_notes WHERE request_id = ? ORDER BY created_at DESC', [id]);
    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: 'Notlar getirilemedi' });
  }
});

app.post('/api/requests/:id/notes', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { note } = req.body;
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const session = activeSessions.get(token);

  if (!note) {
    return res.status(400).json({ error: 'Not gereklidir' });
  }

  try {
    await pool.query('INSERT INTO request_notes (request_id, note, created_by) VALUES (?, ?, ?)', [id, note, session.username]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Not eklenemedi' });
  }
});

const fs = require('fs');

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function hexToRgb(hex) {
  const r = /^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i.exec(hex);
  return r ? `${parseInt(r[1],16)}, ${parseInt(r[2],16)}, ${parseInt(r[3],16)}` : '67, 234, 128';
}

// Logo ve arka plan yükleme (binary BLOB olarak sakla)
app.post('/api/upload/logo', authMiddleware, async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'data gerekli' });
  try {
    const m = data.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'Geçersiz format' });
    const buf = Buffer.from(m[2], 'base64');
    await pool.query(
      'INSERT INTO media (media_key, media_data, mime_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE media_data=?, mime_type=?',
      ['logo', buf, m[1], buf, m[1]]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Yükleme başarısız' }); }
});

app.post('/api/upload/background', authMiddleware, async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'data gerekli' });
  try {
    const m = data.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'Geçersiz format' });
    const buf = Buffer.from(m[2], 'base64');
    await pool.query(
      'INSERT INTO media (media_key, media_data, mime_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE media_data=?, mime_type=?',
      ['background', buf, m[1], buf, m[1]]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Yükleme başarısız' }); }
});

app.get('/api/logo', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  try {
    const [rows] = await pool.query("SELECT media_data, mime_type FROM media WHERE media_key='logo'");
    if (rows.length > 0) {
      res.set('Content-Type', rows[0].mime_type);
      return res.send(rows[0].media_data);
    }
  } catch (e) {}
  res.sendFile(path.join(__dirname, 'public', 'logo.png'));
});

app.get('/api/background', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  try {
    const [rows] = await pool.query("SELECT media_data, mime_type FROM media WHERE media_key='background'");
    if (rows.length > 0) {
      res.set('Content-Type', rows[0].mime_type);
      return res.send(rows[0].media_data);
    }
  } catch (e) {}
  res.sendFile(path.join(__dirname, 'public', 'background.png'));
});

// Ana form sayfası: branding ayarlarını server-side inject et (FOUC önleme)
app.get('/', async (req, res) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  try {
    let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

    let settings = {};
    try {
      const [rows] = await pool.query('SELECT setting_key, setting_value FROM settings');
      rows.forEach(r => { settings[r.setting_key] = r.setting_value; });
    } catch (e) {}

    const primary   = settings.primary_color  || '#43EA80';
    const secondary = settings.secondary_color || '#38F8D4';
    const mediaV = Date.now();
    const vars = `:root{--accent-start:${primary};--accent-end:${secondary};--accent-gradient:linear-gradient(135deg,${primary},${secondary});--accent-rgb:${hexToRgb(primary)};--bg-image:url('/api/background?v=${mediaV}');}`;
    html = html.replace('</head>', `<style>${vars}</style>\n</head>`);

    // Logo -> API endpoint
    html = html.replace('id="siteLogo" src="logo.png"', `id="siteLogo" src="/api/logo?v=${mediaV}"`);

    // Metinler
    if (settings.page_title)       html = html.replace('>Maki Aranma Talep</title>',                                                  `>${escHtml(settings.page_title)}</title>`);
    if (settings.form_title)       html = html.replace('>Maki Aranma Talep</h1>',                                                     `>${escHtml(settings.form_title)}</h1>`);
    if (settings.form_subtitle)    html = html.replace('>Formu doldurun, en kısa sürede arayalım</p>',                                `>${escHtml(settings.form_subtitle)}</p>`);
    if (settings.button_text)      html = html.replace('>Gönder</span>',                                                              `>${escHtml(settings.button_text)}</span>`);
    if (settings.back_button_text) html = html.replace('>Güncel Siteye Geri Dön</span>',                                             `>${escHtml(settings.back_button_text)}</span>`);
    if (settings.redirect_url)     html = html.replace('id="returnSiteBtn" href="#"', `id="returnSiteBtn" href="${escHtml(settings.redirect_url)}"`);

    html = html.replace('</body>', `\n    <script>window.ALLOWED_ORIGIN = "${allowedOrigin}";</script>\n</body>`);
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading page');
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
