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
const CANVAS = 1080;
const PAD = 80;

// ─── 1. cover — 표지 ───
function cover(slide, theme) {
  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      width: CANVAS,
      height: CANVAS,
      background: theme.bgDark,
      padding: PAD,
    },
  },
    // 상단 악센트 라인
    h('div', {
      style: {
        display: 'flex',
        width: 80,
        height: 6,
        background: theme.accent,
        borderRadius: 3,
        marginBottom: 48,
      },
    }),
    // 제목
    h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 700,
        fontSize: slide.title && slide.title.length > 20 ? 56 : 64,
        color: '#FFFFFF',
        textAlign: 'center',
        lineHeight: 1.35,
        maxWidth: CANVAS - PAD * 2,
        justifyContent: 'center',
      },
    }, slide.title || ''),
    // 부제
    slide.subtitle ? h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        fontSize: 28,
        color: theme.accent,
        marginTop: 36,
        textAlign: 'center',
        lineHeight: 1.5,
        maxWidth: CANVAS - PAD * 2,
        justifyContent: 'center',
      },
    }, slide.subtitle) : null,
    // 하단 브랜드 라인
    slide.brand ? h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        fontSize: 22,
        color: 'rgba(255,255,255,0.45)',
        marginTop: 60,
        letterSpacing: 2,
      },
    }, slide.brand) : null,
  );
}

// ─── 2. summary — 핵심 요약 (2페이지) ───
function summary(slide, theme) {
  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: CANVAS,
      height: CANVAS,
      background: theme.bg,
      padding: PAD,
    },
  },
    // 상단 악센트 바
    h('div', {
      style: {
        display: 'flex',
        width: '100%',
        height: 6,
        background: theme.accent,
        borderRadius: 3,
        marginBottom: 48,
      },
    }),
    // 소제목 (라벨)
    slide.label ? h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 700,
        fontSize: 24,
        color: theme.accent,
        marginBottom: 20,
        letterSpacing: 1,
      },
    }, slide.label) : null,
    // 제목
    h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 700,
        fontSize: 46,
        color: theme.text,
        lineHeight: 1.4,
        marginBottom: 36,
      },
    }, slide.title || ''),
    // 요약 본문
    h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        fontSize: 30,
        color: theme.textLight,
        lineHeight: 1.7,
        maxWidth: CANVAS - PAD * 2,
      },
    }, slide.body || ''),
  );
}

// ─── 3. content — 본문 슬라이드 ───
function content(slide, theme) {
  const num = slide.number ? String(slide.number).padStart(2, '0') : '01';
  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: CANVAS,
      height: CANVAS,
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
        marginBottom: 40,
      },
    },
      // 번호
      h('div', {
        style: {
          display: 'flex',
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: 72,
          color: theme.primary,
          marginRight: 28,
          lineHeight: 1,
        },
      }, num),
      // 제목
      h('div', {
        style: {
          display: 'flex',
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: 42,
          color: theme.text,
          lineHeight: 1.35,
          paddingTop: 10,
          maxWidth: CANVAS - PAD * 2 - 120,
        },
      }, slide.title || ''),
    ),
    // 구분선
    h('div', {
      style: {
        display: 'flex',
        width: 60,
        height: 4,
        background: theme.accent,
        borderRadius: 2,
        marginBottom: 36,
      },
    }),
    // 본문
    h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        fontSize: 30,
        color: theme.textLight,
        lineHeight: 1.75,
        maxWidth: CANVAS - PAD * 2,
      },
    }, slide.body || ''),
  );
}

// ─── 4. quote — 인용/강조 ───
function quote(slide, theme) {
  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      width: CANVAS,
      height: CANVAS,
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
        fontSize: 160,
        color: theme.accent,
        lineHeight: 0.6,
        marginBottom: 24,
      },
    }, '\u201C'),
    // 인용 본문
    h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 700,
        fontSize: 40,
        color: theme.text,
        textAlign: 'center',
        lineHeight: 1.55,
        maxWidth: CANVAS - PAD * 2 - 40,
        justifyContent: 'center',
      },
    }, slide.body || ''),
    // 출처/설명
    slide.source ? h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        fontSize: 24,
        color: theme.textLight,
        marginTop: 40,
        textAlign: 'center',
        justifyContent: 'center',
      },
    }, slide.source) : null,
  );
}

// ─── 5. data — 숫자/데이터 강조 ───
function data(slide, theme) {
  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      width: CANVAS,
      height: CANVAS,
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
        fontSize: 26,
        color: theme.textLight,
        marginBottom: 24,
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
        marginBottom: 16,
      },
    },
      h('div', {
        style: {
          display: 'flex',
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: 120,
          color: theme.primary,
          lineHeight: 1,
        },
      }, slide.value || '0'),
      slide.unit ? h('div', {
        style: {
          display: 'flex',
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: 48,
          color: theme.primary,
          marginLeft: 8,
          paddingBottom: 14,
        },
      }, slide.unit) : null,
    ),
    // 구분선
    h('div', {
      style: {
        display: 'flex',
        width: 60,
        height: 4,
        background: theme.accent,
        borderRadius: 2,
        marginTop: 20,
        marginBottom: 32,
      },
    }),
    // 설명
    h('div', {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        fontSize: 30,
        color: theme.textLight,
        textAlign: 'center',
        lineHeight: 1.65,
        maxWidth: CANVAS - PAD * 2,
        justifyContent: 'center',
      },
    }, slide.body || ''),
  );
}

// ─── 6. cta — 마지막 장 (행동 유도) ───
function cta(slide, theme) {
  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      width: CANVAS,
      height: CANVAS,
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
        fontSize: 50,
        color: '#FFFFFF',
        textAlign: 'center',
        lineHeight: 1.45,
        maxWidth: CANVAS - PAD * 2,
        justifyContent: 'center',
        marginBottom: 40,
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
        padding: '20px 56px',
        marginBottom: 36,
      },
    },
      h('div', {
        style: {
          display: 'flex',
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: 28,
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
        fontSize: 26,
        color: 'rgba(255,255,255,0.55)',
        textAlign: 'center',
        lineHeight: 1.6,
        maxWidth: CANVAS - PAD * 2,
        justifyContent: 'center',
      },
    }, slide.body) : null,
  );
}

// ─── 레이아웃 맵 ───
const layouts = { cover, summary, content, quote, data, cta };

export { layouts, h };
