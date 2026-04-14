/**
 * 벤치마킹 Zod 스키마 중앙화
 *
 * 스펙 §5 "Gemini Vertex AI JSON Schema"을 1:1 매핑.
 * Task B5의 /api/shortform-benchmark/analyze가 이 스키마로 Gemini
 * 응답을 검증 (Genkit Structured Output).
 */
import { z } from 'zod';

// ─ enum 정의 ─
export const HookType = z.enum([
  'number-list',
  'question',
  'shock',
  'secret',
  'evidence',
  'empathy',
  'warning',
  'mistake',
  'transformation',
  'fomo',
]);

export const BodyStructure = z.enum([
  'list',
  'narrative',
  'how-to',
  'comparison',
  'problem-solution',
]);

export const PersonPresence = z.enum(['high', 'medium', 'low', 'none']);

export const SubtitlePosition = z.enum(['top', 'middle', 'bottom']);
export const SubtitleStyle = z.enum(['static', 'kinetic', 'mixed']);
export const CutFrequency = z.enum(['slow', 'medium', 'fast']);

export const CTAType = z.enum(['comment', 'dm', 'follow', 'link', 'save', 'share', 'none']);
export const CTAPosition = z.enum(['beginning', 'middle', 'end']);

export const RecommendedPreset = z.enum([
  '전문가',
  '친근',
  '임팩트',
  '차분',
  '트렌디',
  '비즈니스',
]);

// ─ 서브 스키마 ─

export const HookSchema = z.object({
  type: HookType,
  openingText: z.string(),
  openingVisual: z.string(),
  first3Seconds: z.string(),
  hookDurationSec: z.number().min(1).max(10),
});

export const BodySchema = z.object({
  structure: BodyStructure,
  segmentCount: z.number().int().min(1).max(20),
  averageSegmentDuration: z.number(),
  tone: z.string(),
  personPresence: PersonPresence,
  setting: z.string(),
});

export const CTASchema = z.object({
  type: CTAType,
  text: z.string(),
  ctaPosition: CTAPosition,
});

export const VisualStyleSchema = z.object({
  subtitlePosition: SubtitlePosition,
  subtitleStyle: SubtitleStyle,
  cutFrequency: CutFrequency,
});

export const CaptionSchema = z.object({
  totalLength: z.number().int().min(0),
  structure: z.string(),
  hookLine: z.string(),
  bodyLength: z.number().int().min(0),
  hashtags: z.array(z.string()),
  hashtagCount: z.number().int().min(0),
  ctaText: z.string(),
  ctaPosition: z.string(),
  linkPlacement: z.string(),
  emojiUsage: z.boolean(),
  lineBreakStyle: z.string(),
});

// ─ 개별 영상 분석 ─

export const VideoAnalysisSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  channelName: z.string(),
  viewCount: z.number().int().min(0),
  subscriberCount: z.number().int().min(0),
  duration: z.number().int().min(1).max(120),
  viewToSubRatio: z.number().min(0),

  hook: HookSchema,
  body: BodySchema,
  cta: CTASchema,
  visualStyle: VisualStyleSchema,
  caption: CaptionSchema,
});

// ─ 집계 ─

export const CaptionPatternSchema = z.object({
  averageLength: z.number(),
  dominantStructure: z.string(),
  averageHashtagCount: z.number(),
  commonHashtags: z.array(z.string()),
});

export const AggregatedSchema = z.object({
  dominantHookType: HookType,
  dominantBodyStructure: BodyStructure,
  dominantTone: z.string(),
  averageDuration: z.number(),
  personPresenceMode: PersonPresence,
  recommendedSubtitlePosition: SubtitlePosition,
  commonCTAType: CTAType,
  captionPattern: CaptionPatternSchema,
  recommendedPreset: RecommendedPreset,
  advice: z.string().min(10).max(500),
});

// ─ 최종 Analyze Output ─

export const AnalysisOutputSchema = z.object({
  videos: z.array(VideoAnalysisSchema).min(1).max(3),
  aggregated: AggregatedSchema,
});

/**
 * TypeScript 타입 정의 (JSDoc 지원).
 * @typedef {z.infer<typeof AnalysisOutputSchema>} AnalysisOutput
 * @typedef {z.infer<typeof VideoAnalysisSchema>} VideoAnalysis
 * @typedef {z.infer<typeof AggregatedSchema>} Aggregated
 */
