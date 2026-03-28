const subsetFont = require('subset-font');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;

// Build character set: ASCII printable + all Hangul syllables + common Korean punctuation
let chars = '';

// ASCII printable (32-126)
for (let i = 32; i <= 126; i++) chars += String.fromCharCode(i);

// Common Korean/CJK punctuation (Unicode)
const PUNCT = [
  0x00B7, // ·
  0x2026, // …
  0x2013, 0x2014, // – —
  0x2018, 0x2019, 0x201C, 0x201D, // ' ' " "
  0x300C, 0x300D, 0x300E, 0x300F, // 「」『』
  0x3010, 0x3011, // 【】
  0x300A, 0x300B, 0x3008, 0x3009, // 《》〈〉
  0x2190, 0x2192, 0x2191, 0x2193, // ← → ↑ ↓
  0x25B3, 0x25BD, 0x25CB, 0x25CF, // △ ▽ ○ ●
  0x25CE, 0x2605, 0x2606, // ◎ ★ ☆
  0x203B, 0x2020, 0x2021, 0x00A7, 0x00B6, // ※ † ‡ § ¶
  0x3131, 0x3132, 0x3133, 0x3134, 0x3135, 0x3136, 0x3137, 0x3138, // ㄱ-ㄸ
  0x3139, 0x313A, 0x313B, 0x313C, 0x313D, 0x313E, 0x313F, 0x3140, // ㄹ-ㅀ
  0x3141, 0x3142, 0x3143, 0x3144, 0x3145, 0x3146, 0x3147, 0x3148, // ㅁ-ㅈ
  0x3149, 0x314A, 0x314B, 0x314C, 0x314D, 0x314E, // ㅉ-ㅎ
  0x314F, 0x3150, 0x3151, 0x3152, 0x3153, 0x3154, 0x3155, 0x3156, // ㅏ-ㅖ
  0x3157, 0x3158, 0x3159, 0x315A, 0x315B, 0x315C, 0x315D, 0x315E, // ㅗ-ㅞ
  0x315F, 0x3160, 0x3161, 0x3162, 0x3163, // ㅟ-ㅣ
];
for (const cp of PUNCT) chars += String.fromCodePoint(cp);

// All Hangul syllables: 가(0xAC00) ~ 힣(0xD7A3) = 11172 chars
for (let i = 0xAC00; i <= 0xD7A3; i++) chars += String.fromCharCode(i);

async function run() {
  const pairs = [
    ['NotoSansKR-Regular.ttf', 'NotoSansKR-Regular.subset.ttf'],
    ['NotoSansKR-Bold.ttf', 'NotoSansKR-Bold.subset.ttf'],
  ];
  for (const [inName, outName] of pairs) {
    const inPath = path.join(DIR, inName);
    const outPath = path.join(DIR, outName);
    const buf = fs.readFileSync(inPath);
    const subset = await subsetFont(buf, chars, { targetFormat: 'truetype' });
    fs.writeFileSync(outPath, subset);
    console.log(`${inName} (${(buf.length / 1024).toFixed(0)} KB) -> ${outName} (${(subset.length / 1024).toFixed(0)} KB)`);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
