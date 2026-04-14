'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import { ShortformComposition, buildShortformTimeline } from '@/remotion/shortform/ShortformComposition.jsx';
import { PRESETS, PRESET_KEYS, DEFAULT_PRESET_KEY } from '@/remotion/shortform/presets';
import {
  SHORTFORM_FPS,
  SHORTFORM_WIDTH,
  SHORTFORM_HEIGHT,
} from '@/remotion/shortform/styles';
import StepProgress from '@/components/StepProgress';
import Step1Input from './components/Step1Input';
import styles from './page.module.css';

const STEP_LIST = [
  { id: 1, label: '입력' },
  { id: 2, label: '벤치마킹' },
  { id: 3, label: '대본' },
  { id: 4, label: '음성' },
  { id: 5, label: '비주얼' },
  { id: 6, label: '미리보기' },
  { id: 7, label: '다운로드' },
];

// Player는 클라이언트 전용 — dynamic import로 SSR 방지
const Player = dynamic(
  () => import('@remotion/player').then((mod) => mod.Player),
  { ssr: false },
);

const TONES = [
  { id: 'casual', label: '친근' },
  { id: 'professional', label: '전문가' },
];

const DURATIONS = [
  { sec: 30, label: '30초' },
  { sec: 45, label: '45초' },
  { sec: 60, label: '60초' },
  { sec: 90, label: '90초' },
];

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const tk = getToken();
  if (tk) h.Authorization = `Bearer ${tk}`;
  return h;
}

/**
 * 스크립트 API 응답에서 shortform props로 변환
 *
 * script.scenes[] → hook (scene[0]) + body (scene[1..n-2]) + cta (scene[n-1])
 * script.hookText → hook.badge
 */
function scriptToProps(script, presetKey, totalDurationSec, bodyImages) {
  const fps = SHORTFORM_FPS;
  const totalFrames = Math.round(totalDurationSec * fps);

  // 3씬 비율: Hook 20%, Body 60%, CTA 20%
  const hookFrames = Math.round(totalFrames * 0.2);
  const ctaFrames = Math.round(totalFrames * 0.2);
  const bodyFrames = totalFrames - hookFrames - ctaFrames;

  const scenes = Array.isArray(script?.scenes) ? script.scenes : [];
  const hookScene = scenes.find((s) => s.section === 'hook') || scenes[0] || {};
  const pointScenes = scenes.filter((s) => s.section === 'point');
  const ctaScene = scenes.find((s) => s.section === 'cta') || scenes[scenes.length - 1] || {};

  const hookTitle = hookScene.script || script?.hook || '숏폼 영상';
  const hookBadge = hookScene.hookText || script?.hookText || 'STOP';
  const underlineText = hookScene.hookType ? hookScene.hookType.replace('형', '') : '';

  const pointTexts = pointScenes.map((s) => s.script).filter(Boolean);
  const bodyHeader = pointTexts[0] || script?.points?.[0] || '';
  const bodyCaption = pointTexts.slice(1).join(' ') || script?.points?.slice(1).join(' ') || '';

  const ctaText = ctaScene.script || script?.cta || '지금 시작하세요';

  return {
    preset: presetKey,
    hook: {
      badge: hookBadge.slice(0, 12),
      title: hookTitle,
      underlineText: underlineText || undefined,
      imageUrl: bodyImages?.[0] || undefined,
      durationInFrames: hookFrames,
    },
    body: {
      header: bodyHeader,
      caption: bodyCaption,
      imageUrl: bodyImages?.[1] || bodyImages?.[0] || undefined,
      durationInFrames: bodyFrames,
    },
    cta: {
      headline: ctaText,
      buttonText: '지금 시작 →',
      subtext: '뚝딱툴',
      durationInFrames: ctaFrames,
    },
  };
}

function Status({ status, label, meta }) {
  const dotClass =
    status === 'busy' ? styles.statusDotBusy
    : status === 'done' ? styles.statusDotDone
    : status === 'error' ? styles.statusDotError
    : styles.statusDotIdle;
  return (
    <div className={styles.statusRow}>
      <span className={`${styles.statusDot} ${dotClass}`} />
      <span className={styles.statusLabel}>{label}</span>
      {meta && <span className={styles.statusMeta}>{meta}</span>}
    </div>
  );
}

export default function ShortformClient() {
  const router = useRouter();
  const { user } = useAuth();

  // === Step 1 입력 통합 state (Phase A) ===
  const [currentStep, setCurrentStep] = useState(1);
  const [step1Value, setStep1Value] = useState({
    contentMode: 'blog', // 'blog' | 'keyword'
    blogText: '',
    keywords: '',
    userExperience: '',
    persona: '',
    customPersonaLabel: '',
    tone: 'casual',
    durationSec: 45,
  });
  const [completedSteps, setCompletedSteps] = useState([]);

  // 입력 (역호환 레거시 state — runAll/generateScript 등에서 계속 사용)
  const [topic, setTopic] = useState('');
  const [memo, setMemo] = useState('');
  const [tone, setTone] = useState('casual');
  const [presetKey, setPresetKey] = useState(DEFAULT_PRESET_KEY);
  const [totalDurationSec, setTotalDurationSec] = useState(30);

  // 결과
  const [script, setScript] = useState(null);
  const [images, setImages] = useState([]);
  const [audioUrl, setAudioUrl] = useState(null);

  // 상태
  const [scriptStatus, setScriptStatus] = useState('idle');
  const [imageStatus, setImageStatus] = useState('idle');
  const [ttsStatus, setTtsStatus] = useState('idle');
  const [error, setError] = useState('');
  const [ttsVoice, setTtsVoice] = useState('52dc253df44d06aa7f0867'); // Bella (Supertone)

  // blog-writer 핸드오프 (Phase A: step1Value로 매핑)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('blogTextForShortform');
      if (raw) {
        localStorage.removeItem('blogTextForShortform');
        const data = JSON.parse(raw);
        // 새 step1Value 기준으로 반영
        setStep1Value((prev) => ({
          ...prev,
          contentMode: 'blog',
          blogText: data.blogText || data.topic || '',
          userExperience: data.memo || prev.userExperience,
        }));
        // 역호환 레거시 state도 유지
        if (data.topic) setTopic(data.topic);
        if (data.memo) setMemo(data.memo);
      }
    } catch (_) {}
  }, []);

  // Step 1 → 2 이동: step1Value를 레거시 state로 매핑하여 역호환 유지
  function handleStep1Next() {
    setTopic(step1Value.contentMode === 'keyword' ? step1Value.keywords : (step1Value.blogText.slice(0, 100) || ''));
    setMemo(step1Value.userExperience);
    setTone(step1Value.tone === 'casual' ? 'casual' : 'professional');
    setTotalDurationSec(step1Value.durationSec);

    setCompletedSteps((prev) => Array.from(new Set([...prev, 1])));
    setCurrentStep(2);
  }

  function handleStepClick(stepNum) {
    setCurrentStep(stepNum);
  }

  // 미리보기 props + duration 계산
  const playerProps = useMemo(() => {
    if (!script) return null;
    return scriptToProps(script, presetKey, totalDurationSec, images);
  }, [script, presetKey, totalDurationSec, images]);

  const playerDurationInFrames = useMemo(() => {
    if (!playerProps) return totalDurationSec * SHORTFORM_FPS;
    const { durationInFrames } = buildShortformTimeline(playerProps);
    return durationInFrames;
  }, [playerProps, totalDurationSec]);

  const audioInputProps = useMemo(() => {
    if (!playerProps) return null;
    return {
      ...playerProps,
      audio: audioUrl ? { url: audioUrl, durationInFrames: playerDurationInFrames } : undefined,
    };
  }, [playerProps, audioUrl, playerDurationInFrames]);

  async function generateScript() {
    setError('');
    if (!topic.trim() && !memo.trim()) {
      setError('주제 또는 메모를 입력해주세요.');
      return;
    }
    const token = getToken();
    if (!token) {
      alert('로그인이 필요합니다.');
      router.push('/login');
      return;
    }

    setScriptStatus('busy');
    setScript(null);
    try {
      const res = await fetch('/api/shortform-script', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          topic,
          blogText: '',
          personaMemo: memo,
          tone,
          targetDurationSec: totalDurationSec,
          concept: 'cinematic',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '대본 생성 실패');
      setScript(data.script);
      setScriptStatus('done');
    } catch (err) {
      setError(err.message || '대본 생성 중 오류');
      setScriptStatus('error');
    }
  }

  async function generateImages() {
    setError('');
    if (!topic.trim()) {
      setError('주제를 입력해주세요.');
      return;
    }
    setImageStatus('busy');
    setImages([]);
    try {
      const res = await fetch('/api/blog-image-pro', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          mode: 'direct',
          topic,
          mood: 'emotional',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '이미지 생성 실패');
      // direct 모드는 8장 반환 — 처음 2장만 사용
      const imgs = (data.images || []).slice(0, 2).map((img) => img.r2Url || img.url).filter(Boolean);
      setImages(imgs);
      setImageStatus('done');
    } catch (err) {
      setError(err.message || '이미지 생성 중 오류');
      setImageStatus('error');
    }
  }

  async function generateTts() {
    setError('');
    if (!script) {
      setError('먼저 대본을 생성해주세요.');
      return;
    }
    setTtsStatus('busy');
    setAudioUrl(null);
    try {
      // 전체 대본을 한 번에 TTS
      const text = script.fullScript || (script.scenes || []).map((s) => s.script).join(' ');
      const res = await fetch('/api/shortform-tts', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ text, voiceId: ttsVoice }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'TTS 생성 실패');
      }
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('audio/')) {
        // Supertone/Google: 바이너리
        const blob = await res.blob();
        setAudioUrl(URL.createObjectURL(blob));
      } else {
        // ElevenLabs: JSON { audioBase64 }
        const data = await res.json();
        const binary = atob(data.audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'audio/mpeg' });
        setAudioUrl(URL.createObjectURL(blob));
      }
      setTtsStatus('done');
    } catch (err) {
      setError(err.message || 'TTS 중 오류');
      setTtsStatus('error');
    }
  }

  async function runAll() {
    await generateScript();
    // 순차 실행 (한 번에 하나씩)
    await generateImages();
    await generateTts();
  }

  const hasPreview = !!audioInputProps;

  return (
    <main className={styles.root}>
      <div className={styles.hero}>
        <div className={styles.heroBadge}>NEW · 숏폼</div>
        <h1>릴스·쇼츠를<br /><em>5분 만에 뚝딱</em></h1>
        <p>주제만 입력하면 AI 대본 + Ken Burns 이미지 + TTS로<br />프리미엄 숏폼 영상을 자동 생성합니다</p>
      </div>

      {/* Phase A: StepProgress 표시 */}
      <div className={styles.stepProgressWrap}>
        <StepProgress
          steps={STEP_LIST}
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={handleStepClick}
        />
      </div>

      {/* Step 1: 새 입력 폼 */}
      {currentStep === 1 && (
        <div className={styles.stepContainer}>
          <Step1Input
            value={step1Value}
            onChange={setStep1Value}
            onNext={handleStep1Next}
          />
        </div>
      )}

      {/* Step 2~7: 기존 UI를 임시 유지 (Phase B/C에서 단계별 교체) */}
      {currentStep >= 2 && (
      <div className={styles.layout}>
        <div className={styles.left}>
          <div className={styles.card}>
            <div className={styles.cardLabel}>입력</div>
            <div style={{ marginBottom: 12 }}>
              <label className={styles.label}>주제 / 소재</label>
              <input
                type="text"
                className={styles.inputField}
                placeholder="예: 카페 창업 비용, 웨딩 플래너 19년차 노하우"
                maxLength={100}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className={styles.label}>내 경험·느낌 <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(선택)</span></label>
              <textarea
                className={styles.textareaField}
                placeholder="짧게 적어도 됩니다. 예: 15년차 헤어 디자이너, 손님이 '여기 물 맛있다'고 했을 때 뿌듯했음"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label className={styles.label}>영상 길이</label>
              <div className={styles.durationBtns}>
                {DURATIONS.map((d) => (
                  <button
                    key={d.sec}
                    type="button"
                    className={`${styles.durationBtn} ${totalDurationSec === d.sec ? styles.durationBtnActive : ''}`}
                    onClick={() => setTotalDurationSec(d.sec)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label className={styles.label}>톤</label>
              <div className={styles.toneBtns}>
                {TONES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`${styles.toneBtn} ${tone === t.id ? styles.toneBtnActive : ''}`}
                    onClick={() => setTone(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={styles.label}>디자인 프리셋</label>
              <div className={styles.presetGrid}>
                {PRESET_KEYS.map((key) => {
                  const preset = PRESETS[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`${styles.presetChip} ${presetKey === key ? styles.presetChipActive : ''}`}
                      onClick={() => setPresetKey(key)}
                    >
                      <span
                        className={styles.presetPreview}
                        style={{
                          background: `linear-gradient(135deg, ${preset.colors.bgBase} 0%, ${preset.colors.bgSecondary} 50%, ${preset.colors.bgTertiary} 100%)`,
                          borderBottom: `3px solid ${preset.colors.accent}`,
                        }}
                      />
                      {preset.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardLabel}>생성 단계</div>
            <div className={styles.statusList}>
              <Status
                status={scriptStatus}
                label="1. Opus 4.6 대본"
                meta={script ? `${script.scenes?.length || 0}씬` : ''}
              />
              <Status
                status={imageStatus}
                label="2. Ken Burns 이미지 × 2"
                meta={images.length > 0 ? `${images.length}장` : ''}
              />
              <Status
                status={ttsStatus}
                label="3. TTS 음성 (Supertone)"
                meta={audioUrl ? '생성됨' : ''}
              />
            </div>

            {error && <div className={styles.errorBox}>{error}</div>}

            <button type="button" className={styles.secondaryBtn} onClick={generateScript} disabled={scriptStatus === 'busy'} style={{ marginTop: 12 }}>
              1단계만 (대본)
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={generateImages} disabled={imageStatus === 'busy'}>
              2단계만 (이미지)
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={generateTts} disabled={ttsStatus === 'busy' || !script}>
              3단계만 (TTS)
            </button>
          </div>

          {script && (
            <div className={styles.card}>
              <div className={styles.cardLabel}>생성된 대본</div>
              <div className={styles.scriptPreview}>
                {Array.isArray(script.scenes) && script.scenes.map((s, i) => (
                  <div key={i}>
                    <h5>Scene {i + 1} ({s.section || 'point'})</h5>
                    <p>{s.script}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {images.length > 0 && (
            <div className={styles.card}>
              <div className={styles.cardLabel}>생성된 이미지</div>
              <div className={styles.imagePicker}>
                {images.map((url, i) => (
                  <div key={i} className={`${styles.imageThumb} ${styles.imageThumbActive}`}>
                    <img src={url} alt={`image-${i}`} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={styles.right}>
          <div className={styles.card}>
            <div className={styles.cardLabel}>미리보기</div>
            <div className={styles.playerWrap}>
              {hasPreview ? (
                <Player
                  component={ShortformComposition}
                  inputProps={audioInputProps}
                  durationInFrames={playerDurationInFrames}
                  fps={SHORTFORM_FPS}
                  compositionWidth={SHORTFORM_WIDTH}
                  compositionHeight={SHORTFORM_HEIGHT}
                  style={{ width: '100%', height: '100%' }}
                  controls
                  loop
                />
              ) : (
                <div className={styles.playerPlaceholder}>
                  좌측에서<br />대본을 생성하면<br />미리보기가 표시됩니다
                </div>
              )}
            </div>
          </div>

          {hasPreview && (
            <div className={styles.card}>
              <div className={styles.cardLabel}>MP4 내보내기</div>
              <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 8 }}>
                서버 렌더는 다음 릴리즈에 추가됩니다. 현재는 브라우저 미리보기만 제공합니다.
              </p>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Phase A: '전체 자동 생성' 보조 버튼 (페이지 맨 아래) */}
      {currentStep < 7 && (
        <div className={styles.skipFooter}>
          <button
            type="button"
            className={styles.skipBtn}
            onClick={runAll}
            disabled={scriptStatus === 'busy' || imageStatus === 'busy' || ttsStatus === 'busy'}
          >
            {scriptStatus === 'busy' || imageStatus === 'busy' || ttsStatus === 'busy'
              ? '생성 중...'
              : '한 번에 자동 생성 (벤치마킹·세부조정 없이 빠른 모드)'}
          </button>
          <p className={styles.skipHint}>
            바쁘시면 단계별 진행 없이 한 번에 영상을 만들 수 있어요. 다만 결과 품질은 단계 진행보다 낮습니다.
          </p>
        </div>
      )}
    </main>
  );
}
