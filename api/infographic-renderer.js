import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

/*
 * Satori 인포그래픽 렌더러
 * 4종 레이아웃: comparison, list, steps, stats
 * 1024x1024 PNG, 한글 100% 정확 (Noto Sans KR)
 */

// ─── 폰트 캐싱 (warm invocation 재사용) ───
let fontDataCache = null;

async function loadFont() {
  if (fontDataCache) return fontDataCache;

  const url = 'https://fonts.gstatic.com/s/notosanskr/v39/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzg01eLQ.ttf';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font fetch failed: ${res.status}`);
  fontDataCache = await res.arrayBuffer();
  return fontDataCache;
}

// ─── 공통 스타일 ───
const COLORS = {
  bg1: '#667eea',
  bg2: '#764ba2',
  white: '#ffffff',
  whiteAlpha80: 'rgba(255,255,255,0.8)',
  whiteAlpha20: 'rgba(255,255,255,0.2)',
  whiteAlpha15: 'rgba(255,255,255,0.15)',
  whiteAlpha10: 'rgba(255,255,255,0.1)',
  dark: '#1a1a2e',
  accent: '#ffd700',
};

function baseContainer(children) {
  return {
    type: 'div',
    props: {
      style: {
        width: '1024px',
        height: '1024px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(135deg, ${COLORS.bg1} 0%, ${COLORS.bg2} 100%)`,
        padding: '60px',
        fontFamily: '"Noto Sans KR"',
      },
      children,
    },
  };
}

function titleElement(text) {
  return {
    type: 'div',
    props: {
      style: {
        fontSize: '48px',
        fontWeight: 700,
        color: COLORS.white,
        textAlign: 'center',
        marginBottom: '50px',
        lineHeight: 1.3,
        maxWidth: '860px',
        wordBreak: 'keep-all',
      },
      children: text,
    },
  };
}

// ─── comparison 레이아웃 (A vs B) ───
function buildComparison(data) {
  const { title, columns, items } = data;
  const safeItems = (items || []).slice(0, 6);
  const col1 = columns?.[0] || 'A';
  const col2 = columns?.[1] || 'B';

  const headerRow = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        width: '100%',
        marginBottom: '16px',
      },
      children: [
        { type: 'div', props: { style: { flex: 1, fontSize: '20px', color: COLORS.whiteAlpha80, textAlign: 'center' }, children: '' } },
        { type: 'div', props: { style: { flex: 1, fontSize: '28px', fontWeight: 700, color: COLORS.accent, textAlign: 'center', padding: '12px' }, children: col1 } },
        { type: 'div', props: { style: { flex: 1, fontSize: '28px', fontWeight: 700, color: COLORS.accent, textAlign: 'center', padding: '12px' }, children: col2 } },
      ],
    },
  };

  const rows = safeItems.map((item) => ({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        width: '100%',
        borderTop: `1px solid ${COLORS.whiteAlpha20}`,
        padding: '14px 0',
        alignItems: 'center',
      },
      children: [
        { type: 'div', props: { style: { flex: 1, fontSize: '22px', fontWeight: 700, color: COLORS.white, textAlign: 'center', padding: '8px' }, children: item.label || '' } },
        { type: 'div', props: { style: { flex: 1, fontSize: '22px', color: COLORS.whiteAlpha80, textAlign: 'center', padding: '8px' }, children: item.values?.[0] || '' } },
        { type: 'div', props: { style: { flex: 1, fontSize: '22px', color: COLORS.whiteAlpha80, textAlign: 'center', padding: '8px' }, children: item.values?.[1] || '' } },
      ],
    },
  }));

  const table = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        background: COLORS.whiteAlpha10,
        borderRadius: '20px',
        padding: '20px 30px',
      },
      children: [headerRow, ...rows],
    },
  };

  return baseContainer([titleElement(title || '비교'), table]);
}

// ─── list 레이아웃 (목록/순위) ───
function buildList(data) {
  const { title, items } = data;
  const safeItems = (items || []).slice(0, 8);

  const listItems = safeItems.map((item, i) => ({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        background: COLORS.whiteAlpha10,
        borderRadius: '16px',
        padding: '20px 28px',
        marginBottom: '12px',
        width: '100%',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              fontSize: '32px',
              width: '48px',
              height: '48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            },
            children: item.icon || `${i + 1}`,
          },
        },
        {
          type: 'div',
          props: {
            style: {
              fontSize: '26px',
              fontWeight: 700,
              color: COLORS.white,
              flex: 1,
              lineHeight: 1.4,
              wordBreak: 'keep-all',
            },
            children: item.text || '',
          },
        },
      ],
    },
  }));

  return baseContainer([titleElement(title || '목록'), ...listItems]);
}

// ─── steps 레이아웃 (단계/절차) ───
function buildSteps(data) {
  const { title, items } = data;
  const safeItems = (items || []).slice(0, 5);

  const stepItems = safeItems.map((item, i) => ({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '24px',
        marginBottom: '20px',
        width: '100%',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              flexShrink: 0,
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    width: '52px',
                    height: '52px',
                    borderRadius: '50%',
                    background: COLORS.accent,
                    color: COLORS.dark,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '24px',
                    fontWeight: 700,
                  },
                  children: item.step || `${i + 1}`,
                },
              },
              ...(i < safeItems.length - 1
                ? [{
                    type: 'div',
                    props: {
                      style: {
                        width: '3px',
                        height: '40px',
                        background: COLORS.whiteAlpha20,
                        marginTop: '8px',
                      },
                      children: '',
                    },
                  }]
                : []),
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              paddingTop: '6px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '28px',
                    fontWeight: 700,
                    color: COLORS.white,
                    marginBottom: '6px',
                    lineHeight: 1.3,
                    wordBreak: 'keep-all',
                  },
                  children: item.title || '',
                },
              },
              ...(item.desc
                ? [{
                    type: 'div',
                    props: {
                      style: {
                        fontSize: '20px',
                        color: COLORS.whiteAlpha80,
                        lineHeight: 1.5,
                        wordBreak: 'keep-all',
                      },
                      children: item.desc,
                    },
                  }]
                : []),
            ],
          },
        },
      ],
    },
  }));

  return baseContainer([titleElement(title || '단계'), ...stepItems]);
}

// ─── stats 레이아웃 (수치/통계) ───
function buildStats(data) {
  const { title, items } = data;
  const safeItems = (items || []).slice(0, 4);

  const isTwo = safeItems.length <= 2;

  const statCards = safeItems.map((item) => ({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: COLORS.whiteAlpha15,
        borderRadius: '20px',
        padding: isTwo ? '40px 30px' : '30px 20px',
        flex: 1,
        minWidth: isTwo ? '300px' : '180px',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              fontSize: isTwo ? '56px' : '44px',
              fontWeight: 700,
              color: COLORS.accent,
              marginBottom: '10px',
              lineHeight: 1.2,
            },
            children: item.number || '',
          },
        },
        {
          type: 'div',
          props: {
            style: {
              fontSize: isTwo ? '26px' : '22px',
              fontWeight: 700,
              color: COLORS.white,
              textAlign: 'center',
              marginBottom: '6px',
              lineHeight: 1.3,
              wordBreak: 'keep-all',
            },
            children: item.label || '',
          },
        },
        ...(item.sub
          ? [{
              type: 'div',
              props: {
                style: {
                  fontSize: '18px',
                  color: COLORS.whiteAlpha80,
                  textAlign: 'center',
                  lineHeight: 1.4,
                  wordBreak: 'keep-all',
                },
                children: item.sub,
              },
            }]
          : []),
      ],
    },
  }));

  const grid = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '20px',
        width: '100%',
        justifyContent: 'center',
      },
      children: statCards,
    },
  };

  return baseContainer([titleElement(title || '통계'), grid]);
}

// ─── 메인 렌더 함수 ───
const LAYOUT_BUILDERS = {
  comparison: buildComparison,
  list: buildList,
  steps: buildSteps,
  stats: buildStats,
};

export async function renderInfographic(data) {
  const { layout } = data;
  const builder = LAYOUT_BUILDERS[layout];
  if (!builder) throw new Error(`Unknown layout: ${layout}`);

  const jsx = builder(data);
  const fontData = await loadFont();

  const svg = await satori(jsx, {
    width: 1024,
    height: 1024,
    fonts: [
      {
        name: 'Noto Sans KR',
        data: fontData,
        weight: 700,
        style: 'normal',
      },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1024 },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  const base64 = Buffer.from(pngBuffer).toString('base64');
  return `data:image/png;base64,${base64}`;
}
