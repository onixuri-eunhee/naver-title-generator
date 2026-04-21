// tests/unit/whisper.test.js
//
// Phase F — Whisper 응답 정규화 단위 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWhisperResponse } from '../../lib/shortform/whisper.js';

test('normalizeWhisperResponse — 표준 응답', () => {
  const raw = {
    task: 'transcribe',
    language: 'korean',
    duration: 12.34,
    text: '안녕하세요 반갑습니다',
    words: [
      { word: '안녕하세요', start: 0.1, end: 1.2 },
      { word: '반갑습니다', start: 1.5, end: 3.0 },
    ],
  };
  const result = normalizeWhisperResponse(raw);
  assert.equal(result.duration, 12.34);
  assert.equal(result.text, '안녕하세요 반갑습니다');
  assert.equal(result.wordTimestamps.length, 2);
  assert.deepEqual(result.wordTimestamps[0], { word: '안녕하세요', start: 0.1, end: 1.2 });
});

test('normalizeWhisperResponse — words 누락 시 빈 배열', () => {
  const result = normalizeWhisperResponse({ duration: 5, text: '대본', words: undefined });
  assert.deepEqual(result.wordTimestamps, []);
  assert.equal(result.duration, 5);
});

test('normalizeWhisperResponse — 필드 없는 word 건너뜀', () => {
  const raw = {
    duration: 3,
    text: 't',
    words: [
      { word: 'ok', start: 0.1, end: 0.5 },
      { word: null, start: 0.6, end: 1.0 },
      { word: 'ok2', start: 1.1 }, // end 누락
    ],
  };
  const result = normalizeWhisperResponse(raw);
  assert.equal(result.wordTimestamps.length, 1);
  assert.equal(result.wordTimestamps[0].word, 'ok');
});

test('normalizeWhisperResponse — duration 파싱 실패 시 0', () => {
  const result = normalizeWhisperResponse({ text: 't', words: [] });
  assert.equal(result.duration, 0);
});
