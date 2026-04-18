/**
 * lib/shortform/scene-timing.js — Phase A-bis Q6 Hybrid + MIN guard
 *
 * Worker #3 (API + Prompt) 담당. spec §4.3 / §5.3 / §Q6.
 *
 * 제약 (spec):
 * - React/Remotion import 금지 (L1)
 * - process.env 직접 접근 금지 — fps는 호출자가 주입 (L6)
 * - actualLead 패턴: MIN guard 발동 시 마지막 씬 축소 금지 (음성 잘림 방지)
 *
 * 동작 요약 (Q6 (C) Hybrid):
 *  1. word timestamps → 씬별 durationFrames 계산 (문자수 비율 + 실측 시간)
 *  2. 첫 씬에서 SUBTITLE_LEAD_FRAMES(6f) 만큼 빼 자막 lead 생성
 *  3. MIN_FIRST_SCENE_FRAMES(30f, 1초) 하한 강제
 *  4. actualLead 양수 → 마지막 씬에 더해 총 길이 유지
 *  5. MIN guard 발동(actualLead <= 0) → 마지막 씬 손대지 않음 (총 영상 +6f 패딩 감수)
 */

// ─────────────────────────────────────────────────────────────────────────────
// 상수 — spec §Q6 고정값. 실측 필요 플래그 (배포 후 (가/나/다) 피드백으로 재조정 가능).
// ─────────────────────────────────────────────────────────────────────────────
export const SUBTITLE_LEAD_FRAMES = 6;      // 200ms @ 30fps
export const MIN_FIRST_SCENE_FRAMES = 30;   // 1초 하한 (음성 잘림 방지)

// Phase 2 (2026-04-18):
// - AUDIO_PREROLL_FRAMES: 오디오 시작을 N프레임 뒤로 미뤄 영상이 먼저 준비되게 함.
//   LayoutComponent의 spring 진입 애니메이션(damping:200, ~15~25f)이 완료될 시간 확보.
//   per-scene overlap 분산과 함께 사용해 누적 lag 해소.
// - TAIL_PADDING_FRAMES: 마지막 씬 duration에 추가. ElevenLabs char end는 발화 끝이라
//   잔향/숨 포즈 포함 X — CTA 잘림 방지.
//   45f로도 "슬림핏"에서 잘림 관찰 → 90f(3s)로 증가. ElevenLabs MP3 파일의 무음 tail을
//   흡수하기 위함. 본질적 해결은 Web Audio API로 실제 audio duration 측정이지만
//   우선 여유 padding으로 안전 커버.
export const AUDIO_PREROLL_FRAMES = 25;     // 833ms @ 30fps
export const TAIL_PADDING_FRAMES = 90;      // 3s @ 30fps

// TransitionSeries overlap — Phase A SceneSequenceComposition과 일치해야 한다.
// 참고: remotion/shortform/SceneSequenceComposition.jsx::resolveTransition
const TRANSITION_OVERLAP_BY_KIND = {
  cut: 1,
  fade: 8,
  'fade-long': 15,
  slide: 8,
  'slide-fast': 4,
  'clock-wipe': 12,
  wipe: 10,
  flip: 15,
};

// auto 전환 로테이션 — 씬 i의 뒤 transition 종류를 인덱스 기반으로 고름.
// 복잡 레이아웃에서 tear 방지를 위해 fade 중심 (wipe/flip 제외).
export const AUTO_TRANSITION_ROTATION = ['fade', 'slide-fast', 'fade-long', 'fade', 'slide-fast', 'fade', 'fade-long', 'slide-fast'];

/**
 * Phase 2 (2026-04-18): N-1개 transition(auto 로테이션)의 총 overlap 프레임 합.
 * TransitionSeries가 씬 중첩으로 composition을 짧게 만들기 때문에 scriptToProps에서
 * 이 값만큼 scene durations에 보상해야 오디오 끝이 잘리지 않음.
 */
export function getAutoTransitionTotalOverlap(sceneCount) {
  if (!Number.isFinite(sceneCount) || sceneCount < 2) return 0;
  let total = 0;
  for (let i = 0; i < sceneCount - 1; i++) {
    const kind = AUTO_TRANSITION_ROTATION[i % AUTO_TRANSITION_ROTATION.length];
    total += TRANSITION_OVERLAP_BY_KIND[kind] || 0;
  }
  return total;
}

/**
 * Phase 2 (2026-04-18): 씬 i 뒤의 transition overlap 프레임 수.
 * 씬마다 duration에 이 값을 더해 TransitionSeries의 overlap 단축을 흡수하면
 * 각 씬 visual이 정확히 해당 씬의 audio 시작 시간에 나타남 — 누적 lag 방지.
 * 마지막 씬(i = sceneCount - 1)은 뒤에 transition 없으므로 0.
 */
export function getAutoTransitionOverlapAt(sceneIndex, sceneCount) {
  if (!Number.isFinite(sceneIndex) || sceneIndex < 0) return 0;
  if (!Number.isFinite(sceneCount) || sceneIndex >= sceneCount - 1) return 0;
  const kind = AUTO_TRANSITION_ROTATION[sceneIndex % AUTO_TRANSITION_ROTATION.length];
  return TRANSITION_OVERLAP_BY_KIND[kind] || 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ElevenLabs character timestamps 기반 정확한 씬별 duration 산출.
 *
 * word timestamp 기반 assignWordsToScenes()의 누적 오차를 제거.
 * scene.script 문자열을 join(' ')한 것이 TTS 입력 텍스트와 1:1 대응해야 하며,
 * charAlignment.characters 배열의 글자 순서와 정확히 매칭된다.
 *
 * @param {{ characters: string[], starts: number[], ends: number[] }} charAlignment
 * @param {Array<{ script?: string, text?: string }>} scenes
 * @param {{ fps: number }} opts
 * @returns {number[]} 각 씬의 durationInFrames (Q6 hybrid + MIN guard 적용)
 */
export function deriveSceneDurationsFromCharTimestamps(charAlignment, scenes, opts = {}) {
  const { fps } = opts;
  if (!fps || typeof fps !== 'number') {
    throw new Error('[scene-timing] fps is required');
  }
  if (!Array.isArray(scenes) || scenes.length === 0) return [];
  if (!charAlignment?.characters?.length) {
    return fallbackDurationsFromCharCount(scenes, scenes.length * MIN_FIRST_SCENE_FRAMES);
  }

  const { characters, starts, ends } = charAlignment;

  // 1. scene.script를 join(' ')하여 TTS 전송 텍스트 재구성 + 각 씬의 char 범위 계산
  const sceneCharRanges = buildSceneCharRanges(scenes);
  const totalTtsLen = sceneCharRanges.length > 0
    ? sceneCharRanges[sceneCharRanges.length - 1].end
    : 0;

  // alignment 글자 수와 TTS 텍스트 길이 불일치 시 fallback
  if (Math.abs(characters.length - totalTtsLen) > totalTtsLen * 0.1) {
    console.warn(
      `[scene-timing] charAlignment length mismatch: alignment=${characters.length} vs tts=${totalTtsLen}, falling back to word timestamps`,
    );
    return fallbackDurationsFromCharCount(scenes, scenes.length * MIN_FIRST_SCENE_FRAMES);
  }

  // 2. 각 씬의 시작/끝 시간을 character timestamps에서 직접 추출
  let durations = sceneCharRanges.map(({ start: charStart, end: charEnd }) => {
    // 해당 씬의 첫 글자와 마지막 글자의 timestamp
    const firstCharIdx = Math.min(charStart, characters.length - 1);
    const lastCharIdx = Math.min(charEnd - 1, characters.length - 1);

    if (firstCharIdx > lastCharIdx || firstCharIdx < 0) {
      return MIN_FIRST_SCENE_FRAMES;
    }

    const startSec = starts[firstCharIdx] ?? 0;
    const endSec = ends[lastCharIdx] ?? starts[lastCharIdx] ?? startSec;
    const frames = Math.round((endSec - startSec) * fps);
    return Math.max(frames, MIN_FIRST_SCENE_FRAMES);
  });

  // 3. Q6 (C) Hybrid — 첫 씬 lead + MIN guard + 마지막 씬 보상
  durations = applySubtitleLeadAndMinGuard(durations, {
    scenesMeta: { sceneCount: scenes.length, source: 'charTimestamps' },
  });

  return durations;
}

/**
 * scene.script 배열을 join(' ')한 전체 텍스트에서 각 씬이 차지하는 char index 범위.
 * TTS 클라이언트가 sceneTexts.filter(Boolean).join(' ')으로 보내는 것과 동일 로직.
 *
 * @param {Array<{ script?: string, text?: string }>} scenes
 * @returns {Array<{ start: number, end: number }>} 각 씬의 [start, end) char index
 */
export function buildSceneCharRanges(scenes) {
  const ranges = [];
  let cursor = 0;
  const texts = scenes.map((s) => (s?.script || s?.text || '').trim());

  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    if (!t) {
      ranges.push({ start: cursor, end: cursor });
      continue;
    }
    // 첫 씬이 아니면 join(' ') 구분자 1글자가 앞에 붙음
    if (i > 0 && cursor > 0) {
      cursor += 1; // space separator
    }
    const start = cursor;
    cursor += t.length;
    ranges.push({ start, end: cursor });
  }

  return ranges;
}

/**
 * word timestamps + scenes 배열 → 씬별 durationInFrames 배열.
 *
 * @param {Array<{ word: string, start: number, end: number }>} words - 정렬 가정 (호출자 책임)
 * @param {Array<{ script?: string, text?: string }>} scenes
 * @param {{ fps: number, transitionMode?: 'auto'|'fade'|'slide'|'cut'|'slide-fast'|'fade-long' }} opts
 * @returns {number[]} 각 원소가 해당 씬의 durationInFrames (Q6 hybrid + MIN guard 적용 후)
 */
export function deriveSceneDurationsFromWordTimestamps(words, scenes, opts = {}) {
  const { fps, transitionMode = 'auto' } = opts;
  if (!fps || typeof fps !== 'number') {
    throw new Error('[scene-timing] fps is required (L6: pass getFps(contentType))');
  }
  if (!Array.isArray(scenes) || scenes.length === 0) return [];

  // words 없거나 빈 배열 → fallback
  if (!Array.isArray(words) || words.length === 0) {
    // 호출자가 totalTargetFrames를 모르면 각 씬 최소값으로 내려보냄 — 실전 경로는 항상 words 있음
    return fallbackDurationsFromCharCount(scenes, scenes.length * MIN_FIRST_SCENE_FRAMES);
  }

  // 1. 각 씬의 문자수 기준으로 words를 분배해 씬별 [startSec, endSec] 도출
  const sceneBoundaries = assignWordsToScenes(words, scenes);

  // 2. 초 → 프레임 변환
  let durations = sceneBoundaries.map(({ startSec, endSec }) => {
    const frames = Math.round((endSec - startSec) * fps);
    return Math.max(frames, MIN_FIRST_SCENE_FRAMES);
  });

  // 3. Q6 (C) Hybrid — 첫 씬 lead + MIN guard + 마지막 씬 보상
  durations = applySubtitleLeadAndMinGuard(durations, { scenesMeta: { sceneCount: scenes.length } });

  // 4. (선택) transition overlap 보정 — 씬 간 자연 lead를 이미 계산된 duration에 반영할지
  //    여부는 Phase A 컴포지션이 이미 overlap을 처리하므로 추가 보정은 생략.
  //    transitionMode/fps가 필요한 소비자가 있으면 getTransitionOverlapFrames()로 별도 조회.
  void transitionMode; // 인터페이스 호환용 — 현재 로직에서 사용 X

  return durations;
}

/**
 * 전환 종류별 overlap 프레임 수. Phase A 컴포지션과 동기화 필수.
 *
 * @param {string} transitionType - 'cut' | 'fade' | 'fade-long' | 'slide' | 'slide-fast' | 'auto'
 * @param {number} fps
 * @returns {number} overlap in frames
 */
export function getTransitionOverlapFrames(transitionType, fps) {
  if (!fps || typeof fps !== 'number') {
    throw new Error('[scene-timing] fps is required');
  }
  if (transitionType === 'auto') {
    // 평균값 반환 — 씬별 세부 overlap은 caller가 인덱스로 직접 조회
    const sum = AUTO_TRANSITION_ROTATION.reduce(
      (acc, k) => acc + (TRANSITION_OVERLAP_BY_KIND[k] || 0),
      0,
    );
    return Math.round(sum / AUTO_TRANSITION_ROTATION.length);
  }
  return TRANSITION_OVERLAP_BY_KIND[transitionType] ?? TRANSITION_OVERLAP_BY_KIND.slide;
}

/**
 * word timestamps 없을 때 fallback — 문자수 비례로 total을 나눠 씬별 durationInFrames 산출.
 *
 * @param {Array<{ script?: string, text?: string }>} scenes
 * @param {number} totalTargetFrames
 * @returns {number[]}
 */
export function fallbackDurationsFromCharCount(scenes, totalTargetFrames) {
  if (!Array.isArray(scenes) || scenes.length === 0) return [];
  const texts = scenes.map((s) => String(s?.script || s?.text || ''));
  const charCounts = texts.map((t) => Math.max(t.replace(/\s+/g, '').length, 1));
  const totalChars = charCounts.reduce((a, b) => a + b, 0);
  const safeTotal = Math.max(totalTargetFrames, scenes.length * MIN_FIRST_SCENE_FRAMES);

  let allocated = charCounts.map((c) =>
    Math.max(Math.round((c / totalChars) * safeTotal), MIN_FIRST_SCENE_FRAMES),
  );

  // Q6 hybrid 적용 — fallback 경로에서도 동일 lead/MIN guard
  allocated = applySubtitleLeadAndMinGuard(allocated, {
    scenesMeta: { sceneCount: scenes.length, fallback: true },
  });

  return allocated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 문자수 비율로 words를 씬에 분배 후, 각 씬의 [startSec, endSec] 구간을 돌려준다.
 * 정확도는 post-hoc alignment 수준 — fingr식 per-word sync는 Phase B 범위 밖.
 *
 * @param {Array<{ start: number, end: number }>} words
 * @param {Array<{ script?: string, text?: string }>} scenes
 * @returns {Array<{ startSec: number, endSec: number }>}
 */
function assignWordsToScenes(words, scenes) {
  const texts = scenes.map((s) => String(s?.script || s?.text || ''));
  const charCounts = texts.map((t) => t.replace(/\s+/g, '').length);
  const totalChars = Math.max(
    charCounts.reduce((a, b) => a + b, 0),
    1,
  );
  const totalWords = words.length;

  // 누적 문자수 비율로 words 경계 index 계산
  let cumChars = 0;
  const boundaries = charCounts.map((c) => {
    cumChars += c;
    return Math.min(
      Math.max(Math.round((cumChars / totalChars) * totalWords), 1),
      totalWords,
    );
  });

  const result = [];
  let wordStart = 0;
  for (let i = 0; i < scenes.length; i++) {
    const wordEnd = boundaries[i];
    const slice = words.slice(wordStart, wordEnd);
    if (slice.length === 0) {
      // 빈 씬 — 앞 씬 끝 시간을 start/end로 사용 (0-length)
      const prevEnd = result[result.length - 1]?.endSec ?? 0;
      result.push({ startSec: prevEnd, endSec: prevEnd });
    } else {
      result.push({
        startSec: slice[0].start ?? 0,
        endSec: slice[slice.length - 1].end ?? slice[0].start ?? 0,
      });
    }
    wordStart = wordEnd;
  }
  return result;
}

/**
 * Q6 (C) Hybrid 메인 로직 — spec §5.3 actualLead 패턴.
 *
 * @param {number[]} durations
 * @param {{ scenesMeta?: object }} [ctx]
 * @returns {number[]} 수정된 durations (새 배열)
 */
function applySubtitleLeadAndMinGuard(durations, ctx = {}) {
  if (!Array.isArray(durations) || durations.length === 0) return durations;
  if (durations.length < 2) {
    // 씬 1개만 있으면 lead 적용 불가 (마지막 씬 보상 대상 없음)
    return durations.slice();
  }

  const out = durations.slice();
  const originalFirst = out[0];
  out[0] = Math.max(originalFirst - SUBTITLE_LEAD_FRAMES, MIN_FIRST_SCENE_FRAMES);
  const actualLead = originalFirst - out[0];

  if (actualLead > 0) {
    // 정상 경로 — 마지막 씬에 lead만큼 보상 (총 길이 유지)
    out[out.length - 1] += actualLead;
  } else {
    // MIN guard 발동 — 마지막 씬 축소 금지 (음성 잘림 위험).
    // 총 영상 길이는 최대 SUBTITLE_LEAD_FRAMES 만큼 패딩되며, Remotion은 끝프레임 정지로 처리.
    console.warn(
      '[scene-timing] MIN guard engaged — first scene padded, total video +' +
        SUBTITLE_LEAD_FRAMES +
        'f (last scene preserved)',
    );
    // 이벤트 로깅 — 비동기, 실패 무시 (측정용)
    logSceneTimingEvent({
      event_type: 'scene_timing',
      min_guard: true,
      original_first_frames: originalFirst,
      adjusted_first_frames: out[0],
      scene_count: out.length,
      meta: ctx?.scenesMeta ?? null,
    }).catch((err) => {
      console.warn('[scene-timing] logSceneTimingEvent failed:', err?.message);
    });
  }

  return out;
}

/**
 * scene_timing_events 테이블에 측정 이벤트 기록 (non-fatal).
 *
 * lazy CREATE: 첫 호출 시 테이블이 없으면 생성. DB 실패는 무시하고 console.warn만.
 * DB 연결 실패가 렌더/API 경로를 깨뜨리지 않도록 항상 try/catch로 감싸야 한다.
 *
 * @param {{
 *   event_type: string,
 *   min_guard: boolean,
 *   original_first_frames: number,
 *   adjusted_first_frames: number,
 *   scene_count: number,
 *   meta?: object | null,
 * }} event
 * @returns {Promise<void>}
 */
async function logSceneTimingEvent(event) {
  // dynamic import — lib/shortform/* 는 DB에 의존 금지가 아님(L1은 React/Remotion 금지).
  // Node 테스트에서 DB 모듈을 로드하지 않으려고 lazy import 사용.
  let getDb;
  try {
    ({ getDb } = await import('../db.js'));
  } catch {
    return; // DB 모듈 없으면 조용히 no-op (테스트 경로)
  }

  let sql;
  try {
    sql = getDb();
  } catch {
    return; // POSTGRES_URL 미설정 등 — non-fatal
  }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS scene_timing_events (
        id BIGSERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        min_guard BOOLEAN NOT NULL DEFAULT false,
        original_first_frames INTEGER NOT NULL,
        adjusted_first_frames INTEGER NOT NULL,
        scene_count INTEGER NOT NULL,
        meta JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `;
    await sql`
      INSERT INTO scene_timing_events (
        event_type, min_guard, original_first_frames, adjusted_first_frames, scene_count, meta
      ) VALUES (
        ${event.event_type},
        ${event.min_guard},
        ${event.original_first_frames},
        ${event.adjusted_first_frames},
        ${event.scene_count},
        ${event.meta ? JSON.stringify(event.meta) : null}
      )
    `;
  } catch (err) {
    console.warn('[scene-timing] DB log failed:', err?.message);
  }
}
