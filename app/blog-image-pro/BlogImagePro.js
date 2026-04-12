'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import styles from './page.module.css';

const TYPE_ICONS = {
  photo: '📷',
  infographic_data: '📊',
  infographic_flow: '🔄',
  checklist: '✅',
  venn: '⭕',
  poster: '🎭',
};
const TYPE_NAMES = {
  photo: '사진',
  infographic_data: '데이터 인포',
  infographic_flow: '흐름도',
  checklist: '체크리스트',
  venn: '관계도',
  poster: '포스터',
};

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const tk = getToken();
  if (tk) h.Authorization = `Bearer ${tk}`;
  return h;
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0] || '';
  for (let i = 1; i < words.length; i++) {
    const testLine = currentLine + ' ' + words[i];
    if (ctx.measureText(testLine).width > maxWidth) {
      lines.push(currentLine);
      currentLine = words[i];
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function renderThumbnailCanvas(canvas, imageUrl, text) {
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    ctx.drawImage(img, 0, 0, 1024, 1024);
    if (!text) return;
    text = text.substring(0, 30);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, 1024, 1024);
    const gradient = ctx.createLinearGradient(0, 512, 0, 1024);
    gradient.addColorStop(0, 'transparent');
    gradient.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 512, 1024, 512);

    document.fonts.ready.then(() => {
      const maxWidth = 920;
      let fontSize = 140;
      const sampleStr = '가나다라마바사아자차';
      ctx.font = `900 ${fontSize}px "Noto Sans KR"`;
      while (ctx.measureText(sampleStr).width > maxWidth && fontSize > 48) {
        fontSize -= 2;
        ctx.font = `900 ${fontSize}px "Noto Sans KR"`;
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = wrapText(ctx, text, maxWidth);
      const lineHeight = fontSize * 1.4;
      const totalHeight = lines.length * lineHeight;
      const startY = 512 - (totalHeight / 2) + (lineHeight / 2);
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = '#FFFFFF';
      for (let j = 0; j < lines.length; j++) {
        ctx.fillText(lines[j], 512, startY + j * lineHeight);
      }
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    });
  };
  img.src = imageUrl;
}

function ImageCard({ item, index, thumbnailText, currentMode, onRegenerate, regenBusy }) {
  const canvasRef = useRef(null);
  const isThumbnail = index === 0 && !!thumbnailText;
  const itemType = item.type || 'photo';
  const isInfographic = itemType !== 'photo';

  useEffect(() => {
    if (isThumbnail && canvasRef.current) {
      renderThumbnailCanvas(canvasRef.current, item.url, thumbnailText);
    }
  }, [isThumbnail, item.url, thumbnailText]);

  function download() {
    if (isThumbnail && canvasRef.current) {
      canvasRef.current.toBlob((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'thumbnail.png';
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    } else if (item.url.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = item.url;
      a.download = `blog-image-${index + 1}.webp`;
      a.click();
    } else {
      fetch(item.url)
        .then((res) => res.blob())
        .then((blob) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `blog-image-${index + 1}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(a.href);
        })
        .catch(() => { window.open(item.url, '_blank'); });
    }
  }

  const label = isThumbnail ? '썸네일 (텍스트 합성)' : (TYPE_NAMES[itemType] || item.marker || `이미지 ${index + 1}`);
  const markerLabel = item.marker ? `${TYPE_ICONS[itemType] || '📷'} ${item.marker}` : null;

  return (
    <div className={`${styles.imageCard} ${isThumbnail ? styles.imageCardThumbnail : ''}`}>
      {markerLabel && (
        <div
          className={styles.imageCardMarker}
          style={isInfographic ? { background: '#F0FFF4', borderBottomColor: '#C6F6D5', color: '#276749' } : {}}
        >
          {markerLabel}
        </div>
      )}
      {isThumbnail ? (
        <canvas ref={canvasRef} width={1024} height={1024} />
      ) : (
        <img src={item.url} alt={item.marker || `이미지 ${index + 1}`} loading="lazy" />
      )}
      <div className={styles.imageCardActions}>
        <span className={styles.imageLabel}>{label}</span>
        <div className={styles.actionBtns}>
          <button
            type="button"
            className={styles.regenSingleBtn}
            onClick={() => onRegenerate(index)}
            disabled={regenBusy}
          >
            {regenBusy ? '생성 중...' : '다시 생성'}
          </button>
          <button type="button" className={styles.downloadBtn} onClick={download}>
            다운로드
          </button>
        </div>
      </div>
      {regenBusy && (
        <div className={styles.cardLoadingOverlay}>
          <div className={styles.loadingSpinner} />
        </div>
      )}
    </div>
  );
}

export default function BlogImagePro() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [tab, setTab] = useState('parse');
  const [blogText, setBlogText] = useState('');
  const [editableMarkers, setEditableMarkers] = useState([]);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [thumbText1, setThumbText1] = useState('');

  const [topic, setTopic] = useState('');
  const [mood, setMood] = useState('bright');
  const [thumbText2, setThumbText2] = useState('');

  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('AI가 고품질 이미지를 생성하고 있습니다...');
  const [loadingProgress, setLoadingProgress] = useState('');
  const [error1, setError1] = useState('');
  const [error2, setError2] = useState('');

  const [images, setImages] = useState([]);
  const [currentMode, setCurrentMode] = useState('');
  const [currentThumbnailText, setCurrentThumbnailText] = useState('');
  const [regenIndex, setRegenIndex] = useState(null);
  const [regenAllBusy, setRegenAllBusy] = useState(false);

  const [remainingState, setRemainingState] = useState(null);

  const resultRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await fetch('/api/blog-image-pro', { headers: authHeaders() });
        const data = await res.json();
        setRemainingState(data);
      } catch (_) {}
    })();
  }, [user]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('blogTextForImagePro');
      if (saved) {
        localStorage.removeItem('blogTextForImagePro');
        setTab('parse');
        setBlogText(saved);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    // Detect markers on blog text change
    const regex = /\((사진|이미지):\s*([^)]+)\)/g;
    const markers = [];
    let m;
    while ((m = regex.exec(blogText)) !== null) {
      const rawText = m[2].trim();
      const altMatch = rawText.match(/^(.+?),\s*alt:\s*(.+)$/);
      markers.push(altMatch ? altMatch[1].trim() : rawText);
    }
    if (markers.length > 0) {
      setEditableMarkers(markers.slice(0, 8));
    }
  }, [blogText]);

  useEffect(() => {
    if (images.length > 0 && resultRef.current) {
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [images]);

  async function suggestMarkers() {
    if (!blogText.trim()) return;
    setSuggestBusy(true);
    setError1('');
    try {
      const res = await fetch('/api/blog-image-pro', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ mode: 'suggest_markers', blogText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError1(data.error || 'AI 마커 추천에 실패했습니다.');
        return;
      }
      if (!data.markers || data.markers.length === 0) {
        setError1('AI가 마커를 추천하지 못했습니다. 다시 시도해주세요.');
        return;
      }
      setEditableMarkers(data.markers.map((m) => m.text).slice(0, 8));
    } catch (_) {
      setError1('서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSuggestBusy(false);
    }
  }

  function addMarker() {
    if (editableMarkers.length >= 8) return;
    setEditableMarkers([...editableMarkers, '']);
  }

  function updateMarker(idx, value) {
    setEditableMarkers((prev) => prev.map((m, i) => (i === idx ? value : m)));
  }

  function deleteMarker(idx) {
    setEditableMarkers((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRemaining(remaining, limit) {
    setRemainingState({ remaining, limit, admin: remaining >= 999 });
  }

  async function generateParse() {
    if (!blogText.trim()) { setError1('블로그 글을 붙여넣어주세요.'); return; }
    const markersToSend = editableMarkers.filter((m) => m.trim() !== '');
    if (markersToSend.length === 0) {
      setError1('이미지 마커가 없습니다. 마커를 추가하거나 (사진: ...) 마커가 포함된 글을 붙여넣어주세요.');
      return;
    }

    setError1('');
    setError2('');
    setLoading(true);
    setLoadingText(`AI가 이미지 생성 중... ${markersToSend.length}개 이미지 준비 중`);
    setLoadingProgress('마커 분석 → 프롬프트 변환 → 이미지 생성 (약 1~2분)');

    try {
      const res = await fetch('/api/blog-image-pro', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          mode: 'parse',
          blogText,
          thumbnailText: thumbText1,
          markers: markersToSend,
        }),
      });
      const data = await res.json();

      if (res.status === 401 || res.status === 403) { setError1(data.error || '인증에 실패했습니다.'); return; }
      if (res.status === 429) { setError1(data.error); return; }
      if (!res.ok || !data.images || data.images.length === 0) {
        setError1(data.error || '이미지 생성에 실패했습니다.');
        return;
      }

      setCurrentMode('parse');
      setCurrentThumbnailText(thumbText1);
      setImages(data.images.map((img, i) => ({
        url: img.url,
        marker: img.marker,
        prompt: img.prompt,
        type: img.type || 'photo',
        model: img.model || 'fluxr',
        reason: img.reason || '',
        index: i,
      })));
      if (typeof data.remaining === 'number') updateRemaining(data.remaining, data.limit);
    } catch (_) {
      setError1('서버 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function generateDirect() {
    if (!topic.trim()) { setError2('블로그 주제를 입력해주세요.'); return; }

    setError1('');
    setError2('');
    setLoading(true);
    setLoadingText('AI가 이미지 8장을 생성하고 있습니다...');
    setLoadingProgress('주제 분석 → 프롬프트 변환 → 이미지 생성 (약 1~2분)');

    try {
      const res = await fetch('/api/blog-image-pro', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          mode: 'direct',
          topic,
          mood,
          thumbnailText: thumbText2,
        }),
      });
      const data = await res.json();

      if (res.status === 401 || res.status === 403) { setError2(data.error || '인증에 실패했습니다.'); return; }
      if (res.status === 429) { setError2(data.error); return; }
      if (!res.ok || !data.images || data.images.length === 0) {
        setError2(data.error || '이미지 생성에 실패했습니다.');
        return;
      }

      setCurrentMode('direct');
      setCurrentThumbnailText(thumbText2);
      setImages(data.images.map((img, i) => ({
        url: img.url,
        marker: null,
        prompt: img.prompt,
        type: img.type || 'photo',
        model: img.model || 'fluxr',
        reason: '',
        index: i,
      })));
      if (typeof data.remaining === 'number') updateRemaining(data.remaining, data.limit);
    } catch (_) {
      setError2('서버 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function regenerateSingle(index) {
    const item = images[index];
    if (!item) return;
    setRegenIndex(index);

    try {
      const body = { mode: 'regenerate_single' };
      if (currentMode === 'parse' && item.marker) {
        body.blogText = blogText.trim();
        body.markerText = item.marker;
        body.originalPrompt = item.prompt;
        body.originalType = item.type || 'photo';
        body.originalModel = item.model || 'fluxr';
      } else {
        body.originalPrompt = item.prompt;
        body.originalModel = item.model || 'fluxr';
      }

      const res = await fetch('/api/blog-image-pro', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (res.ok && data.image?.url) {
        setImages((prev) => prev.map((it, i) => i === index ? {
          ...it,
          url: data.image.url,
          prompt: data.image.prompt,
          type: data.image.type || it.type,
          model: data.image.model || it.model,
        } : it));
        if (typeof data.remaining === 'number') updateRemaining(data.remaining, data.limit);
      } else {
        const setErr = currentMode === 'parse' ? setError1 : setError2;
        setErr(data.error || '재생성에 실패했습니다.');
      }
    } catch (_) {
      const setErr = currentMode === 'parse' ? setError1 : setError2;
      setErr('서버 오류가 발생했습니다.');
    } finally {
      setRegenIndex(null);
    }
  }

  async function regenerateAll() {
    if (!images || images.length === 0) return;
    setRegenAllBusy(true);
    setLoading(true);
    setLoadingText('AI가 새 이미지를 생성하고 있습니다...');
    setLoadingProgress('강화된 프롬프트로 이미지 재생성 중 (약 1~2분)');

    try {
      let body, thumbText;
      if (currentMode === 'parse') {
        thumbText = thumbText1;
        const markersForRegen = editableMarkers.filter((m) => m.trim() !== '');
        body = {
          mode: 'parse',
          blogText,
          thumbnailText: thumbText,
          is_regenerate: true,
          markers: markersForRegen,
        };
      } else {
        thumbText = thumbText2;
        body = { mode: 'direct', topic, mood, thumbnailText: thumbText, is_regenerate: true };
      }

      const res = await fetch('/api/blog-image-pro', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (res.status === 429) {
        const setErr = currentMode === 'parse' ? setError1 : setError2;
        setErr(data.error);
      } else if (res.ok && data.images?.length > 0) {
        setImages(data.images.map((img, i) => ({
          url: img.url,
          marker: img.marker,
          prompt: img.prompt,
          type: img.type || 'photo',
          model: img.model || 'fluxr',
          reason: img.reason || '',
          index: i,
        })));
        setCurrentThumbnailText(thumbText);
        if (typeof data.remaining === 'number') updateRemaining(data.remaining, data.limit);
      } else {
        const setErr = currentMode === 'parse' ? setError1 : setError2;
        setErr(data.error || '재생성에 실패했습니다.');
      }
    } catch (_) {
      const setErr = currentMode === 'parse' ? setError1 : setError2;
      setErr('서버 오류가 발생했습니다.');
    } finally {
      setRegenAllBusy(false);
      setLoading(false);
    }
  }

  if (authLoading) {
    return (
      <main className={styles.root}>
        <div className={styles.loading}>
          <div className={styles.loadingSpinner} />
          <div className={styles.loadingText}>로딩 중...</div>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className={styles.root}>
        <div className={styles.accessDenied}>
          <h2>회원 전용 도구</h2>
          <p>프리미엄 이미지 생성기는 회원만 사용할 수 있습니다.</p>
          <p style={{ marginTop: 8, fontSize: 13 }}>4/24까지 가입하면 1일 3회 무료 체험 가능</p>
          <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
            <Link
              href="/signup"
              style={{ padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600, background: '#ff5f1f', color: '#fff', textDecoration: 'none' }}
            >
              회원가입
            </Link>
            <Link
              href="/login"
              style={{ padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600, border: '1px solid #E5E7EB', color: '#6B7280', textDecoration: 'none' }}
            >
              로그인
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const remainingText = (() => {
    if (!remainingState) return '남은 횟수 확인 중...';
    if (remainingState.admin) return '관리자 모드 (무제한)';
    if (remainingState.remaining <= 0) return `오늘 무료 체험 ${remainingState.limit}회를 모두 사용했어요. 내일 다시 오세요!`;
    return `오늘 무료 체험 ${remainingState.limit - remainingState.remaining}/${remainingState.limit}회 사용`;
  })();
  const remainingClass = !remainingState
    ? styles.remaining
    : remainingState.admin
      ? `${styles.remaining} ${styles.remainingAdmin}`
      : remainingState.remaining <= 0
        ? `${styles.remaining} ${styles.remainingBlocked}`
        : styles.remaining;
  const overLimit = remainingState && !remainingState.admin && remainingState.remaining <= 0;

  const parseCount = editableMarkers.filter((m) => m.trim() !== '').length;
  const parseBtnLabel = loading
    ? '이미지 생성 중...'
    : overLimit
      ? '사용 한도 초과'
      : parseCount === 0
        ? '이미지 생성하기'
        : `이미지 ${parseCount}장 생성하기`;

  return (
    <main className={styles.root}>
      <div className={styles.hero}>
        <div className={styles.heroBadge}>PREMIUM · 프리미엄 이미지</div>
        <h1>내 블로그에 딱 맞는<br /><em>고퀄리티 이미지 자동 생성</em></h1>
        <p>사진, 차트, 인포그래픽 — AI가 알아서 골라줍니다</p>
      </div>

      <div className={styles.container}>
        <div className={remainingClass}>{remainingText}</div>

        <div className={styles.card} style={{ marginTop: 16 }}>
          <div className={styles.tabGroup}>
            <button
              type="button"
              className={`${styles.tabBtn} ${tab === 'parse' ? styles.tabBtnActive : ''}`}
              onClick={() => setTab('parse')}
            >
              글에서 생성
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${tab === 'direct' ? styles.tabBtnActive : ''}`}
              onClick={() => setTab('direct')}
            >
              직접 입력
            </button>
          </div>

          {tab === 'parse' && (
            <div>
              <div style={{ marginBottom: 12 }}>
                <label className={styles.label}>블로그 글 붙여넣기</label>
                <textarea
                  className={styles.textareaField}
                  placeholder="블로그 글을 붙여넣으세요.&#10;&#10;• (사진: ...) 마커가 있는 글 → 각 위치에 맞는 이미지 자동 생성&#10;• 마커가 없는 글 → AI가 이미지 위치를 추천해드립니다"
                  style={{ minHeight: 200 }}
                  value={blogText}
                  onChange={(e) => setBlogText(e.target.value)}
                />
              </div>

              {blogText.trim().length > 0 && editableMarkers.length === 0 && (
                <div className={styles.suggestMarkersWrap}>
                  <button
                    type="button"
                    className={styles.suggestMarkersBtn}
                    onClick={suggestMarkers}
                    disabled={suggestBusy}
                  >
                    {suggestBusy ? 'AI가 이미지 위치를 분석하고 있습니다...' : '✨ AI 마커 추천'}
                  </button>
                  <div className={styles.suggestMarkersHint}>
                    글에 (사진: ...) 마커가 없으면 AI가 이미지 위치를 추천합니다
                  </div>
                </div>
              )}

              {editableMarkers.length > 0 && (
                <div className={styles.markerPreview}>
                  <div className={styles.markerPreviewTitle}>
                    이미지 마커 {editableMarkers.length}개 (수정/삭제 가능)
                  </div>
                  <div className={styles.markerEditorList}>
                    {editableMarkers.map((mk, i) => (
                      <div key={i} className={styles.markerEditorRow}>
                        <span className={styles.markerEditorNum}>{i + 1}</span>
                        <input
                          type="text"
                          className={styles.markerEditorInput}
                          value={mk}
                          onChange={(e) => updateMarker(i, e.target.value)}
                        />
                        <button
                          type="button"
                          className={styles.markerDeleteBtn}
                          onClick={() => deleteMarker(i)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={styles.markerAddBtn}
                    onClick={addMarker}
                    disabled={editableMarkers.length >= 8}
                  >
                    + 마커 추가
                  </button>
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <label className={styles.label}>
                  썸네일 텍스트 <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(선택, 대표이미지에 합성)</span>
                </label>
                <p style={{ fontSize: 11.5, color: '#9CA3AF', margin: '-2px 0 6px' }}>
                  💡 인테리어·음식 등 비주얼이 중요한 썸네일은 텍스트 없이 이미지만 쓰는 게 더 효과적이에요
                </p>
                <input
                  type="text"
                  className={styles.inputField}
                  placeholder="예: 카페 창업 비용 총정리"
                  maxLength={30}
                  value={thumbText1}
                  onChange={(e) => setThumbText1(e.target.value)}
                />
              </div>

              {error1 && <div className={styles.errorBox}>{error1}</div>}

              <button
                type="button"
                className={styles.generateBtn}
                onClick={generateParse}
                disabled={loading || overLimit || (parseCount === 0 && blogText.trim().length === 0)}
              >
                {parseBtnLabel}
              </button>
            </div>
          )}

          {tab === 'direct' && (
            <div>
              <div style={{ marginBottom: 12 }}>
                <label className={styles.label}>블로그 주제</label>
                <textarea
                  className={styles.textareaField}
                  placeholder="예: 강남 카페 인테리어, 자영업자 브랜딩 전략..."
                  maxLength={200}
                  style={{ minHeight: 80 }}
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                />
                <div className={styles.charCount}>{topic.length}/200</div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className={styles.label}>분위기 / 스타일</label>
                <select
                  className={styles.select}
                  value={mood}
                  onChange={(e) => setMood(e.target.value)}
                >
                  <option value="bright">밝고 깔끔한</option>
                  <option value="warm">따뜻하고 아늑한</option>
                  <option value="professional">전문적인</option>
                  <option value="emotional">감성적인</option>
                </select>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className={styles.label}>
                  썸네일 텍스트 <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(선택, 대표이미지에 합성)</span>
                </label>
                <p style={{ fontSize: 11.5, color: '#9CA3AF', margin: '-2px 0 6px' }}>
                  💡 인테리어·음식 등 비주얼이 중요한 썸네일은 텍스트 없이 이미지만 쓰는 게 더 효과적이에요
                </p>
                <input
                  type="text"
                  className={styles.inputField}
                  placeholder="예: 카페 창업 비용 총정리"
                  maxLength={30}
                  value={thumbText2}
                  onChange={(e) => setThumbText2(e.target.value)}
                />
              </div>

              {error2 && <div className={styles.errorBox}>{error2}</div>}

              <button
                type="button"
                className={styles.generateBtn}
                onClick={generateDirect}
                disabled={loading || overLimit}
              >
                {loading ? '이미지 생성 중...' : overLimit ? '사용 한도 초과' : '이미지 8장 생성하기'}
              </button>
            </div>
          )}
        </div>

        {loading && (
          <div className={styles.loading}>
            <div className={styles.loadingSpinner} />
            <div className={styles.loadingText}>{loadingText}</div>
            <div className={styles.loadingProgress}>{loadingProgress}</div>
          </div>
        )}

        {images.length > 0 && !loading && (
          <div ref={resultRef} className={styles.card}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>생성된 이미지</h2>
            <div className={styles.imageGrid}>
              {images.map((item, i) => (
                <ImageCard
                  key={i}
                  item={item}
                  index={i}
                  thumbnailText={currentThumbnailText}
                  currentMode={currentMode}
                  onRegenerate={regenerateSingle}
                  regenBusy={regenIndex === i}
                />
              ))}
            </div>
            <button
              type="button"
              className={styles.regenAllBtn}
              onClick={regenerateAll}
              disabled={regenAllBusy || loading}
            >
              {regenAllBusy ? '이미지 재생성 중...' : '전체 재생성 (3크레딧)'}
            </button>
            <p className={styles.regenHint}>
              개별 이미지는 &quot;다시 생성&quot; 버튼으로 1장당 1크레딧에 재생성할 수 있습니다.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
