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

// TransitionSeries overlap — Phase A SceneSequenceComposition과 일치해야 한다.
// 참고: remotion/shortform/SceneSequenceComposition.jsx::resolveTransition
const TRANSITION_OVERLAP_BY_KIND = {
  cut: 1,
  fade: 15,
  'fade-long': 30,
  slide: 15,
  'slide-fast': 8,
};

// auto 전환 로테이션 — SceneSequenceComposition의 resolveAutoTransition과 동일 순서
const AUTO_TRANSITION_ROTATION = ['slide-fast', 'fade', 'slide', 'fade-long'];

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

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
