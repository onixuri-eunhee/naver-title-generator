import { resolveAdmin, setCorsHeaders, extractToken, resolveSessionEmail, getRedis, getClientIp } from './_helpers.js';
import { getDb, logUsage } from './_db.js';

export const config = { maxDuration: 60 };

const SHORTFORM_CREDIT_COSTS = { 30: 7, 45: 10, 60: 14, 90: 18 };
const MODEL = 'claude-sonnet-4-20250514';

const SCENE_COUNTS = { 30: 7, 45: 10, 60: 14, 90: 20 };

const CONCEPTS = {
  cinematic: {
    visualStyle: 'warm cinematic, golden hour lighting, shallow depth of field, film grain',
    textCard: 'dark-gradient',
  },
  minimal: {
    visualStyle: 'clean minimal, white background, soft shadows, modern aesthetic',
    textCard: 'white-clean',
  },
  dynamic: {
    visualStyle: 'vibrant colors, high contrast, bold composition, urban energy',
    textCard: 'bold-accent',
  },
  natural: {
    visualStyle: 'natural daylight, candid feel, organic textures, everyday life',
    textCard: 'soft-overlay',
  },
};

function resolveConcept(concept) {
  if (concept === 'random') {
    const keys = Object.keys(CONCEPTS);
    const picked = keys[Math.floor(Math.random() * keys.length)];
    return { key: picked, ...CONCEPTS[picked] };
  }
  return CONCEPTS[concept] ? { key: concept, ...CONCEPTS[concept] } : { key: 'cinematic', ...CONCEPTS.cinematic };
}

export const SYSTEM_PROMPT = `당신은 한국어 숏폼 영상 대본 작가입니다. 사용자의 입력을 바탕으로 숏폼 대본을 scenes 배열로 작성하세요.

[절대 규칙]
1. 반드시 존댓말만 사용하세요. 반말, 유행어 남발, 과장된 말투는 금지입니다.
2. 출력은 설명 없이 순수 JSON 객체 하나만 반환하세요. 마크다운 코드블록, 부가 설명, 서문 금지입니다.
3. 사실은 사용자가 제공한 topic과 blogText 안에서만 사용하세요. 입력에 없는 구체적 수치나 사례를 지어내지 마세요.
4. 구어체로 자연스러운 내레이션 문장을 작성하세요. 문어체 금지.
5. 한 문장에 하나의 정보만. 숫자는 구체적으로 (많이→87%, 대부분→10명 중 8명).
6. 같은 말 반복 절대 금지. 씬마다 반드시 새로운 정보를 전달하세요. 표현만 바꿔 같은 내용을 되풀이하면 실패입니다.
7. 한 씬의 script는 최대 28자(공백 포함). 28자를 넘기면 씬을 나누세요. 짧은 문장이 임팩트 있습니다.

[후킹 공식 — 6종 다양성 유지, 공감 베이스]
모든 후킹은 시청자가 "내 얘긴가?" 느끼게 만드는 게 출발점입니다.
6종 중 토픽에 가장 잘 맞는 것을 매번 다르게 선택해 다양성 확보. 같은 운영자가 5개 영상 만들면 5개가 다 다른 유형이어야 합니다.

★ BAD (이렇게 쓰면 0점):
- "안녕하세요", "오늘은 ~에 대해 알아볼게요", "여러분 ~"
- "~해보셨나요?" (그냥 yes/no 질문)
- "~이 중요합니다" (누구나 아는 말)

★ GOOD 후킹 유형 6종 + 예시:
1. 질문형 (공감 질문 default): "요즘 ~ 많이 힘드시죠?" / "블로그 하루 3시간 쓰는데 왜 방문자가 10명일까요?"
2. 충격형 (공감 베이스 통념 뒤집기): "매출 줄어드는 거, 단순 경기 탓이 아닙니다" / "키워드 검색량, 높을수록 좋다고요? 틀렸습니다"
3. 비밀형 (희소성): "~인 사장님들만 아는 전략이 있어요" / "상위 1% 블로거만 쓰는 기능이 있습니다"
4. 증거형 (구체 결과): "이것 하나 바꿨더니 한 달 만에 ~" / "이 설정 하나로 방문자 3배"
5. 공감형 (고통 동일시): "저도 ~로 6개월 헤맸어요" / "매일 글 쓰는데 상위노출 안 되죠?"
6. 경고형 (손실 경고): "이 실수 하나가 ~을 다 날립니다" / "이거 모르고 쓰면 광고비만 새요"

★ 후킹 품질 체크리스트 (scenes[0] 작성 후 자가검증):
□ 첫 문장만 읽고도 "다음이 궁금한가?" → 아니면 다시 쓰세요
□ 시청자가 "내 얘긴가?" 느끼는가?
□ 구체적 숫자나 기간이 들어갔는가? (3배, 6개월, 10명 등)
□ "~에 대해 알아볼게요" 패턴이 아닌가?

[대본 구조 — fingr식 공감 루프]
도입부 1/3까지 시청자가 "내 이야긴가?" 느끼게 만들어 끝까지 보게 합니다.
총 씬 수에 따라 다음 구조를 base로 삼되, 변주를 허용합니다.

▶ 7씬 (30초) — 1사이클:
  scene[0] 공감 질문 (Hook)
  scene[1] 마음읽기 질문 — "솔직히 ~ 싶으셨을 거예요"
  scene[2] 상황 설명 — "그런데 사실 ~"
  scene[3] 통념 깨기 — "이건 ~ 때문이 아니라 ~"
  scene[4] 약속/해법 — "이렇게 하면 ~"
  scene[5] 사례 + 경험 (메모 녹임 지점) — "어제 ~했어요"
  scene[6] CTA 동료 호출

▶ 10씬 (45초) — 1.5사이클: 7씬 base + scene[5~8]에 [마음읽기2 / 사례2 / 작은 약속] 삽입
▶ 14씬+ (60~90초) — 2사이클+: 10씬 base에 [추가 마음읽기 / 두 번째 사례 / 작은 약속] 자유 반복

★ scene[1]은 반드시 마음읽기 질문 형태로 작성하세요. ("솔직히 ~", "혹시 ~ 아니세요?", "~ 싶으셨을 거예요")
★ 구조 변주 강제: 같은 base여도 매번 표현·순서가 달라야 합니다. 템플릿화 금지.

[Point 작성 규칙]
- 추상 나열 금지. 구체 장면/숫자/감정만 씁니다.

  ★ 메모(personaMemo)가 있으면: Point 중 최소 1씬은 메모를 28자 압축 가공.
    원문 그대로 X — 핵심 감정/장면/숫자만 추출해 숏폼 톤으로 재구성.
    예) 메모 "15년차 헤어 디자이너, 손님이 '여기 물 맛있다'고 했을 때 뿌듯했음"
        → 씬 "손님이 '물 맛있다' 한마디에 울컥했어요"

  ★ 메모가 없으면: 관찰형 1인칭 허용 — "~인 분들 많으세요", "저도 처음엔 ~인 줄 알았는데"

  ★ 나열 vs 경험 예시 (반드시 후자):
    ❌ "키워드 분석, 카테고리 설정, 콘텐츠 발행이 중요합니다"
    ⭕ "어제 알림 50개 떴어요"
    ❌ "꾸준한 노력이 필요합니다"
    ⭕ "6개월간 매일 쓰다가 한 달 쉬었더니 다 무너졌어요"

[CTA 작성 규칙]
- 마지막 1~2씬은 정형 문구 금지. 시청자를 동료로 호출하세요.

  ★ 금지 문구 (이걸 쓰면 실패):
    "궁금한 점 댓글로 남겨주세요"
    "유용했다면 팔로우 부탁드려요"
    "도움 됐으면 좋아요"
    "나중에 다시 보려면 저장해두세요"
    "감사합니다"

  ★ 허용 톤 예시:
    "혹시 비슷한 경험 있으면 댓글로 알려주세요"
    "다음 영상에서 더 깊이 다뤄볼까요?"
    메모 있을 때: "저처럼 [메모 핵심 키워드]로 고민이라면 댓글 남겨주세요"

  ★ CTA도 28자 제약 동일 적용

[첫 씬 규칙 — 매우 중요]
- scenes[0]은 반드시 type: "broll" (텍스트 카드 아님)
- scenes[0]의 script는 후킹 공식을 적용한 강렬한 첫 문장
- scenes[0]의 visual은 "scroll-stopping"한 구체적 영어 이미지 설명 (dramatic, high contrast, cinematic 포함)
- scenes[0]에 hookText 필드 추가: 화면에 크게 표시할 후킹 핵심 문구 (한국어, 12자 이내, 임팩트 있게)

[출력 JSON 스키마]
{
  "scenes": [
    {
      "script": "대본 문장 (한국어, 1문장, 최대 28자)",
      "section": "hook | point | cta",
      "type": "broll",
      "visual": "구체적인 영어 B-roll 이미지 설명",
      "hookText": "(첫 씬만) 화면에 크게 표시할 후킹 문구 (한국어, 12자 이내)"
    }
  ]
}

[scenes 규칙]
- scenes 개수는 targetSceneCount에 맞추세요
- 각 scene의 script는 반드시 1문장, 최대 28자(공백 포함). 28자 넘으면 씬을 나누세요. SEDA 원칙: 짧고(Short), 쉽고(Easy), 직접적이고(Direct), 행동을 유도(Actionable).
- type은 모든 씬에서 반드시 "broll"만 사용. text 타입은 사용 금지.
- visual은 구체적인 영어 이미지 설명 (예: "close-up of hands typing on laptop")
- section은 Hook → Point → CTA 흐름에 맞게 배정
- hookText는 scenes[0]에만 포함, 나머지 씬에는 생략
`;

export function buildUserPrompt(topic, blogText, tone, targetDurationSec, targetSceneCount, benchmark) {
  const inputSummary = [
    `tone: ${tone}`,
    `targetDuration: ${targetDurationSec}초`,
    `targetSceneCount: ${targetSceneCount}`,
    topic ? `topic: ${topic}` : null,
    blogText ? `blogText:\n${blogText}` : null,
  ].filter(Boolean).join('\n\n');

  // 벤치마킹 결과가 있으면 프롬프트에 주입
  let benchmarkSection = '';
  if (benchmark && benchmark.patterns && !benchmark.fallback) {
    const p = benchmark.patterns;
    const videoList = (benchmark.videos || []).slice(0, 3).map((v, i) =>
      `  ${i + 1}. "${v.title}" (조회수 ${(v.viewCount || 0).toLocaleString()}, 구독자 ${(v.subscriberCount || 0).toLocaleString()}, 비율 ${(v.viewToSubRatio || 0).toFixed(1)}배)`
    ).join('\n');

    benchmarkSection = `

[★★★ 벤치마킹 — 이 키워드에서 실제로 조회수가 터진 공식. 이 규칙을 어기면 실패 ★★★]

실제 바이럴 영상 (구독자 낮은데 조회수 높은 영상):
${videoList}

이 영상들의 공통 패턴 (반드시 동일하게 적용):
1. 후킹 유형: ${p.hookType || '미분석'} → scenes[0]에 이 유형 그대로 적용
2. 후킹 패턴: ${p.hookPattern || '미분석'} → 이 패턴대로 첫 문장 구성
3. 대본 구조: ${p.structure || '미분석'} → 이 구조를 그대로 따를 것
4. 바이럴 공식: ${p.viralFormula || '미분석'} → 모든 씬에 이 공식 적용

추천 첫 문장: "${p.suggestedHook || ''}"
→ 이 문장의 구조와 톤을 유지하면서 더 강렬하게 변형

[위반 금지]
- 벤치마킹 후킹 유형을 무시하고 다른 유형을 쓰면 실패
- 벤치마킹 대본 구조와 다른 구조를 쓰면 실패
- 벤치마킹 바이럴 공식을 반영하지 않으면 실패
- 이 규칙은 [절대 규칙]보다 우선합니다`;
  }

  return `${inputSummary}${benchmarkSection}

위 입력을 바탕으로 숏폼 영상 대본을 scenes 배열로 작성하세요.
- scenes 개수: 정확히 ${targetSceneCount}개
- 각 scene의 script를 합산한 총 글자수(공백 제외)가 ${targetDurationSec}초 분량에 맞아야 합니다 (약 ${targetDurationSec * 5}자).
- Hook, Point, CTA가 각각 뚜렷해야 합니다.
- 너무 긴 서론 없이 바로 몰입되게 시작하세요.`;
}

function extractClaudeText(data) {
  return (data?.content || [])
    .filter(block => block?.type === 'text' && block?.text)
    .map(block => block.text)
    .join('\n')
    .trim();
}

function extractJsonObject(rawText) {
  const trimmed = rawText.trim();

  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }

  const start = trimmed.indexOf('{');
  if (start === -1) {
    throw new Error('Claude 응답에서 JSON 객체를 찾을 수 없습니다.');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return JSON.parse(trimmed.slice(start, i + 1));
    }
  }

  throw new Error('Claude 응답 JSON 파싱에 실패했습니다.');
}

function toSentence(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function postProcessScenes(scenes, targetSceneCount) {
  if (!Array.isArray(scenes) || scenes.length === 0) return scenes;

  // 1. 씬 수 보정
  while (scenes.length < targetSceneCount && scenes.length > 0) {
    const longest = scenes.reduce((max, s, i) => s.script.length > (scenes[max]?.script.length || 0) ? i : max, 0);
    const s = scenes[longest];
    const mid = Math.ceil(s.script.length / 2);
    const breakAt = s.script.indexOf('.', mid - 10);
    const splitPos = breakAt > 0 && breakAt < s.script.length - 2 ? breakAt + 1 : mid;
    const first = { ...s, script: s.script.slice(0, splitPos).trim() };
    const second = { ...s, script: s.script.slice(splitPos).trim() };
    scenes.splice(longest, 1, first, second);
  }
  while (scenes.length > targetSceneCount && scenes.length > 1) {
    let shortestIdx = 0;
    for (let i = 1; i < scenes.length - 1; i++) {
      if (scenes[i].script.length < scenes[shortestIdx].script.length) shortestIdx = i;
    }
    const mergeWith = shortestIdx > 0 ? shortestIdx - 1 : shortestIdx + 1;
    const [a, b] = shortestIdx < mergeWith ? [shortestIdx, mergeWith] : [mergeWith, shortestIdx];
    scenes[a] = { ...scenes[a], script: scenes[a].script + ' ' + scenes[b].script };
    scenes.splice(b, 1);
  }

  // 2. 첫 씬 broll 강제 + hookText 보정
  if (scenes[0] && scenes[0].type !== 'broll') {
    scenes[0] = { ...scenes[0], type: 'broll', visual: 'scroll-stopping dramatic cinematic visual for the narration' };
  }
  if (scenes[0] && !scenes[0].hookText) {
    scenes[0].hookText = scenes[0].script.replace(/[^가-힣a-zA-Z0-9\s]/g, '').slice(0, 12);
  }

  // 3. 모든 씬을 broll로 강제 (텍스트 카드 폐지)
  scenes.forEach(s => {
    if (s.type !== 'broll') {
      s.type = 'broll';
      if (!s.visual || !/[a-zA-Z]/.test(s.visual)) {
        s.visual = 'supporting visual for the narration';
      }
    }
  });

  return scenes;
}

function buildScriptPayload(parsed, concept, targetSceneCount) {
  let scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];

  scenes = scenes.filter(s => s && typeof s.script === 'string' && s.script.trim());
  scenes.forEach(s => {
    s.script = toSentence(s.script);
    s.section = ['hook', 'point', 'cta'].includes(s.section) ? s.section : 'point';
    s.type = 'broll';
    s.visual = toSentence(s.visual) || (s.type === 'broll' ? 'generic B-roll scene' : s.script.slice(0, 15));
  });

  if (scenes.length < 3) {
    throw new Error('Claude 응답에서 유효한 scenes가 3개 미만입니다.');
  }

  scenes = postProcessScenes(scenes, targetSceneCount);

  const visualStyle = concept.visualStyle;
  const textCardTemplate = concept.textCard;

  const hook = scenes.filter(s => s.section === 'hook').map(s => s.script).join(' ');
  const points = scenes.filter(s => s.section === 'point').map(s => s.script);
  const cta = scenes.filter(s => s.section === 'cta').map(s => s.script).join(' ');
  const fullScript = scenes.map(s => s.script).join('\n\n');
  const spokenLength = fullScript.replace(/\s+/g, '').length;
  const estimatedSeconds = Math.max(1, Math.round(spokenLength / 5));

  const hookText = scenes[0]?.hookText || '';

  return {
    hook,
    points,
    cta,
    fullScript,
    estimatedSeconds,
    scenes,
    visualStyle,
    textCardTemplate,
    conceptKey: concept.key,
    hookText,
  };
}

// ── 벤치마킹 내부 호출 ──
async function fetchBenchmark(keyword, authHeader) {
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/shortform-benchmark`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({ keyword }),
    });
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn('[SHORTFORM-SCRIPT] Benchmark fetch failed:', e.message);
  }
  return { fallback: true, videos: [], patterns: null };
}

async function callClaude(topic, blogText, tone, targetDurationSec, concept, targetSceneCount, benchmark) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured.');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(topic, blogText, tone, targetDurationSec, targetSceneCount, benchmark) }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return buildScriptPayload(extractJsonObject(extractClaudeText(data)), concept, targetSceneCount);
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      const isAdmin = await resolveAdmin(req);
      if (isAdmin) {
        return res.status(200).json({ remaining: 999, admin: true, creditCosts: SHORTFORM_CREDIT_COSTS });
      }

      const email = await resolveSessionEmail(extractToken(req));
      if (!email) {
        return res.status(200).json({ remaining: 0, loginRequired: true, creditCosts: SHORTFORM_CREDIT_COSTS });
      }

      // 무료 체험 사용 여부 확인
      const freeUsed = await getRedis().get(`shortform-free:${email}`);
      const sql = getDb();
      const [user] = await sql`SELECT credits FROM users WHERE email = ${email}`;

      return res.status(200).json({
        freeAvailable: !freeUsed,
        credits: user?.credits || 0,
        creditCosts: SHORTFORM_CREDIT_COSTS,
      });
    } catch {
      return res.status(200).json({ remaining: 0, creditCosts: SHORTFORM_CREDIT_COSTS });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const topic = toSentence(body.topic);
    const blogText = String(body.blogText || '').trim();
    const tone = body.tone === 'professional' ? 'professional' : 'casual';
    const targetDurationSec = [30, 45, 60, 90].includes(Number(body.targetDurationSec)) ? Number(body.targetDurationSec) : 30;

    const conceptInput = ['cinematic', 'minimal', 'dynamic', 'natural', 'random'].includes(body.concept) ? body.concept : 'cinematic';
    const concept = resolveConcept(conceptInput);
    const targetSceneCount = SCENE_COUNTS[targetDurationSec] || SCENE_COUNTS[30];

    if (!topic && !blogText) {
      return res.status(400).json({ error: 'topic 또는 blogText 중 하나는 필요합니다.' });
    }

    const isAdmin = await resolveAdmin(req);
    const email = await resolveSessionEmail(extractToken(req));
    if (!isAdmin && !email) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }

    // ── 벤치마킹 (대본 생성 전, 백그라운드) ──
    const benchmarkKeyword = topic || (blogText ? blogText.slice(0, 50).replace(/[^가-힣a-zA-Z0-9\s]/g, '').trim() : '');
    const authHeader = req.headers?.authorization || '';
    const benchmark = benchmarkKeyword
      ? await fetchBenchmark(benchmarkKeyword, authHeader)
      : { fallback: true };
    console.log(`[SHORTFORM-SCRIPT] Benchmark: ${benchmarkKeyword} → ${benchmark.fallback ? 'FALLBACK' : `${(benchmark.videos || []).length} videos`}`);

    const script = await callClaude(topic, blogText, tone, targetDurationSec, concept, targetSceneCount, benchmark);
    await logUsage(email, 'shortform-script', tone, getClientIp(req));

    return res.status(200).json({ script });
  } catch (error) {
    console.error('shortform-script API Error:', error);
    return res.status(500).json({ error: '숏폼 대본 생성 중 오류가 발생했습니다.' });
  }
}
