// Upstox provider: real index levels, India VIX and NIFTY option-chain open interest via Upstox API v2.
// Uses the read-only ANALYTICS TOKEN (valid 1 year, cannot place orders, no daily login).
// Env: UPSTOX_ANALYTICS_TOKEN
// Sectors, stocks, breadth and radar stay SAMPLE data and are labelled that way on the site.
const demo = require('./demo');
const BASE = process.env.UPSTOX_BASE || 'https://api.upstox.com';
const TOKEN = process.env.UPSTOX_ANALYTICS_TOKEN;
const KEYS = [['NIFTY 50', 'NSE_INDEX|Nifty 50'], ['BANKNIFTY', 'NSE_INDEX|Nifty Bank'], ['FINNIFTY', 'NSE_INDEX|Nifty Fin Service']], VIX = 'NSE_INDEX|India VIX';

async function get(path, params) {
  const r = await fetch(BASE + path + '?' + new URLSearchParams(params), {
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + TOKEN }, signal: AbortSignal.timeout(10000) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  if (r.status === 401 || r.status === 403 || /UDAPI100050|invalid token|token.*expired/i.test(t))
    throw new Error('Upstox rejected the token. Generate a new Analytics Token and update UPSTOX_ANALYTICS_TOKEN in Render.');
  if (r.status === 429) throw new Error('Upstox says too many requests. Increase the refresh interval on the admin page.');
  if (!r.ok || j.status === 'error') throw new Error(`Upstox ${path} failed (${r.status}): ${t.slice(0, 160)}`);
  return j.data;
}
const istDay = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const norm = s => String(s || '').replace(':', '|');

const UKEY = { NIFTY: 'NSE_INDEX|Nifty 50', BANKNIFTY: 'NSE_INDEX|Nifty Bank', FINNIFTY: 'NSE_INDEX|Nifty Fin Service' };

// ---- real F&O stock universe (instrument list + quotes + daily candles)
const zlib = require('zlib');
const INSTR = process.env.UPSTOX_INSTR_URL || 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';
const NOT_STOCK = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50']);
const SECTORS = { Banks: 'HDFCBANK ICICIBANK SBIN KOTAKBANK AXISBANK INDUSINDBK BANKBARODA PNB FEDERALBNK IDFCFIRSTB AUBANK BANDHANBNK CANBK RBLBANK UNIONBANK INDIANB BANKINDIA YESBANK',
  NBFCs: 'BAJFINANCE BAJAJFINSV SBILIFE HDFCLIFE ICICIGI ICICIPRULI CHOLAFIN SHRIRAMFIN MUTHOOTFIN MANAPPURAM LICHSGFIN PFC RECLTD HDFCAMC SBICARD LICI JIOFIN PNBHOUSING POLICYBZR ABCAPITAL M&MFIN IRFC LTF CDSL BSE ANGELONE MFSL',
  IT: 'TCS INFY WIPRO HCLTECH TECHM LTIM MPHASIS COFORGE PERSISTENT OFSS KPITTECH TATAELXSI CYIENT TATATECH',
  Auto: 'MARUTI M&M TATAMOTORS BAJAJ-AUTO EICHERMOT HEROMOTOCO TVSMOTOR ASHOKLEY BOSCHLTD MOTHERSON BHARATFORG BALKRISIND APOLLOTYRE EXIDEIND UNOMINDA SONACOMS MRF',
  Pharma: 'SUNPHARMA DRREDDY CIPLA DIVISLAB LUPIN AUROPHARMA TORNTPHARM ZYDUSLIFE ALKEM GLENMARK BIOCON MANKIND APOLLOHOSP LAURUSLABS FORTIS MAXHEALTH GRANULES SYNGENE',
  Metals: 'TATASTEEL JSWSTEEL HINDALCO VEDL SAIL NMDC JINDALSTEL HINDCOPPER NATIONALUM APLAPOLLO JSL',
  Energy: 'RELIANCE ONGC NTPC POWERGRID COALINDIA BPCL IOC GAIL TATAPOWER ADANIGREEN ADANIPOWER ADANIENT PETRONET OIL HINDPETRO NHPC SJVN TORNTPOWER IGL MGL CESC ADANIENSOL',
  FMCG: 'HINDUNILVR ITC NESTLEIND BRITANNIA DABUR GODREJCP COLPAL MARICO TATACONSUM UBL VBL PATANJALI UNITDSPR',
  Realty: 'DLF GODREJPROP LODHA OBEROIRLTY PRESTIGE PHOENIXLTD' };
const SECOF = {}; Object.entries(SECTORS).forEach(([s, l]) => l.split(' ').forEach(x => SECOF[x] = s));
const expDay = e => typeof e === 'number' ? new Date(e + 5.5 * 3600e3).toISOString().slice(0, 10) : String(e || '').slice(0, 10);
let eqAll = {}, uni = null, uniAt = 0, uniLoading = null, uniFail = 0;
function loadUniverse() {
  if (uni && Date.now() - uniAt < 12 * 3600e3) return uni;
  if (uniLoading || Date.now() < uniFail) return uni;           // load in the background, retry after a pause on failure
  uniLoading = (async () => {
    // Stream the big gzip file and keep only equity and stock-futures rows, so memory stays small.
    const { Readable } = require('stream'), { StringDecoder } = require('string_decoder');
    const r = await fetch(INSTR, { signal: AbortSignal.timeout(180000) }); if (!r.ok) throw new Error('instrument list ' + r.status);
    const eq = {}, fut = {}, today = istDay(), dec = new StringDecoder('utf8');
    let depth = 0, inStr = false, esc = false, cur = '';
    const take = obj => { if (!/NSE_(EQ|FO)/.test(obj) || !/"(EQ|FUT)"/.test(obj)) return; let x; try { x = JSON.parse(obj); } catch { return; }
      if (x.segment === 'NSE_EQ' && x.instrument_type === 'EQ') eq[x.trading_symbol] = x.instrument_key;
      else if (x.segment === 'NSE_FO' && x.instrument_type === 'FUT' && x.underlying_symbol && !NOT_STOCK.has(x.underlying_symbol) && !/TEST/i.test(x.underlying_symbol)) {
        const d = expDay(x.expiry); if (d >= today && (!fut[x.underlying_symbol] || d < fut[x.underlying_symbol].d)) fut[x.underlying_symbol] = { d, key: x.instrument_key }; } };
    const scan = str => { let from = depth ? 0 : -1;
      for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i);
        if (inStr) { if (esc) esc = false; else if (ch === 92) esc = true; else if (ch === 34) inStr = false; continue; }
        if (ch === 34) inStr = true;
        else if (ch === 123) { if (depth++ === 0) from = i; }
        else if (ch === 125 && --depth === 0) { take(cur + str.slice(from < 0 ? 0 : from, i + 1)); cur = ''; from = -1; } }
      if (depth > 0) cur += str.slice(from < 0 ? 0 : from); };
    const gz = Readable.fromWeb(r.body).pipe(zlib.createGunzip());
    await new Promise((res, rej) => { gz.on('data', c => scan(dec.write(c))); gz.on('end', res); gz.on('error', rej); });
    eqAll = eq;
    uni = Object.keys(fut).filter(s => eq[s]).sort().map(s => ({ n: s, sec: SECOF[s] || 'Others', eq: eq[s], fut: fut[s].key })); uniAt = Date.now();
    if (!uni.length) { uni = null; throw new Error('no F&O stocks found in instrument list'); }
  })().catch(e => { console.error('universe:', e.message); uniFail = Date.now() + 5 * 60e3; }).finally(() => { uniLoading = null; });
  return uni;
}
const hist = {}, hqs = new Set(), hq = []; let hrun = false;
function rsi14(c) { if (c.length < 15) return null; let g = 0, l = 0; for (let i = 1; i <= 14; i++) { const d = c[i] - c[i - 1]; d >= 0 ? g += d : l -= d; } g /= 14; l /= 14;
  for (let i = 15; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * 13 + Math.max(d, 0)) / 14; l = (l * 13 + Math.max(-d, 0)) / 14; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
async function loadHist(list) {                                   // daily candles, a few at a time; new symbols can be queued at any time
  const day = istDay(); for (const s of list) if (!(hist[s.n] && hist[s.n].day === day) && !hqs.has(s.n)) { hqs.add(s.n); hq.push(s); }
  if (hrun || !hq.length) return; hrun = true;
  const from = new Date(Date.now() + 5.5 * 3600e3 - 100 * 864e5).toISOString().slice(0, 10);
  const worker = async () => { while (hq.length) { const s = hq.shift();
    try { const r = await fetch(`${BASE}/v3/historical-candle/${encodeURIComponent(s.eq)}/days/1/${day}/${from}`, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + TOKEN }, signal: AbortSignal.timeout(10000) });
      const j = await r.json(), cs = ((j.data && j.data.candles) || []).filter(c => String(c[0]).slice(0, 10) < day);   // completed days only, newest first
      if (cs.length > 15) { const cl = cs.map(c => +c[4]).reverse(), lr = []; for (let k = cl.length - 20; k < cl.length; k++) lr.push(Math.log(cl[k] / cl[k - 1]));
        const m = lr.reduce((a, b) => a + b, 0) / lr.length, sd = Math.sqrt(lr.reduce((a, b) => a + (b - m) ** 2, 0) / (lr.length - 1));
        const v20 = cs.slice(0, 20).reduce((a, c) => a + (+c[5] || 0), 0) / Math.min(20, cs.length), P = cs[0];
        hist[s.n] = { day, rsi: rsi14(cl), hv: sd * Math.sqrt(252) * 100, avgVol: v20, h: +P[2], l: +P[3], c: +P[4] }; }
    } catch (e) { /* skip this stock */ } hqs.delete(s.n); await new Promise(r => setTimeout(r, 120)); } };
  await Promise.all([worker(), worker(), worker()]); hrun = false;
}
let oiBase = {}, oiDay = '';
async function stockRows(nc) {
  const u = loadUniverse(); if (!u) return null;
  loadHist(u).catch(() => {});
  const keys = [], day = istDay(); if (oiDay !== day) { oiBase = {}; oiDay = day; }
  const chunk = (a, n) => a.length ? [a.slice(0, n), ...chunk(a.slice(n), n)] : [];
  const fetchQ = async ks => { const out = {}; for (const c of chunk(ks, 100)) { const q = await get('/v2/market-quote/quotes', { instrument_key: c.join(',') }); Object.values(q || {}).forEach(v => out[norm(v.instrument_token)] = v); } return out; };
  const E = await fetchQ(u.map(s => s.eq)), F = await fetchQ(u.map(s => s.fut));
  const mins = new Date(Date.now() + 5.5 * 3600e3), el = Math.min(1, Math.max(.05, (mins.getUTCHours() * 60 + mins.getUTCMinutes() - 555) / 375));
  const rows = u.map(s => { const e = E[s.eq], f = F[s.fut]; if (!e || !(+e.last_price)) return null;
    const p = +e.last_price, prev = typeof e.net_change === 'number' ? p - e.net_change : +(e.ohlc && e.ohlc.close), c = prev ? (p / prev - 1) * 100 : 0, h = hist[s.n] || {}, vol = +e.volume || 0;
    const oi = f ? +f.oi || 0 : 0; if (oi && !oiBase[s.n]) oiBase[s.n] = oi;
    const bq = +e.total_buy_quantity || 0, sq = +e.total_sell_quantity || 0, buy = bq + sq ? bq / (bq + sq) * 100 : 50;
    const P = h.c ? (h.h + h.l + h.c) / 3 : p, oh = e.ohlc || {};
    return { n: s.n, sec: s.sec, p, c, rsi: h.rsi == null ? null : h.rsi, iv: h.hv == null ? null : h.hv, basis: f && +f.last_price ? (f.last_price / p - 1) * 100 : 0,
      rs: c - nc, vol: h.avgVol ? vol / (h.avgVol * el) : 1, liq: 0, oiChg: oiBase[s.n] ? (oi / oiBase[s.n] - 1) * 100 : 0, buy, turn: p * vol / 1e7,
      blocks: [{ px: Math.min(+oh.low || p, 2 * P - (h.h || p)), side: 'Demand', str: Math.round(buy) }, { px: +oh.low || p, side: 'Demand', str: Math.round(buy) },
        { px: +oh.high || p, side: 'Supply', str: Math.round(100 - buy) }, { px: Math.max(+oh.high || p, 2 * P - (h.l || p)), side: 'Supply', str: Math.round(100 - buy) }] }; }).filter(Boolean);
  const by = [...rows].sort((a, b) => a.turn - b.turn); by.forEach((r, i) => r.liq = Math.round((i + 1) / by.length * 100));
  return rows;
}


// ---- index stock lists (NSE Indices constituent CSVs) and radar rows for any universe
const LIST_FILES = { nifty50: 'ind_nifty50list', banknifty: 'ind_niftybanklist', next50: 'ind_niftynext50list', nifty100: 'ind_nifty100list', nifty500: 'ind_nifty500list', midcap150: 'ind_niftymidcap150list', smallcap250: 'ind_niftysmallcap250list' };
const LIST_BASE = process.env.LIST_BASE || 'https://www.niftyindices.com/IndexConstituent', lists = {};
const csvRows = t => t.split(/\r?\n/).filter(Boolean).map(l => { const o = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o; });
async function loadList(k) {
  const L = lists[k]; if (L && Date.now() - L.at < 24 * 3600e3) return L;
  const r = await fetch(`${LIST_BASE}/${LIST_FILES[k]}.csv`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StrikewiseBot/1.0)', Accept: 'text/csv,*/*' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('Index stock list is unavailable right now (' + r.status + ').');
  const rows = csvRows(await r.text()), hd = (rows[0] || []).map(x => x.trim().toLowerCase()), si = hd.indexOf('symbol'), ii = hd.indexOf('industry');
  if (si < 0) throw new Error('Index stock list format changed, so it cannot be read.');
  const syms = [], ind = {}; rows.slice(1).forEach(c => { const s = (c[si] || '').trim(); if (s) { syms.push(s); if (ii >= 0) ind[s] = (c[ii] || '').trim(); } });
  return (lists[k] = { at: Date.now(), syms, ind });
}
async function quotesFor(keys) {
  const chunks = [], out = {}; let i = 0;
  for (let k = 0; k < keys.length; k += 100) chunks.push(keys.slice(k, k + 100));
  const w = async () => { while (i < chunks.length) { const c = chunks[i++]; const q = await get('/v2/market-quote/quotes', { instrument_key: c.join(',') }); Object.values(q || {}).forEach(v => { out[norm(v.instrument_token)] = v; }); } };
  await Promise.all([w(), w(), w()]); return out;
}

const IDX_KEYS = { NIFTY: 'NSE_INDEX|Nifty 50', BANKNIFTY: 'NSE_INDEX|Nifty Bank', FINNIFTY: 'NSE_INDEX|Nifty Fin Service', INDIAVIX: 'NSE_INDEX|India VIX' };
module.exports = {
  mode: 'live', delayMinutes: 0,
  async getCandles(sym, tf) {
    if (!TOKEN) throw new Error('Set UPSTOX_ANALYTICS_TOKEN in Render (Environment).');
    let key = IDX_KEYS[sym];
    if (!key) { const u = loadUniverse(), s = (uni || []).find(x => x.n === sym); if (!s) throw new Error(uni ? 'Unknown stock ' + sym : 'Stock list is still loading. Try again in a minute.'); key = s.eq; }
    const daily = tf === 'd' || tf === '1d', unit = daily ? 'days' : 'minutes', iv = daily ? 1 : parseInt(tf), enc = encodeURIComponent(key), day = istDay();
    const ago = n => new Date(Date.now() + 5.5 * 3600e3 - n * 864e5).toISOString().slice(0, 10), span = daily ? 420 : tf === '1m' ? 4 : tf === '5m' ? 10 : 25;
    const m = new Map(), add = d => ((d && d.candles) || []).forEach(c => { const t = Date.parse(c[0]); if (t) m.set(t, { t, o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] || 0 }); });
    add(await get(`/v3/historical-candle/${enc}/${unit}/${iv}/${daily ? day : ago(1)}/${ago(span)}`, {}));
    try { add(await get(`/v3/historical-candle/intraday/${enc}/${unit}/${iv}`, {})); } catch (e) { if (/rejected the token/i.test(e.message)) throw e; }
    const candles = [...m.values()].sort((a, b) => a.t - b.t).slice(-400);
    if (!candles.length) throw new Error('No candles returned for ' + sym);
    return { sym, tf, candles, source: 'live' };
  },
  async getRadar(u) {
    if (!TOKEN) throw new Error('Set UPSTOX_ANALYTICS_TOKEN in Render (Environment).');
    loadUniverse(); if (!uni) throw new Error('Stock list is still loading. Try again in a minute.');
    let syms, ind = {};
    if (u === 'all') syms = Object.keys(eqAll); else if (u === 'fo') syms = uni.map(s => s.n); else { const L = await loadList(u); syms = L.syms; ind = L.ind; }
    const items = syms.map(n => ({ n, eq: eqAll[n] })).filter(x => x.eq);
    if (u !== 'all') loadHist(items).catch(() => {});                       // volume spike and RSI fill in as history loads
    const Q = await quotesFor(items.map(x => x.eq)), tm = new Date(Date.now() + 5.5 * 3600e3), el = Math.min(1, Math.max(.05, (tm.getUTCHours() * 60 + tm.getUTCMinutes() - 555) / 375));
    let rows = items.map(s => { const e = Q[s.eq]; if (!e || !(+e.last_price)) return null; const last = +e.last_price, prev = typeof e.net_change === 'number' ? last - e.net_change : +(e.ohlc && e.ohlc.close), h = hist[s.n];
      return { n: s.n, sec: SECOF[s.n] || ind[s.n] || 'Others', p: last, c: prev ? (last / prev - 1) * 100 : 0, vol: h && h.avgVol ? (+e.volume || 0) / (h.avgVol * el) : null, rsi: h && h.rsi != null ? h.rsi : null }; }).filter(Boolean);
    const total = rows.length, loaded = rows.filter(r => r.vol != null).length;
    if (u === 'all') rows = rows.filter(r => Math.abs(r.c) >= 2 || (r.vol != null && r.vol >= 2.4));
    return { u, rows, source: 'live', total, loaded };
  },
  async getChain(u, e) {
    if (!TOKEN) throw new Error('Set UPSTOX_ANALYTICS_TOKEN in Render (Environment).');
    let key = UKEY[u];
    if (!key) { loadUniverse(); const st = (uni || []).find(x => x.n === u); if (!st) throw new Error(uni ? u + ' is not in the F&O stock list.' : 'Stock list is still loading. Try again in a minute.'); key = st.eq; }
    const cs = await get('/v2/option/contract', { instrument_key: key });
    const expiries = [...new Set((cs || []).map(c => c.expiry))].filter(d => d >= istDay()).sort().slice(0, 6);
    if (!expiries.length) throw new Error('No expiries returned');
    const expiry = expiries.includes(e) ? e : expiries[0];
    const ch = await get('/v2/option/chain', { instrument_key: key, expiry_date: expiry });
    let spot = +((ch[0] && ch[0].underlying_spot_price) || 0); if (!spot) { const ks = (ch || []).map(r => +r.strike_price).sort((a, b) => a - b); spot = ks[Math.floor(ks.length / 2)] || 0; }
    const oi = o => (o && o.market_data && +o.market_data.oi) || 0, iv = o => (o && o.option_greeks && +o.option_greeks.iv) || 0;
    const rows = (ch || []).map(r => ({ k: +r.strike_price, ce: { oi: oi(r.call_options), iv: iv(r.call_options) }, pe: { oi: oi(r.put_options), iv: iv(r.put_options) } }))
      .sort((a, b) => Math.abs(a.k - spot) - Math.abs(b.k - spot)).slice(0, 25).sort((a, b) => a.k - b.k);
    return { u, spot, expiry, expiries, rows, source: 'live' };
  },
  async getSnapshot() {
    if (!TOKEN) throw new Error('Set UPSTOX_ANALYTICS_TOKEN in Render (Environment).');
    const base = await demo.getSnapshot();            // sample parts
    // 1) index levels + India VIX (full quote)
    const q = await get('/v2/market-quote/quotes', { instrument_key: [...KEYS.map(k => k[1]), VIX].join(',') });
    const by = {}; Object.entries(q || {}).forEach(([k, v]) => by[norm(v.instrument_token || k)] = v);
    const vixRow = by[VIX]; if (!vixRow) throw new Error('Upstox returned no index data. Try again during market hours, or check the token.');
    const vix = +vixRow.last_price;
    const idx = KEYS.map(([n, key]) => {
      const x = by[key]; if (!x) throw new Error('Missing index ' + n);
      const last = +x.last_price, nc = x.net_change, prev = typeof nc === 'number' ? last - nc : +(x.ohlc && x.ohlc.close);
      return { n, p: last, c: prev ? (last / prev - 1) * 100 : 0, iv: vix };
    });
    // 2) NIFTY option chain, nearest expiry
    let strikes = base.strikes, atmIv = null;
    try {
      const cs = await get('/v2/option/contract', { instrument_key: KEYS[0][1] });
      const expiry = [...new Set((cs || []).map(c => c.expiry))].filter(d => d >= istDay()).sort()[0];
      if (expiry) {
        const ch = await get('/v2/option/chain', { instrument_key: KEYS[0][1], expiry_date: expiry });
        const spot = +idx[0].p;
        const rows = (ch || []).map(r => ({ k: Math.round(+r.strike_price), ce: r.call_options || {}, pe: r.put_options || {} }))
          .filter(r => r.k % 100 === 0).sort((a, b) => Math.abs(a.k - spot) - Math.abs(b.k - spot)).slice(0, 11).sort((a, b) => a.k - b.k);
        if (rows.length) {
          const oi = o => Math.round(((o.market_data && +o.market_data.oi) || 0) / 1000);
          strikes = rows.map(r => ({ k: r.k, ce: oi(r.ce), pe: oi(r.pe) }));
          const atm = rows.reduce((a, b) => Math.abs(b.k - spot) < Math.abs(a.k - spot) ? b : a);
          const iv = ((+(atm.ce.option_greeks || {}).iv || 0) + (+(atm.pe.option_greeks || {}).iv || 0)) / 2; if (iv > 0) atmIv = iv;
        }
      }
    } catch (e) { if (/rejected the token/i.test(e.message)) throw e; console.error('option chain:', e.message); }
    if (atmIv) idx[0].iv = atmIv;
    let stocks = base.stocks, sectors = base.sectors, adv = base.adv, dec = base.dec, real = false, loading = false;
    try { const R = await stockRows(idx[0].c); if (R && R.length > 20) { real = true; stocks = R; adv = R.filter(s => s.c > 0).length; dec = R.filter(s => s.c < 0).length;
      sectors = [...new Set(R.map(s => s.sec))].map(n => { const L = R.filter(s => s.sec === n); return { n, c: L.reduce((a, s) => a + s.c, 0) / L.length, v: L.reduce((a, s) => a + s.turn, 0) }; }); } else loading = true; }
    catch (e) { if (/rejected the token/i.test(e.message)) throw e; console.error('stocks:', e.message); loading = true; }
    const SN = real ? { sectors: 'Live: average change of the stocks in each sector, turnover in ₹ crore.', screener: 'Live prices and futures basis. RSI and volatility come from daily candles and fill in after the first load. The volatility column is 20-day historical volatility, not implied volatility.',
      strength: 'Live relative strength versus NIFTY. Liquidity is a rank of today\'s turnover.', radar: 'Live scan. Volume spike compares today\'s volume with the 20-day average, adjusted for time of day.',
      calm: 'Uses 20-day historical volatility and today\'s move.', liquidity: 'Live turnover rank and day change.', oiflow: 'OI change is measured since this server first saw the stock today, so it is partial if the server started late.',
      flow: 'Buy pressure is the share of buy quantity in the order book. Order blocks are found with simple rules on 5-minute candles of the latest session. Learning tool, not signals.', stock: 'Live quote with daily-candle indicators.' }
      : { sectors: 'Stock list is still loading, so this is sample data for now.', screener: 'Stock list is still loading, so this is sample data for now.', strength: 'Stock list is still loading, so this is sample data for now.', radar: 'Stock list is still loading, so this is sample data for now.', calm: 'Sample data for now.', liquidity: 'Sample data for now.', oiflow: 'Sample data for now.', flow: 'Sample data for now.', stock: 'Sample data for now.' };
    return {
      ...base, idx, vix, strikes, stocks, sectors, adv, dec, asOf: new Date().toISOString(),
      sampleNotes: {
        pulse: real ? 'Index levels, India VIX, breadth and top movers are live. Expected ranges use VIX (NIFTY uses at-the-money IV).' : 'Index levels and India VIX are live. Breadth and movers are sample data for now.',
        options: strikes === base.strikes ? 'Option chain could not be loaded, so this is sample data.' : '',
        ...SN
      }
    };
  }
};
