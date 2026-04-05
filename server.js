const { WebcastPushConnection } = require('tiktok-live-connector');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DA_TOKEN = process.env.DA_TOKEN || ''; // DonationAlerts OAuth token

// ===================================================================
//  SHOP — список товаров (редактируй под себя)
// ===================================================================
const SHOP_ITEMS = [
  // --- ИГРОВЫЕ БУССТЫ ---
  { id: 'chaos',      category: 'boost',  emoji: '🌀', name: 'ХАОС РЕЖИМ',        desc: 'Включает хаос на 60 секунд!',         price: 100,  minCoins: 2000, action: 'chaos',      duration: 60  },
  { id: 'fireworks',  category: 'boost',  emoji: '🎆', name: 'ФЕЙЕРВЕРК',          desc: 'Взрыв эффектов на стриме',            price: 50,   minCoins: 1000, action: 'fireworks',  duration: 0   },
  { id: 'superchat',  category: 'boost',  emoji: '💬', name: 'СУПЕР-СООБЩЕНИЕ',    desc: 'Твоё сообщение 30 сек на экране',     price: 150,  minCoins: 3000, action: 'superchat',  duration: 30  },
  { id: 'rainbow',    category: 'boost',  emoji: '🌈', name: 'РАДУЖНЫЙ СТРИМ',     desc: 'Радужный фильтр на 45 сек',           price: 75,   minCoins: 1500, action: 'rainbow',    duration: 45  },

  // --- ГОЛОСА ---
  { id: 'vote_rock',  category: 'vote',   emoji: '🎸', name: 'ГОЛОС: РОК',         desc: 'Голосуй за следующий трек — Рок',     price: 30,   minCoins: 500,  action: 'vote',       voteId: 'music', voteOption: 'Рок' },
  { id: 'vote_pop',   category: 'vote',   emoji: '🎵', name: 'ГОЛОС: ПОП',         desc: 'Голосуй за следующий трек — Поп',     price: 30,   minCoins: 500,  action: 'vote',       voteId: 'music', voteOption: 'Поп' },
  { id: 'vote_edm',   category: 'vote',   emoji: '🎛️', name: 'ГОЛОС: EDM',         desc: 'Голосуй за следующий трек — EDM',     price: 30,   minCoins: 500,  action: 'vote',       voteId: 'music', voteOption: 'EDM' },
  { id: 'vote_game',  category: 'vote',   emoji: '🎮', name: 'ГОЛОС: ИГРАТЬ',      desc: 'Хочу смотреть геймплей',              price: 50,   minCoins: 800,  action: 'vote',       voteId: 'content', voteOption: 'Игра' },
  { id: 'vote_chat',  category: 'vote',   emoji: '💬', name: 'ГОЛОС: БОЛТАТЬ',     desc: 'Хочу просто общение',                 price: 50,   minCoins: 800,  action: 'vote',       voteId: 'content', voteOption: 'Чат' },

  // --- КАСТОМНЫЕ СОБЫТИЯ ---
  { id: 'custom_txt', category: 'event',  emoji: '📢', name: 'МОЁ СООБЩЕНИЕ',      desc: 'Напиши что угодно в теме доната',     price: 200,  minCoins: 4000, action: 'custommsg',  duration: 20  },
  { id: 'bobik',      category: 'event',  emoji: '🐶', name: 'ВЫЗВАТЬ БОБИКА',     desc: 'Принудительный Бобик на 30 сек',      price: 80,   minCoins: 1500, action: 'bobik',      duration: 30  },
  { id: 'spotlight',  category: 'event',  emoji: '⭐', name: 'В ЦЕНТРЕ ВНИМАНИЯ',  desc: 'Стример произносит твоё имя',         price: 120,  minCoins: 2500, action: 'spotlight',  duration: 15  },
  { id: 'soundbomb',  category: 'event',  emoji: '💣', name: 'ЗВУКОВАЯ БОМБА',     desc: 'Случайный смешной звук',              price: 40,   minCoins: 800,  action: 'soundbomb',  duration: 0   },

  // --- ПРИДУМАННЫЕ ---
  { id: 'freeze',     category: 'boost',  emoji: '🥶', name: 'ЗАМОРОЗКА',          desc: 'Стример молчит 10 секунд (челлендж)', price: 60,   minCoins: 1200, action: 'freeze',     duration: 10  },
  { id: 'dance',      category: 'event',  emoji: '💃', name: 'ТАНЦЕВАЛЬНЫЙ ЧЕЛЛ',  desc: 'Стример должен потанцевать!',         price: 90,   minCoins: 2000, action: 'dance',      duration: 0   },
  { id: 'roast',      category: 'event',  emoji: '🔥', name: 'РОУСТ',              desc: 'Стример жёстко роустит кого-то из чата', price: 75, minCoins: 1500, action: 'roast',    duration: 0   },
];

// ===================================================================
//  HTTP — раздаёт файлы
// ===================================================================
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  const parsedUrl = new url.URL(req.url, `http://localhost`);

  // API — список товаров магазина
  if (parsedUrl.pathname === '/api/shop') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ items: SHOP_ITEMS }));
    return;
  }

  // Статические файлы
  const fileMap = {
    '/':         ['index.html', 'text/html'],
    '/index.html': ['index.html', 'text/html'],
    '/shop':     ['shop.html', 'text/html'],
    '/shop.html': ['shop.html', 'text/html'],
  };

  const fileInfo = fileMap[parsedUrl.pathname];
  if (fileInfo) {
    const file = path.join(__dirname, fileInfo[0]);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': fileInfo[1] + '; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ===================================================================
//  WebSocket — клиенты (оверлей)
// ===================================================================
const wss = new WebSocket.Server({ server });
const overlayClients = new Set();

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

// Рассылка всем подключённым оверлеям
function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of overlayClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// ===================================================================
//  ОБРАБОТКА ПОКУПОК — матчинг доната к товару
// ===================================================================
function matchDonation(amount, message) {
  // Сначала по точной сумме
  let item = SHOP_ITEMS.find(i => i.price === Math.round(amount));
  
  // Если нет — по ключевым словам в сообщении
  if (!item && message) {
    const msg = message.toLowerCase();
    item = SHOP_ITEMS.find(i =>
      msg.includes(i.id.toLowerCase()) ||
      msg.includes(i.name.toLowerCase()) ||
      msg.includes(i.action.toLowerCase())
    );
  }
  return item || null;
}

function firePurchase(item, user, message, amount, source) {
  console.log(`[🛒] Покупка: ${user} → ${item.name} (${amount} руб/${source})`);
  
  broadcast({
    type: 'purchase',
    item: item.id,
    action: item.action,
    itemName: item.name,
    emoji: item.emoji,
    user,
    message: message || '',
    amount,
    source,
    duration: item.duration || 0,
    voteId: item.voteId || null,
    voteOption: item.voteOption || null,
  });
}

// Матчинг TikTok подарков по coins
function matchGiftPurchase(coins, giftName) {
  return SHOP_ITEMS.find(i => coins >= i.minCoins) || null;
}

// ===================================================================
//  DONATION ALERTS WebSocket
// ===================================================================
let daSocket = null;
let daReconnectTimer = null;

function connectDonationAlerts() {
  if (!DA_TOKEN) {
    console.log('[DA] Токен не задан — DonationAlerts отключён. Задай DA_TOKEN в env.');
    return;
  }

  console.log('[DA] Подключение к DonationAlerts...');

  // Шаг 1: получаем socket token через API
  const https = require('https');
  const options = {
    hostname: 'www.donationalerts.com',
    path: '/api/v1/user/oauth',
    headers: { 'Authorization': 'Bearer ' + DA_TOKEN },
  };

  https.get(options, (resp) => {
    let data = '';
    resp.on('data', chunk => data += chunk);
    resp.on('end', () => {
      try {
        const json = JSON.parse(data);
        const socketToken = json.data?.socket_connection_token;
        const userId = json.data?.id;
        if (!socketToken) {
          console.error('[DA] Не удалось получить socket token:', data);
          scheduleDaReconnect();
          return;
        }
        openDaSocket(socketToken, userId);
      } catch (e) {
        console.error('[DA] Ошибка парсинга ответа:', e.message);
        scheduleDaReconnect();
      }
    });
  }).on('error', err => {
    console.error('[DA] HTTP ошибка:', err.message);
    scheduleDaReconnect();
  });
}

function openDaSocket(socketToken, userId) {
  // Centrifuge WebSocket (DonationAlerts использует Centrifuge)
  const WS = require('ws');
  const ws = new WS('wss://centrifugo.donationalerts.com/connection/websocket');
  daSocket = ws;

  ws.on('open', () => {
    console.log('[DA] ✓ WebSocket открыт, авторизуемся...');
    ws.send(JSON.stringify({ params: { token: socketToken }, id: 1 }));
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Авторизация прошла — подписываемся на канал донатов
      if (msg.id === 1 && msg.result?.client) {
        const channel = `$alerts:donation_${userId}`;
        ws.send(JSON.stringify({ method: 1, params: { channel }, id: 2 }));
        console.log(`[DA] ✓ Подписка на канал ${channel}`);
        broadcast({ type: 'da_connected' });
      }

      // Входящее событие
      if (msg.result?.type === 1 || msg.push?.data) {
        const pubData = msg.result?.data?.data || msg.push?.data?.data;
        if (!pubData) return;
        
        const donation = pubData;
        const amount = parseFloat(donation.amount || 0);
        const username = donation.username || 'Аноним';
        const message = donation.message || '';
        const currency = donation.currency || 'RUB';

        console.log(`[DA] 💰 Донат: ${username} → ${amount} ${currency}: "${message}"`);

        // Шлём событие доната в оверлей
        broadcast({
          type: 'donation',
          user: username,
          amount,
          currency,
          message,
        });

        // Матчинг на товар магазина
        const item = matchDonation(amount, message);
        if (item) {
          firePurchase(item, username, message, amount, 'donation');
        }
      }
    } catch (e) {
      console.warn('[DA] Ошибка парсинга сообщения:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[DA] Соединение закрыто');
    broadcast({ type: 'da_disconnected' });
    scheduleDaReconnect();
  });

  ws.on('error', (err) => {
    console.error('[DA] Ошибка:', err.message);
  });
}

function scheduleDaReconnect() {
  clearTimeout(daReconnectTimer);
  daReconnectTimer = setTimeout(() => connectDonationAlerts(), 15000);
  console.log('[DA] Реконнект через 15 сек...');
}

// ===================================================================
//  TikTok WebSocket
// ===================================================================
wss.on('connection', (ws, req) => {
  const params = new url.URL(req.url, `http://localhost`).searchParams;
  const username = params.get('username');

  if (!username) { ws.close(1008, 'No username'); return; }
  
  // Регистрируем как оверлей-клиент для получения DA событий
  overlayClients.add(ws);
  console.log(`[+] Оверлей подключён (@${username}), клиентов: ${overlayClients.size}`);

  // Шлём текущие настройки магазина
  send(ws, { type: 'shop_items', items: SHOP_ITEMS });

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

  tiktok.on('gift', data => {
    if (data.giftType === 1 && !data.repeatEnd) return;
    const resolved = resolveGift(data.giftId, data.giftName, data.diamondCount);
    const count = data.repeatCount || 1;
    const totalCoins = resolved.coins * count;

    send(ws, {
      type: 'gift',
      user: data.uniqueId,
      giftName: resolved.name,
      emoji: resolved.emoji,
      coins: resolved.coins,
      count,
      diamonds: data.diamondCount,
    });

    // Проверяем — не покупка ли это из магазина?
    const item = SHOP_ITEMS.find(i => totalCoins >= i.minCoins);
    if (item) {
      firePurchase(item, data.uniqueId, '', totalCoins, 'tiktok');
    }
  });

  tiktok.on('chat',     data => send(ws, { type: 'comment', user: data.uniqueId, text: data.comment }));
  tiktok.on('like',     data => send(ws, { type: 'like',    user: data.uniqueId, count: data.likeCount, total: data.totalLikeCount }));
  tiktok.on('member',   data => send(ws, { type: 'join',    user: data.uniqueId }));
  tiktok.on('share',    data => send(ws, { type: 'share',   user: data.uniqueId }));
  tiktok.on('follow',   data => send(ws, { type: 'follow',  user: data.uniqueId }));
  tiktok.on('roomUser', data => send(ws, { type: 'viewers', count: data.viewerCount }));
  tiktok.on('error',    err  => send(ws, { type: 'error',   message: String(err) }));
  tiktok.on('disconnected', () => send(ws, { type: 'disconnected' }));

  ws.on('close', () => {
    overlayClients.delete(ws);
    console.log(`[-] Оверлей ушёл (@${username}), клиентов: ${overlayClients.size}`);
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
  console.log(`\n🎰 TikTok Stream Overlay запущен на порту ${PORT}`);
  console.log(`📋 Магазин: http://localhost:${PORT}/shop`);
  console.log(`🎙  Оверлей: http://localhost:${PORT}/\n`);
  connectDonationAlerts();
});
