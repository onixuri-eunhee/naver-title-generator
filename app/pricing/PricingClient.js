'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import styles from './page.module.css';

const UNIT_PRICE = 9900;
const UNIT_CREDIT = 30;
const MAX_QTY = 5;

function generateOrderId() {
  const now = new Date();
  const ts = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `DDT-${ts}-${rand}`;
}

export default function PricingClient() {
  const router = useRouter();
  const { user } = useAuth();
  const [qty, setQty] = useState(1);
  const [paying, setPaying] = useState(false);
  const [payReady, setPayReady] = useState(false);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const paymentWidgetRef = useRef(null);

  const amount = qty * UNIT_PRICE;

  function changeQty(delta) {
    setQty((q) => Math.max(1, Math.min(MAX_QTY, q + delta)));
  }

  async function openPayment() {
    if (!user) {
      alert('로그인 후 이용해주세요.');
      router.push('/login');
      return;
    }
    if (!sdkLoaded || typeof window === 'undefined' || !window.PaymentWidget) {
      alert('결제 위젯이 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    setPaying(true);
    setPayReady(false);

    try {
      const keyRes = await fetch('/api/payment-client-key');
      const keyData = await keyRes.json();
      const clientKey = keyData.clientKey;
      if (!clientKey) throw new Error('클라이언트 키가 설정되지 않았습니다.');

      const PaymentWidget = window.PaymentWidget;
      const paymentWidget = PaymentWidget(clientKey, PaymentWidget.ANONYMOUS);
      paymentWidgetRef.current = paymentWidget;

      const methodWidget = paymentWidget.renderPaymentMethods(
        '#payment-method',
        { value: amount },
        { variantKey: 'DEFAULT' }
      );
      paymentWidget.renderAgreement('#agreement', { variantKey: 'AGREEMENT' });

      methodWidget.on('ready', () => {
        setPayReady(true);
      });

      setTimeout(() => {
        if (!payReady && paymentWidgetRef.current) {
          console.error('[TOSS] Widget did not become ready within 10s');
        }
      }, 10000);
    } catch (err) {
      console.error('[TOSS] Payment widget error:', err);
      setPaying(false);
      alert('결제 위젯을 불러오는 데 실패했습니다: ' + (err.message || '알 수 없는 오류'));
    }
  }

  function closePayment() {
    setPaying(false);
    setPayReady(false);
    paymentWidgetRef.current = null;
    if (typeof document !== 'undefined') {
      const pm = document.getElementById('payment-method');
      const ag = document.getElementById('agreement');
      if (pm) pm.innerHTML = '';
      if (ag) ag.innerHTML = '';
    }
  }

  async function confirmPayment() {
    const widget = paymentWidgetRef.current;
    if (!widget) return;
    const orderId = generateOrderId();
    try {
      await widget.requestPayment({
        orderId,
        orderName: `뚝딱툴 크레딧 ${qty * UNIT_CREDIT}크레딧`,
        successUrl: `${window.location.origin}/payment-success`,
        failUrl: `${window.location.origin}/payment-fail`,
      });
    } catch (err) {
      if (err.code !== 'USER_CANCEL') {
        console.error('Payment request error:', err);
        alert(err.message || '결제 요청 중 오류가 발생했습니다.');
      }
    }
  }

  useEffect(() => {
    return () => { paymentWidgetRef.current = null; };
  }, []);

  return (
    <>
      <Script
        src="https://js.tosspayments.com/v1/payment-widget"
        strategy="afterInteractive"
        onLoad={() => setSdkLoaded(true)}
      />
      <main className={styles.root}>
        <header className={styles.header}>
          <h1><span>크레딧</span> 충전</h1>
          <p>
            크레딧을 충전하면<br />
            블로그 글, 이미지, 카드뉴스 등<br />
            PRO 도구를 자유롭게 사용할 수 있습니다
          </p>
        </header>

        <div className={styles.freeBanner}>
          <div className={styles.freeBannerInner}>
            <span className={styles.bannerIcon}>✨</span>
            <span>
              <strong>오픈 기념 한시 무료!</strong> 제목·후킹·스레드 1일 5회, 블로그 글·프리미엄 이미지·카드뉴스·황금키워드 1일 3회 무료로 이용 중입니다.
            </span>
          </div>
        </div>

        {!paying && (
          <div className={styles.container}>
            <div className={styles.productCard}>
              <div className={styles.productBadge}>CREDIT PACK</div>
              <div className={styles.productTitle}>크레딧 충전</div>
              <div className={styles.productPriceRow}>
                <div className={styles.productPrice}>9,900<small>원</small></div>
                <div className={styles.productUnitPrice}>1크레딧당 330원</div>
              </div>
              <div className={styles.productUnit}>30크레딧 / 1세트</div>

              <div className={styles.qtySection}>
                <div className={styles.qtyLabel}>수량 선택</div>
                <div className={styles.qtyRow}>
                  <button
                    type="button"
                    className={styles.qtyBtn}
                    onClick={() => changeQty(-1)}
                    disabled={qty <= 1}
                  >
                    −
                  </button>
                  <div className={styles.qtyValue}>{qty}</div>
                  <button
                    type="button"
                    className={styles.qtyBtn}
                    onClick={() => changeQty(1)}
                    disabled={qty >= MAX_QTY}
                  >
                    +
                  </button>
                  <div className={styles.qtyDetail}>{qty * UNIT_CREDIT}크레딧</div>
                </div>
              </div>

              <div className={styles.totalRow}>
                <div className={styles.totalLabel}>결제 금액</div>
                <div className={styles.totalAmount}>
                  {amount.toLocaleString()}<small>원</small>
                </div>
              </div>

              <button type="button" className={styles.buyBtn} onClick={openPayment}>
                결제하기
              </button>
            </div>

            <div className={styles.usageTable}>
              <h3>크레딧 사용처</h3>
              <div className={styles.usageGrid}>
                <div className={styles.usageItem}>
                  <span className={styles.toolName}>블로그 글 생성</span>
                  <span className={styles.toolCost}>1 크레딧</span>
                </div>
                <div className={styles.usageItem}>
                  <span className={styles.toolName}>프리미엄 이미지</span>
                  <span className={styles.toolCost}>3 크레딧</span>
                </div>
                <div className={styles.usageItem}>
                  <span className={styles.toolName}>카드뉴스 생성</span>
                  <span className={styles.toolCost}>1 크레딧</span>
                </div>
                <div className={styles.usageItem}>
                  <span className={styles.toolName}>황금키워드 분석</span>
                  <span className={styles.toolCost}>1 크레딧</span>
                </div>
                <div className={styles.usageItem}>
                  <span className={styles.toolName}>숏폼 영상 생성</span>
                  <span className={styles.toolCost}>
                    7~18 크레딧{' '}
                    <span style={{ fontSize: '12px', color: '#6B7280', fontWeight: 400 }}>
                      (30초 7 / 45초 10 / 60초 14 / 90초 18)
                    </span>
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.bonusBanner}>
              <div className={styles.bonusIcon}>🎁</div>
              <div className={styles.bonusText}>
                <strong>오픈톡방 회원 첫 구매 20% 추가!</strong><br />
                1세트 구매 시 30 → 36크레딧,<br />
                5세트 구매 시 150 → 180크레딧으로 지급됩니다.
              </div>
            </div>

            <div className={styles.faqSection}>
              <h3>자주 묻는 질문</h3>
              <details className={styles.faqItem}>
                <summary>Q. 크레딧 유효기간이 있나요?</summary>
                <p>충전된 크레딧은 <strong>충전일로부터 1년간</strong> 사용 가능하며, 기한 내 사용 및 환불이 가능합니다. 1년이 지난 크레딧은 자동 소멸됩니다.</p>
              </details>
              <details className={styles.faqItem}>
                <summary>Q. 환불은 어떻게 하나요?</summary>
                <p>
                  크레딧 결제 후 7일 이내 미사용 시 <strong>결제된 수단으로 전액 환불</strong>이 가능합니다. 일부 사용 시에는 사용량에 따라 차감 후 환불됩니다. 구매한 크레딧은 회원 간 양도가 불가합니다. 자세한 내용은{' '}
                  <a href="/refund-policy">환불규정</a>을 확인해주세요.
                </p>
              </details>
              <details className={styles.faqItem}>
                <summary>Q. 무료 체험은 없나요?</summary>
                <p>
                  현재 오픈 기념으로 제목·후킹문구·스레드 글 1일 5회, 블로그 글·프리미엄 이미지·카드뉴스·황금키워드 1일 3회를 무료로 이용할 수 있습니다.
                </p>
              </details>
            </div>
          </div>
        )}

        {paying && (
          <div className={styles.paymentSection}>
            <div className={styles.paymentCard}>
              <div className={styles.paymentHeader}>
                <h3>결제하기</h3>
                <button type="button" className={styles.cancelBtn} onClick={closePayment}>
                  취소
                </button>
              </div>
              <div id="payment-method" style={{ minHeight: 200 }} />
              <div id="agreement" style={{ minHeight: 50 }} />
              <button
                type="button"
                className={styles.buyBtn}
                onClick={confirmPayment}
                disabled={!payReady}
                style={{ marginTop: 20 }}
              >
                {payReady ? `${amount.toLocaleString()}원 결제하기` : '결제 수단을 불러오는 중...'}
              </button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
