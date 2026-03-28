export default async function handler(req, res) {
  const results = {};
  const BASE = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://ddukddaktool.co.kr';

  try { await import('satori'); results.satori = 'OK'; } catch (e) { results.satori = e.message; }
  try { await import('@resvg/resvg-wasm'); results.resvg = 'OK'; } catch (e) { results.resvg = e.message; }

  try {
    const r = await fetch(`${BASE}/assets/NotoSansKR-Regular.subset.ttf`);
    results.font_regular = r.ok ? (await r.arrayBuffer()).byteLength + ' bytes' : r.status;
  } catch (e) { results.font_regular = e.message; }

  try {
    const w = await fetch(`${BASE}/assets/resvg.wasm`);
    results.wasm = w.ok ? (await w.arrayBuffer()).byteLength + ' bytes' : w.status;
  } catch (e) { results.wasm = e.message; }

  try {
    const { initWasm, Resvg } = await import('@resvg/resvg-wasm');
    const wResp = await fetch(`${BASE}/assets/resvg.wasm`);
    await initWasm(await wResp.arrayBuffer());
    results.wasm_init = 'OK';
  } catch (e) { results.wasm_init = e.message; }

  results.base_url = BASE;
  return res.status(200).json(results);
}
