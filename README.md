# Beni Ara - Aranma Talebi Sistemi

Telegram entegrasyonlu modern aranma talebi yönetim sistemi.

## Özellikler

### Müşteri Tarafı
- Modern ve responsive form arayüzü
- İsim, kullanıcı adı, telefon ve mesaj alanları
- Otomatik Telegram bildirimi
- Anlık geri bildirim

### Yönetim Paneli
- Tüm talepleri görüntüleme
- Üç durum: Boşta, İşlemde, Arandı
- Talepleri üstüne alma ve tamamlama
- Gerçek zamanlı istatistikler
- Durum filtreleme
- Otomatik yenileme (10 saniye)

## Kurulum

### 1. Bağımlılıkları Yükleyin

```bash
npm install
```

### 2. Telegram Bot Oluşturun

1. Telegram'da [@BotFather](https://t.me/botfather) ile konuşun
2. `/newbot` komutunu gönderin
3. Bot adı ve kullanıcı adı belirleyin
4. Bot token'ınızı alın
5. Chat ID'nizi öğrenmek için [@userinfobot](https://t.me/userinfobot) kullanın

### 3. Ortam Değişkenlerini Ayarlayın

`.env.example` dosyasını `.env` olarak kopyalayın ve düzenleyin:

```bash
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_CHAT_ID=your_telegram_chat_id_here
PORT=3000
```

### 4. Uygulamayı Başlatın

```bash
npm start
```

Geliştirme modu için (otomatik yeniden başlatma):

```bash
npm run dev
```

## Kullanım

- **Ana Sayfa (Müşteri):** http://localhost:3000
- **Yönetim Paneli:** http://localhost:3000/admin

## API Endpoints

- `POST /api/requests` - Yeni talep oluştur
- `GET /api/requests` - Tüm talepleri getir
- `PUT /api/requests/:id` - Talep durumunu güncelle
- `DELETE /api/requests/:id` - Talebi sil

## Teknolojiler

- **Backend:** Node.js, Express.js
- **Database:** SQLite3 (better-sqlite3)
- **Telegram:** node-telegram-bot-api
- **Frontend:** Vanilla JavaScript, Modern CSS

## Yapı

```
beni-ara/
├── public/
│   ├── index.html      # Müşteri formu
│   ├── admin.html      # Yönetim paneli
│   ├── app.js          # Form JavaScript
│   ├── admin.js        # Panel JavaScript
│   └── styles.css      # Tüm stiller
├── server.js           # Express sunucu
├── package.json
├── .env.example
└── README.md
```

## Güvenlik Notları

- `.env` dosyasını asla paylaşmayın
- Production'da güvenli bir veritabanı kullanın
- Admin paneline kimlik doğrulama ekleyin
- HTTPS kullanın

## Lisans

MIT
