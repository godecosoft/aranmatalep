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
app.use(express.json());
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
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'beni_ara',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

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

    // Admin kullanıcısını kontrol et ve oluştur
    const [rows] = await pool.query('SELECT COUNT(*) as count FROM users WHERE role = ?', ['admin']);
    if (rows[0].count === 0) {
      const defaultUsername = process.env.ADMIN_USERNAME || 'admin';
      const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      await pool.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [defaultUsername, hashedPassword, 'admin']);
      console.log('Default admin user created');
    }

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
    const [userRows] = await pool.query('SELECT role FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const userRole = userRows[0].role;

    if (userRole === 'admin') {
      const [adminCountRows] = await pool.query('SELECT COUNT(*) as count FROM users WHERE role = ?', ['admin']);
      if (adminCountRows[0].count <= 1) {
        return res.status(400).json({ error: 'Son admin kullanıcısı silinemez' });
      }
    }

    await pool.query('DELETE FROM users WHERE id = ?', [id]);
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
    await pool.query(`
      UPDATE call_requests 
      SET status = ?, assigned_to = ?, reason = ?
      WHERE id = ?
    `, [status, assigned_to || null, reason || null, id]);

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
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Talep silinemedi' });
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

app.get('/', (req, res) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  const indexPath = path.join(__dirname, 'public', 'index.html');

  fs.readFile(indexPath, 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error loading page');
    }

    // Inject the allowed origin before the app.js script
    const injectedData = data.replace(
      '</body>',
      `\n    <script>window.ALLOWED_ORIGIN = "${allowedOrigin}";</script>\n</body>`
    );

    res.send(injectedData);
  });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
