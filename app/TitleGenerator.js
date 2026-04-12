'use client';

import { useEffect, useRef, useState } from 'react';
import { clipCopy } from '@/lib/utils';
import styles from './page.module.css';

const hints = {
  wedding: { label: '웨딩/결혼', tags: ['웨딩홀 비용', '스드메 가격', '웨딩드레스', '결혼 준비 순서', '웨딩 촬영', '신혼여행 추천'] },
  food: { label: '요식업/카페', tags: ['카페 창업 비용', '식당 개업', '메뉴 개발', '카페 인테리어', '식당 마케팅', '배달 매출'] },
  edu: { label: '온라인 강의/교육', tags: ['온라인 강의 만들기', '클래스 판매', '지식창업', '전자책 출판', '코칭 프로그램', '수강생 모집'] },
  beauty: { label: '뷰티/피부/헤어', tags: ['피부 관리', '헤어 스타일', '네일아트', '다이어트 방법', '피부 트러블', '미용실 추천'] },
  realty: { label: '부동산/인테리어', tags: ['아파트 청약', '전세 계약', '인테리어 비용', '셀프 인테리어', '부동산 투자', '이사 준비'] },
  fitness: { label: '헬스/운동', tags: ['다이어트 식단', '홈트 방법', '헬스장 추천', '살 빠지는 운동', '체중 감량', '단백질 식품'] },
  marketing: { label: '마케팅/블로그', tags: ['블로그 상위 노출', '네이버 SEO', 'SNS 마케팅', '인스타 팔로워', '광고비 없는 마케팅', '블로그 수익화'] },
  other: { label: '기타', tags: ['키워드를 직접 입력해보세요'] },
};

const categoryLabels = {
  wedding: '웨딩/결혼',
  food: '요식업/카페',
  edu: '온라인 강의/교육',
  beauty: '뷰티/피부/헤어',
  realty: '부동산/인테리어',
  fitness: '헬스/운동',
  marketing: '마케팅/블로그',
  other: '기타',
};

const templates = {
  p1: [
    (kw) => `${kw} 시작 전 꼭 알아야 할 3가지, 이것만 알면 됩니다`,
    (kw) => `따라만 해도 달라지는 ${kw} 핵심 정리`,
  ],
  p2: [
    (kw) => `${kw} 2개월 만에 매출 2배 올린 사장님의 공통점`,
    (kw) => `${kw} 해봤더니 생각보다 쉬웠습니다 — 실제 후기`,
  ],
  p3: [
    (kw) => `19년 경력 전문가가 말하는 ${kw} 준비 방법`,
    (kw) => `전문가들이 ${kw}에서 가장 먼저 확인하는 것`,
  ],
  p4: [
    (kw) => `${kw} 전 꼭 확인해야 할 주의사항 3가지 체크리스트`,
    (kw) => `${kw}, 3분 안에 핵심만 이해시켜드리겠습니다`,
  ],
  p5: [
    (kw) => `설마 아직도 ${kw} 모르고 계세요? 이것 놓치면 손해입니다`,
    (kw) => `${kw} 모르면 결국 이렇게 됩니다 — 충격 실제 사례`,
  ],
  p6: [
    (kw) => `${kw}에서 돈 날리는 사람들의 3가지 공통점`,
    (kw) => `${kw} 실패하는 분들이 반드시 놓치는 것`,
  ],
  p7: [
    (kw) => `${kw}에 이것이 있다면 당장 의심해봐야 합니다`,
    (kw) => `${kw}를 시작하기 전에 반드시 읽어보세요`,
  ],
  p8: [
    (kw) => `${kw}로 내 돈이 새고 있다는 사실 알고 계셨나요?`,
    (kw) => `아직도 ${kw}에서 이렇게 하고 있다면 큰일 납니다`,
  ],
  p9: [
    (kw) => `누적 3,500명이 선택한 ${kw}의 비밀은 무엇일까요?`,
    (kw) => `왜 멀리서까지 ${kw}를 찾아오는 걸까요?`,
  ],
  p10: [
    (kw) => `${kw}는 하면 안 된다고요? 사실은 정반대입니다`,
    (kw) => `당연하다고 생각했던 ${kw}의 불편한 진실`,
  ],
  p11: [
    (kw) => `${kw} vs 기존 방법, 뭐가 다를까요? 비교해봤습니다`,
    (kw) => `왜 어떤 분들은 ${kw}로 바로 성과를 내는 걸까요?`,
  ],
  p12: [
    (kw) => `${kw}로 고민하고 계신 분만 보세요`,
    (kw) => `${kw} 때문에 답답하셨던 분들에게만 알려드립니다`,
  ],
};

const PATTERN_KEYS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12'];

function generateFallback(kw) {
  const out = {};
  for (const pid of PATTERN_KEYS) {
    out[pid] = templates[pid].map((fn) => fn(kw));
  }
  return out;
}

function mergeResults(fallback, apiResults) {
  const merged = { ...fallback };
  if (apiResults && typeof apiResults === 'object') {
    for (const pid of PATTERN_KEYS) {
      if (Array.isArray(apiResults[pid]) && apiResults[pid].length > 0) {
        merged[pid] = apiResults[pid];
      }
    }
  }
  return merged;
}

function TitleRow({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    clipCopy(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className={styles.titleItem}>
      <span className={styles.titleText}>{text}</span>
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

function PatternGroup({ label, tone, titles }) {
  return (
    <div className={styles.patternGroup}>
      <div className={`${styles.patternLabel} ${styles['patternLabel' + tone]}`}>{label}</div>
      <div>{titles.map((t, i) => <TitleRow key={i} text={t} />)}</div>
    </div>
  );
}

export default function TitleGenerator() {
  const [category, setCategory] = useState('');
  const [keyword, setKeyword] = useState('');
  const [titles, setTitles] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const resultsRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/titles')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.remaining === 'number') {
          setRemaining(data.remaining);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (titles && resultsRef.current) {
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [titles]);

  async function generate() {
    setError('');
    const kw = keyword.trim();
    if (!kw) { setError('키워드를 입력해주세요.'); return; }

    const categoryLabel = categoryLabels[category] || '';
    setLoading(true);

    const fallback = generateFallback(kw);

    try {
      const resp = await fetch('/api/titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw, category: categoryLabel }),
      });

      if (resp.status === 429) {
        const errData = await resp.json().catch(() => ({}));
        setError(errData.error || '오늘 무료 사용 횟수를 모두 소진했습니다. 내일 다시 이용해주세요.');
        setRemaining(0);
        setTitles(fallback);
      } else if (resp.ok) {
        const data = await resp.json();
        if (typeof data.remaining === 'number') setRemaining(data.remaining);
        if (data.fallback || !data.results || Object.keys(data.results).length === 0) {
          setTitles(fallback);
        } else {
          setTitles(mergeResults(fallback, data.results));
        }
      } else {
        console.error('API error, using fallback');
        setTitles(fallback);
      }
    } catch (e) {
      console.error('Fetch error, using fallback:', e);
      setTitles(fallback);
    } finally {
      setLoading(false);
    }
  }

  function copyAll() {
    if (!titles) return;
    const all = PATTERN_KEYS.flatMap((pid) => titles[pid] || []).join('\n');
    clipCopy(all).then(() => {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    });
  }

  const hintData = hints[category];

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <h1><span>뚝딱툴</span> — 블로거를 위한 AI 도구 모음</h1>
        <p className={styles.heroSub}>
          업종과 키워드만 입력하면<br />
          클릭을 부르는 제목 12패턴을 자동 생성합니다.<br />
          제목부터 글, 이미지, 카드뉴스까지 한곳에서.
        </p>
        <div className={styles.badgeRow}>
          <span className={`${styles.badge} ${styles.badgeG}`}>긍정 메시지</span>
          <span className={`${styles.badge} ${styles.badgeR}`}>위협 메시지</span>
          <span className={`${styles.badge} ${styles.badgeB}`}>호기심 메시지</span>
        </div>
      </header>

      <div className={styles.container}>
        <div className={styles.inputSection}>
          <h2>업종과 키워드를 입력하세요</h2>
          <div className={styles.formRow}>
            <div>
              <label htmlFor="category-select">업종 선택</label>
              <select
                id="category-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">— 업종을 선택하세요 —</option>
                <option value="wedding">웨딩/결혼</option>
                <option value="food">요식업/카페</option>
                <option value="edu">온라인 강의/교육</option>
                <option value="beauty">뷰티/피부/헤어</option>
                <option value="realty">부동산/인테리어</option>
                <option value="fitness">헬스/운동</option>
                <option value="marketing">마케팅/블로그</option>
                <option value="other">기타</option>
              </select>
            </div>
            <div>
              <label htmlFor="keyword-input">핵심 키워드</label>
              <input
                id="keyword-input"
                type="text"
                placeholder="예: 웨딩홀 비용, 식당 창업"
                maxLength={30}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') generate(); }}
              />
            </div>
          </div>

          {hintData && (
            <div className={styles.keywordHint}>
              <strong>추천 키워드</strong>
              <div className={styles.hintTags}>
                {hintData.tags.map((tag) => (
                  <span
                    key={tag}
                    className={styles.hintTag}
                    onClick={() => setKeyword(tag)}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {error && <div className={styles.errorBox}>{error}</div>}

          <button
            type="button"
            className={styles.generateBtn}
            onClick={generate}
            disabled={loading}
          >
            {loading ? 'AI가 제목을 생성하고 있습니다...' : '제목 12패턴 생성하기'}
          </button>
          {remaining !== null && (
            <div className={styles.remainingInfo}>
              오늘 남은 AI 생성 횟수: <strong>{remaining}</strong>회
            </div>
          )}
        </div>

        {titles && (
          <div ref={resultsRef} className={styles.results}>
            <div className={styles.copyAllRow}>
              <button type="button" className={styles.copyAllBtn} onClick={copyAll}>
                {copiedAll ? '전체 복사 완료!' : '전체 제목 복사'}
              </button>
            </div>

            <div className={styles.chapter}>
              <div className={`${styles.chapterHeader} ${styles.chapterHeaderPositive}`}>
                <div className={styles.chapterInfo}>
                  <div className={styles.chapterTitle}>긍정 메시지</div>
                  <div className={styles.chapterDesc}>고객이 얻을 수 있는 이득을 보여주는 제목</div>
                </div>
              </div>
              <div className={styles.chapterBody}>
                <PatternGroup label="패턴 1 — 이득 + 숫자형" tone="Positive" titles={titles.p1} />
                <PatternGroup label="패턴 2 — 성공 사례형" tone="Positive" titles={titles.p2} />
                <PatternGroup label="패턴 3 — 전문가 가이드형" tone="Positive" titles={titles.p3} />
                <PatternGroup label="패턴 4 — 방법 + 체크리스트형" tone="Positive" titles={titles.p4} />
              </div>
            </div>

            <div className={styles.chapter}>
              <div className={`${styles.chapterHeader} ${styles.chapterHeaderThreat}`}>
                <div className={styles.chapterInfo}>
                  <div className={styles.chapterTitle}>위협 메시지</div>
                  <div className={styles.chapterDesc}>무언가를 잃을 위기에 처했을 때 지갑이 열린다</div>
                </div>
              </div>
              <div className={styles.chapterBody}>
                <PatternGroup label="패턴 5 — 모르면 손해형" tone="Threat" titles={titles.p5} />
                <PatternGroup label="패턴 6 — 공통점 경고형" tone="Threat" titles={titles.p6} />
                <PatternGroup label="패턴 7 — 의심하라형" tone="Threat" titles={titles.p7} />
                <PatternGroup label="패턴 8 — 공동의 적형" tone="Threat" titles={titles.p8} />
              </div>
            </div>

            <div className={styles.chapter}>
              <div className={`${styles.chapterHeader} ${styles.chapterHeaderCuriosity}`}>
                <div className={styles.chapterInfo}>
                  <div className={styles.chapterTitle}>호기심 메시지</div>
                  <div className={styles.chapterDesc}>예측 불가능이 클릭을 만든다</div>
                </div>
              </div>
              <div className={styles.chapterBody}>
                <PatternGroup label="패턴 9 — 가치 입증형" tone="Curiosity" titles={titles.p9} />
                <PatternGroup label="패턴 10 — 상식 파괴형" tone="Curiosity" titles={titles.p10} />
                <PatternGroup label="패턴 11 — 질문 & 비교형" tone="Curiosity" titles={titles.p11} />
                <PatternGroup label="패턴 12 — 타깃 호출형" tone="Curiosity" titles={titles.p12} />
              </div>
            </div>

            <div className={styles.tips}>
              <h3>제목 쓸 때 꼭 기억하세요</h3>
              {[
                '핵심 키워드는 제목 맨 왼쪽에 배치하세요. 네이버는 앞쪽 단어에 더 높은 가중치를 줍니다.',
                '롱테일 키워드가 오히려 강합니다. "웨딩홀"보다 "강남 웨딩홀 비용 실제 후기"처럼 2~3단어 조합이 경쟁이 낮고 상위 노출이 쉽습니다.',
                '숫자는 구체적일수록 좋습니다. \'몇 가지\'보다 \'3가지\', \'2주\'보다 \'14일\'이 클릭율이 높습니다.',
                '모바일 제목은 28~32자에서 잘립니다. 핵심 내용을 반드시 앞쪽에 배치하세요.',
                '"2026년 기준"처럼 연도를 넣으면 최신 정보라는 신뢰감과 검색 정확도가 동시에 올라갑니다.',
                'AI 검색(큐:) 대응 — "~하는 방법"보다 "왜 ~할까요?" 같은 질문형 제목이 네이버 AI 답변 소스로 채택될 확률이 높습니다.',
                '"업계 사람만 아는", "아직 모르는 분이 많은" 같은 표현은 나만의 정보라는 느낌을 줘서 클릭 욕구를 자극합니다.',
                '과도한 키워드 도배는 저품질 위험이 있습니다. 제목과 관련 없는 키워드는 오히려 이탈율을 높입니다.',
                '2025년부터 네이버 홈피드는 블로그 지수보다 반응을 봅니다. 체류시간과 재방문율이 높은 글이 알고리즘의 선택을 받습니다.',
                '작성 전 1분 만에 상위 노출 글을 검색해보세요. 그들과 차별화할 포인트를 찾는 것이 핵심입니다.',
              ].map((text, i) => (
                <div key={i} className={styles.tipItem}>
                  <span className={styles.tipNum}>{i + 1}</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={styles.contentSection}>
        <section>
          <h2>네이버 블로그 제목, 왜 중요할까요?</h2>
          <p>
            네이버 블로그는 글의 내용이 아무리 좋아도 <strong>제목에서 클릭을 받지 못하면 아무도 읽지 않습니다.</strong>
            검색 결과에서 독자가 가장 먼저 보는 것이 제목이고, 클릭 여부는 평균 0.3초 안에 결정됩니다.
            특히 네이버 홈피드(모바일 메인)는 2024년부터 <strong>체류시간과 클릭률(CTR)을 핵심 지표</strong>로 삼고 있어,
            첫 클릭을 유도하는 제목이 곧 알고리즘 상위 노출의 시작점이 됩니다.
          </p>
          <p>
            19년간 3,500쌍 이상의 웨딩 상담을 진행하며 <strong>&quot;같은 내용도 표현 방식에 따라 문의율이 3배 이상 차이 난다&quot;</strong>는 것을 직접 경험했습니다.
            이 생성기는 그 경험을 바탕으로 만든 12가지 제목 패턴을 자동으로 적용해 드립니다.
          </p>
        </section>

        <section>
          <h2>클릭을 부르는 제목 문법 7가지</h2>
          <div className={styles.grammarList}>
            <div className={`${styles.grammarCard} ${styles.grammarCardGreen}`}>
              <strong>1. 숫자형</strong>
              <p>
                구체적인 숫자는 뇌가 본능적으로 신뢰합니다. &quot;몇 가지&quot;보다 &quot;3가지&quot;, &quot;몇 주&quot;보다 &quot;14일&quot;이 클릭율이 높습니다.<br />
                <span className={styles.exGreen}>예: 블로그 상위 노출 <strong>3가지</strong> 핵심 원칙</span>
              </p>
            </div>
            <div className={`${styles.grammarCard} ${styles.grammarCardGreen}`}>
              <strong>2. 실화/후기형</strong>
              <p>
                제3자의 경험담은 가장 강력한 신뢰 장치입니다. &quot;실제 후기&quot;, &quot;직접 써봤더니&quot; 같은 표현을 활용하세요.<br />
                <span className={styles.exGreen}>예: 광고 없이 <strong>매출 2배</strong> 올린 사장님의 비밀</span>
              </p>
            </div>
            <div className={`${styles.grammarCard} ${styles.grammarCardRed}`}>
              <strong>3. 손실 회피형</strong>
              <p>
                심리학에서 손실에 대한 공포는 이득에 대한 기대보다 2.5배 강합니다. &quot;모르면 손해&quot;, &quot;이렇게 하면 망한다&quot; 같은 표현이 클릭을 유도합니다.<br />
                <span className={styles.exRed}>예: <strong>아직도 이렇게 하고 계세요?</strong> 블로그 망하는 지름길</span>
              </p>
            </div>
            <div className={`${styles.grammarCard} ${styles.grammarCardRed}`}>
              <strong>4. 전문가 권위형</strong>
              <p>
                &quot;19년 경력&quot;, &quot;전문가가 말하는&quot;, &quot;업계 사람만 아는&quot; 같은 표현은 정보의 신뢰도를 높여 클릭을 유도합니다.<br />
                <span className={styles.exRed}>예: <strong>10년차 블로거</strong>가 절대 안 알려주는 제목 짜는 법</span>
              </p>
            </div>
            <div className={`${styles.grammarCard} ${styles.grammarCardBlue}`}>
              <strong>5. 상식 파괴형</strong>
              <p>
                사람들이 알고 있던 것을 뒤집는 정보는 강한 호기심을 유발합니다. &quot;사실은 반대입니다&quot;, &quot;오해하고 있습니다&quot; 패턴이 효과적입니다.<br />
                <span className={styles.exBlue}>예: 블로그 매일 올려야 한다고요? <strong>사실은 정반대입니다</strong></span>
              </p>
            </div>
            <div className={`${styles.grammarCard} ${styles.grammarCardBlue}`}>
              <strong>6. 타깃 호출형</strong>
              <p>
                &quot;자영업자만&quot;, &quot;초보 블로거라면&quot;, &quot;30대 사장님&quot; 같이 특정 독자를 직접 부르는 제목은 해당 독자의 클릭 확률을 크게 높입니다.<br />
                <span className={styles.exBlue}>예: <strong>자영업자 블로거</strong>라면 이것만 알면 됩니다</span>
              </p>
            </div>
            <div className={`${styles.grammarCard} ${styles.grammarCardPurple}`}>
              <strong>7. 연도/최신 정보형</strong>
              <p>
                &quot;2026년 기준&quot;, &quot;최신 알고리즘 변경 반영&quot; 같은 표현은 최신 정보라는 신뢰감과 함께 검색 정확도도 함께 올라갑니다.<br />
                <span className={styles.exPurple}>예: <strong>2026년 기준</strong> 네이버 홈피드 노출 공략법</span>
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2>자주 묻는 질문</h2>
          <div className={styles.faqList}>
            <details className={styles.faqItem}>
              <summary>Q. 생성된 제목을 그대로 써도 되나요?</summary>
              <p>
                생성된 제목은 <strong>참고용 뼈대</strong>로 활용하시는 것을 권장드립니다. 내용과 실제 연관성 있게 약간 수정해서 사용하시면 더 좋습니다.
                예를 들어 &quot;2개월 만에 매출 2배&quot;라는 표현은 실제 내용에서 뒷받침이 되어야 독자의 신뢰를 얻을 수 있습니다.
              </p>
            </details>
            <details className={styles.faqItem}>
              <summary>Q. 어떤 키워드를 입력해야 가장 좋은 결과가 나오나요?</summary>
              <p>
                <strong>2~4 단어 조합의 롱테일 키워드</strong>가 가장 효과적입니다. &quot;블로그&quot;보다는 &quot;자영업자 블로그 마케팅&quot;, &quot;다이어트&quot;보다는 &quot;직장인 점심 다이어트&quot; 처럼 구체적으로 입력할수록
                경쟁이 낮고 실제 검색 의도에 맞는 제목이 생성됩니다.
              </p>
            </details>
            <details className={styles.faqItem}>
              <summary>Q. 네이버 블로그 제목 글자 수 제한이 있나요?</summary>
              <p>
                네이버는 최대 <strong>64바이트(한글 약 32자)</strong>까지 제목으로 설정할 수 있습니다.
                모바일 검색 결과에서는 약 <strong>28~32자에서 제목이 잘려 보이기</strong> 때문에, 핵심 키워드와 임팩트 있는 표현을 반드시 앞쪽에 배치하세요.
              </p>
            </details>
            <details className={styles.faqItem}>
              <summary>Q. 제목에 키워드를 여러 개 넣어도 되나요?</summary>
              <p>
                키워드를 <strong>억지로 여러 개 넣는 것은 오히려 역효과</strong>입니다. 네이버 알고리즘은 2023년 이후 키워드 도배를 저품질로 판단합니다.
                핵심 키워드 1~2개만 자연스럽게 제목에 녹이고, 나머지는 본문에서 자연스럽게 활용하세요.
              </p>
            </details>
            <details className={styles.faqItem}>
              <summary>Q. 이 도구는 무료인가요?</summary>
              <p>
                네, 제목 생성기는 <strong>무료</strong>로 사용하실 수 있습니다. 회원가입 후 키워드만 입력하면 즉시 사용 가능합니다.
                블로그 글 작성, 이미지 생성 등 PRO 도구도 가입 시 무료 체험 횟수가 제공됩니다.
              </p>
            </details>
          </div>
        </section>

        <section>
          <h2>이 도구에 대해</h2>
          <p>
            뚝딱툴의 네이버 블로그 제목 생성기는 <strong>광고비 없이 연 매출 13억을 만든 웨딩 컨설턴트</strong>가 실제 비즈니스 현장에서 검증한 클릭 문법을 바탕으로 만들었습니다.
            광고비를 한 푼도 쓰지 않고 연 매출 13억 원까지 성장시킨 유기적 마케팅 노하우를 누구나 쉽게 활용할 수 있도록 도구로 구현했습니다.
          </p>
          <p>
            AI를 쓸 줄 몰라도, 마케팅을 잘 몰라도, <strong>키워드 하나만 입력하면 12가지 검증된 패턴</strong>의 제목을 즉시 받아보실 수 있습니다.
            자영업자, 소상공인, 블로그를 막 시작한 분들 모두를 위해 만들었습니다.
          </p>
        </section>
      </div>

      <div className={styles.toolsSection}>
        <div className={`${styles.toolsLabel} ${styles.toolsLabelFree}`}>무료 도구</div>
        <div className={`${styles.toolsGrid} ${styles.toolsGrid3} ${styles.mb28}`}>
          <div className={styles.toolCardCurrent}>
            <div className={`${styles.toolCardTag} ${styles.tagOrange}`}>현재 페이지</div>
            <div className={styles.toolCardName}>블로그 제목 생성기</div>
            <div className={styles.toolCardDesc}>키워드 입력 — 클릭을 부르는 제목 12패턴</div>
          </div>
          <a href="/hook-generator" className={styles.toolCard}>
            <div className={`${styles.toolCardTag} ${styles.tagGray}`}>바로가기</div>
            <div className={styles.toolCardName}>후킹문구 생성기</div>
            <div className={styles.toolCardDesc}>업종 + 키워드 — 스크롤 멈추는 문구 15개</div>
          </a>
          <a href="/threads" className={styles.toolCard}>
            <div className={`${styles.toolCardTag} ${styles.tagGray}`}>바로가기</div>
            <div className={styles.toolCardName}>스레드 글 생성기</div>
            <div className={styles.toolCardDesc}>유형 + 말투 선택 — 터지는 스레드 글 3개</div>
          </a>
        </div>

        <div className={`${styles.toolsLabel} ${styles.toolsLabelPro}`}>PRO 도구</div>
        <div className={`${styles.toolsGrid} ${styles.toolsGrid2}`}>
          <a href="/blog-writer" className={styles.toolCard}>
            <div className={`${styles.toolCardTag} ${styles.tagPro}`}>PRO</div>
            <div className={styles.toolCardName}>블로그 글 생성기</div>
            <div className={styles.toolCardDesc}>업종 + 키워드 — 상위노출 블로그 글 작성</div>
          </a>
          <a href="/blog-image-pro" className={styles.toolCard}>
            <div className={`${styles.toolCardTag} ${styles.tagPro}`}>PRO</div>
            <div className={styles.toolCardName}>프리미엄 이미지</div>
            <div className={styles.toolCardDesc}>AI 사진 + 인포그래픽 — 블로그 이미지 8장 생성</div>
          </a>
          <a href="/card-news" className={styles.toolCard}>
            <div className={`${styles.toolCardTag} ${styles.tagPro}`}>PRO</div>
            <div className={styles.toolCardName}>카드뉴스 생성기</div>
            <div className={styles.toolCardDesc}>텍스트 붙여넣기 — AI 카드뉴스 자동 생성</div>
          </a>
          <a href="/keyword-finder" className={styles.toolCard}>
            <div className={`${styles.toolCardTag} ${styles.tagOrange}`}>NEW</div>
            <div className={styles.toolCardName}>황금키워드 찾기</div>
            <div className={styles.toolCardDesc}>경쟁 낮은 블루오션 키워드 자동 발굴</div>
          </a>
        </div>
      </div>
    </main>
  );
}
