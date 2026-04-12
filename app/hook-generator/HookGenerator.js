'use client';

import { useEffect, useRef, useState } from 'react';
import { clipCopy } from '@/lib/utils';
import { ga, reul } from '@/lib/josa';
import styles from './page.module.css';

const INDUSTRY_TAGS = ['미용실', '필라테스', '카페', '식당', '학원', '부동산', '인테리어', '동물병원', '네일샵', '베이커리', '공방', '코칭'];
const KEYWORD_TAGS = ['신규 고객', '단골 만들기', '매출 올리기', '다이어트', '탈모', '가성비', '리뷰 관리', '차별화', '초보자', 'SNS 마케팅'];

const HOOKS = [
  (I, K) => `이거 알면 ${I}에서 ${reul(K)} 고민 끝납니다🚨`,
  (I, K) => `${reul(K)} 모르면 ${I} 하면서 손해봅니다`,
  (I, K) => `이걸 몰랐다면 당신은 아직 ${I} 초보`,
  (I, K) => `${I}에서 ${reul(K)} 이거 알기 전엔 절대 시작하지 마세요`,
  (I, K) => `모르면 망하는 ${I} ${K} 상식`,
  (I, K) => `${K}에 대해 이걸 모르면 ${I}에서 손해보는 거예요`,
  (I, K) => `${I} 하면서 ${reul(K)} 이거 모르면 아직 왕초보입니다😅`,
  (I, K) => `${I} 전문가가 절대 말해주지 않는 ${K} 비밀`,
  (I, K) => `${I} 업계 고수들만 아는 ${K} 노하우`,
  (I, K) => `상위 1% ${I} 사장님이 실제로 쓰는 ${K} 방법`,
  (I, K) => `수천 명 고객 상담에서 나온 ${I} ${K} 공식`,
  (I, K) => `19년 경력이 알려주는 ${I} ${K} 진짜 해법`,
  (I, K) => `${I} 오래 한 사람들만 아는 ${K} 진실`,
  (I, K) => `전문가들이 숨겨두는 ${I} ${K} 내부 이야기`,
  (I, K) => `${I}에서 ${K} 성공하는 딱 3가지 공식`,
  (I, K) => `${I} 고객 10명 중 9명이 ${reul(K)} 잘못하고 있어요`,
  (I, K) => `${I}에서 ${K} 효과 보는 5가지 루틴`,
  (I, K) => `단 1가지만 바꿔도 달라지는 ${I} ${K}`,
  (I, K) => `5분 만에 ${I} ${K} 고민 끝내는 방법`,
  (I, K) => `1분만 봐도 달라지는 ${I} ${K} 핵심`,
  (I, K) => `${I} ${K}로 매출 2배 올린 단 한 가지`,
  (I, K) => `${I}에서 ${ga(K)} 좋다는 말, 사실은 반대일 수 있어요`,
  (I, K) => `열심히 ${K} 했는데 ${I}에서 효과 없는 이유`,
  (I, K) => `${K}의 역습 — ${I}에서 아무도 말 안 해주는 이야기`,
  (I, K) => `${I}에서 ${reul(K)} 많이 할수록 오히려 나빠지는 경우`,
  (I, K) => `다들 좋다는 ${K}… ${I}에선 독이 될 수 있습니다`,
  (I, K) => `누가 요즘 ${I}에서 그렇게 ${reul(K)} 해요? (이건 구시대 방법)`,
  (I, K) => `${I}에서 ${ga(K)} 답이라고요? 아닐 수도 있습니다`,
  (I, K) => `${I}에서 ${K}로 달라진 고객들의 공통점`,
  (I, K) => `${K} 하나로 ${I} 매출이 달라집니다`,
  (I, K) => `지금보다 더 잘 되고 싶다면 ${I} ${K}부터 바꾸세요`,
  (I, K) => `${reul(K)} 잡으면 ${I} 인생이 달라지는 이유`,
  (I, K) => `${I}에서 ${K}로 성공하는 사람들이 늘고 있습니다`,
  (I, K) => `${I} ${K}로 효과 본 고객들의 특징`,
  (I, K) => `${K} 때문에 ${I} 단골이 되는 사람들의 비밀`,
  (I, K) => `이거 모르면 ${I}에서 ${K} 계속 실패합니다🚨`,
  (I, K) => `${reul(K)} 모르면 ${I} 운영이 힘들어집니다`,
  (I, K) => `${I}에서 ${reul(K)} 안 하면 나중에 무조건 후회합니다`,
  (I, K) => `아직도 ${I}에서 ${reul(K)} 이렇게 하세요? (이건 손해)`,
  (I, K) => `${I} ${K}에 대해 지금 모르면 뒤처집니다`,
  (I, K) => `이 실수만 안 해도 ${I} ${ga(K)} 달라집니다`,
  (I, K) => `${I}에서 ${reul(K)} 잘못하면 생기는 일 ❌`,
  (I, K) => `${I}에서 ${K} 이거 보고 너무 놀랐어요🤯`,
  (I, K) => `${I} ${K}, 말로 설명이 안 될 정도입니다`,
  (I, K) => `이 ${I} ${K} 방법을 이제야 알려준다고요?`,
  (I, K) => `${I}에서 ${K}로 인생이 달라지는 순간`,
  (I, K) => `이 영상 보면 ${I} ${ga(K)} 바뀝니다`,
  (I, K) => `${I}에서 ${reul(K)} 경험하면 다시는 예전으로 못 돌아가요`,
  (I, K) => `아직도 ${I}에서 ${reul(K)} 이렇게 하고 계세요?`,
  (I, K) => `${I}에서 ${reul(K)} 할 때 절대 이렇게 하지 마세요`,
  (I, K) => `${I} ${K} 잘못 건드리면 돌이킬 수 없습니다`,
  (I, K) => `내 돈으로 ${I} ${K} 하는 시대는 끝났습니다`,
  (I, K) => `${I}에서 ${K} 시작 전 반드시 피해야 할 행동`,
  (I, K) => `${I} 사장님, ${reul(K)} 이렇게 하면 안 됩니다🚫`,
  (I, K) => `${I}에서 ${K} 때문에 불편하셨죠? 이젠 이렇게 해보세요`,
  (I, K) => `솔직히 ${ga(K)} 힘드신 거, 당신 잘못이 아닙니다`,
  (I, K) => `${I} 하면서 ${K} 때문에 속상했던 적 있으신가요?`,
  (I, K) => `${I}에서 ${K} 이 문제, 저도 겪어봤습니다`,
  (I, K) => `${K} 고민 다들 비슷합니다. ${I}에서 이렇게 해결했어요`,
  (I, K) => `${I}에서 ${K} 때문에 포기하려는 분들께`,
  (I, K) => `${I} 사장님 중 ${K} 때문에 고민하는 분, 꼭 보세요`,
  (I, K) => `${K} 준비 중이세요? ${I}에서 이것만 알면 됩니다`,
  (I, K) => `${I} 처음 시작하는 분들에게 ${K} 핵심만 알려드릴게요`,
  (I, K) => `${K} 때문에 ${I} 못 하고 계신 분들 여기 보세요`,
  (I, K) => `${I} 하면서 ${K} 이 고민 가진 분들 전부 다 여기로`,
  (I, K) => `지금 당장 ${I}에서 ${K} 해결하는 방법, 바로 알려드릴게요`,
  (I, K) => `바로 써먹을 수 있는 ${I} ${K} 핵심 정리`,
  (I, K) => `오늘부터 ${I} ${K} 바꾸는 단 한 가지 행동`,
  (I, K) => `${I} ${K} 이 영상 하나로 끝냅니다`,
  (I, K) => `핵심만 딱 알려드릴게요 — ${I} ${K}`,
  (I, K) => `${I} ${K} 딱 3가지만 기억하면 됩니다`,
  (I, K) => `${I}에서 ${reul(K)} 했더니 벌어진 일`,
  (I, K) => `${I} ${K} 시작하고 3개월 만에 달라진 것들`,
  (I, K) => `${K} 때문에 ${I} 포기하려다가 이걸 알게 됐어요`,
  (I, K) => `${I}에서 ${K}로 실패한 이야기, 솔직하게 말씀드릴게요`,
  (I, K) => `처음엔 저도 ${I} ${K} 몰랐어요. 그래서 이렇게 했습니다`,
  (I, K) => `${I} ${K}, 이것 하나만 기억하세요`,
  (I, K) => `${I}에서 ${K} 성공하려면 이것만 합니다`,
  (I, K) => `${I} ${K} 정답, 바로 보여드릴게요`,
  (I, K) => `${I} ${K} 핵심만 10초 만에 알려드립니다`,
  (I, K) => `${I}에서 ${K} 찾은 정답 공개합니다`,
  (I, K) => `${K} 성공하는 ${I} vs 실패하는 ${I}, 차이가 뭘까요?`,
  (I, K) => `${I} 잘되는 사람 vs 안 되는 사람 — ${K} 차이입니다`,
  (I, K) => `${reul(K)} 아는 ${I} 사장님 vs 모르는 사장님`,
  (I, K) => `${I} 처음 시작할 때 vs 6개월 후 — ${K}의 변화`,
  (I, K) => `${K} 전 vs 후 — ${I}에서 달라지는 것들`,
  (I, K) => `${I} 업계가 이 ${K} 방법을 싫어하는 이유`,
  (I, K) => `${I}에서 ${K} 잘하는 사람들이 입 다무는 이유`,
  (I, K) => `${K} 잘하는 ${I} 사장님들이 절대 공개 안 하는 비법`,
  (I, K) => `${K} 고민하는 ${I} 고객님들이 가장 많이 하는 실수 3가지`,
  (I, K) => `${I}에서 ${reul(K)} 해결 못하는 사람들의 공통점`,
  (I, K) => `${I} 다녀도 ${ga(K)} 안 해결되는 진짜 이유`,
  (I, K) => `${I} 고객 10명 중 8명이 ${K}에 대해 오해하는 것`,
  (I, K) => `${I} 사장님들이 ${K} 때문에 가장 많이 후회하는 결정`,
  (I, K) => `${I} 고객이 말 안 해주는 ${K}에 대한 속사정`,
  (I, K) => `${I} 사장님들이 절대 말 안 해주는 ${K} 비밀`,
  (I, K) => `업계 관계자가 공개하는 ${I} ${K} 진실`,
  (I, K) => `${I}에서 ${K}에 대해 아무도 안 알려주는 이유`,
  (I, K) => `${I}에서 ${K}로 성공하는 사람들만 아는 비밀`,
];

const FORMULAS = [
  { icon: '🚨', title: '패턴 인터럽트', desc: '예상을 깨는 문장으로 뇌의 자동 스크롤을 강제 중단시킨다.' },
  { icon: '💸', title: '손실회피 후킹', desc: '모르면 손해, 잘못하면 망한다. 인간은 이익보다 손실에 2배 반응한다.' },
  { icon: '🤔', title: '호기심 폭발 후킹', desc: '정보 격차를 만든다. 알고 싶지만 모른다는 느낌이 클릭을 부른다.' },
  { icon: '🔢', title: '구체성·수치 후킹', desc: '3가지, 5단계, 단 1분 — 수치가 신뢰도와 집중도를 높인다.' },
  { icon: '🪞', title: '정체성 호출', desc: '자아상을 건드려 "나를 부르는 글"이라 느끼게 만든다.' },
  { icon: '👥', title: '사회적 증거', desc: '다른 사람들도 하고 있다는 동조 본능을 자극한다.' },
  { icon: '😰', title: '문제공감 후킹', desc: '고객이 겪는 실제 불편을 먼저 꺼낸다. "왜 살이 안 빠질까요?"' },
  { icon: '💡', title: '상식 비틀기 후킹', desc: '다들 좋다는 것의 역습. "운동이 오히려 건강을 망친다"' },
  { icon: '🔥', title: '욕망 자극 후킹', desc: '예뻐지고 싶다, 돈 벌고 싶다, 인정받고 싶다. 근본 욕구를 건드린다.' },
  { icon: '🏆', title: '권위부여 후킹', desc: '경력, 실적, 고객 수 등 신뢰를 자연스럽게 심어준다.' },
  { icon: '🔓', title: '오픈루프 후킹', desc: '미완결 정보로 뇌가 해소하려 계속 신경 쓰게 만든다.' },
  { icon: '⚡', title: '즉시성 후킹', desc: '"지금 당장", "바로 써먹을 수 있는" — 행동 유도 최강 패턴.' },
  { icon: '🤫', title: '비밀·은밀함 후킹', desc: '"전문가만 아는 진실", "고객이 말 안 해주는 속사정"' },
  { icon: '⚖️', title: '비교 자극 후킹', desc: 'A vs B. 인간의 뇌는 비교에 강하게 반응한다.' },
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateFallback(I, K) {
  return shuffle(HOOKS).slice(0, 15).map((fn) => fn(I, K));
}

function HookRow({ num, text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    clipCopy(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className={styles.hookItem}>
      <span className={styles.hookNum}>{num}</span>
      <span className={styles.hookText}>{text}</span>
      <button
        type="button"
        className={`${styles.copyBtn} ${copied ? styles.copyBtnCopied : ''}`}
        onClick={handleCopy}
      >
        {copied ? '복사됨' : '복사'}
      </button>
    </div>
  );
}

export default function HookGenerator() {
  const [industry, setIndustry] = useState('');
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState(null);
  const [resultsTitle, setResultsTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const resultsRef = useRef(null);

  useEffect(() => {
    fetch('/api/hooks')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.remaining === 'number') setRemaining(data.remaining);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (results && resultsRef.current) {
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [results]);

  async function generate() {
    setError('');
    const I = industry.trim();
    const K = keyword.trim();
    if (!I) { setError('업종을 입력해주세요.'); return; }
    if (!K) { setError('키워드 / 주제를 입력해주세요.'); return; }

    setLoading(true);
    const fallback = generateFallback(I, K);

    try {
      const resp = await fetch('/api/hooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry: I, keyword: K }),
      });
      if (resp.status === 429) {
        const errData = await resp.json().catch(() => ({}));
        setError(errData.error || '오늘 무료 사용 횟수를 모두 소진했습니다. 내일 다시 이용해주세요.');
        setRemaining(0);
        setResults(fallback);
      } else if (resp.ok) {
        const data = await resp.json();
        if (typeof data.remaining === 'number') setRemaining(data.remaining);
        if (data.fallback || !Array.isArray(data.results) || data.results.length === 0) {
          setResults(fallback);
        } else {
          setResults(data.results);
        }
      } else {
        setResults(fallback);
      }
    } catch (e) {
      setResults(fallback);
    } finally {
      setLoading(false);
      setResultsTitle(`${I} x ${K} 후킹문구 15개`);
    }
  }

  function copyAll() {
    if (!results) return;
    const all = results.map((text, i) => `${i + 1}. ${text}`).join('\n');
    clipCopy(all).then(() => {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    });
  }

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <div className={styles.heroBadge}>🔥 SNS 후킹문구 생성기</div>
        <h1>첫 줄이 전부입니다<br /><span>스크롤 멈추는 문구</span>를 뚝딱</h1>
        <p>업종과 키워드를 입력하면<br />심리학 기반 후킹문구 15개를 즉시 생성합니다</p>
        <div className={styles.badgeRow}>
          <span className={styles.badge}>🧠 심리학 기반</span>
          <span className={styles.badge}>⚡ 즉시 생성</span>
          <span className={styles.badge}>📋 복사 기능</span>
          <span className={styles.badge}>✅ 완전 무료</span>
        </div>
      </header>

      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.inputGroup}>
            <label className={styles.inputLabel}>
              업종 <span className={styles.required}>필수</span>
            </label>
            <span className={styles.inputSub}>직접 입력하거나 예시를 클릭하세요 — 어떤 업종이든 OK</span>
            <input
              type="text"
              className={styles.inputField}
              placeholder="예) 미용실, 꽃집, 온라인 쇼핑몰..."
              maxLength={30}
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') generate(); }}
            />
            <div className={styles.tagRow}>
              {INDUSTRY_TAGS.map((tag) => (
                <span key={tag} className={styles.tag} onClick={() => setIndustry(tag)}>
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.inputLabel}>
              키워드 / 주제 <span className={styles.required}>필수</span>
            </label>
            <span className={styles.inputSub}>홍보하고 싶은 내용을 자유롭게 입력하세요</span>
            <input
              type="text"
              className={styles.inputField}
              placeholder="예) 탈모, 다이어트, 신규 고객..."
              maxLength={30}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') generate(); }}
            />
            <div className={styles.tagRow}>
              {KEYWORD_TAGS.map((tag) => (
                <span key={tag} className={styles.tag} onClick={() => setKeyword(tag)}>
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {error && <div className={styles.errorBox}>{error}</div>}

          <button
            type="button"
            className={styles.generateBtn}
            onClick={generate}
            disabled={loading}
          >
            {loading ? '🔄 AI가 후킹문구를 생성하고 있습니다...' : '🔥 스크롤 멈추는 후킹문구 15개 생성하기'}
          </button>

          {remaining !== null && (
            <div className={styles.remaining}>
              오늘 남은 AI 생성 횟수: <strong>{remaining}</strong>회
            </div>
          )}
        </div>

        {results && (
          <div ref={resultsRef} className={styles.card}>
            <div className={styles.resultsHeader}>
              <span className={styles.resultsTitle}>{resultsTitle || '후킹문구 15개'}</span>
              <button type="button" className={styles.copyAllBtn} onClick={copyAll}>
                {copiedAll ? '전체 복사 완료!' : '📋 전체 복사'}
              </button>
            </div>
            <div>
              {results.map((text, i) => (
                <HookRow key={i} num={i + 1} text={text} />
              ))}
            </div>
          </div>
        )}

        <div className={styles.infoSection}>
          <div className={styles.card}>
            <h2>📌 후킹문구, 왜 첫 줄이 전부일까요?</h2>
            <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.9, marginBottom: 16 }}>
              사람들이 SNS 피드를 스크롤하는 속도는 평균 <strong>0.3초</strong>입니다. 이 0.3초 안에 멈추지 않으면, 아무리 좋은 서비스도 보여줄 기회조차 없습니다. 후킹문구는 단순한 제목이 아니라 <strong>상대방의 심리를 건드리는 첫 번째 신호</strong>입니다.
            </p>
            <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.9 }}>
              19년간 3,500쌍 이상의 웨딩 상담을 하면서 알게 된 사실이 있어요. 고객은 서비스를 사는 게 아니라 <strong>자신의 문제가 해결되는 장면</strong>을 삽니다. 후킹문구는 그 장면을 보여주는 창문입니다.
            </p>
          </div>

          <div className={styles.card}>
            <h2>🧠 이 도구가 사용하는 14가지 심리 후킹 공식</h2>
            <div className={styles.hookGrid}>
              {FORMULAS.map((f) => (
                <div key={f.title} className={styles.hookCard}>
                  <div className={styles.hookCardIcon}>{f.icon}</div>
                  <div className={styles.hookCardTitle}>{f.title}</div>
                  <div className={styles.hookCardDesc}>{f.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.card}>
            <h2>💬 자주 묻는 질문</h2>
            <details className={styles.faqItem}>
              <summary>생성된 문구를 그대로 써도 되나요?</summary>
              <p>네, 그대로 쓰셔도 됩니다. 다만 실제 사례나 구체적인 숫자를 추가하면 더 효과적입니다. 예를 들어 &quot;10명 중 9명이 모르는 탈모 관리법&quot; 뒤에 본인 샵 이야기를 붙여주시면 좋아요.</p>
            </details>
            <details className={styles.faqItem}>
              <summary>어디에 활용할 수 있나요?</summary>
              <p>인스타그램 릴스·카드뉴스 첫 줄, 네이버 블로그 제목, 유튜브 쇼츠 자막, 스레드·페이스북 포스팅 첫 문장, 카카오톡 채널 메시지, 전단지 헤드라인 등 모든 SNS와 마케팅 채널에 활용하실 수 있습니다.</p>
            </details>
            <details className={styles.faqItem}>
              <summary>같은 업종·키워드를 다시 누르면 다른 문구가 나오나요?</summary>
              <p>네, 매번 다른 조합의 후킹문구가 생성됩니다. 여러 번 눌러서 마음에 드는 문구를 골라 사용하세요.</p>
            </details>
            <details className={styles.faqItem} style={{ borderBottom: 'none' }}>
              <summary>무료인가요?</summary>
              <p>네, 완전 무료입니다. 회원가입 없이 바로 사용하실 수 있습니다.</p>
            </details>
          </div>
        </div>
      </div>

      <div className={styles.toolsSection}>
        <div className={styles.toolsLabel}>🛠 뚝딱툴 도구 모음</div>
        <div className={styles.toolsGrid}>
          <a href="/" className={styles.toolCard}>
            <div className={styles.toolCardTag}>바로가기 →</div>
            <div className={styles.toolCardName}>📝 블로그 제목 생성기</div>
            <div className={styles.toolCardDesc}>키워드 입력 → 클릭을 부르는 제목 12패턴</div>
          </a>
          <div className={styles.toolCardCurrent}>
            <div className={`${styles.toolCardTag} ${styles.toolCardTagCurrent}`}>현재 페이지</div>
            <div className={styles.toolCardName}>🔥 후킹문구 생성기</div>
            <div className={styles.toolCardDesc}>업종 + 키워드 → 스크롤 멈추는 문구 15개</div>
          </div>
          <a href="/threads" className={styles.toolCard}>
            <div className={`${styles.toolCardTag} ${styles.toolCardTagNew}`}>NEW ✦</div>
            <div className={styles.toolCardName}>🧵 스레드 글 생성기</div>
            <div className={styles.toolCardDesc}>유형·말투 선택 → 터지는 스레드 글 3개</div>
          </a>
        </div>
      </div>
    </main>
  );
}
