import {
  getRedis,
  resolveAdmin,
  getClientIp,
  isCreditsActive,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { logUsage, chargeCredits, refundCredits, getUserCredits } from '@/lib/db';
import { themes } from '@/lib/card-news-themes';
import { withRichness } from '@/lib/card-news-layouts';
import { pickVariant } from '@/lib/card-news-variants';
import { h, lines, _F, getSatori, getResvg, initResvgWasm, loadFonts } from '@/lib/satori-renderer';
import { verifyOwnershipByUrls } from '@/lib/user-images';
import { SEDA_PROMPT_BLOCK } from '@/lib/shared-prompts/seda';
import { CARD_NEWS_LIMITS, findOverflows } from '@/lib/shared-prompts/length-rules';
import { resolveRolloutFlag } from '@/lib/shared-prompts/rollout';
import { createJobId } from '@/lib/job-progress';

export const maxDuration = 180;

const FREE_DAILY_LIMIT = 3;
const FREE_CUTOFF = '2026-04-24T23:59:59+09:00';
// mode별 크레딧 비용 — basic(Satori): 1크레딧(원가 ~21원), premium(Chromium): 2크레딧(원가 ~173원)
const CARD_NEWS_CREDIT_COST = 1; // basic 기본 (기존 호환)
const CARD_NEWS_CREDIT_COST_BASIC = 1;
const CARD_NEWS_CREDIT_COST_PREMIUM = 2;
const CANVAS_W = 1080;
const CANVAS_H = 1350;

function getKSTDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function getTodayKey(ip) {
  return `ratelimit:cardnews:${ip}:${getKSTDate()}`;
}

function getTTLUntilMidnightKST() {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const nextMidnight = new Date(kstNow);
  nextMidnight.setUTCHours(0, 0, 0, 0);
  nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  const seconds = Math.ceil((nextMidnight.getTime() - kstNow.getTime()) / 1000);
  return Math.max(seconds, 60);
}

const _W = 1080, _H = 1350, _P = 100;

// ═════════════════════════════════════════════════════════════
// Variant 헬퍼 — Phase 1
// ═════════════════════════════════════════════════════════════

// variant 폰트 사이즈 안전 조회 (없으면 fallback)
function sz(v, layoutName, key, fallback) {
  if (!v || !v.getSize) return fallback;
  const val = v.getSize(layoutName, key);
  return typeof val === 'number' ? val : fallback;
}

// 번호 배지 — 4가지 스타일 (numberStyle)
function renderNumberBadge(num, t, style) {
  if (style === 'big-serif') {
    return h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 32 } },
      h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 120, color: t.primary, opacity: 0.2, lineHeight: 0.9, letterSpacing: -4, marginRight: 24 } }, num),
      h('div', { style: { display: 'flex', width: 48, height: 4, background: t.accent, borderRadius: 2 } }),
    );
  }
  if (style === 'underline') {
    return h('div', { style: { display: 'flex', flexDirection: 'column', marginBottom: 32 } },
      h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 72, color: t.primary, lineHeight: 1, marginBottom: 8 } }, num),
      h('div', { style: { display: 'flex', width: 96, height: 4, background: t.accent, borderRadius: 2 } }),
    );
  }
  if (style === 'corner-tag') {
    return h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 32, gap: 14 } },
      h('div', { style: { display: 'flex', padding: '10px 20px', background: t.accent, borderRadius: 6 } },
        h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 30, color: t.bgDark, letterSpacing: 2 } }, `NO.${num}`),
      ),
      h('div', { style: { display: 'flex', width: 40, height: 4, background: t.accent, borderRadius: 2 } }),
    );
  }
  // 기본: circle-badge
  return h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 32 } },
    h('div', { style: { display: 'flex', width: 88, height: 88, borderRadius: 44, background: `${t.primary}12`, alignItems: 'center', justifyContent: 'center', marginRight: 20 } },
      h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 48, color: t.primary, lineHeight: 1 } }, num),
    ),
    h('div', { style: { display: 'flex', width: 48, height: 4, background: t.accent, borderRadius: 2 } }),
  );
}

// 액센트 장식 — 카드뉴스 모서리에 4가지 위치
function renderAccentDecor(t, placement) {
  if (placement === 'top-bar') {
    return h('div', { style: { display: 'flex', position: 'absolute', top: 0, left: 0, width: _W, height: 12, background: t.accent } });
  }
  if (placement === 'corner-mark') {
    return h('div', { style: { display: 'flex', position: 'absolute', top: 48, left: 48, flexDirection: 'column' } },
      h('div', { style: { display: 'flex', width: 48, height: 4, background: t.accent, borderRadius: 2 } }),
      h('div', { style: { display: 'flex', width: 4, height: 44, background: t.accent, borderRadius: 2 } }),
    );
  }
  if (placement === 'dot-cluster') {
    return h('div', { style: { display: 'flex', position: 'absolute', top: 60, right: 60, flexDirection: 'row', gap: 10 } },
      h('div', { style: { display: 'flex', width: 12, height: 12, borderRadius: 6, background: t.accent } }),
      h('div', { style: { display: 'flex', width: 12, height: 12, borderRadius: 6, background: `${t.accent}80` } }),
      h('div', { style: { display: 'flex', width: 12, height: 12, borderRadius: 6, background: `${t.accent}40` } }),
    );
  }
  // 기본 left-bar
  return h('div', { style: { display: 'flex', position: 'absolute', top: 80, left: 0, width: 10, height: 160, background: t.accent, borderRadius: '0 5px 5px 0' } });
}

const layouts = {
  cover: (s, t, v) => h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: _W, height: _H, background: t.bgDark, padding: _P, position: 'relative' } },
    h('div', { style: { display: 'flex', position: 'absolute', top: -60, right: -60, width: 280, height: 280, background: t.accent, opacity: 0.07, borderRadius: 140 } }),
    h('div', { style: { display: 'flex', position: 'absolute', bottom: -40, left: -40, width: 200, height: 200, background: t.primary, opacity: 0.05, borderRadius: 100 } }),
    v ? renderAccentDecor(t, v.accentPlacement) : null,
    h('div', { style: { display: 'flex', width: 120, height: 6, background: t.accent, borderRadius: 3, marginBottom: 48 } }),
    lines(s.title, { fontFamily: _F, fontWeight: 700, fontSize: s.title && s.title.replace(/\n/g, '').length > 16 ? sz(v, 'cover', 'title', 96) - 16 : sz(v, 'cover', 'title', 96), color: '#FFFFFF', textAlign: 'center', lineHeight: 1.2, letterSpacing: -0.5, maxWidth: _W - _P * 2, justifyContent: 'center', alignItems: 'center' }),
    s.subtitle ? lines(s.subtitle, { fontFamily: _F, fontWeight: 400, fontSize: sz(v, 'cover', 'subtitle', 36), color: t.accent, marginTop: 32, textAlign: 'center', lineHeight: 1.5, letterSpacing: 0.5, maxWidth: _W - _P * 2, justifyContent: 'center', alignItems: 'center' }) : null,
    s.brand ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 24, color: 'rgba(255,255,255,0.4)', marginTop: 64, letterSpacing: 3 } }, s.brand) : null,
  ),
  summary: (s, t, v) => h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: _W, height: _H, background: t.bgDark, padding: 60, position: 'relative' } },
    v ? renderAccentDecor(t, v.accentPlacement) : null,
    h('div', { style: { display: 'flex', flexDirection: 'column', width: _W - 120, background: t.bg, borderRadius: t.radius + 8, padding: 72, borderLeft: `8px solid ${t.accent}` } },
      s.label ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: sz(v, 'summary', 'label', 28), color: t.accent, marginBottom: 24, letterSpacing: 3 } }, s.label) : null,
      lines(s.title, { fontFamily: _F, fontWeight: 700, fontSize: sz(v, 'summary', 'title', 52), color: t.text, lineHeight: 1.3, marginBottom: 32, textAlign: 'left' }),
      lines(s.body, { fontFamily: _F, fontWeight: 400, fontSize: sz(v, 'summary', 'body', 36), color: t.textLight, lineHeight: 1.7, letterSpacing: 0.3, textAlign: 'left' }),
    ),
  ),
  content: (s, t, v) => {
    const num = s.number ? String(s.number).padStart(2, '0') : '01';
    const slideIndex = v && typeof v._slideIndex === 'number' ? v._slideIndex : (parseInt(num) || 0);
    const contentVar = v && v.getContentVariant ? v.getContentVariant(slideIndex) : ['A', 'B', 'C'][slideIndex % 3];
    if (contentVar === 'B') return layouts._contentB(s, t, num, v);
    if (contentVar === 'C') return layouts._contentC(s, t, num, v);
    // A (기본) — numberStyle 따라 번호 배지 변형
    return h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: _W, height: _H, background: t.secondary, padding: 60, position: 'relative' } },
      v ? renderAccentDecor(t, v.accentPlacement) : null,
      h('div', { style: { display: 'flex', flexDirection: 'column', width: _W - 120, background: t.bg, borderRadius: t.radius + 8, padding: 72 } },
        renderNumberBadge(num, t, v ? v.numberStyle : 'circle-badge'),
        lines(s.title, { fontFamily: _F, fontWeight: 700, fontSize: sz(v, 'content', 'title', 48), color: t.text, lineHeight: 1.3, marginBottom: 32, textAlign: 'left' }),
        lines(s.body, { fontFamily: _F, fontWeight: 400, fontSize: sz(v, 'content', 'body', 36), color: t.textLight, lineHeight: 1.7, letterSpacing: 0.3, textAlign: 'left' }),
      ),
    );
  },
  _contentB: (s, t, num, v) => h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: _W, height: _H, background: t.secondary, padding: 60, position: 'relative' } },
    v ? renderAccentDecor(t, v.accentPlacement) : null,
    h('div', { style: { display: 'flex', flexDirection: 'row', width: _W - 120, background: t.bg, borderRadius: t.radius + 8, padding: 72 } },
      h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', width: 140, marginRight: 32, paddingTop: 8 } },
        h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 80, color: t.primary, opacity: 0.15, lineHeight: 1 } }, num),
        h('div', { style: { display: 'flex', width: 4, height: 60, background: t.accent, borderRadius: 2, marginTop: 16 } }),
      ),
      h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1 } },
        lines(s.title, { fontFamily: _F, fontWeight: 700, fontSize: sz(v, 'content', 'title', 48), color: t.text, lineHeight: 1.3, marginBottom: 32, textAlign: 'left' }),
        lines(s.body, { fontFamily: _F, fontWeight: 400, fontSize: sz(v, 'content', 'body', 36), color: t.textLight, lineHeight: 1.7, letterSpacing: 0.3, textAlign: 'left' }),
      ),
    ),
  ),
  _contentC: (s, t, num, v) => h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: _W, height: _H, background: t.secondary, padding: 60, position: 'relative' } },
    v ? renderAccentDecor(t, v.accentPlacement) : null,
    h('div', { style: { display: 'flex', flexDirection: 'column', width: _W - 120, background: t.bg, borderRadius: t.radius + 8, overflow: 'hidden' } },
      h('div', { style: { display: 'flex', width: _W - 120, height: 8, background: t.accent } }),
      h('div', { style: { display: 'flex', flexDirection: 'column', padding: 72 } },
        h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 28, color: t.accent, marginBottom: 16, letterSpacing: 2 } }, `POINT ${num}`),
        lines(s.title, { fontFamily: _F, fontWeight: 700, fontSize: sz(v, 'content', 'title', 48), color: t.text, lineHeight: 1.3, marginBottom: 32, textAlign: 'left' }),
        lines(s.body, { fontFamily: _F, fontWeight: 400, fontSize: sz(v, 'content', 'body', 36), color: t.textLight, lineHeight: 1.7, letterSpacing: 0.3, textAlign: 'left' }),
      ),
    ),
  ),
  quote: (s, t) => h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: _W, height: _H, background: t.bgDark, padding: 60 } },
    h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: _W - 120, background: t.bg, borderRadius: t.radius + 8, padding: '80px 72px' } },
      h('div', { style: { display: 'flex', width: '100%', justifyContent: 'flex-start', marginBottom: 8 } },
        h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 120, color: `${t.accent}30`, lineHeight: 0.8 } }, '\u201C'),
      ),
      lines(s.body, { fontFamily: _F, fontWeight: 700, fontSize: 44, color: t.text, textAlign: 'center', lineHeight: 1.7, letterSpacing: 0.5, justifyContent: 'center', alignItems: 'center' }),
      h('div', { style: { display: 'flex', width: '100%', justifyContent: 'flex-end', marginTop: 8 } },
        h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 120, color: `${t.accent}30`, lineHeight: 0.8 } }, '\u201D'),
      ),
      h('div', { style: { display: 'flex', width: 60, height: 3, background: t.accent, borderRadius: 2, marginTop: 24, marginBottom: 24 } }),
      s.source ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 28, color: t.textLight, textAlign: 'center', justifyContent: 'center', letterSpacing: 1 } }, s.source) : null,
    ),
  ),
  data: (s, t) => { const val = s.value || '0'; const valLen = val.replace(/[^0-9a-zA-Z가-힣]/g, '').length; const valSize = valLen <= 3 ? 140 : valLen <= 5 ? 110 : valLen <= 8 ? 80 : 64; const unitSize = Math.round(valSize * 0.4); return h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: _W, height: _H, background: t.secondary, padding: 60 } },
    h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: _W - 120, background: t.bg, borderRadius: t.radius + 8, padding: 72 } },
      s.label ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 28, color: t.accent, marginBottom: 24, letterSpacing: 3 } }, s.label) : null,
      h('div', { style: { display: 'flex', width: 220, height: 220, borderRadius: 110, background: `${t.primary}08`, alignItems: 'center', justifyContent: 'center', marginBottom: 16 } },
        h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' } },
          h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: valSize, color: t.primary, lineHeight: 1 } }, val),
          s.unit ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: unitSize, color: t.primary, marginLeft: 6, paddingBottom: Math.round(valSize * 0.08) } }, s.unit) : null,
        ),
      ),
      h('div', { style: { display: 'flex', width: 40, height: 3, background: t.accent, borderRadius: 2, marginTop: 16, marginBottom: 32 } }),
      h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 36, color: t.textLight, textAlign: 'center', lineHeight: 1.7, letterSpacing: 0.3, justifyContent: 'center' } }, s.body || ''),
    ),
  ); },
  cta: (s, t) => h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: _W, height: _H, background: t.bgDark, padding: _P } },
    h('div', { style: { display: 'flex', position: 'absolute', top: -60, right: -60, width: 300, height: 300, background: t.accent, opacity: 0.06, borderRadius: 150 } }),
    h('div', { style: { display: 'flex', position: 'absolute', bottom: -40, left: -40, width: 200, height: 200, background: t.primary, opacity: 0.04, borderRadius: 100 } }),
    h('div', { style: { display: 'flex', width: 80, height: 4, background: t.accent, borderRadius: 2, marginBottom: 48 } }),
    lines(s.title, { fontFamily: _F, fontWeight: 700, fontSize: 60, color: '#FFFFFF', textAlign: 'center', lineHeight: 1.35, letterSpacing: -0.3, maxWidth: _W - _P * 2, justifyContent: 'center', alignItems: 'center', marginBottom: 48 }),
    s.buttonText ? h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } },
      h('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', background: t.accent, borderRadius: t.radius + 8, padding: '28px 80px', marginBottom: 16 } },
        h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 36, color: t.bgDark, letterSpacing: 1.5 } }, s.buttonText),
      ),
      h('div', { style: { display: 'flex', flexDirection: 'row', gap: 8, marginBottom: 32 } },
        h('div', { style: { display: 'flex', width: 6, height: 6, borderRadius: 3, background: `${t.accent}60` } }),
        h('div', { style: { display: 'flex', width: 6, height: 6, borderRadius: 3, background: `${t.accent}40` } }),
        h('div', { style: { display: 'flex', width: 6, height: 6, borderRadius: 3, background: `${t.accent}20` } }),
      ),
    ) : null,
    s.body ? lines(s.body, { fontFamily: _F, fontWeight: 400, fontSize: 28, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 1.6, letterSpacing: 0.5, maxWidth: _W - _P * 2, justifyContent: 'center', alignItems: 'center' }) : null,
  ),
  // ─── 7. compare — 2열 비교 (X vs ✓) ───
  // data: { title, leftLabel, leftItems:[], rightLabel, rightItems:[] }
  compare: (s, t) => {
    const leftItems = Array.isArray(s.leftItems) ? s.leftItems.slice(0, 5) : [];
    const rightItems = Array.isArray(s.rightItems) ? s.rightItems.slice(0, 5) : [];
    return h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: _W, height: _H, background: t.secondary, padding: 60 } },
      h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 36 } },
        h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 26, color: t.accent, marginBottom: 14, letterSpacing: 3 } }, 'COMPARE'),
        lines(s.title || '', { fontFamily: _F, fontWeight: 700, fontSize: 50, color: t.text, lineHeight: 1.25, textAlign: 'center', maxWidth: _W - 120, justifyContent: 'center', alignItems: 'center' }),
        h('div', { style: { display: 'flex', width: 60, height: 4, background: t.accent, borderRadius: 2, marginTop: 20 } }),
      ),
      h('div', { style: { display: 'flex', flexDirection: 'row', width: _W - 120, gap: 24 } },
        h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, background: t.bg, borderRadius: t.radius + 8, padding: 40 } },
          h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 28 } },
            h('div', { style: { display: 'flex', width: 52, height: 52, borderRadius: 26, background: `${t.textLight}25`, alignItems: 'center', justifyContent: 'center', marginRight: 14 } },
              h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 30, color: t.textLight, lineHeight: 1 } }, '\u2715'),
            ),
            h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 30, color: t.textLight, flex: 1 } }, s.leftLabel || '이전'),
          ),
          ...leftItems.map(txt => h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-start', marginBottom: 18 } },
            h('div', { style: { display: 'flex', width: 8, height: 8, borderRadius: 4, background: t.textLight, marginTop: 14, marginRight: 14 } }),
            h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 26, color: t.textLight, lineHeight: 1.5, flex: 1 } }, txt),
          )),
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, background: t.bg, borderRadius: t.radius + 8, padding: 40, borderTop: `6px solid ${t.accent}` } },
          h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 28 } },
            h('div', { style: { display: 'flex', width: 52, height: 52, borderRadius: 26, background: `${t.accent}30`, alignItems: 'center', justifyContent: 'center', marginRight: 14 } },
              h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 30, color: t.primary, lineHeight: 1 } }, '\u2713'),
            ),
            h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 30, color: t.text, flex: 1 } }, s.rightLabel || '이후'),
          ),
          ...rightItems.map(txt => h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-start', marginBottom: 18 } },
            h('div', { style: { display: 'flex', width: 8, height: 8, borderRadius: 4, background: t.accent, marginTop: 14, marginRight: 14 } }),
            h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 26, color: t.text, lineHeight: 1.5, flex: 1 } }, txt),
          )),
        ),
      ),
    );
  },
  // ─── 8. flow — 단계 흐름 (3~5 스텝) ───
  // data: { title, steps: [{number, title, body}, ...] }
  flow: (s, t) => {
    const steps = Array.isArray(s.steps) ? s.steps.slice(0, 5) : [];
    return h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: _W, height: _H, background: t.secondary, padding: 60 } },
      h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 40 } },
        h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 26, color: t.accent, marginBottom: 14, letterSpacing: 3 } }, 'FLOW'),
        lines(s.title || '', { fontFamily: _F, fontWeight: 700, fontSize: 54, color: t.text, lineHeight: 1.25, textAlign: 'center', maxWidth: _W - 120, justifyContent: 'center', alignItems: 'center' }),
        h('div', { style: { display: 'flex', width: 60, height: 4, background: t.accent, borderRadius: 2, marginTop: 20 } }),
      ),
      h('div', { style: { display: 'flex', flexDirection: 'column', width: _W - 120, gap: 14 } },
        ...steps.map((step, i) => h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', background: t.bg, borderRadius: t.radius + 8, padding: 26, borderLeft: `6px solid ${t.accent}` } },
          h('div', { style: { display: 'flex', width: 72, height: 72, borderRadius: 36, background: `${t.primary}15`, alignItems: 'center', justifyContent: 'center', marginRight: 24 } },
            h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 32, color: t.primary, lineHeight: 1 } }, step.number || String(i + 1).padStart(2, '0')),
          ),
          h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1 } },
            h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 32, color: t.text, marginBottom: 4 } }, step.title || ''),
            step.body ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 22, color: t.textLight, lineHeight: 1.5 } }, step.body) : null,
          ),
          i < steps.length - 1 ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 30, color: t.accent, marginLeft: 14 } }, '\u2193') : null,
        )),
      ),
    );
  },
};

function safeParseJson(rawText) {
  try { return JSON.parse(rawText); } catch (_) {}
  const start = rawText.indexOf('{');
  if (start === -1) throw new Error('AI 응답에서 JSON을 찾을 수 없습니다.');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < rawText.length; i++) {
    const c = rawText[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(rawText.substring(start, i + 1));
    }
  }
  throw new Error('AI 응답을 파싱할 수 없습니다.');
}

async function callSonnet(systemPrompt, userMessage, maxTokens = 4000) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      temperature: 0.7,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return (data.content?.[0]?.text || '').trim();
}

const SLIDE_SYSTEM_PROMPT = `당신은 블로그 글을 인스타그램 카드뉴스용 슬라이드로 변환하는 전문가입니다.

[목표]
블로그 글에서 핵심 내용만 추출하여, 각 슬라이드마다 0.2초 안에 스크롤을 멈추게 하는 훅이 포함된 카드뉴스를 만듭니다.

[슬라이드 구성]
1. 표지(1장, type:"cover"): 강렬한 훅 포함 제목 + 부제. 스크롤을 멈추게 하는 첫인상.
2. 요약(1장, type:"summary"): 훅 포함 요약 제목 + 핵심 내용 1~2문장. 전체 글의 매력적 요약.
3. 본문(나머지, type:"content" | "compare" | "flow" | "quote" | "data" 중 혼합):
   - content: 기본 본문 — 번호 + 제목 + 내용
   - compare: 대비 포인트가 있을 때 — 예: "안 팔리는 글 vs 팔리는 글", "이전 vs 이후"
   - flow: 단계·순서가 있을 때 — 예: "4단계", "절차", "따라하는 법"
   - quote: 핵심 문장을 강조할 때
   - data: 숫자 1개로 임팩트를 주고 싶을 때
4. CTA(1장, type:"cta"): 팔로우/저장/댓글 유도 문구.

[본문 레이아웃 선택 가이드]
- 내용에 "A vs B", "before vs after", "나쁜 방법 vs 좋은 방법" 같은 대비가 있으면 → compare 1장 끼워넣기
- 내용에 "1단계/2단계/3단계", "순서대로", "이렇게 하세요" 같은 순차 흐름이 있으면 → flow 1장 끼워넣기
- 한 카드뉴스에서 같은 타입이 3장 이상 연속되지 않도록 혼합한다

[14가지 심리학 기반 훅 공식 — Tier 1 비율 높게]
--- Tier 1: 즉각 반응 (0.1~0.3초) ---
1. 패턴 인터럽트: 예상을 깨는 문장으로 자동 스크롤 강제 중단. 예: "읽지 마세요. (단, OO 고민 없다면)"
2. 손실회피: 모르면 손해. 인간은 이익보다 손실에 2배 반응. 예: "이거 모르면 계속 손해봅니다"
3. 호기심폭발: 정보 격차 생성. 예: "업계 사람만 아는 비밀"

--- Tier 2: 빠른 인지 (0.3~1초) ---
4. 구체성수치: 3가지, 5단계 등 수치로 신뢰도 상승. 예: "딱 3가지만 기억하면 됩니다"
5. 정체성호출: 자아상을 건드림. 예: "진심으로 잘하고 싶은 분만 보세요"
6. 사회적증거: 동조 본능 자극. 예: "요즘 사장님들 다 이걸로 바꾸고 있어요"

--- Tier 3: 감정적 반응 (1~3초) ---
7. 문제공감: 실제 불편/고통을 먼저 꺼냄. 예: "매일 열심히 하는데 왜 결과가 안 나올까요"
8. 상식비틀기: 상식을 뒤집어 호기심 자극. 예: "좋다는 게 오히려 독이 될 수 있습니다"
9. 욕망자극: 근본 욕구를 건드림. 예: "한 달 만에 인생이 바뀐 사람들의 비밀"
10. 권위부여: 신뢰를 자연스럽게 심음. 예: "상위 1% 사장님이 실제로 쓰는 방법"
11. 오픈루프: 미완결 정보로 신경 쓰이게 함. 예: "3가지 중 마지막이 진짜인데..."
12. 즉시성: 행동 유도. 예: "지금 당장 해결하는 방법"
13. 비밀은밀함: 독점적 정보 느낌. 예: "절대 공개 안 하는 비법"
14. 비교자극: A vs B. 예: "성공하는 사람 vs 실패하는 사람"

[의미 단위 줄바꿈 — 가장 중요한 규칙]
모든 텍스트(title, subtitle, body)에서 \\n을 사용하여 의미 단위로 줄을 나눈다.
글자 수가 아니라 **의미 덩어리가 완성되는 지점**에서 끊는다.

줄바꿈 원칙:
- 한 줄에 10~18자 내외 (제목은 8~15자)
- 조사·어미 중간에서 절대 끊지 않는다
- 의미가 완결되는 절(節) 단위로 끊는다
- 수식어+명사는 같은 줄에 유지한다

나쁜 줄바꿈 (절대 금지):
  "19년차가 3개월 써 본 진짜\\n후기" ← "진짜 후기"가 분리됨
  "하나 만들어서 블로그, 인스타, 유튜브까지, 예전\\n엔" ← 조사 중간 끊김

좋은 줄바꿈 (반드시 이렇게):
  "19년차가 3개월 써 본\\n진짜 후기" ← 수식절 / 핵심어
  "하나 만들어서\\n블로그, 인스타, 유튜브까지\\n예전엔 밤 12시까지 작업했는데\\n지금은 오후 6시면 끝납니다" ← 의미 단위

[글자수 제한 — 가장 중요한 규칙. 초과하면 전체 무효]
모든 텍스트는 아래 글자수 이내로 "처음부터 요약"하여 생성하라. \\n은 글자수에서 제외.
절대로 긴 문장을 만든 뒤 자르지 마라. 처음부터 짧고 임팩트 있게 써라.

- cover.title: 20자 이내 (예: "19년차가 찾은\\n진짜 답" = 12자 ✓)
- cover.subtitle: 25자 이내
- summary.title: 18자 이내
- summary.body: 60자 이내
- content.title: 15자 이내 (핵심 단어만. 예: "블로그 SEO 핵심" = 9자 ✓)
- content.body: 60자 이내
- cta.title: 18자 이내

★ 제목은 명사형·키워드 중심으로 짧게. 조사와 서술어를 줄여라.
나쁜 예: "스레드에서 자영업자에게 통하는 3가지 방법" (20자, 초과 위험)
좋은 예: "스레드 통하는\\n3가지 방법" (11자 ✓)

[절대 규칙]
1. 블로그 글의 군더더기를 제거하고 핵심만 추출한다.
2. 각 슬라이드 제목에 반드시 훅을 넣는다 (14가지 공식 활용).
3. 요청된 슬라이드 수를 정확히 맞춘다.
4. 한국어 조사(은/는, 이/가, 을/를)를 정확히 사용한다.
5. 이모지 사용 금지.
6. 출력은 순수 JSON만. 마크다운 코드블록, 설명 텍스트 금지.
7. 모든 텍스트에 의미 단위 줄바꿈(\\n)을 넣는다.
8. 사용자가 SNS 핸들(@아이디)을 제공하면 cover.brand와 cta.body에 포함한다.

[인스타그램 업로드용 캡션 — caption 필드]
카드뉴스 슬라이드와 함께 인스타 피드에 붙일 캡션 1개를 반드시 같이 생성한다.
- 길이: 200자 내외 (최대 2,200자 한도)
- 첫 줄: 슬라이드 후킹과 연결되는 한 문장 (인스타는 "더보기" 전 125자만 노출됨)
- 본문: 카드뉴스 핵심 가치 1~2문장
- CTA: "저장해두세요" 또는 "프로필에서 @핸들" (인스타는 본문 링크 클릭 불가)
- 해시태그: 5~10개 (본문 아래 별도 줄에 몰아 넣기)
- 이모지 금지. 한국어 자연스럽게.

[출력 JSON 형식]
{
  "slides": [
    { "type": "cover", "title": "훅 포함 제목\\n(의미 단위 줄바꿈)", "subtitle": "부제", "brand": "@아이디" },
    { "type": "summary", "title": "훅 포함\\n요약 제목", "body": "핵심 요약\\n1~2문장" },
    { "type": "content", "number": "01", "title": "포인트 제목", "body": "핵심 내용\\n의미 단위 줄바꿈" },
    { "type": "compare", "title": "대비 제목 (22자)", "leftLabel": "이전", "leftItems": ["항목1","항목2","항목3","항목4"], "rightLabel": "이후", "rightItems": ["항목1","항목2","항목3","항목4"] },
    { "type": "flow", "title": "흐름 제목 (22자)", "steps": [ { "number": "01", "title": "단계 제목", "body": "간단 설명" }, { "number": "02", "title": "...", "body": "..." }, { "number": "03", "title": "...", "body": "..." }, { "number": "04", "title": "...", "body": "..." } ] },
    { "type": "cta", "title": "CTA 문구", "buttonText": "팔로우하기", "body": "@아이디\\n이 글이 도움됐다면 저장해두세요" }
  ],
  "caption": "첫 줄 후킹\\n\\n본문 한두 문장\\n\\n저장해두면 좋아요\\n\\n#해시태그1 #해시태그2 #해시태그3 ..."
}

[compare·flow 글자수 가이드]
- compare.title: 22자 이내
- compare.leftLabel / rightLabel: 10자 이내
- compare.leftItems / rightItems: 각 항목 20자 이내, 3~5개
- flow.title: 22자 이내
- flow.steps: 3~5개, 각 step.title 12자 이내, step.body 30자 이내
- compare·flow는 \\n 줄바꿈 넣지 말 것 (레이아웃이 자동 배치)`;

const SLIDE_SYSTEM_PROMPT_SLIM = `당신은 블로그 글을 인스타그램 카드뉴스 슬라이드로 변환하는 전문가입니다.

${SEDA_PROMPT_BLOCK}

[슬라이드 타입]
- cover: 표지 (강한 훅 제목 + 부제)
- summary: 전체 요약 (1문장)
- content: 번호형 본문 (number + title + body)
- compare: A vs B 대비 (leftLabel/leftItems + rightLabel/rightItems)
- flow: 3~5단계 절차 (steps[])
- quote: 핵심 인용 1문장
- data: 숫자 임팩트
- cta: 팔로우/저장/댓글 유도

[필수 규칙]
1. 요청된 슬라이드 수를 정확히 맞춘다.
2. 첫 슬라이드(cover)는 스크롤을 멈출 강한 훅으로 시작한다.
3. 이모지·이모티콘 금지 (Satori 렌더 제약).
4. 출력은 순수 JSON만. 마크다운 코드블록·설명 텍스트 금지.
5. SNS 핸들(@아이디) 제공 시 cover.brand와 cta.body에 포함.
6. compare·flow의 items/steps 내부에는 \\n 줄바꿈 금지 (레이아웃 자동 배치).

[인스타 캡션 — caption 필드]
슬라이드와 함께 인스타 피드용 캡션 1개 생성. 200자 내외 + 해시태그 5~10개. 이모지 금지.

[출력 JSON]
{
  "slides": [
    { "type": "cover", "title": "훅 제목\\n(의미 단위)", "subtitle": "부제", "brand": "@handle" },
    { "type": "summary", "title": "요약\\n제목", "body": "한 줄 요약" },
    { "type": "content", "number": "01", "title": "포인트", "body": "내용\\n의미 단위" },
    { "type": "compare", "title": "대비 제목", "leftLabel": "이전", "leftItems": ["항목1","항목2"], "rightLabel": "이후", "rightItems": ["항목1","항목2"] },
    { "type": "flow", "title": "흐름 제목", "steps": [{"number":"01","title":"단계","body":"설명"}] },
    { "type": "cta", "title": "CTA 문구", "buttonText": "팔로우하기", "body": "@handle\\n저장해두세요" }
  ],
  "caption": "첫 줄 후킹\\n\\n본문\\n\\n#해시태그1 #해시태그2 ..."
}`;

function shouldUseSlim(email) {
  const raw = process.env.CARDNEWS_SLIM_PROMPT_ROLLOUT ?? '0';
  const rollout = Number.parseInt(raw, 10);
  return resolveRolloutFlag({ email, rollout });
}

// findOverflows용 필드 매핑 — 슬라이드 타입별 검증 경로와 limit key.
const CARD_NEWS_FIELD_MAP = {
  cover: [
    { path: 'title',    limitKey: 'cover.title' },
    { path: 'subtitle', limitKey: 'cover.subtitle' },
  ],
  summary: [
    { path: 'title', limitKey: 'summary.title' },
    { path: 'body',  limitKey: 'summary.body' },
  ],
  content: [
    { path: 'title', limitKey: 'content.title' },
    { path: 'body',  limitKey: 'content.body' },
  ],
  cta: [
    { path: 'title', limitKey: 'cta.title' },
  ],
  compare: [
    { path: 'title',       limitKey: 'compare.title' },
    { path: 'leftLabel',   limitKey: 'compare.label' },
    { path: 'rightLabel',  limitKey: 'compare.label' },
    { path: 'leftItems[]', limitKey: 'compare.item' },
    { path: 'rightItems[]', limitKey: 'compare.item' },
  ],
  flow: [
    { path: 'title',             limitKey: 'flow.title' },
    { path: 'steps[].title',     limitKey: 'flow.step.title' },
    { path: 'steps[].body',      limitKey: 'flow.step.body' },
  ],
  // quote, data 는 safe area 넓어 글자수 강제 없음 (Satori ellipsis가 방어)
};

// AI가 JSON 응답에 리터럴 "\n"(2글자: 백슬래시+n)을 내보내는 경우가 있어
// 실제 줄바꿈(1글자 LF)으로 정규화. compare.leftItems / flow.steps 같은 중첩 필드까지 재귀.
function _denormNewlines(s) {
  return typeof s === 'string' ? s.replace(/\\n/g, '\n') : s;
}
function _walkDenorm(slide) {
  if (!slide || typeof slide !== 'object') return slide;
  for (const k of Object.keys(slide)) {
    const v = slide[k];
    if (typeof v === 'string') slide[k] = _denormNewlines(v);
    else if (Array.isArray(v)) slide[k] = v.map(item => typeof item === 'string' ? _denormNewlines(item) : (item && typeof item === 'object' ? _walkDenorm(item) : item));
    else if (v && typeof v === 'object') _walkDenorm(v);
  }
  return slide;
}

function validateSlides(parsed, requestedCount) {
  if (!parsed || !Array.isArray(parsed.slides)) {
    throw new Error('slides 배열이 없습니다.');
  }

  // 리터럴 "\n" → 실제 LF 정규화 (모든 레이아웃 공통)
  let slides = parsed.slides.map(_walkDenorm);

  if (slides.length > requestedCount) {
    slides = slides.slice(0, requestedCount);
  }

  const LIMITS = {
    cover: { title: 20, subtitle: 25 },
    summary: { title: 18, body: 60 },
    content: { title: 15, body: 60 },
    quote: { body: 60, source: 25 },
    data: { label: 15, value: 10, unit: 10, body: 60 },
    cta: { title: 18, buttonText: 12, body: 50 },
    compare: { title: 22, leftLabel: 10, rightLabel: 10 },
    flow: { title: 22 },
  };

  const VALID_TYPES = Object.keys(LIMITS);

  slides = slides.map((slide, idx) => {
    if (!slide.type || !VALID_TYPES.includes(slide.type)) {
      if (idx === 0) slide.type = 'cover';
      else if (idx === slides.length - 1) slide.type = 'cta';
      else slide.type = 'content';
    }

    if (slide.type === 'content' && !slide.number) {
      const contentIdx = slides.slice(0, idx).filter((s) => s.type === 'content').length + 1;
      slide.number = String(contentIdx).padStart(2, '0');
    }

    if (slide.type === 'cover') {
      if (!slide.title) slide.title = '카드뉴스';
      if (!slide.subtitle) slide.subtitle = '';
    }

    if (slide.type === 'cta') {
      if (!slide.title) slide.title = '이 글이 도움이 됐다면?';
      if (!slide.buttonText) slide.buttonText = '저장하기';
    }

    const limits = LIMITS[slide.type] || {};
    for (const [field, max] of Object.entries(limits)) {
      if (slide[field] && typeof slide[field] === 'string' && slide[field].replace(/\n/g, '').length > max) {
        console.warn(`[CARD-NEWS] 글자수 초과: slide ${idx} ${slide.type}.${field} = ${slide[field].replace(/\n/g, '').length}자 (제한 ${max}자)`);
      }
    }

    return slide;
  });

  // 인스타 업로드용 캡션 (slim/full 프롬프트 모두 생성). 누락 시 빈 문자열.
  const caption = typeof parsed.caption === 'string' ? parsed.caption.trim().slice(0, 2200) : '';

  return { slides, caption };
}

// ═════════════════════════════════════════════════════════════
// 사용자 이미지 렌더링 헬퍼 — Phase 3
// ═════════════════════════════════════════════════════════════

// 외부 URL → data URL (Satori는 외부 URL 대신 data URL 선호)
async function fetchUserImageDataUrl(url) {
  try {
    console.log(`[CARD-NEWS] fetching user image: ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') || 'image/jpeg';
    console.log(`[CARD-NEWS] user image fetched OK: ${buf.length} bytes, ${mime}`);
    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  } catch (err) {
    console.error(`[CARD-NEWS] user image fetch FAILED: ${url} | ${err.message}`);
    return { error: err.message };
  }
}

// cover 모드: 카드 전체를 사용자 사진 + 그라디언트 오버레이 + 텍스트
function buildCoverSlide(slide, theme, dataUrl) {
  const title = slide.title || slide.body || '';
  return h('div', {
    style: {
      width: _W, height: _H,
      display: 'flex', position: 'relative',
      background: theme.bgDark,
    },
  },
    h('img', {
      src: dataUrl,
      width: _W,
      height: _H,
      style: { position: 'absolute', top: 0, left: 0, objectFit: 'cover' },
    }),
    // 그라디언트 오버레이 (Satori는 linear-gradient 지원)
    h('div', {
      style: {
        position: 'absolute', top: 0, left: 0,
        width: _W, height: _H,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.75) 100%)',
        display: 'flex',
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: 0, right: 0, bottom: 140,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', padding: '0 80px',
      },
    },
      h('div', { style: { display: 'flex', width: 80, height: 4, background: theme.accent, borderRadius: 2, marginBottom: 36 } }),
      lines(title, {
        fontFamily: _F, fontWeight: 800, fontSize: 68,
        color: '#FFFFFF', textAlign: 'center', lineHeight: 1.2,
        letterSpacing: -0.5, maxWidth: _W - 160,
        justifyContent: 'center', alignItems: 'center',
      }),
    ),
  );
}

// content 모드: 상단 40% 이미지 + 하단 60% 텍스트
function buildContentModeSlide(slide, theme, dataUrl) {
  const imageH = Math.round(_H * 0.40);
  const textH = _H - imageH;
  return h('div', {
    style: {
      width: _W, height: _H,
      display: 'flex', flexDirection: 'column',
      background: theme.bg,
    },
  },
    h('div', { style: { width: _W, height: imageH, display: 'flex', overflow: 'hidden' } },
      h('img', {
        src: dataUrl,
        width: _W,
        height: imageH,
        style: { objectFit: 'cover' },
      }),
    ),
    h('div', {
      style: {
        width: _W, height: textH,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '48px 80px',
      },
    },
      h('div', { style: { display: 'flex', width: 60, height: 4, background: theme.accent, borderRadius: 2, marginBottom: 28 } }),
      lines(slide.title || '', {
        fontFamily: _F, fontWeight: 800, fontSize: 56,
        color: theme.text, lineHeight: 1.2, marginBottom: 24, textAlign: 'left',
      }),
      slide.body ? lines(slide.body, {
        fontFamily: _F, fontWeight: 400, fontSize: 32,
        color: theme.textLight, lineHeight: 1.6, textAlign: 'left',
      }) : null,
    ),
  );
}

// background 모드: 기존 레이아웃을 반투명 사진 배경 위에 겹침
function wrapWithBackgroundImage(originalNode, dataUrl) {
  return h('div', {
    style: {
      width: _W, height: _H,
      display: 'flex', position: 'relative',
    },
  },
    h('img', {
      src: dataUrl,
      width: _W,
      height: _H,
      style: { position: 'absolute', top: 0, left: 0, objectFit: 'cover' },
    }),
    h('div', {
      style: {
        position: 'absolute', top: 0, left: 0,
        width: _W, height: _H,
        background: 'rgba(255, 255, 255, 0.82)',
        display: 'flex',
      },
    }),
    h('div', {
      style: {
        position: 'absolute', top: 0, left: 0,
        width: _W, height: _H, display: 'flex',
      },
    }, originalNode),
  );
}

async function renderSlides(slidesData, theme, variant, userImages = []) {
  await initResvgWasm();
  const satoriRender = await getSatori();
  const { Resvg } = await getResvg();
  const fonts = await loadFonts();
  const pngs = [];
  const fetchErrors = [];

  const layoutMap = {
    cover: layouts.cover,
    summary: layouts.summary,
    content: layouts.content,
    quote: layouts.quote,
    data: layouts.data,
    cta: layouts.cta,
    compare: layouts.compare,
    flow: layouts.flow,
  };

  // 사용자 이미지 data URL 프리페치 (병렬)
  const userImageDataUrls = new Map();
  await Promise.all(
    userImages.map(async (u) => {
      const result = await fetchUserImageDataUrl(u.url);
      if (result.dataUrl) {
        userImageDataUrls.set(u.cardIndex, { ...u, dataUrl: result.dataUrl });
      } else {
        fetchErrors.push({ cardIndex: u.cardIndex, url: u.url, error: result.error });
      }
    }),
  );

  // content 슬라이드 인덱스 카운터 — variant.getContentVariant(idx) 용
  let contentIdx = 0;

  for (let i = 0; i < slidesData.slides.length; i++) {
    const slide = slidesData.slides[i];
    const layoutFn = layoutMap[slide.type] || layoutMap.content;
    // content 슬라이드마다 _slideIndex 증가시켜 variant에 주입
    let perSlideVariant = variant;
    if (variant && slide.type === 'content') {
      perSlideVariant = Object.assign(
        Object.create(Object.getPrototypeOf(variant)),
        variant,
        { _slideIndex: contentIdx },
      );
      contentIdx += 1;
    }

    const ui = userImageDataUrls.get(i);
    let vnode;
    if (ui && ui.dataUrl) {
      if (ui.mode === 'cover') {
        vnode = buildCoverSlide(slide, theme, ui.dataUrl);
      } else if (ui.mode === 'content') {
        vnode = buildContentModeSlide(slide, theme, ui.dataUrl);
      } else {
        // background
        const originalNode = withRichness(layoutFn(slide, theme, perSlideVariant));
        vnode = wrapWithBackgroundImage(originalNode, ui.dataUrl);
      }
      if (ui.crop) {
        console.log(`[CARD-NEWS] card ${i} user image crop: ${JSON.stringify(ui.crop)} (object-fit cover 적용 — 정밀 크롭은 후속 작업)`);
      }
    } else {
      vnode = withRichness(layoutFn(slide, theme, perSlideVariant));
    }

    const svg = await satoriRender(vnode, {
      width: CANVAS_W,
      height: CANVAS_H,
      fonts,
    });

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: CANVAS_W },
    });
    const rendered = resvg.render();
    const pngBuffer = rendered.asPng();

    const base64 = Buffer.from(pngBuffer).toString('base64');
    pngs.push(base64);
  }

  return { pngs, fetchErrors, appliedCount: userImageDataUrls.size };
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  const isAdminGet = await resolveAdmin(request);
  if (isAdminGet) {
    return jsonResponse(request, { remaining: 999, limit: FREE_DAILY_LIMIT, admin: true, creditsActive: isCreditsActive() });
  }
  try {
    if (isCreditsActive()) {
      const authHeader = request.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const session = token ? await getRedis().get(`session:${token}`) : null;
      const email = session?.email;
      const credits = email ? await getUserCredits(email) : 0;
      return jsonResponse(request, { remaining: credits, creditCost: CARD_NEWS_CREDIT_COST, creditsActive: true });
    }
    const ip = getClientIp(request);
    const key = getTodayKey(ip);
    const count = (await getRedis().get(key)) || 0;
    const remaining = Math.max(FREE_DAILY_LIMIT - count, 0);
    return jsonResponse(request, { remaining, limit: FREE_DAILY_LIMIT, creditsActive: false });
  } catch {
    return jsonResponse(request, { remaining: FREE_DAILY_LIMIT, limit: FREE_DAILY_LIMIT, creditsActive: isCreditsActive() });
  }
}

export async function POST(request) {
  let rateLimitKey = null;
  let creditCharged = false;
  let chargedAmount = 0; // 에러 시 실제 차감한 크레딧 환불용
  let sessionEmail = null;

  try {
    const isAdmin = await resolveAdmin(request);

    // 관리자든 일반 회원이든 세션 이메일은 항상 해석 (사용자 이미지 소유권 검증에 필요)
    {
      const authHeader = request.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (token) {
        const session = await getRedis().get(`session:${token}`);
        if (session?.email) sessionEmail = session.email;
      }
    }

    if (!isAdmin) {
      if (!sessionEmail) {
        return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
      }
      const userData = await getRedis().get(`user:${sessionEmail}`);
      if (!userData) {
        return jsonResponse(request, { error: '회원 정보를 찾을 수 없습니다.' }, { status: 401 });
      }
      if (!isCreditsActive() && new Date(userData.createdAt) > new Date(FREE_CUTOFF)) {
        return jsonResponse(request, { error: '4/24까지 가입한 회원만 무료 체험이 가능합니다.' }, { status: 403 });
      }
    }

    const body = await request.json().catch(() => ({}));
    const blogText = body.text || body.blogText || '';
    const slideCount = body.slideCount;
    const themeId = body.theme || body.themeId || 'clean';
    const blogTitle = body.title || '';
    // 모드: 'basic'(Satori, 1크레딧, ~30s) | 'premium'(Chromium, 2크레딧, ~3분)
    const mode = body.mode === 'premium' ? 'premium' : 'basic';
    const creditCost = mode === 'premium' ? CARD_NEWS_CREDIT_COST_PREMIUM : CARD_NEWS_CREDIT_COST_BASIC;
    // 시드: 사용자가 "다시" 눌렀을 때 새 숫자 보내면 다른 variant.
    // 없으면 매번 랜덤.
    const seed = typeof body.seed === 'number' && Number.isFinite(body.seed)
      ? body.seed
      : Math.floor(Math.random() * 0xFFFFFFFF);
    const variant = pickVariant(seed);
    // 명시적 override: 사용자가 UI에서 선택한 값이 있으면 variant에 덮어씀.
    // 'auto'는 클라이언트에서 생략 처리되므로 여기서는 값 있으면 바로 적용.
    const VALID_TYPE_SCALES = ['compact', 'normal', 'impact', 'asymmetric'];
    const VALID_ACCENT_PLACEMENTS = ['left-bar', 'top-bar', 'corner-mark', 'dot-cluster'];
    const VALID_NUMBER_STYLES = ['circle-badge', 'big-serif', 'underline', 'corner-tag'];
    if (typeof body.typeScale === 'string' && VALID_TYPE_SCALES.includes(body.typeScale)) {
      variant.typeScale = body.typeScale;
    }
    if (typeof body.accentPlacement === 'string' && VALID_ACCENT_PLACEMENTS.includes(body.accentPlacement)) {
      variant.accentPlacement = body.accentPlacement;
    }
    if (typeof body.numberStyle === 'string' && VALID_NUMBER_STYLES.includes(body.numberStyle)) {
      variant.numberStyle = body.numberStyle;
    }

    // 사용자 이미지 검증 (Phase 3 - user images library)
    const rawUserImages = Array.isArray(body.userImages) ? body.userImages : [];
    const VALID_MODES = new Set(['background', 'content', 'cover']);
    const sanitizedUserImages = [];
    for (const u of rawUserImages) {
      if (!u || typeof u !== 'object') continue;
      const cardIndex = Number(u.cardIndex);
      if (!Number.isInteger(cardIndex) || cardIndex < 0) continue;
      if (!VALID_MODES.has(u.mode)) continue;
      if (typeof u.url !== 'string' || !u.url.startsWith('https://cdn.ddukddaktool.co.kr/user-images/')) continue;
      const crop = (u.crop && typeof u.crop === 'object') ? {
        x: Number(u.crop.x) || 0,
        y: Number(u.crop.y) || 0,
        width: Number(u.crop.width) || 0,
        height: Number(u.crop.height) || 0,
      } : null;
      sanitizedUserImages.push({ cardIndex, mode: u.mode, url: u.url, crop });
    }

    if (sanitizedUserImages.length > 0) {
      if (!sessionEmail) {
        return jsonResponse(request, { error: '사용자 이미지를 사용하려면 로그인이 필요합니다.' }, { status: 401 });
      }
      const urls = sanitizedUserImages.map((u) => u.url);
      const owned = await verifyOwnershipByUrls(sessionEmail, urls);
      if (!owned) {
        return jsonResponse(request, { error: '권한이 없는 이미지가 포함돼 있습니다.' }, { status: 403 });
      }
    }

    if (!blogText || blogText.trim().length < 100) {
      return jsonResponse(request, { error: '블로그 글을 100자 이상 입력해주세요.' }, { status: 400 });
    }
    if (blogText.length > 50000) {
      return jsonResponse(request, { error: '텍스트가 너무 깁니다. 50,000자 이내로 입력해주세요.' }, { status: 400 });
    }
    if (blogText.length > 30000) {
      return jsonResponse(request, { error: '블로그 글이 너무 깁니다. 30,000자 이내로 입력해주세요.' }, { status: 400 });
    }

    const count = Math.min(Math.max(Number(slideCount) || 7, 5), 10);
    const brandPrimary = body.brandPrimary || '';
    const brandSecondary = body.brandSecondary || '';
    const baseTheme = themes[themeId] || themes.charcoal;

    const isValidHex = (c) => /^#[0-9a-fA-F]{6}$/.test(c);
    let theme = baseTheme;
    if (isValidHex(brandPrimary)) {
      const p = brandPrimary;
      const s = isValidHex(brandSecondary) ? brandSecondary : baseTheme.secondary;
      const hexToRgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
      const rgbToHex = (r, g, b) => '#' + [r, g, b].map((c) => Math.min(255, Math.max(0, Math.round(c))).toString(16).padStart(2, '0')).join('');
      const lighten = (hex, amt) => { const [r, g, b] = hexToRgb(hex); return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt); };
      const darken = (hex, amt) => { const [r, g, b] = hexToRgb(hex); return rgbToHex(r * (1 - amt), g * (1 - amt), b * (1 - amt)); };
      const mix = (h1, h2, w) => { const [r1, g1, b1] = hexToRgb(h1); const [r2, g2, b2] = hexToRgb(h2); return rgbToHex(r1 * w + r2 * (1 - w), g1 * w + g2 * (1 - w), b1 * w + b2 * (1 - w)); };
      theme = {
        ...baseTheme,
        primary: p,
        secondary: s,
        accent: mix(p, s, 0.6),
        text: darken(p, 0.7),
        textLight: darken(p, 0.4),
        bg: lighten(p, 0.95),
        bgDark: darken(s, 0.6),
      };
    }

    let remaining = isAdmin ? 999 : FREE_DAILY_LIMIT;

    if (!isAdmin) {
      if (isCreditsActive()) {
        const result = await chargeCredits(sessionEmail, creditCost, `card-news-${mode}`);
        if (!result) {
          return jsonResponse(request, {
            error: '크레딧이 부족합니다. 충전 후 이용해주세요.',
            required: creditCost,
            code: 'INSUFFICIENT_CREDITS',
          }, { status: 402 });
        }
        creditCharged = true;
        chargedAmount = creditCost;
        remaining = result.remaining;
      } else {
        // 무료 기간: premium은 항상 1회로 카운트하되, 무료 한도 동일 적용
        const ip = getClientIp(request);
        rateLimitKey = getTodayKey(ip);
        const newCount = await getRedis().incr(rateLimitKey);
        await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());

        if (newCount > FREE_DAILY_LIMIT) {
          await getRedis().decr(rateLimitKey);
          return jsonResponse(request, {
            error: `카드뉴스 일일 무료 한도(${FREE_DAILY_LIMIT}회)를 초과했습니다. 내일 다시 이용해주세요.`,
            remaining: 0,
          }, { status: 429 });
        }
        remaining = FREE_DAILY_LIMIT - newCount;
      }
    }

    // 모드 분기 — 사용자가 명시적으로 선택 (basic=Satori 기본, premium=Chromium)
    // premium(chromium) 경로는 비동기 (202 + SSE). Claude HTML 생성은 Railway에서 수행
    // (Cloudflare 100s origin timeout 회피). 실패 시 Railway → callback → 자동 환불.
    if (mode === 'premium') {
      console.log(`[CARD-NEWS] Start | slides: ${count} | mode: premium (chromium) | theme: ${themeId}`);

      // Brand Kit 조립 (기존 body 필드 재활용)
      const brandKit = {
        primary_color: brandPrimary || baseTheme.primary || null,
        secondary_color: brandSecondary || baseTheme.secondary || null,
        store_name: typeof body.storeName === 'string' ? body.storeName.slice(0, 50) : null,
        industry: typeof body.industry === 'string' ? body.industry.slice(0, 50) : null,
        instagram: typeof body.snsHandle === 'string' ? body.snsHandle.slice(0, 40) : null,
        logo_url: typeof body.logoUrl === 'string' && body.logoUrl.startsWith('https://') ? body.logoUrl : null,
      };

      // 이미지 메타 + URL 배열 준비 (순서 일치)
      const images = sanitizedUserImages.map(() => ({
        ratio: '4x5',
        source: 'user_upload',
        tag: '',
      }));
      const imageUrls = sanitizedUserImages.map((u) => u.url);

      try {
        // 1) 환경변수 확인
        const railwayUrl = process.env.RAILWAY_RENDER_URL;
        const renderSecret = process.env.RENDER_SECRET;
        if (!railwayUrl) throw new Error('RAILWAY_RENDER_URL not configured');
        if (!renderSecret) throw new Error('RENDER_SECRET not configured');

        // 2) jobId 발급 + job:meta 저장 (자동 환불용)
        const jobId = createJobId();
        await getRedis().set(
          `job:meta:${jobId}`,
          { userEmail: sessionEmail, tool: 'cardnews', cost: chargedAmount || creditCost, createdAt: new Date().toISOString() },
          { ex: 3600 },
        );

        // 3) Railway /render-cardnews dispatch (raw 파라미터 전달 — Claude 호출은 Railway에서)
        const dispatchRes = await fetch(`${railwayUrl}/render-cardnews`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-render-secret': renderSecret,
          },
          body: JSON.stringify({
            jobId,
            blogText,
            brandKit,
            images,
            imageUrls,
            slideCount: count,
            parentJobId: null,
          }),
        });

        if (dispatchRes.status !== 202) {
          const errText = await dispatchRes.text().catch(() => 'unknown');
          // dispatch 실패 — job:meta 즉시 정리 (중복 환불 방지는 callback에서)
          await getRedis().del(`job:meta:${jobId}`).catch(() => {});
          throw new Error(`Railway dispatch 실패: ${dispatchRes.status} ${errText.slice(0, 100)}`);
        }

        // 4) 202 + jobId 반환 (premium path는 동기 결과 반환 안 함 — SSE로 수신)
        await logUsage(sessionEmail, 'card-news-premium', null, getClientIp(request));
        return jsonResponse(request, { jobId, accepted: true, variant: 'chromium', mode: 'premium' }, { status: 202 });
      } catch (err) {
        console.error('[CARD-NEWS] chromium path error:', err?.message);
        // 기존 catch 블록의 refund 로직으로 흘러가도록 re-throw
        throw err;
      }
    }

    // ─── Satori 경로 (mode === 'basic') ───

    // 슬림 변형 판정은 Start 로그 이전에 수행 — A/B 관찰 위해 정상 경로에서도 variant 기록
    const useSlim = shouldUseSlim(sessionEmail);
    const promptVariant = useSlim ? 'slim' : 'full';
    const systemPrompt = useSlim ? SLIDE_SYSTEM_PROMPT_SLIM : SLIDE_SYSTEM_PROMPT;

    console.log(`[CARD-NEWS] Start | slides: ${count} | theme: ${themeId} | blogText: ${blogText.length}자 | variant: ${promptVariant}`);

    const titleLine = blogTitle ? `블로그 제목: ${blogTitle}\n` : '';
    const snsHandle = body.snsHandle || '';
    const snsLine = snsHandle ? `\nSNS 아이디: ${snsHandle} (cover.brand와 cta.body에 포함할 것)` : '';
    const userMessage = `다음 블로그 글을 ${count}장 카드뉴스 슬라이드로 변환해주세요.
구성: 표지 1장(cover) + 요약 1장(summary) + 본문 ${count - 3}장(content) + CTA 1장(cta) = 총 ${count}장${snsLine}

${titleLine}블로그 글:
${blogText.substring(0, 8000)}`;

    const raw = await callSonnet(systemPrompt, userMessage, 4000);
    console.log(`[CARD-NEWS] Sonnet response: ${raw.length}자`);

    const parsed = safeParseJson(raw);

    const validated = validateSlides(parsed, count);
    console.log(`[CARD-NEWS] Validated slides: ${validated.slides.length}장`);

    // SEDA 슬림 원칙: overflow는 throw 대신 warn 로그만. Satori ellipsis가 시각 방어.
    try {
      const overflows = findOverflows(validated.slides, CARD_NEWS_LIMITS, CARD_NEWS_FIELD_MAP);
      if (overflows.length > 0) {
        console.warn(
          '[cardnews-overflow]',
          JSON.stringify({
            promptVariant,
            count: overflows.length,
            overflows: overflows.slice(0, 10),
          }),
        );
      }
    } catch (overflowErr) {
      console.warn('[cardnews-overflow] check failed:', overflowErr.message);
    }

    const effectiveUserImages = sanitizedUserImages.filter((u) => u.cardIndex < validated.slides.length);
    if (effectiveUserImages.length > 0) {
      console.log(`[CARD-NEWS] userImages received: ${effectiveUserImages.length}장`);
    }
    const renderResult = await renderSlides(validated, theme, variant, effectiveUserImages);
    const pngs = renderResult.pngs;
    const userImageDebug = {
      requested: effectiveUserImages.length,
      applied: renderResult.appliedCount,
      errors: renderResult.fetchErrors,
    };
    if (effectiveUserImages.length > 0) {
      console.log(`[CARD-NEWS] userImages applied: ${renderResult.appliedCount}/${effectiveUserImages.length}`);
      if (renderResult.fetchErrors.length > 0) {
        console.error(`[CARD-NEWS] userImages fetch errors:`, JSON.stringify(renderResult.fetchErrors));
      }
    }
    console.log(`[CARD-NEWS] Rendered ${pngs.length} PNGs · variant: ${variant.typeScale}/${variant.accentPlacement}/${variant.numberStyle} · seed ${variant.seed}`);

    let r2Urls = [];
    try {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const r2Client = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });
      const bucket = process.env.R2_BUCKET_NAME;
      const userId = (sessionEmail || getClientIp(request) || 'anonymous').replace(/[^a-zA-Z0-9]/g, '_');
      const date = new Date().toISOString().slice(0, 10);
      const uuid = Math.random().toString(36).substring(2, 10);

      for (let i = 0; i < pngs.length; i++) {
        const key = `card-news/${userId}/${date}/${uuid}-${i + 1}.png`;
        await r2Client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: Buffer.from(pngs[i], 'base64'),
          ContentType: 'image/png',
        }));
        r2Urls.push(`https://pub-cac85a1d3b8d486082bd1bff2fadcaed.r2.dev/${key}`);
      }
      console.log(`[CARD-NEWS] R2 uploaded: ${r2Urls.length} files`);
    } catch (r2Err) {
      console.error('[CARD-NEWS] R2 upload failed (non-fatal):', r2Err.message, r2Err.stack);
      console.error('[CARD-NEWS] R2 env check:', {
        hasAccountId: !!process.env.R2_ACCOUNT_ID,
        hasAccessKey: !!process.env.R2_ACCESS_KEY_ID,
        hasSecret: !!process.env.R2_SECRET_ACCESS_KEY,
        hasBucket: !!process.env.R2_BUCKET_NAME,
      });
    }

    await logUsage(sessionEmail, 'card-news-basic', null, getClientIp(request));
    return jsonResponse(request, {
      slides: validated.slides,
      images: pngs,
      r2Urls,
      captionInstagram: validated.caption || '',
      remaining,
      limit: FREE_DAILY_LIMIT,
      variant: {
        seed: variant.seed,
        typeScale: variant.typeScale,
        accentPlacement: variant.accentPlacement,
        numberStyle: variant.numberStyle,
      },
      userImageDebug,
    });
  } catch (error) {
    console.error('[CARD-NEWS] Error:', error.message);
    if (rateLimitKey) {
      try { await getRedis().decr(rateLimitKey); } catch (_) {}
    }
    if (creditCharged && sessionEmail && chargedAmount > 0) {
      await refundCredits(sessionEmail, chargedAmount, 'card-news-error-refund');
    }
    return jsonResponse(request, { error: '카드뉴스 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
  }
}
