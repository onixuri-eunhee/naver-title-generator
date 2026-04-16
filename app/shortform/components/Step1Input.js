'use client';

import { useState } from 'react';
import { PERSONAS, TONES } from '@/lib/shortform-personas';
// Phase A-bis — 카테고리 options 는 lib/shortform/settings.js SSOT에서 파생
import { CHIP_SCHEMA } from '@/lib/shortform/settings.js';
import styles from './Step1Input.module.css';

const SHORTFORM_DURATIONS = [
  { sec: 30, label: '30초' },
  { sec: 45, label: '45초' },
  { sec: 60, label: '60초' },
  { sec: 90, label: '90초' },
];

const LONGFORM_DURATIONS = [
  { sec: 180, label: '3분' },
  { sec: 300, label: '5분' },
  { sec: 600, label: '10분' },
];

/**
 * Step 1: 사용자 입력 폼.
 *
 * Props:
 * - value: { contentMode, blogText, keywords, userExperience, persona, customPersonaLabel, tone, durationSec }
 * - onChange: (next) => void
 * - onNext: () => void  // 검증 통과 시 다음 단계로
 * - contentType?: 'shortform' | 'longform'  // v2.1 — duration 옵션 분기
 */
export default function Step1Input({ value, onChange, onNext, contentType = 'shortform' }) {
  const DURATIONS = contentType === 'longform' ? LONGFORM_DURATIONS : SHORTFORM_DURATIONS;
  const lengthLabel = contentType === 'longform' ? '롱폼 길이' : '영상 길이';
  const [error, setError] = useState('');

  function update(patch) {
    onChange({ ...value, ...patch });
  }

  function validateAndNext() {
    setError('');

    if (value.contentMode === 'blog') {
      if (!value.blogText || value.blogText.trim().length < 100) {
        setError('블로그 글을 100자 이상 입력해주세요.');
        return;
      }
    } else if (value.contentMode === 'keyword') {
      if (!value.keywords || value.keywords.trim().length < 2) {
        setError('키워드를 2자 이상 입력해주세요.');
        return;
      }
    }

    if (!value.userExperience || value.userExperience.trim().length < 10) {
      setError('내 경험·느낌을 10자 이상 입력해주세요.');
      return;
    }

    if (!value.persona) {
      setError('화자 페르소나를 선택해주세요.');
      return;
    }

    if (value.persona === 'custom' && !value.customPersonaLabel) {
      setError('직접 입력 페르소나의 이름을 적어주세요.');
      return;
    }

    onNext();
  }

  return (
    <div className={styles.root}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>1. 콘텐츠 입력</div>
        <div className={styles.modeRow}>
          <button
            type="button"
            className={`${styles.modeBtn} ${value.contentMode === 'blog' ? styles.modeBtnActive : ''}`}
            onClick={() => update({ contentMode: 'blog' })}
          >블로그 글 사용 (권장)</button>
          <button
            type="button"
            className={`${styles.modeBtn} ${value.contentMode === 'keyword' ? styles.modeBtnActive : ''}`}
            onClick={() => update({ contentMode: 'keyword' })}
          >키워드만 사용</button>
        </div>

        {value.contentMode === 'blog' && (
          <textarea
            className={styles.textarea}
            placeholder="블로그 글을 붙여넣으세요 (100자 이상). /blog-writer에서 작성한 글이 자동 입력됩니다."
            value={value.blogText || ''}
            onChange={(e) => update({ blogText: e.target.value })}
            rows={6}
          />
        )}

        {value.contentMode === 'keyword' && (
          <input
            type="text"
            className={styles.input}
            placeholder="예: 신랑 정장 추천, 카페 창업 비용"
            value={value.keywords || ''}
            onChange={(e) => update({ keywords: e.target.value })}
            maxLength={100}
          />
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>2. 내 경험·느낌</div>
        <textarea
          className={styles.textarea}
          placeholder="구체적으로 적을수록 좋아요. 예: 15년차 헤어 디자이너, 손님 한 분이 처음 매장 들어왔을 때 '여기 분위기 너무 좋다'고 했던 그 순간"
          value={value.userExperience || ''}
          onChange={(e) => update({ userExperience: e.target.value })}
          rows={3}
        />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>3. 내 정체성</div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>화자</label>
          <select
            className={styles.select}
            value={value.persona || ''}
            onChange={(e) => update({ persona: e.target.value })}
          >
            <option value="">선택해주세요</option>
            {PERSONAS.map((p) => (
              <option key={p.id} value={p.id}>{p.label} — {p.description}</option>
            ))}
            <option value="custom">직접 입력...</option>
          </select>
        </div>

        {value.persona === 'custom' && (
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>직접 입력 (페르소나 이름)</label>
            <input
              type="text"
              className={styles.input}
              placeholder="예: 펫시터, 퍼스널트레이너, 꽃집 주인"
              value={value.customPersonaLabel || ''}
              onChange={(e) => update({ customPersonaLabel: e.target.value })}
              maxLength={30}
            />
          </div>
        )}

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>톤</label>
          <div className={styles.toneRow}>
            {TONES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`${styles.toneBtn} ${value.tone === t.id ? styles.toneBtnActive : ''}`}
                onClick={() => update({ tone: t.id })}
              >
                <div className={styles.toneLabel}>{t.label}</div>
                <div className={styles.toneDesc}>{t.description}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>4. {lengthLabel}</div>
        <div className={styles.durationRow}>
          {DURATIONS.map((d) => (
            <button
              key={d.sec}
              type="button"
              className={`${styles.durationBtn} ${value.durationSec === d.sec ? styles.durationBtnActive : ''}`}
              onClick={() => update({ durationSec: d.sec })}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Phase A-bis — optional 카테고리 override. 기본 'auto' = 서버 자동 감지 */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>5. 카테고리 (선택)</div>
        <div className={styles.fieldGroup}>
          <select
            className={styles.select}
            value={value.category || 'auto'}
            onChange={(e) => update({ category: e.target.value })}
          >
            {CHIP_SCHEMA.category.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
            기본 자동 감지 — 직접 선택하면 대본이 해당 업종 관점으로 생성돼요.
          </div>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <button
        type="button"
        className={styles.nextBtn}
        onClick={validateAndNext}
      >
        다음: 벤치마킹 영상 찾기 →
      </button>
    </div>
  );
}
