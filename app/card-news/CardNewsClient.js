'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import { useJobProgress } from '@/app/shortform/hooks/useJobProgress';
import ImagePickerModal from '@/components/ImagePickerModal';
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

  // Variant 선택 — 'auto'면 서버가 랜덤, 아니면 명시적 값
  const [typeScale, setTypeScale] = useState('auto');
  const [accentPlacement, setAccentPlacement] = useState('auto');
  const [numberStyle, setNumberStyle] = useState('auto');

  // 생성 모드: 'basic'(Satori, 1크레딧, ~30초) | 'premium'(Chromium, 2크레딧, ~3분)
  const [mode, setMode] = useState('basic');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [images, setImages] = useState([]);
  // Chromium path: R2 CDN URL 배열 (Satori path의 images는 base64라 분리)
  const [imageUrls, setImageUrls] = useState([]);
  const [chromiumJobId, setChromiumJobId] = useState(null);
  const [modalIdx, setModalIdx] = useState(null);
  const [zipBusy, setZipBusy] = useState(false);
  const [variantInfo, setVariantInfo] = useState(null);

  // 사용자 이미지 선택 상태
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCardIdx, setPickerCardIdx] = useState(null);
  // userImages: [{ cardIndex, mode, url, crop }]
  const [userImages, setUserImages] = useState([]);

  const gridRef = useRef(null);

  // Chromium path SSE 구독
  const {
    status: chromiumStatus,
    result: chromiumResult,
    error: chromiumError,
    reset: resetChromium,
  } = useJobProgress(chromiumJobId, { authToken: typeof window !== 'undefined' ? getToken() : null });

  // Chromium 결과 브리지: SSE 이벤트 → imageUrls/error 상태로 연결
  useEffect(() => {
    if (!chromiumJobId) return;
    if (chromiumStatus === 'complete' && chromiumResult?.urls) {
      setImageUrls(chromiumResult.urls);
      setLoading(false);
    } else if (chromiumStatus === 'error') {
      setError(chromiumError || '카드뉴스 생성에 실패했습니다. 크레딧은 환불되었습니다.');
      setLoading(false);
    }
  }, [chromiumJobId, chromiumStatus, chromiumResult, chromiumError]);

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
    if ((images.length > 0 || imageUrls.length > 0) && gridRef.current) {
      setTimeout(() => gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [images, imageUrls]);

  useEffect(() => {
    if (modalIdx === null) return;
    const totalSlides = imageUrls.length > 0 ? imageUrls.length : images.length;
    function onKey(e) {
      if (e.key === 'Escape') setModalIdx(null);
      if (e.key === 'ArrowLeft') setModalIdx((i) => (i === null ? null : (i - 1 + totalSlides) % totalSlides));
      if (e.key === 'ArrowRight') setModalIdx((i) => (i === null ? null : (i + 1) % totalSlides));
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [modalIdx, images.length, imageUrls.length]);

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
    setImageUrls([]);      // Chromium path 결과 리셋
    resetChromium();
    setChromiumJobId(null);

    const isValidHex = (c) => /^#[0-9a-fA-F]{6}$/.test(c);
    const bp = useBrand && isValidHex(brandPrimary) ? brandPrimary : undefined;
    const bs = useBrand && isValidHex(brandSecondary) ? brandSecondary : undefined;

    // Chromium path: loading 해제를 SSE 이벤트에 위임 → finally에서 setLoading(false) 스킵
    let isChromiumPath = false;

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
          mode,
          brandPrimary: bp,
          brandSecondary: bs,
          snsHandle: snsHandle.trim() || undefined,
          // Variant 선택 — 'auto'면 생략 (서버가 랜덤)
          typeScale: typeScale !== 'auto' ? typeScale : undefined,
          accentPlacement: accentPlacement !== 'auto' ? accentPlacement : undefined,
          numberStyle: numberStyle !== 'auto' ? numberStyle : undefined,
          userImages: userImages.filter((u) => u.cardIndex < slideCount),
        }),
      });

      // 202 = Chromium path (async, SSE로 결과 수신)
      if (res.status === 202) {
        isChromiumPath = true;
        const { jobId } = await res.json();
        // 기존 Chromium job 있으면 reset 후 새 구독
        resetChromium();
        setImageUrls([]);
        setChromiumJobId(jobId);
        // setLoading(true) 유지 — complete/error 이벤트 수신 시 false로 전환
        return;
      }

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

      // 200 = Satori path (동기, base64)
      const result = await res.json();
      setImages(result.images || []);
      if (result.variant) setVariantInfo(result.variant);
    } catch (e) {
      setError(e.message);
    } finally {
      // Chromium path: loading은 SSE complete/error 이벤트에서 해제
      if (!isChromiumPath) {
        setLoading(false);
      }
    }
  }

  function downloadSingleSlide(index) {
    // Chromium path 우선 (URL)
    if (imageUrls[index]) {
      const link = document.createElement('a');
      link.href = imageUrls[index];
      link.download = `card-news-${index + 1}.png`;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }
    // Satori path fallback (base64)
    if (images[index]) {
      const link = document.createElement('a');
      link.href = `data:image/png;base64,${images[index]}`;
      link.download = `card-news-${index + 1}.png`;
      link.click();
    }
  }

  async function downloadAll() {
    const hasUrls = imageUrls.length > 0;
    const hasBase64 = images.length > 0;
    if (!hasUrls && !hasBase64) return;

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

      if (hasUrls) {
        // Chromium: URL → fetch → blob → zip
        for (let i = 0; i < imageUrls.length; i++) {
          const response = await fetch(imageUrls[i]);
          const blob = await response.blob();
          zip.file(`card-news-${i + 1}.png`, blob);
        }
      } else {
        // Satori: base64 직접
        images.forEach((b64, i) => {
          zip.file(`card-news-${i + 1}.png`, b64, { base64: true });
        });
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `card-news-${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('[card-news] downloadAll failed:', err);
      alert('다운로드 중 오류가 발생했습니다.');
    } finally {
      setZipBusy(false);
    }
  }

  function navModal(dir) {
    const totalSlides = imageUrls.length > 0 ? imageUrls.length : images.length;
    setModalIdx((i) => (i === null ? null : (i + dir + totalSlides) % totalSlides));
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

          {/* ═════ Variant 선택 — 디자인 다양성 ═════ */}
          <span className={styles.optionLabel}>타이포 스케일</span>
          <div className={styles.slideBtns} style={{ flexWrap: 'wrap' }}>
            {[
              { id: 'auto', label: '자동' },
              { id: 'compact', label: '컴팩트' },
              { id: 'normal', label: '기본' },
              { id: 'impact', label: '임팩트' },
              { id: 'asymmetric', label: '비대칭' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`${styles.slideBtn} ${typeScale === opt.id ? styles.slideBtnActive : ''}`}
                onClick={() => setTypeScale(opt.id)}
                style={{ width: 'auto', padding: '10px 16px' }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <span className={styles.optionLabel}>액센트 배치</span>
          <div className={styles.slideBtns} style={{ flexWrap: 'wrap' }}>
            {[
              { id: 'auto', label: '자동' },
              { id: 'left-bar', label: '좌측 바' },
              { id: 'top-bar', label: '상단 바' },
              { id: 'corner-mark', label: 'L자 마커' },
              { id: 'dot-cluster', label: '점 클러스터' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`${styles.slideBtn} ${accentPlacement === opt.id ? styles.slideBtnActive : ''}`}
                onClick={() => setAccentPlacement(opt.id)}
                style={{ width: 'auto', padding: '10px 16px' }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <span className={styles.optionLabel}>번호 스타일</span>
          <div className={styles.slideBtns} style={{ flexWrap: 'wrap' }}>
            {[
              { id: 'auto', label: '자동' },
              { id: 'circle-badge', label: '원형 배지' },
              { id: 'big-serif', label: '큰 세리프' },
              { id: 'underline', label: '밑줄' },
              { id: 'corner-tag', label: '코너 태그' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`${styles.slideBtn} ${numberStyle === opt.id ? styles.slideBtnActive : ''}`}
                onClick={() => setNumberStyle(opt.id)}
                style={{ width: 'auto', padding: '10px 16px' }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ds-muted, #77736B)', marginTop: 4, marginBottom: 4 }}>
            💡 모두 "자동"으로 두면 매번 다른 디자인 조합. 특정 스타일 원하면 직접 선택.
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

          {/* 생성 모드 선택 */}
          <div className={styles.modeSelector}>
            <button
              type="button"
              className={`${styles.modeCard} ${mode === 'basic' ? styles.modeCardActive : ''}`}
              onClick={() => setMode('basic')}
              disabled={loading}
            >
              <div className={styles.modeHeader}>
                <span className={styles.modeTitle}>기본</span>
                <span className={styles.modeBadge}>1크레딧 · 30초</span>
              </div>
              <div className={styles.modeDesc}>14가지 테마 기반</div>
            </button>
            <button
              type="button"
              className={`${styles.modeCard} ${mode === 'premium' ? styles.modeCardActive : ''}`}
              onClick={() => setMode('premium')}
              disabled={loading}
            >
              <div className={styles.modeHeader}>
                <span className={styles.modeTitle}>프리미엄</span>
                <span className={`${styles.modeBadge} ${styles.modeBadgePremium}`}>2크레딧 · 3분</span>
              </div>
              <div className={styles.modeDesc}>AI가 매번 새로 디자인</div>
            </button>
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
            {mode === 'premium' ? (
              <>
                <div className={styles.loadingText}>AI가 카드를 한 장씩 디자인하는 중...</div>
                <small style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>프리미엄은 최대 3분 정도 걸려요</small>
              </>
            ) : (
              <>
                <div className={styles.loadingText}>카드뉴스를 만들고 있어요</div>
                <small style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>약 30초 소요</small>
              </>
            )}
          </div>
        )}

        {(images.length > 0 || imageUrls.length > 0) && (
          <div ref={gridRef}>
            {userImages.length > 0 && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: '14px 18px',
                marginBottom: 12,
                background: 'rgba(255, 95, 31, 0.08)',
                border: '1.5px solid var(--ds-accent, #F95A1F)',
                borderRadius: 12,
                fontSize: 13,
                color: 'var(--ds-text, #1F2937)',
              }}>
                <div style={{ fontWeight: 700 }}>
                  🖼 <strong>{userImages.length}개</strong> 카드에 내 이미지 선택됨 — 아래 버튼을 눌러야 카드에 실제로 반영돼요
                </div>
                <div style={{
                  fontSize: 12,
                  color: '#B45309',
                  background: 'rgba(255, 193, 7, 0.12)',
                  padding: '8px 12px',
                  borderRadius: 8,
                  lineHeight: 1.6,
                }}>
                  ⚠️ <strong>주의:</strong> 재생성 1회당 1크레딧이 차감돼요.<br />
                  여러 카드에 이미지 넣을 거면 <strong>모든 카드에 다 선택한 후 한 번만</strong> 재생성 눌러주세요.
                </div>
                <button
                  type="button"
                  onClick={generate}
                  disabled={loading}
                  style={{
                    padding: '12px 20px',
                    background: 'var(--ds-accent, #F95A1F)',
                    border: 'none',
                    color: '#fff',
                    borderRadius: 8,
                    fontWeight: 800,
                    fontSize: 14,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    alignSelf: 'stretch',
                  }}
                >
                  🖼 내 이미지 반영해서 재생성 (1크레딧)
                </button>
              </div>
            )}
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
                  🎲 다른 디자인으로 재생성 (1크레딧)
                </button>
              </div>
            )}
            <div className={styles.previewGrid}>
              {(imageUrls.length > 0 ? imageUrls : images).map((item, i) => {
                const src = imageUrls.length > 0 ? item : `data:image/png;base64,${item}`;
                const hasUserImg = userImages.some((u) => u.cardIndex === i);
                return (
                  <div
                    key={i}
                    className={styles.previewItem}
                    onClick={() => setModalIdx(i)}
                  >
                    <img src={src} alt={`슬라이드 ${i + 1}`} />
                    <span className={styles.previewNum}>{i + 1}</span>
                    {hasUserImg && <span className={styles.previewUserImg}>내 사진</span>}
                    <button
                      type="button"
                      className={styles.previewPhotoBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPickerCardIdx(i);
                        setPickerOpen(true);
                      }}
                      aria-label="사진 넣기"
                    >📷</button>
                    <button
                      type="button"
                      className={styles.previewDl}
                      onClick={(e) => { e.stopPropagation(); downloadSingleSlide(i); }}
                    >
                      저장
                    </button>
                  </div>
                );
              })}
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
            <img
              src={imageUrls.length > 0
                ? imageUrls[modalIdx]
                : `data:image/png;base64,${images[modalIdx]}`}
              alt="미리보기"
            />
            <div className={styles.modalCounter}>
              {modalIdx + 1} / {imageUrls.length > 0 ? imageUrls.length : images.length}
            </div>
          </div>
        </div>
      )}

      <ImagePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        modeOptions={['background', 'content', 'cover']}
        defaultMode="content"
        aspectRatio={4 / 5}
        onSelect={({ image, crop, mode }) => {
          setUserImages((prev) => {
            const filtered = prev.filter((u) => u.cardIndex !== pickerCardIdx);
            return [
              ...filtered,
              { cardIndex: pickerCardIdx, mode, url: image.public_url, crop },
            ];
          });
        }}
      />
    </main>
  );
}
