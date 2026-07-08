'use client';

/**
 * 블로그 글 생성기 v2 — /api/blog-v2 (훅엔진+작업지시서+검수 패스).
 * 기존 BlogWriter.js(옛 레시피·클라이언트 프롬프트)를 대체하는 새 화면.
 * 스타일은 기존 page.module.css 재사용. 이미지는 blogTextForImagePro 핸드오프(기존 채널).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clipCopy } from '@/lib/utils';
import { getToken } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import styles from './page.module.css';

// 결과 포맷터(전체복사·화면표시 공용 — 한 곳에서 관리).
const fmtSummary = (s) => (s || []).map((x) => `- ${x}`).join('\n');
const fmtFaq = (f) => (f || []).map((x) => `Q. ${x.q}\nA. ${x.a}`).join('\n\n');
const fmtTags = (t) => (t || []).map((x) => `#${x}`).join(' ');

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const tk = getToken();
  if (tk) h.Authorization = `Bearer ${tk}`;
  return h;
}

const TONES = ['다정한 -요체', '차분한 -니다체', '친근한 반말 섞기'];

export default function BlogWriterV2() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [industry, setIndustry] = useState('');
  const [keyword, setKeyword] = useState('');
  const [targetReader, setTargetReader] = useState('');
  const [region, setRegion] = useState('');
  const [tone, setTone] = useState(TONES[0]);
  const [userStory, setUserStory] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { draft, quality, meta }
  const [copied, setCopied] = useState('');

  const canSubmit = industry.trim() && keyword.trim() && targetReader.trim() && !loading;

  async function generate() {
    if (!canSubmit) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/blog-v2', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          industry: industry.trim(),
          keyword: keyword.trim(),
          targetReader: targetReader.trim(),
          region: region.trim() || undefined,
          tone,
          userStory: userStory.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
        return;
      }
      setResult(data);
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function fullText(draft) {
    return `${draft.title}\n\n${draft.body}\n\n[3줄 요약]\n${fmtSummary(draft.summary3)}\n\n[FAQ]\n${fmtFaq(draft.faq)}\n\n${fmtTags(draft.tags)}`;
  }

  async function copy(kind, text) {
    await clipCopy(text);
    setCopied(kind);
    setTimeout(() => setCopied(''), 1500);
  }

  function goImages() {
    if (!result?.draft) return;
    try {
      // 첫 줄 = 제목 — 이미지 생성기가 첫 줄을 블로그 제목으로 읽는다(빼면 훅 문장을 제목으로 오인).
      localStorage.setItem('blogTextForImagePro', `${result.draft.title}\n\n${result.draft.body}`);
    } catch {}
    router.push('/blog-image-pro');
  }

  if (authLoading) return null;
  if (!user) {
    return (
      <main className={styles.container}>
        <div className={styles.card}>
          <p>로그인 후 이용할 수 있어요.</p>
        </div>
      </main>
    );
  }

  const q = result?.quality;

  return (
    <main className={styles.container}>
      {/* 입력 */}
      <div className={styles.card}>
        <div className={styles.inputGroup}>
          <label className={styles.inputLabel}>업종 <span className={styles.req}>*</span></label>
          <input className={styles.inputField} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="예: 필라테스 스튜디오, 세무사무소, 동네 빵집" maxLength={60} />
        </div>
        <div className={styles.inputGroup}>
          <label className={styles.inputLabel}>키워드 <span className={styles.req}>*</span></label>
          <input className={styles.inputField} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="노리는 검색어 1개 — 예: 필라테스 체험수업" maxLength={120} />
        </div>
        <div className={styles.inputGroup}>
          <label className={styles.inputLabel}>타겟 독자 <span className={styles.req}>*</span></label>
          <input className={styles.inputField} value={targetReader} onChange={(e) => setTargetReader(e.target.value)} placeholder="예: 운동을 시작하고 싶은 30~40대 여성" maxLength={120} />
        </div>
        <div className={styles.inputGroup}>
          <label className={styles.inputLabel}>지역 (선택)</label>
          <input className={styles.inputField} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="예: 강남, 수원 영통" maxLength={40} />
        </div>
        <div className={styles.inputGroup}>
          <label className={styles.inputLabel}>말투</label>
          <div className={styles.typeGrid}>
            {TONES.map((t) => (
              <button key={t} type="button" className={tone === t ? styles.typeBtnActive : styles.typeBtn} onClick={() => setTone(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.inputGroup}>
          <label className={styles.inputLabel}>내 이야기 (선택 — 넣으면 글의 힘이 확 달라져요)</label>
          <textarea
            className={styles.inputField}
            rows={4}
            value={userStory}
            onChange={(e) => setUserStory(e.target.value)}
            placeholder={'실제 경험·실적·에피소드를 적어주세요. 여기 적은 것만 글에 실적으로 들어가요(안 적으면 실적 없이 장면 위주로 씁니다).\n예: 중개 12년째. 작년에만 전세 계약 90건. 특약 한 줄로 보증금 지킨 사례 여러 번.'}
            maxLength={4000}
          />
        </div>
        <button type="button" className={styles.copyBtn} onClick={generate} disabled={!canSubmit}>
          {loading ? '작성 중… (약 1분)' : '원고 만들기'}
        </button>
        {error && <p style={{ color: '#d33', marginTop: 8 }}>{error}</p>}
      </div>

      {/* 결과 */}
      {result?.draft && (
        <>
          <div className={styles.resultCard}>
            <div className={styles.resultCardHeader}>
              <span className={styles.cardLabel}>제목</span>
              <button type="button" className={copied === 'title' ? styles.copyBtnCopied : styles.copyBtn} onClick={() => copy('title', result.draft.title)}>
                {copied === 'title' ? '복사됨' : '복사'}
              </button>
            </div>
            <p className={styles.resultText}>{result.draft.title}</p>
          </div>

          <div className={styles.resultCard}>
            <div className={styles.resultCardHeader}>
              <span className={styles.cardLabel}>본문 (이미지 자리 6곳 포함)</span>
              <button type="button" className={copied === 'body' ? styles.copyBtnCopied : styles.copyBtn} onClick={() => copy('body', fullText(result.draft))}>
                {copied === 'body' ? '복사됨' : '전체 복사'}
              </button>
            </div>
            <p className={styles.resultText} style={{ whiteSpace: 'pre-wrap' }}>{result.draft.body}</p>
          </div>

          <div className={styles.resultCard}>
            <div className={styles.resultCardHeader}>
              <span className={styles.cardLabel}>3줄 요약 · FAQ · 태그</span>
            </div>
            <p className={styles.resultText} style={{ whiteSpace: 'pre-wrap' }}>
              {`${fmtSummary(result.draft.summary3)}\n\n${fmtFaq(result.draft.faq)}\n\n${fmtTags(result.draft.tags)}`}
            </p>
          </div>

          {/* 검수 결과 */}
          {q && (
            <div className={styles.resultCard}>
              <div className={styles.resultCardHeader}>
                <span className={styles.cardLabel}>
                  자동 검수 {q.humanChecked ? `— 사람글 점수 ${q.humanScore}점 ${q.humanPass ? '(통과)' : '(70점 미만 — 아래 지적 확인)'}` : '— 점수 측정 실패(원고는 정상)'}
                </span>
              </div>
              {q.machine?.length > 0 && (
                <p className={styles.resultText} style={{ whiteSpace: 'pre-wrap' }}>
                  {'남은 형식 문제:\n' + q.machine.map((i) => `- [${i.label}] ${i.detail}`).join('\n')}
                </p>
              )}
              {q.humanIssues?.length > 0 && (
                <p className={styles.resultText} style={{ whiteSpace: 'pre-wrap' }}>
                  {'다듬으면 좋은 곳:\n' + q.humanIssues.map((i) => `- ${i.reason}`).join('\n')}
                </p>
              )}
              {q.machine?.length === 0 && (!q.humanIssues || q.humanIssues.length === 0) && (
                <p className={styles.resultText}>지적 사항 없음 — 바로 쓰셔도 좋아요.</p>
              )}
            </div>
          )}

          <div className={styles.resultCard}>
            <div className={styles.resultCardHeader}>
              <span className={styles.cardLabel}>다음 단계</span>
            </div>
            <button type="button" className={styles.copyBtn} onClick={goImages}>
              이 글로 이미지 만들기 → (자리 6곳 자동 인식)
            </button>
          </div>
        </>
      )}
    </main>
  );
}
