// api/_satori-templates.js
// 프리미엄 이미지 Satori 템플릿 4종: 비교표, 흐름도, 체크리스트, 벤다이어그램
import { h, _F } from './_satori-renderer.js';

const W = 1024, H = 1536; // 2:3 vertical (기존 gpth 사이즈 동일)

const C = {
  bg: '#F8F9FA', card: '#FFFFFF', text: '#1A1A2E', sub: '#6B7280',
  accent: '#ff5f1f', border: '#E5E7EB',
  bars: ['#ff5f1f', '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EC4899'],
};

// ─── 헤더 (제목 + 부제 + 구분선) — 공통 ───
function header(title, subtitle) {
  return h('div', { style: { display: 'flex', flexDirection: 'column', marginBottom: 48 } },
    title ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 48, color: C.text, lineHeight: 1.3 } }, title) : null,
    subtitle ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 28, color: C.sub, marginTop: 12 } }, subtitle) : null,
    h('div', { style: { display: 'flex', width: '100%', height: 2, background: C.border, marginTop: 32 } }),
  );
}

// ─── 출처 (하단) — 공통 ───
function footer(source) {
  if (!source) return null;
  return h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 22, color: C.sub, marginTop: 40, justifyContent: 'flex-end' } }, `Source: ${source}`);
}

// ════════════════════════════════════════
// 1. 비교표 (infographic_data) — 수평 바 차트
// ════════════════════════════════════════
// JSON: { title, subtitle?, source?, items: [{ label, value, unit? }] }
function dataTemplate(data) {
  const { title, subtitle, source, items = [] } = data;
  const maxVal = Math.max(...items.map(it => parseFloat(it.value) || 0), 1);

  return h('div', { style: { display: 'flex', flexDirection: 'column', width: W, height: H, background: C.bg, padding: '80px 60px 60px' } },
    header(title, subtitle),
    h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, gap: 28, justifyContent: 'center' } },
      ...items.map((item, i) => {
        const pct = Math.round(((parseFloat(item.value) || 0) / maxVal) * 100);
        const color = C.bars[i % C.bars.length];
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 500, fontSize: 28, color: C.text } }, item.label || ''),
            h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 32, color } }, `${item.value}${item.unit || ''}`),
          ),
          h('div', { style: { display: 'flex', width: '100%', height: 36, background: '#F3F4F6', borderRadius: 8 } },
            h('div', { style: { display: 'flex', width: `${Math.max(pct, 5)}%`, height: 36, background: color, borderRadius: 8 } }),
          ),
        );
      }),
    ),
    footer(source),
  );
}

// ════════════════════════════════════════
// 2. 흐름도 (infographic_flow) — 번호 원 + 카드 + 연결선
// ════════════════════════════════════════
// JSON: { title, subtitle?, steps: [{ label, description? }] }
function flowTemplate(data) {
  const { title, subtitle, steps = [] } = data;

  return h('div', { style: { display: 'flex', flexDirection: 'column', width: W, height: H, background: C.bg, padding: '80px 60px 60px' } },
    header(title, subtitle),
    h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', gap: 0 } },
      ...steps.flatMap((step, i) => {
        const color = C.bars[i % C.bars.length];
        const nodes = [];
        nodes.push(
          h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 24 } },
            h('div', { style: { display: 'flex', width: 64, height: 64, borderRadius: 32, background: color, alignItems: 'center', justifyContent: 'center', flexShrink: 0 } },
              h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 28, color: '#FFFFFF' } }, String(i + 1)),
            ),
            h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, background: C.card, borderRadius: 16, padding: '24px 32px', border: `2px solid ${C.border}` } },
              h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 30, color: C.text, lineHeight: 1.4 } }, step.label || ''),
              step.description ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 24, color: C.sub, lineHeight: 1.5, marginTop: 8 } }, step.description) : null,
            ),
          )
        );
        if (i < steps.length - 1) {
          nodes.push(
            h('div', { style: { display: 'flex', justifyContent: 'flex-start', paddingLeft: 26, height: 32 } },
              h('div', { style: { display: 'flex', width: 12, height: 32, borderLeft: `3px solid ${C.border}`, borderRight: `3px solid ${C.border}` } }),
            )
          );
        }
        return nodes;
      }),
    ),
  );
}

// ════════════════════════════════════════
// 3. 체크리스트 (checklist) — 체크 아이콘 + 카드 행
// ════════════════════════════════════════
// JSON: { title, subtitle?, items: [{ text, checked? }] }
function checklistTemplate(data) {
  const { title, subtitle, items = [] } = data;

  return h('div', { style: { display: 'flex', flexDirection: 'column', width: W, height: H, background: C.bg, padding: '80px 60px 60px' } },
    header(title, subtitle),
    h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', gap: 20 } },
      ...items.map((item, i) => {
        const checked = item.checked !== false;
        const color = C.bars[i % C.bars.length];
        return h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 20, background: C.card, borderRadius: 16, padding: '24px 32px', border: `2px solid ${checked ? color : C.border}` } },
          h('div', { style: { display: 'flex', width: 48, height: 48, borderRadius: 24, background: checked ? color : '#F3F4F6', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } },
            h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 24, color: checked ? '#FFFFFF' : C.sub } }, checked ? '✓' : String(i + 1)),
          ),
          h('div', { style: { display: 'flex', flex: 1, fontFamily: _F, fontWeight: 500, fontSize: 28, color: C.text, lineHeight: 1.5 } }, item.text || ''),
        );
      }),
    ),
  );
}

// ════════════════════════════════════════
// 4. 벤다이어그램 / 관계도 (venn) — 2~3개 원 + 교집합
// ════════════════════════════════════════
// JSON: { title, subtitle?, sets: [{ label, description? }], overlap?: string }
function vennTemplate(data) {
  const { title, subtitle, sets = [], overlap } = data;
  const count = Math.min(sets.length, 3);

  const circleSize = count === 2 ? 380 : 320;
  const positions = count === 2
    ? [{ x: 260, y: 520 }, { x: 520, y: 520 }]
    : [{ x: 390, y: 420 }, { x: 260, y: 600 }, { x: 520, y: 600 }];

  const labelPositions = count === 2
    ? [{ x: 140, y: 780 }, { x: 600, y: 780 }]
    : [{ x: 300, y: 320 }, { x: 100, y: 800 }, { x: 580, y: 800 }];

  return h('div', { style: { display: 'flex', flexDirection: 'column', width: W, height: H, background: C.bg, padding: '80px 60px 60px' } },
    header(title, subtitle),
    h('div', { style: { display: 'flex', position: 'relative', flex: 1, width: '100%' } },
      ...sets.slice(0, count).map((set, i) => {
        const color = C.bars[i % C.bars.length];
        const pos = positions[i];
        return h('div', { style: { display: 'flex', position: 'absolute', left: pos.x - circleSize / 2, top: pos.y - circleSize / 2, width: circleSize, height: circleSize, borderRadius: circleSize / 2, background: color, opacity: 0.25 } });
      }),
      ...sets.slice(0, count).map((set, i) => {
        const color = C.bars[i % C.bars.length];
        const lp = labelPositions[i];
        return h('div', { style: { display: 'flex', flexDirection: 'column', position: 'absolute', left: lp.x, top: lp.y, alignItems: 'center', maxWidth: 280 } },
          h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 28, color } }, set.label || ''),
          set.description ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 22, color: C.sub, marginTop: 8, textAlign: 'center' } }, set.description) : null,
        );
      }),
      overlap ? h('div', { style: { display: 'flex', position: 'absolute', left: count === 2 ? 310 : 320, top: count === 2 ? 490 : 540, maxWidth: 200, fontFamily: _F, fontWeight: 700, fontSize: 24, color: C.text, textAlign: 'center', background: 'rgba(255,255,255,0.85)', borderRadius: 12, padding: '12px 16px' } }, overlap) : null,
    ),
  );
}

// ─── 템플릿 라우터 ───
function renderTemplate(type, jsonData) {
  const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
  switch (type) {
    case 'infographic_data': return { vnode: dataTemplate(data), w: W, h: H };
    case 'infographic_flow': return { vnode: flowTemplate(data), w: W, h: H };
    case 'checklist': return { vnode: checklistTemplate(data), w: W, h: H };
    case 'venn': return { vnode: vennTemplate(data), w: W, h: H };
    default: return { vnode: dataTemplate(data), w: W, h: H };
  }
}

export { dataTemplate, flowTemplate, checklistTemplate, vennTemplate, renderTemplate, W as TMPL_W, H as TMPL_H };
