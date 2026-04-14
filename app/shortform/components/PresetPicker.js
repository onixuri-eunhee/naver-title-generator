'use client';

import { SHORTFORM_PRESETS, SHORTFORM_PRESET_KEYS } from '@/lib/shortform-presets';
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
        return (
          <button
            key={id}
            type="button"
            className={`${styles.card} ${active ? styles.cardActive : ''}`}
            onClick={() => onChange(id)}
          >
            {recommended && <span className={styles.badge}>⭐ 추천</span>}
            <div className={styles.cardLabel}>{p.label}</div>
            <div className={styles.cardDesc}>{p.description}</div>
            <div className={styles.cardMeta}>
              <span>{p.kinetic}</span>
              <span>·</span>
              <span>{p.cameraMotion}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
