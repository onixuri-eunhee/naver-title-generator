// api/_satori-templates.js
// 프리미엄 이미지 Satori 템플릿 4종: 비교표, 흐름도, 체크리스트, 벤다이어그램
// 카드뉴스 수준 디자인: 꽉 찬 레이아웃, 배경 카드, 장식 요소
import { h, _F } from './_satori-renderer.js';

const W = 1024, H = 1536; // 2:3 vertical

const C = {
  bg: '#1A1A2E', bgCard: '#FFFFFF', text: '#1A1A2E', textLight: '#FFFFFF',
  sub: '#6B7280', subLight: 'rgba(255,255,255,0.5)', accent: '#ff5f1f',
  border: '#E5E7EB', cardBg: '#F8F9FA',
  bars: ['#ff5f1f', '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EC4899'],
};

// ─── 다크 헤더 (제목 + 부제 + 액센트 바) ───
function darkHeader(title, subtitle) {
  return h('div', { style: { display: 'flex', flexDirection: 'column', padding: '72px 64px 48px', background: C.bg } },
    h('div', { style: { display: 'flex', width: 80, height: 5, background: C.accent, borderRadius: 3, marginBottom: 32 } }),
    title ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 52, color: C.textLight, lineHeight: 1.3 } }, title) : null,
    subtitle ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 28, color: C.subLight, marginTop: 16, letterSpacing: 0.5 } }, subtitle) : null,
  );
}

// ─── 출처 바 (하단) ───
function sourceBar(source) {
  if (!source) return null;
  return h('div', { style: { display: 'flex', padding: '20px 64px', background: C.bg, justifyContent: 'flex-end', alignItems: 'center' } },
    h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 20, color: C.subLight, letterSpacing: 0.5 } }, source),
  );
}

// ════════════════════════════════════════
// 1. 비교표 (infographic_data) — 수평 바 차트
// ════════════════════════════════════════
// JSON: { title, subtitle?, source?, items: [{ label, value, unit? }] }
function dataTemplate(data) {
  const { title, subtitle, source, items = [] } = data;
  const maxVal = Math.max(...items.map(it => parseFloat(it.value) || 0), 1);

  return h('div', { style: { display: 'flex', flexDirection: 'column', width: W, height: H } },
    darkHeader(title, subtitle),
    // 콘텐츠 영역 — 흰 배경, flex:1로 꽉 채움
    h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, background: C.bgCard, padding: '48px 64px', gap: 0, justifyContent: 'center' } },
      ...items.map((item, i) => {
        const pct = Math.round(((parseFloat(item.value) || 0) / maxVal) * 100);
        const color = C.bars[i % C.bars.length];
        return h('div', { style: { display: 'flex', flexDirection: 'column', padding: '28px 0', borderBottom: i < items.length - 1 ? `1px solid ${C.border}` : 'none' } },
          // 라벨 행: 번호 원 + 라벨 + 수치
          h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 16 } },
            h('div', { style: { display: 'flex', width: 44, height: 44, borderRadius: 22, background: `${color}18`, alignItems: 'center', justifyContent: 'center', marginRight: 16, flexShrink: 0 } },
              h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 22, color } }, String(i + 1)),
            ),
            h('div', { style: { display: 'flex', flex: 1, fontFamily: _F, fontWeight: 600, fontSize: 30, color: C.text } }, item.label || ''),
            h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 800, fontSize: 36, color } }, `${item.value}${item.unit || ''}`),
          ),
          // 바
          h('div', { style: { display: 'flex', width: '100%', height: 44, background: '#F3F4F6', borderRadius: 12, overflow: 'hidden' } },
            h('div', { style: { display: 'flex', width: `${Math.max(pct, 5)}%`, height: 44, background: color, borderRadius: 12, alignItems: 'center', justifyContent: 'flex-end', paddingRight: pct > 15 ? 16 : 0 } },
              pct > 15 ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 20, color: '#FFFFFF' } }, `${pct}%`) : null,
            ),
          ),
        );
      }),
    ),
    sourceBar(source),
  );
}

// ════════════════════════════════════════
// 2. 흐름도 (infographic_flow) — 번호 원 + 카드 + 화살표
// ════════════════════════════════════════
// JSON: { title, subtitle?, steps: [{ label, description? }] }
function flowTemplate(data) {
  const { title, subtitle, steps = [] } = data;

  return h('div', { style: { display: 'flex', flexDirection: 'column', width: W, height: H } },
    darkHeader(title, subtitle),
    // 콘텐츠
    h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, background: C.cardBg, padding: '40px 48px', justifyContent: 'center', gap: 0 } },
      ...steps.flatMap((step, i) => {
        const color = C.bars[i % C.bars.length];
        const isLast = i === steps.length - 1;
        const nodes = [];
        // 스텝 카드
        nodes.push(
          h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 0 } },
            // 좌측: 번호 + 연결선
            h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 80, flexShrink: 0 } },
              h('div', { style: { display: 'flex', width: 56, height: 56, borderRadius: 28, background: color, alignItems: 'center', justifyContent: 'center' } },
                h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 26, color: '#FFFFFF' } }, String(i + 1)),
              ),
            ),
            // 우측: 카드
            h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, background: C.bgCard, borderRadius: 20, padding: '28px 36px', borderLeft: `5px solid ${color}`, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' } },
              h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 30, color: C.text, lineHeight: 1.4 } }, step.label || ''),
              step.description ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 24, color: C.sub, lineHeight: 1.6, marginTop: 10 } }, step.description) : null,
            ),
          )
        );
        // 화살표 연결선
        if (!isLast) {
          nodes.push(
            h('div', { style: { display: 'flex', flexDirection: 'row', height: 40, alignItems: 'center' } },
              h('div', { style: { display: 'flex', width: 80, justifyContent: 'center', alignItems: 'center' } },
                h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } },
                  h('div', { style: { display: 'flex', width: 3, height: 24, background: C.border } }),
                  h('div', { style: { display: 'flex', fontFamily: _F, fontSize: 18, color: C.border, lineHeight: 1 } }, '▼'),
                ),
              ),
            )
          );
        }
        return nodes;
      }),
    ),
  );
}

// ════════════════════════════════════════
// 3. 체크리스트 (checklist) — 체크 박스 + 카드
// ════════════════════════════════════════
// JSON: { title, subtitle?, items: [{ text, checked? }] }
function checklistTemplate(data) {
  const { title, subtitle, items = [] } = data;

  return h('div', { style: { display: 'flex', flexDirection: 'column', width: W, height: H } },
    darkHeader(title, subtitle),
    // 콘텐츠
    h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, background: C.cardBg, padding: '40px 48px', justifyContent: 'center', gap: 16 } },
      ...items.map((item, i) => {
        const checked = item.checked !== false;
        const color = C.bars[i % C.bars.length];
        return h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 20, background: C.bgCard, borderRadius: 20, padding: '28px 36px', borderLeft: `5px solid ${checked ? color : C.border}` } },
          // 체크 아이콘
          h('div', { style: { display: 'flex', width: 52, height: 52, borderRadius: 14, background: checked ? color : '#F3F4F6', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } },
            checked
              ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 800, fontSize: 30, color: '#FFFFFF', lineHeight: 1 } }, '✓')
              : h('div', { style: { display: 'flex', width: 24, height: 24, borderRadius: 6, border: `3px solid ${C.border}` } }),
          ),
          // 텍스트
          h('div', { style: { display: 'flex', flex: 1, fontFamily: _F, fontWeight: checked ? 600 : 400, fontSize: 28, color: checked ? C.text : C.sub, lineHeight: 1.5 } }, item.text || ''),
          // 상태 라벨
          checked
            ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 18, color, background: `${color}15`, padding: '6px 14px', borderRadius: 8, flexShrink: 0 } }, 'DONE')
            : h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 600, fontSize: 18, color: C.sub, background: '#F3F4F6', padding: '6px 14px', borderRadius: 8, flexShrink: 0 } }, 'TODO'),
        );
      }),
    ),
  );
}

// ════════════════════════════════════════
// 4. 벤다이어그램 / 관계도 (venn) — 큰 원 + 내부 라벨 + 교집합
// ════════════════════════════════════════
// JSON: { title, subtitle?, sets: [{ label, description? }], overlap?: string }
function vennTemplate(data) {
  const { title, subtitle, sets = [], overlap } = data;
  const count = Math.min(sets.length, 3);

  // 원 크기와 위치 — 캔버스를 꽉 채우도록
  const circleSize = count === 2 ? 500 : 400;
  // 2개: 가로 중앙, 겹침 120px
  // 3개: 삼각형 배치
  const cx = W / 2; // 512
  const cy = 500; // 원 중심 Y (헤더 아래)
  const overlap2 = 120; // 겹침 폭
  const positions = count === 2
    ? [{ x: cx - circleSize / 2 + overlap2 / 2, y: cy }, { x: cx + circleSize / 2 - overlap2 / 2, y: cy }]
    : [{ x: cx, y: cy - 80 }, { x: cx - 160, y: cy + 120 }, { x: cx + 160, y: cy + 120 }];

  return h('div', { style: { display: 'flex', flexDirection: 'column', width: W, height: H } },
    darkHeader(title, subtitle),
    // 다이어그램 영역
    h('div', { style: { display: 'flex', position: 'relative', flex: 1, background: C.bgCard } },
      // 원들 (반투명)
      ...sets.slice(0, count).map((set, i) => {
        const color = C.bars[i % C.bars.length];
        const pos = positions[i];
        return h('div', { style: { display: 'flex', position: 'absolute', left: pos.x - circleSize / 2, top: pos.y - circleSize / 2, width: circleSize, height: circleSize, borderRadius: circleSize / 2, background: color, opacity: 0.2, border: `4px solid ${color}` } });
      }),
      // 라벨들 (원 안쪽, 겹치지 않는 영역에)
      ...sets.slice(0, count).map((set, i) => {
        const color = C.bars[i % C.bars.length];
        const pos = positions[i];
        // 라벨 위치: 원 중심에서 교집합 반대쪽으로 오프셋
        const labelOffset = count === 2
          ? { x: i === 0 ? -80 : 80, y: -20 }
          : { x: i === 0 ? 0 : i === 1 ? -80 : 80, y: i === 0 ? -60 : 40 };
        return h('div', { style: { display: 'flex', flexDirection: 'column', position: 'absolute', left: pos.x + labelOffset.x - 130, top: pos.y + labelOffset.y - 50, width: 260, alignItems: 'center' } },
          h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 800, fontSize: 32, color, textAlign: 'center', justifyContent: 'center' } }, set.label || ''),
          set.description ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 22, color: C.sub, marginTop: 10, textAlign: 'center', lineHeight: 1.4, justifyContent: 'center' } }, set.description) : null,
        );
      }),
      // 교집합 태그
      overlap ? h('div', { style: { display: 'flex', position: 'absolute', left: cx - 110, top: cy - 30, width: 220, background: C.accent, borderRadius: 16, padding: '16px 24px', alignItems: 'center', justifyContent: 'center' } },
        h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 26, color: '#FFFFFF', textAlign: 'center', justifyContent: 'center' } }, overlap),
      ) : null,
      // 하단: 각 집합 요약 카드
      h('div', { style: { display: 'flex', flexDirection: 'row', position: 'absolute', bottom: 48, left: 48, right: 48, gap: 16 } },
        ...sets.slice(0, count).map((set, i) => {
          const color = C.bars[i % C.bars.length];
          return h('div', { style: { display: 'flex', flexDirection: 'row', flex: 1, alignItems: 'center', gap: 12, background: '#FFFFFF', borderRadius: 16, padding: '20px 24px', border: `2px solid ${C.border}` } },
            h('div', { style: { display: 'flex', width: 16, height: 16, borderRadius: 8, background: color, flexShrink: 0 } }),
            h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 600, fontSize: 22, color: C.text } }, set.label || ''),
          );
        }),
      ),
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
