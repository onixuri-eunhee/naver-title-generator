import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateScriptQuality } from '../../lib/shortform/prompt-validator.js';

const DATA_LAYOUT_ARR = ['big-impact-text', 'counter', 'bar-chart', 'pie-chart', 'number-slam', 'progress-bar'];

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

describe('validateScriptQuality', () => {
  test('정상 대본 — ok:true, errors 없음', () => {
    const parsed = {
      scenes: [
        makeScene({ layoutType: 'big-impact-text', onScreenText: '야근' }),
        makeScene({ layoutType: 'counter', onScreenText: '5시간' }),
        makeScene({ layoutType: 'flow-diagram', onScreenText: '3단계' }),
        makeScene({ layoutType: 'comparison', onScreenText: '비교' }),
        makeScene({ layoutType: 'emphasis-box', onScreenText: '핵심' }),
        makeScene({ layoutType: 'bullet-list', onScreenText: '3가지' }),
        makeScene({ layoutType: 'big-impact-text', onScreenText: '지금' }),
      ],
    };
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
    const parsed = {
      scenes: [
        makeScene({ layoutType: 'emphasis-box' }),
        makeScene({ layoutType: 'bullet-list' }),
        makeScene({ layoutType: 'subtitle-bar' }),
      ],
    };
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
});
