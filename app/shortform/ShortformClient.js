'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import { ShortformComposition, buildShortformTimeline } from '@/remotion/shortform/ShortformComposition.jsx';
import { PRESETS, PRESET_KEYS, DEFAULT_PRESET_KEY } from '@/remotion/shortform/presets';
// Phase A-bis — Conversion Primitives SSOT + CTA registry
import {
  CHIP_SCHEMA,
  DEFAULT_SETTINGS,
  getChipCost,
  getRefineRoute,
  migrateSettings,
  validateSettings,
  formatCredit,
} from '@/lib/shortform/settings.js';
import { getCTAVariant } from '@/lib/shortform/cta-variants.js';
import {
  deriveSceneDurationsFromCharTimestamps,
  TAIL_PADDING_FRAMES,
  AUDIO_PREROLL_FRAMES,
  getAutoTransitionOverlapAt,
} from '@/lib/shortform/scene-timing.js';
import { DEFAULT_DESIGN_TOKENS } from '@/lib/shortform/design-tokens-shared.js';

// SceneRouter LAYOUT_REGISTRY 키와 동기화 — 잘못된 layoutType fallback용
const VALID_LAYOUT_TYPES = [
  'big-impact-text', 'bullet-list', 'comparison', 'emphasis-box', 'counter',
  'icon-label', 'progress-bar', 'small-label', 'subtitle-bar', 'vertical-bar',
  'venn-diagram', 'bar-chart', 'pie-chart', 'flow-diagram', 'comparison-chart',
  'network', 'strikethrough', 'number-slam',
];
import {
  SHORTFORM_FPS,
  SHORTFORM_WIDTH,
  SHORTFORM_HEIGHT,
} from '@/remotion/shortform/styles';
import StepProgress from '@/components/StepProgress';
import ProgressIndicator from '@/components/ProgressIndicator';
import Step1Input from './components/Step1Input';
import Step5VisualAccent from './components/Step5VisualAccent';
import Step6Preview from './components/Step6Preview';
import Step7Download from './components/Step7Download';
import {
  buildStep6ValueFromPreset,
  DEFAULT_SHORTFORM_PRESET,
  getShortformPreset,
} from '@/lib/shortform-presets';
import useProjectAutoSave from './hooks/useProjectAutoSave';
// Phase I — SSE 진행 표시 + 취소 + 백그라운드 모드
import { useJobProgress } from './hooks/useJobProgress';
// Phase K — 온보딩 위저드
import OnboardingModal from './components/OnboardingModal';
import { getSample, sampleToStep1Value } from '@/lib/shortform-samples';
import styles from './page.module.css';

// 실제로 publishProgress가 발행되는 단계만. video-analysis는 별도 /analyze
// 엔드포인트라 현재 script flow에서는 호출 안 되고, tts-synthesis/video-render는
// 아직 backend wire-up 전이라 늘 idle 상태로 보였음 → 사용자 혼란.
// 해당 단계가 실제로 발행되면 다시 추가할 것.
const PROGRESS_ACTIVE_STEPS = [
  'keyword-extraction',
  'youtube-search',
  'script-generation',
];

const SHORTFORM_JOB_STORAGE_KEY = 'shortform:activeJobId';

function generateClientJobId() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const STEP_LIST = [
  { id: 1, label: '입력' },
  { id: 2, label: '벤치마킹' },
  { id: 3, label: '대본' },
  { id: 4, label: '음성' },
  { id: 5, label: '비주얼' },
  { id: 6, label: '미리보기' },
  { id: 7, label: '다운로드' },
];

// Player는 클라이언트 전용 — dynamic import로 SSR 방지
const Player = dynamic(
  () => import('@remotion/player').then((mod) => mod.Player),
  { ssr: false },
);

const TONES = [
  { id: 'casual', label: '친근' },
  { id: 'professional', label: '전문가' },
];

const DURATIONS = [
  { sec: 30, label: '30초' },
  { sec: 45, label: '45초' },
  { sec: 60, label: '60초' },
  { sec: 90, label: '90초' },
];

// v2.1: 롱폼 옵션 (3/5/10분)
const LONGFORM_DURATIONS = [
  { sec: 180, label: '3분' },
  { sec: 300, label: '5분' },
  { sec: 600, label: '10분' },
];

// 크레딧 비용 테이블 — 미리보기/렌더 시 동일 사용
const CREDIT_COSTS = {
  shortform: { 30: 7, 45: 10, 60: 14, 90: 18 },
  longform: { 180: 7, 300: 12, 600: 22 },
};

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const tk = getToken();
  if (tk) h.Authorization = `Bearer ${tk}`;
  return h;
}

function formatSavedAt(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  const now = Date.now();
  const diffSec = Math.floor((now - d.getTime()) / 1000);
  if (diffSec < 5) return '방금';
  if (diffSec < 60) return `${diffSec}초 전`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Step 5 값 → 이미지 URL 배열로 병합
 * 우선순위: 사용자 사진 → AI 이미지
 * hook.imageUrl/body.imageUrl은 최대 2장까지 사용됨.
 */
function mergeShortformImages(step5) {
  if (!step5) return [];
  const userUrls = (step5.userPhotos || [])
    .map((p) => p?.image?.public_url)
    .filter(Boolean);
  const aiUrls = step5.aiImages || [];
  return [...userUrls, ...aiUrls];
}

/**
 * 스크립트 API 응답에서 shortform props로 변환
 *
 * script.scenes[] → hook (scene[0]) + body (scene[1..n-2]) + cta (scene[n-1])
 * script.hookText → hook.badge
 *
 * sceneImageOrder (Phase F): [{ sceneId: 'hook'|'body', imageUrl }] 형태로
 * 사용자가 지정한 씬별 이미지 우선 적용. 없으면 bodyImages 배열 순서대로 폴백.
 */
/**
 * TTS word timestamps에서 각 씬의 시작/종료 시간을 찾아 duration을 계산.
 * 실패하면 null 반환 → 호출자가 char count 비례 폴백 사용.
 *
 * wordTimestamps: [{ word: '안녕하세요', start: 0.0, end: 0.45 }, ...]
 * scenes: [{ script, ... }]
 *
 * 전략: 씬 텍스트를 순서대로 이어붙이고, 각 씬 끝 위치까지 누적 단어 수를 세어
 * 해당 단어의 end time을 씬 경계로 사용. Remotion fps로 프레임 환산.
 */
function deriveSceneDurationsFromWordTimestamps(scenes, wordTimestamps, fps) {
  if (!Array.isArray(wordTimestamps) || wordTimestamps.length === 0) return null;
  if (!Array.isArray(scenes) || scenes.length === 0) return null;

  // 각 씬의 "단어 수" 계산 (공백 분할)
  const sceneWordCounts = scenes.map(
    (s) => String(s?.script || '').trim().split(/\s+/).filter(Boolean).length,
  );
  const totalScriptWords = sceneWordCounts.reduce((a, b) => a + b, 0);
  if (totalScriptWords === 0) return null;

  // word timestamps가 텍스트와 정확히 매치되지 않을 수 있음 — 비율 기반 매핑.
  const totalWords = wordTimestamps.length;
  const durations = [];
  let prevEndSec = 0;
  let cumulativeScriptWords = 0;

  for (let i = 0; i < scenes.length; i++) {
    cumulativeScriptWords += sceneWordCounts[i];
    const targetWordIdx = Math.min(
      totalWords - 1,
      Math.round((cumulativeScriptWords / totalScriptWords) * totalWords) - 1,
    );
    const boundary = wordTimestamps[Math.max(0, targetWordIdx)];
    const endSec = boundary ? boundary.end : prevEndSec + 1;
    const durationSec = Math.max(endSec - prevEndSec, 1);
    durations.push(Math.max(Math.round(durationSec * fps), 30));
    prevEndSec = endSec;
  }

  return durations;
}

/**
 * Claude가 가끔 틀리는 외래어 표기 후처리. prompt.js에 규칙이 있어도
 * 대본 길이가 길면 일부 누락 — 런타임 방어.
 */
const TYPO_CORRECTIONS = [
  [/볼랙/g, '블랙'],
  [/발랙/g, '블랙'],
  [/그레(?![이])/g, '그레이'],
  [/네비이?/g, '네이비'],
  [/카키이/g, '카키'],
  [/배지(?![가-힣])/g, '베이지'],
  [/아이보리이/g, '아이보리'],
];
function correctTypos(text) {
  if (!text || typeof text !== 'string') return text;
  return TYPO_CORRECTIONS.reduce((acc, [re, sub]) => acc.replace(re, sub), text);
}

/**
 * 내레이션에서 화면 표시용 짧은 구문 추출.
 * Claude가 onScreenText를 안 줬거나 8자 제한을 어겼을 때 4단계 폴백.
 * 1순위: 숫자+단위 / 2순위: 따옴표 / 3순위: 첫 어절 2개 / 4순위: hard truncate.
 */
function extractKeyPhrase(narration, hardLimit = 15) {
  if (!narration || typeof narration !== 'string') return '';
  const text = narration.trim();
  const numMatch = text.match(/\d+(?:\.\d+)?(?:%|분|초|배|억|만|원|명|시간|년|쌍|개)/);
  if (numMatch) return numMatch[0];
  const quoteMatch = text.match(/["'「『]([^"'」』]{1,12})["'」』]/);
  if (quoteMatch) return quoteMatch[1];
  const words = text.split(/\s+/).slice(0, 2).join(' ');
  if (words.length <= hardLimit) return words;
  return words.slice(0, hardLimit - 1) + '…';
}

/** layoutProps 내부 string 필드 재귀적으로 오타 교정. */
function correctLayoutPropsTypos(obj) {
  if (obj == null) return obj;
  if (typeof obj === 'string') return correctTypos(obj);
  if (Array.isArray(obj)) return obj.map(correctLayoutPropsTypos);
  if (typeof obj === 'object') {
    const out = {};
    for (const k in obj) out[k] = correctLayoutPropsTypos(obj[k]);
    return out;
  }
  return obj;
}

function scriptToProps(script, presetKey, totalDurationSec, bodyImages, sceneImageOrder, mode = 'scene-sequence', wordTimestamps = null, settings = null, brandKit = null, charAlignment = null, designTokens = null) {
  const fps = SHORTFORM_FPS;
  const totalFrames = Math.round(totalDurationSec * fps);

  const scenes = Array.isArray(script?.scenes) ? script.scenes : [];
  const hookScene = scenes.find((s) => s.section === 'hook') || scenes[0] || {};
  const pointScenes = scenes.filter((s) => s.section === 'point');
  const ctaScene = scenes.find((s) => s.section === 'cta') || scenes[scenes.length - 1] || {};

  // ── Scene Sequence 모드 (Phase A 신규, 기본값) ──
  // script.scenes 전체를 1:1로 렌더. 씬 duration은 word timestamps 우선,
  // 없으면 글자수 비례. 이미지는 sceneImageOrder → bodyImages 순환 fallback.
  if (mode === 'scene-sequence') {
    const validScenes = scenes.filter((s) => s && typeof s.script === 'string' && s.script.trim());
    if (validScenes.length === 0) {
      return { preset: presetKey, mode: 'scene-sequence', scenes: [] };
    }

    // 1) Duration 계산 — charAlignment 우선 (글자 단위 정확), word timestamps fallback, 글자수 비례 최후 수단
    let sceneDurations = null;
    if (charAlignment?.characters?.length) {
      try {
        sceneDurations = deriveSceneDurationsFromCharTimestamps(charAlignment, validScenes, { fps });
      } catch (err) {
        console.warn('[scriptToProps] charTimestamps fallback:', err.message);
      }
    }
    if (!sceneDurations) {
      sceneDurations = deriveSceneDurationsFromWordTimestamps(validScenes, wordTimestamps, fps);
    }
    if (!sceneDurations) {
      const charCounts = validScenes.map((s) => s.script.replace(/\s+/g, '').length || 1);
      const totalChars = charCounts.reduce((a, b) => a + b, 0);
      sceneDurations = charCounts.map((c) =>
        Math.max(Math.round((c / totalChars) * totalFrames), 30),
      );
    }

    // Phase 2 (2026-04-18): scene duration + composition 길이 보정.
    //
    // 싱크 원리 — 각 씬 visual이 해당 씬 audio 시작 시간에 정확히 나타나게 하려면
    // 각 씬 duration = speech time + (이 씬 뒤 transition overlap) 이어야 한다.
    //
    // TransitionSeries가 씬 i와 i+1 사이에 overlap 프레임만큼 중첩시켜 composition을
    // 단축하므로, 각 씬 i의 duration에 getAutoTransitionOverlapAt(i, n)을 더하면
    // 씬 i visual 시작이 정확히 speech time[i]가 됨 (누적 lag 해소).
    //
    // 1) per-scene overlap 보정 — 싱크 정렬
    // 2) 마지막 씬에 AUDIO_PREROLL — 오디오가 frame 25에서 시작, 영상도 그만큼 여유
    // 3) 마지막 씬에 TAIL_PADDING — CTA 발화 꼬리(잔향/숨 포즈) 여유
    if (sceneDurations.length > 0) {
      sceneDurations = sceneDurations.map((d, i) => {
        return d + getAutoTransitionOverlapAt(i, sceneDurations.length);
      });
      sceneDurations[sceneDurations.length - 1] +=
        AUDIO_PREROLL_FRAMES + TAIL_PADDING_FRAMES;
    }

    // 2) 이미지 매핑 — sceneImageOrder 우선, 그 다음 bodyImages 순환
    const orderedImages = Array.isArray(sceneImageOrder) ? sceneImageOrder : [];
    const imgs = Array.isArray(bodyImages) ? bodyImages : [];
    function pickImage(idx, sceneObj) {
      // sceneImageOrder는 [{ sceneId: 'hook'|'body'|..., imageUrl }]
      const orderHit = orderedImages.find((o) => o?.imageUrl && (
        (o.sceneId === 'hook' && sceneObj.section === 'hook') ||
        (o.sceneId === 'body' && sceneObj.section === 'point' && idx === 1)
      ));
      if (orderHit) return orderHit.imageUrl;
      if (imgs.length === 0) return undefined;
      // 이미지 수 ≥ 씬 수: 순환 배정. 이미지 수 < 씬 수: 초과 씬은 텍스트 전용.
      // 2장으로 7씬 반복하면 단조로움 → 이미지 있는 씬/없는 씬 구분이 시각적 변화 생성.
      return idx < imgs.length ? imgs[idx] : undefined;
    }

    // Phase A-bis — CTA 변형 resolve (last scene 전용, settings.ctaTone 기반)
    const ctaTone = settings?.ctaTone === 'professional' ? 'professional' : 'casual';
    const ctaVariant = getCTAVariant(`save_follow_${ctaTone}`);

    const mappedScenes = validScenes.map((s, i) => {
      const isHook = s.section === 'hook' || i === 0;
      const isCta = s.section === 'cta' || i === validScenes.length - 1;
      const sectionKey = isHook ? 'hook' : isCta ? 'cta' : 'point';
      // onScreenText — Claude가 준 값 우선, 없거나 너무 길면 추출기 fallback.
      // 15자를 hard ceiling으로 고정 (컴포넌트 safe area 초과 방지).
      const rawOnScreen = typeof s.onScreenText === 'string' ? s.onScreenText.trim() : '';
      const onScreenTextRaw = rawOnScreen && rawOnScreen.length <= 15
        ? rawOnScreen
        : extractKeyPhrase(s.script, 15);
      const base = {
        text: correctTypos(onScreenTextRaw),     // 화면 표시용 짧은 구문 (≤15자) + 오타 교정
        narration: correctTypos(s.script),       // 음성/자막용 원본 + 오타 교정
        section: sectionKey,
        durationInFrames: sceneDurations[i],
        imageUrl: pickImage(i, s),
        badge: isHook ? (s.hookText || script?.hookText || 'STOP').slice(0, 12) : undefined,
        ctaButtonText: isCta ? '지금 시작 →' : undefined,
        layoutType: s.layoutType && VALID_LAYOUT_TYPES.includes(s.layoutType)
          ? s.layoutType
          : (() => { if (s.layoutType) console.warn(`[scriptToProps] unknown layoutType "${s.layoutType}" → null fallback`); return null; })(),
        layoutProps: s.layoutType && VALID_LAYOUT_TYPES.includes(s.layoutType)
          ? correctLayoutPropsTypos(s.layoutProps || null)
          : null,
      };
      // Phase A-bis — 마지막 씬에만 CTAVariantScene 입력 필드 첨부.
      // SceneSequenceComposition이 scene.ctaVariantProps 존재 여부로 분기.
      if (isCta && ctaVariant) {
        base.ctaVariantProps = { variant: ctaVariant.variant };
        base.ctaCopy = s.script || ctaVariant.copy;
        base.brandKit = brandKit;
      }
      return base;
    });

    return {
      preset: presetKey,
      mode: 'scene-sequence',
      scenes: mappedScenes,
      totalDurationInFrames: totalFrames,
      designTokens: designTokens || DEFAULT_DESIGN_TOKENS,
    };
  }

  // ── Slideshow 모드: 각 scene을 슬라이드로 변환 ──
  if (mode === 'slideshow') {
    // 모든 scene을 순서대로 슬라이드로 변환 (hook → points → cta)
    const orderedScenes = [];
    if (hookScene?.script) orderedScenes.push({ ...hookScene, _kind: 'hook' });
    pointScenes.forEach((s) => s?.script && orderedScenes.push({ ...s, _kind: 'point' }));
    if (ctaScene?.script && ctaScene !== hookScene) orderedScenes.push({ ...ctaScene, _kind: 'cta' });

    // 이미지 배열 (bodyImages = Step 5에서 받은 전체 이미지 리스트)
    const imgs = Array.isArray(bodyImages) ? bodyImages : [];

    const slides = orderedScenes.map((s, i) => ({
      imageUrl: i < imgs.length ? imgs[i] : undefined,
      text: s.script,
      badge: s._kind === 'hook' ? (s.hookText || 'STOP').slice(0, 12) : undefined,
      ctaButton: s._kind === 'cta' ? '지금 시작 →' : undefined,
    }));

    return {
      preset: presetKey,
      mode: 'slideshow',
      slides,
      totalDurationInFrames: totalFrames,
    };
  }

  // ── Kinetic 모드 (기존 3씬) ──
  // 3씬 비율: Hook 20%, Body 60%, CTA 20%
  const hookFrames = Math.round(totalFrames * 0.2);
  const ctaFrames = Math.round(totalFrames * 0.2);
  const bodyFrames = totalFrames - hookFrames - ctaFrames;

  const hookTitle = hookScene.script || script?.hook || '숏폼 영상';
  const hookBadge = hookScene.hookText || script?.hookText || 'STOP';
  // hookType(공감형/질문형 등)은 내부 분류 메타데이터라 시청자에게 노출 금지.
  // underlineText는 현재 사용하지 않음 (향후 필요시 별도 필드로 재정의).
  const underlineText = '';

  const pointTexts = pointScenes.map((s) => s.script).filter(Boolean);
  const bodyHeader = pointTexts[0] || script?.points?.[0] || '';
  // caption은 최대 2문장만 (줄바꿈 보존). 너무 길면 화면 가독성 ↓
  const captionSource = pointTexts.slice(1, 3).length > 0
    ? pointTexts.slice(1, 3)
    : (script?.points?.slice(1, 3) || []);
  const bodyCaption = captionSource.join('\n');

  const ctaText = ctaScene.script || script?.cta || '지금 시작하세요';

  // Phase F: sceneImageOrder 우선 → bodyImages 순서 폴백
  const orderedHook = sceneImageOrder?.find((s) => s.sceneId === 'hook')?.imageUrl;
  const orderedBody = sceneImageOrder?.find((s) => s.sceneId === 'body')?.imageUrl;
  const hookImage = orderedHook || bodyImages?.[0] || undefined;
  const bodyImage = orderedBody || bodyImages?.[1] || bodyImages?.[0] || undefined;

  // v2.1 — Claude가 내려준 scene.type / scene.typeProps 추출
  // 첫 번째 point scene을 body 씬 타입의 source로 사용
  const primaryPointScene = pointScenes[0] || {};
  const bodyType = primaryPointScene.type || 'text';
  const bodyTypeProps = primaryPointScene.typeProps || {};

  return {
    preset: presetKey,
    mode: 'kinetic',
    hook: {
      badge: hookBadge.slice(0, 12),
      title: hookTitle,
      underlineText: underlineText || undefined,
      imageUrl: hookImage,
      durationInFrames: hookFrames,
    },
    body: {
      header: bodyHeader,
      caption: bodyCaption,
      imageUrl: bodyImage,
      durationInFrames: bodyFrames,
      // v2.1 — type 라우팅
      type: bodyType,
      typeProps: bodyTypeProps,
    },
    cta: {
      headline: ctaText,
      buttonText: '지금 시작 →',
      subtext: '뚝딱툴',
      durationInFrames: ctaFrames,
    },
  };
}

/**
 * 영상 텍스트 인라인 편집기.
 * - hook (scene 0) / point (scene 1~n-2) / cta (scene n-1) 의 script 필드를 수정
 * - setScript로 즉시 script state 갱신 → playerProps useMemo → Player 재렌더
 * - originalScript가 있으면 "되돌리기" 버튼으로 원본 복원
 */
function ScriptTextEditor({ script, setScript, originalScript }) {
  if (!script || !Array.isArray(script.scenes)) return null;

  function updateSceneScript(index, newText) {
    const nextScenes = script.scenes.map((s, i) =>
      i === index ? { ...s, script: newText } : s,
    );
    setScript({ ...script, scenes: nextScenes });
  }

  function restoreOriginal() {
    if (originalScript) {
      setScript(JSON.parse(JSON.stringify(originalScript)));
    }
  }

  const hookScene = script.scenes[0];
  const ctaScene = script.scenes[script.scenes.length - 1];
  const pointScenes = script.scenes.slice(1, -1);

  const fieldStyle = {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #E5E7EB',
    borderRadius: 6,
    fontSize: 12,
    fontFamily: 'inherit',
    resize: 'vertical',
    lineHeight: 1.5,
    marginBottom: 10,
  };
  const labelStyle = {
    fontSize: 11,
    fontWeight: 700,
    color: '#6B7280',
    display: 'block',
    marginBottom: 4,
  };

  return (
    <div>
      {hookScene && (
        <div>
          <label style={labelStyle}>🎯 후킹 (첫 씬)</label>
          <textarea
            style={fieldStyle}
            rows={2}
            value={hookScene.script || ''}
            onChange={(e) => updateSceneScript(0, e.target.value)}
            placeholder="시청자의 시선을 멈추는 첫 문장"
          />
        </div>
      )}

      {pointScenes.map((scene, i) => (
        <div key={i + 1}>
          <label style={labelStyle}>📝 본문 {i + 1}</label>
          <textarea
            style={fieldStyle}
            rows={3}
            value={scene.script || ''}
            onChange={(e) => updateSceneScript(i + 1, e.target.value)}
            placeholder="본문 내용"
          />
        </div>
      ))}

      {ctaScene && script.scenes.length > 1 && (
        <div>
          <label style={labelStyle}>🔔 CTA (마무리)</label>
          <textarea
            style={fieldStyle}
            rows={2}
            value={ctaScene.script || ''}
            onChange={(e) => updateSceneScript(script.scenes.length - 1, e.target.value)}
            placeholder="행동 유도 문구"
          />
        </div>
      )}

      {originalScript && (
        <button
          type="button"
          onClick={restoreOriginal}
          style={{
            width: '100%',
            padding: '8px',
            background: 'transparent',
            border: '1px dashed #D1D5DB',
            borderRadius: 6,
            color: '#6B7280',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            marginTop: 4,
          }}
        >
          ↺ 원본으로 되돌리기
        </button>
      )}
    </div>
  );
}

/**
 * Phase A-bis — Q9 칩 5종 (category, firstThreeSeconds, scriptType, ctaTone, voiceSpeed).
 *
 * 원칙 (spec §4.11): 비즈니스 로직 금지, 마크업과 settings.js 호출만.
 * - 드롭다운/슬라이더 → onChange → 부모의 handleChipChange 호출
 * - 비용 배지 (cost 0 은 '무료 ✨', 그 외 formatCredit)
 * - disabled 시 refine 진행 중 (전부 비활성화)
 */
function Step3ChipRow({ settings, onChange, disabled, errorMessage, reasoning }) {
  const chips = Object.values(CHIP_SCHEMA); // 5종, Object key insertion 순서 = scan 우선순위

  const rowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  };
  const chipStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '8px 10px',
    background: disabled ? '#F3F4F6' : '#FAFAFA',
    border: '1px solid #E5E7EB',
    borderRadius: 8,
    fontSize: 11,
    flex: '1 1 140px',
    minWidth: 140,
    opacity: disabled ? 0.55 : 1,
  };
  const labelStyle = {
    fontWeight: 700,
    color: '#374151',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  };
  const selectStyle = {
    width: '100%',
    padding: '4px 6px',
    fontSize: 11,
    border: '1px solid #D1D5DB',
    borderRadius: 4,
    background: disabled ? '#E5E7EB' : 'white',
    color: '#111827',
  };
  const badgeStyle = (cost) => ({
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 10,
    background: cost === 0 ? '#DCFCE7' : '#FEF3C7',
    color: cost === 0 ? '#166534' : '#92400E',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  });

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 6 }}>
        AI 판정 + 세부 조정
      </div>
      <div style={rowStyle}>
        {chips.map((chip) => {
          const value = settings[chip.id];
          const cost = getChipCost(chip.id, value);
          const costLabel = cost === 0 ? '무료 ✨' : formatCredit(cost);
          const tip = reasoning?.[chip.id] || null;

          return (
            <label key={chip.id} style={chipStyle} title={tip || undefined}>
              <div style={labelStyle}>
                <span>{chip.label}</span>
                <span style={badgeStyle(cost)}>{costLabel}</span>
              </div>
              {chip.type === 'select' && (
                <select
                  style={selectStyle}
                  value={value}
                  disabled={disabled}
                  onChange={(e) => onChange(chip.id, e.target.value)}
                >
                  {chip.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              {chip.type === 'slider' && (
                <>
                  <input
                    type="range"
                    min={chip.min}
                    max={chip.max}
                    step={chip.step}
                    value={value}
                    disabled={disabled}
                    onChange={(e) => onChange(chip.id, Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                  <div style={{ fontSize: 10, color: '#6B7280', textAlign: 'right' }}>
                    x{Number(value).toFixed(2)}
                  </div>
                </>
              )}
            </label>
          );
        })}
      </div>
      {errorMessage && (
        <div
          style={{
            marginTop: 8,
            padding: '6px 10px',
            background: '#FEE2E2',
            color: '#991B1B',
            fontSize: 11,
            borderRadius: 6,
          }}
        >
          {errorMessage === 'invalid_settings' && '설정 형식 오류 — 다시 시도해주세요.'}
          {errorMessage === 'no_script' && '대본이 아직 없어요. 먼저 대본을 생성해주세요.'}
          {errorMessage === 'network' && '네트워크 오류 — 잠시 후 다시 시도해주세요.'}
          {errorMessage === 'refine_failed' && '부분 재생성에 실패했어요. 1~2분 후 다시 시도해주세요.'}
          {!['invalid_settings', 'no_script', 'network', 'refine_failed'].includes(errorMessage) && errorMessage}
        </div>
      )}
    </div>
  );
}

function Status({ status, label, meta }) {
  const dotClass =
    status === 'busy' ? styles.statusDotBusy
    : status === 'done' ? styles.statusDotDone
    : status === 'error' ? styles.statusDotError
    : styles.statusDotIdle;
  return (
    <div className={styles.statusRow}>
      <span className={`${styles.statusDot} ${dotClass}`} />
      <span className={styles.statusLabel}>{label}</span>
      {meta && <span className={styles.statusMeta}>{meta}</span>}
    </div>
  );
}

function ShortformClientInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get('projectId');
  const { user } = useAuth();

  // === Step 1 입력 통합 state (Phase A) ===
  const [currentStep, setCurrentStep] = useState(1);
  // v2.1: 콘텐츠 타입 (shortform | longform) — Step 1 최상단 토글
  const [contentType, setContentType] = useState('shortform');
  // Week 1: 비주얼 스타일 (image | kinetic) — Step 1 영상 타입 아래 토글
  const [layoutMode, setLayoutMode] = useState('image');
  const [step1Value, setStep1Value] = useState({
    contentMode: 'blog', // 'blog' | 'keyword'
    blogText: '',
    keywords: '',
    userExperience: '',
    persona: '',
    customPersonaLabel: '',
    tone: 'casual',
    durationSec: 45,
    // Phase A-bis — optional category override ('auto' = 서버 자동 감지)
    category: 'auto',
  });
  const [completedSteps, setCompletedSteps] = useState([]);

  // 입력 (역호환 레거시 state — runAll/generateScript 등에서 계속 사용)
  const [topic, setTopic] = useState('');
  const [memo, setMemo] = useState('');
  const [tone, setTone] = useState('casual');
  const [presetKey, setPresetKey] = useState(DEFAULT_PRESET_KEY);
  const [totalDurationSec, setTotalDurationSec] = useState(30);

  // 결과
  const [designTokens, setDesignTokens] = useState(null);
  const [script, setScript] = useState(null);
  // 원본 대본 (수정 전). ScriptTextEditor에서 "되돌리기" 버튼 용도.
  const [originalScript, setOriginalScript] = useState(null);
  const [images, setImages] = useState([]);
  const [audioUrl, setAudioUrl] = useState(null);
  const audioBlobRef = useRef(null); // Blob GC 방지 — URL.createObjectURL 수명 보존

  // 상태
  const [scriptStatus, setScriptStatus] = useState('idle');
  const [ttsStatus, setTtsStatus] = useState('idle');
  const [error, setError] = useState('');

  // Step 7: 렌더링 상태
  const [renderStatus, setRenderStatus] = useState('idle'); // idle | rendering | complete | error
  const [renderVideoUrl, setRenderVideoUrl] = useState(null);
  const [renderError, setRenderError] = useState(null);

  // Phase A-bis — Conversion Primitives
  // settings: Q9 칩 5종 (category, firstThreeSeconds, scriptType, ctaTone, voiceSpeed)
  // refineStatus: 'idle'|'busy' — 하나의 refine이 진행 중이면 모든 칩 비활성화 (spec §4.11 concurrency)
  // refineError: null | errCode — 칩 row 하단에 토스트로 표시
  // brandKit: null | { logoUrl, primaryColor, handle } — CTAVariantScene 폴백 3단계 입력
  const [settings, setSettings] = useState(() => migrateSettings(DEFAULT_SETTINGS));
  const [refineStatus, setRefineStatus] = useState('idle');
  const [refineError, setRefineError] = useState(null);
  const [brandKit, setBrandKit] = useState(null);
  // Phase G React hook 미정 — 일단 flag로 one-shot fetch 제어. 기본 off.
  // TODO: Phase G useBrandKit() 도입 시 이 블록 교체.
  const brandKitFetchEnabled = false;
  const [ttsVoice, setTtsVoice] = useState('21m00Tcm4TlvDq8ikWAM'); // Rachel (ElevenLabs)
  const [availableVoices, setAvailableVoices] = useState([]);
  const [previewAudio, setPreviewAudio] = useState({ voiceId: null, url: null, loading: false });

  // === Step 5 — 비주얼 액센트 (Phase E) ===
  const [step5Value, setStep5Value] = useState({
    userPhotos: [],    // [{ image, crop }]
    aiImageCount: 1,   // 0 | 1 | 2 (kinetic mode)
    aiImages: [],      // [url]
  });
  const [aiImageGenStatus, setAiImageGenStatus] = useState('idle');

  // === 영상 모드 ===
  // Phase A 신규: scene-sequence (기본) — 대본 씬 1:1 → Remotion Sequence
  // kinetic (레거시) — Hook/Body/CTA 3씬 강제
  // slideshow (레거시) — 각 씬을 이미지 슬라이드로
  const [videoMode, setVideoMode] = useState('scene-sequence');
  // Phase A: TTS word timestamps (ElevenLabs) — 씬 duration 정밀 동기용
  const [audioWordTimestamps, setAudioWordTimestamps] = useState(null);
  const [audioCharAlignment, setAudioCharAlignment] = useState(null);

  // === Step 6 — 미리보기 + 커스터마이징 (Phase F) ===
  const [step6Value, setStep6Value] = useState(() =>
    buildStep6ValueFromPreset(DEFAULT_SHORTFORM_PRESET),
  );

  // === Phase H: Draft 복원 state ===
  const [restoredProjectId, setRestoredProjectId] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');

  // === Phase H: 자동 저장 훅 활성화 (Phase C 훅 사용) ===
  const authTokenForSave = typeof window !== 'undefined'
    ? localStorage.getItem('ddukddak_token')
    : null;
  const autoSaveSnapshot = useMemo(() => ({
    current_step: currentStep,
    blog_text: step1Value.blogText || null,
    keywords: step1Value.keywords
      ? step1Value.keywords.split(',').map((k) => k.trim()).filter(Boolean)
      : null,
    user_experience: step1Value.userExperience || null,
    persona: step1Value.persona || null,
    tone: step1Value.tone || null,
    duration_sec: step1Value.durationSec || null,
    script_json: script || null,
    preset: presetKey || null,
  }), [currentStep, step1Value, script, presetKey]);

  const autoSave = useProjectAutoSave({
    authToken: authTokenForSave,
    enabled: !!(user && user.email),
    snapshot: autoSaveSnapshot,
    initialProjectId: restoredProjectId ? Number(restoredProjectId) : null,
    debounceMs: 1500,
  });

  // === Phase I: SSE 진행 상태 + 취소 + 백그라운드 모드 ===
  const [jobId, setJobId] = useState(null);
  const authTokenForProgress = typeof window !== 'undefined'
    ? localStorage.getItem('ddukddak_token')
    : null;
  const {
    steps: progressSteps,
    current: progressCurrent,
    status: progressStatus,
    error: progressError,
    cancel: cancelJob,
    reset: resetProgress,
  } = useJobProgress(jobId, { authToken: authTokenForProgress });

  // 페이지 진입 시 localStorage의 활성 jobId 복원
  useEffect(() => {
    try {
      const stored = typeof window !== 'undefined'
        ? localStorage.getItem(SHORTFORM_JOB_STORAGE_KEY)
        : null;
      if (stored) setJobId(stored);
    } catch {}
  }, []);

  // 음성 목록 fetch (ElevenLabs + Google 폴백)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/shortform-tts');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.voices)) {
            setAvailableVoices(data.voices);
            // 기본 음성이 목록에 없으면 첫 번째로 fallback
            if (!data.voices.some((v) => v.id === ttsVoice) && data.voices[0]) {
              setTtsVoice(data.voices[0].id);
            }
          }
        }
      } catch (err) {
        console.warn('[TTS] 음성 목록 fetch 실패:', err.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 음성 미리듣기 — preview=true로 서버 호출 (짧은 샘플 텍스트)
  async function previewVoice(voiceId) {
    if (previewAudio.loading) return;
    setPreviewAudio({ voiceId, url: null, loading: true });
    try {
      const res = await fetch('/api/shortform-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true, voiceId }),
      });
      if (!res.ok) throw new Error('미리듣기 실패');
      const contentType = res.headers.get('content-type') || '';
      let url;
      if (contentType.includes('audio/')) {
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
      } else {
        const data = await res.json();
        if (data.audioBase64) {
          const binary = atob(data.audioBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
        }
      }
      setPreviewAudio({ voiceId, url, loading: false });
    } catch (err) {
      console.warn('[TTS] 미리듣기 실패:', err.message);
      setPreviewAudio({ voiceId: null, url: null, loading: false });
    }
  }

  // jobId 변경 시 localStorage 동기화
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (jobId) {
        localStorage.setItem(SHORTFORM_JOB_STORAGE_KEY, jobId);
      }
    } catch {}
  }, [jobId]);

  // 완료/에러/취소 시 localStorage 정리 + 브라우저 알림
  useEffect(() => {
    if (
      progressStatus === 'complete'
      || progressStatus === 'cancelled'
      || progressStatus === 'error'
    ) {
      try {
        localStorage.removeItem(SHORTFORM_JOB_STORAGE_KEY);
      } catch {}
    }
    if (progressStatus === 'complete') {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          try {
            new Notification('숏폼 생성 완료', {
              body: '마이페이지에서 확인하실 수 있어요.',
            });
          } catch {}
        }
      }
    }
  }, [progressStatus]);

  // === Phase K: 온보딩 위저드 + 첫 영상 무료 ===
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isFreeFirst, setIsFreeFirst] = useState(false);

  // /me 조회 → onboardingCompleted=false면 모달 노출
  useEffect(() => {
    const tk = getToken();
    if (!tk) return;
    let cancelled = false;
    fetch('/api/auth?action=me', {
      headers: { Authorization: `Bearer ${tk}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.onboardingCompleted === false) {
          setShowOnboarding(true);
        }
        setIsFreeFirst(Boolean(data?.eligibleForFreeFirstShortform));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function postOnboardingCompleted(extra) {
    const tk = getToken();
    if (!tk) return;
    fetch('/api/auth/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
      body: JSON.stringify({ completed: true, ...(extra || {}) }),
    }).catch(() => {});
  }

  function handleSelectSample(sampleId) {
    const sample = getSample(sampleId);
    if (!sample) return;
    const next = sampleToStep1Value(sample);
    if (next) setStep1Value(next);
    setShowOnboarding(false);
    postOnboardingCompleted({ selectedSampleId: sampleId });
  }

  function handleSkipOnboarding() {
    setShowOnboarding(false);
    postOnboardingCompleted();
  }
  // === /Phase K ===

  // v2.1: contentType 변경 시 유효한 duration으로 리셋
  function handleContentTypeChange(next) {
    setContentType(next);
    setStep1Value((prev) => {
      const validDurations = next === 'longform' ? [180, 300, 600] : [30, 45, 60, 90];
      if (validDurations.includes(prev.durationSec)) return prev;
      return {
        ...prev,
        durationSec: next === 'longform' ? 180 : 45,
      };
    });
    // 레거시 state 동기화
    setTotalDurationSec(next === 'longform' ? 180 : 30);
  }

  // blog-writer 핸드오프 (Phase A: step1Value로 매핑)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('blogTextForShortform');
      if (raw) {
        localStorage.removeItem('blogTextForShortform');
        const data = JSON.parse(raw);
        // blogText(신규) → body(구 버전 호환) → topic(최후 폴백) 순으로 시도
        const fullBlog = data.blogText || data.body || data.topic || '';
        // 새 step1Value 기준으로 반영
        setStep1Value((prev) => ({
          ...prev,
          contentMode: 'blog',
          blogText: fullBlog,
          userExperience: data.memo || prev.userExperience,
        }));
        // 역호환 레거시 state도 유지
        if (data.topic) setTopic(data.topic);
        if (data.memo) setMemo(data.memo);
      }
    } catch (_) {}
  }, []);

  // blog-image-pro → 영상 페이지 핸드오프 (sessionStorage)
  // 이미지 생성기에서 "영상 만들러 가기" 누르면 topic/blogText를 sessionStorage에 담아옴
  const [handoffBanner, setHandoffBanner] = useState(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('video:handoff');
      if (!raw) return;
      const data = JSON.parse(raw);
      // 30분 이상 지난 핸드오프는 무시
      if (!data.ts || Date.now() - data.ts > 30 * 60 * 1000) {
        sessionStorage.removeItem('video:handoff');
        return;
      }
      sessionStorage.removeItem('video:handoff');

      const inferredTopic = data.topic || '';
      const fullBlog = data.blogText || '';
      setStep1Value((prev) => ({
        ...prev,
        contentMode: fullBlog ? 'blog' : 'keyword',
        blogText: fullBlog || prev.blogText,
        keywords: !fullBlog && inferredTopic ? inferredTopic : prev.keywords,
      }));
      if (inferredTopic) setTopic(inferredTopic);

      setHandoffBanner({
        source: data.source || 'blog-image-pro',
        imageCount: Number(data.imageCount) || 0,
      });
    } catch (_) {}
  }, []);

  // === Phase H: ?projectId 쿼리로 Draft 복원 ===
  useEffect(() => {
    if (!projectId) return;
    if (restoredProjectId === projectId) return;

    const token = typeof window !== 'undefined'
      ? localStorage.getItem('ddukddak_token')
      : null;
    if (!token) return;

    setRestoring(true);
    setRestoreError('');
    fetch(`/api/shortform-projects/${projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data || !data.project) {
          setRestoreError('프로젝트를 찾을 수 없습니다.');
          return;
        }
        const p = data.project;

        // Step 1 입력 복원 — step1Value 스키마로 역매핑
        setStep1Value((prev) => ({
          ...prev,
          contentMode: p.blog_text ? 'blog' : (p.keywords ? 'keyword' : prev.contentMode),
          blogText: p.blog_text || prev.blogText,
          keywords: Array.isArray(p.keywords)
            ? p.keywords.join(', ')
            : (p.keywords || prev.keywords),
          userExperience: p.user_experience || prev.userExperience,
          persona: p.persona || prev.persona,
          tone: p.tone || prev.tone,
          durationSec: p.duration_sec || prev.durationSec,
        }));

        // 역호환 레거시 state
        if (p.blog_text || p.keywords) {
          setTopic(
            p.blog_text ? p.blog_text.slice(0, 100)
            : Array.isArray(p.keywords) ? p.keywords.join(', ')
            : (p.keywords || ''),
          );
        }
        if (p.user_experience) setMemo(p.user_experience);
        if (p.tone) setTone(p.tone === 'casual' ? 'casual' : 'professional');
        if (p.duration_sec) setTotalDurationSec(p.duration_sec);

        // Step 3 대본 복원
        if (p.script_json) {
          setScript(p.script_json);
          // Draft 복원 시 원본은 복원 데이터로 설정 (사용자 수정 이력은 손실됨)
          setOriginalScript(JSON.parse(JSON.stringify(p.script_json)));
          setScriptStatus('done');
        }

        // Step 6 프리셋 복원
        if (p.preset) setPresetKey(p.preset);

        // 완료된 단계 배지 (current_step 미만은 전부 completed로 마킹)
        if (p.current_step && p.current_step > 1) {
          const completed = [];
          for (let i = 1; i < p.current_step; i += 1) completed.push(i);
          setCompletedSteps(completed);
          setCurrentStep(p.current_step);
        }

        setRestoredProjectId(projectId);
      })
      .catch((err) => {
        setRestoreError(err?.message || '복원에 실패했습니다.');
      })
      .finally(() => {
        setRestoring(false);
      });
  }, [projectId, restoredProjectId]);

  // Phase A-bis — brandKit one-shot fetch (flag로 gate).
  // Phase G useBrandKit hook이 도입되면 이 블록 교체.
  useEffect(() => {
    if (!brandKitFetchEnabled) return;
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    fetch('/api/brand-kit', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        // 정상 응답 shape: { logoUrl, primaryColor, handle } 중 존재하는 것만.
        setBrandKit({
          logoUrl: data.logoUrl || null,
          primaryColor: data.primaryColor || null,
          handle: data.handle || null,
        });
      })
      .catch(() => {
        // 실패 시 null 유지 → CTAVariantScene 폴백 3단계 타게 됨. 조용히 무시.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Phase A-bis — 칩 변경 dispatcher.
  // inline (route === null): 로컬 state만, 크레딧 0
  // refine-route: /api/shortform-script/refine 호출 + 크레딧 차감
  async function handleChipChange(chipId, newValue) {
    setRefineError(null);

    const nextSettings = { ...settings, [chipId]: newValue };
    const validation = validateSettings(nextSettings);
    if (!validation.ok) {
      setRefineError('invalid_settings');
      return;
    }

    const route = getRefineRoute(chipId);

    // Inline — ctaTone, voiceSpeed (cost 0)
    if (route === null) {
      setSettings(nextSettings);
      return;
    }

    // Refine-route — category-refine, script-type-refine, first-three-refine
    if (!script) {
      setRefineError('no_script');
      return;
    }

    setRefineStatus('busy');
    try {
      const requestId = generateClientJobId();
      const res = await fetch('/api/shortform-script/refine', {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'X-Request-Id': requestId,
        },
        body: JSON.stringify({
          originalScript: script,
          field: chipId,
          newValue,
          settings: nextSettings,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRefineError(data?.error || 'refine_failed');
        return;
      }
      if (data.updatedScript) {
        setScript(data.updatedScript);
      }
      setSettings(nextSettings);
    } catch (err) {
      setRefineError(err?.name === 'AbortError' ? 'aborted' : 'network');
    } finally {
      setRefineStatus('idle');
    }
  }

  // Step 1 → 2 이동: step1Value를 레거시 state로 매핑하여 역호환 유지
  function handleStep1Next() {
    setTopic(step1Value.contentMode === 'keyword' ? step1Value.keywords : (step1Value.blogText.slice(0, 100) || ''));
    setMemo(step1Value.userExperience);
    setTone(step1Value.tone === 'casual' ? 'casual' : 'professional');
    setTotalDurationSec(step1Value.durationSec);

    setCompletedSteps((prev) => Array.from(new Set([...prev, 1])));
    setCurrentStep(2);
  }

  function handleStepClick(stepNum) {
    setCurrentStep(stepNum);
  }

  // Step 5 사진(사용자 + AI)을 bodyImages로 병합 (Phase E)
  const mergedImages = useMemo(
    () => mergeShortformImages(step5Value),
    [step5Value],
  );

  // 미리보기 props + duration 계산
  // Phase F: step6Value.sceneImageOrder를 scriptToProps에 전달
  // Phase A: audioWordTimestamps 전달 → scene-sequence 모드에서 TTS 정밀 동기
  // scriptToProps는 settings에서 ctaTone만 읽으므로 의존성을 ctaTone으로 좁혀
  // 다른 settings 필드 변경(e.g. firstThreeSeconds) 때 불필요한 재계산 방지.
  const ctaTone = settings?.ctaTone;
  const playerProps = useMemo(() => {
    if (!script) return null;
    const bodyImages = mergedImages.length > 0 ? mergedImages : images;
    return scriptToProps(
      script,
      presetKey,
      totalDurationSec,
      bodyImages,
      step6Value?.sceneImageOrder,
      videoMode,
      audioWordTimestamps,
      { ctaTone },
      brandKit,
      audioCharAlignment,
      designTokens,
    );
  }, [script, presetKey, totalDurationSec, images, mergedImages, step6Value?.sceneImageOrder, videoMode, audioWordTimestamps, ctaTone, brandKit, audioCharAlignment, designTokens]);

  const playerDurationInFrames = useMemo(() => {
    if (!playerProps) return totalDurationSec * SHORTFORM_FPS;
    const { durationInFrames } = buildShortformTimeline(playerProps);
    return durationInFrames;
  }, [playerProps, totalDurationSec]);

  const audioInputProps = useMemo(() => {
    if (!playerProps) return null;
    return {
      ...playerProps,
      audio: audioUrl ? { url: audioUrl, durationInFrames: playerDurationInFrames } : undefined,
    };
  }, [playerProps, audioUrl, playerDurationInFrames]);

  // Step 7: 서버 렌더링 요청
  async function handleRender() {
    const token = getToken();
    if (!token) {
      alert('로그인이 필요합니다.');
      router.push('/login');
      return;
    }
    if (!audioInputProps) return;

    setRenderStatus('rendering');
    setRenderError(null);

    try {
      const res = await fetch('/api/shortform-render', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          jobId: jobId || generateClientJobId(),
          inputProps: audioInputProps,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setRenderStatus('error');
        setRenderError(data.error || '렌더링에 실패했습니다.');
        return;
      }

      setRenderVideoUrl(data.url);
      setRenderStatus('complete');
    } catch (err) {
      console.error('[handleRender]', err);
      setRenderStatus('error');
      setRenderError('네트워크 오류가 발생했습니다.');
    }
  }

  async function generateScript() {
    setError('');
    if (!topic.trim() && !memo.trim()) {
      setError('주제 또는 메모를 입력해주세요.');
      return;
    }
    const token = getToken();
    if (!token) {
      alert('로그인이 필요합니다.');
      router.push('/login');
      return;
    }

    setScriptStatus('busy');
    setScript(null);

    // Phase I: SSE 진행 구독을 위한 jobId 발급
    resetProgress();
    const newJobId = generateClientJobId();
    setJobId(newJobId);

    try {
      const res = await fetch('/api/shortform-script', {
        method: 'POST',
        headers: {
          ...authHeaders(),
          // Phase A-bis §6.1 idempotency — jobId = X-Request-Id (retry는 같은 ID)
          'X-Request-Id': newJobId,
        },
        body: JSON.stringify({
          jobId: newJobId,
          topic,
          blogText: '',
          personaMemo: memo,
          tone,
          // v2.1: contentType + 롱폼 duration 지원
          contentType,
          targetDurationSec: totalDurationSec,
          concept: 'cinematic',
          // Phase A-bis — Step 1 category override (null 또는 'auto' 이면 서버가 자동 감지)
          category: step1Value.category && step1Value.category !== 'auto' ? step1Value.category : undefined,
          visualStyle: layoutMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '대본 생성 실패');
      setScript(data.script);
      // 원본 대본 저장 (ScriptTextEditor 되돌리기 버튼 용도)
      setOriginalScript(JSON.parse(JSON.stringify(data.script)));
      // designTokens — 서버가 카테고리별 토큰 내려주면 state 갱신, 없으면 null (DEFAULT fallback)
      if (data.designTokens && typeof data.designTokens === 'object') {
        setDesignTokens(data.designTokens);
      }
      // Phase A-bis — 서버가 settings 내려주면 migrateSettings로 병합 후 state 갱신.
      // 없으면 DEFAULT_SETTINGS 유지 (역호환).
      if (data.settings && typeof data.settings === 'object') {
        setSettings(migrateSettings(data.settings));
      }
      setScriptStatus('done');
      // 대본 완료 → 입력(1) + 벤치마킹(2) + 대본(3) 단계 마킹
      setCompletedSteps((prev) => Array.from(new Set([...prev, 1, 2, 3])));
      // Phase K: 첫 영상 무료 적용됐으면 배너 숨김 (Agent D 가 응답에
      // freeFirstApplied 포함하도록 wire-up 한 뒤에만 동작)
      if (data.freeFirstApplied) {
        setIsFreeFirst(false);
      }
    } catch (err) {
      setError(err.message || '대본 생성 중 오류');
      setScriptStatus('error');
    }
  }


  /**
   * Step 5 — AI 이미지 생성 핸들러 (Phase E)
   * 기존 generateImages()와 달리 count 지정 가능 + Promise<string[]> 반환.
   * runAll() 보조 모드는 영향 없음 — 기존 generateImages()를 그대로 사용.
   */
  async function generateAiImagesForStep5(count) {
    setAiImageGenStatus('busy');
    try {
      const token = getToken();
      if (!token) {
        alert('로그인이 필요합니다.');
        router.push('/login');
        setAiImageGenStatus('error');
        return [];
      }
      // step1Value가 있으면 그쪽 주제를 우선 사용, 없으면 레거시 topic state
      const step1Topic = step1Value?.contentMode === 'keyword'
        ? (step1Value?.keywords || '')
        : (step1Value?.blogText || '').slice(0, 100);
      const effectiveTopic = step1Topic || topic || '';
      if (!effectiveTopic.trim()) {
        setError('주제가 없어 AI 이미지를 생성할 수 없어요. Step 1에서 입력해주세요.');
        setAiImageGenStatus('error');
        return [];
      }
      // shortform_quick: count(1~2)만큼만 생성, 1 credit/장, user-images 보관함 자동 등록
      const res = await fetch('/api/blog-image-pro', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          mode: 'shortform_quick',
          count,
          topic: effectiveTopic,
          mood: 'emotional',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '이미지 생성 실패');
      const urls = (data.images || [])
        .map((img) => img.public_url)
        .filter(Boolean);
      setAiImageGenStatus('done');
      return urls;
    } catch (err) {
      setError(err.message || '이미지 생성 중 오류');
      setAiImageGenStatus('error');
      return [];
    }
  }

  async function generateTts() {
    setError('');
    if (!script) {
      setError('먼저 대본을 생성해주세요.');
      return;
    }
    setTtsStatus('busy');
    setAudioUrl(null);
    try {
      // 전체 대본을 한 번에 TTS. 편집한 내용 반영.
      // scene.script만 사용 (hookText/type 등 메타데이터는 TTS 대상 아님).
      // filter(Boolean) 제거 — 빈 scene도 포함해서 CTA 누락 방지.
      // (ScriptTextEditor에서 편집 시 script.fullScript는 stale이므로 무시하고
      //  현재 scenes만 조합.)
      const scenesArr = Array.isArray(script.scenes) ? script.scenes : [];
      const sceneTexts = scenesArr.map((s) => (s?.script || '').trim());
      const text = sceneTexts.filter(Boolean).join(' ');

      // 디버그: 각 씬의 section + script 길이 로깅
      console.log(
        `[TTS] 총 ${scenesArr.length}씬, 최종 텍스트 ${text.length}자:`,
        scenesArr.map((s, i) => `[${i}]${s?.section || '?'}(${(s?.script || '').length}자)`).join(' → '),
      );

      if (text.length > 4500) {
        throw new Error(
          `대본이 너무 길어요 (${text.length}자). 최대 5000자까지 지원합니다. ` +
          `대본 편집기에서 본문 일부를 줄여주세요.`
        );
      }
      if (text.length === 0) {
        throw new Error('대본이 비어 있습니다. 먼저 대본을 생성하거나 편집기에서 내용을 입력해주세요.');
      }

      const res = await fetch('/api/shortform-tts', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ text, voiceId: ttsVoice }),
      });
      if (!res.ok) {
        // 서버 에러 상세 추출 (JSON 또는 text)
        let errMsg = `TTS 생성 실패 (HTTP ${res.status})`;
        try {
          const errData = await res.json();
          if (errData.error) errMsg = errData.error;
          console.error('[TTS] 서버 에러 상세:', errData);
        } catch (_) {
          try {
            const errText = await res.text();
            console.error('[TTS] 서버 에러 raw:', errText);
            if (errText) errMsg = errText.slice(0, 300);
          } catch (_) {}
        }
        throw new Error(errMsg);
      }
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        // non-preview: 서버가 R2 업로드 후 audioUrl(HTTPS) 반환
        // Railway 렌더 서버가 다운로드할 수 있도록 blob:// 절대 금지.
        const data = await res.json();
        if (!data.audioUrl) {
          throw new Error('TTS 응답에 audioUrl이 없습니다.');
        }
        audioBlobRef.current = null;
        setAudioUrl(data.audioUrl);
        setAudioWordTimestamps(Array.isArray(data.wordTimestamps) ? data.wordTimestamps : null);
        setAudioCharAlignment(data.charAlignment || null);
      } else {
        // binary (preview만 해당 — 실제로 여기 오면 과거 백엔드와 호환 목적)
        const blob = await res.blob();
        audioBlobRef.current = blob;
        setAudioUrl(URL.createObjectURL(blob));
        setAudioWordTimestamps(null);
        setAudioCharAlignment(null);
      }
      setTtsStatus('done');
      // TTS 완료 → 음성(4) + 비주얼(5) 단계 마킹
      setCompletedSteps((prev) => Array.from(new Set([...prev, 4, 5])));
    } catch (err) {
      console.error('[TTS] 최종 에러:', err);
      setError(err.message || 'TTS 중 오류');
      setTtsStatus('error');
    }
  }

  async function runAll() {
    await generateScript();
    await generateTts();
    // generateScript → [1,2,3], generateTts → [4,5] 이미 마킹됨. 미리보기 이동만.
    setCurrentStep(6);
  }

  const hasPreview = !!audioInputProps;

  return (
    <main className={styles.root}>
      {/* Phase K: 첫 방문 온보딩 모달 */}
      <OnboardingModal
        open={showOnboarding}
        onSelectSample={handleSelectSample}
        onSkip={handleSkipOnboarding}
      />

      <div className={styles.hero}>
        <div className={styles.heroBadge}>NEW · 숏폼</div>
        <h1>릴스·쇼츠를<br /><em>5분 만에 뚝딱</em></h1>
        <p>주제만 입력하면 AI 대본 + TTS 음성으로<br />프리미엄 숏폼 영상을 자동 생성합니다</p>
      </div>

      {/* Phase H: Draft 복원 배너 */}
      {restoring && (
        <div className={styles.restoreBanner}>
          작업 중이던 프로젝트를 불러오는 중...
        </div>
      )}
      {restoreError && (
        <div className={styles.restoreBannerError}>
          <span>{restoreError}</span>
          <a href="/shortform" className={styles.restoreBannerLink}>
            새로 시작
          </a>
        </div>
      )}
      {restoredProjectId && !restoring && !restoreError && (
        <div className={styles.restoreBannerSuccess}>
          작업 중이던 프로젝트를 이어서 작업합니다 (Step {currentStep})
        </div>
      )}

      {/* Phase K: 첫 영상 무료 배너 (가입 7일 이내 & 첫 숏폼 미생성) */}
      {isFreeFirst && !showOnboarding && (
        <div className={styles.freeFirstBanner}>
          첫 영상은 무료에요. 지금 바로 만들어보세요.
        </div>
      )}

      {/* 크로스 프로덕트 핸드오프 배너 — blog-image-pro에서 넘어온 경우 */}
      {handoffBanner && !showOnboarding && (
        <div
          style={{
            margin: '8px 0 16px',
            padding: '14px 18px',
            borderRadius: 12,
            border: '1px solid rgba(255, 95, 31, 0.3)',
            background: 'linear-gradient(135deg, rgba(255, 95, 31, 0.06), rgba(255, 95, 31, 0.12))',
            display: 'flex',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 22 }}>🎬</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ds-text, #1F2937)', marginBottom: 2 }}>
              방금 만든 이미지로 영상을 만들어볼까요?
            </div>
            <div style={{ fontSize: 11, color: 'var(--ds-muted, #77736B)', lineHeight: 1.5 }}>
              주제가 미리 입력됐어요.
              {handoffBanner.imageCount > 0 && ` 보관함에 ${handoffBanner.imageCount}장이 저장되어 있으니 Step 5에서 바로 선택할 수 있어요.`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setHandoffBanner(null)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 18,
              cursor: 'pointer',
              color: 'var(--ds-muted, #77736B)',
              padding: 4,
              lineHeight: 1,
            }}
            aria-label="닫기"
          >
            ×
          </button>
        </div>
      )}

      {/* Phase A: StepProgress + 자동 저장 상태 */}
      <div className={styles.stepProgressWrap}>
        <StepProgress
          steps={STEP_LIST}
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={handleStepClick}
        />
        {user && user.email && (
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              color: 'var(--ds-muted, #77736B)',
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {autoSave.error
              ? <span style={{ color: '#DC2626' }}>⚠ 저장 실패: {autoSave.error}</span>
              : autoSave.isSaving
                ? '저장 중…'
                : autoSave.lastSavedAt
                  ? `✓ 저장됨 ${formatSavedAt(autoSave.lastSavedAt)}`
                  : '입력하면 자동 저장됩니다'}
          </div>
        )}
        {!(user && user.email) && (
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              color: 'var(--ds-muted, #77736B)',
              textAlign: 'right',
            }}
          >
            로그인하면 작업이 자동 저장됩니다
          </div>
        )}
      </div>

      {/* Phase I: SSE 실시간 진행 표시 + 취소 */}
      {jobId && progressStatus !== 'idle' && (
        <div className={styles.progressIndicatorWrap}>
          <ProgressIndicator
            activeSteps={PROGRESS_ACTIVE_STEPS}
            progress={progressSteps}
            current={progressCurrent}
            status={progressStatus}
            error={progressError}
            onCancel={cancelJob}
          />
        </div>
      )}

      {/* Step 1: 새 입력 폼 */}
      {currentStep === 1 && (
        <div className={styles.stepContainer}>
          {/* v2.1: 콘텐츠 타입 토글 (숏폼 vs 롱폼) */}
          <div
            style={{
              marginBottom: 20,
              padding: '16px 20px',
              background: 'var(--ds-bg-soft, #F4F2EC)',
              border: '1px solid var(--ds-border, #ECE9E2)',
              borderRadius: 12,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                marginBottom: 10,
                color: 'var(--ds-text, #1F2937)',
              }}
            >
              영상 타입
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => handleContentTypeChange('shortform')}
                style={{
                  flex: 1,
                  padding: '14px 16px',
                  borderRadius: 10,
                  border:
                    contentType === 'shortform'
                      ? '2px solid var(--ds-accent, #F95A1F)'
                      : '1.5px solid var(--ds-border, #E5E7EB)',
                  background:
                    contentType === 'shortform' ? 'rgba(255, 95, 31, 0.06)' : '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                  🎬 숏폼 (30~90초)
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--ds-muted, #77736B)',
                    lineHeight: 1.4,
                  }}
                >
                  릴스·쇼츠·틱톡. 후킹 + 공감 루프 3씬.
                </div>
                <div style={{ fontSize: 11, marginTop: 6, color: 'var(--ds-muted, #77736B)' }}>
                  6~12 크레딧
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleContentTypeChange('longform')}
                style={{
                  flex: 1,
                  padding: '14px 16px',
                  borderRadius: 10,
                  border:
                    contentType === 'longform'
                      ? '2px solid var(--ds-accent, #F95A1F)'
                      : '1.5px solid var(--ds-border, #E5E7EB)',
                  background:
                    contentType === 'longform' ? 'rgba(255, 95, 31, 0.06)' : '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                  🎞 롱폼 (3~10분)
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--ds-muted, #77736B)',
                    lineHeight: 1.4,
                  }}
                >
                  유튜브 본편. Hook/Body×4/Conclusion/CTA 7씬.
                </div>
                <div style={{ fontSize: 11, marginTop: 6, color: 'var(--ds-muted, #77736B)' }}>
                  12~29 크레딧
                </div>
              </button>
            </div>
          </div>

          {/* Week 1: 비주얼 스타일 토글 (이미지형 / 텍스트형) */}
          <div
            style={{
              marginBottom: 20,
              padding: '16px 20px',
              background: 'var(--ds-bg-soft, #F4F2EC)',
              border: '1px solid var(--ds-border, #ECE9E2)',
              borderRadius: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--ds-text, #1F2937)' }}>
              비주얼 스타일
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setLayoutMode('image')}
                style={{
                  flex: 1, padding: '14px 16px', borderRadius: 10,
                  border: layoutMode === 'image' ? '2px solid #ff6f61' : '1.5px solid var(--ds-border, #E5E7EB)',
                  background: layoutMode === 'image' ? 'rgba(255, 111, 97, 0.06)' : '#fff',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>📸 이미지형</div>
                <div style={{ fontSize: 11, color: 'var(--ds-muted, #77736B)', lineHeight: 1.4 }}>
                  AI 이미지 + 자막 슬라이드
                </div>
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('kinetic')}
                style={{
                  flex: 1, padding: '14px 16px', borderRadius: 10,
                  border: layoutMode === 'kinetic' ? '2px solid #ff6f61' : '1.5px solid var(--ds-border, #E5E7EB)',
                  background: layoutMode === 'kinetic' ? 'rgba(255, 111, 97, 0.06)' : '#fff',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>✍️ 텍스트형</div>
                <div style={{ fontSize: 11, color: 'var(--ds-muted, #77736B)', lineHeight: 1.4 }}>
                  키네틱 타이포 + 데이터 시각화
                </div>
              </button>
            </div>
          </div>

          <Step1Input
            value={step1Value}
            onChange={setStep1Value}
            onNext={handleStep1Next}
            contentType={contentType}
          />
        </div>
      )}

      {/* Step 5: 비주얼 액센트 (Phase E) */}
      {currentStep === 5 && (
        <div className={styles.stepContainer}>
          {/* 영상 모드 선택 */}
          <div style={{
            marginBottom: 24,
            padding: '16px 20px',
            background: 'var(--ds-bg-soft, #F4F2EC)',
            border: '1px solid var(--ds-border, #ECE9E2)',
            borderRadius: 12,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--ds-text, #1F2937)' }}>
              영상 모드
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <button
                type="button"
                onClick={() => setVideoMode('scene-sequence')}
                style={{
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: videoMode === 'scene-sequence' ? '2px solid var(--ds-accent, #F95A1F)' : '1.5px solid var(--ds-border, #E5E7EB)',
                  background: videoMode === 'scene-sequence' ? 'rgba(255, 95, 31, 0.06)' : '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  🎬 씬 시퀀스 (기본)
                  <span style={{ fontSize: 9, padding: '1px 5px', background: 'var(--ds-accent, #F95A1F)', color: '#fff', borderRadius: 3, marginLeft: 4, verticalAlign: 'middle' }}>NEW</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ds-muted, #77736B)', lineHeight: 1.4 }}>
                  대본 씬 수만큼 화면 전환. 바이럴 숏폼 리듬.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setVideoMode('kinetic')}
                style={{
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: videoMode === 'kinetic' ? '2px solid var(--ds-accent, #F95A1F)' : '1.5px solid var(--ds-border, #E5E7EB)',
                  background: videoMode === 'kinetic' ? 'rgba(255, 95, 31, 0.06)' : '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>🎨 키네틱 3씬</div>
                <div style={{ fontSize: 11, color: 'var(--ds-muted, #77736B)', lineHeight: 1.4 }}>
                  Hook/Body/CTA 3씬 전통 구조. 이미지 최대 2장.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setVideoMode('slideshow')}
                style={{
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: videoMode === 'slideshow' ? '2px solid var(--ds-accent, #F95A1F)' : '1.5px solid var(--ds-border, #E5E7EB)',
                  background: videoMode === 'slideshow' ? 'rgba(255, 95, 31, 0.06)' : '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>📸 슬라이드쇼</div>
                <div style={{ fontSize: 11, color: 'var(--ds-muted, #77736B)', lineHeight: 1.4 }}>
                  각 씬마다 1장. 매장·메뉴 소개.
                </div>
              </button>
            </div>
          </div>

          <Step5VisualAccent
            value={step5Value}
            onChange={setStep5Value}
            onGenerateAI={generateAiImagesForStep5}
            aiStatus={aiImageGenStatus}
            onBack={() => setCurrentStep(4)}
            onNext={() => setCurrentStep(6)}
            videoMode={videoMode}
          />
        </div>
      )}

      {/* Step 6: 미리보기 + 커스터마이징 (Phase F) */}
      {currentStep === 6 && (
        <div className={styles.stepContainer}>
          <Step6Preview
            value={step6Value}
            onChange={(next) => {
              setStep6Value(next);
              // 상위 프리셋이 바뀌면 레거시 presetKey도 동기화 (하위 컬러 프리셋)
              if (next?.presetKey) {
                const upper = getShortformPreset(next.presetKey);
                if (upper?.colorPreset && upper.colorPreset !== presetKey) {
                  setPresetKey(upper.colorPreset);
                }
              }
            }}
            playerProps={playerProps}
            audioUrl={audioUrl}
            playerDurationInFrames={playerDurationInFrames}
            mergedImages={mergedImages}
            /* Phase B가 도달하기 전까지는 undefined — 배너 자동 숨김 */
            benchmarkAggregated={undefined}
            onBack={() => setCurrentStep(5)}
            onNext={() => {
              setCompletedSteps((prev) => Array.from(new Set([...prev, 6])));
              setCurrentStep(7);
            }}
          />
        </div>
      )}

      {/* Step 7: 렌더링 + 다운로드 */}
      {currentStep === 7 && (
        <Step7Download
          videoUrl={renderVideoUrl}
          onRender={handleRender}
          renderStatus={renderStatus}
          renderError={renderError}
          onBack={() => setCurrentStep(6)}
          onReset={() => {
            setCurrentStep(1);
            setScript(null);
            setAudioUrl(null);
            audioBlobRef.current = null;
            setRenderStatus('idle');
            setRenderVideoUrl(null);
            setRenderError(null);
          }}
        />
      )}

      {/* Step 2~4: 기존 UI를 임시 유지 (Phase B/C/D에서 단계별 교체) */}
      {currentStep >= 2 && currentStep !== 5 && currentStep !== 6 && currentStep !== 7 && (
      <div className={styles.layout}>
        <div className={styles.left}>
          <div className={styles.card}>
            <div className={styles.cardLabel}>입력</div>
            <div style={{ marginBottom: 12 }}>
              <label className={styles.label}>주제 / 소재</label>
              <input
                type="text"
                className={styles.inputField}
                placeholder="예: 카페 창업 비용, 웨딩 플래너 19년차 노하우"
                maxLength={100}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className={styles.label}>내 경험·느낌 <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(선택)</span></label>
              <textarea
                className={styles.textareaField}
                placeholder="짧게 적어도 됩니다. 예: 15년차 헤어 디자이너, 손님이 '여기 물 맛있다'고 했을 때 뿌듯했음"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label className={styles.label}>영상 길이</label>
              <div className={styles.durationBtns}>
                {DURATIONS.map((d) => (
                  <button
                    key={d.sec}
                    type="button"
                    className={`${styles.durationBtn} ${totalDurationSec === d.sec ? styles.durationBtnActive : ''}`}
                    onClick={() => setTotalDurationSec(d.sec)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label className={styles.label}>톤</label>
              <div className={styles.toneBtns}>
                {TONES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`${styles.toneBtn} ${tone === t.id ? styles.toneBtnActive : ''}`}
                    onClick={() => setTone(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={styles.label}>디자인 프리셋</label>
              <div className={styles.presetGrid}>
                {PRESET_KEYS.map((key) => {
                  const preset = PRESETS[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`${styles.presetChip} ${presetKey === key ? styles.presetChipActive : ''}`}
                      onClick={() => setPresetKey(key)}
                    >
                      <span
                        className={styles.presetPreview}
                        style={{
                          background: `linear-gradient(135deg, ${preset.colors.bgBase} 0%, ${preset.colors.bgSecondary} 50%, ${preset.colors.bgTertiary} 100%)`,
                          borderBottom: `3px solid ${preset.colors.accent}`,
                        }}
                      />
                      {preset.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardLabel}>생성 단계</div>
            <div className={styles.statusList}>
              <Status
                status={scriptStatus}
                label="1. Opus 4.6 대본"
                meta={script ? `${script.scenes?.length || 0}씬` : ''}
              />
              <Status
                status={ttsStatus}
                label="2. TTS 음성 (ElevenLabs)"
                meta={audioUrl ? '생성됨' : ''}
              />
            </div>

            {error && <div className={styles.errorBox}>{error}</div>}

            <button type="button" className={styles.secondaryBtn} onClick={generateScript} disabled={scriptStatus === 'busy'} style={{ marginTop: 12 }}>
              1단계만 (대본)
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={generateTts} disabled={ttsStatus === 'busy' || !script}>
              2단계만 (TTS)
            </button>

            {/* 음성 선택 */}
            {availableVoices.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--ds-border, #E5E7EB)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ds-muted, #77736B)', marginBottom: 8 }}>
                  🎙 음성 선택 ({availableVoices.length}개)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  {availableVoices.map((v) => {
                    const selected = ttsVoice === v.id;
                    const isLoading = previewAudio.loading && previewAudio.voiceId === v.id;
                    return (
                      <div
                        key={v.id}
                        style={{
                          padding: '8px 10px',
                          border: selected ? '1.5px solid var(--ds-accent, #F95A1F)' : '1px solid var(--ds-border, #E5E7EB)',
                          borderRadius: 8,
                          background: selected ? 'rgba(255, 95, 31, 0.06)' : '#fff',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setTtsVoice(v.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            fontSize: 11,
                            fontWeight: selected ? 700 : 500,
                            color: selected ? 'var(--ds-accent, #F95A1F)' : 'var(--ds-text, #1F2937)',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontFamily: 'inherit',
                          }}
                        >
                          {v.gender === 'female' ? '♀️' : '♂️'} {v.name} <span style={{ opacity: 0.5, fontSize: 9 }}>({v.provider})</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => previewVoice(v.id)}
                          disabled={isLoading}
                          style={{
                            background: 'transparent',
                            border: '1px dashed #D1D5DB',
                            padding: '3px 6px',
                            borderRadius: 4,
                            fontSize: 9,
                            color: '#6B7280',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          {isLoading ? '...' : '🔊 샘플'}
                        </button>
                      </div>
                    );
                  })}
                </div>
                {previewAudio.url && (
                  <audio src={previewAudio.url} autoPlay style={{ width: '100%', marginTop: 8, height: 32 }} controls />
                )}
              </div>
            )}

            {/* 다음 단계 CTA — Step 2~4 공용 (legacy UI 동선 보강) */}
            {currentStep !== 7 && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--ds-border, #E5E7EB)' }}>
                {audioUrl ? (
                  <button
                    type="button"
                    onClick={() => setCurrentStep(5)}
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      borderRadius: 10,
                      border: 'none',
                      background: 'var(--ds-accent, #F95A1F)',
                      color: '#fff',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    다음 단계: 비주얼 액센트 →
                  </button>
                ) : script ? (
                  <div style={{ fontSize: 12, color: 'var(--ds-muted, #77736B)', textAlign: 'center', lineHeight: 1.5 }}>
                    👆 위에서 음성을 선택하고<br />
                    <strong style={{ color: 'var(--ds-text, #1F2937)' }}>"3단계만 (TTS)"</strong> 버튼을 눌러 음성을 만들어주세요.
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--ds-muted, #77736B)', textAlign: 'center', lineHeight: 1.5 }}>
                    👆 먼저 <strong style={{ color: 'var(--ds-text, #1F2937)' }}>"1단계만 (대본)"</strong> 버튼으로 대본을 만들어주세요.
                  </div>
                )}
              </div>
            )}
          </div>

          {script && Array.isArray(script.benchmarkCandidates) && script.benchmarkCandidates.length > 0 && (
            <div className={styles.card}>
              <div className={styles.cardLabel}>벤치마킹한 영상 ({script.benchmarkCandidates.length}개)</div>
              <p style={{ fontSize: 11, color: 'var(--ds-muted, #77736B)', marginBottom: 10, lineHeight: 1.5 }}>
                AI가 이 영상들의 후킹·구조·길이를 분석해 대본에 반영했어요.
              </p>
              <div style={{ display: 'grid', gap: 8 }}>
                {script.benchmarkCandidates.map((v, i) => (
                  <a
                    key={v.videoId || i}
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex',
                      gap: 10,
                      padding: 8,
                      borderRadius: 8,
                      border: '1px solid var(--ds-border, #E5E7EB)',
                      background: '#fff',
                      textDecoration: 'none',
                      color: 'inherit',
                    }}
                  >
                    {v.thumbnail && (
                      <img
                        src={v.thumbnail}
                        alt=""
                        style={{ width: 96, height: 54, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                        loading="lazy"
                      />
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.4, color: 'var(--ds-text, #1F2937)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {v.title}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--ds-muted, #77736B)', marginTop: 4 }}>
                        {v.channelName}
                        {v.viewCount > 0 && ` · 조회수 ${Number(v.viewCount).toLocaleString('ko-KR')}`}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
          {script && script.benchmarkFallback && (
            <div className={styles.card}>
              <div className={styles.cardLabel}>벤치마킹</div>
              <p style={{ fontSize: 12, color: 'var(--ds-muted, #77736B)', lineHeight: 1.5, margin: 0 }}>
                해당 키워드에 대한 후보 영상을 찾지 못해 벤치마킹 없이 대본을 생성했어요.
              </p>
            </div>
          )}

          {script && (
            <div className={styles.card}>
              <div className={styles.cardLabel}>생성된 대본</div>
              <div className={styles.scriptPreview}>
                {Array.isArray(script.scenes) && script.scenes.map((s, i) => (
                  <div key={i}>
                    <h5>Scene {i + 1} ({s.section || 'point'})</h5>
                    <p>{s.script}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {images.length > 0 && (
            <div className={styles.card}>
              <div className={styles.cardLabel}>생성된 이미지</div>
              <div className={styles.imagePicker}>
                {images.map((url, i) => (
                  <div key={i} className={`${styles.imageThumb} ${styles.imageThumbActive}`}>
                    <img src={url} alt={`image-${i}`} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={styles.right}>
          <div className={styles.card}>
            <div className={styles.cardLabel}>미리보기</div>
            <div className={styles.playerWrap}>
              {hasPreview ? (
                <Player
                  component={ShortformComposition}
                  inputProps={audioInputProps}
                  durationInFrames={playerDurationInFrames}
                  fps={SHORTFORM_FPS}
                  compositionWidth={SHORTFORM_WIDTH}
                  compositionHeight={SHORTFORM_HEIGHT}
                  style={{ width: '100%', height: '100%' }}
                  controls
                  loop
                  acknowledgeRemotionLicense
                />
              ) : (
                <div className={styles.playerPlaceholder}>
                  좌측에서<br />대본을 생성하면<br />미리보기가 표시됩니다
                </div>
              )}
            </div>
          </div>

          {hasPreview && (
            <div className={styles.card}>
              <div className={styles.cardLabel}>영상 텍스트 수정</div>
              <p style={{ fontSize: 11, color: '#6B7280', marginBottom: 12, lineHeight: 1.5 }}>
                자막이 너무 길거나 어색하면 직접 수정하세요. 입력 즉시 미리보기에 반영됩니다.
              </p>

              {/* 인라인 자막 편집 */}
              <ScriptTextEditor script={script} setScript={setScript} originalScript={originalScript} />

              {/* Phase A-bis — Q9 칩 5종 (AI 판정 + 세부 조정) */}
              <Step3ChipRow
                settings={settings}
                onChange={handleChipChange}
                disabled={refineStatus === 'busy'}
                errorMessage={refineError}
                reasoning={script?.reasoning || null}
              />
            </div>
          )}

          {hasPreview && (
            <div className={styles.card}>
              <div className={styles.cardLabel}>MP4 내보내기</div>
              <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 8 }}>
                서버 렌더는 다음 릴리즈에 추가됩니다. 현재는 브라우저 미리보기만 제공합니다.
              </p>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Phase A: '전체 자동 생성' 보조 버튼 (페이지 맨 아래) */}
      {currentStep < 7 && (
        <div className={styles.skipFooter}>
          <button
            type="button"
            className={styles.skipBtn}
            onClick={runAll}
            disabled={scriptStatus === 'busy' || ttsStatus === 'busy'}
          >
            {scriptStatus === 'busy' || ttsStatus === 'busy'
              ? '생성 중...'
              : '한 번에 자동 생성 (벤치마킹·세부조정 없이 빠른 모드)'}
          </button>
          <p className={styles.skipHint}>
            바쁘시면 단계별 진행 없이 한 번에 영상을 만들 수 있어요. 다만 결과 품질은 단계 진행보다 낮습니다.
          </p>
        </div>
      )}
    </main>
  );
}

// Next.js 15: useSearchParams는 Suspense 경계 내부여야 함.
export default function ShortformClient() {
  return (
    <Suspense
      fallback={
        <main className={styles.root}>
          <div className={styles.hero}>
            <div className={styles.heroBadge}>NEW · 숏폼</div>
            <h1>불러오는 중...</h1>
          </div>
        </main>
      }
    >
      <ShortformClientInner />
    </Suspense>
  );
}
