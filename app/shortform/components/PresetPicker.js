'use client';

import {
  SHORTFORM_PRESETS,
  SHORTFORM_PRESET_KEYS,
  getColorSwatch,
  describeKinetic,
  describeCamera,
  describeTransition,
} from '@/lib/shortform-presets';
import styles from './PresetPicker.module.css';

/**
 * Props:
 * - value: string (프리셋 id)
 * - recommendedId?: string
 * - onChange: (id) => void
 */
export default function PresetPicker({ value, recommendedId, onChange }) {
  return (
    <div className={styles.grid}>
      {SHORTFORM_PRESET_KEYS.map((id) => {
        const p = SHORTFORM_PRESETS[id];
        const active = value === id;
        const recommended = recommendedId === id;
        const swatch = getColorSwatch(p.colorPreset);
        return (
          <button
            key={id}
            type="button"
            className={`${styles.card} ${active ? styles.cardActive : ''}`}
            onClick={() => onChange(id)}
          >
            {recommended && <span className={styles.badge}>⭐ 추천</span>}

            {/* 색 미리보기 — 배경 + 자막 예시 */}
            <div
              className={styles.preview}
              style={{ background: swatch.bg, color: swatch.text }}
              aria-hidden
            >
              <span
                className={styles.previewSubtitle}
                style={{
                  color: p.subtitle.color,
                  background: `${p.subtitle.bgColor || 'transparent'}${
                    p.subtitle.bgOpacity != null
                      ? Math.round(p.subtitle.bgOpacity * 255).toString(16).padStart(2, '0')
                      : ''
                  }`,
                  fontSize: Math.max(11, Math.round(p.subtitle.size / 5)),
                }}
              >
                가나다
              </span>
              <span
                className={styles.previewAccent}
                style={{ background: swatch.accent }}
              />
            </div>

            <div className={styles.cardLabel}>{p.label}</div>
            <div className={styles.cardDesc}>{p.description}</div>
            <div className={styles.cardMeta}>
              <span title="자막 애니메이션">{describeKinetic(p.kinetic)}</span>
              <span>·</span>
              <span title="카메라">{describeCamera(p.cameraMotion)}</span>
              <span>·</span>
              <span title="전환">{describeTransition(p.sceneTransition)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
