'use client';

import { useEffect, useRef, useState } from 'react';
import { getToken } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import styles from './page.module.css';

function getDefaultFeaturedGroups(keywords) {
  return {
    base: { keywords: keywords.slice(0, 10) },
    niche: { enabled: false, keywords: [] },
  };
}

const GRADE_RANK = { blue: 4, green: 3, yellow: 2, red: 1 };
const COMPETITION_RANK = { low: 1, medium: 2, high: 3 };

function getSortValue(kw, key) {
  if (key === 'grade') return GRADE_RANK[kw.grade] || 0;
  if (key === 'monthlySearch') return kw.monthlySearch || 0;
  if (key === 'competition') return COMPETITION_RANK[kw.competition] || 0;
  if (key === 'saturation') return kw.blogCountAvailable ? kw.saturation : null;
  return kw[key];
}

function compareKeywords(a, b, key, asc) {
  const va = getSortValue(a, key);
  const vb = getSortValue(b, key);

  if (key === 'saturation') {
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
  }

  if (typeof va === 'string' && typeof vb === 'string') {
    const compared = va.localeCompare(vb, 'ko');
    return asc ? compared : -compared;
  }

  if (va < vb) return asc ? -1 : 1;
  if (va > vb) return asc ? 1 : -1;

  if (key === 'grade') {
    if (a.score < b.score) return asc ? -1 : 1;
    if (a.score > b.score) return asc ? 1 : -1;
  }
  return 0;
}

function gradeIcon(grade) {
  const icons = { blue: '🔵', green: '🟢', yellow: '🟠', red: '🔴' };
  return icons[grade] || '';
}

function CompetitionBadge({ competition }) {
  const labels = { low: '낮음', medium: '중간', high: '높음' };
  const cls = competition === 'low' ? styles.badgeLow
    : competition === 'medium' ? styles.badgeMedium
    : competition === 'high' ? styles.badgeHigh
    : '';
  return <span className={`${styles.badge} ${cls}`}>{labels[competition] || competition}</span>;
}

function TrendBadge({ kw }) {
  if (kw.trend === 'unknown') return <span className={`${styles.badge} ${styles.badgeUnknown}`}>— 미수집</span>;
  const arrow = kw.trend === 'rising' ? '▲' : kw.trend === 'falling' ? '▼' : '—';
  const label = kw.trend === 'rising' ? '상승' : kw.trend === 'falling' ? '하락' : '유지';
  const cls = kw.trend === 'rising' ? styles.badgeRising
    : kw.trend === 'falling' ? styles.badgeFalling
    : styles.badgeStable;
  const changeStr = kw.trendChange ? ` ${kw.trendChange > 0 ? '+' : ''}${kw.trendChange}%` : '';
  return <span className={`${styles.badge} ${cls}`}>{arrow} {label}{changeStr}</span>;
}

function KwCard({ kw, rank }) {
  const gradeClass = kw.grade === 'blue' ? styles.gradeBlue
    : kw.grade === 'green' ? styles.gradeGreen
    : kw.grade === 'yellow' ? styles.gradeYellow
    : styles.gradeRed;
  return (
    <div className={styles.kwCard}>
      <div className={styles.kwCardHeader}>
        <div className={styles.kwRank}>{rank}</div>
        <div className={styles.kwGrade}>
          <span className={`${styles.kwGradeBadge} ${gradeClass}`}>{gradeIcon(kw.grade)} {kw.label}</span>
          <span className={styles.kwScoreSmall}>{kw.score}점</span>
        </div>
      </div>
      <div className={styles.kwName}>{kw.keyword}</div>
      <div className={styles.kwGradeDesc}>{kw.gradeDescription}</div>
      <div className={styles.kwStats}>
        <div>검색수 <b>{(kw.monthlySearch || 0).toLocaleString()}</b></div>
        <div>경쟁도 <CompetitionBadge competition={kw.competition} /></div>
        <div>포화도 {kw.blogCountAvailable ? <b>{kw.saturation}</b> : <span style={{ color: '#9CA3AF' }}>미수집</span>}</div>
        <div>트렌드 <TrendBadge kw={kw} /></div>
      </div>
      <a className={styles.blogLinkBtn} href={`/blog-writer?topic=${encodeURIComponent(kw.keyword)}`}>
        이 키워드로 블로그 글 쓰기
      </a>
    </div>
  );
}

export default function KeywordFinder() {
  const { user } = useAuth();
  const [field, setField] = useState('');
  const [role, setRole] = useState('');
  const [target, setTarget] = useState('');
  const [questions, setQuestions] = useState('');
  const [userSeeds, setUserSeeds] = useState('');

  const [profiles, setProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState('');

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');

  const [allKeywords, setAllKeywords] = useState([]);
  const [allSections, setAllSections] = useState([]);
  const [featuredGroups, setFeaturedGroups] = useState(null);
  const [remainingState, setRemainingState] = useState(null); // { remaining, limit, admin }
  const [currentSort, setCurrentSort] = useState({ key: 'grade', asc: false });

  const progressTimerRef = useRef(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('kw_profiles');
      if (raw) setProfiles(JSON.parse(raw));
    } catch (_) {}
  }, []);

  useEffect(() => {
    return () => { if (progressTimerRef.current) clearInterval(progressTimerRef.current); };
  }, []);

  function saveProfile() {
    if (!field && !role && !target) {
      setError('저장할 내용을 입력해주세요.');
      return;
    }
    const name = prompt('프로필 이름을 입력하세요:', field || role || '내 프로필');
    if (!name) return;
    const next = [...profiles];
    const existing = next.findIndex((p) => p.name === name);
    const profile = { name, field, role, target };
    if (existing >= 0) next[existing] = profile;
    else next.push(profile);
    setProfiles(next);
    setSelectedProfile(String(next.findIndex((p) => p.name === name)));
    try { localStorage.setItem('kw_profiles', JSON.stringify(next)); } catch (_) {}
    setError('');
  }

  function loadProfile(idxStr) {
    setSelectedProfile(idxStr);
    if (idxStr === '') return;
    const p = profiles[parseInt(idxStr, 10)];
    if (!p) return;
    setField(p.field || '');
    setRole(p.role || '');
    setTarget(p.target || '');
  }

  function deleteProfile() {
    if (selectedProfile === '') {
      setError('삭제할 프로필을 선택해주세요.');
      return;
    }
    const idx = parseInt(selectedProfile, 10);
    const name = profiles[idx]?.name;
    if (!confirm(`"${name}" 프로필을 삭제할까요?`)) return;
    const next = profiles.filter((_, i) => i !== idx);
    setProfiles(next);
    setSelectedProfile('');
    try { localStorage.setItem('kw_profiles', JSON.stringify(next)); } catch (_) {}
    setError('');
  }

  function startProgressSim() {
    setProgress(10);
    setProgressText('[1/4] AI가 시드키워드를 생성하고 있습니다...');
    progressTimerRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 85) return prev;
        const next = prev + Math.random() * 3;
        if (next > 25 && next < 50) setProgressText('[2/4] 네이버에서 키워드를 확장하고 있습니다...');
        else if (next > 50 && next < 70) setProgressText('[3/4] 검색 트렌드를 분석하고 있습니다...');
        else if (next > 70) setProgressText('[4/4] 황금키워드를 선별하고 있습니다...');
        return next;
      });
    }, 500);
  }

  function stopProgressSim() {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  async function findKeywords() {
    setError('');
    setNotice('');
    setFeaturedGroups(null);
    setAllSections([]);

    if (!field.trim()) { setError('내 분야를 입력해주세요.'); return; }
    if (!role.trim()) { setError('"나는" 항목을 입력해주세요.'); return; }
    if (!target.trim()) { setError('타겟 독자를 입력해주세요.'); return; }

    setLoading(true);
    startProgressSim();

    try {
      const headers = { 'Content-Type': 'application/json' };
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch('/api/keywords', {
        method: 'POST',
        cache: 'no-store',
        headers,
        body: JSON.stringify({ field, role, target, questions, userSeeds }),
      });
      const data = await res.json();

      stopProgressSim();

      if (!res.ok) {
        setError(data.error || '키워드 분석에 실패했습니다.');
        setLoading(false);
        setProgress(0);
        return;
      }

      setProgress(100);
      setProgressText('완료!');
      setTimeout(() => { setLoading(false); setProgress(0); }, 800);

      setNotice(data.notice || '');

      const keywords = data.keywords || [];
      const sortedKeywords = [...keywords].sort((a, b) => compareKeywords(a, b, currentSort.key, currentSort.asc));
      setAllKeywords(sortedKeywords);
      setAllSections(data.sections || []);
      setFeaturedGroups(data.featuredGroups || getDefaultFeaturedGroups(sortedKeywords));

      if (data.remaining !== undefined) {
        setRemainingState({
          remaining: data.remaining,
          limit: data.limit,
          admin: data.remaining >= 999,
        });
      }
    } catch (_) {
      stopProgressSim();
      setFeaturedGroups(null);
      setAllSections([]);
      setError('서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      setLoading(false);
      setProgress(0);
    }
  }

  function sortTable(key) {
    const asc = currentSort.key === key ? !currentSort.asc : false;
    setCurrentSort({ key, asc });
    setAllKeywords((prev) => [...prev].sort((a, b) => compareKeywords(a, b, key, asc)));
  }

  function downloadCSV() {
    if (allKeywords.length === 0) return;
    const headers = ['키워드', '등급', '점수', '월간검색수', 'PC검색수', '모바일검색수', '경쟁도', '블로그발행량', '포화도', '트렌드', '트렌드변화율'];
    const rows = allKeywords.map((kw) => [
      kw.keyword,
      kw.label,
      kw.score,
      kw.monthlySearch,
      kw.pcSearch,
      kw.mobileSearch,
      kw.competition,
      kw.blogCountAvailable ? kw.blogCount : '미수집',
      kw.blogCountAvailable ? kw.saturation : '미수집',
      kw.trend === 'unknown' ? '미수집' : kw.trend,
      kw.trendChange,
    ]);
    const csv = '\uFEFF' + headers.join(',') + '\n' + rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `golden_keywords_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const questionCount = questions.split('\n').filter((l) => l.trim().length > 0).length;
  const isLoggedIn = !!user;
  const remainingClass = !isLoggedIn ? `${styles.remaining} ${styles.remainingBlocked}`
    : remainingState?.admin ? `${styles.remaining} ${styles.remainingAdmin}`
    : remainingState && remainingState.remaining <= 0 ? `${styles.remaining} ${styles.remainingBlocked}`
    : styles.remaining;
  const remainingText = !isLoggedIn
    ? '로그인 후 이용 가능합니다'
    : remainingState?.admin
      ? '관리자 모드 (무제한)'
      : remainingState
        ? remainingState.remaining <= 0
          ? '오늘 사용 한도를 모두 사용했어요. 내일 다시 오세요!'
          : `오늘 ${remainingState.limit - remainingState.remaining}/${remainingState.limit}회 사용 | 잔여: ${remainingState.remaining}회`
        : '1일 3회 무료';

  const baseKeywords = featuredGroups?.base?.keywords || [];
  const nicheEnabled = Boolean(featuredGroups?.niche?.enabled);
  const nicheKeywords = nicheEnabled ? (featuredGroups.niche.keywords || []) : [];
  const sections = Array.isArray(allSections) ? allSections.filter((s) => s && Array.isArray(s.keywords) && s.keywords.length > 0) : [];

  function SortHeader({ id, label }) {
    const isActive = currentSort.key === id;
    const arrow = isActive ? (currentSort.asc ? '↑' : '↓') : '↕';
    return (
      <th
        className={`${styles.sortable} ${isActive ? styles.activeSort : ''}`}
        onClick={() => sortTable(id)}
      >
        {label} <span className={styles.sortArrow}>{arrow}</span>
      </th>
    );
  }

  return (
    <main className={styles.root}>
      <div className={styles.hero}>
        <div className={styles.heroBadge}>NEW · 황금키워드</div>
        <h1>내 분야의<br /><em>황금키워드를 찾아드립니다</em></h1>
        <p>검색량은 높고 경쟁은 낮은 블루오션 키워드를<br />AI + 네이버 데이터로 분석합니다</p>
      </div>

      <div className={styles.container}>
        <div className={remainingClass}>{remainingText}</div>

        {notice && <div className={styles.noticeBox}>{notice}</div>}

        <div className={styles.card}>
          <div className={styles.profileRow}>
            <label className={styles.label} style={{ marginBottom: 0 }}>내 프로필</label>
            <div className={styles.profileActions}>
              <select
                className={styles.profileSelect}
                value={selectedProfile}
                onChange={(e) => loadProfile(e.target.value)}
              >
                <option value="">저장된 프로필 선택...</option>
                {profiles.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
              </select>
              <button type="button" className={`${styles.profileBtn} ${styles.profileBtnSave}`} onClick={saveProfile}>저장</button>
              <button type="button" className={styles.profileBtn} onClick={deleteProfile}>삭제</button>
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <div style={{ marginBottom: 14 }}>
            <label className={styles.label}>내 분야</label>
            <input
              type="text"
              className={styles.inputField}
              placeholder="예: 웨딩컨설팅, 육아/리빙, 카페 창업, 맛집 블로그"
              maxLength={50}
              value={field}
              onChange={(e) => setField(e.target.value)}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className={styles.label}>나는</label>
            <input
              type="text"
              className={styles.inputField}
              placeholder="예: 웨딩플래너, 육아 블로거, 카페 사장, 맛집 리뷰어"
              maxLength={50}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className={styles.label}>
              타겟 독자 <span style={{ fontWeight: 400, color: '#9CA3AF' }}>({target.length}/200)</span>
            </label>
            <textarea
              className={styles.textareaField}
              placeholder="예: 30대 초반 예비 신부. 결혼 준비가 처음이라 뭐부터 해야 할지 모르는 상태. 스드메, 웨딩홀, 예식 비용에 관심이 많고 합리적인 가격을 찾고 있다."
              maxLength={200}
              style={{ minHeight: 80 }}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
            <div className={styles.hint}>타겟 페르소나를 구체적으로 쓸수록 정확한 키워드가 나옵니다</div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className={styles.label}>
              자주 받는 질문 <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(선택)</span>
            </label>
            <textarea
              className={styles.textareaField}
              placeholder="예: 스드메 비용이 얼마예요?&#10;본식 드레스 어떻게 고르나요?&#10;웨딩홀 어떻게 골라요?&#10;셀프웨딩 가능한가요?&#10;&#10;한 줄에 하나씩, 많이 쓸수록 황금키워드가 풍부해집니다"
              style={{ minHeight: 120 }}
              value={questions}
              onChange={(e) => setQuestions(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <div className={styles.hint}>질문을 많이 쓸수록 더 다양한 황금키워드를 찾아냅니다</div>
              <div className={styles.hint}>{questionCount}개</div>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className={styles.label}>
              직접 추가할 키워드 <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(선택)</span>
            </label>
            <textarea
              className={styles.textareaField}
              placeholder="예: 스드메, 본식드레스, 웨딩박람회, 신혼여행&#10;&#10;업계 용어나 AI가 모를 수 있는 키워드를 직접 넣으세요"
              style={{ minHeight: 60 }}
              value={userSeeds}
              onChange={(e) => setUserSeeds(e.target.value)}
            />
            <div className={styles.hint}>쉼표 또는 줄바꿈으로 구분. AI 시드에 합쳐져서 더 정밀한 분석이 됩니다</div>
          </div>

          {error && <div className={styles.errorBox}>{error}</div>}

          <button
            type="button"
            className={styles.generateBtn}
            onClick={findKeywords}
            disabled={loading || !isLoggedIn}
          >
            {loading ? '분석 중...' : isLoggedIn ? '황금키워드 찾기' : '로그인 필요'}
          </button>
        </div>

        {loading && (
          <div className={styles.progressCard}>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${progress}%` }} />
            </div>
            <div className={styles.progressText}>{progressText}</div>
          </div>
        )}

        {baseKeywords.length > 0 && (
          <div className={styles.topBlocks}>
            <div className={styles.card}>
              <div className={styles.kwHeader}>
                <div>
                  <h2>내 분야 기본 황금키워드</h2>
                  <p>업종 전반에서 검색량과 경쟁도를 기준으로 추린 기본 추천입니다.</p>
                </div>
                <button type="button" className={styles.csvBtn} onClick={downloadCSV}>CSV 다운로드</button>
              </div>
              <div className={styles.topKeywords}>
                {baseKeywords.map((kw, i) => <KwCard key={i} kw={kw} rank={i + 1} />)}
              </div>
            </div>

            {nicheEnabled && nicheKeywords.length > 0 && (
              <div className={styles.card}>
                <div className={styles.kwHeader}>
                  <div>
                    <h2>고객 질문 반영 황금키워드</h2>
                    <p>고객 질문과 직접 키워드를 반영해 더 니치하게 좁힌 추천입니다.</p>
                  </div>
                </div>
                <div className={styles.topKeywords}>
                  {nicheKeywords.map((kw, i) => <KwCard key={i} kw={kw} rank={i + 1} />)}
                </div>
              </div>
            )}
          </div>
        )}

        {sections.length > 0 && (
          <div className={styles.card}>
            <div className={styles.kwHeader}>
              <div>
                <h2>확장 추천</h2>
                <p>고객 질문, 특수 타겟, 업계 워딩을 기준으로 다시 묶은 결과입니다.</p>
              </div>
            </div>
            <div className={styles.sectionsGrid}>
              {sections.map((section, i) => (
                <div key={i} className={styles.sectionCard}>
                  <h3>{section.title}</h3>
                  <p>{section.description}</p>
                  <div className={styles.sectionList}>
                    {section.keywords.map((kw, j) => (
                      <a
                        key={j}
                        className={styles.sectionItem}
                        href={`/blog-writer?topic=${encodeURIComponent(kw.keyword)}`}
                      >
                        <span className={styles.sectionItemTitle}>{kw.keyword}</span>
                        <span className={styles.sectionItemMeta}>
                          {kw.label} · 검색수 {(kw.monthlySearch || 0).toLocaleString()} · {kw.score}점
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {allKeywords.length > 0 && (
          <div className={styles.card}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
              전체 키워드 ({allKeywords.length}개)
            </h3>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <SortHeader id="grade" label="등급" />
                    <th>키워드</th>
                    <SortHeader id="monthlySearch" label="월간 검색수" />
                    <SortHeader id="competition" label="경쟁도" />
                    <SortHeader id="saturation" label="포화도" />
                    <th>트렌드</th>
                    <th>블로그 글</th>
                  </tr>
                </thead>
                <tbody>
                  {allKeywords.map((kw, i) => {
                    const dotClass = kw.grade === 'blue' ? styles.gradeDotBlue
                      : kw.grade === 'green' ? styles.gradeDotGreen
                      : kw.grade === 'yellow' ? styles.gradeDotYellow
                      : styles.gradeDotRed;
                    return (
                      <tr key={i}>
                        <td>
                          <span className={`${styles.gradeDot} ${dotClass}`} />
                          <b style={{ fontSize: 12 }}>{kw.label}</b>{' '}
                          <span style={{ color: '#9CA3AF', fontSize: 11 }}>{kw.score}</span>
                        </td>
                        <td>{kw.keyword}</td>
                        <td>{(kw.monthlySearch || 0).toLocaleString()}</td>
                        <td><CompetitionBadge competition={kw.competition} /></td>
                        <td>{kw.blogCountAvailable ? kw.saturation : <span style={{ color: '#9CA3AF' }}>-</span>}</td>
                        <td><TrendBadge kw={kw} /></td>
                        <td>
                          <a
                            href={`/blog-writer?topic=${encodeURIComponent(kw.keyword)}`}
                            style={{ color: '#ff5f1f', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
                          >
                            글쓰기
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
