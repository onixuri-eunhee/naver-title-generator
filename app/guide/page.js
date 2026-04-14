import infoStyles from '../info.module.css';
import styles from './page.module.css';

export const metadata = {
  title: '사용법 가이드 | 뚝딱툴 200% 활용법',
  description: '5가지 도구를 제대로 쓰는 법 — 입력 꿀팁부터 추천 워크플로우까지. 블로그 제목, 후킹문구, 스레드 글, 블로그 글, 이미지 생성기 사용법.',
  keywords: '뚝딱툴 사용법, 블로그 제목 가이드, 후킹문구 작성법, 스레드 글쓰기 가이드',
  alternates: { canonical: 'https://ddukddaktool.co.kr/guide' },
  openGraph: {
    type: 'website',
    title: '사용법 가이드 | 뚝딱툴 200% 활용법',
    description: '5가지 도구를 제대로 쓰는 법 — 입력 꿀팁부터 추천 워크플로우까지',
    url: 'https://ddukddaktool.co.kr/guide',
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
  },
};

// TOC 데이터
const TOC_ITEMS = [
  { id: 'tool-1', num: '1', label: '블로그 제목 생성기', tag: 'free', tagLabel: '무료' },
  { id: 'tool-2', num: '2', label: '후킹문구 생성기', tag: 'free', tagLabel: '무료' },
  { id: 'tool-3', num: '3', label: '스레드 글 생성기', tag: 'free', tagLabel: '무료' },
  { id: 'tool-4', num: '4', label: '블로그 글 생성기', tag: 'pro', tagLabel: 'PRO' },
  { id: 'tool-5', num: '5', label: '블로그 이미지 생성기', tag: 'pro', tagLabel: 'PRO' },
  { id: 'tool-6', num: '6', label: '카드뉴스 제작기', tag: 'pro', tagLabel: 'PRO' },
  { id: 'tool-7', num: '7', label: '황금키워드 찾기', tag: 'free', tagLabel: 'NEW' },
  { id: 'workflow', num: '8', label: '추천 워크플로우', tag: 'free', tagLabel: '' },
  { id: 'pricing', num: '$', label: '과금 안내', tag: 'free', tagLabel: '' },
];

export default function GuidePage() {
  return (
    <main className={infoStyles.root}>
      <div className={infoStyles.heroBanner}>
        <div className={styles.heroBadge}>사용법 가이드</div>
        <h1>뚝딱툴 <em>200% 활용법</em></h1>
        <p>5가지 도구를 제대로 쓰는 법 — 입력 꿀팁부터 추천 워크플로우까지</p>
      </div>

      <div className={infoStyles.container}>
        <div className={styles.toc}>
          <h2>목차</h2>
          <ul className={styles.tocList}>
            {TOC_ITEMS.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`}>
                  <span className={styles.tocNum}>{item.num}</span>
                  {item.label}
                  {item.tagLabel && (
                    <span className={item.tag === 'pro' ? styles.tocPro : styles.tocFree}>
                      {item.tagLabel}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Tool 1: 블로그 제목 생성기 */}
        <details open className={styles.toolAccordion} id="tool-1">
          <summary>
            <h2>1. 블로그 제목 생성기</h2>
            <span className={styles.toolBadgeFree}>무료</span>
          </summary>
          <div className={styles.toolBody}>
            <p className={styles.toolIntro}>업종과 키워드만 입력하면, 네이버 블로그 상위 노출에 최적화된 <strong>클릭을 부르는 제목 12가지 패턴</strong>을 자동으로 만들어드립니다.</p>

            <h3 className={styles.subTitle}>입력 필드</h3>
            <table className={styles.guideTable}>
              <tbody>
                <tr><th>필드</th><th>필수</th><th>설명</th></tr>
                <tr><td><strong>업종 선택</strong></td><td>선택</td><td>웨딩/결혼, 요식업/카페, 온라인 강의/교육, 뷰티/피부/헤어, 부동산/인테리어, 헬스/운동, 마케팅/블로그, 기타</td></tr>
                <tr><td><strong>핵심 키워드</strong></td><td>필수</td><td>블로그 글의 핵심 주제 (30자 이내). 업종 선택 시 추천 태그가 표시됩니다</td></tr>
              </tbody>
            </table>

            <h3 className={styles.subTitle}>꿀팁 5개</h3>
            <ul className={styles.tipList}>
              <li><span className={styles.tipNum}>1</span><span><strong>키워드는 2~4단어 조합이 최적.</strong> &quot;블로그&quot;보다 &quot;자영업자 블로그 마케팅&quot;처럼 구체적으로 입력할수록 경쟁이 낮고 검색 의도에 맞는 제목이 나옵니다.</span></li>
              <li><span className={styles.tipNum}>2</span><span><strong>업종을 먼저 선택하세요.</strong> 추천 키워드 태그가 뜨는데, 클릭해서 시작하면 감을 잡기 쉽습니다.</span></li>
              <li><span className={styles.tipNum}>3</span><span><strong>12가지 패턴 중 2~3개를 골라 살짝 수정하세요.</strong> &quot;2개월 만에 매출 2배&quot; 같은 표현은 실제 내용에 맞게 바꿔주는 게 좋습니다.</span></li>
              <li><span className={styles.tipNum}>4</span><span><strong>같은 키워드로 여러 번 생성해 보세요.</strong> AI가 매번 다른 제목을 만들어줍니다. 2~3번 돌려서 가장 좋은 것을 고르세요.</span></li>
              <li><span className={styles.tipNum}>5</span><span><strong>핵심 키워드를 제목 맨 앞에 두세요.</strong> 네이버는 앞쪽 단어에 더 높은 가중치를 줍니다.</span></li>
            </ul>

            <h3 className={styles.subTitle}>결과 구성</h3>
            <table className={styles.guideTable}>
              <tbody>
                <tr><th>챕터</th><th>패턴</th><th>성격</th></tr>
                <tr><td>Chapter 1. 긍정</td><td>이득+숫자형, 성공 사례형, 전문가 가이드형, 방법+체크리스트형</td><td>&quot;이걸 알면 이득&quot;</td></tr>
                <tr><td>Chapter 2. 위협</td><td>모르면 손해형, 공통점 경고형, 의심하라형, 공동의 적형</td><td>&quot;모르면 손해&quot;</td></tr>
                <tr><td>Chapter 3. 호기심</td><td>가치 입증형, 상식 파괴형, 질문&비교형, 타깃 호출형</td><td>&quot;궁금해서 클릭&quot;</td></tr>
              </tbody>
            </table>
          </div>
        </details>

        {/* Tool 2: 후킹문구 생성기 */}
        <details className={styles.toolAccordion} id="tool-2">
          <summary>
            <h2>2. 후킹문구 생성기</h2>
            <span className={styles.toolBadgeFree}>무료</span>
          </summary>
          <div className={styles.toolBody}>
            <p className={styles.toolIntro}>업종과 키워드를 입력하면, 심리학 기반 <strong>스크롤 멈추는 후킹문구 15개</strong>를 즉시 생성합니다. 인스타 릴스, 블로그 첫 줄, 유튜브 쇼츠, 전단지 헤드라인 등 어디서든 쓸 수 있습니다.</p>
            <h3 className={styles.subTitle}>꿀팁 5개</h3>
            <ul className={styles.tipList}>
              <li><span className={styles.tipNum}>1</span><span><strong>조합을 바꿔가며 여러 번 생성하세요.</strong> 100가지 이상의 풀에서 랜덤으로 15개가 선정됩니다.</span></li>
              <li><span className={styles.tipNum}>2</span><span><strong>문구 뒤에 내 사업의 구체적 숫자를 붙이면 효과 2배.</strong></span></li>
              <li><span className={styles.tipNum}>3</span><span><strong>인스타 릴스 첫 자막, 카드뉴스 첫 장에 그대로 넣으세요.</strong> 0.3초 안에 스크롤을 멈추게 하는 것이 목적입니다.</span></li>
              <li><span className={styles.tipNum}>4</span><span><strong>한글 조사가 자동 처리됩니다.</strong> &quot;필라테스가&quot;, &quot;필라테스를&quot; 등 자연스럽게 붙습니다.</span></li>
              <li><span className={styles.tipNum}>5</span><span><strong>[복사] 버튼으로 바로 복사.</strong> 개별 복사 또는 [전체 복사]로 15개를 한번에 가져갈 수 있습니다.</span></li>
            </ul>
          </div>
        </details>

        {/* Tool 3: 스레드 글 생성기 */}
        <details className={styles.toolAccordion} id="tool-3">
          <summary>
            <h2>3. 스레드 글 생성기</h2>
            <span className={styles.toolBadgeFree}>무료</span>
          </summary>
          <div className={styles.toolBody}>
            <p className={styles.toolIntro}>소재만 입력하면 <strong>터지는 Threads(스레드) 글 3개</strong>를 AI가 뚝딱 만들어줍니다. 글 유형과 말투를 선택할 수 있어서, 내 브랜드 느낌에 맞는 글이 나옵니다.</p>
            <h3 className={styles.subTitle}>글 유형 & 말투</h3>
            <table className={styles.guideTable}>
              <tbody>
                <tr><th>글 유형</th><th>특징</th><th>추천 상황</th></tr>
                <tr><td><strong>정보형</strong></td><td>&quot;N가지 팁&quot; 숫자 리스트</td><td>전문 지식 공유, 노하우 전달</td></tr>
                <tr><td><strong>공감형</strong></td><td>감정을 짚고 경험담으로 위로</td><td>고객 고충 공감, 신뢰 구축</td></tr>
                <tr><td><strong>반전형</strong></td><td>상식을 뒤엎는 한 방</td><td>화제성 콘텐츠, 의견 표출</td></tr>
                <tr><td><strong>궁금증형</strong></td><td>스토리 절반만 공개</td><td>참여 유도, 팔로워 늘리기</td></tr>
              </tbody>
            </table>
            <h3 className={styles.subTitle}>꿀팁</h3>
            <ul className={styles.tipList}>
              <li><span className={styles.tipNum}>1</span><span><strong>&quot;메모&quot; 칸을 적극 활용하세요.</strong> 경험 한 줄로 글 퀄리티가 확 올라갑니다.</span></li>
              <li><span className={styles.tipNum}>2</span><span><strong>결과 3개(안 1, 2, 3)를 비교하세요.</strong></span></li>
              <li><span className={styles.tipNum}>3</span><span><strong>단문체 + 반전형 = 바이럴 최강 조합.</strong></span></li>
            </ul>
          </div>
        </details>

        {/* Tool 4: 블로그 글 생성기 */}
        <details className={styles.toolAccordion} id="tool-4">
          <summary>
            <h2>4. 블로그 글 생성기</h2>
            <span className={styles.toolBadgePro}>PRO</span>
          </summary>
          <div className={styles.toolBody}>
            <p className={styles.toolIntro}>업종과 주제만 입력하면 <strong>네이버 홈피드, 네이버 SEO, 구글 SEO에 최적화된 상위노출 블로그 글</strong>을 AI가 자동으로 작성합니다. 제목, 도입부, 본문, 해시태그, 내부링크 추천까지 한 번에.</p>
            <h3 className={styles.subTitle}>글 유형 · 톤 · CTA 상세</h3>
            <table className={styles.guideTable}>
              <tbody>
                <tr><th>글 유형</th><th>특징</th><th>추천</th></tr>
                <tr><td><strong>네이버 홈피드</strong></td><td>홈 탭 AI 추천 노출용</td><td>네이버 앱 홈 탭</td></tr>
                <tr><td><strong>네이버 SEO</strong></td><td>VIEW 상위노출</td><td>네이버 검색</td></tr>
                <tr><td><strong>구글 SEO</strong></td><td>구글 검색 + FAQ 포함</td><td>구글 유입 확대</td></tr>
              </tbody>
            </table>
            <h3 className={styles.subTitle}>꿀팁 5개</h3>
            <ul className={styles.tipList}>
              <li><span className={styles.tipNum}>1</span><span><strong>&quot;추가 요청사항&quot;이 글의 품질을 결정합니다.</strong> 내 경험, 경력, 에피소드, 손님 반응 등을 넣을수록 &quot;나만의 글&quot;이 됩니다.</span></li>
              <li><span className={styles.tipNum}>2</span><span><strong>&quot;업종/입장&quot;은 역할까지 구체적으로.</strong> &quot;미용실&quot;이 아니라 &quot;미용실 원장&quot;으로.</span></li>
              <li><span className={styles.tipNum}>3</span><span><strong>예시 캐러셀을 먼저 확인하세요.</strong></span></li>
              <li><span className={styles.tipNum}>4</span><span><strong>지역을 넣으면 지역 키워드가 자연스럽게 포함됩니다.</strong></span></li>
              <li><span className={styles.tipNum}>5</span><span><strong>생성 후 &quot;이 글에 맞는 이미지 생성하기&quot; 버튼.</strong> 글이 이미지 생성기로 자동 전달됩니다.</span></li>
            </ul>
          </div>
        </details>

        {/* Tool 5: 블로그 이미지 생성기 */}
        <details className={styles.toolAccordion} id="tool-5">
          <summary>
            <h2>5. 블로그 이미지 생성기 (프리미엄)</h2>
            <span className={styles.toolBadgePro}>PRO</span>
          </summary>
          <div className={styles.toolBody}>
            <p className={styles.toolIntro}>블로그 글을 붙여넣거나 주제를 입력하면, <strong>문맥에 맞는 AI 이미지를 자동 생성</strong>하고 <strong>썸네일에 텍스트까지 합성</strong>해줍니다.</p>
            <h3 className={styles.subTitle}>꿀팁 5개</h3>
            <ul className={styles.tipList}>
              <li><span className={styles.tipNum}>1</span><span><strong>블로그 글 생성기와 연동해서 쓰세요.</strong> 결과 하단 [이 글에 맞는 이미지 생성하기] 버튼으로 글이 자동 전달됩니다.</span></li>
              <li><span className={styles.tipNum}>2</span><span><strong>마커는 수정, 삭제, 추가가 가능합니다.</strong></span></li>
              <li><span className={styles.tipNum}>3</span><span><strong>썸네일 텍스트는 10~15자가 최적.</strong></span></li>
              <li><span className={styles.tipNum}>4</span><span><strong>직접 입력 모드는 글 없이도 사용 가능.</strong></span></li>
              <li><span className={styles.tipNum}>5</span><span><strong>마음에 안 들면 [전체 재생성].</strong></span></li>
            </ul>
          </div>
        </details>

        {/* Tool 6: 카드뉴스 제작기 */}
        <details className={styles.toolAccordion} id="tool-6">
          <summary>
            <h2>6. 카드뉴스 제작기</h2>
            <span className={styles.toolBadgePro}>PRO</span>
          </summary>
          <div className={styles.toolBody}>
            <p className={styles.toolIntro}>블로그 글이나 텍스트를 붙여넣으면 <strong>인스타그램용 카드뉴스를 AI가 자동으로 제작</strong>합니다. 테마, 브랜드 컬러 선택 후 ZIP으로 한 번에 다운로드.</p>
            <h3 className={styles.subTitle}>꿀팁 5개</h3>
            <ul className={styles.tipList}>
              <li><span className={styles.tipNum}>1</span><span><strong>블로그 글 생성기와 연동.</strong> 원소스 멀티유즈.</span></li>
              <li><span className={styles.tipNum}>2</span><span><strong>텍스트는 짧고 핵심만.</strong> 한 장에 1~2문장이 적정.</span></li>
              <li><span className={styles.tipNum}>3</span><span><strong>브랜드 컬러를 설정하세요.</strong></span></li>
              <li><span className={styles.tipNum}>4</span><span><strong>SNS 핸들을 넣으세요.</strong></span></li>
              <li><span className={styles.tipNum}>5</span><span><strong>ZIP 다운로드 후 인스타에 바로 업로드.</strong> 4:5 비율(1080x1350)로 최적화.</span></li>
            </ul>
          </div>
        </details>

        {/* Tool 7: 황금키워드 찾기 */}
        <details className={styles.toolAccordion} id="tool-7">
          <summary>
            <h2>7. 황금키워드 찾기</h2>
            <span className={styles.toolBadgeNew}>NEW</span>
          </summary>
          <div className={styles.toolBody}>
            <p className={styles.toolIntro}>내 분야, 타겟 독자 정보를 입력하면 <strong>AI + 네이버 데이터 분석</strong>으로 검색량은 높고 경쟁은 낮은 <strong>황금키워드</strong>를 자동으로 찾아드립니다.</p>
            <h3 className={styles.subTitle}>결과 읽는 법</h3>
            <table className={styles.guideTable}>
              <tbody>
                <tr><td><strong>황금점수</strong></td><td>100점 만점. 80점 이상이면 즉시 글을 쓸 가치</td></tr>
                <tr><td><strong>월간 검색수</strong></td><td>네이버에서 한 달간 검색되는 횟수. 1,000~5,000이 황금 구간</td></tr>
                <tr><td><strong>경쟁도</strong></td><td>광고 경쟁 수준. &quot;낮음&quot;이 좋음</td></tr>
                <tr><td><strong>포화도</strong></td><td>블로그 발행량 / 검색수. 3 이하면 블루오션</td></tr>
                <tr><td><strong>트렌드</strong></td><td>최근 3개월 검색량 추세. &quot;상승&quot;이면 지금 선점하세요</td></tr>
              </tbody>
            </table>
            <h3 className={styles.subTitle}>꿀팁</h3>
            <ul className={styles.tipList}>
              <li><span className={styles.tipNum}>1</span><span><strong>자주 받는 질문을 많이 쓰세요.</strong> 실제 고객 질문이 가장 좋은 시드키워드 소스입니다.</span></li>
              <li><span className={styles.tipNum}>2</span><span><strong>포화도를 꼭 확인하세요.</strong> 검색량이 높아도 포화도 5 이상이면 상위 노출이 어렵습니다.</span></li>
              <li><span className={styles.tipNum}>3</span><span><strong>[글쓰기] 버튼으로 바로 연결.</strong></span></li>
              <li><span className={styles.tipNum}>4</span><span><strong>CSV 다운로드로 엑셀 분석.</strong></span></li>
            </ul>
          </div>
        </details>

        {/* Section 8: 워크플로우 */}
        <div id="workflow" style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>8. 추천 워크플로우</h2>
          <p className={styles.toolIntro}>도구를 조합해서 쓰면 효과가 배로 올라갑니다.</p>

          <div className={styles.workflowBox}>
            <h3>블로그 글 하나 완성하기</h3>
            <div className={styles.workflowStep}><span className={styles.stepBadge}>STEP 1</span><span className={styles.stepText}><strong>블로그 제목 생성기</strong> → 12가지 패턴 중 최적 제목 선택</span></div>
            <div className={styles.stepArrow}>↓</div>
            <div className={styles.workflowStep}><span className={styles.stepBadge}>STEP 2</span><span className={styles.stepText}><strong>후킹문구 생성기</strong> → 블로그 첫 문장에 활용할 후킹 선택</span></div>
            <div className={styles.stepArrow}>↓</div>
            <div className={styles.workflowStep}><span className={styles.stepBadge}>STEP 3</span><span className={styles.stepText}><strong>블로그 글 생성기</strong> → 제목·도입부·본문·마무리·해시태그 한 번에 생성</span></div>
            <div className={styles.stepArrow}>↓</div>
            <div className={styles.workflowStep}><span className={styles.stepBadge}>STEP 4</span><span className={styles.stepText}><strong>블로그 이미지 생성기</strong> → 글에 맞는 이미지 자동 생성</span></div>
            <div className={styles.stepArrow}>↓</div>
            <div className={styles.workflowStep}><span className={styles.stepBadge}>STEP 5</span><span className={styles.stepText}><strong>네이버 블로그에 발행</strong></span></div>
          </div>

          <div className={styles.workflowBox}>
            <h3>SNS 마케팅 집중 루틴 (주간)</h3>
            <div className={styles.workflowStep}><span className={styles.stepBadge}>STEP 1</span><span className={styles.stepText}><strong>후킹문구 생성기</strong> → 이번 주 홍보 내용으로 15개 생성 → 하루 3개씩 인스타 릴스</span></div>
            <div className={styles.stepArrow}>↓</div>
            <div className={styles.workflowStep}><span className={styles.stepBadge}>STEP 2</span><span className={styles.stepText}><strong>스레드 글 생성기</strong> → 같은 주제로 글 3개 → 주 3회 스레드 발행</span></div>
            <div className={styles.stepArrow}>↓</div>
            <div className={styles.workflowStep}><span className={styles.stepBadge}>STEP 3</span><span className={styles.stepText}><strong>블로그 글 생성기</strong> → 주 1회 상세 블로그 글 → SNS에서 블로그로 유입 유도</span></div>
          </div>
        </div>

        {/* Section 9: 과금 안내 */}
        <div id="pricing" className={styles.pricingSection}>
          <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>과금 안내</h2>

          <div className={styles.pricingCurrent}>
            <h3>현재 (오픈 기념 한시 무료)</h3>
            <table className={styles.guideTable}>
              <tbody>
                <tr><th>구분</th><th>도구</th><th>비용</th></tr>
                <tr><td>무료</td><td>블로그 제목, 후킹문구, 스레드 글</td><td><strong>1일 5회 완전 무료</strong></td></tr>
                <tr><td>무료</td><td>블로그 글</td><td><strong>회원 1일 5회 / 비회원 1일 3회</strong></td></tr>
                <tr><td>무료</td><td>프리미엄 이미지, 카드뉴스, 황금키워드</td><td><strong>회원 1일 3회 한시 무료</strong></td></tr>
              </tbody>
            </table>
          </div>

          <div className={styles.pricingFuture}>
            <h3>4/25 이후 가격 정책 (정식 런칭)</h3>
            <table className={styles.guideTable}>
              <tbody>
                <tr><th>항목</th><th>내용</th></tr>
                <tr><td><strong>상품</strong></td><td>30크레딧 = 9,900원 (단일 상품)</td></tr>
                <tr><td><strong>구매 제한</strong></td><td>1회 최대 5세트 (최대 150크레딧)</td></tr>
                <tr><td><strong>차감 기준</strong></td><td>블로그 글 1cr / 프리미엄 이미지 3cr / 카드뉴스 1cr / 황금키워드 1cr / 숏폼 6~12cr / 롱폼 12~29cr</td></tr>
                <tr><td><strong>무료 도구</strong></td><td>블로그 제목, 후킹문구, 스레드 글은 계속 무료</td></tr>
              </tbody>
            </table>
          </div>

          <div className={styles.pricingHighlight}>
            <h3>오픈톡방 회원 혜택</h3>
            <p>첫 구매 시 <strong>크레딧 20% 추가 지급</strong><br />
              예: 30크레딧 구매 → <strong>36크레딧</strong> / 150크레딧 → <strong>180크레딧</strong></p>
          </div>
        </div>

        <div className={styles.ctaBox}>
          <h3>지금 바로 도구를 사용해보세요</h3>
          <p>키워드 하나만 입력하면 클릭 부르는 제목 12가지가 즉시 생성됩니다</p>
          <a href="/" className={styles.ctaBtn}>블로그 제목 생성기 바로가기</a>
        </div>
      </div>
    </main>
  );
}
