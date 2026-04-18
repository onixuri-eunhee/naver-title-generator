import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPromptSlim } from '../../lib/shortform/prompt.js';

describe('buildSystemPromptSlim — 5대 하드 룰', () => {
  test('룰 1: JSON 순수 출력', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.match(p, /순수 JSON/);
    assert.match(p, /마크다운/);
  });

  test('룰 2: layoutType 17종 enum 강제 + 스키마', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    const names = [
      'big-impact-text', 'counter', 'number-slam', 'progress-bar',
      'bar-chart', 'pie-chart',
      'flow-diagram', 'comparison', 'comparison-chart', 'venn-diagram', 'network',
      'bullet-list', 'emphasis-box', 'strikethrough', 'vertical-bar',
      'small-label', 'subtitle-bar',
    ];
    names.forEach((n) => {
      assert.ok(p.includes(n), `layout name missing: ${n}`);
    });
  });

  test('룰 3: scenes count + onScreenText 8자', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 10 });
    assert.match(p, /scenes 개수.*=.*10/);
    assert.match(p, /onScreenText.*8자/);
  });

  test('룰 4: 데이터 시각화 2회', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.match(p, /데이터 시각화.*2회/);
  });

  test('룰 5: 존댓말·구어체·이모지 금지', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.match(p, /존댓말/);
    assert.match(p, /이모지/);
    assert.match(p, /구어체/);
  });

  test('제거 확인: fingr 씬별 역할 지시 없음', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.doesNotMatch(p, /마음읽기 질문/);
    assert.doesNotMatch(p, /scene\[1\]/);
    assert.doesNotMatch(p, /통념 깨기/);
  });

  test('제거 확인: 외래어 9개 오탈자 예시 없음', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.doesNotMatch(p, /볼랙/);
    assert.doesNotMatch(p, /네비이/);
    assert.doesNotMatch(p, /아이보리이/);
  });

  test('제거 확인: 후킹 6종 BAD/GOOD 예시 본문 없음', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.doesNotMatch(p, /BAD \(0점\)/);
    assert.doesNotMatch(p, /블로그 하루 3시간 쓰는데 왜 방문자가/);
  });

  test('제거 확인: [layoutType 선택 우선순위] 블록 없음', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.doesNotMatch(p, /선택 우선순위/);
    assert.doesNotMatch(p, /숫자·%·금액/);
  });

  test('길이: 전체 120줄 이하 (layout schema 17종 포함)', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    const lines = p.split('\n').length;
    assert.ok(lines <= 120, `expected <=120 lines, got ${lines}`);
  });

  test('첫 씬: hookText·hookType 필수 필드 가이드 포함', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.match(p, /hookText/);
    assert.match(p, /hookType/);
  });

  test('targetSceneCount 기본값 7', () => {
    const p = buildSystemPromptSlim();
    assert.match(p, /scenes 개수.*=.*7/);
  });
});
