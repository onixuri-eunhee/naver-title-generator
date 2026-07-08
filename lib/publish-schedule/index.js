/**
 * 발행 분산 스케줄러 — 여러 글을 저품질 안 걸리게 시간 나눠 예약하는 계산 로직.
 *
 * 근거(PRD 0-0·7-3, blog-publisher-v2 스킬 주의사항):
 *  - 상위노출·홈판의 절반은 "발행 방식". 하루 여러 편을 몰아 올리면 네이버가 기계발행으로 보고 저품질.
 *  - 하루 2편 이상이면 즉시발행 연속 금지 → 최소 1.5~3시간 간격, 시간대 분산.
 *  - 실제 발행은 PC 도우미(카무폭스 naver_publisher.py --schedule)가 수행. 이 모듈은 "시각 계산"만.
 *
 * 모든 시각은 KST(네이버 기준). 순수 함수 — 외부 의존 없음, nowMs 주입으로 테스트 재현.
 */

// 하루 발행 앵커(설계 예시 그대로 · 2.5시간 간격이라 최소 간격 규칙 자동 충족).
export const DEFAULT_ANCHORS = ['09:00', '11:30', '14:00', '16:30', '19:00'];
export const MIN_GAP_MINUTES = 90; // 1.5시간

/** 'YYYY-MM-DD' + 'HH:MM'(KST) → UTC Date */
export function kstToDate(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00+09:00`);
}

/** UTC Date → KST 'YYYY-MM-DD' */
export function toKstDateStr(date) {
  return new Date(date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** KST 날짜 문자열에 days 더하기 */
export function addDaysKst(dateStr, days) {
  const d = kstToDate(dateStr, '00:00');
  d.setUTCDate(d.getUTCDate() + days);
  return toKstDateStr(d);
}

/**
 * 분산 스케줄 계산.
 * @param {object} o
 * @param {string} o.startDate 시작 KST 날짜 'YYYY-MM-DD'
 * @param {number} o.totalPosts 총 글 수(>=1)
 * @param {number} [o.postsPerDay=3] 하루 최대 발행 편수(1~앵커수)
 * @param {string[]} [o.anchors] 발행 앵커 시각들(KST 'HH:MM')
 * @param {boolean} [o.skipPast=true] 시작일에서 이미 지난 앵커는 건너뜀
 * @param {number} [o.nowMs=Date.now()] 현재 시각(테스트 주입)
 * @returns {{round:number, kstDate:string, kstTime:string, iso:string, scheduleArg:string}[]}
 */
export function computeSchedule({
  startDate,
  totalPosts,
  postsPerDay = 3,
  anchors = DEFAULT_ANCHORS,
  skipPast = true,
  nowMs = Date.now(),
}) {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('startDate는 YYYY-MM-DD');
  if (!Number.isInteger(totalPosts) || totalPosts < 1) throw new Error('totalPosts는 1 이상 정수');
  const perDay = Math.max(1, Math.min(postsPerDay, anchors.length));

  const out = [];
  let dayOffset = 0;
  const MAX_DAYS = 400; // 무한루프 방지(1편/일이라도 400일이면 종료)

  while (out.length < totalPosts && dayOffset < MAX_DAYS) {
    const date = addDaysKst(startDate, dayOffset);
    // 그날 "아직 안 지난 앵커" 중 앞에서 perDay개 사용 → 늦게 시작해도 그날 남은 슬롯을 살린다.
    let usedToday = 0;
    for (let i = 0; i < anchors.length && usedToday < perDay && out.length < totalPosts; i++) {
      const time = anchors[i];
      const dt = kstToDate(date, time);
      if (skipPast && dt.getTime() <= nowMs) continue; // 이미 지난 슬롯은 스킵
      out.push({
        round: out.length + 1,
        kstDate: date,
        kstTime: time,
        iso: dt.toISOString(),
        scheduleArg: `${date} ${time}`, // naver_publisher.py --schedule 형식(KST)
      });
      usedToday += 1;
    }
    dayOffset += 1;
  }
  return out;
}

/**
 * 간격 검증 — 인접 발행이 minGap 미만이면 위반 보고(같은 날 앵커가 촘촘하거나 커스텀 시 안전망).
 * @returns {{index:number, gapMinutes:number}[]} 위반 목록(빈 배열 = 통과)
 */
export function validateGaps(schedule, minGapMinutes = MIN_GAP_MINUTES) {
  const violations = [];
  for (let i = 1; i < schedule.length; i++) {
    const gap = (new Date(schedule[i].iso) - new Date(schedule[i - 1].iso)) / 60000;
    if (gap < minGapMinutes) violations.push({ index: i, gapMinutes: Math.round(gap) });
  }
  return violations;
}

