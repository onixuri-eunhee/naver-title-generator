import styles from '../info.module.css';

export const metadata = {
  title: '환불규정 | 뚝딱툴',
  description: '뚝딱툴 환불규정 — 크레딧 결제 환불 기준, 환불 불가 항목, 환불 절차',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://ddukddaktool.co.kr/refund-policy' },
};

export default function RefundPolicyPage() {
  return (
    <main className={styles.root}>
      <div className={styles.container} style={{ paddingTop: 40 }}>
        <div className={styles.pageTitle}>환불규정</div>
        <div className={styles.pageDate}>시행일: 2026년 3월 13일 | 운영사: 어나더핸즈</div>

        <div className={styles.card}>
          <h2>제1조 기본 원칙</h2>
          <p>뚝딱툴(ddukddaktool.co.kr, 이하 &quot;서비스&quot;)은 전자상거래 등에서의 소비자보호에 관한 법률 및 관련 법령에 따라 이용자의 권익을 보호합니다.</p>
          <p>서비스는 AI 기반 콘텐츠 생성 도구를 월정액 구독 방식으로 제공하며, 디지털 콘텐츠의 특성상 아래 환불 기준을 적용합니다.</p>
        </div>

        <div className={styles.card}>
          <h2>제2조 서비스 유형</h2>
          <table className={styles.table}>
            <tbody>
              <tr>
                <th>서비스</th>
                <th>유형</th>
                <th>차감 크레딧</th>
              </tr>
              <tr>
                <td colSpan={3} style={{ background: '#F0FDF4', fontWeight: 700, color: '#1A1A2E' }}>
                  💳 크레딧 충전 — 30크레딧 / 9,900원 (건별 결제)
                </td>
              </tr>
              <tr>
                <td>블로그 글 생성기</td>
                <td>유료 (크레딧 차감)</td>
                <td>1회 = <strong>1크레딧</strong></td>
              </tr>
              <tr>
                <td>프리미엄 이미지 생성기</td>
                <td>유료 (크레딧 차감)</td>
                <td>1회 = <strong>3크레딧</strong></td>
              </tr>
              <tr>
                <td colSpan={3} style={{ background: '#F8F9FD', fontWeight: 700, color: '#1A1A2E' }}>
                  🆓 무료 도구 — 스레드 글 생성기 · 블로그 제목 생성기 · 후킹문구 생성기
                </td>
              </tr>
            </tbody>
          </table>
          <p>※ 크레딧은 충전일로부터 1년간 유효합니다.</p>
          <p>※ 가격은 서비스 운영 정책에 따라 변경될 수 있으며, 변경 시 14일 전 공지합니다.</p>
        </div>

        <div className={styles.card}>
          <h2>제3조 환불 기준</h2>
          <div className={styles.highlight}>
            크레딧 결제일로부터 7일 이내, 크레딧을 사용하지 않은 경우 전액 환불 가능합니다.
          </div>
          <table className={styles.table}>
            <tbody>
              <tr>
                <th>환불 신청 시점</th>
                <th>크레딧 사용 여부</th>
                <th>환불 금액</th>
              </tr>
              <tr>
                <td>결제일로부터 7일 이내</td>
                <td>미사용 (잔여 크레딧 = 충전 크레딧)</td>
                <td>전액 환불</td>
              </tr>
              <tr>
                <td>결제일로부터 7일 이내</td>
                <td>1크레딧 이상 사용</td>
                <td>환불 불가</td>
              </tr>
              <tr>
                <td>결제일로부터 7일 초과</td>
                <td>사용 여부 무관</td>
                <td>환불 불가</td>
              </tr>
              <tr>
                <td>서비스 장애 (당사 귀책)</td>
                <td>무관</td>
                <td>사용 불가 크레딧 복구 또는 환불</td>
              </tr>
            </tbody>
          </table>
          <div className={styles.warn}>
            ⚠️ AI 생성 도구 특성상, 생성 결과물이 기대와 다르다는 이유만으로는 환불이 불가합니다. 무료 도구(스레드 글 생성기, 블로그 제목 생성기 등)를 먼저 이용해보신 후 크레딧을 충전하시길 권장합니다.
          </div>
        </div>

        <div className={styles.card}>
          <h2>제4조 환불이 불가한 경우</h2>
          <ul>
            <li>크레딧을 1회 이상 사용한 경우</li>
            <li>결제일로부터 7일이 경과한 경우</li>
            <li>이용자의 단순 변심 (크레딧 사용 이력 있을 시)</li>
            <li>생성된 콘텐츠 결과물이 마음에 들지 않는다는 이유</li>
            <li>크레딧 유효기간(1년) 만료 후 잔여 크레딧</li>
            <li>이용자의 인터넷 환경, 기기 문제로 인한 서비스 이용 불편</li>
            <li>이용약관 위반으로 서비스 이용이 제한된 경우</li>
          </ul>
        </div>

        <div className={styles.card}>
          <h2>제5조 환불 신청 방법 및 처리</h2>
          <ul>
            <li>환불 신청: 고객센터 이메일로 신청 (아래 연락처 참고)</li>
            <li>신청 시 필요 정보: 결제 시 사용한 이메일, 결제일, 환불 사유</li>
            <li>처리 기간: 환불 확인 후 영업일 기준 3~5일 이내 처리</li>
            <li>환불 방법: 결제 수단으로 원상 환불 (카드 취소 또는 계좌 이체)</li>
          </ul>
          <p style={{ marginTop: 16 }}>※ 환불 처리 과정에서 추가 확인이 필요한 경우 이메일로 안내드립니다.</p>
        </div>

        <div className={styles.card}>
          <h2>제6조 크레딧 유효기간</h2>
          <p>충전된 크레딧은 결제일로부터 1년간 유효합니다. 유효기간 내 미사용 크레딧은 자동 소멸되며, 소멸된 크레딧은 환불되지 않습니다.</p>
          <ul>
            <li>크레딧 유효기간: 충전일로부터 365일</li>
            <li>유효기간 만료 14일 전 이메일로 사전 안내</li>
            <li>크레딧 잔량 및 유효기간은 마이페이지에서 확인 가능</li>
          </ul>
        </div>

        <div className={styles.card}>
          <h2>제7조 서비스 장애 시 보상</h2>
          <p>당사 귀책으로 인한 서비스 장애 중 크레딧이 차감된 경우, 해당 크레딧을 복구합니다. 서비스 자체 이용이 불가한 경우 아래 기준으로 보상합니다.</p>
          <ul>
            <li>장애 24시간 미만: 보상 없음 (단, 공지 후 조속히 복구)</li>
            <li>장애 24시간 이상~72시간 미만: 해당 일수 구독 기간 연장</li>
            <li>장애 72시간 이상: 해당 월 구독료 전액 환불 또는 기간 연장 선택</li>
          </ul>
          <p>※ 천재지변, 외부 서비스(Anthropic API 등) 장애로 인한 경우는 당사 귀책에 해당하지 않을 수 있습니다.</p>
        </div>

        <div className={`${styles.card} ${styles.contactBox}`}>
          <h2>환불 문의 연락처</h2>
          <p>운영사: 어나더핸즈</p>
          <p>서비스명: 뚝딱툴 (ddukddaktool.co.kr)</p>
          <p>이메일: <a href="mailto:lboss.reboot@gmail.com">lboss.reboot@gmail.com</a></p>
          <p>운영시간: 평일 10:00 ~ 18:00 (주말·공휴일 제외)</p>
          <p style={{ marginTop: 12, fontSize: 13, color: 'rgba(255, 255, 255, 0.5)' }}>
            ※ 이메일 문의 시 영업일 기준 1~2일 이내 답변드립니다.
          </p>
        </div>
      </div>
    </main>
  );
}
