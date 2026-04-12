import styles from '../info.module.css';

export const metadata = {
  title: '후킹문구의 심리학 | 8가지 원리로 클릭을 만드는 법',
  description: '손실 회피, 호기심 격차, 사회적 증거 등 마케팅 심리학 8가지 원리로 후킹문구가 작동하는 원리를 설명합니다.',
  keywords: '후킹문구 심리학, 마케팅 심리학, 손실 회피, 호기심 격차, 사회적 증거',
  alternates: { canonical: 'https://ddukddaktool.co.kr/hooking-psychology' },
  openGraph: {
    type: 'article',
    title: '후킹문구는 사람의 심리와 맞닿아 있습니다',
    description: '왜 어떤 문구는 스크롤을 멈추고, 어떤 문구는 그냥 지나칠까요?',
    url: 'https://ddukddaktool.co.kr/hooking-psychology',
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
  },
};

const PSYCHOLOGIES = [
  { icon: '😰', title: '1. 손실 회피 심리', desc: '인간은 같은 크기의 이익보다 손실에 2.5배 더 강하게 반응합니다. "모르면 손해"라는 느낌이 클릭을 만듭니다.', example: '"이거 모르면 미용실에서 손해봅니다"' },
  { icon: '🤔', title: '2. 호기심 격차 이론', desc: '알고 싶은데 모른다는 \'정보 격차\'가 불편함을 만들고, 그 불편함을 해소하기 위해 클릭합니다.', example: '"전문가들이 숨겨두는 필라테스 노하우"' },
  { icon: '👥', title: '3. 사회적 증거', desc: '다른 사람들이 하는 행동을 따르려는 본능입니다. 숫자와 집단이 포함된 문구가 신뢰를 만듭니다.', example: '"10명 중 9명이 이걸 잘못하고 있어요"' },
  { icon: '🚨', title: '4. 경고·위험 신호', desc: '인간의 뇌는 위험 신호에 가장 빠르게 반응합니다. 생존 본능이 클릭을 유도합니다.', example: '"이거 잘못하면 헬스장에서 부상납니다"' },
  { icon: '💡', title: '5. 상식 위반 효과', desc: '기존 믿음과 반대되는 정보는 뇌의 주의를 강제로 끌어당깁니다. 예상을 깨는 문구가 강력합니다.', example: '"운동을 열심히 할수록 살이 더 찌는 이유"' },
  { icon: '🔢', title: '6. 구체성의 힘', desc: '숫자와 구체적인 표현은 뇌에 신뢰를 만듭니다. 막연한 약속보다 구체적인 수치가 클릭을 부릅니다.', example: '"5분 만에 블로그 제목 고민 끝내는 법"' },
  { icon: '🪞', title: '7. 자아 관련성', desc: '자신의 상황과 직접 연결된 문구에 강하게 반응합니다. \'나의 이야기\'라는 느낌이 클릭을 만듭니다.', example: '"카페 사장님 중 단골 만들기 고민하는 분"' },
  { icon: '⚡', title: '8. 즉시성 욕구', desc: '인간은 즉각적인 보상을 선호합니다. \'지금 바로\', \'즉시\', \'5분 만에\' 같은 표현이 행동을 유발합니다.', example: '"지금 당장 써먹을 수 있는 후킹문구 15개"' },
];

export default function HookingPsychologyPage() {
  return (
    <main className={styles.root}>
      <div className={styles.heroBanner}>
        <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, color: '#fff', background: 'rgba(255, 255, 255, 0.15)', padding: '4px 10px', borderRadius: 6, marginBottom: 14 }}>
          🧠 마케팅 심리학
        </div>
        <h1>후킹문구는<br /><em>사람의 심리와 맞닿아 있습니다</em></h1>
        <p>왜 어떤 문구는 스크롤을 멈추고, 어떤 문구는 그냥 지나칠까요?<br />클릭을 만드는 건 기술이 아니라 인간의 심리입니다.</p>
      </div>

      <div className={styles.container}>
        <div className={styles.card}>
          <h2>🤔 0.3초의 싸움</h2>
          <p>사람들이 SNS 피드를 스크롤하는 속도는 평균 <strong>0.3초</strong>입니다. 이 찰나에 스크롤이 멈추지 않으면 아무리 좋은 콘텐츠도 존재하지 않는 것과 같습니다.</p>
          <p>그렇다면 무엇이 스크롤을 멈추게 할까요? 예쁜 사진? 화려한 디자인? 물론 영향이 있습니다. 하지만 가장 강력한 것은 <strong>첫 줄의 문장, 즉 후킹문구</strong>입니다.</p>
          <p>후킹문구는 단순히 관심을 끄는 문장이 아닙니다. 그것은 인간의 뇌가 수만 년에 걸쳐 발달시킨 <strong>생존 본능과 감정 회로를 자극하는 신호</strong>입니다. 잘 만들어진 후킹문구 앞에서 사람의 뇌는 의식적으로 판단하기 전에 이미 반응합니다.</p>
          <div className={styles.highlight}>💡 후킹문구의 본질: 사람은 논리로 클릭하지 않습니다. 감정으로 클릭하고, 나중에 논리로 정당화합니다.</div>
        </div>

        <div className={styles.card}>
          <h2>🧠 후킹문구에 숨겨진 8가지 심리 원리</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            {PSYCHOLOGIES.map((p, i) => (
              <div key={i} style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>{p.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{p.title}</div>
                <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.7, marginBottom: 8 }}>{p.desc}</div>
                <div style={{ fontSize: 11, fontStyle: 'italic', color: '#9A3412', background: '#FFF7ED', padding: '6px 10px', borderRadius: 6 }}>{p.example}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.card}>
          <h2>⚖️ 손실 회피 심리를 더 깊이 이해하기</h2>
          <p>노벨 경제학상을 받은 대니얼 카너먼의 연구에 따르면, 인간은 <strong>100만 원을 얻는 기쁨보다 100만 원을 잃는 고통을 2.5배 크게 느낍니다</strong>. 이것이 손실 회피 심리입니다.</p>
          <p>마케팅에서 이 원리를 적용하면 강력한 차이가 생깁니다. 자영업자 대상 마케팅에서 이 원리가 특히 강력하게 작용하는 이유는, 사업을 운영하는 사람일수록 <strong>놓치는 것에 대한 두려움</strong>이 크기 때문입니다.</p>
        </div>

        <div className={styles.card}>
          <h2>🏪 자영업자에게 후킹문구가 특히 중요한 이유</h2>
          <p>대형 브랜드는 광고비로 노출을 삽니다. 하지만 자영업자는 예산이 제한적입니다. 그래서 유기적 콘텐츠, 즉 SNS 포스팅과 블로그 글의 첫 줄 한 문장이 광고의 역할을 해야 합니다.</p>
          <p>19년간 3,500쌍 이상의 웨딩 커플을 상담하면서 깨달은 것이 있습니다. <strong>고객은 서비스를 사는 게 아니라, 자신의 문제가 해결되는 장면을 삽니다.</strong> 후킹문구는 그 장면을 처음으로 보여주는 창문입니다.</p>
          <div className={styles.highlight}>💡 후킹문구의 최종 목적: 클릭을 만드는 것이 아닙니다. 독자로 하여금 &quot;이 사람이 나를 이해한다&quot;고 느끼게 만드는 것입니다.</div>
        </div>

        <div style={{ background: 'linear-gradient(135deg, #1A1A2E, #2D2D4E)', borderRadius: 14, padding: '36px 24px', textAlign: 'center', marginTop: 24 }}>
          <h3 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 8 }}>심리학 기반 후킹문구, 지금 바로 만들어보세요</h3>
          <p style={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.8)', marginBottom: 20 }}>업종과 키워드를 입력하면 8가지 심리 원리가 적용된 후킹문구 15개를 즉시 생성합니다</p>
          <a href="/hook-generator" style={{ display: 'inline-block', padding: '14px 32px', background: '#ff5f1f', color: '#fff', borderRadius: 12, fontWeight: 700, textDecoration: 'none' }}>🔥 후킹문구 생성기 바로가기</a>
        </div>
      </div>
    </main>
  );
}
