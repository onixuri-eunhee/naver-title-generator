// 최소 테스트: 어떤 import가 Vercel에서 실패하는지 격리
export default async function handler(req, res) {
  const results = {};

  // 1. 기본 모듈
  try {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    results.fs = 'OK';
  } catch (e) { results.fs = e.message; }

  // 2. Redis
  try {
    const { Redis } = await import('@upstash/redis');
    results.redis = 'OK';
  } catch (e) { results.redis = e.message; }

  // 3. Satori
  try {
    const satori = await import('satori');
    results.satori = 'OK';
  } catch (e) { results.satori = e.message; }

  // 4. Resvg WASM
  try {
    const resvg = await import('@resvg/resvg-wasm');
    results.resvg_wasm = 'OK';
  } catch (e) { results.resvg_wasm = e.message; }

  // 5. 폰트 파일 존재
  try {
    const { readFileSync: rf } = await import('fs');
    const { join: j } = await import('path');
    const dir = j(process.cwd(), 'fonts');
    const r = rf(j(dir, 'NotoSansKR-Regular.subset.ttf'));
    results.font_regular = r.length + ' bytes';
    const b = rf(j(dir, 'NotoSansKR-Bold.subset.ttf'));
    results.font_bold = b.length + ' bytes';
  } catch (e) { results.fonts = e.message; }

  // 6. WASM 파일 존재
  try {
    const { readFileSync: rf } = await import('fs');
    const { join: j } = await import('path');
    const wasmPath = j(process.cwd(), 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm');
    const w = rf(wasmPath);
    results.wasm_file = w.length + ' bytes';
  } catch (e) { results.wasm_file = e.message; }

  return res.status(200).json(results);
}
