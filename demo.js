// Demo provider: simulated prices that drift on every call. No real market data.
const rnd = (a, b) => a + (b - a) * Math.random();
const walk = (p, vol) => p * (1 + rnd(-vol, vol) / 100);
const st = {
  idx: [['NIFTY 50', 24100], ['BANKNIFTY', 52300], ['FINNIFTY', 23400]].map(([n, p]) => ({ n, base: p, p })),
  stocks: ['ALPHABANK','BETAFIN','GAMMAIT','DELTAAUTO','EPSILONPH','ZETAMETAL','ETAPOWER','THETAFMCG','IOTAREALTY','KAPPASTEEL','LAMBDATEL','MUCEMENT']
    .map(n => ({ n, base: rnd(150, 3200), p: 0, rsi: rnd(35, 65) })),
  sectors: ['Banks','NBFCs','IT','Auto','Pharma','Metals','Energy','FMCG','Realty'].map(n => ({ n, c: 0, v: rnd(800, 4200) })),
  oi: [], vix: 14
};
st.stocks.forEach(s => s.p = s.base);
for (let k = 23600; k <= 24600; k += 100) st.oi.push({ k, ce: rnd(40, 200), pe: rnd(40, 200) });

module.exports = {
  mode: 'demo', delayMinutes: 0,
  async getSnapshot() {
    st.idx.forEach(i => i.p = walk(i.p, .12));
    st.vix = Math.max(9, Math.min(25, st.vix + rnd(-.3, .3)));
    st.stocks.forEach(s => { s.p = walk(s.p, .25); s.rsi = Math.max(10, Math.min(90, s.rsi + rnd(-3, 3))); });
    st.sectors.forEach(s => { s.c = Math.max(-3, Math.min(3, s.c + rnd(-.15, .15))); s.v += rnd(5, 60); });
    st.oi.forEach(o => { o.ce = Math.max(10, o.ce + rnd(-6, 8)); o.pe = Math.max(10, o.pe + rnd(-6, 8)); });
    const up = st.stocks.filter(s => s.p >= s.base).length, adv = Math.round(up / st.stocks.length * 218);
    return {
      idx: st.idx.map(i => ({ n: i.n, p: i.p, c: (i.p / i.base - 1) * 100, iv: st.vix * 1.05 })),
      vix: st.vix, adv, dec: 218 - adv,
      sectors: st.sectors.map(s => ({ n: s.n, c: s.c, v: s.v })),
      stocks: st.stocks.map(s => ({ n: s.n, p: s.p, c: (s.p / s.base - 1) * 100, rsi: s.rsi, iv: 20 + (100 - s.rsi) * .3, basis: rnd(-.2, .9), rs: (s.p / s.base - 1) * 100 - (st.idx[0].p / st.idx[0].base - 1) * 100, vol: rnd(.6, 3.2), liq: 40 + (s.base % 55) })),
      strikes: st.oi.map(o => ({ k: o.k, ce: Math.round(o.ce), pe: Math.round(o.pe) })),
      events: ['Demo: simulated volume spike', 'Demo: simulated breakout'],
      news: ['Connect a licensed provider to see real headlines']
    };
  }
};
