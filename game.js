// =========================
// hapishapish - game.js
// =========================

// ----- تنظیمات پایه
const cell = 20;
const wsUrl = "wss://maze-race-server.onrender.com/ws";

// عناصر UI
const screenStart = document.getElementById('screen-start');
const screenLobby = document.getElementById('screen-lobby');
const screenGame  = document.getElementById('screen-game');

const playerNameInput   = document.getElementById('playerName');
const playerColorInput  = document.getElementById('playerColor');
const colorButtons      = document.querySelectorAll('.color-btn');
const startBtn          = document.getElementById('startBtn');

const roomIdInput       = document.getElementById('roomId');
const maxPlayersInput   = document.getElementById('maxPlayers');
const roomPasswordInput = document.getElementById('roomPassword');
const createBtn         = document.getElementById('createBtn');
const joinBtn           = document.getElementById('joinBtn');

const lobbyStatus        = document.getElementById('lobbyStatus');
const lobbyGlobalStatus  = document.getElementById('lobbyGlobalStatus');
const roomListEl         = document.getElementById('roomList');
const refreshRoomsBtn    = document.getElementById('refreshRoomsBtn');

const currentRoomPanel   = document.getElementById('currentRoomPanel');
const currentRoomTitle   = document.getElementById('currentRoomTitle');
const currentRoomPlayers = document.getElementById('currentRoomPlayers');
const leaveRoomBtn       = document.getElementById('leaveRoomBtn');
const startGameBtn       = document.getElementById('startGameBtn');

const backToLobbyBtn     = document.getElementById('backToLobbyBtn');
const statusEl           = document.getElementById('status');

const cv   = document.getElementById('cv');
const ctx  = cv.getContext('2d');

// ----- وضعیت کلی بازی / شبکه
let ws = null;
let isConnected = false;

let playerName  = '';
let playerColor = '#39f';
let myPlayerId  = null;

let currentRoomId  = null;
let isRoomOwner    = false;
let roomsCache     = [];

let maze = null;
let me   = null;
let others = [];   // برای چند نفر
let winnerId = null;

// چهار کاراکتر برند hapishapish (برای الان فقط رنگ و start)
const characters = [
  { name: 'Hapi Blue',   color: '#39f',    start: { x: 1, y: 1 } },
  { name: 'Shapi Orange',color: '#f93',   start: { x: 1, y: 2 } },
  { name: 'Greepi',      color: '#4caf50',start: { x: 2, y: 1 } },
  { name: 'Pinki',       color: '#e91e63',start: { x: 2, y: 2 } }
];

// =========================
// UI helpers
// =========================

function showScreen(name) {
  [screenStart, screenLobby, screenGame].forEach(s => s.classList.remove('active'));
  if (name === 'start') screenStart.classList.add('active');
  if (name === 'lobby') screenLobby.classList.add('active');
  if (name === 'game')  screenGame.classList.add('active');
}

function setLobbyStatus(msg) {
  lobbyStatus.textContent = msg || '';
}

function setLobbyGlobalStatus(msg) {
  lobbyGlobalStatus.textContent = msg || '';
}

function setStatus(msg) {
  statusEl.textContent = msg || '';
}

// رندر لیست اتاق‌ها در لابی
function renderRoomList() {
  roomListEl.innerHTML = '';
  if (!roomsCache || roomsCache.length === 0) {
    const div = document.createElement('div');
    div.className = 'status';
    div.textContent = 'هیچ اتاق فعالی نیست. یکی بساز!';
    roomListEl.appendChild(div);
    return;
  }

  roomsCache.forEach(room => {
    const item = document.createElement('div');
    item.className = 'room-item';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'room-item-info';

    const idSpan = document.createElement('span');
    idSpan.className = 'room-item-id';
    idSpan.textContent = room.roomId;

    const metaSpan = document.createElement('span');
    metaSpan.className = 'room-item-meta';
    metaSpan.textContent =
      `بازیکن‌ها: ${room.playerCount}/${room.maxPlayers}` +
      (room.hasPassword ? ' • رمزدار' : '');

    infoDiv.appendChild(idSpan);
    infoDiv.appendChild(metaSpan);

    const joinBtnSmall = document.createElement('button');
    joinBtnSmall.className = 'mini-btn';
    joinBtnSmall.textContent = 'ورود';
    joinBtnSmall.addEventListener('click', () => {
      roomIdInput.value = room.roomId;
      showScreen('lobby');
    });

    item.appendChild(infoDiv);
    item.appendChild(joinBtnSmall);
    roomListEl.appendChild(item);
  });
}

// رندر بازیکن‌های داخل اتاق
function renderCurrentRoomPlayers(players) {
  currentRoomPlayers.innerHTML = '';
  if (!players || players.length === 0) {
    currentRoomPlayers.textContent = 'هنوز بازیکنی وارد نشده.';
    return;
  }

  players.forEach(p => {
    const row = document.createElement('div');
    row.className = 'player-item';

    const dot = document.createElement('div');
    dot.className = 'player-dot';
    dot.style.background = p.color || '#999';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name || p.playerId || 'بازیکن';

    row.appendChild(dot);
    row.appendChild(nameSpan);
    currentRoomPlayers.appendChild(row);
  });
}

// =========================
// Maze generation
// =========================

function mulberry32(seed){
  return function(){
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generateMaze(w, h, seed){
  const rnd = mulberry32(seed);
  const grid = Array.from({length: h}, () => Array(w).fill(1));
  const dirs = [[0,-2],[0,2],[-2,0],[2,0]];
  const sx = 1, sy = 1;
  grid[sy][sx] = 0;

  function shuffle(a){
    for (let i = a.length - 1; i > 0; i--){
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function carve(x, y){
    shuffle(dirs).forEach(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      if (ny > 0 && ny < h - 1 && nx > 0 && nx < w - 1 && grid[ny][nx] === 1) {
        grid[y + dy / 2][x + dx / 2] = 0;
        grid[ny][nx] = 0;
        carve(nx, ny);
      }
    });
  }

  carve(sx, sy);
  return {
    grid,
    start: { x: 1, y: 1 },
    exit: { x: w - 2, y: h - 2 }
  };
}

// =========================
// حرکت و رندر
// =========================

function canMove(x, y){
  return maze && maze.grid[y]?.[x] === 0;
}

function tryMove(p, dx, dy){
  const nx = p.x + dx;
  const ny = p.y + dy;
  if (canMove(nx, ny)){
    p.x = nx;
    p.y = ny;
  }
}

function draw(){
  if (!maze || !maze.grid) return;

  ctx.clearRect(0, 0, cv.width, cv.height);

  // دیوارها
  for (let y = 0; y < maze.grid.length; y++){
    for (let x = 0; x < maze.grid[0].length; x++){
      ctx.fillStyle = maze.grid[y][x] ? '#222' : '#050505';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  // خروج
  ctx.fillStyle = '#3c3';
  ctx.fillRect(maze.exit.x * cell, maze.exit.y * cell, cell, cell);

  // دیگران
  others.forEach(o => {
    ctx.fillStyle = o.color || '#888';
    ctx.beginPath();
    ctx.arc(
      o.x * cell + cell / 2,
      o.y * cell + cell / 2,
      cell * 0.4,
      0,
      Math.PI * 2
    );
    ctx.fill();
  });

  // خودت
  if (me){
    ctx.fillStyle = me.color || playerColor;
    ctx.beginPath();
    ctx.arc(
      me.x * cell + cell / 2,
      me.y * cell + cell / 2,
      cell * 0.45,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
}

function loop(){
  draw();
  requestAnimationFrame(loop);
}

// =========================
// WebSocket helpers
// =========================

function send(obj){
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  } else {
    console.log('WS not ready, drop:', obj);
  }
}

function connectWS(){
  ws = new WebSocket(wsUrl);
  setStatus('در حال اتصال به سرور...');
  setLobbyGlobalStatus('در حال اتصال به سرور...');

  ws.onopen = () => {
    isConnected = true;
    setStatus('وصل شد.');
    setLobbyGlobalStatus('وصل شد. می‌تونی اتاق بسازی یا وارد بشی.');
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    console.log('MSG:', msg);

    if (msg.type === 'welcome') {
      myPlayerId = msg.playerId;
    }

    if (msg.type === 'roomList') {
      roomsCache = msg.rooms || [];
      renderRoomList();
    }

    if (msg.type === 'roomCreated') {
      currentRoomId = msg.roomId;
      isRoomOwner = true;
      lobbyStatus.textContent = `اتاق ساخته شد: ${msg.roomId}`;
      roomIdInput.value = msg.roomId;
      currentRoomPanel.style.display = 'block';
      currentRoomTitle.textContent = `اتاق: ${msg.roomId}`;
      // خودت تنها بازیکنی هستی فعلاً
      renderCurrentRoomPlayers([{ playerId: myPlayerId, name: playerName, color: playerColor }]);
    }

    if (msg.type === 'roomJoined') {
      currentRoomId = msg.roomId;
      isRoomOwner = msg.rejoin ? isRoomOwner : false; // ساده: rejoin مالکیت را عوض نکن
      lobbyStatus.textContent = msg.rejoin
        ? `دوباره وارد اتاق شدی: ${msg.roomId}`
        : `وارد اتاق شدی: ${msg.roomId}`;

      currentRoomPanel.style.display = 'block';
      currentRoomTitle.textContent = `اتاق: ${msg.roomId}`;
      // بازیکن‌ها را بعداً از state یا start می‌گیریم
    }

    if (msg.type === 'start') {
      // شروع بازی
      maze = generateMaze(msg.w, msg.h, msg.seed);
      winnerId = null;

      const idx = msg.playerIndex;
      const ch = characters[idx % characters.length];
      const baseStart = ch.start;

      me = {
        id: myPlayerId,
        name: playerName || ch.name,
        color: playerColor || ch.color,
        x: baseStart.x,
        y: baseStart.y
      };

      others = []; // موقعیت دیگران را از state می‌گیریم
      setStatus('بازی شروع شد! حرکت کن.');
      showScreen('game');
    }

    if (msg.type === 'state') {
      // بروزرسانی موقعیت‌ها
      const players = msg.players || [];
      const mine = players.find(p => p.id === myPlayerId);
      if (mine && me) {
        me.x = mine.x;
        me.y = mine.y;
      }

      others = players
        .filter(p => p.id !== myPlayerId)
        .map((p, i) => {
          const ch = characters[i % characters.length];
          return {
            id: p.id,
            x: p.x,
            y: p.y,
            color: ch.color
          };
        });

      if (msg.winner) {
        winnerId = msg.winner;
        if (msg.winner === myPlayerId) {
          setStatus('بردی! hapishapish!');
        } else {
          setStatus('باختی، حریف برد.');
        }
      }
    }

    if (msg.type === 'error') {
      const reason = msg.reason || 'unknown';
      if (reason === 'room_not_found') {
        setLobbyStatus('اتاق پیدا نشد.');
      } else if (reason === 'room_full') {
        setLobbyStatus('اتاق پر است.');
      } else if (reason === 'wrong_password') {
        setLobbyStatus('رمز اشتباه است.');
      } else if (reason === 'room_already_exists') {
        setLobbyStatus('اتاقی با این کد وجود دارد.');
      } else {
        setLobbyStatus('خطا: ' + reason);
      }
    }

    if (msg.type === 'roomClosed') {
      setLobbyGlobalStatus('این اتاق به خاطر بی‌فعالیتی بسته شد.');
      currentRoomPanel.style.display = 'none';
      currentRoomId = null;
    }
  };

  ws.onclose = () => {
    isConnected = false;
    setStatus('ارتباط قطع شد.');
    setLobbyGlobalStatus('ارتباط با سرور قطع شد.');
  };
}

// =========================
// کنترل‌ها (لمسی + کیبورد)
// =========================

cv.addEventListener('touchstart', handleTouch, { passive: false });
cv.addEventListener('touchmove', handleTouch,  { passive: false });

function handleTouch(e){
  e.preventDefault();
  if (!me || !maze) return;

  const touch = e.touches[0];
  const rect = cv.getBoundingClientRect();
  const tx = touch.clientX - rect.left;
  const ty = touch.clientY - rect.top;

  const px = me.x * cell + cell / 2;
  const py = me.y * cell + cell / 2;

  const dx = tx - px;
  const dy = ty - py;

  let moved = false;

  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > 0) tryMove(me, 1, 0);
    else        tryMove(me, -1, 0);
    moved = true;
  } else {
    if (dy > 0) tryMove(me, 0, 1);
    else        tryMove(me, 0, -1);
    moved = true;
  }

  if (moved) {
    send({ type: 'move', payload: { x: me.x, y: me.y } });
    if (me.x === maze.exit.x && me.y === maze.exit.y) {
      send({ type: 'win' });
    }
  }
}

document.addEventListener('keydown', (e) => {
  if (!me || !maze) return;

  let moved = false;

  if (e.key === 'ArrowUp' || e.key === 'w')    { tryMove(me, 0, -1); moved = true; }
  if (e.key === 'ArrowDown' || e.key === 's')  { tryMove(me, 0, 1);  moved = true; }
  if (e.key === 'ArrowLeft' || e.key === 'a')  { tryMove(me, -1, 0); moved = true; }
  if (e.key === 'ArrowRight' || e.key === 'd') { tryMove(me, 1, 0);  moved = true; }

  if (moved) {
    send({ type: 'move', payload: { x: me.x, y: me.y } });
    if (me.x === maze.exit.x && me.y === maze.exit.y) {
      send({ type: 'win' });
    }
  }
});

// =========================
// رویدادهای UI
// =========================

// انتخاب رنگ از دکمه‌ها
colorButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const color = btn.dataset.color;
    if (!color) return;
    playerColor = color;
    playerColorInput.value = color;
    colorButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// دکمه "ادامه" از صفحه شروع → لابی
startBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) {
    playerNameInput.focus();
    return;
  }
  playerName = name;
  showScreen('lobby');
});

// ساخت اتاق
createBtn.addEventListener('click', () => {
  if (!isConnected) {
    setLobbyStatus('هنوز به سرور وصل نشدی.');
    return;
  }
  let rid = roomIdInput.value.trim();
  if (!rid) {
    rid = Math.random().toString(36).slice(2, 7);
    roomIdInput.value = rid;
  }
  const maxPlayers = parseInt(maxPlayersInput.value, 10) || 2;
  const password   = roomPasswordInput.value || null;

  setLobbyStatus('در حال ساخت اتاق...');
  send({
    type: 'createRoom',
    roomId: rid,
    maxPlayers,
    password
  });
});

// ورود به اتاق
joinBtn.addEventListener('click', () => {
  if (!isConnected) {
    setLobbyStatus('هنوز به سرور وصل نشدی.');
    return;
  }
  const rid = roomIdInput.value.trim();
  if (!rid) {
    setLobbyStatus('کد اتاق را وارد کن.');
    return;
  }
  const password = roomPasswordInput.value || null;
  setLobbyStatus('در حال ورود به اتاق...');
  send({
    type: 'joinRoom',
    roomId: rid,
    password,
    playerId: myPlayerId
  });
});

// ریفرش لیست اتاق‌ها
refreshRoomsBtn.addEventListener('click', () => {
  if (!isConnected) {
    setLobbyStatus('هنوز به سرور وصل نشدی.');
    return;
  }
  send({ type: 'getRooms' });
  setLobbyStatus('به‌روزرسانی لیست اتاق‌ها...');
});

// خروج از اتاق (سمت کلاینت – ساده: فقط UI را ریست می‌کنیم)
leaveRoomBtn.addEventListener('click', () => {
  currentRoomId = null;
  isRoomOwner   = false;
  currentRoomPanel.style.display = 'none';
  setLobbyStatus('از اتاق خارج شدی (سمت سرور هنوز پیاده‌سازی leaveRoom نشده).');
});

// شروع بازی توسط سازنده اتاق
startGameBtn.addEventListener('click', () => {
  // فعلاً سرور "start" را خودش هنگام پرشدن اتاق می‌فرستد.
  // این دکمه را بعداً می‌توانیم وصل کنیم به یک پیام خاص.
  setLobbyStatus('شروع بازی توسط سرور مدیریت می‌شود.');
});

// برگشت از بازی به لابی
backToLobbyBtn.addEventListener('click', () => {
  showScreen('lobby');
});

// =========================
// شروع
// =========================

showScreen('start');
connectWS();
requestAnimationFrame(loop);
