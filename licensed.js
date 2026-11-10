// Licensed provider: fill in with YOUR vendor or broker API (check its terms first).
// getSnapshot() must return the same JSON shape as providers/demo.js:
// { idx:[{n,p,c,iv}], vix, adv, dec, sectors:[{n,c,v}], stocks:[{n,p,c,rsi,iv,basis,rs,vol,liq}],
//   strikes:[{k,ce,pe}], events:[], news:[], asOf? }
const KEY = process.env.DATA_API_KEY, BASE = process.env.DATA_API_URL;
module.exports = {
  mode: 'delayed',          // 'live' or 'delayed', shown in the page header
  delayMinutes: 15,         // set to what your licence provides
  async getSnapshot() {
    if (!KEY || !BASE) throw new Error('Set DATA_API_KEY and DATA_API_URL');
    // const r = await fetch(BASE + '/quotes?symbols=...', { headers: { Authorization: 'Bearer ' + KEY } });
    // TODO: call your vendor's quote, index and option-chain endpoints, then map them into the shape above.
    throw new Error('licensed provider not implemented yet');
  }
};
