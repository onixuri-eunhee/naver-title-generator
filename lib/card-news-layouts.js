/**
 * 카드뉴스 슬라이드 레이아웃 템플릿
 * Satori 객체 리터럴 형식 (JSX 미사용)
 * 캔버스: 1080x1080 (인스타그램 정사각형)
 *
 * 각 함수: (slideData, theme) => Satori VNode 객체
 */

// ─── 헬퍼 ───
function h(type, props, ...children) {
  const flat = children.flat().filter(Boolean);
  return {
    type,
    props: {
      ...props,
      children: flat.length === 1 ? flat[0] : flat.length === 0 ? undefined : flat,
    },
  };
}

// ─── 공통 스타일 상수 ───
const FONT_FAMILY = 'Noto Sans KR';
const W = 1080;
const H = 1350; // 4:5 비율 (인스타그램 최적)
const PAD = 100;

// ─── 디자인 풍부화 래퍼 (컬러/크기/레이아웃 불변, 레이어만 추가) ───
// resvg-wasm이 `box-shadow: inset`에서 패닉하므로 전부 overlay div로 구현.
// 기존 root 스타일의 색상·크기·폰트·여백은 그대로, position:relative + overflow:hidden + 자식 레이어만 추가.
function withRichness(vnode) {
  const meshTopLeft = h('div', {
    style: {
      display: 'flex',
      position: 'absolute',
      top: -120,
      left: -120,
      width: 600,
      height: 600,
      background:
        'radial-gradient(circle, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0) 70%)',
    },
  });
  const meshBottomRight = h('div', {
    style: {
      display: 'flex',
      position: 'absolute',
      bottom: -160,
      right: -180,
      width: 700,
      height: 700,
      background:
        'radial-gradient(circle, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0) 70%)',
    },
  });
  const vignette = h('div', {
    style: {
      display: 'flex',
      position: 'absolute',
      top: 0,
      left: 0,
      width: W,
      height: H,
      background:
        'radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,0.05) 100%)',
    },
  });
  const topHighlight = h('div', {
    style: {
      display: 'flex',
      position: 'absolute',
      top: 0,
      left: 0,
      width: W,
      height: 2,
      background:
        'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0) 100%)',
    },
  });

  const existingStyle = vnode.props.style || {};
  const existingChildren = vnode.props.children;
  const childArr =
    existingChildren == null
      ? []
      : Array.isArray(existingChildren)
      ? existingChildren
      : [existingChildren];

  return {
    type: vnode.type,
    props: {
      ...vnode.props,
      style: {
        ...existingStyle,
        position: 'relative',
        overflow: 'hidden',
      },
      children: [meshTopLeft, meshBottomRight, vignette, topHighlight, ...childArr],
    },
  };
}

// ─── 1. cover — 표지 ───
function cover(slide, theme) {
  return withRichness(h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      width: W,
      height: H,
      background: theme.bgDark,
      padding: PAD,
    },
  },
    // 상단 악센트 라인
    h('div', {
      style: {
        display: 'flex',
        width: 100,
        height: 8,
        background: theme.accent,
        borderRadius: 4,
        marginBottom: 56,
      },
    }),
    // 제목
    h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 700,
        fontSize: slide.title && slide.title.length > 16 ? 80 : 96,
        color: '#FFFFFF',
        textAlign: 'center',
        lineHeight: 1.35,
        maxWidth: W - PAD * 2,
        justifyContent: 'center',
      },
    }, slide.title || ''),
    // 부제
    slide.subtitle ? h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        fontSize: 36,
        color: theme.accent,
        marginTop: 44,
        textAlign: 'center',
        lineHeight: 1.5,
        maxWidth: W - PAD * 2,
        justifyContent: 'center',
      },
    }, slide.subtitle) : null,
    // 하단 브랜드 라인
    slide.brand ? h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        fontSize: 28,
        color: 'rgba(255,255,255,0.45)',
        marginTop: 72,
        letterSpacing: 2,
      },
    }, slide.brand) : null,
  ));
}

// ─── 2. summary — 핵심 요약 (2페이지) ───
function summary(slide, theme) {
  return withRichness(h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: W,
      height: H,
      background: theme.bg,
      padding: PAD,
    },
  },
    // 상단 악센트 바
    h('div', {
      style: {
        display: 'flex',
        width: '100%',
        height: 8,
        background: theme.accent,
        borderRadius: 4,
        marginBottom: 56,
      },
    }),
    // 소제목 (라벨)
    slide.label ? h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 700,
        fontSize: 32,
        color: theme.accent,
        marginBottom: 24,
        letterSpacing: 1,
      },
    }, slide.label) : null,
    // 제목
    h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 700,
        fontSize: 56,
        color: theme.text,
        lineHeight: 1.4,
        marginBottom: 44,
      },
    }, slide.title || ''),
    // 요약 본문
    h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        fontSize: 40,
        color: theme.textLight,
        lineHeight: 1.7,
        maxWidth: W - PAD * 2,
      },
    }, slide.body || ''),
  ));
}

// ─── 3. content — 본문 슬라이드 ───
function content(slide, theme) {
  const num = slide.number ? String(slide.number).padStart(2, '0') : '01';
  return withRichness(h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: W,
      height: H,
      background: theme.bg,
      padding: PAD,
    },
  },
    // 번호 + 제목 행
    h('div', {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 48,
      },
    },
      // 번호
      h('div', {
        style: {
          display: 'flex',
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: 96,
          color: theme.primary,
          marginRight: 32,
          lineHeight: 1,
        },
      }, num),
      // 제목
      h('div', {
        style: {
          display: 'flex',
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: 56,
          color: theme.text,
          lineHeight: 1.35,
          paddingTop: 12,
          maxWidth: W - PAD * 2 - 140,
        },
      }, slide.title || ''),
    ),
    // 구분선
    h('div', {
      style: {
        display: 'flex',
        width: 80,
        height: 5,
        background: theme.accent,
        borderRadius: 3,
        marginBottom: 44,
      },
    }),
    // 본문
    h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        fontSize: 40,
        color: theme.textLight,
        lineHeight: 1.75,
        maxWidth: W - PAD * 2,
      },
    }, slide.body || ''),
  ));
}

// ─── 4. quote — 인용/강조 ───
function quote(slide, theme) {
  return withRichness(h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      width: W,
      height: H,
      background: theme.secondary,
      padding: PAD,
    },
  },
    // 큰 따옴표
    h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 700,
        fontSize: 200,
        color: theme.accent,
        lineHeight: 0.6,
        marginBottom: 32,
      },
    }, '\u201C'),
    // 인용 본문
    h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 700,
        fontSize: 52,
        color: theme.text,
        textAlign: 'center',
        lineHeight: 1.55,
        maxWidth: W - PAD * 2 - 40,
        justifyContent: 'center',
      },
    }, slide.body || ''),
    // 출처/설명
    slide.source ? h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        fontSize: 32,
        color: theme.textLight,
        marginTop: 48,
        textAlign: 'center',
        justifyContent: 'center',
      },
    }, slide.source) : null,
  ));
}

// ─── 5. data — 숫자/데이터 강조 ───
function data(slide, theme) {
  return withRichness(h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      width: W,
      height: H,
      background: theme.bg,
      padding: PAD,
    },
  },
    // 라벨
    slide.label ? h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 700,
        fontSize: 34,
        color: theme.textLight,
        marginBottom: 32,
        letterSpacing: 2,
      },
    }, slide.label) : null,
    // 큰 숫자
    h('div', {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'center',
        marginBottom: 20,
      },
    },
      h('div', {
        style: {
          display: 'flex',
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: 152,
          color: theme.primary,
          lineHeight: 1,
        },
      }, slide.value || '0'),
      slide.unit ? h('div', {
        style: {
          display: 'flex',
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: 60,
          color: theme.primary,
          marginLeft: 10,
          paddingBottom: 18,
        },
      }, slide.unit) : null,
    ),
    // 구분선
    h('div', {
      style: {
        display: 'flex',
        width: 80,
        height: 5,
        background: theme.accent,
        borderRadius: 3,
        marginTop: 24,
        marginBottom: 40,
      },
    }),
    // 설명
    h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        fontSize: 40,
        color: theme.textLight,
        textAlign: 'center',
        lineHeight: 1.65,
        maxWidth: W - PAD * 2,
        justifyContent: 'center',
      },
    }, slide.body || ''),
  ));
}

// ─── 6. cta — 마지막 장 (행동 유도) ───
function cta(slide, theme) {
  return withRichness(h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      width: W,
      height: H,
      background: theme.bgDark,
      padding: PAD,
    },
  },
    // CTA 문구
    h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 700,
        fontSize: 64,
        color: '#FFFFFF',
        textAlign: 'center',
        lineHeight: 1.45,
        maxWidth: W - PAD * 2,
        justifyContent: 'center',
        marginBottom: 48,
      },
    }, slide.title || ''),
    // 악센트 버튼 모양
    slide.buttonText ? h('div', {
      style: {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: theme.accent,
        borderRadius: theme.radius,
        padding: '24px 64px',
        marginBottom: 44,
        boxShadow:
          '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.05), 0 16px 32px rgba(0,0,0,0.04)',
      },
    },
      h('div', {
        style: {
          display: 'flex',
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: 36,
          color: theme.bgDark,
        },
      }, slide.buttonText),
    ) : null,
    // 부가 안내
    slide.body ? h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        fontSize: 34,
        color: 'rgba(255,255,255,0.55)',
        textAlign: 'center',
        lineHeight: 1.6,
        maxWidth: W - PAD * 2,
        justifyContent: 'center',
      },
    }, slide.body) : null,
  ));
}

// ─── 레이아웃 맵 ───
const layouts = { cover, summary, content, quote, data, cta };

export { layouts, h };
