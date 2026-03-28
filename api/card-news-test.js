// 최소 테스트: 어떤 리소스가 Vercel에서 사용 가능한지 확인
export default async function handler(req, res) {
  const results = {};
  try { await import('@upstash/redis'); results.redis = 'OK'; } catch (e) { results.redis = e.message; }
  try { await import('satori'); results.satori = 'OK'; } catch (e) { results.satori = e.message; }
  try { await import('@resvg/resvg-wasm'); results.resvg_wasm = 'OK'; } catch (e) { results.resvg_wasm = e.message; }
  try {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const r = readFileSync(join(process.cwd(), 'api', '_fonts', 'NotoSansKR-Regular.subset.ttf'));
    results.font_regular = r.length + ' bytes';
    const b = readFileSync(join(process.cwd(), 'api', '_fonts', 'NotoSansKR-Bold.subset.ttf'));
    results.font_bold = b.length + ' bytes';
  } catch (e) { results.fonts = e.message; }
  try {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const w = readFileSync(join(process.cwd(), 'api', '_resvg.wasm'));
    results.wasm_file = w.length + ' bytes';
  } catch (e) { results.wasm_file = e.message; }
  return res.status(200).json(results);
}
