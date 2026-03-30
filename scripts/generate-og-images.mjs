/**
 * OG 이미지 자동 생성 (1200x630)
 * Satori + Resvg로 각 페이지별 OG 이미지를 생성
 * 실행: node scripts/generate-og-images.mjs
 */
import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// 폰트 로딩
const fontRegular = readFileSync(join(root, 'fonts', 'NotoSansKR-Regular.subset.ttf'));
const fontBold = readFileSync(join(root, 'fonts', 'NotoSansKR-Bold.subset.ttf'));
const fonts = [
  { name: 'Noto Sans KR', data: fontRegular, weight: 400, style: 'normal' },
  { name: 'Noto Sans KR', data: fontBold, weight: 700, style: 'normal' },
];

// WASM 초기화
const wasmBuf = readFileSync(join(root, 'assets', 'resvg.wasm'));
await initWasm(wasmBuf);

const W = 1200, H = 630;
const F = 'Noto Sans KR';

function h(type, props, ...children) {
  const flat = children.flat().filter(Boolean);
  return { type, props: { ...props, children: flat.length === 1 ? flat[0] : flat.length === 0 ? undefined : flat } };
}

// OG 이미지 템플릿
function ogTemplate({ title, subtitle, emoji, accentColor }) {
  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'flex-start',
      width: W,
      height: H,
      background: 'linear-gradient(135deg, #1A1A2E, #16213E, #0F3460)',
      padding: '60px 80px',
    },
  },
    // 로고
    h('div', {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 40,
      },
    },
      h('div', {
        style: {
          display: 'flex',
          fontFamily: F,
          fontWeight: 700,
          fontSize: 28,
          color: '#FFFFFF',
        },
      }, '뚝딱툴'),
      h('div', {
        style: {
          display: 'flex',
          width: 3,
          height: 20,
          background: 'rgba(255,255,255,0.3)',
          marginLeft: 16,
          marginRight: 16,
        },
      }),
      h('div', {
        style: {
          display: 'flex',
          fontFamily: F,
          fontWeight: 400,
          fontSize: 22,
          color: 'rgba(255,255,255,0.6)',
        },
      }, 'ddukddaktool.co.kr'),
    ),
    // 이모지 + 제목
    h('div', {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 24,
      },
    },
      emoji ? h('div', {
        style: {
          display: 'flex',
          fontSize: 52,
          marginRight: 20,
        },
      }, emoji) : null,
      h('div', {
        style: {
          display: 'flex',
          fontFamily: F,
          fontWeight: 700,
          fontSize: 52,
          color: '#FFFFFF',
          lineHeight: 1.3,
        },
      }, title),
    ),
    // 부제
    h('div', {
      style: {
        display: 'flex',
        fontFamily: F,
        fontWeight: 400,
        fontSize: 26,
        color: 'rgba(255,255,255,0.7)',
        lineHeight: 1.6,
        maxWidth: W - 160,
      },
    }, subtitle),
    // 하단 악센트 바
    h('div', {
      style: {
        display: 'flex',
        width: 80,
        height: 6,
        background: accentColor || '#ff5f1f',
        borderRadius: 3,
        marginTop: 40,
      },
    }),
  );
}

// 메인 페이지용 (도구 전체 소개)
function ogMain() {
  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      width: W,
      height: H,
      background: 'linear-gradient(135deg, #1A1A2E, #16213E, #0F3460)',
      padding: '60px 80px',
    },
  },
    h('div', {
      style: {
        display: 'flex',
        fontFamily: F,
        fontWeight: 700,
        fontSize: 72,
        color: '#FFFFFF',
        marginBottom: 20,
      },
    }, '뚝딱툴'),
    h('div', {
      style: {
        display: 'flex',
        width: 80,
        height: 6,
        background: '#ff5f1f',
        borderRadius: 3,
        marginBottom: 32,
      },
    }),
    h('div', {
      style: {
        display: 'flex',
        fontFamily: F,
        fontWeight: 400,
        fontSize: 30,
        color: 'rgba(255,255,255,0.8)',
        textAlign: 'center',
        lineHeight: 1.6,
        justifyContent: 'center',
      },
    }, '자영업자를 위한 블로그 마케팅 도구'),
    h('div', {
      style: {
        display: 'flex',
        flexDirection: 'row',
        gap: 20,
        marginTop: 44,
        flexWrap: 'wrap',
        justifyContent: 'center',
      },
    },
      ...['제목', '후킹', '스레드', '블로그 글', '이미지', '카드뉴스'].map(name =>
        h('div', {
          style: {
            display: 'flex',
            padding: '10px 24px',
            borderRadius: 20,
            border: '1.5px solid rgba(255,255,255,0.25)',
            fontFamily: F,
            fontWeight: 500,
            fontSize: 20,
            color: 'rgba(255,255,255,0.8)',
          },
        }, name)
      ),
    ),
  );
}

const pages = [
  { name: 'og-main', render: ogMain },
  { name: 'og-title', render: () => ogTemplate({ title: '블로그 제목 생성기', subtitle: '업종과 키워드만 입력하면 클릭을 부르는 제목 24개를 자동 생성합니다. 12가지 심리 패턴 기반.', accentColor: '#00C73C' }) },
  { name: 'og-hook', render: () => ogTemplate({ title: 'SNS 후킹문구 생성기', subtitle: '릴스, 숏츠, 틱톡, 스레드의 첫 줄에서 스크롤을 멈추게 하는 후킹문구 15개 자동 생성.', accentColor: '#ff5f1f' }) },
  { name: 'og-threads', render: () => ogTemplate({ title: '스레드 글 생성기', subtitle: '정보형·공감형·반전형·궁금증형 4가지 유형으로 터지는 스레드 글을 자동 작성합니다.', accentColor: '#8B5CF6' }) },
  { name: 'og-blog-writer', render: () => ogTemplate({ title: '블로그 글 작성기', subtitle: 'AI가 검수하는 블로그 글 작성기. 7개 기준 90점 만점 검수 + 자동수정까지.', accentColor: '#ff5f1f' }) },
  { name: 'og-blog-image', render: () => ogTemplate({ title: '블로그 이미지 생성기', subtitle: '블로그 글을 붙여넣으면 AI가 문맥에 맞는 이미지를 자동 생성합니다.', accentColor: '#3B82F6' }) },
  { name: 'og-blog-image-pro', render: () => ogTemplate({ title: '프리미엄 이미지 생성기', subtitle: '사진·차트·타임라인·포스터 — AI가 자동 판별하여 최적의 모델로 이미지를 생성합니다.', accentColor: '#8B5CF6' }) },
  { name: 'og-card-news', render: () => ogTemplate({ title: '카드뉴스 제작기', subtitle: '글을 붙여넣으면 AI가 인스타용 카드뉴스를 자동으로 만들어드립니다. 9종 테마 + 브랜드 컬러.', accentColor: '#ff5f1f' }) },
  { name: 'og-column', render: () => ogTemplate({ title: '블로그 마케팅 칼럼', subtitle: '자영업자를 위한 블로그 마케팅 실전 노하우. 매주 업데이트.', accentColor: '#10B981' }) },
  { name: 'og-guide', render: () => ogTemplate({ title: '뚝딱툴 200% 활용법', subtitle: '5개 도구 사용법 가이드. 제목부터 이미지까지, 블로그 마케팅을 뚝딱 완성하세요.', accentColor: '#F59E0B' }) },
];

// 출력 디렉토리
const outDir = join(root, 'assets', 'og');
mkdirSync(outDir, { recursive: true });

for (const page of pages) {
  const vnode = page.render();
  const svg = await satori(vnode, { width: W, height: H, fonts });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: W } });
  const png = resvg.render().asPng();
  const outPath = join(outDir, `${page.name}.png`);
  writeFileSync(outPath, png);
  console.log(`✓ ${page.name}.png (${(png.length / 1024).toFixed(0)}KB)`);
}

console.log(`\n완료: ${pages.length}개 OG 이미지 → assets/og/`);
