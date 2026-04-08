import { extractToken, resolveSessionEmail, setCorsHeaders } from './_helpers.js';

export const config = { maxDuration: 10 };

// ── AI 어휘 매핑 ──
const AI_VOCABULARY_MAP = {
  '효과적인': '좋은', '체계적인': '꼼꼼한', '다양한': '여러',
  '중요합니다': '중요해요', '도움이 됩니다': '도움이 돼요',
  '활용하세요': '써보세요', '살펴보겠습니다': '정리해 볼게요',
  '알아보겠습니다': '정리해 봤어요', '소개해드리겠습니다': '알려드릴게요',
  '필수적인': '꼭 필요한', '핵심적인': '가장 중요한', '전반적인': '전체적인',
  '포괄적인': '폭넓은', '이를 통해': '덕분에', '결론적으로': '결국',
  '최적화된': '딱 맞는', '진행해보겠습니다': '해 볼게요'
};

const BANNED_WORDS = Object.keys(AI_VOCABULARY_MAP);

// ── 7개 채점 함수 ──

function checkAIVocabulary(fullText) {
  let found = 0;
  const foundWords = [];
  for (const w of BANNED_WORDS) {
    const matches = fullText.match(new RegExp(w, 'g'));
    if (matches) { found += matches.length; foundWords.push(w); }
  }
  const score = found === 0 ? 15 : found <= 2 ? 8 : 0;
  const status = found === 0 ? 'pass' : found <= 2 ? 'warn' : 'fail';
  return { score, max: 15, label: `AI 전형 어휘 (${found}개)`, status, suggestion: score < 15 ? `"${foundWords.slice(0, 3).join('", "')}" 등 AI 전형 표현을 자연스러운 말로 바꿔주세요.` : '' };
}

function checkEndingRepeat(fullText) {
  const sentences = fullText.split(/[.!?]+\s*/).filter(s => s.trim().length > 5);
  const endings = sentences.map(s => {
    s = s.trim();
    if (/겠습니다$/.test(s)) return '겠습니다';
    if (/습니다$/.test(s)) return '습니다';
    if (/합니다$/.test(s)) return '합니다';
    if (/됩니다$/.test(s)) return '됩니다';
    if (/거든요$/.test(s)) return '거든요';
    if (/더라고요$/.test(s)) return '더라고요';
    if (/잖아요$/.test(s)) return '잖아요';
    if (/인데요$/.test(s)) return '인데요';
    if (/네요$/.test(s)) return '네요';
    if (/해요$/.test(s)) return '해요';
    if (/세요$/.test(s)) return '세요';
    if (/죠$/.test(s)) return '죠';
    if (s.length >= 2 && /다$/.test(s)) return s.slice(-2);
    if (s.length >= 2 && /요$/.test(s)) return s.slice(-2);
    return 'other';
  }).filter(e => e !== 'other');

  let maxConsec = 1, cur = 1;
  for (let i = 1; i < endings.length; i++) {
    if (endings[i] === endings[i - 1]) { cur++; if (cur > maxConsec) maxConsec = cur; }
    else cur = 1;
  }
  const score = maxConsec <= 1 ? 10 : maxConsec === 2 ? 5 : 0;
  const status = maxConsec <= 1 ? 'pass' : maxConsec === 2 ? 'warn' : 'fail';
  return { score, max: 10, label: `어미 반복 (최대 ${maxConsec}연속)`, status, suggestion: score < 10 ? `같은 어미가 ${maxConsec}번 연속됩니다. "~다/~요/~죠/~거든요" 등을 섞어주세요.` : '' };
}

function checkSpecificity(fullText) {
  const numMatches = fullText.match(/\d+[%만원명개월일년세시분초번째가지배평점점위칼로리km회차g장권살층]/g);
  const count = numMatches ? numMatches.length : 0;
  const score = count >= 3 ? 15 : count >= 1 ? 8 : 0;
  const status = count >= 3 ? 'pass' : count >= 1 ? 'warn' : 'fail';
  return { score, max: 15, label: `수치/고유명사 (${count}개)`, status, suggestion: score < 15 ? '구체적 숫자(가격, 기간, 수량)나 고유명사(지역명, 브랜드)를 3개 이상 넣어주세요.' : '' };
}

function checkDirectExperience(fullText) {
  const patterns = [/했더니/, /해보니/, /써보니/, /먹어보니/, /가보니/, /만들어보니/, /처음엔/, /직접\s*(써|해|가|먹|만들어)/, /실제로\s*(해|써)/, /제가\s*.{0,15}(했|한|할)\s*때/, /써봤/, /해봤/, /가봤/, /먹어봤/];
  const sentences = fullText.split(/[.!?]+\s*/);
  let count = 0;
  for (const s of sentences) {
    if (patterns.some(p => p.test(s))) count++;
  }
  const score = count >= 2 ? 15 : count === 1 ? 8 : 0;
  const status = count >= 2 ? 'pass' : count === 1 ? 'warn' : 'fail';
  return { score, max: 15, label: `직접 경험 문장 (${count}개)`, status, suggestion: score < 15 ? '"직접 써보니", "처음엔", "해봤더니" 같은 직접 경험 서술을 2개 이상 추가하세요.' : '' };
}

function checkNegativeExpression(fullText) {
  const negWords = ['솔직히','별로','아쉬웠','실패','생각보다','예상보다 못','사실 좀','후회','불편했','안 좋았','힘들었','아쉽게도'];
  let count = 0;
  const foundWords = [];
  for (const w of negWords) {
    if (fullText.includes(w)) { count++; foundWords.push(w); }
  }
  const score = count >= 1 ? 15 : 0;
  const status = count >= 1 ? 'pass' : 'fail';
  return { score, max: 15, label: `부정/반전 표현 (${count}개)`, status, suggestion: score < 15 ? 'AI는 긍정만 씁니다. "솔직히 좀 별로", "생각보다 아쉬웠다" 같은 솔직한 표현을 1개 이상 넣으세요.' : '' };
}

function checkSentenceLengthVariance(fullText) {
  const sentences = fullText.split(/[.!?]+\s*/).filter(s => s.trim().length > 3);
  if (sentences.length < 5) return { score: 5, max: 10, label: '문장 길이 편차', status: 'warn', suggestion: '문장 수가 너무 적어 편차를 측정하기 어렵습니다.' };
  const lengths = sentences.map(s => s.trim().length);
  const range = Math.max(...lengths) - Math.min(...lengths);
  const score = range >= 40 ? 10 : range >= 20 ? 5 : 0;
  const status = range >= 40 ? 'pass' : range >= 20 ? 'warn' : 'fail';
  return { score, max: 10, label: `문장 길이 편차 (${range}자)`, status, suggestion: score < 10 ? '문장 길이가 너무 균일합니다. 짧은 문장("진짜였다.")과 긴 설명을 섞어주세요.' : '' };
}

function checkStructuralMechanicity(fullText) {
  const paragraphs = fullText.split(/\n\n+/).filter(p => p.trim().length > 5);
  if (paragraphs.length < 4) return { score: 5, max: 10, label: '구조 기계성', status: 'warn', suggestion: '문단 수가 너무 적어 구조를 측정하기 어렵습니다.' };
  const lengths = paragraphs.map(p => p.trim().length);
  const sorted = [...lengths].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = Math.max(median * 0.3, 20);
  const uniformCount = lengths.filter(l => Math.abs(l - median) <= threshold).length;
  const ratio = Math.round(uniformCount / lengths.length * 100);
  const score = ratio < 50 ? 10 : ratio <= 74 ? 5 : 0;
  const status = ratio < 50 ? 'pass' : ratio <= 74 ? 'warn' : 'fail';
  return { score, max: 10, label: `구조 기계성 (균일 ${ratio}%)`, status, suggestion: score < 10 ? `문단 길이가 너무 균일합니다(${ratio}%). 짧은 독백 문단과 긴 설명 문단을 섞어주세요.` : '' };
}

// ── AI 어휘 치환 ──
function replaceAIVocabulary(parsed) {
  const fields = ['title', 'description', 'hook', 'body', 'cta', 'faq', 'meta_description'];
  for (const field of fields) {
    if (parsed[field]) {
      for (const [word, replacement] of Object.entries(AI_VOCABULARY_MAP)) {
        if (parsed[field].includes(word)) {
          parsed[field] = parsed[field].split(word).join(replacement);
        }
      }
    }
  }
  return parsed;
}

// ── 메인 핸들러 ──
export default async function handler(req, res) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 로그인 확인
  const token = extractToken(req);
  const email = await resolveSessionEmail(token);
  if (!email) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const { action, text, parsed } = req.body || {};

  // action=score: 텍스트 채점
  if (action === 'score') {
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text 필드가 필요합니다.' });
    }

    const results = [
      checkAIVocabulary(text),
      checkEndingRepeat(text),
      checkSpecificity(text),
      checkDirectExperience(text),
      checkNegativeExpression(text),
      checkSentenceLengthVariance(text),
      checkStructuralMechanicity(text)
    ];
    const totalScore = results.reduce((sum, r) => sum + r.score, 0);

    return res.status(200).json({ results, totalScore, maxScore: 90 });
  }

  // action=replace: AI 어휘 치환
  if (action === 'replace') {
    if (!parsed || typeof parsed !== 'object') {
      return res.status(400).json({ error: 'parsed 객체가 필요합니다.' });
    }

    const replaced = replaceAIVocabulary({ ...parsed });
    return res.status(200).json({ parsed: replaced });
  }

  return res.status(400).json({ error: 'action은 "score" 또는 "replace"여야 합니다.' });
}
