'use client';

import { getShortformPreset } from '@/lib/shortform-presets';

/**
 * Props:
 * - recommendedId: string (프리셋 id)
 * - currentId: string (현재 선택된 프리셋 id)
 * - mode: 'recommended' | 'custom'
 * - onAcceptRecommendation: () => void  ("추천대로 갈게")
 * - onEnterCustom: () => void  ("세부 조정")
 * - benchmarkAdvice?: string (Phase B가 남긴 advice 1줄)
 */
export default function RecommendationBanner({
  recommendedId,
  currentId,
  mode,
  onAcceptRecommendation,
  onEnterCustom,
  benchmarkAdvice,
}) {
  const preset = getShortformPreset(recommendedId);
  const isAccepted = mode === 'recommended' && currentId === recommendedId;

  return (
    <div style={{
      background: 'linear-gradient(135deg, #FFF8F0 0%, #FFF3E0 100%)',
      border: '1px solid #FFE0B2',
      borderRadius: 12,
      padding: 20,
      marginBottom: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 20 }}>⭐</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: '#6B4A00', fontWeight: 500 }}>
            벤치마킹 영상 패턴 분석 결과
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#1A1A1A', marginTop: 2 }}>
            추천 프리셋: <span style={{ color: '#E65100' }}>{preset.label}</span>
          </div>
          {benchmarkAdvice && (
            <div style={{ fontSize: 13, color: '#6B6B6B', marginTop: 6, lineHeight: 1.5 }}>
              {benchmarkAdvice}
            </div>
          )}
        </div>
      </div>

      {!isAccepted && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onAcceptRecommendation}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: '#FF5F1F',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            추천대로 갈게
          </button>
          <button
            type="button"
            onClick={onEnterCustom}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: '#fff',
              color: '#1A1A1A',
              border: '1px solid #E5E7EB',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            세부 조정
          </button>
        </div>
      )}
      {isAccepted && (
        <div style={{ fontSize: 13, color: '#6B4A00', fontStyle: 'italic' }}>
          추천 프리셋이 적용됐어요. 아래 미리보기로 확인해보세요.
        </div>
      )}
    </div>
  );
}
