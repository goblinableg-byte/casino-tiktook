const { WebcastPushConnection } = require('tiktok-live-connector');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// ===================================================================
//  HTTP
// ===================================================================
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const parsedUrl = new url.URL(req.url, `http://localhost`);

  if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
    const file = path.join(__dirname, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(500); res.end('Ошибка чтения index.html'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
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
  5655:  { name: 'Роза',      emoji: '🌹', coins: 10   },
  6104:  { name: 'TikTok',    emoji: '🎵', coins: 50   },
  7531:  { name: 'Бабочка',   emoji: '🦋', coins: 30   },
  5496:  { name: 'Лев',       emoji: '🦁', coins: 200  },
  5501:  { name: 'Корона',    emoji: '👑', coins: 500  },
  6468:  { name: 'Ракета',    emoji: '🚀', coins: 100  },
  5953:  { name: 'Универсум', emoji: '🌌', coins: 1000 },
  7604:  { name: 'Замок',     emoji: '🏰', coins: 300  },
  5665:  { name: 'Любовь',    emoji: '💝', coins: 25   },
  7623:  { name: 'Дракон',    emoji: '🐉', coins: 2000 },
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
      console.error(`[✗] @${username}:`, err.message);
      send(ws, { type: 'error', message: err.message });
      ws.close();
    });

  tiktok.on('gift', data => {
    if (data.giftType === 1 && !data.repeatEnd) return;
    const resolved = resolveGift(data.giftId, data.giftName, data.diamondCount);
    const count = data.repeatCount || 1;
    send(ws, {
      type: 'gift',
      user: data.uniqueId,
      giftName: resolved.name,
      emoji: resolved.emoji,
      coins: resolved.coins,
      count,
      diamonds: data.diamondCount,
    });
  });

  // ✅ ПОДПИСКА — отправляем событие follow
  tiktok.on('follow', data => {
    send(ws, { type: 'follow', user: data.uniqueId });
  });

  tiktok.on('chat',     data => send(ws, { type: 'comment',  user: data.uniqueId, text: data.comment }));
  tiktok.on('like',     data => send(ws, { type: 'like',     user: data.uniqueId, count: data.likeCount, total: data.totalLikeCount }));
  tiktok.on('member',   data => send(ws, { type: 'join',     user: data.uniqueId }));
  tiktok.on('share',    data => send(ws, { type: 'share',    user: data.uniqueId }));
  tiktok.on('roomUser', data => send(ws, { type: 'viewers',  count: data.viewerCount }));
  tiktok.on('error',    err  => send(ws, { type: 'error',    message: String(err) }));
  tiktok.on('disconnected', () => send(ws, { type: 'disconnected' }));

  ws.on('close', () => {
    console.log(`[-] Клиент ушёл (@${username})`);
    tiktok.disconnect();
  });
});

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// ===================================================================
//  СТАРТ
// ===================================================================
server.listen(PORT, () => {
  console.log(`\n🎙 Stream Overlay запущен на порту ${PORT}\n`);
});
