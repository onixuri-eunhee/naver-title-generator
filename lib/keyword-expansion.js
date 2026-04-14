/**
 * 키워드 확장 Flow (Genkit + Gemini Flash)
 *
 * 입력: blogText (선택) + keywords (선택, 쉼표 구분) — 최소 하나는 필수
 * 출력: mainKeywords[], relatedKeywords[], searchQueries[5]
 *
 * 5개 검색 쿼리는 메인 + 관련 키워드를 조합해 YouTube 숏폼 검색 커버리지 극대화.
 * 스펙 §4 Step 2 "키워드 확장" 섹션 참고.
 */
import { z } from 'zod';
import { getGenkit, resolveFlashModel } from './gemini-vertex.js';

export const KeywordExpansionInputSchema = z.object({
  blogText: z.string().nullable().optional(),
  keywords: z.string().nullable().optional(),
});

export const KeywordExpansionOutputSchema = z.object({
  mainKeywords: z.array(z.string()).min(1).max(5),
  relatedKeywords: z.array(z.string()).min(3).max(7),
  searchQueries: z.array(z.string()).length(5),
});

/**
 * Flow를 lazy 생성 — genkit 초기화는 런타임 첫 호출 시에만 실행.
 * 모듈 top-level에서 defineFlow를 호출하면 빌드 타임에 Vertex 초기화 시도 → 실패 가능.
 */
let _flow = null;

function buildFlow() {
  if (_flow) return _flow;
  const ai = getGenkit();

  _flow = ai.defineFlow(
    {
      name: 'shortformKeywordExpansion',
      inputSchema: KeywordExpansionInputSchema,
      outputSchema: KeywordExpansionOutputSchema,
    },
    async ({ blogText, keywords }) => {
      const baseText = (blogText || '').slice(0, 4000);
      const userKeywords = (keywords || '').trim();

      if (!baseText && !userKeywords) {
        throw new Error('blogText 또는 keywords 중 하나는 필수입니다.');
      }

      const prompt = `당신은 한국어 YouTube 숏폼 검색 키워드 생성 전문가입니다.
아래 입력을 읽고 검색 쿼리 5개를 생성하세요. 쿼리는 YouTube 검색창에 바로 입력 가능한 형태여야 합니다.

## 블로그 글
${baseText || '(없음)'}

## 사용자 키워드
${userKeywords || '(없음)'}

## 출력 규칙
1. mainKeywords: 글의 핵심 명사 3~5개 (예: "신랑 정장", "웨딩플래너")
2. relatedKeywords: 의미적 인접어/동의어/상위 카테고리 5~7개 (예: "예비 신랑", "결혼식 슈트")
3. searchQueries: 메인 + 관련을 조합해 YouTube 검색 커버리지를 극대화하는 5개 쿼리
   - 중복 최소화, 각 쿼리 2~6단어 이내
   - 검색량 많은 표현 우선 (예: "신랑 정장 추천" > "신랑이 고를만한 정장")
4. 모두 순수 한국어, 이모지·특수문자·해시태그 금지

반드시 JSON 형식으로만 응답하세요.`;

      const response = await ai.generate({
        model: resolveFlashModel(),
        prompt,
        output: { schema: KeywordExpansionOutputSchema },
        config: { temperature: 0.3 },
      });

      const output = response.output;
      if (!output) {
        throw new Error('Gemini Flash 응답에서 output 파싱 실패');
      }
      return output;
    }
  );

  return _flow;
}

/**
 * 편의 함수 — 외부에서 Flow 직접 호출 없이 사용 가능.
 */
export async function expandKeywords({ blogText, keywords }) {
  const flow = buildFlow();
  return await flow({ blogText, keywords });
}
