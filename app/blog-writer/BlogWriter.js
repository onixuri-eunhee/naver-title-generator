'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clipCopy } from '@/lib/utils';
import { getToken } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import { SYSTEM_PROMPTS, TONE_GUIDES } from '@/lib/blog-writer-prompts';
import { SHORTFORM_PAGE_ENABLED } from '@/lib/feature-flags';
import styles from './page.module.css';

const TYPES = [
  { id: 'homefeed', icon: '📱', name: '네이버 홈피드', desc: '홈 탭 AI 추천 노출용' },
  { id: 'naver-seo', icon: '🔍', name: '네이버 SEO', desc: '검색(VIEW) 상위노출' },
  { id: 'google-seo', icon: '🌐', name: '구글 SEO', desc: '구글 검색 상위노출' },
];

const TONES = [
  { id: '친근한 구어체', icon: '😊', desc: '~거든요, ~더라고요 (편한 대화체)' },
  { id: '전문가 톤', icon: '💼', desc: '~합니다, 신뢰감 있는 서술체' },
  { id: '스토리텔링', icon: '📖', desc: '에피소드 중심, 감정 변화 흐름' },
  { id: '간결 실용체', icon: '⚡', desc: '핵심만, 불필요한 수식어 제거' },
];

const CTAS = [
  { id: '상담/예약 유도', icon: '📞', desc: '카톡·전화 문의 전환' },
  { id: '방문 유도', icon: '📍', desc: '오프라인 매장 방문 유도' },
  { id: '공감 마무리', icon: '💬', desc: '하드셀 없이 자연스럽게' },
  { id: '직접 입력', icon: '✏️', desc: '원하는 CTA 직접 작성' },
];

const LOADING_STEPS = [
  '📝 SEO 키워드 분석 중...',
  '🔍 검색 의도 파악 중...',
  '✍️ 후킹 도입부 작성 중...',
  '📄 본문 구성 중...',
  '🏷 해시태그 추출 중...',
];

const EXAMPLES = [
  {
    type: '홈피드', typeClass: 'typeHomefeed', tone: '친근한 구어체', who: '미용실 원장',
    title: '손상모 펌, 진짜 해도 되는 걸까? 12년차 원장이 솔직하게 말해볼게요',
    hook: '작년 겨울이었거든요. 단골 손님 한 분이 오셔서 대뜸 이러시는 거예요. "원장님, 저 머리 끊어지는데 펌 해도 돼요?" 솔직히 말리고 싶었어요. 근데 끊어진 부분을 자세히 보니까, 모발 중간부터 손상이 있는 거지 뿌리 쪽은 멀쩡하더라고요.\n\n이런 경우가 꽤 있어요. 무조건 "손상모는 펌 안 됩니다" 하는 원장님들도 계신데, 저는 12년 동안 이런 케이스를 수백 번 다뤘거든요. 결론부터 말하면, 조건만 맞으면 됩니다. 근데 그 "조건"을 제대로 아는 게 중요해요. 오늘은 그 이야기를 해볼게요.',
    body: '🔍 손상모 체크, 집에서 이렇게 해보세요\n\n일단 머리카락 한 올 뽑아서 물에 넣어보세요. 30초 안에 가라앉으면 손상이 꽤 진행된 거예요. 떠 있으면 아직 괜찮은 상태고요. 제 경우엔 이 테스트 결과를 보고 시술 방향을 정합니다. 한 가지 더, 젖은 머리를 손가락에 감았을 때 탄력 없이 늘어지기만 하면 그건 단백질이 빠진 상태예요. 이런 머리에 무작정 약 올리면 끊어집니다.\n\n💇 손상모한테 가능한 펌 종류, 전부 다 되는 건 아니에요\n\n셋팅펌은 솔직히 비추입니다. 열이 직접적으로 많이 가거든요. 손상모에는 독이에요. 대신 볼륨매직이나 저온 디지털펌은 해볼 만합니다. 우리 가게에서는 산성 약제를 쓰는데, 알칼리 약제보다 모발에 부담이 적어요.\n\n⏰ 시술 전에 꼭 해야 할 것\n\n최소 2주 전부터 트리트먼트 해주세요. 저는 손님한테 홈케어 샘플을 미리 드려요. 귀찮다고 안 하시는 분들이 있는데, 그게 결과 차이가 확실히 나거든요.\n\n🧴 시술 후 관리, 여기서 진짜 갈립니다\n\n펌 후 48시간은 머리 안 감는 거 아시죠? 근데 3일째부터가 더 중요해요. 드라이할 때 빗 말고 손가락으로 감싸면서 말려주세요. 빗으로 빡빡 당기면 컬이 풀려요.',
    cta: '혹시 손상모인데 펌 고민이시라면, 일단 상태 확인부터 해보세요. 카톡으로 머리 사진 보내주시면 무료로 상담해드려요. 상태 보고 솔직하게 말씀드릴게요.',
    tags: ['#손상모펌', '#손상모케어', '#미용실추천', '#볼륨매직', '#디지털펌', '#모발손상', '#펌후관리', '#미용실원장', '#헤어케어팁', '#산성펌'],
    links: ['손상모 트리트먼트, 집에서 하는 3단계 루틴', '펌 종류별 유지 기간 비교', '미용실 가기 전 꼭 체크할 5가지'],
  },
  {
    type: '네이버 SEO', typeClass: 'typeNaver', tone: '전문가 톤', who: '필라테스 강사',
    title: '체형 교정 필라테스, 3개월 변화 과정 기록',
    hook: '8년간 체형 교정 수업을 진행하면서 가장 많이 받는 질문이 있습니다. "필라테스로 체형이 진짜 바뀌나요?" 결론부터 말씀드리면 바뀝니다. 다만 주 2회 이상 꾸준히, 최소 3개월은 투자해야 눈에 보이는 변화가 옵니다. 오늘은 실제 회원 3분의 교정 과정을 수치와 함께 공유하겠습니다.',
    body: '【01.】 체형 교정에 필라테스가 적합한 이유\n\n거북목, 라운드숄더, 골반 틀어짐. 이 세 가지는 근본 원인이 같습니다. 코어 근력 약화와 좌우 근육 불균형이 동시에 작용합니다. 필라테스는 리포머, 캐딜락 같은 기구를 활용해 약한 근육만 선택적으로 강화할 수 있어서 교정 효과가 빠릅니다.\n\n【02.】 3개월 교정 프로그램, 실제 과정과 수치 변화\n\n1개월 차는 인지 단계입니다. 체형 분석 장비로 골반 높이 차이, 어깨 높이 차이, 머리 전방 이동 거리를 측정합니다. 대부분의 회원분들이 "왼쪽 골반이 이렇게 높았어요?" 하고 놀라십니다.\n\n2개월 차부터 눈에 보이는 변화가 시작됩니다. 지난 분기 회원 A님(31세, 사무직)은 어깨 높이 차이가 2.3cm에서 0.8cm로 줄었습니다. B님(28세, 디자이너)은 거북목 전방 이동 거리가 4.2cm에서 2.1cm로 감소했습니다.\n\n3개월 차에는 교정된 자세가 일상에서 유지되기 시작합니다.\n\n【03.】 효과가 안 나는 경우, 솔직하게 말씀드립니다\n\n주 1회만으로는 어렵습니다. 경험상 주 1회는 현상 유지 수준이고, 교정 효과를 보려면 주 2회가 최소입니다. 수업 시간 외 일상 습관이 70% 이상을 좌우합니다.',
    cta: '체형이 신경 쓰이신다면 현재 상태를 정확히 파악하는 것이 첫 단계입니다. 1회 체험 수업에서 체형 분석 리포트를 함께 제공해드립니다. 수치로 보면 자신의 상태가 명확해집니다.',
    tags: ['#체형교정', '#필라테스', '#거북목교정', '#라운드숄더', '#골반교정', '#필라테스효과', '#자세교정', '#리포머필라테스', '#코어운동', '#필라테스강사'],
    links: ['거북목 자가 진단법과 스트레칭 3가지', '필라테스 vs 요가, 체형 교정에 뭐가 나을까?', '사무직을 위한 일상 자세 교정 가이드'],
  },
  {
    type: '구글 SEO', typeClass: 'typeGoogle', tone: '전문가 톤', who: '인테리어 업체',
    title: '소형 아파트 리모델링 비용과 시공 사례 총정리 (2026)',
    hook: '20평대 소형 아파트 리모델링 평균 비용은 평당 150~250만 원입니다. 다만 이 수치는 철거 범위와 자재 등급에 따라 2배 이상 차이가 납니다. 11년간 370건 이상 소형 아파트를 시공하면서 축적한 데이터를 기반으로 실제 비용 구조를 분석해드리겠습니다.',
    body: '## 소형 아파트 리모델링 비용 구조\n\n전체 비용에서 인건비가 약 35%, 자재비가 약 45%, 설계 및 기타 비용이 20%를 차지합니다. 2026년 기준 인건비가 전년 대비 8% 상승했으며, 이는 숙련공 부족이 주요 원인입니다.\n\n주의할 점은 "평당 가격"만으로는 총 비용을 예측할 수 없다는 것입니다. 같은 20평이라도 욕실 2개를 전면 교체하면 욕실 1개 기준보다 400~600만 원이 추가됩니다.\n\n## 평수별 실제 시공 비용 사례\n\n18평 아파트 전체 리모델링 사례입니다. 부엌과 욕실 전면 교체, 거실 바닥 강화마루 시공, 전체 도배에 총 3,200만 원이 소요되었습니다. 공사 기간은 4주였습니다.\n\n24평 사례에서는 전체 리모델링에 4,100만 원이 들었습니다. 18평과 가장 큰 차이는 거실 확장 철거 비용(280만 원)과 넓어진 면적에 따른 바닥재 비용 증가입니다.\n\n## 비용을 줄이는 3가지 방법\n\n첫째, 철거 범위를 최소화하는 것입니다. 기존 배관을 살릴 수 있다면 200~300만 원을 절약할 수 있습니다.\n\n둘째, 자재를 직접 구매하면 마진을 줄일 수 있지만, 하자 발생 시 책임 소재가 불분명해질 수 있어 주의가 필요합니다.\n\n셋째, 비수기(1~2월, 7~8월)를 활용하면 인건비를 10~15% 절감할 수 있습니다.\n\n## 업체 선정 시 반드시 확인할 체크리스트\n\n사업자등록증 및 건설업 등록 여부, 최근 1년 내 시공 사례 3건 이상, 하자 보수 기간 및 조건 (최소 1년 이상), 공정별 중간 정산 방식, 실제 시공한 고객 후기 확인.',
    faq: 'Q: 리모델링 중 거주가 가능한가요?\nA: 부분 리모델링(욕실 또는 주방만)의 경우 거주하면서 공사가 가능합니다. 전체 리모델링은 최소 3~4주간 이사가 필요하며, 분진과 소음으로 인해 거주가 사실상 불가합니다.\n\nQ: 리모델링 후 하자가 발견되면 어떻게 하나요?\nA: 계약서에 하자 보수 기간(보통 1~2년)이 명시되어 있어야 합니다. 하자 발생 시 사진과 영상으로 기록한 뒤 업체에 서면으로 보수를 요청하세요.',
    cta: '소형 아파트 리모델링을 계획 중이시라면 현장 실측이 가장 정확합니다. 도면과 현장 상태를 직접 확인해야 정확한 견적이 나옵니다. 무료 방문 견적을 통해 비용을 확인해보시기 바랍니다.',
    tags: ['#아파트리모델링', '#인테리어비용', '#소형아파트인테리어', '#리모델링견적', '#욕실리모델링', '#주방인테리어', '#인테리어시공사례', '#아파트인테리어'],
    links: ['욕실 리모델링 자재별 가격 비교 (2026 최신)', '아파트 인테리어 업체 고르는 5가지 기준', '리모델링 전 반드시 확인할 배관 점검 방법'],
  },
];

/**
 * String value 안의 raw 줄바꿈/탭/제어 문자를 escape 시퀀스로 치환.
 * Claude가 JSON 출력할 때 본문 내 literal newline을 넣어 JSON.parse가
 * 실패하는 케이스 대응.
 */
function normalizeJsonEscape(text) {
  let result = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (esc) {
      result += c;
      esc = false;
      continue;
    }
    if (c === '\\') {
      result += c;
      esc = true;
      continue;
    }
    if (c === '"') {
      result += c;
      inStr = !inStr;
      continue;
    }
    if (inStr) {
      // 문자열 안에서 제어 문자는 escape 시퀀스로
      if (c === '\n') { result += '\\n'; continue; }
      if (c === '\r') { result += '\\r'; continue; }
      if (c === '\t') { result += '\\t'; continue; }
    }
    result += c;
  }
  return result;
}

function safeParseJson(rawText) {
  // 1차: 원본 그대로 시도
  try { return JSON.parse(rawText); } catch (_) {}

  // 2차: escape 정규화 후 재시도
  try { return JSON.parse(normalizeJsonEscape(rawText)); } catch (_) {}

  // 3차: balanced brace 매칭으로 JSON 부분 추출
  const start = rawText.indexOf('{');
  if (start === -1) throw new Error('AI 응답을 파싱할 수 없습니다. 다시 시도해주세요.');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < rawText.length; i++) {
    const c = rawText[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const extracted = rawText.substring(start, i + 1);
        // 4차: 추출한 부분도 escape 정규화 시도
        try { return JSON.parse(extracted); } catch (_) {}
        try { return JSON.parse(normalizeJsonEscape(extracted)); } catch (_) {}
        break;
      }
    }
  }
  throw new Error('AI 응답을 파싱할 수 없습니다. 다시 시도해주세요.');
}

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const tk = getToken();
  if (tk) h.Authorization = `Bearer ${tk}`;
  return h;
}

function buildFullText(d) {
  return (d.hook || '') + '\n\n' + (d.body || '') + '\n\n' + (d.cta || '');
}

const TYPE_LABELS = { 'homefeed': '네이버 홈피드', 'naver-seo': '네이버 SEO', 'google-seo': '구글 SEO' };

function CopyButton({ onCopy }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`${styles.copyBtn} ${copied ? styles.copyBtnCopied : ''}`}
      onClick={() => {
        onCopy().then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? '✓ 복사됨' : '복사'}
    </button>
  );
}

function ReviewCard({ scoreData, generatedData, hasImproved, isImproving, onImprove }) {
  if (!scoreData) return null;
  const maxScore = 90;
  const totalScore = scoreData.totalScore;
  const circumference = 326.73;
  const offset = circumference - (circumference * totalScore) / maxScore;
  const color = totalScore >= 80 ? '#4ade80' : totalScore >= 60 ? '#facc15' : '#f87171';
  const [summaryTitle, summaryDesc] = totalScore >= 80
    ? ['발행 가능! AI 티가 나지 않습니다', '사람이 쓴 느낌의 자연스러운 글입니다. 그대로 발행하세요.']
    : totalScore >= 60
      ? ['수정 후 발행을 권장합니다', '일부 항목에서 AI 느낌이 감지됩니다. 자동 수정 버튼으로 개선하세요.']
      : ['재작성이 필요합니다', 'AI가 쓴 티가 많이 납니다. 아래 제안을 반영하여 수정하세요.'];
  const label = totalScore >= 80 ? '발행 가능' : totalScore >= 60 ? '수정 후 발행' : '재작성 필요';
  const suggestions = scoreData.results.filter((r) => r.suggestion && r.score < r.max);

  return (
    <div className={styles.reviewCard}>
      <div className={styles.reviewHeader}>
        <div className={styles.reviewGauge}>
          <svg viewBox="0 0 120 120" className={styles.reviewSvg}>
            <circle cx="60" cy="60" r="52" className={styles.gaugeBg} />
            <circle
              cx="60"
              cy="60"
              r="52"
              className={styles.gaugeFill}
              style={{ stroke: color, strokeDashoffset: offset }}
            />
          </svg>
          <div className={styles.gaugeScore}>{totalScore}</div>
          <div className={styles.gaugeLabel} style={{ color }}>{label}</div>
        </div>
        <div className={styles.reviewSummary}>
          <div className={styles.reviewSummaryTitle} style={{ color }}>{summaryTitle}</div>
          <div className={styles.reviewSummaryDesc}>{summaryDesc} ({totalScore}/{maxScore}점)</div>
        </div>
      </div>
      <div className={styles.reviewChecklist}>
        {scoreData.results.map((r, i) => {
          const iconClass = r.status === 'pass'
            ? styles.reviewCheckIconPass
            : r.status === 'warn'
              ? styles.reviewCheckIconWarn
              : styles.reviewCheckIconFail;
          const icon = r.status === 'pass' ? '✓' : '!';
          return (
            <div key={i} className={styles.reviewCheckItem}>
              <div className={`${styles.reviewCheckIcon} ${iconClass}`}>{icon}</div>
              <span className={styles.reviewCheckLabel}>{r.label}</span>
              <span className={styles.reviewCheckScore}>{r.score}/{r.max}</span>
            </div>
          );
        })}
      </div>
      {totalScore < 80 && suggestions.length > 0 && (
        <>
          <div className={styles.reviewSuggestions}>
            <h4>개선 제안</h4>
            <ul>
              {suggestions.map((r, i) => <li key={i}>{r.suggestion}</li>)}
            </ul>
          </div>
          <button
            type="button"
            className={styles.btnImprove}
            onClick={onImprove}
            disabled={hasImproved || isImproving}
          >
            {isImproving
              ? '⏳ 자동 수정 중... (최대 30초)'
              : hasImproved
                ? '자동 수정 완료 (1회 제한)'
                : '자동 수정하기 (1회 재생성 가능)'}
          </button>
        </>
      )}
    </div>
  );
}

export default function BlogWriter() {
  const router = useRouter();
  const { user } = useAuth();

  const [selectedType, setSelectedType] = useState('homefeed');
  const [selectedTone, setSelectedTone] = useState('친근한 구어체');
  const [selectedCta, setSelectedCta] = useState('상담/예약 유도');
  const [ctaCustom, setCtaCustom] = useState('');

  const [industry, setIndustry] = useState('');
  const [topic, setTopic] = useState('');
  const [target, setTarget] = useState('');
  const [location, setLocation] = useState('');
  const [memo, setMemo] = useState('');

  const [presets, setPresets] = useState([]);
  const [exampleModalIndex, setExampleModalIndex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(LOADING_STEPS[0]);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState('');

  const [generatedData, setGeneratedData] = useState(null);
  const [scoreData, setScoreData] = useState(null);
  const [hasImproved, setHasImproved] = useState(false);
  const [isImproving, setIsImproving] = useState(false);

  const [remaining, setRemaining] = useState(null);
  const [limit, setLimit] = useState(null);
  const [isAdminMode, setIsAdminMode] = useState(false);

  const loadingIntervalRef = useRef(null);
  const internalLinkUrlsRef = useRef({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/generate', { headers: authHeaders() });
        const data = await res.json();
        if (typeof data.remaining === 'number') setRemaining(data.remaining);
        if (typeof data.limit === 'number') setLimit(data.limit);
        if (data.admin || data.remaining >= 999) setIsAdminMode(true);
      } catch (_) {}
    })();
  }, [user]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    (async () => {
      try {
        const res = await fetch('/api/presets', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.presets)) setPresets(data.presets);
        }
      } catch (_) {}
    })();
  }, [user]);

  function startLoadingSteps() {
    setLoadingStep(LOADING_STEPS[0]);
    setLoadingProgress(0);
    let idx = 0;
    loadingIntervalRef.current = setInterval(() => {
      idx = (idx + 1) % LOADING_STEPS.length;
      setLoadingStep(LOADING_STEPS[idx]);
      setLoadingProgress(Math.min(90, ((idx + 1) / LOADING_STEPS.length) * 90));
    }, 2500);
  }

  function stopLoadingSteps() {
    if (loadingIntervalRef.current) {
      clearInterval(loadingIntervalRef.current);
      loadingIntervalRef.current = null;
    }
    setLoadingProgress(100);
  }

  async function replaceVocab(parsed) {
    try {
      const res = await fetch('/api/score-check', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'replace', parsed }),
      });
      if (res.ok) {
        const data = await res.json();
        Object.assign(parsed, data.parsed);
      }
    } catch (_) {}
  }

  async function runReview(data) {
    const fullText = buildFullText(data);
    try {
      const res = await fetch('/api/score-check', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'score', text: fullText }),
      });
      if (!res.ok) throw new Error('검수 API 오류');
      const result = await res.json();
      setScoreData(result);
    } catch (_) {}
  }

  async function generate() {
    setError('');

    if (!industry.trim()) { setError('업종/입장을 입력해주세요. (예: 미용실 원장, 뷰티 블로거)'); return; }
    if (!topic.trim()) { setError('주제/키워드를 입력해주세요.'); return; }
    if (!target.trim()) { setError('대상(예상 독자)을 입력해주세요. (예: 30대 직장맘, 자영업 초보)'); return; }
    if (!memo.trim()) { setError('추가 요청사항을 입력해주세요. 나만의 경험·느낌을 적으면 더 좋은 글이 됩니다.'); return; }

    setLoading(true);
    setGeneratedData(null);
    setScoreData(null);
    setHasImproved(false);
    startLoadingSteps();

    const systemPrompt = SYSTEM_PROMPTS[selectedType];
    const ctaText = selectedCta === '직접 입력' ? (ctaCustom.trim() || '자연스러운 마무리') : selectedCta;

    const userParts = [
      `★ 글쓴이: "${industry}" — 이 입장에 충실하게, 본인이 직접 경험한 1인칭 글을 쓰세요.`,
      `대상(예상 독자): ${target}`,
    ];
    if (location) userParts.push(`지역: ${location}`);
    userParts.push(`오늘의 소재: ${topic}`);
    userParts.push(`마무리 CTA: ${ctaText}`);
    userParts.push(`나의 경험/요청사항: ${memo}`);
    userParts.push(`톤: ${selectedTone}`);
    userParts.push('');
    userParts.push(TONE_GUIDES[selectedTone]);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8192,
          system: systemPrompt,
          messages: [{ role: 'user', content: userParts.join('\n') }],
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.');
      }
      const data = await res.json();

      if (res.status === 429) {
        setError(typeof data.error === 'string' ? data.error : '오늘 무료 사용 횟수를 모두 소진했습니다. 내일 다시 이용해주세요.');
        return;
      }
      if (!res.ok || data.error) {
        const errMsg = typeof data.error === 'string'
          ? data.error
          : data.error?.error?.message || data.error?.message || '글 생성 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
        throw new Error(errMsg);
      }

      let rawText = (data.content?.[0]?.text || '').trim();
      if (!rawText) throw new Error('AI 응답이 비어있습니다. 다시 한번 시도해주세요.');
      rawText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

      const parsed = safeParseJson(rawText);

      if (Array.isArray(parsed.corrections) && parsed.corrections.length > 0) {
        parsed.corrections.forEach((c) => {
          if (c.wrong && c.correct && c.wrong !== c.correct) {
            ['title', 'description', 'hook', 'body', 'cta', 'faq', 'meta_description'].forEach((field) => {
              if (parsed[field] && parsed[field].indexOf(c.wrong) !== -1) {
                parsed[field] = parsed[field].split(c.wrong).join(c.correct);
              }
            });
          }
        });
      }

      if (!parsed.body || parsed.body.trim().length < 50) {
        throw new Error('본문이 제대로 생성되지 않았습니다. 다시 시도해주세요.');
      }

      await replaceVocab(parsed);
      setGeneratedData(parsed);
      runReview(parsed);

      if (typeof data.remaining === 'number') setRemaining(data.remaining);
      if (typeof data.limit === 'number') setLimit(data.limit);

      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
    } catch (err) {
      setError(err.message || '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
      stopLoadingSteps();
    }
  }

  async function improveContent() {
    if (!generatedData || hasImproved || !scoreData) return;
    if (isImproving) return; // 중복 호출 방지
    setIsImproving(true);
    const allResults = scoreData.results;
    const currentTotal = scoreData.totalScore;

    const improveParts = [];
    const focusItems = [];
    allResults.forEach((r, i) => {
      const num = i + 1;
      const statusMark = r.score === r.max ? 'PASS' : r.score > 0 ? 'WARN' : 'FAIL';
      improveParts.push(`(${num}) ${r.label}: ${r.score}/${r.max}점 [${statusMark}]${r.suggestion ? ' — ' + r.suggestion : ''}`);
      if (r.score < r.max) focusItems.push(`(${num}) ${r.label}`);
    });

    const improveSystem = '당신은 네이버 블로그 전문 작가입니다.\n'
      + '아래 글을 사람이 쓴 것처럼 완전히 재작성하세요. 7개 채점 항목을 전부 만점 받아야 합니다.\n\n'
      + '【금지 어휘 — 0개 필수】\n'
      + '효과적인, 체계적인, 다양한, 중요합니다, 도움이 됩니다, 활용하세요, 살펴보겠습니다, 알아보겠습니다, 소개해드리겠습니다, 필수적인, 핵심적인, 전반적인, 포괄적인, 이를 통해, 결론적으로, 최적화된, 진행해보겠습니다\n'
      + '→ 위 17개 단어 사용 금지.\n\n'
      + '【어미 반복 — 같은 어미 2연속 금지 (가장 중요!)】\n'
      + '검수기는 문장 끝 어미를 추출하여 연속 비교합니다.\n'
      + '습니다/합니다/됩니다/해요/네요/거든요/더라고요/잖아요/죠/세요 + ~다(했다/왔다/이다 등 2글자 구분)\n'
      + '★ 반드시 매 문장마다 다른 어미를 사용하세요. 어미 교대 패턴 예시:\n'
      + '  "...거든요. ...더라고요. ...했다. ...잖아요. ...해요. ...이었다. ...네요. ...죠."\n'
      + '★ 특히 ~습니다/~합니다가 2번 연속되면 바로 감점. ~해요/~네요도 마찬가지.\n\n'
      + '【숫자+단위 3개 이상】\n'
      + '검수기 인식 형태: 숫자 바로 뒤에 단위 (3개월, 2만원, 15분, 80%, 500g, 10회 등)\n'
      + '"서울", "스타벅스", "많은" 등은 인정 안 됨. 반드시 "숫자+단위" 형태로.\n\n'
      + '【직접 경험 문장 2개 이상】\n'
      + '검수기가 인식하는 패턴만 사용: 했더니, 해보니, 써보니, 먹어보니, 가보니, 만들어보니, 처음엔, 직접 써/해/가/먹/만들어, 실제로 해/써, 제가 ~했을 때, 써봤, 해봤, 가봤, 먹어봤\n'
      + '주의: "사용해보니", "경험해보니", "시도해보니"는 인정 안 됨\n\n'
      + '【부정/반전 표현 1개 이상】\n'
      + '인정되는 표현: 솔직히, 별로, 아쉬웠, 실패, 생각보다, 예상보다 못, 사실 좀, 후회, 불편했, 안 좋았, 힘들었, 아쉽게도\n'
      + '원본에 있으면 절대 제거 금지. 없으면 자연스럽게 1개 추가.\n\n'
      + '【문장 길이 편차 — 최소 40자 차이】\n'
      + '10자 이하 초단문 반드시 2개 포함 (예: "진짜였다.", "이게 핵심이다.", "대박.")\n'
      + '60자 이상 긴 문장도 1~2개 포함. 짧은 문장과 긴 문장의 차이가 40자 이상 되어야 합니다.\n\n'
      + '【구조 기계성 — 문단 길이 불균일 필수 (매우 중요!)】\n'
      + '검수기는 문단(\\n\\n 기준)의 길이 균일도를 측정합니다. 균일 비율 50% 미만이어야 합격.\n'
      + '★ 반드시 이렇게 섞으세요:\n'
      + '  - 1~2줄짜리 짧은 독백 문단 3개 이상 (예: "솔직히 이건 좀 놀랐다.\\n")\n'
      + '  - 5줄 이상 긴 설명 문단 1~2개\n'
      + '  - 3~4줄 중간 문단은 전체의 절반 미만으로\n'
      + '★ 모든 문단이 3~4줄로 균일하면 0점. 극단적으로 불규칙하게 작성하세요.\n\n'
      + '【출력 전 자가 검증 체크리스트】\n'
      + '□ 금지 어휘 17개 중 0개 사용했는가?\n'
      + '□ 같은 어미가 2문장 연속된 곳이 없는가?\n'
      + '□ 숫자+단위가 3개 이상인가?\n'
      + '□ 직접 경험 패턴이 2개 이상인가?\n'
      + '□ 부정/반전 표현이 1개 이상인가?\n'
      + '□ 10자 이하 초단문이 있고, 가장 긴 문장과 40자 이상 차이나는가?\n'
      + '□ 1~2줄 짧은 문단이 3개+, 5줄+ 긴 문단이 1개+ 있는가?\n'
      + '모든 항목에 체크되어야 80점 이상입니다. 하나라도 빠지면 실패.\n\n'
      + '원본의 주제, 정보, 키워드, 톤은 유지. 문체와 표현만 변경.\n\n'
      + '★★★ 이미지 마커 보존 — 최우선 규칙 ★★★\n'
      + 'body 안에 있는 "(사진: ... )" 마커를 절대 삭제하지 마세요.\n'
      + '원본 body의 마커 개수(8개)와 위치를 정확히 그대로 유지해야 합니다.\n'
      + '마커가 1개라도 빠지면 이미지 생성이 불가능하므로 글 전체가 무효입니다.\n'
      + '해시태그, 내부링크도 원본 그대로.\n\n'
      + '반드시 아래 JSON 형식으로만 응답하세요.\n'
      + (selectedType === 'naver-seo'
        ? '{\n  "title": "제목",\n  "description": "설명문 (45자 이내, 제목과 다른 각도로 핵심 요약)",\n  "hook": "도입부",\n  "body": "본문",\n  "cta": "마무리",\n  "tags": ["태그1",...],\n  "internal_links": ["글제목1",...]\n}'
        : selectedType === 'google-seo'
          ? '{\n  "title": "제목",\n  "meta_description": "메타 디스크립션 (120~155자)",\n  "hook": "도입부",\n  "body": "본문",\n  "faq": "FAQ",\n  "cta": "마무리",\n  "tags": ["태그1",...],\n  "internal_links": ["글제목1",...]\n}'
          : '{\n  "title": "제목",\n  "hook": "도입부",\n  "body": "본문",\n  "cta": "마무리",\n  "tags": ["태그1",...],\n  "internal_links": ["글제목1",...]\n}');

    const userMsg = '【원본 글】\n'
      + `제목: ${generatedData.title || ''}\n`
      + (selectedType === 'naver-seo' && generatedData.description ? `설명문: ${generatedData.description}\n` : '')
      + '\n'
      + `도입부:\n${generatedData.hook || ''}\n\n`
      + `본문:\n${generatedData.body || ''}\n\n`
      + `마무리:\n${generatedData.cta || ''}\n\n`
      + `해시태그: ${(generatedData.tags || []).join(', ')}\n`
      + `내부링크: ${(generatedData.internal_links || []).join(', ')}\n\n`
      + `【AI 검수 결과 — 현재 ${currentTotal}/90점】\n${improveParts.join('\n')}\n\n`
      + `★ 집중 개선 필요 항목: ${focusItems.join(', ')}\n`
      + '★ 목표: 80점 이상 (각 항목 만점 달성 필수). 위 감점 항목을 최우선으로 수정하세요.\n'
      + '★ PASS 항목은 현재 수준을 절대 떨어뜨리지 마세요.';

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8192,
          system: improveSystem,
          messages: [{ role: 'user', content: userMsg }],
          isAutoCorrect: true,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error('서버 응답 오류');
      const data = await res.json();

      if (res.status === 429) throw new Error(typeof data.error === 'string' ? data.error : '사용 횟수를 초과했습니다.');
      if (!res.ok || data.error) throw new Error(data.error || 'API 오류가 발생했습니다.');

      let rawText = (data.content?.[0]?.text || '');
      if (!rawText) throw new Error('AI 응답이 비어있습니다.');
      rawText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

      const parsed = safeParseJson(rawText);
      if (!parsed.body || parsed.body.trim().length < 50) {
        throw new Error('본문이 제대로 생성되지 않았습니다. 다시 시도해주세요.');
      }

      await replaceVocab(parsed);
      setGeneratedData(parsed);
      runReview(parsed);
      setHasImproved(true);

      if (typeof data.remaining === 'number') setRemaining(data.remaining);
      if (typeof data.limit === 'number') setLimit(data.limit);
    } catch (err) {
      alert('수정 실패: ' + err.message + '\n\n다시 시도하시려면 버튼을 한 번만 눌러주세요.');
    } finally {
      setIsImproving(false);
    }
  }

  function savePreset() {
    if (!industry && !target && !location) return;
    const next = [...presets, { industry, target, location }].slice(-5);
    setPresets(next);
    const token = getToken();
    if (token) {
      fetch('/api/presets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ presets: next }),
      }).catch(() => {});
    }
  }

  function applyPreset(i) {
    const p = presets[i];
    if (!p) return;
    setIndustry(p.industry || '');
    setTarget(p.target || '');
    setLocation(p.location || '');
  }

  function deletePreset(i) {
    const next = presets.filter((_, idx) => idx !== i);
    setPresets(next);
    const token = getToken();
    if (token) {
      fetch('/api/presets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ presets: next }),
      }).catch(() => {});
    }
  }

  function buildInternalLinksText() {
    if (!generatedData?.internal_links) return '';
    const lines = ['', '📎 함께 보면 좋은 글'];
    generatedData.internal_links.forEach((title, i) => {
      const url = internalLinkUrlsRef.current[i] || '';
      lines.push(url ? `👉 ${title} → ${url}` : `👉 ${title}`);
    });
    return lines.join('\n');
  }

  function copyTitleText() { return clipCopy(generatedData.title || ''); }
  function copyHookText() { return clipCopy(generatedData.hook || ''); }
  function copyBodyText() { return clipCopy(generatedData.body || ''); }
  function copyCtaText() { return clipCopy(generatedData.cta || ''); }
  function copyDescriptionText() { return clipCopy(generatedData.description || ''); }
  function copyMetaDescText() { return clipCopy(generatedData.meta_description || ''); }
  function copyFaqText() { return clipCopy(generatedData.faq || ''); }
  function copyTagsText() {
    const tags = (generatedData.tags || []).map((t) => (t.startsWith('#') ? t : '#' + t)).join(' ');
    return clipCopy(tags);
  }
  function copyInternalLinksText() { return clipCopy(buildInternalLinksText()); }

  function copyAll() {
    if (!generatedData) return Promise.resolve();
    const parts = [];
    if (generatedData.title) { parts.push(generatedData.title); parts.push(''); }
    if (selectedType === 'naver-seo' && generatedData.description) { parts.push(generatedData.description); parts.push(''); }
    if (selectedType === 'google-seo' && generatedData.meta_description) {
      parts.push('[메타 디스크립션]');
      parts.push(generatedData.meta_description);
      parts.push('');
    }
    if (generatedData.hook) { parts.push(generatedData.hook); parts.push(''); }
    if (generatedData.body) { parts.push(generatedData.body); parts.push(''); }
    if (selectedType === 'google-seo' && generatedData.faq) {
      parts.push('[FAQ]');
      parts.push(generatedData.faq);
      parts.push('');
    }
    if (generatedData.cta) { parts.push(generatedData.cta); parts.push(''); }
    if (Array.isArray(generatedData.tags)) {
      parts.push(generatedData.tags.map((t) => (t.startsWith('#') ? t : '#' + t)).join(' '));
    }
    const linksText = buildInternalLinksText();
    if (linksText) { parts.push(''); parts.push(linksText); }
    return clipCopy(parts.join('\n'));
  }

  function resetForm() {
    setGeneratedData(null);
    setScoreData(null);
    setHasImproved(false);
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goToPremiumImage() {
    if (!generatedData) { alert('먼저 글을 생성해주세요.'); return; }
    const parts = [generatedData.title, generatedData.hook, generatedData.body, generatedData.faq, generatedData.cta].filter(Boolean);
    try {
      localStorage.setItem('blogTextForImagePro', parts.join('\n\n'));
    } catch (_) {}
    router.push('/blog-image-pro');
  }

  function goToShortform() {
    if (!generatedData) { alert('먼저 글을 생성해주세요.'); return; }
    const parts = [generatedData.title, generatedData.hook, generatedData.body, generatedData.cta].filter(Boolean);
    const blogText = parts.join('\n\n');
    try {
      // ShortformClient는 blogText 필드를 읽음 (body는 역호환 키)
      localStorage.setItem('blogTextForShortform', JSON.stringify({
        blogText,
        body: blogText, // 역호환 유지
        memo: memo.trim(),
        topic: topic.trim(),
      }));
    } catch (_) {}
    router.push('/shortform');
  }

  function goToCardNews() {
    if (!generatedData) { alert('먼저 글을 생성해주세요.'); return; }
    const parts = [generatedData.title, generatedData.hook, generatedData.body, generatedData.cta].filter(Boolean);
    try {
      localStorage.setItem('blogTextForCardNews', parts.join('\n\n'));
    } catch (_) {}
    router.push('/card-news');
  }

  const remainingLabel = (() => {
    if (isAdminMode) return '👑 관리자 모드 (무제한)';
    if (remaining === null) return '남은 횟수 확인 중...';
    if (limit === 0) return '현재 무료 사용이 제한되어 있습니다';
    return `오늘 남은 횟수: ${remaining}/${limit || '?'}회`;
  })();
  const generateDisabled = loading || (!isAdminMode && remaining !== null && remaining <= 0 && limit !== null);

  const showResult = generatedData && !loading;
  const isNaverSeo = selectedType === 'naver-seo';
  const isGoogleSeo = selectedType === 'google-seo';

  return (
    <main className={styles.root}>
      <div className={styles.hero}>
        <div className={styles.heroBadge}>PRO · 블로그 글</div>
        <h1>상위노출 <em>블로그 글</em>, 뚝딱</h1>
        <p>업종과 주제만 입력하면<br />네이버 홈피드 · SEO에 최적화된<br />블로그 글을 만들어드립니다</p>
        <div className={styles.heroFeatures}>
          <span className={styles.heroFeature}><span>7항목</span> AI 검수기</span>
          <span className={styles.heroFeature}><span>1회</span> 자동 수정</span>
          <span className={styles.heroFeature}><span>1크레딧</span> 고품질 글</span>
        </div>
      </div>

      <div className={styles.container}>
        {!user && (
          <div className={styles.signupBanner}>
            회원가입하면 1일 3회 무료 체험 가능! <a href="/signup">가입하기</a>
          </div>
        )}

        {!showResult && (
          <>
            <div className={`${styles.card} ${styles.guideCard}`}>
              <div className={styles.cardLabel}>이렇게 쓰면 더 좋아요</div>
              <ul className={styles.guideList}>
                <li>
                  <strong>업종/입장</strong>을 정확히 써주세요. 같은 &quot;미용실&quot;이라도 <em>원장이 쓰는 글</em>과 <em>방문 고객 후기</em>는 완전히 다릅니다.<br />
                  <span className={styles.guideExample}>예) 미용실 원장 · 카페 사장 · 필라테스 강사 · 뷰티 블로거 · 맛집 탐방 블로거</span>
                </li>
                <li>
                  <strong>추가 요청사항</strong>에 나만의 <em>권위, 경력, 경험, 느낌</em>을 담아주세요. 전문성과 에피소드가 들어갈수록 AI가 아닌 <em>나만의 글</em>이 됩니다.<br />
                  <span className={styles.guideExample}>예) 15년차 헤어 디자이너, 처음엔 반신반의했는데 한 달 뒤 머릿결이 확 달라짐, 손님이 &quot;여기 물 맛있다&quot;고 한 마디 해줬을 때 뿌듯했음</span>
                </li>
              </ul>
            </div>

            <div className={styles.card}>
              <div className={styles.cardLabel}>이런 글이 만들어져요</div>
              <div className={styles.exampleCarousel}>
                {EXAMPLES.map((ex, i) => (
                  <div
                    key={i}
                    className={styles.exampleCard}
                    onClick={() => setExampleModalIndex(i)}
                  >
                    <div className={styles.exampleChips}>
                      <span className={`${styles.exampleChip} ${styles[ex.typeClass] || ''}`}>{ex.type}</span>
                      <span className={styles.exampleChip}>{ex.tone}</span>
                      <span className={styles.exampleChip}>{ex.who}</span>
                    </div>
                    <div className={styles.exampleTitle}>{ex.title}</div>
                    <div className={styles.examplePreview}>{ex.hook}</div>
                    <span className={styles.exampleMore}>전체 보기 →</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardLabel}>글 유형</div>
              <div className={`${styles.typeGrid} ${styles.typeGridThree}`}>
                {TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`${styles.typeBtn} ${selectedType === t.id ? styles.typeBtnActive : ''}`}
                    onClick={() => setSelectedType(t.id)}
                  >
                    <span className={styles.typeIcon}>{t.icon}</span>
                    <span className={styles.typeName}>{t.name}</span>
                    <span className={styles.typeDesc}>{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardLabel}>톤 선택</div>
              <div className={styles.typeGrid}>
                {TONES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`${styles.typeBtn} ${selectedTone === t.id ? styles.typeBtnActive : ''}`}
                    onClick={() => setSelectedTone(t.id)}
                  >
                    <span className={styles.typeName}>{t.icon} {t.id}</span>
                    <span className={styles.typeDesc}>{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardLabel}>마무리 CTA</div>
              <div className={styles.typeGrid}>
                {CTAS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`${styles.typeBtn} ${selectedCta === c.id ? styles.typeBtnActive : ''}`}
                    onClick={() => setSelectedCta(c.id)}
                  >
                    <span className={styles.typeName}>{c.icon} {c.id}</span>
                    <span className={styles.typeDesc}>{c.desc}</span>
                  </button>
                ))}
              </div>
              {selectedCta === '직접 입력' && (
                <div className={styles.ctaCustomWrap}>
                  <input
                    type="text"
                    className={styles.inputField}
                    placeholder="예: 네이버 예약으로 10% 할인 받으세요"
                    maxLength={60}
                    value={ctaCustom}
                    onChange={(e) => setCtaCustom(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className={styles.card}>
              <div className={styles.cardLabel}>내용 입력</div>

              <div className={styles.presetSection}>
                <div className={styles.presetLabel}>자주 쓰는 설정</div>
                <div className={styles.presetChips}>
                  {presets.map((p, i) => (
                    <span key={i} className={styles.presetChip}>
                      <span onClick={() => applyPreset(i)}>{p.industry || '이름없음'}</span>
                      <span className={styles.presetDelete} onClick={() => deletePreset(i)}>×</span>
                    </span>
                  ))}
                  <button type="button" className={styles.presetSaveBtn} onClick={savePreset}>+ 현재 설정 저장</button>
                </div>
              </div>

              <div className={styles.inputRow}>
                <div className={styles.inputGroup}>
                  <label className={styles.inputLabel}>업종/입장 <span className={styles.req}>*</span></label>
                  <input
                    type="text"
                    className={styles.inputField}
                    placeholder="예: 미용실 원장, 카페 사장, 뷰티 블로거"
                    maxLength={30}
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                  />
                </div>
                <div className={styles.inputGroup}>
                  <label className={styles.inputLabel}>주제/키워드 <span className={styles.req}>*</span></label>
                  <input
                    type="text"
                    className={styles.inputField}
                    placeholder="예: 손톱 관리법, 다이어트 식단"
                    maxLength={30}
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.inputRow}>
                <div className={styles.inputGroup}>
                  <label className={styles.inputLabel}>대상 <span className={styles.req}>*</span></label>
                  <textarea
                    className={styles.textareaField}
                    placeholder="예: 두피케어 받고 싶어서 검색 중인 30대 직장인 여성"
                    maxLength={80}
                    style={{ minHeight: 44, height: 44, resize: 'none' }}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  />
                </div>
                <div className={styles.inputGroup}>
                  <label className={styles.inputLabel}>지역 <span style={{ color: '#555', fontWeight: 400 }}>(선택)</span></label>
                  <input
                    type="text"
                    className={styles.inputField}
                    placeholder="예: 강남, 홍대, 부산 서면"
                    maxLength={20}
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.inputLabel}>추가 요청사항 <span className={styles.req}>*</span></label>
                <textarea
                  className={styles.textareaField}
                  placeholder="나만의 경험·느낌·후기를 적어주세요. 많이 적을수록 나만의 글이 됩니다.&#10;예: 처음엔 반신반의했는데 한 달 뒤 머릿결이 확 달라짐, 단골 손님이 매번 칭찬해줌"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                />
              </div>
            </div>

            {error && <div className={styles.errorBox}>{error}</div>}

            <div className={styles.btnRow}>
              <button
                type="button"
                className={styles.btnGenerate}
                onClick={generate}
                disabled={generateDisabled}
              >
                {loading ? '생성 중...' : '블로그 글 생성하기'}
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
              <span className={styles.remainingCount}>1크레딧으로 고품질 블로그 글 생성</span>
              <span
                className={styles.remainingCount}
                style={{ color: isAdminMode ? '#3b82f6' : remaining !== null && remaining <= 1 ? '#ff5f1f' : '#6B7280' }}
              >
                {remainingLabel}
              </span>
            </div>
          </>
        )}

        {loading && (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner} />
            <p>AI가 블로그 글을 작성하고 있습니다</p>
            <div className={styles.loadingStep}>{loadingStep}</div>
            <div className={styles.loadingBar}>
              <div className={styles.loadingBarFill} style={{ width: `${loadingProgress}%` }} />
            </div>
            <div className={styles.loadingHint}>보통 20~40초 정도 소요됩니다</div>
          </div>
        )}

        {showResult && (
          <div className={styles.resultArea}>
            <div className={styles.selectedOptions}>
              <span className={styles.optionChip}>
                <span className={styles.chipLabel}>유형</span>
                <span className={styles.chipValue}>{TYPE_LABELS[selectedType] || selectedType}</span>
              </span>
              <span className={styles.optionChip}>
                <span className={styles.chipLabel}>톤</span>
                <span className={styles.chipValue}>{selectedTone}</span>
              </span>
              <span className={styles.optionChip}>
                <span className={styles.chipLabel}>CTA</span>
                <span className={styles.chipValue}>{selectedCta === '직접 입력' ? (ctaCustom || '직접 입력') : selectedCta}</span>
              </span>
              {industry && (
                <span className={styles.optionChip}>
                  <span className={styles.chipLabel}>업종/입장</span>
                  <span className={styles.chipValue}>{industry}</span>
                </span>
              )}
              {topic && (
                <span className={styles.optionChip}>
                  <span className={styles.chipLabel}>키워드</span>
                  <span className={styles.chipValue}>{topic}</span>
                </span>
              )}
              {location && (
                <span className={styles.optionChip}>
                  <span className={styles.chipLabel}>지역</span>
                  <span className={styles.chipValue}>{location}</span>
                </span>
              )}
            </div>

            <ReviewCard
              scoreData={scoreData}
              generatedData={generatedData}
              hasImproved={hasImproved}
              isImproving={isImproving}
              onImprove={improveContent}
            />

            <div className={styles.resultCard}>
              <div className={styles.resultCardHeader}>
                <h3>제목</h3>
                <CopyButton onCopy={copyTitleText} />
              </div>
              <div className={styles.resultTitleText}>{generatedData.title}</div>
            </div>

            {isNaverSeo && generatedData.description && (
              <div className={styles.resultCard}>
                <div className={styles.resultCardHeader}>
                  <h3>설명문</h3>
                  <CopyButton onCopy={copyDescriptionText} />
                </div>
                <div className={styles.resultText}>{generatedData.description}</div>
              </div>
            )}

            {isGoogleSeo && generatedData.meta_description && (
              <div className={styles.resultCard}>
                <div className={styles.resultCardHeader}>
                  <h3>메타 디스크립션</h3>
                  <CopyButton onCopy={copyMetaDescText} />
                </div>
                <div className={styles.resultText}>{generatedData.meta_description}</div>
              </div>
            )}

            <div className={styles.resultCard}>
              <div className={styles.resultCardHeader}>
                <h3>도입부</h3>
                <CopyButton onCopy={copyHookText} />
              </div>
              <div className={styles.resultText}>{generatedData.hook}</div>
            </div>

            <div className={styles.resultCard}>
              <div className={styles.resultCardHeader}>
                <h3>본문</h3>
                <CopyButton onCopy={copyBodyText} />
              </div>
              <div className={styles.resultText}>{generatedData.body}</div>
            </div>

            {isGoogleSeo && generatedData.faq && (
              <div className={styles.resultCard}>
                <div className={styles.resultCardHeader}>
                  <h3>FAQ</h3>
                  <CopyButton onCopy={copyFaqText} />
                </div>
                <div className={styles.resultText}>{generatedData.faq}</div>
              </div>
            )}

            <div className={styles.resultCard}>
              <div className={styles.resultCardHeader}>
                <h3>마무리</h3>
                <CopyButton onCopy={copyCtaText} />
              </div>
              <div className={styles.resultText}>{generatedData.cta}</div>
            </div>

            {Array.isArray(generatedData.tags) && generatedData.tags.length > 0 && (
              <div className={styles.resultCard}>
                <div className={styles.resultCardHeader}>
                  <h3>해시태그</h3>
                  <CopyButton onCopy={copyTagsText} />
                </div>
                <div className={styles.resultTagsWrap}>
                  {generatedData.tags.map((tag, i) => (
                    <span key={i} className={styles.resultTagItem}>
                      {tag.startsWith('#') ? tag : `#${tag}`}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(generatedData.internal_links) && generatedData.internal_links.length > 0 && (
              <div className={styles.resultCard}>
                <div className={styles.resultCardHeader}>
                  <h3>함께 보면 좋은 글</h3>
                  <CopyButton onCopy={copyInternalLinksText} />
                </div>
                <div>
                  {generatedData.internal_links.map((title, i) => (
                    <div key={i} className={styles.internalLinkRow}>
                      <span className={styles.internalLinkIcon}>👉</span>
                      <span className={styles.internalLinkTitle}>{title}</span>
                      <input
                        type="text"
                        className={styles.internalLinkUrl}
                        placeholder="내 블로그 글 URL 붙여넣기"
                        onChange={(e) => { internalLinkUrlsRef.current[i] = e.target.value; }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button type="button" className={styles.btnCopyAll} onClick={() => copyAll()}>
              전체 글 한 번에 복사
            </button>

            <div className={styles.handoffRow}>
              <button type="button" className={`${styles.handoffBtn} ${styles.handoffPremium}`} onClick={goToPremiumImage}>
                🎨 프리미엄 이미지 생성하기
              </button>
              {SHORTFORM_PAGE_ENABLED && (
                <button type="button" className={`${styles.handoffBtn} ${styles.handoffShortform}`} onClick={goToShortform}>
                  🎬 이 글로 숏폼 만들기
                </button>
              )}
              <button type="button" className={`${styles.handoffBtn} ${styles.handoffCardnews}`} onClick={goToCardNews}>
                🃏 카드뉴스로 만들기
              </button>
            </div>

            <button type="button" className={styles.resetBtn} onClick={resetForm}>
              ← 다시 쓰기
            </button>
          </div>
        )}
      </div>

      {exampleModalIndex !== null && (() => {
        const ex = EXAMPLES[exampleModalIndex];
        if (!ex) return null;
        return (
          <div
            className={styles.exampleModalOverlay}
            onClick={(e) => { if (e.target === e.currentTarget) setExampleModalIndex(null); }}
          >
            <div className={styles.exampleModal}>
              <button
                type="button"
                className={styles.exampleModalClose}
                onClick={() => setExampleModalIndex(null)}
              >
                ×
              </button>
              <div className={styles.exampleModalChips}>
                <span className={`${styles.exampleChip} ${styles[ex.typeClass] || ''}`}>{ex.type}</span>
                <span className={styles.exampleChip}>{ex.tone}</span>
                <span className={styles.exampleChip}>{ex.who}</span>
              </div>
              <div className={styles.exampleModalTitle}>{ex.title}</div>
              <div className={styles.exampleModalSection}>
                <h4>도입부</h4>
                <p>{ex.hook}</p>
              </div>
              <div className={styles.exampleModalSection}>
                <h4>본문</h4>
                <p>{ex.body}</p>
              </div>
              {ex.faq && (
                <div className={styles.exampleModalSection}>
                  <h4>FAQ</h4>
                  <p>{ex.faq}</p>
                </div>
              )}
              <div className={styles.exampleModalSection}>
                <h4>마무리</h4>
                <p>{ex.cta}</p>
              </div>
              <div className={styles.exampleModalSection}>
                <h4>해시태그</h4>
                <div className={styles.exampleModalTags}>
                  {ex.tags.map((t, j) => <span key={j}>{t}</span>)}
                </div>
              </div>
              {ex.links && ex.links.length > 0 && (
                <div className={styles.exampleModalSection}>
                  <h4>📎 함께 보면 좋은 글</h4>
                  <div className={styles.exampleModalLinks}>
                    {ex.links.map((l, j) => (
                      <div key={j} className={styles.exampleModalLink}>👉 {l}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </main>
  );
}
