'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { clipCopy } from '@/lib/utils';
import { getToken } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import styles from './page.module.css';

const TYPES = [
  { id: '정보형', icon: '📋', desc: '"N가지 팁" 숫자 리스트로 가치 전달' },
  { id: '공감형', icon: '💛', desc: '감정을 짚고 경험담으로 위로' },
  { id: '반전형', icon: '🔄', desc: '상식을 뒤엎는 한 방으로 호기심 유발' },
  { id: '궁금증형', icon: '👀', desc: '스토리 절반만 공개, 댓글 폭발' },
];

const TONES = [
  { id: '친구체', icon: '😊', desc: '~했어, ~이야 (편한 반말)' },
  { id: '해요체', icon: '🌿', desc: '~해요, 따뜻하고 부드럽게' },
  { id: '단문체', icon: '⚡', desc: '짧고 건조. SNS 특유 리듬' },
  { id: '격식체', icon: '💼', desc: '~합니다, 전문가 느낌' },
];

const RANDOM_DATA = [
  { industry: '카페', target: '동네 단골', topic: '단골 만드는 법', memo: '커피보다 사람이 오는 가게' },
  { industry: '프리랜서', target: '직장인 부업족', topic: '퇴근 후 부업 첫 달', memo: '처음엔 월 10만원도 기뻤음' },
  { industry: '온라인 쇼핑몰', target: '30대 여성', topic: '첫 매출 낸 날', memo: '아무도 안 살 것 같았는데' },
  { industry: '1인 강사', target: '초보 창업자', topic: '수강생 0명에서 50명', memo: '광고 한 번 안 씀' },
  { industry: '마케터', target: '소상공인', topic: '인스타 팔로워보다 중요한 것', memo: '팔로워 100명인데 매출 남' },
];

function parseContent(text) {
  if (text && text.includes('[답글]')) {
    const parts = text.split('[답글]');
    return { double: true, main: parts[0].trim(), reply: parts[1] ? parts[1].trim() : '' };
  }
  return { double: false, text: text || '' };
}

function composeText(double, main, reply, single) {
  if (double) return reply ? `${main.trim()}\n[답글]\n${reply.trim()}` : main.trim();
  return single;
}

export default function ThreadsClient() {
  const { user } = useAuth();
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
  const [threadsConnected, setThreadsConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('');
  const [publishing, setPublishing] = useState(false);
  const resultRef = useRef(null);

  const current = parseContent(results[activeTab]);
  const charCount = (results[activeTab] || '').replace(/\n?\[답글\]\n?/g, '').length;

  function showToast(msg, type) {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function updateTab(text) {
    setResults((prev) => {
      const next = [...prev];
      next[activeTab] = text;
      return next;
    });
  }

  useEffect(() => {
    (async () => {
      const token = getToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      try {
        const res = await fetch('/api/threads', { headers });
        const data = await res.json();
        if (typeof data.remaining === 'number') setRemaining(data.remaining);
        if (typeof data.limit === 'number') setLimit(data.limit);
        if (data.admin) {
          setIsAdminMode(true);
        } else if (token) {
          const statusRes = await fetch('/api/threads-auth?action=status', { headers });
          const statusData = await statusRes.json();
          if (statusData.connected) setThreadsConnected(true);
        }
      } catch (_) {}
    })();
  }, [user]);

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
    try {
      const token = getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/api/threads', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: selectedType,
          tone: selectedTone,
          industry,
          target,
          topic,
          memo,
        }),
      });
      const data = await res.json();

      if (res.status === 429) {
        setError(data.error || '일일 사용 한도를 초과했습니다.');
        return;
      }
      if (data.error) {
        const errMsg = typeof data.error === 'string' ? data.error : (data.error && data.error.message) || '글 생성에 실패했습니다.';
        throw new Error(errMsg);
      }

      const newResults = data.results || ['', '', ''];
      while (newResults.length < 3) newResults.push('');
      setResults(newResults);
      setActiveTab(0);
      if (typeof data.remaining === 'number') setRemaining(data.remaining);
      if (typeof data.limit === 'number') setLimit(data.limit);
    } catch (err) {
      setError('오류: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    const text = results[activeTab];
    if (!text) return;
    clipCopy(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function publishNow() {
    const text = results[activeTab];
    if (!text) { showToast('발행할 글이 없습니다.', 'error'); return; }
    if (!confirm('이 글을 Threads에 바로 발행할까요?')) return;
    setPublishing(true);
    try {
      const token = getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/api/threads-publish', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '발행 실패');
      if (data.replyPending) {
        const sec = data.replyDelaySec || 60;
        showToast(`본문 발행 완료! 답글은 약 ${sec}초 후 자동 등록됩니다.`, 'success');
      } else if (data.replyFailed) {
        showToast('본문 발행 완료. 답글은 자동 등록에 실패했어요. Threads 앱에서 직접 답글을 달아주세요.', 'error');
      } else {
        showToast('발행 완료!', 'success');
      }
    } catch (err) {
      showToast('발행 실패: ' + err.message, 'error');
    } finally {
      setPublishing(false);
    }
  }

  function openScheduleModal() {
    const now = new Date();
    now.setHours(now.getHours() + 1);
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    setScheduleTime(local.toISOString().slice(0, 16));
    setShowScheduleModal(true);
  }

  async function confirmSchedule() {
    const text = results[activeTab];
    if (!text) { showToast('발행할 글이 없습니다.', 'error'); return; }
    if (!scheduleTime) { showToast('예약 시간을 선택해주세요.', 'error'); return; }
    const publishAt = new Date(scheduleTime).toISOString();
    setShowScheduleModal(false);
    try {
      const token = getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/api/threads-schedule', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text, publishAt }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '예약 실패');
      const dt = new Date(data.publishAt);
      const timeStr = dt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      showToast(`예약 완료! ${timeStr} 발행 예정`, 'success');
    } catch (err) {
      showToast('예약 실패: ' + err.message, 'error');
    }
  }

  const canPublish = isAdminMode || threadsConnected;
  const showHint = !canPublish && !!user;

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
        <h1><em>스레드 글</em> 생성기</h1>
        <p>소재를 입력하면 터지는 스레드 글을 AI가 뚝딱 만들어드립니다</p>
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
            <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
              <label htmlFor="industry">업종/직종</label>
              <input
                id="industry"
                type="text"
                placeholder="예: 카페, 강사, 마케터"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              />
            </div>
            <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
              <label htmlFor="target">타겟 독자</label>
              <input
                id="target"
                type="text"
                placeholder="예: 30대 직장인, 초보 창업자"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>
          </div>
          <div className={styles.inputGroup}>
            <label htmlFor="topic">주제/소재</label>
            <input
              id="topic"
              type="text"
              placeholder="예: 번아웃 극복, 단골 만들기, 첫 매출"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>
          <div className={styles.inputGroup}>
            <label htmlFor="memo">
              내 경험이나 메모 <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(선택)</span>
            </label>
            <textarea
              id="memo"
              rows={3}
              placeholder="짧게 적어도 됩니다. 글의 방향이 더 정확해져요."
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>

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
            style={{
              color: isAdminMode ? '#3b82f6' : (remaining !== null && remaining <= 1) ? '#FF4757' : '#9CA3AF',
            }}
          >
            {remainingLabel}
          </div>

          {error && <div className={styles.errorBox}>{error}</div>}
        </div>

        {loading && (
          <div className={styles.loadingCard}>
            <div className={styles.spinner} />
            <p>스레드 글 쓰는 중...</p>
          </div>
        )}

        {results.some(Boolean) && !loading && (
          <div ref={resultRef} className={styles.resultCard}>
            <h3>생성 결과</h3>
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
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.iconBtn} ${copied ? styles.copyBtnCopied : ''}`}
                  onClick={handleCopy}
                >
                  {copied ? '복사됨' : '복사'}
                </button>
                {canPublish && (
                  <>
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${styles.publishBtn}`}
                      onClick={publishNow}
                      disabled={publishing}
                    >
                      {publishing ? '발행 중...' : '즉시 발행'}
                    </button>
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${styles.scheduleBtn}`}
                      onClick={openScheduleModal}
                    >
                      예약 발행
                    </button>
                  </>
                )}
                {showHint && (
                  <div className={styles.threadsHint}>
                    <Link href="/mypage">마이페이지</Link>에서 Threads 계정을 연결하면 바로 발행할 수 있어요
                  </div>
                )}
              </div>
            </div>

            {current.double ? (
              <>
                <div className={styles.sectionHint}>본문</div>
                <textarea
                  className={styles.resultText}
                  rows={7}
                  value={current.main}
                  onChange={(e) => updateTab(composeText(true, e.target.value, current.reply, ''))}
                />
                <div className={styles.replyLabel}>
                  <span className={styles.replyBadge}>답글</span>
                  <span className={styles.replyHint}>발행 시 본문의 답글로 자동 등록됩니다</span>
                </div>
                <textarea
                  className={styles.resultText}
                  rows={4}
                  value={current.reply}
                  onChange={(e) => updateTab(composeText(true, current.main, e.target.value, ''))}
                />
              </>
            ) : (
              <textarea
                className={styles.resultText}
                rows={10}
                value={current.text}
                onChange={(e) => updateTab(e.target.value)}
              />
            )}
            <div className={styles.charCount}>{charCount ? `${charCount}자` : ''}</div>
          </div>
        )}

        <div className={styles.toolsSection}>
          <div className={styles.toolsLabel}>뚝딱툴 도구 모음</div>
          <div className={styles.toolsGrid}>
            <div className={styles.toolCardCurrent}>
              <div className={styles.toolTag}>현재 페이지</div>
              <div className={styles.toolName}>🧵 스레드 글 생성기</div>
              <div className={styles.toolDesc}>소재 입력 → 터지는 스레드 글 3개 생성</div>
            </div>
            <a href="/" className={styles.toolCardLink}>
              <div className={styles.toolTag}>바로가기 →</div>
              <div className={styles.toolName}>📝 블로그 제목 생성기</div>
              <div className={styles.toolDesc}>키워드 입력 → 클릭을 부르는 제목 12패턴</div>
            </a>
            <a href="/blog-writer" className={styles.toolCardLink}>
              <div className={styles.toolTag}>바로가기 →</div>
              <div className={styles.toolName}>✍️ 블로그 글 생성기</div>
              <div className={styles.toolDesc}>업종·키워드 → 상위노출 블로그 글 작성</div>
            </a>
            <a href="/blog-image-pro" className={styles.toolCardLink}>
              <div className={styles.toolTag}>바로가기 →</div>
              <div className={styles.toolName}>🖼️ 프리미엄 이미지</div>
              <div className={styles.toolDesc}>블로그 글 분석 → AI 이미지 8장 생성</div>
            </a>
          </div>
        </div>
      </div>

      {toast && (
        <div className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : toast.type === 'error' ? styles.toastError : ''}`}>
          {toast.msg}
        </div>
      )}

      {showScheduleModal && (
        <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) setShowScheduleModal(false); }}>
          <div className={styles.modalBox}>
            <h3>예약 발행 시간</h3>
            <input
              type="datetime-local"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
            />
            <div className={styles.modalActions}>
              <button type="button" className={styles.modalCancel} onClick={() => setShowScheduleModal(false)}>
                취소
              </button>
              <button type="button" className={styles.modalConfirm} onClick={confirmSchedule}>
                예약하기
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
