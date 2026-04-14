'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
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
import ProgressIndicator from '@/components/ProgressIndicator';
import Step1Input from './components/Step1Input';
import Step5VisualAccent from './components/Step5VisualAccent';
import Step6Preview from './components/Step6Preview';
import {
  buildStep6ValueFromPreset,
  DEFAULT_SHORTFORM_PRESET,
  getShortformPreset,
} from '@/lib/shortform-presets';
import useProjectAutoSave from './hooks/useProjectAutoSave';
// Phase I — SSE 진행 표시 + 취소 + 백그라운드 모드
import { useJobProgress } from './hooks/useJobProgress';
// Phase K — 온보딩 위저드
import OnboardingModal from './components/OnboardingModal';
import { getSample, sampleToStep1Value } from '@/lib/shortform-samples';
import styles from './page.module.css';

const PROGRESS_ACTIVE_STEPS = [
  'keyword-extraction',
  'youtube-search',
  'video-analysis',
  'script-generation',
  'tts-synthesis',
  'video-render',
];

const SHORTFORM_JOB_STORAGE_KEY = 'shortform:activeJobId';

function generateClientJobId() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

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
 * Step 5 값 → 이미지 URL 배열로 병합
 * 우선순위: 사용자 사진 → AI 이미지
 * hook.imageUrl/body.imageUrl은 최대 2장까지 사용됨.
 */
function mergeShortformImages(step5) {
  if (!step5) return [];
  const userUrls = (step5.userPhotos || [])
    .map((p) => p?.image?.public_url)
    .filter(Boolean);
  const aiUrls = step5.aiImages || [];
  return [...userUrls, ...aiUrls];
}

/**
 * 스크립트 API 응답에서 shortform props로 변환
 *
 * script.scenes[] → hook (scene[0]) + body (scene[1..n-2]) + cta (scene[n-1])
 * script.hookText → hook.badge
 *
 * sceneImageOrder (Phase F): [{ sceneId: 'hook'|'body', imageUrl }] 형태로
 * 사용자가 지정한 씬별 이미지 우선 적용. 없으면 bodyImages 배열 순서대로 폴백.
 */
function scriptToProps(script, presetKey, totalDurationSec, bodyImages, sceneImageOrder, mode = 'kinetic') {
  const fps = SHORTFORM_FPS;
  const totalFrames = Math.round(totalDurationSec * fps);

  const scenes = Array.isArray(script?.scenes) ? script.scenes : [];
  const hookScene = scenes.find((s) => s.section === 'hook') || scenes[0] || {};
  const pointScenes = scenes.filter((s) => s.section === 'point');
  const ctaScene = scenes.find((s) => s.section === 'cta') || scenes[scenes.length - 1] || {};

  // ── Slideshow 모드: 각 scene을 슬라이드로 변환 ──
  if (mode === 'slideshow') {
    // 모든 scene을 순서대로 슬라이드로 변환 (hook → points → cta)
    const orderedScenes = [];
    if (hookScene?.script) orderedScenes.push({ ...hookScene, _kind: 'hook' });
    pointScenes.forEach((s) => s?.script && orderedScenes.push({ ...s, _kind: 'point' }));
    if (ctaScene?.script && ctaScene !== hookScene) orderedScenes.push({ ...ctaScene, _kind: 'cta' });

    // 이미지 배열 (bodyImages = Step 5에서 받은 전체 이미지 리스트)
    const imgs = Array.isArray(bodyImages) ? bodyImages : [];

    const slides = orderedScenes.map((s, i) => ({
      imageUrl: imgs[i] || imgs[i % Math.max(imgs.length, 1)] || undefined,
      text: s.script,
      badge: s._kind === 'hook' ? (s.hookText || 'STOP').slice(0, 12) : undefined,
      ctaButton: s._kind === 'cta' ? '지금 시작 →' : undefined,
    }));

    return {
      preset: presetKey,
      mode: 'slideshow',
      slides,
      totalDurationInFrames: totalFrames,
    };
  }

  // ── Kinetic 모드 (기존 3씬) ──
  // 3씬 비율: Hook 20%, Body 60%, CTA 20%
  const hookFrames = Math.round(totalFrames * 0.2);
  const ctaFrames = Math.round(totalFrames * 0.2);
  const bodyFrames = totalFrames - hookFrames - ctaFrames;

  const hookTitle = hookScene.script || script?.hook || '숏폼 영상';
  const hookBadge = hookScene.hookText || script?.hookText || 'STOP';
  // hookType(공감형/질문형 등)은 내부 분류 메타데이터라 시청자에게 노출 금지.
  // underlineText는 현재 사용하지 않음 (향후 필요시 별도 필드로 재정의).
  const underlineText = '';

  const pointTexts = pointScenes.map((s) => s.script).filter(Boolean);
  const bodyHeader = pointTexts[0] || script?.points?.[0] || '';
  // caption은 최대 2문장만 (줄바꿈 보존). 너무 길면 화면 가독성 ↓
  const captionSource = pointTexts.slice(1, 3).length > 0
    ? pointTexts.slice(1, 3)
    : (script?.points?.slice(1, 3) || []);
  const bodyCaption = captionSource.join('\n');

  const ctaText = ctaScene.script || script?.cta || '지금 시작하세요';

  // Phase F: sceneImageOrder 우선 → bodyImages 순서 폴백
  const orderedHook = sceneImageOrder?.find((s) => s.sceneId === 'hook')?.imageUrl;
  const orderedBody = sceneImageOrder?.find((s) => s.sceneId === 'body')?.imageUrl;
  const hookImage = orderedHook || bodyImages?.[0] || undefined;
  const bodyImage = orderedBody || bodyImages?.[1] || bodyImages?.[0] || undefined;

  return {
    preset: presetKey,
    mode: 'kinetic',
    hook: {
      badge: hookBadge.slice(0, 12),
      title: hookTitle,
      underlineText: underlineText || undefined,
      imageUrl: hookImage,
      durationInFrames: hookFrames,
    },
    body: {
      header: bodyHeader,
      caption: bodyCaption,
      imageUrl: bodyImage,
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

function ShortformClientInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get('projectId');
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

  // === Step 5 — 비주얼 액센트 (Phase E) ===
  const [step5Value, setStep5Value] = useState({
    userPhotos: [],    // [{ image, crop }]
    aiImageCount: 1,   // 0 | 1 | 2 (kinetic mode)
    aiImages: [],      // [url]
  });
  const [aiImageGenStatus, setAiImageGenStatus] = useState('idle');

  // === 영상 모드 (kinetic = 기존, slideshow = 이미지 슬라이드쇼) ===
  const [videoMode, setVideoMode] = useState('kinetic');

  // === Step 6 — 미리보기 + 커스터마이징 (Phase F) ===
  const [step6Value, setStep6Value] = useState(() =>
    buildStep6ValueFromPreset(DEFAULT_SHORTFORM_PRESET),
  );

  // === Phase H: Draft 복원 state ===
  const [restoredProjectId, setRestoredProjectId] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');

  // === Phase H: 자동 저장 훅 활성화 (Phase C 훅 사용) ===
  const authTokenForSave = typeof window !== 'undefined'
    ? localStorage.getItem('ddukddak_token')
    : null;
  const autoSaveSnapshot = useMemo(() => ({
    current_step: currentStep,
    blog_text: step1Value.blogText || null,
    keywords: step1Value.keywords
      ? step1Value.keywords.split(',').map((k) => k.trim()).filter(Boolean)
      : null,
    user_experience: step1Value.userExperience || null,
    persona: step1Value.persona || null,
    tone: step1Value.tone || null,
    duration_sec: step1Value.durationSec || null,
    script_json: script || null,
    preset: presetKey || null,
  }), [currentStep, step1Value, script, presetKey]);

  // savedProjectId/autoSaving/autoSavedAt는 현재 UI에 사용 안함 — Phase I(SSE)에서 활용 예정
  // eslint-disable-next-line no-unused-vars
  const autoSave = useProjectAutoSave({
    authToken: authTokenForSave,
    enabled: !!(user && user.email),
    snapshot: autoSaveSnapshot,
    initialProjectId: restoredProjectId ? Number(restoredProjectId) : null,
    debounceMs: 1500,
  });

  // === Phase I: SSE 진행 상태 + 취소 + 백그라운드 모드 ===
  const [jobId, setJobId] = useState(null);
  const authTokenForProgress = typeof window !== 'undefined'
    ? localStorage.getItem('ddukddak_token')
    : null;
  const {
    steps: progressSteps,
    current: progressCurrent,
    status: progressStatus,
    error: progressError,
    cancel: cancelJob,
    reset: resetProgress,
  } = useJobProgress(jobId, { authToken: authTokenForProgress });

  // 페이지 진입 시 localStorage의 활성 jobId 복원
  useEffect(() => {
    try {
      const stored = typeof window !== 'undefined'
        ? localStorage.getItem(SHORTFORM_JOB_STORAGE_KEY)
        : null;
      if (stored) setJobId(stored);
    } catch {}
  }, []);

  // jobId 변경 시 localStorage 동기화
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (jobId) {
        localStorage.setItem(SHORTFORM_JOB_STORAGE_KEY, jobId);
      }
    } catch {}
  }, [jobId]);

  // 완료/에러/취소 시 localStorage 정리 + 브라우저 알림
  useEffect(() => {
    if (
      progressStatus === 'complete'
      || progressStatus === 'cancelled'
      || progressStatus === 'error'
    ) {
      try {
        localStorage.removeItem(SHORTFORM_JOB_STORAGE_KEY);
      } catch {}
    }
    if (progressStatus === 'complete') {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          try {
            new Notification('숏폼 생성 완료', {
              body: '마이페이지에서 확인하실 수 있어요.',
            });
          } catch {}
        }
      }
    }
  }, [progressStatus]);

  // === Phase K: 온보딩 위저드 + 첫 영상 무료 ===
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isFreeFirst, setIsFreeFirst] = useState(false);

  // /me 조회 → onboardingCompleted=false면 모달 노출
  useEffect(() => {
    const tk = getToken();
    if (!tk) return;
    let cancelled = false;
    fetch('/api/auth?action=me', {
      headers: { Authorization: `Bearer ${tk}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.onboardingCompleted === false) {
          setShowOnboarding(true);
        }
        setIsFreeFirst(Boolean(data?.eligibleForFreeFirstShortform));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function postOnboardingCompleted(extra) {
    const tk = getToken();
    if (!tk) return;
    fetch('/api/auth/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
      body: JSON.stringify({ completed: true, ...(extra || {}) }),
    }).catch(() => {});
  }

  function handleSelectSample(sampleId) {
    const sample = getSample(sampleId);
    if (!sample) return;
    const next = sampleToStep1Value(sample);
    if (next) setStep1Value(next);
    setShowOnboarding(false);
    postOnboardingCompleted({ selectedSampleId: sampleId });
  }

  function handleSkipOnboarding() {
    setShowOnboarding(false);
    postOnboardingCompleted();
  }
  // === /Phase K ===

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

  // === Phase H: ?projectId 쿼리로 Draft 복원 ===
  useEffect(() => {
    if (!projectId) return;
    if (restoredProjectId === projectId) return;

    const token = typeof window !== 'undefined'
      ? localStorage.getItem('ddukddak_token')
      : null;
    if (!token) return;

    setRestoring(true);
    setRestoreError('');
    fetch(`/api/shortform-projects/${projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data || !data.project) {
          setRestoreError('프로젝트를 찾을 수 없습니다.');
          return;
        }
        const p = data.project;

        // Step 1 입력 복원 — step1Value 스키마로 역매핑
        setStep1Value((prev) => ({
          ...prev,
          contentMode: p.blog_text ? 'blog' : (p.keywords ? 'keyword' : prev.contentMode),
          blogText: p.blog_text || prev.blogText,
          keywords: Array.isArray(p.keywords)
            ? p.keywords.join(', ')
            : (p.keywords || prev.keywords),
          userExperience: p.user_experience || prev.userExperience,
          persona: p.persona || prev.persona,
          tone: p.tone || prev.tone,
          durationSec: p.duration_sec || prev.durationSec,
        }));

        // 역호환 레거시 state
        if (p.blog_text || p.keywords) {
          setTopic(
            p.blog_text ? p.blog_text.slice(0, 100)
            : Array.isArray(p.keywords) ? p.keywords.join(', ')
            : (p.keywords || ''),
          );
        }
        if (p.user_experience) setMemo(p.user_experience);
        if (p.tone) setTone(p.tone === 'casual' ? 'casual' : 'professional');
        if (p.duration_sec) setTotalDurationSec(p.duration_sec);

        // Step 3 대본 복원
        if (p.script_json) {
          setScript(p.script_json);
          setScriptStatus('done');
        }

        // Step 6 프리셋 복원
        if (p.preset) setPresetKey(p.preset);

        // 완료된 단계 배지 (current_step 미만은 전부 completed로 마킹)
        if (p.current_step && p.current_step > 1) {
          const completed = [];
          for (let i = 1; i < p.current_step; i += 1) completed.push(i);
          setCompletedSteps(completed);
          setCurrentStep(p.current_step);
        }

        setRestoredProjectId(projectId);
      })
      .catch((err) => {
        setRestoreError(err?.message || '복원에 실패했습니다.');
      })
      .finally(() => {
        setRestoring(false);
      });
  }, [projectId, restoredProjectId]);

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

  // Step 5 사진(사용자 + AI)을 bodyImages로 병합 (Phase E)
  const mergedImages = useMemo(
    () => mergeShortformImages(step5Value),
    [step5Value],
  );

  // 미리보기 props + duration 계산
  // Phase F: step6Value.sceneImageOrder를 scriptToProps에 전달
  const playerProps = useMemo(() => {
    if (!script) return null;
    // Step 5 값이 있으면 우선, 비어있으면 기존 images state 폴백 (runAll 경로)
    const bodyImages = mergedImages.length > 0 ? mergedImages : images;
    return scriptToProps(
      script,
      presetKey,
      totalDurationSec,
      bodyImages,
      step6Value?.sceneImageOrder,
      videoMode,
    );
  }, [script, presetKey, totalDurationSec, images, mergedImages, step6Value?.sceneImageOrder, videoMode]);

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

    // Phase I: SSE 진행 구독을 위한 jobId 발급
    resetProgress();
    const newJobId = generateClientJobId();
    setJobId(newJobId);

    try {
      const res = await fetch('/api/shortform-script', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          jobId: newJobId,
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
      // Phase K: 첫 영상 무료 적용됐으면 배너 숨김 (Agent D 가 응답에
      // freeFirstApplied 포함하도록 wire-up 한 뒤에만 동작)
      if (data.freeFirstApplied) {
        setIsFreeFirst(false);
      }
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

  /**
   * Step 5 — AI 이미지 생성 핸들러 (Phase E)
   * 기존 generateImages()와 달리 count 지정 가능 + Promise<string[]> 반환.
   * runAll() 보조 모드는 영향 없음 — 기존 generateImages()를 그대로 사용.
   */
  async function generateAiImagesForStep5(count) {
    setAiImageGenStatus('busy');
    try {
      const token = getToken();
      if (!token) {
        alert('로그인이 필요합니다.');
        router.push('/login');
        setAiImageGenStatus('error');
        return [];
      }
      // step1Value가 있으면 그쪽 주제를 우선 사용, 없으면 레거시 topic state
      const step1Topic = step1Value?.contentMode === 'keyword'
        ? (step1Value?.keywords || '')
        : (step1Value?.blogText || '').slice(0, 100);
      const effectiveTopic = step1Topic || topic || '';
      if (!effectiveTopic.trim()) {
        setError('주제가 없어 AI 이미지를 생성할 수 없어요. Step 1에서 입력해주세요.');
        setAiImageGenStatus('error');
        return [];
      }
      const res = await fetch('/api/blog-image-pro', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          mode: 'direct',
          topic: effectiveTopic,
          mood: 'emotional',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '이미지 생성 실패');
      const urls = (data.images || [])
        .map((img) => img.r2Url || img.url)
        .filter(Boolean)
        .slice(0, count);
      setAiImageGenStatus('done');
      return urls;
    } catch (err) {
      setError(err.message || '이미지 생성 중 오류');
      setAiImageGenStatus('error');
      return [];
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
      {/* Phase K: 첫 방문 온보딩 모달 */}
      <OnboardingModal
        open={showOnboarding}
        onSelectSample={handleSelectSample}
        onSkip={handleSkipOnboarding}
      />

      <div className={styles.hero}>
        <div className={styles.heroBadge}>NEW · 숏폼</div>
        <h1>릴스·쇼츠를<br /><em>5분 만에 뚝딱</em></h1>
        <p>주제만 입력하면 AI 대본 + Ken Burns 이미지 + TTS로<br />프리미엄 숏폼 영상을 자동 생성합니다</p>
      </div>

      {/* Phase H: Draft 복원 배너 */}
      {restoring && (
        <div className={styles.restoreBanner}>
          작업 중이던 프로젝트를 불러오는 중...
        </div>
      )}
      {restoreError && (
        <div className={styles.restoreBannerError}>
          <span>{restoreError}</span>
          <a href="/shortform" className={styles.restoreBannerLink}>
            새로 시작
          </a>
        </div>
      )}
      {restoredProjectId && !restoring && !restoreError && (
        <div className={styles.restoreBannerSuccess}>
          작업 중이던 프로젝트를 이어서 작업합니다 (Step {currentStep})
        </div>
      )}

      {/* Phase K: 첫 영상 무료 배너 (가입 7일 이내 & 첫 숏폼 미생성) */}
      {isFreeFirst && !showOnboarding && (
        <div className={styles.freeFirstBanner}>
          첫 영상은 무료에요. 지금 바로 만들어보세요.
        </div>
      )}

      {/* Phase A: StepProgress 표시 */}
      <div className={styles.stepProgressWrap}>
        <StepProgress
          steps={STEP_LIST}
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={handleStepClick}
        />
      </div>

      {/* Phase I: SSE 실시간 진행 표시 + 취소 */}
      {jobId && progressStatus !== 'idle' && (
        <div className={styles.progressIndicatorWrap}>
          <ProgressIndicator
            activeSteps={PROGRESS_ACTIVE_STEPS}
            progress={progressSteps}
            current={progressCurrent}
            status={progressStatus}
            error={progressError}
            onCancel={cancelJob}
          />
        </div>
      )}

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

      {/* Step 5: 비주얼 액센트 (Phase E) */}
      {currentStep === 5 && (
        <div className={styles.stepContainer}>
          {/* 영상 모드 선택 */}
          <div style={{
            marginBottom: 24,
            padding: '16px 20px',
            background: 'var(--ds-bg-soft, #F4F2EC)',
            border: '1px solid var(--ds-border, #ECE9E2)',
            borderRadius: 12,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--ds-text, #1F2937)' }}>
              영상 모드
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setVideoMode('kinetic')}
                style={{
                  flex: 1,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: videoMode === 'kinetic' ? '2px solid var(--ds-accent, #F95A1F)' : '1.5px solid var(--ds-border, #E5E7EB)',
                  background: videoMode === 'kinetic' ? 'rgba(255, 95, 31, 0.06)' : '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>🎨 키네틱 모드 (기본)</div>
                <div style={{ fontSize: 11, color: 'var(--ds-muted, #77736B)', lineHeight: 1.4 }}>
                  Hook/Body/CTA 3씬 + 키네틱 타이포. 이미지 최대 2장.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setVideoMode('slideshow')}
                style={{
                  flex: 1,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: videoMode === 'slideshow' ? '2px solid var(--ds-accent, #F95A1F)' : '1.5px solid var(--ds-border, #E5E7EB)',
                  background: videoMode === 'slideshow' ? 'rgba(255, 95, 31, 0.06)' : '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>📸 슬라이드쇼 모드</div>
                <div style={{ fontSize: 11, color: 'var(--ds-muted, #77736B)', lineHeight: 1.4 }}>
                  각 씬마다 1장씩 (5~8장). 매장 투어/메뉴 소개에 적합.
                </div>
              </button>
            </div>
          </div>

          <Step5VisualAccent
            value={step5Value}
            onChange={setStep5Value}
            onGenerateAI={generateAiImagesForStep5}
            aiStatus={aiImageGenStatus}
            onBack={() => setCurrentStep(4)}
            onNext={() => setCurrentStep(6)}
            videoMode={videoMode}
          />
        </div>
      )}

      {/* Step 6: 미리보기 + 커스터마이징 (Phase F) */}
      {currentStep === 6 && (
        <div className={styles.stepContainer}>
          <Step6Preview
            value={step6Value}
            onChange={(next) => {
              setStep6Value(next);
              // 상위 프리셋이 바뀌면 레거시 presetKey도 동기화 (하위 컬러 프리셋)
              if (next?.presetKey) {
                const upper = getShortformPreset(next.presetKey);
                if (upper?.colorPreset && upper.colorPreset !== presetKey) {
                  setPresetKey(upper.colorPreset);
                }
              }
            }}
            playerProps={playerProps}
            mergedImages={mergedImages}
            /* Phase B가 도달하기 전까지는 undefined — 배너 자동 숨김 */
            benchmarkAggregated={undefined}
            onBack={() => setCurrentStep(5)}
            onNext={() => {
              setCompletedSteps((prev) => Array.from(new Set([...prev, 6])));
              setCurrentStep(7);
            }}
          />
        </div>
      )}

      {/* Step 2~4, 7: 기존 UI를 임시 유지 (Phase B/C/D에서 단계별 교체) */}
      {currentStep >= 2 && currentStep !== 5 && currentStep !== 6 && (
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

          {/* Phase E: Step 5 독립 테스트용 점프 버튼 (Phase D 완료 시 제거) */}
          {currentStep !== 5 && (
            <button
              type="button"
              className={styles.skipToStep5Btn}
              onClick={() => setCurrentStep(5)}
            >
              Step 5 (사진 액센트)로 바로 가기 →
            </button>
          )}
        </div>
      )}
    </main>
  );
}

// Next.js 15: useSearchParams는 Suspense 경계 내부여야 함.
export default function ShortformClient() {
  return (
    <Suspense
      fallback={
        <main className={styles.root}>
          <div className={styles.hero}>
            <div className={styles.heroBadge}>NEW · 숏폼</div>
            <h1>불러오는 중...</h1>
          </div>
        </main>
      }
    >
      <ShortformClientInner />
    </Suspense>
  );
}
