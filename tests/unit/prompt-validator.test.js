import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateScriptQuality } from '../../lib/shortform/prompt-validator.js';

const DATA_LAYOUT_ARR = ['big-impact-text', 'counter', 'bar-chart', 'pie-chart', 'number-slam', 'progress-bar'];

const VALID_IG_CAPTION = '오늘 이 한 가지만 기억하세요. 저장해두고 필요할 때 꺼내보세요. #릴스 #꿀팁';
const VALID_YT_CAPTION = '이 영상 하나로 핵심 정리 끝. 구독 누르시면 다음 편 바로 알려드립니다. #Shorts #쇼츠';

function makeScene(overrides = {}) {
  return {
    layoutType: 'emphasis-box',
    layoutProps: { text: 'x' },
    onScreenText: '핵심',
    script: '테스트',
    section: 'point',
    type: 'broll',
    visual: 'close-up',
    ...overrides,
  };
}

function withCaptions(parsed) {
  return {
    captionInstagram: VALID_IG_CAPTION,
    captionYouTube: VALID_YT_CAPTION,
    ...parsed,
  };
}

describe('validateScriptQuality', () => {
  test('정상 대본 — ok:true, errors 없음', () => {
    const parsed = withCaptions({
      scenes: [
        makeScene({ layoutType: 'big-impact-text', onScreenText: '야근' }),
        makeScene({ layoutType: 'counter', onScreenText: '5시간' }),
        makeScene({ layoutType: 'flow-diagram', onScreenText: '3단계' }),
        makeScene({ layoutType: 'comparison', onScreenText: '비교' }),
        makeScene({ layoutType: 'emphasis-box', onScreenText: '핵심' }),
        makeScene({ layoutType: 'bullet-list', onScreenText: '3가지' }),
        makeScene({ layoutType: 'big-impact-text', onScreenText: '지금' }),
      ],
    });
    const r = validateScriptQuality(parsed);
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, []);
  });

  test('에러 — scenes 배열 아님', () => {
    assert.equal(validateScriptQuality(null).ok, false);
    assert.equal(validateScriptQuality({}).ok, false);
    assert.equal(validateScriptQuality({ scenes: 'x' }).ok, false);
  });

  test('에러 — layoutType 누락', () => {
    const parsed = {
      scenes: [
        makeScene({ layoutType: undefined }),
        makeScene({ layoutType: 'counter' }),
      ],
    };
    const r = validateScriptQuality(parsed);
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes('scene_0_missing_layoutType'));
  });

  test('에러 — 유효하지 않은 layoutType (17종 밖)', () => {
    const parsed = {
      scenes: [makeScene({ layoutType: 'nonexistent-layout' })],
    };
    const r = validateScriptQuality(parsed);
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /invalid_layoutType:nonexistent-layout/);
  });

  test('경고 — 데이터 시각화 2회 미만 (ok는 true 유지)', () => {
    const parsed = withCaptions({
      scenes: [
        makeScene({ layoutType: 'emphasis-box' }),
        makeScene({ layoutType: 'bullet-list' }),
        makeScene({ layoutType: 'subtitle-bar' }),
      ],
    });
    const r = validateScriptQuality(parsed);
    assert.equal(r.ok, true);
    assert.ok(r.warnings.some((w) => w.includes('data_viz_count_below_threshold:0')));
  });

  test('경고 — onScreenText 9자 초과', () => {
    const parsed = {
      scenes: [makeScene({ layoutType: 'counter', onScreenText: '123456789' })],
    };
    const r = validateScriptQuality(parsed);
    assert.ok(r.warnings.some((w) => w.includes('onScreenText_too_long')));
  });

  test('경고 — onScreenText 누락', () => {
    const parsed = {
      scenes: [makeScene({ layoutType: 'counter', onScreenText: undefined })],
    };
    const r = validateScriptQuality(parsed);
    assert.ok(r.warnings.includes('scene_0_missing_onScreenText'));
  });

  test('경고 — layoutProps 누락', () => {
    const parsed = {
      scenes: [makeScene({ layoutType: 'counter', layoutProps: undefined })],
    };
    const r = validateScriptQuality(parsed);
    assert.ok(r.warnings.includes('scene_0_missing_layoutProps'));
  });

  test('stats — sceneCount · dataVizCount · layoutDistribution', () => {
    const parsed = {
      scenes: [
        makeScene({ layoutType: 'counter' }),
        makeScene({ layoutType: 'counter' }),
        makeScene({ layoutType: 'bar-chart' }),
        makeScene({ layoutType: 'emphasis-box' }),
      ],
    };
    const r = validateScriptQuality(parsed);
    assert.equal(r.stats.sceneCount, 4);
    assert.equal(r.stats.dataVizCount, 3);
    assert.deepEqual(r.stats.layoutDistribution, {
      counter: 2,
      'bar-chart': 1,
      'emphasis-box': 1,
    });
  });

  test('17종 enum — DATA_VIZ_LAYOUTS 6종 모두 인식', () => {
    DATA_LAYOUT_ARR.forEach((layout) => {
      const parsed = { scenes: [makeScene({ layoutType: layout })] };
      const r = validateScriptQuality(parsed);
      assert.equal(r.stats.dataVizCount, 1, `layout=${layout}`);
    });
  });

  // 캡션 검증 — 누락/중복 시 재시도 유도 목적
  test('에러 — captionInstagram 누락', () => {
    const parsed = {
      scenes: [makeScene({ layoutType: 'counter' })],
      captionYouTube: VALID_YT_CAPTION,
    };
    const r = validateScriptQuality(parsed);
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes('caption_instagram_missing'));
  });

  test('에러 — captionYouTube 누락', () => {
    const parsed = {
      scenes: [makeScene({ layoutType: 'counter' })],
      captionInstagram: VALID_IG_CAPTION,
    };
    const r = validateScriptQuality(parsed);
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes('caption_youtube_missing'));
  });

  test('에러 — 두 캡션 본문 중복 (해시태그만 다름)', () => {
    const parsed = {
      scenes: [makeScene({ layoutType: 'counter' })],
      captionInstagram: '오늘 이 한 가지만 기억하세요 저장해두세요 #릴스 #꿀팁',
      captionYouTube:  '오늘 이 한 가지만 기억하세요 저장해두세요 #Shorts',
    };
    const r = validateScriptQuality(parsed);
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes('caption_duplicate_body'));
  });

  test('정상 — 해시태그 제거 후에도 본문이 진짜 다르면 ok', () => {
    const parsed = withCaptions({
      scenes: [makeScene({ layoutType: 'counter' })],
    });
    const r = validateScriptQuality(parsed);
    assert.ok(!r.errors.includes('caption_duplicate_body'));
  });

  test('에러 — 캡션 20자 미만도 missing 취급', () => {
    const parsed = {
      scenes: [makeScene({ layoutType: 'counter' })],
      captionInstagram: '짧아요 #릴스',
      captionYouTube: VALID_YT_CAPTION,
    };
    const r = validateScriptQuality(parsed);
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes('caption_instagram_missing'));
  });
});
