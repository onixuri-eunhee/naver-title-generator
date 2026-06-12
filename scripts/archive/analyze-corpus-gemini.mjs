#!/usr/bin/env node
// 바이럴 코퍼스 심층 분석 — Vertex AI Gemini 2.5 Pro 사고 모드.
//
// 3원칙 기반 스키마로 승인된 YouTube 숏폼을 분해한다:
//   - Identity Mirror 6-beat (scene[0])
//   - sceneSequence (씬별 role/narrationTone/polaritySignal)
//   - aiTellSigns (교과서 어미·hedging 탐지)
//
// 실행 전제:
//   - raw.json 에 "approved": true 마킹된 항목 존재
//   - GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON + GOOGLE_CLOUD_PROJECT + VERTEX_AI_LOCATION 설정
//
// 사용:
//   node scripts/analyze-corpus-gemini.mjs business
//
// 출력:
//   data/viral-corpus/v2026-Q2/{category}.structured.json
//   data/viral-corpus/v2026-Q2/{category}.summary.md

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const CORPUS_VERSION = 'v2026-Q2';
// Vertex AI 제한: "You can only include 1 youtube link" → 요청당 1개만 허용.
// 따라서 영상별 순차 호출. 각 호출은 30~45초.
const BATCH_SIZE = 1;
const THINKING_BUDGET = 8000;  // 사고 모드 토큰 예산

// ─ env 로드 ────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[m[1]] = val;
    }
  }
}
loadEnv();

// ─ 3원칙 스키마 ────────────────────────────────────────────────────────
const HookType = z.enum([
  '질문형', '충격형', '비밀형', '증거형', '공감형', '경고형',
  '리스트형', '실수지적형', '변신형', 'FOMO형',
]);
const EmotionTrigger = z.enum(['Envy', 'Embarrassment', 'Excitement', 'Empathy', 'Enlightenment']);
const FirstSentenceEnding = z.enum(['assertive', 'analytical', 'question', 'storytelling']);
const NarrationTone = z.enum(['assertive', 'provocative', 'empathetic', 'storytelling', 'analytical']);
const PolaritySignal = z.enum(['strong-assertion', 'polarizing', 'neutral', 'hedged']);
const SceneRole = z.enum([
  'hook', 'mind-read', 'situation', 'flip', 'promise', 'example', 'summary', 'cta',
]);
const VisualStyle = z.enum(['talking-head', 'text-overlay', 'b-roll', 'split-screen', 'mixed']);
const Transition = z.enum(['cut', 'fade', 'zoom-in', 'beat-change']).nullable();
const CTAType = z.enum(['save-first', 'share', 'comment', 'follow', 'link-in-bio', 'dm', 'none']);

const IdentityMirrorSchema = z.object({
  timeAdverb: z.string().nullable().describe('"아직도/여전히/지금도" 같은 시간 부사. 없으면 null'),
  actions: z.array(z.string()).describe('시청자가 현재 하고 있는 실제 행동 1~3개. 각 항목은 동사+구체 명사'),
  consequences: z.array(z.string()).describe('행동이 만든 실패·부정 상태 1~2개'),
  emotion: z.string().describe('그로 인한 심리 상태 1개. 예: "손 놓은 체념"'),
  hookType: HookType,
  emotionTrigger: EmotionTrigger,
  firstSentence: z.string().describe('첫 씬의 실제 첫 문장 인용 그대로'),
  firstSentenceEnding: FirstSentenceEnding,
  definedEmotion: z.string().nullable().describe('시청자가 모르던 자기 감정을 작가가 대신 정의한 문장. 없으면 null'),
});

const SceneSchema = z.object({
  role: SceneRole,
  script: z.string().describe('해당 씬의 내레이션 스크립트 (자막·음성 기반 최대한 정확히)'),
  onScreenText: z.string().nullable().describe('화면 강조 문구. 없으면 null'),
  durationSec: z.number().describe('씬 길이 (초)'),
  visual: VisualStyle,
  narrationTone: NarrationTone,
  polaritySignal: PolaritySignal,
  transition: Transition,
});

const AiTellSignsSchema = z.object({
  detected: z.boolean().describe('교과서 어미·hedging 패턴이 영상 어디선가 발견됐는가'),
  examples: z.array(z.string()).describe('발견된 AI 틱 문장 인용 (최대 3개). 없으면 빈 배열'),
});

const CorpusVideoSchema = z.object({
  identityMirror: IdentityMirrorSchema,
  sceneSequence: z.array(SceneSchema).min(3).max(15),
  cta: z.object({
    type: CTAType,
    phrase: z.string().describe('실제 CTA 문구'),
  }),
  captionOriginal: z.string().nullable().describe('영상 설명란의 캡션 원문. 없으면 null'),
  aiTellSigns: AiTellSignsSchema,
  overallVerdict: z.object({
    isIdentityMirrorWorking: z.boolean().describe('6-beat 공식이 실제로 작동하는가'),
    isAssertiveTone: z.boolean().describe('단정·도발 톤 유지 여부'),
    isPolarityStrong: z.boolean().describe('강한 선 긋기 / 양극 프레임 여부'),
    notes: z.string().nullable().describe('전반 평가 1~2문장. 없으면 null'),
  }),
});

// ─ 프롬프트 ────────────────────────────────────────────────────────────
const ANALYSIS_PROMPT = `당신은 한국어 숏폼 바이럴 분석가다. 아래 유튜브 숏폼 1건을 멀티모달로 (영상+음성+자막+씬 전환) 깊게 분석하여 3대 원칙에 따라 구조화하라.

## 3대 원칙 (북극성)

### 원칙 1 — Identity Mirror 3단 구체화 (scene[0] 6-beat)
"내 얘긴가?" 반응은 행동·결과·심리 3단이 한 문장에 모두 들어가야 발동.
예: "아직도 장부 옮겨적고 엑셀로 고객관리하시다 데이터 엉망진창 관리 자체가 안 되어 손 놓고 계시죠"
→ timeAdverb="아직도" / actions=["장부 옮겨적고","엑셀로 고객관리"] / consequences=["데이터 엉망진창","관리 불가"] / emotion="손 놓은 체념"

### 원칙 2 — 단정·도발 vs 분석 톤
금지 어미 (AI 틱): "~때문입니다", "~로 인해", "~의 결과입니다", "~에 기인"
선호 어미 (현장 증언): "~거예요", "~잖아요", "~거든요", "그냥 ~한 거예요"
narrationTone 분류: assertive | provocative | empathetic | storytelling | analytical(RED)

### 원칙 3 — Polarity Framing (애매 금지)
금지 표현: "~일 수 있어요", "경우에 따라", "한편", "물론 ~도 있지만"
polaritySignal 분류: strong-assertion | polarizing | neutral(RED) | hedged(RED)
시청자가 모르던 자기 감정을 작가가 대신 정의한 문장이 있으면 definedEmotion 에 인용.

## 출력 형식 — 반드시 아래 JSON 구조 그대로 출력

\`\`\`json
{
  "identityMirror": {
    "timeAdverb": "아직도",
    "actions": ["장부 옮겨적고", "엑셀로 고객관리"],
    "consequences": ["데이터 엉망진창", "관리 불가"],
    "emotion": "손 놓은 체념",
    "hookType": "공감형",
    "emotionTrigger": "Embarrassment",
    "firstSentence": "실제 영상의 첫 문장 정확 인용",
    "firstSentenceEnding": "assertive",
    "definedEmotion": "시청자 미정의 감정을 정의한 문장 또는 null"
  },
  "sceneSequence": [
    {
      "role": "hook",
      "script": "이 씬의 내레이션 스크립트",
      "onScreenText": "화면 강조 문구 또는 null",
      "durationSec": 2.8,
      "visual": "talking-head",
      "narrationTone": "assertive",
      "polaritySignal": "strong-assertion",
      "transition": null
    }
  ],
  "cta": {
    "type": "save-first",
    "phrase": "저장하고 오늘 저녁 해보세요"
  },
  "captionOriginal": "영상 설명란 캡션 원문 또는 null",
  "aiTellSigns": {
    "detected": false,
    "examples": []
  },
  "overallVerdict": {
    "isIdentityMirrorWorking": true,
    "isAssertiveTone": true,
    "isPolarityStrong": true,
    "notes": "전반 평가 1~2문장"
  }
}
\`\`\`

## enum 값 (정확히 이 값만 사용)

- hookType: 질문형|충격형|비밀형|증거형|공감형|경고형|리스트형|실수지적형|변신형|FOMO형 중 1개
- emotionTrigger: Envy|Embarrassment|Excitement|Empathy|Enlightenment 중 1개
- firstSentenceEnding: assertive|analytical|question|storytelling 중 1개
- role (각 씬): hook|mind-read|situation|flip|promise|example|summary|cta 중 1개
- visual (각 씬): talking-head|text-overlay|b-roll|split-screen|mixed 중 1개
- narrationTone (각 씬): assertive|provocative|empathetic|storytelling|analytical 중 1개
- polaritySignal (각 씬): strong-assertion|polarizing|neutral|hedged 중 1개
- transition (각 씬): cut|fade|zoom-in|beat-change 중 1개 또는 null
- cta.type: save-first|share|comment|follow|link-in-bio|dm|none 중 1개

## 절대 규칙

1. 오직 JSON 객체 하나만 출력. 앞뒤 설명·코드블록·마크다운 금지. 순수 JSON.
2. identityMirror 는 객체. sceneSequence 는 객체 배열. 절대 문자열 배열 금지.
3. identityMirror.firstSentence 는 영상에서 실제 들린 첫 문장 정확 인용.
4. sceneSequence 는 실제 씬 전환 기반으로 최소 3개 이상 분리. 씬별 모든 필드 채움.
5. 영상이 짧거나 정보 부족해도 빈 값 내지 말고 관찰된 근거로 최선 판정.
6. enum 위반·필드 누락 금지. 모른는 필드는 null 명시 (undefined 금지).
`;

// ─ Genkit / Vertex ────────────────────────────────────────────────────
async function loadGenkit() {
  const mod = await import('../lib/gemini-vertex.js');
  return { getGenkit: mod.getGenkit, resolveProModel: mod.resolveProModel };
}

// ─ JSON 추출 유틸 ─────────────────────────────────────────────────────
function extractJsonFromText(text) {
  if (!text) return null;
  const trimmed = text.trim();
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
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch (_) {}
  }
  return null;
}

// ─ 유틸 ────────────────────────────────────────────────────────────────
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildSummaryMarkdown(category, structured) {
  const lines = [];
  lines.push(`# ${category} 코퍼스 분석 요약 — ${CORPUS_VERSION}`);
  lines.push('');
  lines.push(`- 분석 완료: ${structured.length}건`);
  lines.push(`- 분석 시각: ${new Date().toISOString()}`);
  lines.push('');

  for (const v of structured) {
    const im = v.identityMirror;
    const scenes = Array.isArray(v.sceneSequence) ? v.sceneSequence : [];
    const tones = scenes.map((s) => s.narrationTone);
    const polarities = scenes.map((s) => s.polaritySignal);
    const analyticalCount = tones.filter((t) => t === 'analytical').length;
    const hedgedCount = polarities.filter((p) => p === 'neutral' || p === 'hedged').length;

    lines.push(`## ${v.title || v.videoId}`);
    lines.push('');
    lines.push(`- URL: ${v.url}`);
    lines.push(`- 조회/구독/비율: ${v.views?.toLocaleString()} / ${v.subs?.toLocaleString()} / ${v.ratio}x`);
    lines.push('');
    if (im) {
      lines.push(`**scene[0] 6-beat**`);
      lines.push(`- 첫 문장: "${im.firstSentence || '(없음)'}"`);
      lines.push(`- ${im.timeAdverb ? `[${im.timeAdverb}] ` : ''}actions=${JSON.stringify(im.actions || [])} / consequences=${JSON.stringify(im.consequences || [])}`);
      lines.push(`- emotion="${im.emotion || ''}" · hookType=${im.hookType || '?'} · trigger=${im.emotionTrigger || '?'}`);
      lines.push(`- 어미: **${im.firstSentenceEnding || '?'}** ${im.firstSentenceEnding === 'analytical' ? '🔴' : ''}`);
      if (im.definedEmotion) lines.push(`- 정의된 감정: "${im.definedEmotion}"`);
      lines.push('');
    } else {
      lines.push(`**scene[0] 6-beat**: ⚠️ 추출 실패 (identityMirror=null)`);
      lines.push('');
    }
    lines.push(`**sceneSequence** (${scenes.length}씬)`);
    for (const s of scenes) {
      const flags = [];
      if (s.narrationTone === 'analytical') flags.push('🔴분석');
      if (s.polaritySignal === 'neutral' || s.polaritySignal === 'hedged') flags.push('🔴애매');
      const scriptPreview = String(s.script || '').slice(0, 80);
      lines.push(`- \`${s.role || '?'}\` [${s.narrationTone || '?'}/${s.polaritySignal || '?'}]${flags.length ? ' ' + flags.join(' ') : ''} · ${s.durationSec || '?'}s · "${scriptPreview}${s.script?.length > 80 ? '…' : ''}"`);
    }
    lines.push('');
    if (v.cta) {
      lines.push(`**CTA**: [${v.cta.type || '?'}] "${v.cta.phrase || ''}"`);
      lines.push('');
    }
    if (v.overallVerdict) {
      lines.push(`**진단**: IdentityMirror=${v.overallVerdict.isIdentityMirrorWorking ? '✅' : '❌'} · Assertive=${v.overallVerdict.isAssertiveTone ? '✅' : '❌'} · Polarity=${v.overallVerdict.isPolarityStrong ? '✅' : '❌'}`);
      if (v.overallVerdict.notes) lines.push(`- 메모: ${v.overallVerdict.notes}`);
    }
    if (analyticalCount > 0) lines.push(`- ⚠️ analytical 씬 ${analyticalCount}건`);
    if (hedgedCount > 0) lines.push(`- ⚠️ neutral/hedged 씬 ${hedgedCount}건`);
    if (v.aiTellSigns?.detected) {
      lines.push(`- 🔴 AI 틱 패턴: ${(v.aiTellSigns.examples || []).join(' | ')}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

// ─ 메인 ────────────────────────────────────────────────────────────────
async function main() {
  const category = process.argv[2];
  if (!category) {
    console.error('사용: node scripts/analyze-corpus-gemini.mjs <category>');
    process.exit(1);
  }

  const rawPath = path.join(PROJECT_ROOT, 'data', 'viral-corpus', CORPUS_VERSION, `${category}.raw.json`);
  if (!fs.existsSync(rawPath)) {
    console.error(`raw 파일 없음: ${rawPath}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
  const approved = (raw.candidates || []).filter((c) => c.approved === true);
  if (approved.length === 0) {
    console.error('승인된 항목(approved=true) 없음. raw.json 편집 후 다시 실행.');
    process.exit(1);
  }

  console.log(`🎯 ${category} / 승인 ${approved.length}건 → Gemini 2.5 Pro 분석`);
  console.log(`   배치 ${BATCH_SIZE}건씩 × ${Math.ceil(approved.length / BATCH_SIZE)}회`);
  console.log('');

  const { getGenkit, resolveProModel } = await loadGenkit();
  const ai = getGenkit();
  const model = resolveProModel();

  const batches = chunk(approved, BATCH_SIZE);
  const structured = [];

  for (let b = 0; b < batches.length; b += 1) {
    const batch = batches[b];
    console.log(`  [${b + 1}/${batches.length}] ${batch.map((c) => c.videoId).join(', ')}`);

    const videoInfo = batch.map((c) => `입력 영상: "${c.title}" · 길이 ${c.durationSec}s`).join('\n');
    const prompt = [
      { text: ANALYSIS_PROMPT + '\n' + videoInfo },
      ...batch.map((c) => ({ media: { url: c.url, contentType: 'video/*' } })),
    ];

    try {
      const response = await ai.generate({
        model,
        prompt,
        config: {
          temperature: 0.2,
          thinkingConfig: { thinkingBudget: THINKING_BUDGET },
        },
      });

      const rawText = response.text || '';
      const parsed = extractJsonFromText(rawText);
      if (!parsed) {
        console.warn(`    ⚠️ 배치 ${b + 1} JSON 파싱 실패`);
        console.warn(`       text snippet: ${rawText.slice(0, 300)}`);
        continue;
      }

      const validation = CorpusVideoSchema.safeParse(parsed);
      if (!validation.success) {
        console.warn(`    ⚠️ 배치 ${b + 1} 스키마 검증 실패 — 그래도 raw 저장`);
        console.warn(`       issues: ${validation.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join(' | ')}`);
      }

      // 매칭은 batch[0] 으로 직행.
      {
        const v = validation.success ? validation.data : parsed;
        const rawItem = batch[0];
        structured.push({
          // raw 메타데이터
          videoId: rawItem.videoId,
          url: rawItem.url,
          title: rawItem.title,
          channelName: rawItem.channelName,
          subs: rawItem.subs,
          views: rawItem.views,
          ratio: rawItem.ratio,
          durationSec: rawItem.durationSec,
          publishedAt: rawItem.publishedAt,
          sourceSeed: rawItem.sourceSeed,
          // Gemini 분석 결과 (videoId 필드는 raw 와 중복이라 제외)
          identityMirror: v.identityMirror,
          sceneSequence: v.sceneSequence,
          cta: v.cta,
          captionOriginal: v.captionOriginal,
          aiTellSigns: v.aiTellSigns,
          overallVerdict: v.overallVerdict,
        });
        console.log(`    ✅ ${rawItem.videoId}`);
      }
    } catch (error) {
      console.warn(`    ❌ 배치 ${b + 1} 실패: ${error?.message || error}`);
    }
  }

  const outDir = path.join(PROJECT_ROOT, 'data', 'viral-corpus', CORPUS_VERSION);
  const structuredPath = path.join(outDir, `${category}.structured.json`);
  fs.writeFileSync(
    structuredPath,
    JSON.stringify(
      {
        meta: {
          category,
          corpusVersion: CORPUS_VERSION,
          analyzedAt: new Date().toISOString(),
          approvedCount: approved.length,
          structuredCount: structured.length,
        },
        videos: structured,
      },
      null,
      2,
    ),
    'utf-8',
  );

  const summaryPath = path.join(outDir, `${category}.summary.md`);
  fs.writeFileSync(summaryPath, buildSummaryMarkdown(category, structured), 'utf-8');

  console.log('');
  console.log(`✅ 완료: ${structured.length}/${approved.length}`);
  console.log(`   ${structuredPath}`);
  console.log(`   ${summaryPath}`);
}

main().catch((err) => {
  console.error('❌ analyze-corpus-gemini failed:', err);
  process.exit(1);
});
