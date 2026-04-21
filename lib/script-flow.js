/**
 * Phase D — 숏폼 대본 생성 Genkit flow.
 *
 * 아키텍처 결정:
 * - Genkit은 @2026-04 시점 Anthropic 네이티브 플러그인 없음.
 * - Claude Opus는 한국어 카피라이팅 품질 우위 (vs Gemini 2.5 Pro).
 * - 절충: defineFlow() 래퍼 안에서 Anthropic Messages API fetch 그대로 사용.
 *   - 이득: zod 스키마 검증, Genkit trace/retry 인프라
 *   - 손실: Genkit model plugin 표준화 (향후 Claude 네이티브 지원 시 교체 가능)
 *
 * 캡션 생성 정책:
 * - 기본: 같은 Claude 호출에서 { scenes, caption } 동시 생성 (토큰 절감 + 페르소나 일관성)
 * - 폴백: 1차 생성에서 caption 누락 시 재호출하지 않고 scenes[0].script 에서 첫 문장 추출
 * - 별도 호출은 향후 캡션 A/B 테스트 시에만 추가 (Phase 범위 밖)
 */
import { genkit } from 'genkit';
import { z } from 'zod';
import { buildSystemPrompt, buildUserMessage } from '@/lib/script-prompts';
import { validateScriptOutput } from '@/lib/script-validator';
import {
  buildCaptionFallbacks,
  captionsAreDuplicate,
  isValidCaption,
} from '@/lib/shortform/caption-fallback';

const MODEL = 'claude-opus-4-6';

// Genkit 인스턴스 (모듈 싱글톤). Phase B/F/I 와 공유 가능.
// plugins 배열은 의도적으로 비어 있음 — Claude fetch는 플로우 함수 안에서 직접 수행.
let _ai = null;
function getAi() {
  if (_ai) return _ai;
  _ai = genkit({
    plugins: [],
  });
  return _ai;
}

// === Zod 스키마 ===

const scriptInputSchema = z.object({
  blogText: z.string().optional().default(''),
  keywords: z.string().optional().default(''),
  userExperience: z.string().optional().default(''),
  personaId: z.string().min(1),
  customPersonaLabel: z.string().optional().nullable(),
  customPersonaHint: z.string().optional().nullable(),
  tone: z.enum(['professional', 'casual']).default('casual'),
  contentType: z.enum(['shortform', 'longform']).default('shortform'),
  // 숏폼: 30/45/60/90 / 롱폼: 180/300/600
  durationSec: z.union([
    z.literal(30), z.literal(45), z.literal(60), z.literal(90),
    z.literal(180), z.literal(300), z.literal(600),
  ]).default(45),
  benchmarkAggregated: z.any().optional().nullable(),
  brandContext: z.string().optional().nullable(),
});

const sceneSchema = z.object({
  // 숏폼: hook/point/cta, 롱폼: hook/body1/body2/body3/body4/conclusion/cta
  section: z.string().default('point'),
  // scene type (Phase 2.1): text|comparison|emphasis|testimonial|data|flow
  // 레거시 'broll' 도 허용 (기존 숏폼 경로)
  type: z.string().default('text'),
  script: z.string(),
  hookType: z.string().optional(),
  hookText: z.string().optional(),
  visual: z.string().optional(),
  typeProps: z.any().optional(),
}).passthrough();

const scriptOutputSchema = z.object({
  scenes: z.array(sceneSchema).min(3),
  totalDuration: z.number(),
  presetUsed: z.string().optional().nullable(),
  // 플랫폼별 캡션 2종 (인스타 릴스, 유튜브 숏츠). 역호환용 caption(legacy)은 둘 중 하나로 fallback.
  captionInstagram: z.string().optional(),
  captionYouTube: z.string().optional(),
  caption: z.string().optional(), // deprecated — captionInstagram으로 fallback
  warnings: z.array(z.string()).default([]),
});

// === Claude 호출 (기존 패턴 유지) ===

async function callClaude({ systemPrompt, userMessage, maxTokens = 4000 }) {
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
      max_tokens: maxTokens,
      temperature: 0.7,
      system: [
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Claude API error: ${JSON.stringify(data)}`);
  }
  return (data?.content || [])
    .filter((block) => block?.type === 'text' && block?.text)
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * 균형 괄호 JSON 파서 (기존 route.js 에서 이식).
 * Claude가 JSON 뒤에 텍스트를 붙이는 버릇 대응.
 */
function extractJsonObject(rawText) {
  const trimmed = rawText.trim();
  try { return JSON.parse(trimmed); } catch (_) {}

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch (_) {}
  }

  const start = trimmed.indexOf('{');
  if (start === -1) throw new Error('Claude 응답에서 JSON 객체를 찾을 수 없습니다.');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth += 1;
    if (c === '}') depth -= 1;
    if (depth === 0) {
      return JSON.parse(trimmed.slice(start, i + 1));
    }
  }
  throw new Error('Claude 응답 JSON 파싱 실패 (균형 괄호 없음).');
}

// === Genkit flow 정의 ===

/**
 * 숏폼 대본 + 캡션 단일 호출 생성 flow.
 *
 * 입력: scriptInputSchema
 * 출력: scriptOutputSchema
 *
 * 동작:
 * 1. 페르소나/톤 기반 system + user prompt 빌드
 * 2. Claude Opus 1회 호출 (scenes + caption 동시 반환)
 * 3. JSON 균형 괄호 파싱
 * 4. validateScriptOutput — 이모지 제거, 일반론 경고
 * 5. zod 스키마로 최종 검증 후 반환
 */
export const generateScriptFlow = getAi().defineFlow(
  {
    name: 'shortformGenerateScript',
    inputSchema: scriptInputSchema,
    outputSchema: scriptOutputSchema,
  },
  async (input) => {
    const hasBenchmark = !!input.benchmarkAggregated;
    const contentType = input.contentType || 'shortform';
    const isLongform = contentType === 'longform';

    const systemPrompt = buildSystemPrompt({
      personaId: input.personaId,
      customPersonaLabel: input.customPersonaLabel || undefined,
      customPersonaHint: input.customPersonaHint || undefined,
      tone: input.tone,
      hasBenchmark,
      brandContext: input.brandContext || null,
      contentType,
    });

    const userMessage = buildUserMessage({
      blogText: input.blogText || '',
      keywords: input.keywords || '',
      userExperience: input.userExperience || '',
      personaId: input.personaId,
      customPersonaLabel: input.customPersonaLabel || undefined,
      customPersonaHint: input.customPersonaHint || undefined,
      tone: input.tone,
      durationSec: input.durationSec,
      benchmarkAggregated: input.benchmarkAggregated || null,
      contentType,
    });

    // 롱폼은 출력 토큰이 훨씬 많이 필요 — 5분/10분 대응
    const maxTokens = isLongform
      ? (input.durationSec >= 600 ? 16000 : input.durationSec >= 300 ? 10000 : 6000)
      : 4000;

    const rawText = await callClaude({ systemPrompt, userMessage, maxTokens });
    const parsed = extractJsonObject(rawText);

    const sceneCounts = { 30: 7, 45: 10, 60: 14, 90: 20 };
    const expectedSceneCount = isLongform ? 7 : sceneCounts[input.durationSec];
    const validation = validateScriptOutput(parsed, {
      durationSec: input.durationSec,
      expectedSceneCount,
    });

    // hard rule 위반이 있으면 throw — 상위 layer에서 재시도 결정
    if (!validation.ok && validation.errors.length > 0) {
      // errors가 이모지 관련이면 autoFixed 로 복구 가능
      const nonFixable = validation.errors.filter((e) => !e.includes('이모지'));
      if (nonFixable.length > 0) {
        throw new Error(`대본 검증 실패: ${nonFixable.join(', ')}`);
      }
    }

    const fixed = validation.autoFixed;

    // 캡션 누락/중복 시 플랫폼별로 구조 다른 폴백 (단일 헬퍼 — route.js Legacy 와 동일 규약).
    let captionInstagram = fixed.captionInstagram || fixed.caption || '';
    let captionYouTube = fixed.captionYouTube || '';
    const needInsta = !isValidCaption(captionInstagram);
    const needYT = !isValidCaption(captionYouTube);
    const isDup =
      isValidCaption(captionInstagram) &&
      isValidCaption(captionYouTube) &&
      captionsAreDuplicate(captionInstagram, captionYouTube);

    if (needInsta || needYT || isDup) {
      const fb = buildCaptionFallbacks(fixed.scenes || []);
      if (needInsta || isDup) {
        captionInstagram = fb.captionInstagram;
        validation.warnings.push(
          isDup ? 'captionInstagram 중복 → 폴백 재생성' : 'captionInstagram 누락 → 폴백 생성',
        );
      }
      if (needYT || isDup) {
        captionYouTube = fb.captionYouTube;
        validation.warnings.push(
          isDup ? 'captionYouTube 중복 → 폴백 재생성' : 'captionYouTube 누락 → 폴백 생성',
        );
      }
    }

    // YouTube는 #Shorts 태그 필수 — 누락 시 강제 추가 (Claude 원본 그대로일 때도 방어)
    if (!/#\s*Shorts/i.test(captionYouTube)) {
      captionYouTube = `${captionYouTube}\n\n#Shorts`;
      validation.warnings.push('captionYouTube #Shorts 태그 자동 추가');
    }

    return {
      scenes: fixed.scenes,
      totalDuration: Number(fixed.totalDuration) || input.durationSec,
      presetUsed: fixed.presetUsed || null,
      captionInstagram,
      captionYouTube,
      // 레거시 호환: 기존 caption 필드 사용처가 있으면 Instagram으로 매핑
      caption: captionInstagram,
      warnings: validation.warnings,
    };
  }
);
