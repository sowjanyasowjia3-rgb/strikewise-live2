// Strikewise Live: zero-dependency Node server (Node 18+) with a password-protected /admin
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';            // admin is disabled until you set this
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const settings = { provider: process.env.PROVIDER || 'demo', refresh: +process.env.REFRESH_SECONDS || 30, announcement: '' };
const stats = { started: new Date().toISOString(), fetches: 0, errors: 0, lastError: '', lastOk: null };
let provider = load(settings.provider), cache = null, at = 0, busy = null;

function load(name) { if (!/^[a-z]+$/.test(name)) throw new Error('bad provider'); return require('./providers/' + name); }
async function snapshot(force) {
  if (!force && cache && Date.now() - at < settings.refresh * 1000) return cache;
  if (busy) return busy;
  busy = provider.getSnapshot().then(s => {
    stats.fetches++; stats.lastOk = new Date().toISOString();
    cache = { ...s, mode: provider.mode, delayMinutes: provider.delayMinutes, asOf: s.asOf || stats.lastOk };
    at = Date.now(); return cache;
  }).catch(e => {
    stats.errors++; stats.lastError = e.message; console.error('provider error:', e.message);
    if (cache) return { ...cache, stale: true };
    throw e;
  }).finally(() => { busy = null; });
  return busy;
}

// ---- auth: signed, expiring cookie; login attempts rate-limited per IP
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const token = () => { const exp = Date.now() + 8 * 3600e3; return exp + '.' + sign('admin.' + exp); };
const authed = req => { const m = /(?:^|; )sw_admin=(\d+)\.([a-f0-9]+)/.exec(req.headers.cookie || ''); return !!(ADMIN_PASSWORD && m && +m[1] > Date.now() && safeEq(m[2], sign('admin.' + m[1]))); };
const tries = new Map();
const blocked = ip => { const t = (tries.get(ip) || []).filter(x => Date.now() - x < 15 * 60e3); tries.set(ip, t); return t.length >= 5; };
const body = req => new Promise(r => { let d = ''; req.on('data', c => { d += c; if (d.length > 5e3) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
const json = (res, code, o, h = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h }); res.end(JSON.stringify(o)); };

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname, ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (p === '/api/snapshot') {
    try { json(res, 200, { ...(await snapshot()), announcement: settings.announcement }); } catch { json(res, 502, { error: 'data source unavailable' }); }
    return;
  }
  if (p === '/api/health') { res.writeHead(200); return res.end('ok'); }
  if (p.startsWith('/api/admin/')) {
    const sub = p.slice(11);
    if (req.method === 'POST' && !(req.headers['content-type'] || '').includes('application/json')) return json(res, 415, { error: 'json only' });
    if (sub === 'login' && req.method === 'POST') {
      if (!ADMIN_PASSWORD) return json(res, 503, { error: 'Admin is disabled. Set the ADMIN_PASSWORD environment variable.' });
      if (blocked(ip)) return json(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
      const b = await body(req);
      if (typeof b.password !== 'string' || !safeEq(sign(b.password), sign(ADMIN_PASSWORD))) { tries.get(ip).push(Date.now()); return json(res, 401, { error: 'Wrong password' }); }
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return json(res, 200, { ok: true }, { 'Set-Cookie': `sw_admin=${token()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}` });
    }
    if (sub === 'logout') return json(res, 200, { ok: true }, { 'Set-Cookie': 'sw_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    if (!authed(req)) return json(res, 401, { error: 'Not signed in' });
    if (sub === 'status') return json(res, 200, { settings, stats, mode: provider.mode, delayMinutes: provider.delayMinutes, cacheAgeSec: cache ? Math.round((Date.now() - at) / 1000) : null, asOf: cache?.asOf || null });
    if (sub === 'refresh' && req.method === 'POST') { try { await snapshot(true); return json(res, 200, { ok: true }); } catch (e) { return json(res, 502, { error: e.message }); } }
    if (sub === 'settings' && req.method === 'POST') {
      const b = await body(req);
      if (b.refresh !== undefined) { const n = +b.refresh; if (!(n >= 5 && n <= 3600)) return json(res, 400, { error: 'Refresh must be 5 to 3600 seconds' }); settings.refresh = n; }
      if (typeof b.announcement === 'string') settings.announcement = b.announcement.slice(0, 240);
      if (b.provider && b.provider !== settings.provider) { try { provider = load(b.provider); settings.provider = b.provider; cache = null; } catch (e) { return json(res, 400, { error: 'Unknown provider' }); } }
      return json(res, 200, { ok: true, settings });
    }
    return json(res, 404, { error: 'not found' });
  }
  const rel = p === '/' ? 'index.html' : p === '/admin' ? 'admin.html' : path.normalize(p).replace(/^(\.\.[\/\\])+/, '');
  const file = path.join(__dirname, 'public', rel);
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(buf);
  });
}).listen(PORT, () => console.log(`Strikewise Live on :${PORT} (provider: ${settings.provider}, admin ${ADMIN_PASSWORD ? 'enabled' : 'DISABLED'})`));
