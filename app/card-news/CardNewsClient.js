'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import styles from './page.module.css';

const SLIDE_COUNTS = [5, 6, 7, 8, 9, 10];

export default function CardNewsClient() {
  const router = useRouter();
  const { user } = useAuth();

  const [textInput, setTextInput] = useState('');
  const [slideCount, setSlideCount] = useState(7);
  const [themes, setThemes] = useState({});
  const [selectedTheme, setSelectedTheme] = useState('charcoal');
  const [useBrand, setUseBrand] = useState(false);
  const [brandPrimary, setBrandPrimary] = useState('#ff5f1f');
  const [brandSecondary, setBrandSecondary] = useState('#1A1A2E');
  const [snsHandle, setSnsHandle] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [images, setImages] = useState([]);
  const [modalIdx, setModalIdx] = useState(null);
  const [zipBusy, setZipBusy] = useState(false);
  const [variantInfo, setVariantInfo] = useState(null);

  const gridRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/card-news-themes', { cache: 'no-store' });
        if (!res.ok) throw new Error('theme fetch failed');
        const data = await res.json();
        const themesData = data.themes || {};
        setThemes(themesData);
        const keys = Object.keys(themesData);
        if (keys.length > 0 && !themesData[selectedTheme]) setSelectedTheme(keys[0]);
      } catch (_) {}
    })();
  }, []);

  useEffect(() => {
    // localStorage handoff from blog-writer
    try {
      const handoff = localStorage.getItem('blogTextForCardNews');
      if (handoff) {
        setTextInput(handoff);
        localStorage.removeItem('blogTextForCardNews');
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (images.length > 0 && gridRef.current) {
      setTimeout(() => gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [images]);

  useEffect(() => {
    if (modalIdx === null) return;
    function onKey(e) {
      if (e.key === 'Escape') setModalIdx(null);
      if (e.key === 'ArrowLeft') setModalIdx((i) => (i === null ? null : (i - 1 + images.length) % images.length));
      if (e.key === 'ArrowRight') setModalIdx((i) => (i === null ? null : (i + 1) % images.length));
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [modalIdx, images.length]);

  async function generate() {
    if (!textInput.trim()) {
      setError('텍스트를 입력해주세요.');
      return;
    }
    setError('');

    const token = getToken();
    if (!token) {
      alert('로그인이 필요합니다. 회원가입 후 이용해주세요.');
      router.push('/login');
      return;
    }

    setLoading(true);
    setImages([]);

    const isValidHex = (c) => /^#[0-9a-fA-F]{6}$/.test(c);
    const bp = useBrand && isValidHex(brandPrimary) ? brandPrimary : undefined;
    const bs = useBrand && isValidHex(brandSecondary) ? brandSecondary : undefined;

    try {
      const res = await fetch('/api/card-news', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: textInput,
          slideCount,
          theme: selectedTheme,
          brandPrimary: bp,
          brandSecondary: bs,
          snsHandle: snsHandle.trim() || undefined,
        }),
      });

      if (!res.ok) {
        let errData = {};
        try { errData = await res.json(); } catch (_) {}
        if (res.status === 401) {
          alert('로그인이 필요합니다.');
          router.push('/login');
          return;
        }
        throw new Error(errData.error || `카드뉴스 생성에 실패했습니다. (${res.status})`);
      }

      const result = await res.json();
      setImages(result.images || []);
      if (result.variant) setVariantInfo(result.variant);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function downloadSingleSlide(index) {
    if (!images[index]) return;
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${images[index]}`;
    link.download = `card-news-${index + 1}.png`;
    link.click();
  }

  async function downloadAll() {
    if (images.length === 0) return;
    setZipBusy(true);
    try {
      // 동적 로드: JSZip CDN
      if (typeof window.JSZip === 'undefined') {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/jszip@3/dist/jszip.min.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const zip = new window.JSZip();
      images.forEach((b64, i) => {
        zip.file(`card-news-${i + 1}.png`, b64, { base64: true });
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'card-news.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('ZIP 생성 실패: ' + e.message);
    } finally {
      setZipBusy(false);
    }
  }

  function navModal(dir) {
    setModalIdx((i) => (i === null ? null : (i + dir + images.length) % images.length));
  }

  return (
    <main className={styles.root}>
      <div className={styles.hero}>
        <div className={styles.heroBadge}>PRO · 카드뉴스</div>
        <h1><em>카드뉴스</em> 제작기</h1>
        <p>
          글을 붙여넣으면<br />
          AI가 인스타용 카드뉴스를<br />
          자동으로 만들어드립니다
        </p>
      </div>

      <div className={styles.container}>
        {!user && (
          <div className={styles.signupBanner}>
            회원가입하면 무료 체험 가능! <a href="/signup">가입하기</a>
          </div>
        )}

        <div className={styles.card}>
          <div style={{ marginBottom: 20 }}>
            <label className={styles.label}>텍스트 입력</label>
            <textarea
              className={styles.textareaField}
              placeholder="블로그 글이나 텍스트를 붙여넣으세요..."
              style={{ minHeight: 200 }}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
            />
          </div>

          <span className={styles.optionLabel}>슬라이드 수</span>
          <div className={styles.slideBtns}>
            {SLIDE_COUNTS.map((count) => (
              <button
                key={count}
                type="button"
                className={`${styles.slideBtn} ${slideCount === count ? styles.slideBtnActive : ''}`}
                onClick={() => setSlideCount(count)}
              >
                {count}
              </button>
            ))}
          </div>

          <span className={styles.optionLabel}>테마</span>
          <div className={styles.themeScroll}>
            {Object.keys(themes).length === 0 ? (
              <div style={{ padding: '8px 4px', fontSize: 12, color: '#9CA3AF' }}>테마 불러오는 중...</div>
            ) : (
              Object.keys(themes).map((key) => {
                const t = themes[key];
                const active = key === selectedTheme;
                return (
                  <div
                    key={key}
                    className={`${styles.themeChip} ${active ? styles.themeChipActive : ''}`}
                    onClick={() => setSelectedTheme(key)}
                  >
                    <div className={styles.themeColors}>
                      {(t.colors || []).map((c, i) => (
                        <span key={i} className={styles.themeDot} style={{ background: c }} />
                      ))}
                    </div>
                    <span className={styles.themeName}>{t.name}</span>
                  </div>
                );
              })
            )}
          </div>

          <div className={styles.brandToggleRow}>
            <label className={styles.brandToggleLabel}>
              <input
                type="checkbox"
                checked={useBrand}
                onChange={(e) => setUseBrand(e.target.checked)}
              />
              내 브랜드 컬러 사용
            </label>
          </div>
          {useBrand && (
            <div className={styles.brandRow}>
              <div className={styles.brandPair}>
                <span className={styles.brandLabel}>메인</span>
                <input
                  type="color"
                  className={styles.brandColorInput}
                  value={brandPrimary}
                  onChange={(e) => setBrandPrimary(e.target.value)}
                />
                <input
                  type="text"
                  className={styles.brandHex}
                  maxLength={7}
                  value={brandPrimary}
                  onChange={(e) => setBrandPrimary(e.target.value)}
                />
              </div>
              <div className={styles.brandPair}>
                <span className={styles.brandLabel}>보조</span>
                <input
                  type="color"
                  className={styles.brandColorInput}
                  value={brandSecondary}
                  onChange={(e) => setBrandSecondary(e.target.value)}
                />
                <input
                  type="text"
                  className={styles.brandHex}
                  maxLength={7}
                  value={brandSecondary}
                  onChange={(e) => setBrandSecondary(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className={styles.brandRow}>
            <div className={styles.brandPair}>
              <span className={styles.brandLabel}>SNS 아이디</span>
              <input
                type="text"
                className={styles.brandHex}
                placeholder="@myaccount"
                maxLength={30}
                style={{ width: 160 }}
                value={snsHandle}
                onChange={(e) => setSnsHandle(e.target.value)}
              />
            </div>
            <span style={{ fontSize: 11, color: '#9CA3AF', display: 'flex', alignItems: 'center', marginLeft: 8 }}>
              표지·마지막 장에 표시
            </span>
          </div>

          {error && <div className={styles.errorBox}>{error}</div>}

          <button
            type="button"
            className={styles.generateBtn}
            onClick={generate}
            disabled={loading}
          >
            {loading ? '생성 중...' : '카드뉴스 생성하기'}
          </button>
        </div>

        {loading && (
          <div className={styles.loading}>
            <div className={styles.loadingSpinner} />
            <div className={styles.loadingText}>AI가 카드뉴스를 만들고 있습니다...</div>
          </div>
        )}

        {images.length > 0 && (
          <div ref={gridRef}>
            {variantInfo && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '12px 16px',
                marginBottom: 12,
                background: 'var(--ds-bg-soft, #F4F2EC)',
                border: '1px solid var(--ds-border, #ECE9E2)',
                borderRadius: 10,
                fontSize: 12,
                color: 'var(--ds-muted, #77736B)',
                flexWrap: 'wrap',
              }}>
                <span>
                  디자인 variant — 스케일: <strong>{variantInfo.typeScale}</strong> · 액센트: <strong>{variantInfo.accentPlacement}</strong> · 번호: <strong>{variantInfo.numberStyle}</strong>
                  <span style={{ opacity: 0.6, marginLeft: 8 }}>(seed {variantInfo.seed})</span>
                </span>
                <button
                  type="button"
                  onClick={generate}
                  disabled={loading}
                  style={{
                    padding: '8px 16px',
                    background: 'var(--ds-card, #fff)',
                    border: '1.5px solid var(--ds-accent, #F95A1F)',
                    color: 'var(--ds-accent, #F95A1F)',
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  🎲 다른 디자인으로 재생성
                </button>
              </div>
            )}
            <div className={styles.previewGrid}>
              {images.map((base64, i) => (
                <div
                  key={i}
                  className={styles.previewItem}
                  onClick={() => setModalIdx(i)}
                >
                  <img src={`data:image/png;base64,${base64}`} alt={`슬라이드 ${i + 1}`} />
                  <span className={styles.previewNum}>{i + 1}</span>
                  <button
                    type="button"
                    className={styles.previewDl}
                    onClick={(e) => { e.stopPropagation(); downloadSingleSlide(i); }}
                  >
                    저장
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className={styles.downloadAllBtn}
              onClick={downloadAll}
              disabled={zipBusy}
            >
              {zipBusy ? 'ZIP 생성 중...' : '전체 다운로드 (ZIP)'}
            </button>
          </div>
        )}
      </div>

      {modalIdx !== null && (
        <div
          className={styles.modalOverlay}
          onClick={(e) => { if (e.target === e.currentTarget) setModalIdx(null); }}
        >
          <div className={styles.modalContent}>
            <button type="button" className={styles.modalClose} onClick={() => setModalIdx(null)}>×</button>
            <button type="button" className={`${styles.modalNav} ${styles.modalPrev}`} onClick={() => navModal(-1)}>‹</button>
            <button type="button" className={`${styles.modalNav} ${styles.modalNext}`} onClick={() => navModal(1)}>›</button>
            <img src={`data:image/png;base64,${images[modalIdx]}`} alt="미리보기" />
            <div className={styles.modalCounter}>{modalIdx + 1} / {images.length}</div>
          </div>
        </div>
      )}
    </main>
  );
}
