/**
 * 훅 엔진 — 6종 생성기 공유 (PRD/뚝딱툴-6종-통합설계.md 7-2, hook-engine-sonnet-prompt v2).
 *
 * 역할 분리(실측 결론):
 *  - 프롬프트 블록 = "한 글 내" 품질(장면·다양성·금지어·날조 방지).
 *  - 이 모듈의 회전+최근기록(blocklist) = "글 간" 다양성 — 독립 호출이라
 *    프롬프트만으론 문틀·숫자·장면 재사용을 못 막는다.
 *
 * 최근기록은 사용자(계정)별 격리 — 전역이면 A사용자의 표현이 B사용자를 막는 오작동.
 */

import {
  TITLE_PATTERNS,
  FIRST_BANKS,
  TITLE_DEVICES,
  GOLD_TITLES,
  GOLD_FIRSTS,
  BAD_EXAMPLES,
} from './data.js';
import { shuffleArray as shuffled } from '../utils.js';

// api-helpers는 next/server를 끌어오므로 최상단 import 금지 —
// Redis가 필요한 함수 안에서만 지연 로드(순수 로직은 Next 없이 테스트 가능해야 한다).
async function redis() {
  const { getRedis } = await import('../api-helpers.js');
  return getRedis();
}

// ───────────────────────── 회전(rotation) ─────────────────────────

/** 조합 서명 — 순서 무관 비교용 ("5+11" === "11+5") */
export function comboSignature(ids) {
  return [...ids].sort((a, b) => a - b).join('+');
}

/**
 * 제목 패턴 조합 뽑기 — 호출마다 다른 조합을 시스템이 지정(모델에 맡기지 않음).
 * @param {object} o
 * @param {boolean} o.hasUserStory 사용자_이야기 존재 여부 — 없으면 실적권위(8) 제외(날조 방지)
 * @param {string[]} [o.recentCombos] 최근 쓴 조합 서명들(사용자별 기록에서)
 * @param {number} [o.count] 뽑을 조합 수(기본 3 — 후보 3개용)
 * @returns {{ids:number[], labels:string[], signature:string}[]}
 */
export function pickTitleCombos({ hasUserStory = false, recentCombos = [], count = 3 } = {}) {
  const pool = TITLE_PATTERNS.filter((p) => hasUserStory || !p.needsUserStory);
  const recent = new Set(recentCombos);
  const combos = [];
  const used = new Set();

  // 단독 1개 + 2개 결합을 섞어 생성. 최근/중복 서명 회피.
  const singles = shuffled(pool);
  const guard = 200; // 무한루프 방지
  let tries = 0;
  while (combos.length < count && tries < guard) {
    tries += 1;
    const pair = Math.random() < 0.7; // 결합이 시너지 크다(스킬 실측) — 70% 결합
    let ids;
    if (pair) {
      const [a, b] = shuffled(pool).slice(0, 2);
      ids = [a.id, b.id];
    } else {
      ids = [singles[tries % singles.length].id];
    }
    const sig = comboSignature(ids);
    if (used.has(sig) || recent.has(sig)) continue;
    used.add(sig);
    combos.push({
      ids,
      labels: ids.map((id) => TITLE_PATTERNS.find((p) => p.id === id).label),
      signature: sig,
    });
  }
  return combos;
}

/**
 * 첫문장 뱅크 뽑기 — 최근 쓴 뱅크 회피(같은 도입 유형 반복 = 저품질 신호).
 * @returns {{id:number, label:string}}
 */
export function pickFirstBank({ hasUserStory = false, recentBanks = [] } = {}) {
  const pool = FIRST_BANKS.filter((b) => hasUserStory || !b.needsUserStory);
  const recent = new Set(recentBanks);
  const fresh = pool.filter((b) => !recent.has(b.id));
  const pick = shuffled(fresh.length ? fresh : pool)[0]; // 전부 최근이면 회피 완화(0개 반환 금지)
  return { id: pick.id, label: pick.label };
}

// ───────────────────────── few-shot 골드샘플 ─────────────────────────

/**
 * 배정된 패턴·뱅크의 골드샘플만 뽑는다 — 전부 넣으면 rule-stacking(프롬프트 폭증).
 */
export function goldFewshot({ combos = [], bankId } = {}) {
  const titleIds = [...new Set(combos.flatMap((c) => c.ids))];
  const titles = titleIds.flatMap((id) => (GOLD_TITLES[id] || []).slice(0, 1));
  const firsts = (GOLD_FIRSTS[bankId] || []).slice(0, 2);
  return { titles, firsts, bad: BAD_EXAMPLES };
}

// ───────────────────────── 프롬프트 블록 ─────────────────────────

/**
 * 생성기 시스템 프롬프트에 끼워 넣는 "훅 블록".
 * 본문 규칙·출력 형식은 각 생성기(블로그/스레드/영상)가 소유 — 여기는 제목·첫문장 훅만.
 * (검수는 별도 패스 — 여기에 검증 지시를 쌓지 않는다.)
 */
export function buildHookBlock({ combos, bank, avoid = {}, hasUserStory = false }) {
  const gold = goldFewshot({ combos, bankId: bank.id });
  const comboLines = combos
    .map((c, i) => `${i + 1}) ${c.labels.join(' + ')}`)
    .join(' / ');
  const avoidLines = [
    ...(avoid.titles || []).map((t) => `- 제목 골격: "${t}"`),
    ...(avoid.motifs || []).map((m) => `- 숫자·장면: ${m}`),
  ].join('\n');

  return `# 제목·첫문장 (훅)
## 제목 — 후보 ${combos.length}개를 아래 지정 조합으로 만들고 최선 1개를 고른다
- 지정 패턴 조합(순서대로 1개씩): ${comboLines}
- 25자 이내 · 키워드 앞배치 · 끝은 완결형(명사로 뚝 끊지 않는다 — 잘린 느낌이 클릭을 막는다)
- 장치를 1~2개 겹친다: ${TITLE_DEVICES.join(' · ')}
${hasUserStory ? '- 실적·경력 숫자는 사용자 이야기에 적힌 값만 그대로 쓴다.' : '- 사용자 이야기가 비어 있다 — 실적·경력·숫자 자랑을 만들지 않는다(지어낸 실적은 글쓴이를 거짓말쟁이로 만든다).'}

## 첫문장 — ${bank.label} 유형으로
- 구체적 장면·시간·대사 1개를 넣는다. 추상 설명으로 시작했으면 다시 쓴다.

## 품질 기준(이 수준·질감 — 소재는 입력값으로 치환, 문장을 그대로 옮기지 않는다)
제목 예: ${gold.titles.map((t) => `"${t}"`).join(' / ')}
첫문장 예: ${gold.firsts.map((t) => `"${t}"`).join(' / ')}
나쁜 예: ${gold.bad.join(' / ')}
${avoidLines ? `\n## 최근에 이미 쓴 표현 — 골격·숫자·장면이 겹치면 그 후보를 버리고 새로 만든다\n${avoidLines}` : ''}`;
}

// ───────────────────────── 사용자별 최근기록(blocklist) ─────────────────────────

const RECENT_CAP = 12; // 최근 N편 기억
const RECENT_TTL = 60 * 60 * 24 * 60; // 60일

function recentKey(email, channel) {
  return `hookengine:recent:${channel}:${email}`;
}

/**
 * 최근 사용 기록 조회. 실패 시 빈 값(생성을 막지 않는다 — 다양성 보조 기능이 본 기능을 죽이면 안 됨).
 * @returns {Promise<{combos:string[], banks:number[], titles:string[], motifs:string[]}>}
 */
export async function getRecentHooks(email, channel) {
  try {
    const items = await (await redis()).lrange(recentKey(email, channel), 0, RECENT_CAP - 1);
    const parsed = items
      .map((s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } })
      .filter(Boolean);
    return {
      combos: parsed.map((e) => e.combo).filter(Boolean),
      banks: parsed.map((e) => e.bank).filter((v) => typeof v === 'number'),
      titles: parsed.map((e) => e.title).filter(Boolean).slice(0, 5),
      motifs: [...new Set(parsed.flatMap((e) => e.motifs || []))].slice(0, 8),
    };
  } catch (e) {
    console.error('[hook-engine] getRecentHooks failed:', e?.message || 'unknown');
    return { combos: [], banks: [], titles: [], motifs: [] };
  }
}

/**
 * 생성 결과를 기록(다음 호출의 회피 목록). non-fatal.
 * @param {object} entry {combo:'5+11', bank:6, title:'…', motifs:['40건','새벽 취소 문자']}
 */
export async function pushRecentHooks(email, channel, entry) {
  try {
    const key = recentKey(email, channel);
    const r = await redis();
    await r.lpush(key, JSON.stringify(entry));
    await r.ltrim(key, 0, RECENT_CAP - 1);
    await r.expire(key, RECENT_TTL);
  } catch (e) {
    console.error('[hook-engine] pushRecentHooks failed:', e?.message || 'unknown');
  }
}
