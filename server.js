/* ============================================================
 * 养的鱼不一样 · 颜文字赛博鱼缸 - 本地服务器
 * 功能：登录注册（用户名/手机号/密码）、鱼数据同步、
 *       同网络(同IP)在线检测、鱼儿串门（WebSocket 实时）
 * ============================================================ */
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 8000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- 存储 ---------------- */
let db = { users: [], tokens: {} };
function loadDB() {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { db = { users: [], tokens: {} }; }
}
let saveTimer = null;
function saveDB() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(db));
    } catch (e) { console.error('存档失败:', e.message); }
  }, 300);
}
loadDB();
setInterval(() => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) {} }, 30000);

/* ---------------- 工具 ---------------- */
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function hashPw(pw, salt) { return crypto.createHash('sha256').update(salt + pw).digest('hex'); }
function newId() { return crypto.randomBytes(8).toString('hex'); }
function maskPhone(p) { return p.slice(0, 3) + '****' + p.slice(7); }
function userByToken(token) {
  const uid = db.tokens[token];
  return uid ? db.users.find(u => u.id === uid) || null : null;
}
function auth(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return userByToken(t);
}
function userState(u) {
  return {
    coins: u.coins, firstTs: u.firstTs, lastTs: u.lastTs,
    feedCount: u.feedCount, muted: !!u.muted, fishes: u.fishes
  };
}
const STARTER_NAMES = ['泡泡', '闪闪', '团团', '布丁', '墨墨', '小鲤', '果冻', '豆豆', '米粒', '海苔', '丸子', '咕噜', '泡芙', '曲奇', '苏打', '柚子'];
function starterFish() {
  const mk = (sp) => ({
    id: 'f' + newId(), sp, name: pick(STARTER_NAMES),
    exp: Math.floor(rand(0, 20)), sat: Math.round(rand(55, 85)), born: Date.now()
  });
  return [mk('weixiao'), mk('jinyu')];
}

/* ---------------- 校验 ---------------- */
function validFish(f) {
  return f && typeof f === 'object'
    && typeof f.id === 'string' && f.id.length <= 24
    && typeof f.sp === 'string' && f.sp.length <= 12
    && typeof f.name === 'string' && f.name.length >= 1 && f.name.length <= 8
    && Number.isFinite(f.exp) && f.exp >= 0 && f.exp <= 99999
    && Number.isFinite(f.sat) && f.sat >= 0 && f.sat <= 100
    && Number.isFinite(f.born);
}

/* ---------------- API：注册 ---------------- */
app.post('/api/register', (req, res) => {
  const { username, phone, password } = req.body || {};
  if (!username || !/^[\u4e00-\u9fa5A-Za-z0-9_\-]{2,16}$/.test(username))
    return res.status(400).json({ error: '用户名需 2-16 位（中文/字母/数字/下划线）' });
  if (!phone || !/^1[3-9]\d{9}$/.test(phone))
    return res.status(400).json({ error: '手机号需为 11 位有效格式' });
  if (!password || typeof password !== 'string' || password.length < 6 || password.length > 32)
    return res.status(400).json({ error: '密码需 6-32 位' });
  if (db.users.some(u => u.username === username))
    return res.status(400).json({ error: '用户名已被注册' });
  if (db.users.some(u => u.phone === phone))
    return res.status(400).json({ error: '手机号已被注册' });
  const salt = crypto.randomBytes(8).toString('hex');
  const user = {
    id: newId(), username, phone,
    passHash: hashPw(password, salt), salt,
    coins: 60, firstTs: Date.now(), lastTs: Date.now(),
    feedCount: 0, muted: false, fishes: starterFish()
  };
  db.users.push(user);
  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = user.id;
  saveDB();
  console.log(`[注册] ${username} 加入了鱼塘`);
  res.json({ token, user: { id: user.id, username: user.username, phone: maskPhone(user.phone) }, state: userState(user) });
});

/* ---------------- API：登录（用户名+手机号+密码 三项匹配） ---------------- */
app.post('/api/login', (req, res) => {
  const { username, phone, password } = req.body || {};
  if (!username || !phone || !password)
    return res.status(400).json({ error: '请填写用户名、手机号和密码' });
  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(400).json({ error: '账号不存在，请先注册' });
  if (user.phone !== phone) return res.status(400).json({ error: '手机号与账号不匹配' });
  if (user.passHash !== hashPw(password, user.salt))
    return res.status(400).json({ error: '密码不正确' });
  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = user.id;
  saveDB();
  console.log(`[登录] ${username} 回到了鱼缸`);
  res.json({ token, user: { id: user.id, username: user.username, phone: maskPhone(user.phone) }, state: userState(user) });
});

/* ---------------- API：登出 ---------------- */
app.post('/api/logout', (req, res) => {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (db.tokens[t]) { delete db.tokens[t]; saveDB(); }
  res.json({ ok: true });
});

/* ---------------- API：读取状态 ---------------- */
app.get('/api/state', (req, res) => {
  const user = auth(req);
  if (!user) return res.status(401).json({ error: '未登录' });
  res.json({ user: { id: user.id, username: user.username, phone: maskPhone(user.phone) }, state: userState(user) });
});

/* ---------------- API：保存状态（客户端定期同步） ---------------- */
app.post('/api/state', (req, res) => {
  const user = auth(req);
  if (!user) return res.status(401).json({ error: '未登录' });
  const b = req.body || {};
  if (Array.isArray(b.fishes) && b.fishes.length <= 15 && b.fishes.every(validFish)) {
    user.fishes = b.fishes;
  }
  if (Number.isFinite(b.coins)) user.coins = Math.max(0, Math.min(9999999, Math.round(b.coins)));
  if (Number.isFinite(b.feedCount)) user.feedCount = Math.max(0, Math.min(9999999, Math.round(b.feedCount)));
  if (typeof b.muted === 'boolean') user.muted = b.muted;
  user.lastTs = Date.now();
  saveDB();
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

/* ============================================================
 * WebSocket：在线状态 + 同网络(同IP)串门
 * ============================================================ */
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// 每个连接的会话信息
const sessions = new Map(); // ws -> {userId, username, ip}
// 进行中的串门
let visits = [];            // {id, ownerId, ownerName, hostId, hostName, fish, endsAt}

function normIp(addr) {
  if (!addr) return 'unknown';
  if (addr === '::1') return '127.0.0.1';
  return addr.replace(/^::ffff:/, '');
}
function sendTo(ws, msg) {
  try { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); } catch (e) {}
}
function sendToUser(userId, msg) {
  for (const [ws, s] of sessions) if (s.userId === userId) sendTo(ws, msg);
}
// 同 IP 的其它在线用户（= 同一网络的邻居）
function neighborsOf(userId, ip) {
  const out = [];
  for (const [, s] of sessions) if (s.ip === ip && s.userId !== userId) out.push(s);
  return out;
}
function broadcastPresence() {
  for (const [ws, s] of sessions) {
    const ns = neighborsOf(s.userId, s.ip);
    sendTo(ws, { type: 'presence', count: ns.length, names: ns.map(n => n.username) });
  }
}

/* 结束一次串门：notify 双方 */
function endVisit(v, reason) {
  const idx = visits.indexOf(v);
  if (idx >= 0) visits.splice(idx, 1);
  // 主人家：访客鱼离开
  sendToUser(v.hostId, { type: 'visit-end', visitId: v.id, fishName: v.fish.name, owner: v.ownerName, reason });
  // 鱼主：鱼回家
  sendToUser(v.ownerId, { type: 'visit-return', visitId: v.id, fishId: v.fish.id, fishName: v.fish.name, host: v.hostName, reason });
}

/* 串门引擎：每 12 秒一次 */
setInterval(() => {
  const now = Date.now();
  // 1. 到期的串门先结束
  for (const v of visits.slice()) if (v.endsAt <= now) endVisit(v, 'home');
  // 2. 尝试发起串门（同一 IP 至少 2 人在线）
  const groups = {};
  for (const [, s] of sessions) {
    (groups[s.ip] = groups[s.ip] || []).push(s);
  }
  for (const ip of Object.keys(groups)) {
    const list = groups[ip];
    if (list.length < 2) continue;
    for (const hostSess of list) {
      if (Math.random() > 0.5) continue; // 每轮 50% 概率
      // 限制：我家最多 3 条访客；对方最多 2 条鱼在外面
      const myVisitors = visits.filter(v => v.hostId === hostSess.userId).length;
      if (myVisitors >= 3) continue;
      const candidates = list.filter(s => s.userId !== hostSess.userId);
      const donorSess = pick(candidates);
      if (!donorSess) continue;
      const donor = db.users.find(u => u.id === donorSess.userId);
      if (!donor || !donor.fishes.length) continue;
      const awayCount = visits.filter(v => v.ownerId === donor.id).length;
      if (awayCount >= 2) continue;
      const awayIds = visits.filter(v => v.ownerId === donor.id).map(v => v.fish.id);
      const pool = donor.fishes.filter(f => !awayIds.includes(f.id));
      if (!pool.length) continue;
      const fish = pick(pool);
      const v = {
        id: 'v' + newId(), ownerId: donor.id, ownerName: donor.username,
        hostId: hostSess.userId, hostName: hostSess.username,
        fish: { id: fish.id, sp: fish.sp, name: fish.name, exp: fish.exp, sat: fish.sat, born: fish.born },
        endsAt: now + rand(40000, 90000)
      };
      visits.push(v);
      sendToUser(hostSess.userId, { type: 'visit-in', visitId: v.id, fish: v.fish, owner: v.ownerName });
      sendToUser(donor.id, { type: 'visit-out', visitId: v.id, fishId: fish.id, fishName: fish.name, host: v.hostName });
      console.log(`[串门] ${donor.username} 的「${fish.name}」游去了 ${hostSess.username} 的鱼缸`);
    }
  }
}, 12000);

/* 连接管理 */
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  const token = url.searchParams.get('token') || '';
  const user = userByToken(token);
  if (!user) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    const ip = normIp(req.socket.remoteAddress);
    sessions.set(ws, { userId: user.id, username: user.username, ip });
    console.log(`[在线] ${user.username} (${ip})，当前 ${sessions.size} 人`);
    sendTo(ws, { type: 'hello' });
    broadcastPresence();
    ws.on('pong', () => {});
    ws.on('close', () => {
      sessions.delete(ws);
      console.log(`[离线] ${user.username}，当前 ${sessions.size} 人`);
      // 该用户相关的串门全部结束：他家来访客的鱼回自己家；在外串门的他的鱼立刻被送回
      for (const v of visits.slice()) {
        if (v.ownerId === user.id || v.hostId === user.id) {
          if (v.ownerId === user.id) endVisit(v, 'owner-left');   // 鱼主离开，访客鱼从主人家消失
          else endVisit(v, 'host-left');                          // 主人离开，外面的鱼被送回
        }
      }
      broadcastPresence();
    });
    ws.on('message', raw => {
      try {
        const m = JSON.parse(raw);
        if (m.type === 'ping') sendTo(ws, { type: 'pong' });
      } catch (e) {}
    });
  });
});
// 心跳：30 秒清理死连接
setInterval(() => {
  for (const [ws] of sessions) { try { ws.ping(); } catch (e) {} }
}, 30000);

server.listen(PORT, () => {
  console.log('======================================');
  console.log('  养的鱼不一样 · 颜文字赛博鱼缸');
  console.log(`  本地服务器已启动: http://localhost:${PORT}`);
  console.log('======================================');
});
