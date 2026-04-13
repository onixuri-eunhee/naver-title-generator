'use client';

import { useEffect, useRef, useState } from 'react';
import { clipCopy } from '@/lib/utils';
import { getToken } from '@/lib/auth';
import styles from '../threads/page.module.css';

const TYPES = [
  { id: '정보형', icon: '📊', desc: '유용한 팁·노하우 전달' },
  { id: '공감형', icon: '💬', desc: '공통 감정·경험 공유' },
  { id: '반전형', icon: '⚡', desc: '예상 뒤집는 의외의 진실' },
  { id: '고백형', icon: '🤍', desc: '솔직한 경험담·내면 이야기' },
];

const TONES = [
  { id: '친구체', icon: '😊', desc: '~했어, ~이야 (편한 반말)' },
  { id: '해요체', icon: '🌿', desc: '~해요, 따뜻하고 부드럽게' },
  { id: '단문체', icon: '⚡', desc: '짧고 건조. SNS 특유 리듬' },
  { id: '격식체', icon: '💼', desc: '~합니다, 전문가 느낌' },
];

const TYPE_GUIDE = {
  '정보형': '유용한 팁 전달. 첫 줄에 핵심 예고.',
  '공감형': '"나도 그래" 유도. 공통 감정 → 위로 마무리.',
  '반전형': '일반적 생각 → 예상 뒤집기 → 인사이트 1줄.',
  '고백형': '1인칭 솔직 경험담. 날 것의 문체.',
};

const TONE_GUIDE = {
  '친구체': '말투: ~했어, ~이야, ~거든 반말.',
  '해요체': '말투: ~해요, ~예요. 따뜻하고 부드럽게.',
  '단문체': '말투: 짧은 단문. 마침표 끊기. 감탄사 최소.',
  '격식체': '말투: ~합니다, ~입니다. 전문가 느낌.',
};

const RANDOM_DATA = [
  { industry: '카페', target: '동네 단골', topic: '단골 만드는 법', memo: '커피보다 사람이 오는 가게' },
  { industry: '프리랜서', target: '직장인 부업족', topic: '퇴근 후 부업 첫 달', memo: '처음엔 월 10만원도 기뻤음' },
  { industry: '온라인 쇼핑몰', target: '30대 여성', topic: '첫 매출 낸 날', memo: '아무도 안 살 것 같았는데' },
  { industry: '1인 강사', target: '초보 창업자', topic: '수강생 0명에서 50명', memo: '광고 한 번 안 씀' },
  { industry: '마케터', target: '소상공인', topic: '인스타 팔로워보다 중요한 것', memo: '팔로워 100명인데 매출 남' },
];

export default function ThreadsWriterClient() {
  const [selectedType, setSelectedType] = useState('정보형');
  const [selectedTone, setSelectedTone] = useState('친구체');
  const [industry, setIndustry] = useState('');
  const [target, setTarget] = useState('');
  const [topic, setTopic] = useState('');
  const [memo, setMemo] = useState('');
  const [results, setResults] = useState(['', '', '']);
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(null);
  const [limit, setLimit] = useState(null);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const resultRef = useRef(null);

  const text = results[activeTab] || '';
  const hasReply = text.includes('[답글]');
  const mainText = hasReply ? text.split('[답글]')[0].trim() : text;
  const replyText = hasReply ? (text.split('[답글]')[1] || '').trim() : '';
  const charCount = text ? text.replace('[답글]', '').length : 0;

  useEffect(() => {
    (async () => {
      try {
        const token = getToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch('/api/generate', { headers });
        const data = await res.json();
        if (typeof data.remaining === 'number') setRemaining(data.remaining);
        if (typeof data.limit === 'number') setLimit(data.limit);
        if (data.admin || data.remaining >= 999) setIsAdminMode(true);
      } catch (_) {}
    })();
  }, []);

  useEffect(() => {
    if (results.some(Boolean) && resultRef.current) {
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [results]);

  function fillRandom() {
    const d = RANDOM_DATA[Math.floor(Math.random() * RANDOM_DATA.length)];
    setIndustry(d.industry);
    setTarget(d.target);
    setTopic(d.topic);
    setMemo(d.memo);
  }

  async function generate() {
    if (!topic.trim()) { setError('주제/소재를 입력해주세요.'); return; }
    setError('');
    setLoading(true);

    const system = `Threads SNS 카피라이터. 규칙: ①80~130자 ②1문장 1줄+줄바꿈 리듬 ③첫 줄에서 2초 안에 멈추게 ④해시태그 없음 ⑤글만 출력`;
    const user = `유형: ${selectedType} (${TYPE_GUIDE[selectedType]})
${TONE_GUIDE[selectedTone]}
업종: ${industry || '무관'} / 타겟: ${target || '일반'}
소재: ${topic}
메모: ${memo || '없음'}

서로 다른 첫 줄과 구성으로 스레드 글 3개 작성. 각 글은 "---" 로만 구분.`;

    try {
      const token = getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });
      const data = await res.json();

      if (res.status === 429) {
        setError(data.error || '오늘 무료 사용 횟수를 모두 소진했습니다. 내일 다시 이용해주세요.');
        return;
      }
      if (data.error) {
        const msg = typeof data.error === 'string' ? data.error : (data.error && data.error.message) || '글 생성 중 문제가 발생했습니다.';
        throw new Error(msg);
      }

      const raw = (data.content?.[0]?.text || '').trim();
      const parsed = raw.split(/\n?---\n?/).map((s) => s.trim()).filter(Boolean);
      while (parsed.length < 3) parsed.push('');
      setResults(parsed);
      setActiveTab(0);

      if (typeof data.remaining === 'number') setRemaining(data.remaining);
      if (typeof data.limit === 'number') setLimit(data.limit);
    } catch (err) {
      setError(err.message || '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!text) return;
    clipCopy(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const remainingLabel = (() => {
    if (isAdminMode) return '👑 관리자 모드 (무제한)';
    if (remaining === null) return '남은 횟수 확인 중...';
    if (limit === 0) return '현재 무료 사용이 제한되어 있습니다';
    return `오늘 남은 횟수: ${remaining}/${limit}회`;
  })();
  const generateDisabled = loading || (!isAdminMode && remaining !== null && remaining <= 0 && limit !== null);

  return (
    <main className={styles.root}>
      <div className={styles.hero}>
        <h1>스레드 글 생성기 🧵</h1>
        <p>
          소재를 입력하면 터지는 스레드 글을 뚝딱 만들어드려요.<br />
          유형을 먼저 고르고 생성해보세요.
        </p>
      </div>

      <div className={styles.container}>
        <div className={styles.inputCard}>
          <h2>글 유형</h2>
          <div className={styles.typeGrid}>
            {TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`${styles.typeBtn} ${selectedType === t.id ? styles.typeBtnActive : ''}`}
                onClick={() => setSelectedType(t.id)}
              >
                <span className={styles.typeName}>{t.icon} {t.id}</span>
                <span className={styles.typeDesc}>{t.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.inputCard}>
          <h2>말투</h2>
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

        <div className={styles.inputCard}>
          <h2>내용 입력</h2>
          <div className={styles.inputRow}>
            <input
              type="text"
              placeholder="업종/직종 (예: 카페, 강사)"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            />
            <input
              type="text"
              placeholder="타겟 독자 (예: 30대 직장인)"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
          <input
            type="text"
            placeholder="주제/소재 (예: 번아웃 극복, 단골 만들기)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <textarea
            placeholder="내 경험이나 메모 (선택 — 짧게 적어도 됩니다)"
            rows={3}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />

          {error && <div className={styles.errorBox}>{error}</div>}

          <div className={styles.btnRow}>
            <button
              type="button"
              className={styles.generateBtn}
              onClick={generate}
              disabled={generateDisabled}
            >
              {loading ? '생성 중...' : '✦ 생성하기'}
            </button>
            <button type="button" className={styles.randomBtn} onClick={fillRandom}>
              랜덤
            </button>
          </div>
          <div
            className={styles.remainingCount}
            style={{ textAlign: 'right', color: isAdminMode ? '#3b82f6' : (remaining !== null && remaining <= 1) ? '#ff5f1f' : '#888' }}
          >
            {remainingLabel}
          </div>
        </div>

        {loading && (
          <div className={styles.loadingCard}>
            <div className={styles.spinner} />
            <p>스레드 글 쓰는 중...</p>
          </div>
        )}

        {results.some(Boolean) && !loading && (
          <div ref={resultRef} className={styles.resultCard}>
            <div className={styles.resultTabs}>
              {[0, 1, 2].map((i) => (
                <button
                  key={i}
                  type="button"
                  className={`${styles.resultTab} ${activeTab === i ? styles.resultTabActive : ''}`}
                  onClick={() => setActiveTab(i)}
                >
                  안 {i + 1}
                </button>
              ))}
            </div>
            <div className={styles.resultMeta}>
              <span className={styles.resultTag}>{selectedType} · {selectedTone}</span>
              <button
                type="button"
                className={`${styles.iconBtn} ${copied ? styles.copyBtnCopied : ''}`}
                onClick={handleCopy}
              >
                {copied ? '✓ 복사됨' : '복사'}
              </button>
            </div>
            <div
              style={{
                background: '#FAFBFE',
                border: '1px solid #E5E7EB',
                borderRadius: 10,
                padding: 16,
                fontSize: 14,
                lineHeight: 1.8,
                whiteSpace: 'pre-wrap',
              }}
            >
              {hasReply ? (
                <>
                  <div style={{ marginBottom: 12 }}>{mainText}</div>
                  <div style={{ borderTop: '1px dashed #E5E7EB', paddingTop: 12, color: '#6B7280', fontSize: '0.92em' }}>
                    <span className={styles.replyBadge}>답글</span>
                    <br />
                    {replyText}
                  </div>
                </>
              ) : (
                text
              )}
            </div>
            <div className={styles.charCount}>{charCount ? `${charCount}자` : ''}</div>
          </div>
        )}
      </div>
    </main>
  );
}
