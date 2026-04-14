'use client';

import {
  SUBTITLE_FONTS,
  SUBTITLE_COLORS,
  SUBTITLE_BG_COLORS,
  TEXT_POSITIONS,
  CAMERA_MOTIONS,
  SCENE_TRANSITIONS,
} from '@/lib/shortform-presets';
import styles from './SubtitleCustomizer.module.css';

/**
 * Props:
 * - value: step6Value (전체 객체. subtitle/textPosition/cameraMotion/sceneTransition 사용)
 * - onChange: (nextValue) => void
 */
export default function SubtitleCustomizer({ value, onChange }) {
  const subtitle = value?.subtitle || {};

  function updateSubtitle(patch) {
    onChange({ ...value, subtitle: { ...subtitle, ...patch } });
  }

  function updateTop(key, v) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div className={styles.root}>
      {/* 자막 폰트 */}
      <div className={styles.field}>
        <label className={styles.label}>자막 폰트</label>
        <div className={styles.chipRow}>
          {SUBTITLE_FONTS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`${styles.chip} ${subtitle.font === f.id ? styles.chipActive : ''}`}
              onClick={() => updateSubtitle({ font: f.id })}
              style={{ fontFamily: f.id }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 자막 색 */}
      <div className={styles.field}>
        <label className={styles.label}>자막 색</label>
        <div className={styles.colorRow}>
          {SUBTITLE_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`${styles.colorSwatch} ${subtitle.color === c.hex ? styles.colorSwatchActive : ''}`}
              style={{ background: c.hex }}
              onClick={() => updateSubtitle({ color: c.hex })}
              title={c.label}
              aria-label={c.label}
            />
          ))}
          <input
            type="color"
            className={styles.colorPicker}
            value={subtitle.color || '#ffffff'}
            onChange={(e) => updateSubtitle({ color: e.target.value })}
            title="직접 입력"
          />
        </div>
      </div>

      {/* 자막 크기 */}
      <div className={styles.field}>
        <label className={styles.label}>
          자막 크기 <span className={styles.value}>{subtitle.size || 56}px</span>
        </label>
        <input
          type="range"
          min="24"
          max="96"
          step="2"
          value={subtitle.size || 56}
          onChange={(e) => updateSubtitle({ size: Number(e.target.value) })}
          className={styles.slider}
        />
      </div>

      {/* 자막 배경색 + 투명도 */}
      <div className={styles.field}>
        <label className={styles.label}>자막 배경색</label>
        <div className={styles.colorRow}>
          {SUBTITLE_BG_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`${styles.colorSwatch} ${subtitle.bgColor === c.hex ? styles.colorSwatchActive : ''}`}
              style={{ background: c.hex }}
              onClick={() => updateSubtitle({ bgColor: c.hex })}
              title={c.label}
              aria-label={c.label}
            />
          ))}
        </div>
        <label className={styles.sliderLabel}>
          배경 투명도 <span className={styles.value}>{Math.round((subtitle.bgOpacity ?? 0.5) * 100)}%</span>
        </label>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={Math.round((subtitle.bgOpacity ?? 0.5) * 100)}
          onChange={(e) => updateSubtitle({ bgOpacity: Number(e.target.value) / 100 })}
          className={styles.slider}
        />
      </div>

      {/* 텍스트 위치 */}
      <div className={styles.field}>
        <label className={styles.label}>텍스트 위치</label>
        <div className={styles.chipRow}>
          {TEXT_POSITIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`${styles.chip} ${value?.textPosition === p.id ? styles.chipActive : ''}`}
              onClick={() => updateTop('textPosition', p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 카메라 모션 */}
      <div className={styles.field}>
        <label className={styles.label}>카메라 모션</label>
        <div className={styles.chipRow}>
          {CAMERA_MOTIONS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`${styles.chip} ${value?.cameraMotion === m.id ? styles.chipActive : ''}`}
              onClick={() => updateTop('cameraMotion', m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* 씬 전환 */}
      <div className={styles.field}>
        <label className={styles.label}>씬 전환</label>
        <div className={styles.chipRow}>
          {SCENE_TRANSITIONS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`${styles.chip} ${value?.sceneTransition === t.id ? styles.chipActive : ''}`}
              onClick={() => updateTop('sceneTransition', t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
