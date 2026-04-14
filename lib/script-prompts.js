/**
 * Phase D — 페르소나 aware 숏폼 대본 프롬프트 빌더.
 *
 * 기존 app/api/shortform-script/route.js 의 SYSTEM_PROMPT 핵심 노하우
 * (후킹 6종, 공감 루프 구조, 메모 녹임)는 유지하고 hard rules +
 * 페르소나 1인칭 + 벤치마킹 aggregated 섹션을 추가.
 *
 * 스펙 §6 참고.
 */
import { getPersona, buildCustomPersona, PERSONAS } from '@/lib/shortform-personas';

const SCENE_COUNTS = { 30: 7, 45: 10, 60: 14, 90: 20 };

// 롱폼: 고정 7씬 (Hook / Body1~4 / Conclusion / CTA)
export const LONGFORM_SCENE_COUNT = 7;

// 유효 scene types (프롬프트 출력 스키마에서 허용)
export const SCENE_TYPES = ['text', 'comparison', 'emphasis', 'testimonial', 'data', 'flow'];

/**
 * Hard rules — 위반 시 결과 폐기 대상.
 * 프롬프트 최상단에 절대 규칙으로 주입.
 */
export const HARD_RULES = [
  '자막에 이모지 사용 금지 (전문성 손상). 🎯 ✨ 💡 등 어떤 유니코드 이모지도 넣지 말 것.',
  '화자는 사용자가 선택한 페르소나의 1인칭 시점을 끝까지 유지. 3인칭 설명조 금지.',
  'AI 양산 느낌의 일반론 금지. "~이 중요합니다", "필수입니다" 같은 뻔한 표현 대신 구체적 경험·숫자·고유명사 반영.',
  '첫 3초 후킹은 벤치마킹 패턴(aggregated.dominantHookType)을 그대로 적용. 벤치마크가 number-list면 숫자형 후킹, question이면 질문형 등.',
  '본인 등장 비율은 벤치마킹 personPresenceMode 권장값 따름. high면 화자의 1인칭 목격담 2회 이상.',
  'CTA는 벤치마킹 패턴(commonCTAType)의 형식 유지. 댓글/DM/팔로우 중 하나.',
];

function resolvePersona(personaId, customPersonaLabel, customPersonaHint) {
  if (personaId === 'custom') {
    return buildCustomPersona(customPersonaLabel, customPersonaHint);
  }
  return getPersona(personaId) || PERSONAS[0];
}

/**
 * 시스템 프롬프트 — 페르소나/톤/벤치마크 주입.
 *
 * 입력:
 * - personaId: 'store-owner' | 'blogger' | ... | 'custom'
 * - customPersonaLabel: id='custom' 일 때 사용자 직접 입력
 * - customPersonaHint: custom 1인칭 힌트
 * - tone: 'professional' | 'casual'
 * - hasBenchmark: boolean — 벤치마킹 aggregated 데이터 존재 여부
 * - brandContext: string | null — lib/brand-kit.js buildPromptContextForEmail 결과
 */
export function buildSystemPrompt({
  personaId,
  customPersonaLabel,
  customPersonaHint,
  tone,
  hasBenchmark,
  brandContext,
  contentType = 'shortform',
}) {
  const persona = resolvePersona(personaId, customPersonaLabel, customPersonaHint);
  const isLongform = contentType === 'longform';

  const toneLabel = tone === 'professional' ? '전문가 (신뢰감, 정확한 정보)' : '친근한 친구 (편안하고 따뜻)';

  const rulesBlock = HARD_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n');

  const benchmarkBlock = hasBenchmark
    ? `[벤치마킹 활용 방침]
사용자 메시지에 "벤치마킹 aggregated" 섹션이 포함됩니다. 그 JSON의 dominantHookType / dominantBodyStructure / dominantTone / personPresenceMode / recommendedPreset / advice를 **반드시** 대본 구조에 반영하세요. 무시하고 다른 구조로 작성하면 결과 폐기.`
    : `[벤치마킹 미제공]
벤치마킹 데이터가 없으므로 기본 공감 루프 구조(아래)에 따라 작성.`;

  const brandBlock = brandContext
    ? `

# 사용자 브랜드 킷 (가능하면 자연스럽게 녹여 쓸 것)
${brandContext}

- 위 정보를 모든 씬에 쑤셔넣지 마세요. signature_intro는 Hook 뒤에 한 번만, signature_outro/default_cta는 마지막 씬에만.
- 가게명/업종은 1인칭 맥락이 자연스러운 씬에서만 사용.`
    : '';

  const formatIntro = isLongform
    ? `당신은 자영업자를 위한 한국어 롱폼 영상 대본 작가입니다.
사용자의 블로그 글과 본인 경험을 베이스로, 벤치마킹 패턴을 적용해 자기 목소리로 만들 수 있는 3~10분 롱폼 대본을 작성합니다.`
    : `당신은 자영업자를 위한 한국어 숏폼 영상 대본 작가입니다.
사용자의 블로그 글과 본인 경험을 베이스로, 벤치마킹 패턴을 적용해 자기 목소리로 만들 수 있는 30~90초 대본을 작성합니다.`;

  const structureBlock = isLongform
    ? `# 대본 구조 — 롱폼 7씬 고정 (Hook / Body1~4 / Conclusion / CTA)
롱폼은 시청자 집중력이 긴 대신, 각 씬이 시각적으로도 달라야 이탈을 막습니다.

▶ scenes[0] Hook — 공감 질문 / 충격 / 통념 뒤집기 (숏폼과 동일한 후킹 공식)
▶ scenes[1] Body 1 — 문제/상황 구체화
▶ scenes[2] Body 2 — 기존 접근의 한계 (통념 깨기)
▶ scenes[3] Body 3 — 해법/노하우
▶ scenes[4] Body 4 — 구체 사례 / 경험담 (메모 핵심 녹임 지점)
▶ scenes[5] Conclusion — 요약 + 한 줄 정리 (emphasis / data 타입 권장)
▶ scenes[6] CTA — 댓글/팔로우/DM 중 벤치마킹 commonCTAType

총 글자수 가이드:
- 3분 롱폼 → 각 씬 약 200자 (총 1400자 내외)
- 5분 롱폼 → 각 씬 약 350자 (총 2450자 내외)
- 10분 롱폼 → 각 씬 약 700자 (총 4900자 내외)
숏폼보다 씬당 5~8배 긴 대본. 한 씬이 한 단락 이상으로 풍성해야 합니다.

# 씬 타입 다양성 규칙 (롱폼 필수)
각 씬에 "type" 필드 명시 — 허용값: 'text' | 'comparison' | 'emphasis' | 'testimonial' | 'data' | 'flow'
- 롱폼 7씬 중 최소 5~6개 서로 다른 타입을 사용하세요 (단조로우면 중도 이탈).
- 인접 두 씬이 같은 type 금지 (Body1=comparison, Body2=comparison ❌).
- Conclusion(scenes[5])은 emphasis 또는 data 권장.
- Hook(scenes[0])과 CTA(scenes[6])는 'text' 고정.
- typeProps는 선택 — 타입별 세부 데이터 (비교표의 좌/우 항목, data의 수치 등).
  ★ 모르면 비워두고 script만 충실히. BodyScene이 text 폴백으로 처리합니다.`
    : `# 대본 구조 — fingr식 공감 루프
도입부 1/3까지 시청자가 "내 이야긴가?" 느끼게 만들어 끝까지 보게 함.
▶ 7씬 (30초) — 공감 질문 / 마음읽기 / 상황 / 통념 깨기 / 약속 / 사례 / CTA
▶ 10씬 (45초) — 7씬 base + 마음읽기2 + 사례2 + 작은 약속
▶ 14+ 씬 (60~90초) — 10씬 base에 반복

# 씬 타입 다양성 규칙 (숏폼)
각 씬에 "type" 필드 명시 — 허용값: 'text' | 'comparison' | 'emphasis' | 'testimonial' | 'data' | 'flow'
- 숏폼 scenes 전체에서 **최소 2~3개 서로 다른 type** 사용 (시각적 다양성).
  예) [text, comparison, text, data, ..., text] 또는 [text, emphasis, testimonial, ..., text]
- Hook(scenes[0])과 CTA(마지막)는 'text' 고정.
- 인접 씬이 같은 type이어도 허용 (숏폼은 짧아서 덜 엄격).
- typeProps는 선택 — 모르면 비워두고 script만 작성. BodyScene이 text 폴백.`;

  const outputSchema = isLongform
    ? `# 출력 형식 (JSON만, 다른 텍스트 금지)
{
  "scenes": [
    {
      "section": "hook",
      "type": "text",
      "script": "첫 문장 — 벤치마킹 후킹 유형 적용 (200~700자, 길이에 비례)",
      "hookType": "질문형",
      "hookText": "화면에 크게 표시할 12자 이내 한국어 문구",
      "visual": "본인 사진|AI이미지|텍스트카드 중 택1 + 영문 비주얼 가이드"
    },
    { "section": "body1", "type": "comparison", "script": "...", "typeProps": { "left": "...", "right": "..." }, "visual": "..." },
    { "section": "body2", "type": "emphasis", "script": "...", "visual": "..." },
    { "section": "body3", "type": "data", "script": "...", "typeProps": { "stat": "87%", "label": "..." }, "visual": "..." },
    { "section": "body4", "type": "testimonial", "script": "...", "visual": "..." },
    { "section": "conclusion", "type": "emphasis", "script": "요약 + 한 줄 정리", "visual": "..." },
    { "section": "cta", "type": "text", "script": "...", "visual": "..." }
  ],
  "totalDuration": 180,
  "presetUsed": "친근",
  "caption": "영상 캡션 — 이모지 금지 + 해시태그 포함"
}`
    : `# 출력 형식 (JSON만, 다른 텍스트 금지)
{
  "scenes": [
    {
      "section": "hook",
      "type": "text",
      "script": "첫 문장 — 벤치마킹 후킹 유형 적용",
      "hookType": "질문형",
      "hookText": "화면에 크게 표시할 12자 이내 한국어 문구",
      "visual": "본인 사진|AI이미지|텍스트카드 중 택1 + 영문 비주얼 가이드"
    },
    { "section": "point", "type": "comparison", "script": "...", "typeProps": { "left": "...", "right": "..." }, "visual": "..." },
    { "section": "point", "type": "text", "script": "...", "visual": "..." },
    { "section": "cta", "type": "text", "script": "...", "visual": "..." }
  ],
  "totalDuration": 45,
  "presetUsed": "친근",
  "caption": "영상 캡션 — 이모지 금지 + 해시태그 포함"
}`;

  return `${formatIntro}

# 절대 규칙 (위반 시 결과 폐기)
${rulesBlock}

# 화자 페르소나
- ID: ${persona.id}
- 라벨: ${persona.label}
- 설명: ${persona.description}
- 1인칭 표현: ${persona.firstPerson}
- 보이스 큐: ${persona.voiceCues}
- 오프닝 샘플: ${persona.sampleOpening}

위 1인칭 표현과 보이스 큐를 대본 전반에 녹이세요. "저희 가게에서는", "제가 작업하면서" 같은 표현이 자연스럽게 등장해야 합니다.

# 톤
${toneLabel}
${brandBlock}

${benchmarkBlock}

# 후킹 공식 6종 (벤치마킹이 없거나 general 유형일 때)
모든 후킹은 시청자가 "내 얘긴가?" 느끼게 만드는 게 출발점.
★ GOOD 후킹 유형:
1. 질문형: "요즘 ~ 많이 힘드시죠?"
2. 충격형: "매출 줄어드는 거, 단순 경기 탓이 아닙니다"
3. 비밀형: "~인 사장님들만 아는 전략"
4. 증거형: "이것 하나 바꿨더니 한 달 만에 ~"
5. 공감형: "저도 ~로 6개월 헤맸어요"
6. 경고형: "이 실수 하나가 ~을 다 날립니다"

scenes[0]에 "hookType" 필드로 사용한 유형 명시.

${structureBlock}

# Point/Body 작성 규칙
- 추상 나열 금지. 구체 장면/숫자/감정만.
- 메모(userExperience)가 있으면 최소 2씬에 활용:
  1) 한 씬은 메모의 정체성 살림 — "15년차 디자이너인데"
  2) 다른 한 씬은 메모의 구체 장면/숫자 압축 인용
- 메모가 없으면 관찰형 1인칭 ("저도 처음엔 ~", "~하시는 분들 많으세요")
- 금지: "AI는 적이 아닙니다", "~이 중요합니다" 같은 선언문 나열

${outputSchema}

# 캡션 작성 규칙
- 길이: 벤치마킹 captionPattern.averageLength (없으면 200자 내외)
- 구조: captionPattern.dominantStructure (기본: 후킹 한 줄 + 본문 + 해시태그)
- 해시태그 개수: captionPattern.averageHashtagCount (기본 4~6개)
- 추천 해시태그 우선: captionPattern.commonHashtags
- 첫 줄: 영상 후킹과 연결되는 한 문장
- 본문: 영상 핵심 가치 1~2문장
- CTA: commonCTAType 형식 유지
- 이모지 금지, 페르소나 1인칭 유지`;
}

/**
 * 사용자 메시지 빌더.
 *
 * 입력:
 * - blogText, keywords, userExperience
 * - personaId, customPersonaLabel, tone, durationSec
 * - benchmarkAggregated: Gemini 분석 JSON (Phase B 결과) 또는 null
 */
export function buildUserMessage({
  blogText,
  keywords,
  userExperience,
  personaId,
  customPersonaLabel,
  customPersonaHint,
  tone,
  durationSec,
  benchmarkAggregated,
  contentType = 'shortform',
}) {
  const isLongform = contentType === 'longform';
  const sceneCount = isLongform
    ? LONGFORM_SCENE_COUNT
    : (SCENE_COUNTS[durationSec] || SCENE_COUNTS[30]);
  const persona = resolvePersona(personaId, customPersonaLabel, customPersonaHint);

  const parts = [];

  parts.push(`# 베이스 콘텐츠`);
  if (blogText) {
    parts.push(`[블로그 글]\n${blogText.trim()}`);
  } else if (keywords) {
    parts.push(`[키워드]\n${keywords}`);
  } else {
    parts.push(`(입력 없음)`);
  }

  parts.push(`\n# 사용자 본인의 경험·느낌 (가장 중요 — 반드시 2씬 이상 녹일 것)\n${userExperience || '(입력 없음 — 관찰형 1인칭으로 대체)'}`);

  parts.push(`\n# 사용자 정체성
- 화자: ${persona.label} (${persona.description})
- 1인칭 표현: ${persona.firstPerson}
- 톤: ${tone === 'professional' ? '전문가' : '친근한 친구'}`);

  const expectedTotalChars = durationSec * 5;
  const lengthLabel = isLongform
    ? `${Math.round(durationSec / 60)}분 (${durationSec}초)`
    : `${durationSec}초`;

  parts.push(`\n# 영상 사양
- 콘텐츠 타입: ${isLongform ? '롱폼 (longform)' : '숏폼 (shortform)'}
- 길이: ${lengthLabel}
- scenes 개수: 정확히 ${sceneCount}개${isLongform ? ' (Hook / Body1~4 / Conclusion / CTA 순서 고정)' : ''}
- 총 글자수(공백 제외): 약 ${expectedTotalChars}자 (한국어 내레이션 기준)
- 각 씬에 type 필드 필수 — ${isLongform ? '5~6개 서로 다른 type 사용, 인접 중복 금지' : '2~3개 서로 다른 type 사용'}`);

  if (benchmarkAggregated) {
    parts.push(`\n# 벤치마킹 aggregated (Gemini 분석)
\`\`\`json
${JSON.stringify(benchmarkAggregated, null, 2)}
\`\`\`

위 JSON의 dominantHookType / dominantBodyStructure / personPresenceMode / recommendedPreset / advice / captionPattern 을 반드시 대본과 캡션에 반영하세요. advice 문장에 나온 지시사항은 최우선.`);
  } else {
    parts.push(`\n# 벤치마킹 (미제공)
벤치마킹 데이터가 없습니다. 기본 공감 루프 구조 + 후킹 6종 중 토픽에 맞는 유형 선택.`);
  }

  const sectionNote = isLongform
    ? `\n- scenes[0].section="hook", scenes[1~4].section="body1"~"body4", scenes[5].section="conclusion", scenes[6].section="cta" 로 정확히 지정`
    : '';

  parts.push(`\n# 출력
위 입력을 바탕으로 JSON 하나만 반환하세요. scenes 개수 ${sceneCount}개 정확히, caption 필드 포함. 이모지 금지. 페르소나 1인칭 유지.${sectionNote}`);

  return parts.join('\n');
}
