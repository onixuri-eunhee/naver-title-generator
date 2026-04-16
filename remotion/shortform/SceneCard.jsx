import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { FONTS, SIZES, SPRING_CONFIG, buildSubtitleStyle } from './styles';
import { KenBurnsImage } from './KenBurnsImage';
import { KineticText, KINETIC_VARIANTS } from './kineticText';

// Phase A-bis §4.10 — First 3 Seconds 시각 boost.
// 프레임 단위 상수는 파일 내 localConst (lib/*로 추출 금지 — 애니메이션 내부 구현).
const FIRST_SCENE_BOOST = {
  textScale: 1.12,
  saturateFrames: [0, 5, 10],
  saturateValues: [1, 1.18, 1],
  flashFrames: [0, 2, 5],
  flashOpacity: [0, 0.25, 0],
};

/**
 * SceneCard — Phase A Scene Sequence Renderer 의 단일 씬 렌더러.
 *
 * 기존 Hook/Body/CTA 3개 컴포넌트가 전체 대본을 받아 3 시퀀스로 쪼갰다면,
 * 이 컴포넌트는 "대본 1문장 = 1 Remotion Sequence" 구조에서 한 씬을 담당한다.
 *
 * Props:
 * - text: 이 씬의 대본 문장 (1문장, 권장 32자 내외)
 * - section: 'hook' | 'point' | 'cta' (스타일 결정)
 * - sceneIndex: 0부터 시작하는 전역 씬 인덱스 (kinetic variant 로테이션 용도)
 * - totalScenes: 전체 씬 수 (진행률 표시 등 보조 용)
 * - preset: 프리셋 객체 ({ colors, mesh, kineticHook, kineticBody })
 * - imageUrl: 배경 이미지 URL (optional) — 있으면 Ken Burns
 * - cameraMotion: 'static'|'ken-burns'|'zoom-in'|'pan' (이미지 있을 때)
 * - subtitle: 자막 override (optional)
 * - textPosition: 'top'|'center'|'center-large'|'bottom'|'free'
 * - badge: 훅 씬의 뱃지 텍스트 (optional, section==='hook' 일 때만)
 * - ctaButtonText: CTA 씬의 버튼 문구 (optional)
 *
 * 디자인:
 * - 씬 타입(hook/point/cta)에 따라 글자 크기·애니메이션·장식 다름
 * - 씬 인덱스 기반 kinetic 변형 로테이션 — 시각 리듬 단조로움 방지
 * - 이미지 없을 때도 mesh 배경 위에 큰 타이포로 visual 유지
 */
export const SceneCard = ({
  text,
  section = 'point',
  sceneIndex = 0,
  totalScenes = 1,
  preset,
  imageUrl,
  cameraMotion = 'ken-burns',
  subtitle,
  textPosition = 'center',
  badge,
  ctaButtonText,
  isFirst = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors } = preset;

  // ── 씬 인덱스 기반 kinetic variant 로테이션 ──
  // 프리셋이 kineticHook/kineticBody를 지정하면 그걸 우선 사용,
  // 그 외 씬은 6종 variants를 순환하며 시각 리듬 확보.
  let kineticVariant;
  if (section === 'hook') {
    kineticVariant = preset.kineticHook || 'wordReveal';
  } else if (section === 'cta') {
    kineticVariant = 'scaleBounce';
  } else {
    // point 씬: 로테이션
    const bodyBase = preset.kineticBody || 'slideUpMask';
    if (sceneIndex % 3 === 0) {
      kineticVariant = bodyBase;
    } else if (sceneIndex % 3 === 1) {
      kineticVariant = KINETIC_VARIANTS[(sceneIndex + 1) % KINETIC_VARIANTS.length];
    } else {
      kineticVariant = 'wordReveal';
    }
  }

  // ── 텍스트 크기: 섹션별 기본값 + 길이 적응 ──
  // hook/cta는 고유 크기 + 적응, point 씬은 안정적 크기로 널뛰기 방지.
  const textLen = (text || '').length;
  let fontSize;
  if (section === 'hook') {
    // Hook: 88 → 최소 56 (임팩트 유지)
    fontSize = textLen > 14
      ? Math.max(SIZES.hookTitle - Math.floor((textLen - 14) * 0.8), 56)
      : SIZES.hookTitle;
  } else if (section === 'cta') {
    fontSize = SIZES.ctaHeadline; // 56 고정
  } else {
    // Point 씬: 60 고정 (길이에 무관하게 일관된 크기 → 널뛰기 방지)
    // 매우 긴 문장(40자+)만 축소
    fontSize = textLen > 40 ? Math.max(60 - Math.floor((textLen - 40) * 0.3), 48) : 60;
  }

  // ── 진입 애니메이션 ──
  const badgeIn = spring({ frame: frame - 5, fps, config: SPRING_CONFIG });
  const badgeY = interpolate(badgeIn, [0, 1], [40, 0]);

  // subtitle override 스타일 (Phase F 호환)
  const subtitleStyle = buildSubtitleStyle(subtitle, textPosition);

  // 텍스트 정렬 — 기본 중앙
  const alignItems = 'center';
  const justifyContent =
    textPosition === 'top'
      ? 'flex-start'
      : textPosition === 'bottom'
        ? 'flex-end'
        : 'center';

  // First 3 Seconds 시각 boost — isFirst 일 때만.
  const boostSaturate = isFirst
    ? interpolate(
        frame,
        FIRST_SCENE_BOOST.saturateFrames,
        FIRST_SCENE_BOOST.saturateValues,
        { extrapolateRight: 'clamp' },
      )
    : 1;
  const boostFlashOpacity = isFirst
    ? interpolate(
        frame,
        FIRST_SCENE_BOOST.flashFrames,
        FIRST_SCENE_BOOST.flashOpacity,
        { extrapolateRight: 'clamp' },
      )
    : 0;
  const effectiveCameraMotion = isFirst ? 'zoom-in' : cameraMotion;
  const textWrapperTransform = isFirst ? `scale(${FIRST_SCENE_BOOST.textScale})` : 'none';

  return (
    <AbsoluteFill>
      {imageUrl && (
        <KenBurnsImage
          src={imageUrl}
          overlay={0.55}
          seed={`scene-${sceneIndex}-${text?.slice(0, 10) || ''}`}
          cameraMotion={effectiveCameraMotion}
        />
      )}
      {/* First 3 Seconds 화이트 플래시 — 5f(167ms) 지속 */}
      {isFirst && boostFlashOpacity > 0 && (
        <AbsoluteFill
          style={{
            backgroundColor: '#ffffff',
            opacity: boostFlashOpacity,
            pointerEvents: 'none',
          }}
        />
      )}
      <AbsoluteFill
        style={{
          justifyContent,
          alignItems,
          padding: 80,
          paddingTop: textPosition === 'top' ? 200 : 80,
          paddingBottom: textPosition === 'bottom' ? 240 : 80,
        }}
      >
        {/* Hook 씬 뱃지 */}
        {section === 'hook' && badge && (
          <div
            style={{
              opacity: badgeIn,
              transform: `translateY(${badgeY}px)`,
              backgroundColor: colors.accent,
              color: colors.white,
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: SIZES.hookBadge,
              padding: '14px 32px',
              borderRadius: 100,
              marginBottom: 40,
              letterSpacing: 2,
              boxShadow: `0 8px 24px ${colors.accent}40`,
            }}
          >
            {badge}
          </div>
        )}

        {/* 메인 텍스트 — First 3 Sec boost 래퍼 (scale + saturate) + overflow guard */}
        <div
          style={{
            transform: textWrapperTransform,
            transformOrigin: 'center',
            filter: isFirst ? `saturate(${boostSaturate})` : 'none',
            maxHeight: 800,
            overflow: 'hidden',
          }}
        >
          <KineticText
            variant={kineticVariant}
            text={text || ''}
            frame={frame}
            fps={fps}
            delay={0}
            baseStyle={{
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize,
              color: imageUrl ? colors.white : colors.textPrimary,
              textAlign: 'center',
              lineHeight: 1.2,
              letterSpacing: -0.5,
              textShadow: imageUrl ? '0 8px 32px rgba(0,0,0,0.65)' : 'none',
              maxWidth: 900,
              ...(subtitleStyle || {}),
            }}
          />
        </div>

        {/* CTA 씬 버튼 */}
        {section === 'cta' && ctaButtonText && (
          <div
            style={{
              opacity: badgeIn,
              transform: `translateY(${badgeY}px)`,
              marginTop: 48,
              backgroundColor: colors.accent,
              color: colors.white,
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: SIZES.ctaButton,
              padding: '20px 48px',
              borderRadius: 100,
              boxShadow: `0 12px 32px ${colors.accent}50`,
              letterSpacing: -0.5,
            }}
          >
            {ctaButtonText}
          </div>
        )}
      </AbsoluteFill>

      {/* 씬 인덱스 표시 (디버그용 — 후에 제거하거나 옵션화) */}
      {sceneIndex === 0 && (
        <div
          style={{
            position: 'absolute',
            top: 80,
            right: 80,
            fontFamily: FONTS.primary,
            fontWeight: FONTS.weight.bold,
            fontSize: 24,
            color: colors.accent,
            opacity: 0.7,
            letterSpacing: 1,
          }}
        >
          {`${sceneIndex + 1} / ${totalScenes}`}
        </div>
      )}
    </AbsoluteFill>
  );
};
