const { WebcastPushConnection } = require('tiktok-live-connector');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// ===================================================================
//  HTTP — раздаёт index.html + /ping для keep-alive
// ===================================================================
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/' || req.url === '/index.html') {
    const file = path.join(__dirname, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(500); res.end('Ошибка чтения index.html'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // ✅ FIX 1: Health-check endpoint для UptimeRobot / Railway
  // Зарегистрируй на https://uptimerobot.com → Monitor Type: HTTP(s)
  // URL: https://твой-сервис.railway.app/ping  Interval: 5 min
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ===================================================================
//  WebSocket
// ===================================================================
const wss = new WebSocket.Server({ server });

const GIFT_MAP = {
  5655:  { name: 'Роза',       emoji: '🌹', coins: 10 },
  6104:  { name: 'TikTok',     emoji: '🎵', coins: 50 },
  7531:  { name: 'Бабочка',    emoji: '🦋', coins: 30 },
  5496:  { name: 'Лев',        emoji: '🦁', coins: 200 },
  5501:  { name: 'Корона',     emoji: '👑', coins: 500 },
  6468:  { name: 'Ракета',     emoji: '🚀', coins: 100 },
  5953:  { name: 'Универсум',  emoji: '🌌', coins: 1000 },
  7604:  { name: 'Замок',      emoji: '🏰', coins: 300 },
  5665:  { name: 'Любовь',     emoji: '💝', coins: 25 },
  7623:  { name: 'Дракон',     emoji: '🐉', coins: 2000 },
};

function resolveGift(giftId, giftName, diamondCount) {
  if (GIFT_MAP[giftId]) return GIFT_MAP[giftId];
  const coins = Math.max(5, Math.round((diamondCount || 1) * 0.5));
  const emoji = diamondCount >= 5000 ? '🌟' : diamondCount >= 1000 ? '💎' : diamondCount >= 500 ? '👑' : diamondCount >= 100 ? '🎁' : '💝';
  return { name: giftName || 'Подарок', emoji, coins };
}

wss.on('connection', (ws, req) => {
  const params = new url.URL(req.url, `http://localhost`).searchParams;
  const username = params.get('username');

  if (!username) { ws.close(1008, 'No username'); return; }
  console.log(`[+] Подключение к @${username}`);

  const tiktok = new WebcastPushConnection(username, {
    processInitialData: false,
    enableExtendedGiftInfo: true,
    enableWebsocketUpgrade: true,
    requestPollingIntervalMs: 1000,
  });

  tiktok.connect()
    .then(state => {
      console.log(`[✓] @${username} онлайн, зрителей: ${state.viewerCount}`);
      send(ws, { type: 'connected', username, viewers: state.viewerCount });
      send(ws, { type: 'viewers', count: state.viewerCount });
    })
    .catch(err => {
      console.error(`[✗] Ошибка @${username}:`, err.message);
      send(ws, { type: 'error', message: err.message });
      ws.close();
    });

  // ✅ FIX 2: Подарки — полное логирование в Railway Logs
  tiktok.on('gift', data => {
    if (data.giftType === 1 && !data.repeatEnd) return;
    const resolved = resolveGift(data.giftId, data.giftName, data.diamondCount);
    const count = data.repeatCount || 1;
    const totalCoins = resolved.coins * count;
    // Каждый подарок виден в Railway → Logs
    console.log(`[🎁 GIFT] @${data.uniqueId} → ${resolved.emoji} ${resolved.name} x${count} | coins: ${totalCoins} | diamonds: ${data.diamondCount}`);
    send(ws, { type: 'gift', user: data.uniqueId, giftName: resolved.name, emoji: resolved.emoji, coins: resolved.coins, count, diamonds: data.diamondCount });
  });

  tiktok.on('chat', data => {
    // Логируем сообщения только если содержат триггер-слова
    const upper = (data.comment || '').toUpperCase();
    const triggers = ['ХАОС','РУИН','БУСТ','СПИН','СТОП','БОСС','ЕЩЁ','ЕЩЕ','КРУТИ'];
    if (triggers.some(t => upper.includes(t))) {
      console.log(`[⚡ TRIGGER] @${data.uniqueId}: "${data.comment}"`);
    }
    send(ws, { type: 'comment', user: data.uniqueId, text: data.comment });
  });

  // ✅ FIX 3: Троттлинг лайков и джоинов — не спамим TikTok API
  // Лайки: шлём клиенту не чаще раза в 300мс на пользователя
  const likeThrottle = {};
  tiktok.on('like', data => {
    const uid = data.uniqueId;
    if (likeThrottle[uid]) return;
    likeThrottle[uid] = setTimeout(() => { delete likeThrottle[uid]; }, 300);
    send(ws, { type: 'like', user: uid, count: data.likeCount, total: data.totalLikeCount });
  });

  // Джоины: не чаще 1 раза в 500мс глобально (спам защита)
  let memberThrottleActive = false;
  tiktok.on('member', data => {
    if (!memberThrottleActive) {
      send(ws, { type: 'join', user: data.uniqueId });
      memberThrottleActive = true;
      setTimeout(() => { memberThrottleActive = false; }, 500);
    }
  });

  tiktok.on('share',    data => send(ws, { type: 'share',   user: data.uniqueId }));
  tiktok.on('follow',   data => send(ws, { type: 'follow',  user: data.uniqueId }));
  tiktok.on('roomUser', data => send(ws, { type: 'viewers', count: data.viewerCount }));
  tiktok.on('error',    err  => {
    console.error(`[⚠️ TIKTOK ERROR] @${username}:`, String(err));
    send(ws, { type: 'error', message: String(err) });
  });
  tiktok.on('disconnected', () => {
    console.log(`[~] TikTok отключил @${username}`);
    send(ws, { type: 'disconnected' });
  });

  ws.on('close', () => {
    console.log(`[-] Клиент ушёл (@${username})`);
    tiktok.disconnect();
  });
});

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

server.listen(PORT, () => {
  console.log(`\n🎰 TikTok Casino запущен на порту ${PORT}`);
  console.log(`📡 Health-check: GET /ping`);
  console.log(`💡 Зарегистрируй UptimeRobot на /ping каждые 5 мин чтобы не засыпал\n`);
});
