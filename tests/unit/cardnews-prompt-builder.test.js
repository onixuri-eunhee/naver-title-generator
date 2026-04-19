// tests/unit/cardnews-prompt-builder.test.js
//
// buildCardnewsUserMessage 조립 검증.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCardnewsUserMessage } from '../../lib/cardnews/prompt-builder.js';

test('builder — 기본 (brandKit + blogText + slideCount + 빈 이미지)', () => {
  const msg = buildCardnewsUserMessage({
    brandKit: {
      primary_color: '#ff6f61',
      secondary_color: '#0a0a0a',
      store_name: '엘보스',
      industry: 'AI 교육',
    },
    images: [],
    blogText: '안녕하세요 블로그 내용입니다.',
    slideCount: 5,
  });
  // Brand Kit 섹션 포함
  assert.match(msg, /Brand Kit|:root/);
  assert.match(msg, /#ff6f61|ff6f61/);
  assert.match(msg, /엘보스/);
  assert.match(msg, /AI 교육/);
  // 이미지 목록은 "없음" 또는 빈 섹션
  assert.match(msg, /이미지|images/);
  // 블로그 글 포함
  assert.match(msg, /안녕하세요 블로그 내용입니다/);
  // 슬라이드 수 지시
  assert.match(msg, /5장|5 장|총 5|slide_count.*5|5.*슬라이드/);
});

test('builder — 이미지 목록 포함 시 각 항목 표시', () => {
  const msg = buildCardnewsUserMessage({
    brandKit: { primary_color: '#000', store_name: '가게', industry: '카페' },
    images: [
      { ratio: '4x5', source: 'user_upload', tag: '카페 인테리어' },
      { ratio: '1x1', source: 'ai_generated', tag: '웃는 사장님' },
    ],
    blogText: '본문',
    slideCount: 3,
  });
  assert.match(msg, /img:0/);
  assert.match(msg, /img:1/);
  assert.match(msg, /카페 인테리어/);
  assert.match(msg, /웃는 사장님/);
  assert.match(msg, /user_upload/);
  assert.match(msg, /ai_generated/);
});

test('builder — 블로그 글 8000자 초과 시 절삭', () => {
  const longText = 'a'.repeat(10000);
  const msg = buildCardnewsUserMessage({
    brandKit: { primary_color: '#000', store_name: '가게', industry: '카페' },
    images: [],
    blogText: longText,
    slideCount: 3,
  });
  // 'a' 반복이 8000개 초과로 포함되면 안 됨
  const aCount = (msg.match(/a/g) || []).length;
  // 전체 메시지 중 'a' 카운트가 8000 이하여야 (다른 곳의 a 문자 고려하여 넉넉하게 8500)
  assert.ok(aCount <= 8500, `'a' 문자 수 ${aCount} > 8500 (절삭 실패)`);
});

test('builder — 빈 Brand Kit 방어 (null or undefined)', () => {
  const msg = buildCardnewsUserMessage({
    brandKit: null,
    images: [],
    blogText: '본문',
    slideCount: 3,
  });
  // throw 없이 fallback 값으로 동작
  assert.ok(typeof msg === 'string' && msg.length > 0);
  // 블로그 내용은 포함
  assert.match(msg, /본문/);
});

test('builder — logo_url 있으면 표시, 없으면 생략', () => {
  const msgWith = buildCardnewsUserMessage({
    brandKit: { store_name: '가게', industry: '카페', logo_url: 'https://cdn.x/logo.png' },
    images: [],
    blogText: '본문',
    slideCount: 3,
  });
  assert.match(msgWith, /logo\.png|brand-logo-url/);

  const msgWithout = buildCardnewsUserMessage({
    brandKit: { store_name: '가게', industry: '카페' },
    images: [],
    blogText: '본문',
    slideCount: 3,
  });
  assert.ok(!/brand-logo-url/.test(msgWithout), 'logo_url 없으면 --brand-logo-url 라인 없어야 함');
});

test('builder — 슬라이드 구성 지시 (cover / content / CTA)', () => {
  const msg = buildCardnewsUserMessage({
    brandKit: { store_name: '가게', industry: '카페' },
    images: [],
    blogText: '본문',
    slideCount: 7,
  });
  assert.match(msg, /cover/);
  assert.match(msg, /content/);
  assert.match(msg, /CTA|cta/);
});
