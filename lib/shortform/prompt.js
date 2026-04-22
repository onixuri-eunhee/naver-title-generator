/**
 * lib/shortform/prompt.js — Phase A-bis SYSTEM_PROMPT 빌더
 *
 * Worker #3 (API + Prompt). Spec §4.2.
 *
 * 규칙:
 * - L1: React/Remotion import 금지
 * - L6: process.env 직접 접근 금지 (호출자가 인자로 주입)
 * - 내부 섹션 함수 export 금지 — buildSystemPrompt / buildUserPrompt만 공개
 * - scriptType === 'story' 시 루프 훅 섹션 빈 문자열
 * - retryAttempt > 0 시 JSON strict 블록 맨 앞 unshift
 * - reasoningExamples 누락 시 해당 섹션 스킵 + 세션당 1회 경고
 * - 600줄 임계 (현재 ~450줄)
 *
 * settings.js chipId와 동일한 파라미터 이름 사용:
 *   category / firstThreeSeconds / scriptType / contentType
 */

// 모듈 레벨 경고 플래그 — reasoningExamples 미제공 시 세션당 1회만 경고
let _warnedMissingReasoningExamples = false;

// ─────────────────────────────────────────────────────────────────────────────
// [섹션 1] 절대 규칙 — 존댓말/JSON/구어체/SEDA/32자 제약
// ─────────────────────────────────────────────────────────────────────────────
function buildAbsoluteRulesBlock({ contentType }) {
  const sceneLengthHint =
    contentType === 'long'
      ? '한 씬의 script는 권장 60~90자. 롱폼은 호흡을 길게 가져갑니다.'
      : '한 씬의 script는 권장 32자(공백 포함). 한국어 문법 정확성이 글자수보다 우선입니다.';

  return `[절대 규칙]
1. 반드시 존댓말만 사용하세요. 반말, 유행어 남발, 과장된 말투는 금지입니다.
2. 출력은 설명 없이 순수 JSON 객체 하나만 반환하세요. 마크다운 코드블록, 부가 설명, 서문 금지입니다.
3. 사실은 사용자가 제공한 topic과 blogText 안에서만 사용하세요. 입력에 없는 구체적 수치나 사례를 지어내지 마세요.
4. 구어체로 자연스러운 내레이션 문장을 작성하세요. 문어체 금지.
5. 한 문장에 하나의 정보만. 숫자는 구체적으로 (많이→87%, 대부분→10명 중 8명).
6. 같은 말 반복 절대 금지. 씬마다 반드시 새로운 정보를 전달하세요. 표현만 바꿔 같은 내용을 되풀이하면 실패입니다.
7. ${sceneLengthHint} 문법이 깨질 것 같으면 글자수를 넘어가지 말고 씬을 나누세요.
8. 생성 전 한 번 더: 각 script를 소리 내 읽었을 때 자연스러운가? 어색한 표현은 즉시 고치세요.
9. 외래어 표기 정확성 필수 — 특히 색상·소재·스타일. 자주 틀리는 표기:
   ❌ 볼랙 / 발랙 → ✅ 블랙
   ❌ 그레 → ✅ 그레이
   ❌ 네비 / 네비이 → ✅ 네이비
   ❌ 카키이 → ✅ 카키
   ❌ 배지 → ✅ 베이지
   ❌ 아이보리이 → ✅ 아이보리
   모든 외래어는 국립국어원 표준 표기법 준수. onScreenText·layoutProps·script 전부 검증.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// [섹션 2] First 3 Seconds — Q4 (B) 대본 제약 (style별 글자수)
// ─────────────────────────────────────────────────────────────────────────────
const FIRST_THREE_RULES = {
  auto: {
    label: '자동',
    hint:
      '카테고리와 주제에 가장 적합한 첫 문장 스타일을 스스로 선택하세요. 충격/숫자/스토리 중 어느 것이든 첫 씬이 스크롤을 멈추게 해야 합니다.',
    maxChars: 14,
  },
  shock: {
    label: '충격형',
    hint:
      '통념을 뒤집는 짧고 강한 선언. "틀렸습니다", "아닙니다" 같은 반전 어미를 활용.',
    maxChars: 12,
  },
  number: {
    label: '숫자형',
    hint:
      '첫 문장에 숫자(퍼센트·배수·기간·인원·금액) 하나를 반드시 포함. 숫자가 충격의 코어가 되도록.',
    maxChars: 14,
  },
  story: {
    label: '스토리형',
    hint:
      '구체적 상황·감정 한 컷으로 시작. "어제 ~했어요", "저도 ~였습니다" 같은 1인칭 앵커.',
    maxChars: 20,
  },
};

function buildFirstThreeSecondsBlock({ firstThreeSeconds, category }) {
  const rule = FIRST_THREE_RULES[firstThreeSeconds] ?? FIRST_THREE_RULES.auto;
  const categoryHint =
    category && category !== 'auto'
      ? `카테고리: ${category} — 이 타겟이 스크롤을 멈출 만한 정서·언어를 우선하세요.`
      : '';

  return `[첫 3초 — ${rule.label}]
${rule.hint}
★ scenes[0].script는 ${rule.maxChars}자 이내로 임팩트, 단 음성으로 1.0초 이상 발화되도록 여유를 주세요.
★ scenes[0].hookText는 화면 강조용 8~12자 한국어 핵심 문구.
★ scenes[0].hookType은 "질문형|충격형|비밀형|증거형|공감형|경고형" 중 사용한 유형을 반드시 기입.
${categoryHint}`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// [섹션 3] 후킹 공식 + 대본 구조 + scriptType 루프 훅 분기
// ─────────────────────────────────────────────────────────────────────────────
function buildHookFormulaBlock({ scriptType, contentType }) {
  const structureByContentType =
    contentType === 'long'
      ? `[대본 구조 — 롱폼]
hook → body1 → body2 → body3 → body4 → conclusion → cta (7씬 고정)
각 body는 서로 다른 각도/사례/숫자로 주제를 파고듭니다. 반복 금지.`
      : `[대본 구조 — fingr식 공감 루프]
총 씬 수에 따라 base 구조를 따르되, 표현·순서를 매번 변주하세요. 템플릿화 금지.

▶ 7씬 (30초) — 1사이클:
  scene[0] 공감 질문 (Hook)
  scene[1] 마음읽기 질문 — "솔직히 ~ 싶으셨을 거예요"
  scene[2] 상황 설명 — "그런데 사실 ~"
  scene[3] 통념 깨기 — "이건 ~ 때문이 아니라 ~"
  scene[4] 약속/해법 — "이렇게 하면 ~"
  scene[5] 사례 + 경험 — "어제 ~했어요"
  scene[6] CTA 동료 호출

▶ 10씬 (45초) — 1.5사이클: 7씬 base + scene[5~8]에 [마음읽기2 / 사례2 / 작은 약속] 삽입
▶ 14씬+ (60~90초) — 2사이클+: 자유 반복

★ scene[1]은 반드시 마음읽기 질문 형태 ("솔직히 ~", "혹시 ~ 아니세요?", "~ 싶으셨을 거예요")`;

  const loopHookBlock = buildLoopHookBlock({ scriptType });

  return `[후킹 공식 — 6종 다양성 유지, 공감 베이스]
모든 후킹은 시청자가 "내 얘긴가?" 느끼게 만드는 게 출발점입니다.
6종 중 토픽에 가장 잘 맞는 것을 매번 다르게 선택해 다양성 확보.

★ BAD (0점):
- "안녕하세요", "오늘은 ~에 대해 알아볼게요", "여러분 ~"
- "~해보셨나요?" (단순 yes/no)
- "~이 중요합니다" (누구나 아는 말)

★ GOOD 후킹 유형 6종:
1. 질문형: "블로그 하루 3시간 쓰는데 왜 방문자가 10명일까요?"
2. 충격형: "키워드 검색량, 높을수록 좋다고요? 틀렸습니다"
3. 비밀형: "상위 1% 블로거만 쓰는 기능이 있습니다"
4. 증거형: "이 설정 하나로 방문자 3배"
5. 공감형: "저도 ~로 6개월 헤맸어요"
6. 경고형: "이거 모르고 쓰면 광고비만 새요"

★ scenes[0]에 hookType 필드 출력 필수.

${structureByContentType}

[Point 작성 규칙]
- 추상 나열 금지. 구체 장면/숫자/감정만 사용.
- personaMemo가 있으면 Point 중 최소 2씬에 활용 (정체성 1 + 구체 장면/숫자 1).
- 없으면 관찰형 1인칭 Point 최소 1씬: "~인 분들 많으세요", "저도 처음엔 ~"

[CTA 작성 규칙 — 마지막 씬 전까지의 사전 준비]
- 정형 문구 금지 ("궁금한 점 댓글로", "유용했다면 팔로우", "감사합니다").
- 실제 CTA Variant 본문은 Remotion CTAVariantScene이 대체하므로, 본 대본 CTA 씬은
  음성/시각 흐름을 끊지 않는 연결고리 역할로 충분.
${loopHookBlock}`.trim();
}

/**
 * scriptType 분기 루프 훅.
 * - question: scripts[0] 질문 재사용
 * - list: 키워드 3개 flash 요약
 * - story: 루프 훅 없음 (빈 문자열)
 */
function buildLoopHookBlock({ scriptType }) {
  if (scriptType === 'story') {
    // 제약 (§4.2): story는 루프 훅 블록 빈 문자열
    return '';
  }
  if (scriptType === 'question') {
    return `
[루프 훅 — question형]
★ 마지막 씬은 scripts[0]의 질문을 재사용해 순환 고리 형성:
   "그래서 다시 물어볼게요, {첫 씬 질문}"
   → 시청자가 영상 처음으로 되돌아갈 확률 상승.`;
  }
  if (scriptType === 'list') {
    return `
[루프 훅 — list형]
★ 마지막 씬은 본문에서 다룬 핵심 키워드 3개를 flash 요약 + "처음부터 다시 보실까요?"
   → 리플레이 유도, 저장 확률 상승.`;
  }
  // auto 또는 미지정 — Claude에게 판단 위임 (story/question/list 중 자가 선택)
  return `
[루프 훅 — 자동 판단]
★ 주제 성격상 질문형이면 scripts[0] 질문 재사용, 리스트형이면 키워드 3개 flash 요약.
   스토리형이면 루프 훅 미적용. 선택을 scripts[last].loopHook 필드에 메타로 기록.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// [섹션 4] Reasoning Guidance — 툴팁 카피 규칙 + few-shot 주입
// ─────────────────────────────────────────────────────────────────────────────
function buildReasoningGuidanceBlock({ reasoningExamples }) {
  if (!reasoningExamples) {
    if (!_warnedMissingReasoningExamples) {
      console.warn(
        '[prompt] reasoningExamples missing — skipping reasoning guidance section (warn once)',
      );
      _warnedMissingReasoningExamples = true;
    }
    return '';
  }

  const copies = Array.isArray(reasoningExamples.copies) ? reasoningExamples.copies : [];
  const fewShots = Array.isArray(reasoningExamples.fewShots) ? reasoningExamples.fewShots : [];
  if (copies.length === 0 && fewShots.length === 0) return '';

  const copiesList = copies.map((c, i) => `  ${i + 1}. ${c}`).join('\n');
  const fewShotsList = fewShots
    .map((f) => `  - chip=${f.chip}, value=${f.value} → "${f.reasoning}"`)
    .join('\n');

  return `[reasoning 메타 카피 규칙 — 각 scene.reasoning 필드]
목적: 칩 선택 툴팁과 "왜 이 선택이 최적인가" 노출. 30~50자 모바일 툴팁 최적.

★ 규칙:
- 타겟 구체 행동/심리 1개 + 결과 1개
- 추상어 금지 ("효과적", "최적화", "적합합니다")
- 숫자 가산점 ("리플레이 확률 ~30% ↑")
- ❌ "이 카테고리에 가장 적합한 톤입니다"
- ✅ "예비부부는 '진짜 그럴까?' 의심형에 댓글 다는 비율이 2배 높음"

★ 카테고리 큐레이션 예시:
${copiesList}

★ few-shot (칩별 reasoning 샘플):
${fewShotsList}`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// [섹션 5] 출력 JSON 스키마 — scriptType에 따른 필드 조정
// ─────────────────────────────────────────────────────────────────────────────
function buildOutputSchemaBlock({ scriptType }) {
  const loopHookField =
    scriptType === 'story'
      ? ''
      : `    "loopHook": "(마지막 씬만) question=첫 질문 재사용, list=키워드 3개 flash, story=생략",`;

  return `[출력 JSON 스키마]
{
  "scenes": [
    {
      "script": "대본 문장 (한국어, 1문장) — 성우가 읽을 내레이션 원본",
      "onScreenText": "화면에 크게 띄울 짧은 구문 (한국어, 반드시 8자 이내, 숫자·단위·핵심 키워드 우선)",
      "section": "hook | point | cta",
      "type": "broll",
      "visual": "구체적인 영어 B-roll 이미지 설명",
      "layoutType": "아래 [비주얼 레이아웃] 17종 중 반드시 하나",
      "layoutProps": "layoutType에 해당하는 데이터 객체 (스키마는 [비주얼 레이아웃] 참조)",
      "hookText": "(scenes[0]만) 화면 강조 문구 (한국어, 8~12자)",
      "hookType": "(scenes[0]만) 질문형|충격형|비밀형|증거형|공감형|경고형",
      "reasoning": "30~50자 툴팁 카피 (왜 이 선택이 최적인지 — 구체 행동/심리 + 결과)"${loopHookField ? ',\n' + loopHookField : ''}
    }
  ],
  "metadata": {
    "scriptType": "(자가 판별) question | list | story",
    "hookTypeChosen": "scenes[0].hookType과 동일"
  }
}

[scenes 규칙]
- scenes 개수는 targetSceneCount와 정확히 일치.
- type은 모든 씬에서 "broll". text 타입 금지.
- visual은 영어 설명 (예: "close-up of hands typing on laptop").
- section은 Hook → Point → CTA 흐름에 맞게 배정.
- onScreenText는 모든 씬에 필수. 8자 초과 시 자동 잘림.
- layoutType은 모든 씬에 필수. 누락 시 텍스트 통문장이 화면에 박힘(실패).`;
}

// ─────────────────────────────────────────────────────────────────────────────
// [섹션 6] 레이아웃 타입 — visualStyle === 'kinetic' 일 때만 활성
// ─────────────────────────────────────────────────────────────────────────────
function buildLayoutTypeBlock({ visualStyle }) {
  // Phase 1 (2026-04-18): visualStyle 무관하게 항상 활성.
  // 이미지 모드에서도 layoutType을 받아 화면 텍스트를 짧게 유지 (SceneCard fallback 방지).
  // visualStyle === 'kinetic' 일 땐 이미지 없이 순수 layoutType으로 렌더.
  const isKineticPure = visualStyle === 'kinetic';

  return `[비주얼 레이아웃 — 17종 (9:16 세로 숏폼, 1080×1920)]
각 씬에 layoutType 필드를 **반드시** 포함하세요. 누락하면 내레이션 통문장이 화면에 박혀 실패.
${isKineticPure ? '이미지 없이 텍스트/데이터 시각화만으로 구성합니다.' : '배경 이미지가 있어도 핵심 시각은 layoutType으로 처리합니다.'}

⚠ 절대 금지: 이모지·이모티콘. layoutProps.icon 필드에도 이모지 금지.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[데이터 시각화 — 숫자·수치·비율 우선 선택]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- "big-impact-text": 단일 숫자 또는 2~3 단어 강조 (예: "1.3억", "3채널")
  layoutProps: { text: "1.3억", highlight?: "1.3" }

- "counter": 0→목표값 카운팅 애니메이션 (매출·회원수·성장치)
  layoutProps: { value: 1000, suffix: "만원", label: "연매출", decimals?: 0 }

- "number-slam": 큰 숫자 바운스 + 서브타이틀 (1~4자 권장)
  layoutProps: { text: "3500+", subtitle?: "누적 상담 쌍" }

- "progress-bar": 단일 퍼센트/비율
  layoutProps: { label: "달성률", percent: 87 }

- "bar-chart": 2~6개 막대 비교 (7개 이상 자동 잘림)
  layoutProps: { bars: [{label:"블로그",value:45,displayValue:"45%",highlight:true},{label:"인스타",value:35,displayValue:"35%"}], maxValue?: 100 }

- "pie-chart": 3~5 조각 비율 원형 (2개 이하·6개 이상 금지)
  layoutProps: { slices: [{label:"마케팅",value:40},{label:"상담",value:35}], centerLabel?: "시간 배분", centerValue?: "100%" }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[관계·프로세스 시각화]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- "flow-diagram": 3~5단계 순차 프로세스 (세로 방향 고정)
  layoutProps: { steps: [{label:"1",title:"조사"},{label:"2",title:"기획"},{label:"3",title:"실행"}], activeIndex?: 2 }

- "comparison": 2열 A vs B 비교 (아이콘 + 제목 + 포인트 2~4개)
  layoutProps: { leftIcon: "X", leftTitle: "기존", leftPoints: ["3시간","수동","실수 多"], rightIcon: "O", rightTitle: "뚝딱툴", rightPoints: ["5분","자동","완벽"], rightHighlight?: true }

- "comparison-chart": 다행 비교표 (feature 3~6행)
  layoutProps: { leftLabel: "기존", rightLabel: "AI 활용", rows: [{feature:"시간",left:"3시간",right:"5분"},{feature:"자동화",left:false,right:true}], highlightRight?: true }

- "venn-diagram": 2 또는 3 원의 교집합 (4개+ 금지)
  layoutProps: { circles: [{label:"전문성"},{label:"AI 활용"},{label:"교육"}], intersectionLabel?: "어나더핸즈" }

- "network": 추상 관계도 (노드·엣지 배치, 난이도 높음 — 꼭 필요할 때만)
  layoutProps: { nodes: [{x:100,y:100},{x:300,y:200}], edges: [[0,1]], width?: 800, height?: 800 }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[텍스트 임팩트]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- "bullet-list": 2~5개 항목 나열 (6개+ 자동 잘림)
  layoutProps: { items: ["ChatGPT","Canva","뚝딱툴"], highlight?: true }

- "emphasis-box": 강조 박스 (아이콘 포함)
  layoutProps: { text: "간이과세 가능", variant?: "check"|"warning"|"info" }

- "strikethrough": 부정→긍정 전환 (특정 단어에 취소선)
  layoutProps: { text: "광고비 0원 달성", strikeWord: "광고비" }

- "vertical-bar": 세로 바 + 짧은 단일 텍스트 (섹션 구분 강조)
  layoutProps: { text: "여기부터 핵심" }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[보조·레이블]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- "small-label": 상단 섹션 태그 (대문자 스타일, 10자 이내)
  layoutProps: { text: "DATA" }

- "subtitle-bar": 하단 자막 바 (이미지 기반 씬에 권장)
  layoutProps: { text: "내레이션 한 줄" }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[layoutType 선택 우선순위]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
① 숫자·%·금액·수량이 있다 → 데이터 시각화 그룹
   - 단일 값 → big-impact-text / number-slam / counter / progress-bar
   - 여러 값 → bar-chart / pie-chart
② 순서·절차·단계 → flow-diagram
③ 두 대상 비교 → comparison (간단) / comparison-chart (표) / venn-diagram (교집합)
④ 추상 관계 → network
⑤ 항목 나열 → bullet-list
⑥ 부정→긍정 전환 → strikethrough
⑦ 단일 강조 → emphasis-box / big-impact-text
⑧ 섹션 구분자 → small-label / vertical-bar

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[필수 규칙]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 모든 씬에 layoutType + layoutProps 필수.
- 대본 전체에서 데이터 시각화 그룹을 최소 2회 이상 사용. 텍스트만 나열 금지.
- hook 씬은 "big-impact-text" 또는 "number-slam" (임팩트 우선).
- cta 씬은 "big-impact-text" 또는 "emphasis-box(variant:check)".
- layoutType 값이 위 17종 중 하나가 아니면 fallback으로 실패.
- layoutProps 필수 필드 누락 시 런타임 크래시 가능 — 각 타입 스키마 정확히 준수.

[예시 — 1인 사업가 AI 활용, 7씬]
{
  "scenes": [
    {"section":"hook","script":"AI 안 쓰는 사장님, 혼자 야근하고 계시죠?","onScreenText":"AI 없이 야근","layoutType":"big-impact-text","layoutProps":{"text":"AI 없이 야근","highlight":"야근"}},
    {"section":"point","script":"하루 업무는 보통 세 단계로 흘러갑니다","onScreenText":"업무 3단계","layoutType":"flow-diagram","layoutProps":{"steps":[{"label":"1","title":"고객 문의"},{"label":"2","title":"견적서"},{"label":"3","title":"SNS 콘텐츠"}]}},
    {"section":"point","script":"AI를 쓰면 매일 4.5시간이 절약됩니다","onScreenText":"4.5시간","layoutType":"counter","layoutProps":{"value":4.5,"decimals":1,"suffix":"시간","label":"하루 절약"}},
    {"section":"point","script":"블로그 인스타 이메일 세 채널에서 고객이 와요","onScreenText":"3채널 유입","layoutType":"bar-chart","layoutProps":{"bars":[{"label":"블로그","value":45,"displayValue":"45%"},{"label":"인스타","value":35,"displayValue":"35%"},{"label":"이메일","value":20,"displayValue":"20%"}]}},
    {"section":"point","script":"기존 방식 대비 시간도 비용도 압도적입니다","onScreenText":"기존 vs AI","layoutType":"comparison-chart","layoutProps":{"leftLabel":"기존","rightLabel":"AI","rows":[{"feature":"시간","left":"3시간","right":"5분"},{"feature":"자동화","left":false,"right":true}],"highlightRight":true}},
    {"section":"point","script":"저처럼 1인 사업가도 AI로 자동화할 수 있어요","onScreenText":"1인 자동화","layoutType":"emphasis-box","layoutProps":{"text":"1인 자동화","variant":"check"}},
    {"section":"cta","script":"오늘부터 시작해보세요","onScreenText":"지금 시작","layoutType":"big-impact-text","layoutProps":{"text":"지금 시작"}}
  ]
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON strictness — 재시도 시 assembler 맨 앞에 unshift
// ─────────────────────────────────────────────────────────────────────────────
function buildJsonStrictnessBlock({ retryAttempt }) {
  if (!retryAttempt || retryAttempt <= 0) return '';
  const total = 3; // 총 시도 횟수 표기 (MAX_RETRIES 2 + 첫 시도 = 3)
  return `[JSON 엄격 모드 — 시도 ${retryAttempt}/${total}]
직전 응답이 JSON으로 파싱되지 않았습니다. 다음 형식을 반드시 지키세요.
- 출력은 순수 JSON 객체 하나. 앞뒤에 어떤 문자·개행도 붙이지 마세요.
- 첫 글자는 { 마지막 글자는 }.
- 마크다운 코드블록 (\`\`\`json, \`\`\`) 금지.
- 주석·설명·서문·후언·이모지 금지.
- 문자열 내부의 "는 반드시 \\"로 이스케이프.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SYSTEM_PROMPT assembler.
 *
 * 섹션 순서:
 *   [strict?] → absoluteRules → firstThreeSeconds → hookFormula → reasoning → outputSchema
 *
 * @param {{
 *   category: string,
 *   scriptType: 'auto'|'question'|'list'|'story',
 *   firstThreeSeconds: 'auto'|'shock'|'number'|'story',
 *   reasoningExamples?: { copies: string[], fewShots: Array<object> },
 *   contentType: 'short' | 'long',
 *   retryAttempt?: number,
 * }} params
 * @returns {string}
 */
export function buildSystemPrompt({
  category,
  scriptType,
  firstThreeSeconds,
  reasoningExamples,
  contentType,
  visualStyle,
  retryAttempt = 0,
} = {}) {
  const sections = [
    buildAbsoluteRulesBlock({ contentType }),
    buildFirstThreeSecondsBlock({ firstThreeSeconds, category }),
    buildHookFormulaBlock({ scriptType, contentType }),
    buildReasoningGuidanceBlock({ reasoningExamples }),
    buildLayoutTypeBlock({ visualStyle }),
    buildOutputSchemaBlock({ scriptType }),
  ];

  if (retryAttempt > 0) {
    sections.unshift(buildJsonStrictnessBlock({ retryAttempt }));
  }

  return sections.filter(Boolean).join('\n\n');
}

/**
 * USER_PROMPT builder.
 *
 * @param {{
 *   topic: string,
 *   tone: 'casual'|'professional',
 *   targetSceneCount: number,
 *   targetDurationSec?: number,
 *   blogText?: string,
 *   personaMemo?: string,
 *   benchmark?: { patterns?: object|null, fallback?: boolean, videos?: Array }|null,
 * }} params
 * @returns {string}
 */
export function buildUserPrompt({
  topic,
  tone,
  targetSceneCount,
  targetDurationSec,
  blogText,
  personaMemo,
  benchmark,
} = {}) {
  const inputSummary = [
    `tone: ${tone || 'casual'}`,
    targetDurationSec ? `targetDuration: ${targetDurationSec}초` : null,
    `targetSceneCount: ${targetSceneCount || 7}`,
    topic ? `topic: ${topic}` : null,
    blogText ? `blogText:\n${blogText}` : null,
    `personaMemo: ${personaMemo && personaMemo.trim() ? personaMemo.trim() : '(없음)'}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  // pre-bbaa553 복원 — benchmark.patterns 가 있으면 주입, 없으면 skip.
  // Why: 2026-04-15 bbaa553 에서 analyzePatterns 가 /analyze 로 분리되며 legacy 주입이 silent fail.
  // 8324aa1 이 죽어 있던 코드를 지웠고, 본 복원은 patterns 생성 경로와 함께 legacy 전용으로 되돌린다.
  let benchmarkSection = '';
  if (benchmark && benchmark.patterns && !benchmark.fallback) {
    const p = benchmark.patterns;
    const videoList = Array.isArray(benchmark.videos)
      ? benchmark.videos
          .slice(0, 3)
          .map((v, i) => {
            const views = (v.viewCount || 0).toLocaleString();
            const subs = (v.subscriberCount || 0).toLocaleString();
            const ratio = Number(v.viewToSubRatio || 0).toFixed(1);
            return `  ${i + 1}. "${v.title}" (조회수 ${views}, 구독자 ${subs}, 비율 ${ratio}배)`;
          })
          .join('\n')
      : '';

    benchmarkSection = `

[★★★ 벤치마킹 — 이 주제에서 먹히는 공식 ★★★]
${videoList ? `실제 바이럴 영상:\n${videoList}\n\n` : ''}공통 패턴 (반드시 동일하게 적용):
1. 후킹 유형: ${p.hookType || '미분석'} → scenes[0]에 이 유형 적용
2. 후킹 패턴: ${p.hookPattern || '미분석'}
3. 대본 구조: ${p.structure || '미분석'}
4. 바이럴 공식: ${p.viralFormula || '미분석'}

추천 첫 문장: "${p.suggestedHook || ''}"

[위반 금지]
- 벤치마킹 후킹/구조/공식을 무시하면 실패.
- 이 규칙은 [절대 규칙]보다 우선합니다.`;
  }

  const promptAssetSection = `

[숏츠 작성 원칙 — 프롬프트 자산]
- 첫 문장은 무조건 단정형. 인사, 배경설명, 서론 금지.
- 한 문장엔 메시지 하나만. 설명보다 판단 먼저.
- 애매한 말 금지: "~일 수 있어요", "~같아요", "~경우가 많아요", "~보통", "~아마".
- 추상어보다 눈앞에 보이는 말을 사용: 구조/메커니즘/전략/설계 대신 순서/시작/한입/배치/타이밍.
- 분석가처럼 쓰지 말고 크리에이터처럼 쓸 것.

[숏츠 흐름]
1. Hook — 상식 파괴, 경고, 반전, 결과 선공개 중 하나로 시작
2. Pain — 왜 이게 문제인지 한 문장으로 찌르기
3. Cause — 사람들이 착각하는 원인을 짧게 부정하고 진짜 원인을 한 줄로 박기
4. Fix — 오늘 바로 할 행동 1~3개만 제시
5. Close — 저장 포인트, 실행 포인트, 짧은 한 방 요약 중 하나로 닫기

[문장 톤]
- 짧고 세게
- 단정적으로
- 사람 말투로
- 잘 쓴 글보다 잘 박히는 말 우선`;

  const targetChars = targetDurationSec ? Math.round(targetDurationSec * 10) : 0;
  const minPerScene = 25;
  const effectiveSceneCount = targetSceneCount || 7;
  const targetCharsHint = targetDurationSec
    ? `- ★ 분량 필수: 모든 scene.script의 글자수 합계(공백 포함) ≥ ${targetChars}자. 이보다 적으면 영상이 ${targetDurationSec}초보다 짧아져 사용자 기대를 배신합니다.
- 각 씬은 최소 ${minPerScene}자, 권장 ${Math.round(targetChars / effectiveSceneCount)}자/씬.`
    : '';

  return `${inputSummary}${benchmarkSection}${promptAssetSection}

위 입력을 바탕으로 숏폼 대본을 scenes 배열로 작성하세요.
- scenes 개수: 정확히 ${effectiveSceneCount}개
${targetCharsHint}
- Hook → Point(공감 루프) → CTA 흐름, 템플릿화 금지.
- personaMemo가 있으면 Point 중 최소 1씬에 가공해 녹이세요.`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 전용 헬퍼 — 세션당 1회 경고 플래그 리셋 (tests/unit/prompt.test.js용)
// 런타임에서는 호출하지 말 것. export는 `@internal` 태그로 소비자 혼동 방지.
// ─────────────────────────────────────────────────────────────────────────────
/** @internal */
export { buildLayoutTypeBlock as _buildLayoutTypeBlock };

export function __resetReasoningWarning() {
  _warnedMissingReasoningExamples = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// [SLIM MODE] buildSystemPromptSlim — 5대 하드 룰 + 17종 스키마만
// spec: docs/superpowers/plans/2026-04-18-shortform-prompt-slim.md
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 17종 layoutType 스키마만 (선택 우선순위·예시 블록은 제외).
 * buildLayoutTypeBlock의 스키마 섹션만 발췌.
 */
function _buildLayoutSchemaOnly() {
  return `[layoutType 17종 — 스키마만. 선택은 대본 의미에 맞춰 자유]

[데이터 시각화]
- "big-impact-text": { text: "1.3억", highlight?: "1.3" }
- "counter": { value: 1000, suffix?: "만원", label?: "연매출", decimals?: 0 }
- "number-slam": { text: "3500+", subtitle?: "누적 상담" }
- "progress-bar": { label: "달성률", percent: 87 }
- "bar-chart": { bars: [{label,value,displayValue?,highlight?}], maxValue?: 100 }
- "pie-chart": { slices: [{label,value}], centerLabel?, centerValue? }

[관계·프로세스]
- "flow-diagram": { steps: [{label,title}], activeIndex?: 2 }
- "comparison": { leftIcon, leftTitle, leftPoints: [..], rightIcon, rightTitle, rightPoints: [..], rightHighlight?: true }
- "comparison-chart": { leftLabel, rightLabel, rows: [{feature,left,right}], highlightRight?: true }
- "venn-diagram": { circles: [{label}], intersectionLabel? }  // 2~3개만
- "network": { nodes: [{x,y}], edges: [[0,1]], width?, height? }

[텍스트 임팩트]
- "bullet-list": { items: ["a","b","c"], highlight?: true }  // 2~5개
- "emphasis-box": { text: "간이과세 가능", variant?: "check"|"warning"|"info" }
- "strikethrough": { text: "광고비 0원 달성", strikeWord: "광고비" }
- "vertical-bar": { text: "여기부터 핵심" }

[보조·레이블]
- "small-label": { text: "DATA" }  // ≤10자
- "subtitle-bar": { text: "내레이션 한 줄" }`;
}

/**
 * SLIM SYSTEM_PROMPT — 5대 하드 룰 + 17종 스키마 + JSON 출력 스키마.
 * 나머지(씬 역할, 후킹 유형, 감정, 시작화 방식)는 모델 자유.
 *
 * @param {{ targetSceneCount?: number }} params
 * @returns {string}
 */
export function buildSystemPromptSlim({ targetSceneCount = 7 } = {}) {
  const schema = _buildLayoutSchemaOnly();

  return `[뚝딱툴 숏폼 대본 생성 — 6대 하드 룰]

1. 출력은 순수 JSON 객체 하나만. 마크다운 코드블록·설명·서문·이모지 금지.
2. 모든 씬에 layoutType(17종 enum 중 하나) + layoutProps 스키마 정확히 준수. 누락 또는 오타 시 렌더 실패.
3. scenes 개수 = ${targetSceneCount}. 모든 씬에 onScreenText 필수 (한국어 8자 이하).
4. 17종 중 데이터 시각화 계열(big-impact-text/counter/number-slam/progress-bar/bar-chart/pie-chart)을 최소 2회 사용. 텍스트 계열만으로 대본 채우지 말 것.
5. 존댓말·구어체만. 문어체·이모지 금지. 외래어는 국립국어원 표기법 준수.
6. captionInstagram + captionYouTube 필수 (둘 다 20자 이상, 서로 다른 본문). 이모지 금지, 존댓말.

${schema}

[출력 JSON 스키마]
{
  "scenes": [
    {
      "script": "내레이션 문장 (한국어 1문장, 성우 낭독용)",
      "onScreenText": "화면 강조 (한국어 8자 이하)",
      "section": "hook | point | cta",
      "type": "broll",
      "visual": "영어 B-roll 설명",
      "layoutType": "17종 enum 중 하나",
      "layoutProps": "layoutType별 스키마 객체 (위 참조)",
      "hookText": "(scenes[0]만 필수) 화면 강조 8~12자",
      "hookType": "(scenes[0]만 필수) 질문형|충격형|비밀형|증거형|공감형|경고형",
      "reasoning": "30~50자 메타 설명 (왜 이 선택인지 — 구체 행동/심리 + 결과)"
    }
  ],
  "captionInstagram": "인스타 릴스 캡션 — 첫 125자가 '더보기' 전 노출. 후킹 1문장 + 본문 + 해시태그 5~10개. 200자 내외.",
  "captionYouTube": "유튜브 숏츠 설명 — 첫 3줄 피드 노출. 후킹 + 본문 + 구독 유도 + 해시태그 3~5개. #Shorts 필수. 300자 내외.",
  "metadata": {
    "scriptType": "question | list | story (자가 판별)",
    "hookTypeChosen": "scenes[0].hookType과 동일"
  }
}

[캡션 하드 룰 — 절대 준수]
- 두 캡션의 **첫 문장은 서로 달라야 함**. scenes[0].script 또는 scenes[마지막].script를 그대로 붙여넣기 금지.
- 두 캡션의 **본문 문장도 서로 달라야 함**. 같은 문장 복붙·순서만 바꾸기 금지. 어휘·어순·어미까지 다르게 다시 쓸 것.
- 인스타: "더보기" 전 125자 안에 scroll-stop 후킹(질문/충격/공감 1문장). CTA는 "저장해두세요"·"프로필에서 더 보세요" 같은 인스타 관습. 링크 불가. 해시태그 5~10개.
- 유튜브: 반드시 #Shorts 해시태그 포함 (피드 편입 필수 조건). 첫 3줄에 핵심 가치 요약. CTA는 "구독 부탁드려요"·"알림 설정까지" 같은 유튜브 관습. 해시태그 3~5개.
- 두 캡션 모두 1인칭 존댓말, 이모지 금지, 해시태그는 한글/영문 혼용 가능.

[캡션 좋은 예시 / 나쁜 예시]
✗ BAD (본문 동일, 해시태그만 다름):
   captionInstagram: "A\n\nB\n\n#릴스 #숏폼"
   captionYouTube:   "A\n\nB\n\n#Shorts"
✓ GOOD (본문이 플랫폼 문법에 맞게 재작성):
   captionInstagram: "저장 안 하면 또 까먹어요. 오늘 이 3가지만 기억하세요…"
   captionYouTube:   "이 영상 하나로 정리 끝. 구독하시면 다음 편 알림 갑니다…"

[자유도 영역 — 모델 판단]
- 씬별 시작화·감정 표현·문장 리듬: 주제와 userPrompt의 벤치마크에 맞춰 자유 배치.
- 대본 흐름: Hook → Point → CTA. 세부 씬 역할은 자유.
- 같은 말 반복 금지. 씬마다 새 정보 제공.
- 숫자는 구체화 ("많이" → "87%", "대부분" → "10명 중 8명").
- 첫 씬은 scroll-stop이 최우선 — 첫 2초에 멈출 말로 hookText·hookType 채우기.`;
}
