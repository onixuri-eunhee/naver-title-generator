'use client';

import { useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { ShortformComposition, buildShortformTimeline } from '@/remotion/shortform/ShortformComposition.jsx';
import { SHORTFORM_FPS, SHORTFORM_WIDTH, SHORTFORM_HEIGHT } from '@/remotion/shortform/styles';
import {
  getShortformPreset,
  buildStep6ValueFromPreset,
  resolveRecommendedPreset,
} from '@/lib/shortform-presets';
import PresetPicker from './PresetPicker';
import SubtitleCustomizer from './SubtitleCustomizer';
import RecommendationBanner from './RecommendationBanner';
import styles from './Step6Preview.module.css';

// Player는 클라이언트 전용 — SSR 방지
const Player = dynamic(
  () => import('@remotion/player').then((mod) => mod.Player),
  { ssr: false },
);

/**
 * Props:
 * - value: step6Value
 * - onChange: (nextValue) => void
 * - playerProps: scriptToProps 결과 (hook/body/cta + audio)
 * - mergedImages?: string[]  (Step 5 이미지 목록 — 사진 배치 조정용)
 * - benchmarkAggregated?: { recommendedPreset, advice }  (Phase B 출력)
 * - onBack: () => void
 * - onNext: () => void  (Step 7 다운로드로)
 */
export default function Step6Preview({
  value,
  onChange,
  playerProps,
  mergedImages = [],
  benchmarkAggregated,
  onBack,
  onNext,
}) {
  const recommendedId = useMemo(
    () => resolveRecommendedPreset(benchmarkAggregated?.recommendedPreset),
    [benchmarkAggregated?.recommendedPreset],
  );

  // 첫 진입 시 자동 추천 주입 — value가 없거나 presetKey가 비어있을 때만
  useEffect(() => {
    if (!value || !value.presetKey) {
      onChange(buildStep6ValueFromPreset(recommendedId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendedId]);

  // 프리셋 변경 핸들러 — 기본값으로 초기화 (명시적 reset 효과)
  function handlePresetChange(presetId) {
    const fresh = buildStep6ValueFromPreset(presetId);
    onChange({ ...fresh, mode: value?.mode || 'recommended' });
  }

  function acceptRecommendation() {
    onChange({ ...buildStep6ValueFromPreset(recommendedId), mode: 'recommended' });
  }

  function enterCustom() {
    onChange({ ...(value || {}), mode: 'custom' });
  }

  // 사진 배치 핸들러 — hook/body 씬별 imageUrl 지정
  function updateSceneImage(sceneId, imageUrl) {
    const prev = value?.sceneImageOrder || [];
    const filtered = prev.filter((s) => s.sceneId !== sceneId);
    const next = imageUrl
      ? [...filtered, { sceneId, imageUrl }]
      : filtered;
    onChange({ ...value, sceneImageOrder: next });
  }

  // Remotion Player용 합성 props
  const compositionProps = useMemo(() => {
    if (!playerProps || !value) return null;
    const preset = getShortformPreset(value.presetKey);
    return {
      ...playerProps,
      preset: preset.colorPreset,
      subtitle: value.subtitle,
      textPosition: value.textPosition,
      cameraMotion: value.cameraMotion,
      sceneTransition: value.sceneTransition,
    };
  }, [playerProps, value]);

  const durationInFrames = useMemo(() => {
    if (!compositionProps) return SHORTFORM_FPS;
    const { durationInFrames: d } = buildShortformTimeline(compositionProps);
    return d;
  }, [compositionProps]);

  if (!playerProps) {
    return (
      <div className={styles.empty}>
        <p>대본이 아직 생성되지 않았어요.</p>
        <p className={styles.emptySub}>이전 단계에서 대본을 먼저 완성해주세요.</p>
        {onBack && (
          <button type="button" className={styles.backBtn} onClick={onBack}>
            ← 이전 단계로
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        <h2 className={styles.title}>미리보기 + 커스터마이징</h2>
        <p className={styles.description}>
          프리셋을 선택하거나 세부 옵션을 조정하세요. 모든 변경은 즉시 미리보기에 반영돼요.
        </p>
      </div>

      {/* 추천 배너 — benchmarkAggregated가 있을 때만 */}
      {benchmarkAggregated?.recommendedPreset && (
        <RecommendationBanner
          recommendedId={recommendedId}
          currentId={value?.presetKey}
          mode={value?.mode}
          onAcceptRecommendation={acceptRecommendation}
          onEnterCustom={enterCustom}
          benchmarkAdvice={benchmarkAggregated?.advice}
        />
      )}

      <div className={styles.layout}>
        {/* 왼쪽: 플레이어 */}
        <div className={styles.playerCol}>
          <div className={styles.playerFrame}>
            {compositionProps && (
              <Player
                component={ShortformComposition}
                inputProps={compositionProps}
                durationInFrames={durationInFrames}
                compositionWidth={SHORTFORM_WIDTH}
                compositionHeight={SHORTFORM_HEIGHT}
                fps={SHORTFORM_FPS}
                controls
                loop
                style={{ width: '100%', height: '100%' }}
              />
            )}
          </div>
          <div className={styles.playerHint}>
            ▶ 재생 / 구간 반복으로 확인 가능
          </div>
        </div>

        {/* 오른쪽: 프리셋 + 세부 조정 */}
        <div className={styles.controlCol}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>프리셋</h3>
            <PresetPicker
              value={value?.presetKey}
              recommendedId={recommendedId}
              onChange={handlePresetChange}
            />
          </section>

          {value?.mode === 'custom' && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>세부 조정</h3>
              <SubtitleCustomizer value={value} onChange={onChange} />
            </section>
          )}

          {/* 사진 배치 — mergedImages가 있을 때만 */}
          {mergedImages.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>사진 배치</h3>
              <div className={styles.imageAssignRow}>
                <label className={styles.imageAssignLabel}>Hook 씬</label>
                <select
                  className={styles.imageAssignSelect}
                  value={value?.sceneImageOrder?.find((s) => s.sceneId === 'hook')?.imageUrl || ''}
                  onChange={(e) => updateSceneImage('hook', e.target.value)}
                >
                  <option value="">(자동)</option>
                  {mergedImages.map((url, i) => (
                    <option key={url} value={url}>
                      이미지 {i + 1}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.imageAssignRow}>
                <label className={styles.imageAssignLabel}>Body 씬</label>
                <select
                  className={styles.imageAssignSelect}
                  value={value?.sceneImageOrder?.find((s) => s.sceneId === 'body')?.imageUrl || ''}
                  onChange={(e) => updateSceneImage('body', e.target.value)}
                >
                  <option value="">(자동)</option>
                  {mergedImages.map((url, i) => (
                    <option key={url} value={url}>
                      이미지 {i + 1}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          )}
        </div>
      </div>

      <div className={styles.navRow}>
        {onBack && (
          <button type="button" className={styles.backBtn} onClick={onBack}>
            ← 이전
          </button>
        )}
        <button type="button" className={styles.nextBtn} onClick={onNext}>
          다음: 다운로드 →
        </button>
      </div>
    </div>
  );
}
