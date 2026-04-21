import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONTS, SIZES, SPRING_CONFIG } from './styles.js';

// Phase A-bis CTAVariantScene — spec §4.9 / §6.3
//
// Props:
//   - variantProps: { variant: 'casual' | 'professional' }
//   - copy:         string
//   - brandKit:     { logoUrl?, primaryColor?, handle? } | null
//
// durationInFrames는 공개 API 문서(spec §4.9)에는 나열되지만, 실제 프레임 길이는
// 호출자가 TransitionSeries.Sequence에 설정한다. 이 컴포넌트 내부에서는 참조 금지.
//
// 4단계 폴백 (production 필수, throw 금지):
//   1. variantProps 없음         → { variant: 'casual' }
//   2. copy 빈 문자열            → DEFAULT_COPY
//   3. brandKit 없음             → DEFAULT_BRAND_KIT
//   4. copy 80자 초과            → 78자 + '…'
//
// L4: 이 컴포넌트는 cta-variants 레지스트리를 재조회하지 않는다. 호출자
//     (SceneSequenceComposition / scriptToProps)가 resolve한 variantProps만 받는다.

const DEFAULT_COPY = '저장해두고 나중에 보세요 · 팔로우하면 더 많은 팁';
const MAX_COPY_LENGTH = 80;
const COPY_TRUNCATE_TO = 78;

const DEFAULT_BRAND_KIT = Object.freeze({
  logoUrl: null,
  primaryColor: '#ff5f1f',
  handle: null,
});

function formatHeadlineLines(text, maxCharsPerLine = 14, maxLines = 3) {
  const normalized = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!normalized) return '';

  const words = normalized.split(' ');
  const lines = [];
  let current = '';

  while (words.length > 0 && lines.length < maxLines) {
    const word = words.shift();
    const candidate = current ? `${current} ${word}` : word;
    if (!current || candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }

  const remaining = [current, ...words].filter(Boolean).join(' ');
  if (remaining) {
    const trimmed = remaining.length > maxCharsPerLine
      ? `${remaining.slice(0, Math.max(0, maxCharsPerLine - 1)).trimEnd()}…`
      : remaining;
    lines.push(trimmed);
  }

  return lines.slice(0, maxLines).join('\n');
}

function resolveVariantProps(variantProps) {
  if (!variantProps || typeof variantProps !== 'object') {
    if (typeof console !== 'undefined') {
      console.warn('[CTAVariantScene] variantProps missing → casual fallback');
    }
    return { variant: 'casual' };
  }
  if (variantProps.variant !== 'casual' && variantProps.variant !== 'professional') {
    console.warn('[CTAVariantScene] unknown variant, using casual:', variantProps.variant);
    return { variant: 'casual' };
  }
  return variantProps;
}

function resolveCopy(copy) {
  if (typeof copy !== 'string' || copy.trim() === '') {
    console.warn('[CTAVariantScene] copy empty → DEFAULT_COPY');
    return DEFAULT_COPY;
  }
  if (copy.length > MAX_COPY_LENGTH) {
    console.warn('[CTAVariantScene] copy > 80 chars, truncating');
    return `${copy.slice(0, COPY_TRUNCATE_TO)}…`;
  }
  return copy;
}

function resolveBrandKit(brandKit) {
  if (!brandKit || typeof brandKit !== 'object') {
    return DEFAULT_BRAND_KIT;
  }
  return {
    logoUrl: brandKit.logoUrl || null,
    primaryColor: brandKit.primaryColor || DEFAULT_BRAND_KIT.primaryColor,
    handle: brandKit.handle || null,
  };
}

export const CTAVariantScene = ({ variantProps, copy, brandKit }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const resolvedVariantProps = resolveVariantProps(variantProps);
  const resolvedCopy = resolveCopy(copy);
  const resolvedBrandKit = resolveBrandKit(brandKit);
  const formattedCopy = formatHeadlineLines(resolvedCopy);

  const isProfessional = resolvedVariantProps.variant === 'professional';
  const accent = resolvedBrandKit.primaryColor;

  const entry = spring({ frame, fps, config: SPRING_CONFIG });
  const entryY = interpolate(entry, [0, 1], [60, 0]);

  const bgColor = isProfessional ? '#0f1222' : '#ffffff';
  const fgColor = isProfessional ? '#ffffff' : '#0f1222';
  const handleColor = isProfessional ? 'rgba(255,255,255,0.6)' : 'rgba(15,18,34,0.6)';

  return (
    <AbsoluteFill
      style={{
        backgroundColor: bgColor,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 80,
      }}
    >
      <div
        style={{
          opacity: entry,
          transform: `translateY(${entryY}px)`,
          fontFamily: FONTS.primary,
          fontWeight: FONTS.weight.black,
          fontSize: SIZES.ctaHeadline,
          color: fgColor,
          textAlign: 'center',
          lineHeight: 1.3,
          letterSpacing: -0.5,
          maxWidth: 900,
          whiteSpace: 'pre-wrap',
        }}
      >
        {formattedCopy}
      </div>

      <div
        style={{
          marginTop: 48,
          width: 120,
          height: 6,
          borderRadius: 3,
          backgroundColor: accent,
          opacity: entry,
        }}
      />

      {resolvedBrandKit.handle && (
        <div
          style={{
            marginTop: 32,
            fontFamily: FONTS.primary,
            fontWeight: FONTS.weight.bold,
            fontSize: 28,
            color: handleColor,
            opacity: entry,
          }}
        >
          {resolvedBrandKit.handle}
        </div>
      )}
    </AbsoluteFill>
  );
};
