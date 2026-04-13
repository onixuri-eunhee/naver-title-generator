import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div style={{ marginBottom: 4 }}>
          상호명: 어나더핸즈 | 대표자명: 공은희 | 사업자등록번호: 561-01-02951
        </div>
        <div style={{ marginBottom: 4 }}>
          통신판매업 신고번호: 2023-서울강남-01379 | 유선번호: 010-4761-5951 | lboss.reboot@gmail.com
        </div>
        <div style={{ marginBottom: 4 }}>
          주소: 서울특별시 강남구 논현로2길 60, 2층 2147호 (개포동, 세화빌딩)
        </div>
        <div className="footer-links" style={{ marginBottom: 4 }}>
          <Link href="/terms">이용약관</Link>
          <Link href="/privacy">개인정보처리방침</Link>
          <Link href="/refund-policy">환불규정</Link>
        </div>
        <div>&copy; 2026 어나더핸즈. All rights reserved.</div>
      </div>
    </footer>
  );
}
