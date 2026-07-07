'use client';

/**
 * 발행 분산 스케줄러 화면 — 하루 몇 편·언제부터 넣으면 저품질 안 걸리는 예약 시간표를 계산해 보여준다.
 * 실제 발행은 PC 도우미(카무폭스)가 --schedule로 수행. 이 화면은 "계획"만.
 * 순수 로직은 lib/publish-schedule. 스타일은 blog-writer 것 재사용.
 */

import { useMemo, useState } from 'react';
import { computeSchedule, validateGaps, DEFAULT_ANCHORS } from '@/lib/publish-schedule';
import { clipCopy } from '@/lib/utils';
import styles from '../blog-writer/page.module.css';

function todayKst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export default function PublishSchedule() {
  const [startDate, setStartDate] = useState(todayKst());
  const [totalPosts, setTotalPosts] = useState(5);
  const [postsPerDay, setPostsPerDay] = useState(3);
  const [copied, setCopied] = useState('');

  const schedule = useMemo(() => {
    try {
      return computeSchedule({
        startDate,
        totalPosts: Math.max(1, Math.min(60, Number(totalPosts) || 1)),
        postsPerDay: Math.max(1, Math.min(DEFAULT_ANCHORS.length, Number(postsPerDay) || 1)),
      });
    } catch {
      return [];
    }
  }, [startDate, totalPosts, postsPerDay]);

  const gapViolations = useMemo(() => validateGaps(schedule), [schedule]);
  const scheduleArgsText = useMemo(() => schedule.map((s) => `--schedule "${s.scheduleArg}"`).join('\n'), [schedule]);

  async function copy(kind, text) {
    await clipCopy(text);
    setCopied(kind);
    setTimeout(() => setCopied(''), 1500);
  }

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <div className={styles.inputGroup}>
          <label className={styles.inputLabel}>시작 날짜</label>
          <input className={styles.inputField} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className={styles.inputGroup}>
          <label className={styles.inputLabel}>총 몇 편</label>
          <input className={styles.inputField} type="number" min={1} max={60} value={totalPosts} onChange={(e) => setTotalPosts(e.target.value)} />
        </div>
        <div className={styles.inputGroup}>
          <label className={styles.inputLabel}>하루 몇 편 (최대 {DEFAULT_ANCHORS.length})</label>
          <div className={styles.typeGrid}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className={Number(postsPerDay) === n ? styles.typeBtnActive : styles.typeBtn} onClick={() => setPostsPerDay(n)}>
                {n}편
              </button>
            ))}
          </div>
          <p style={{ fontSize: 13, color: '#888', marginTop: 6 }}>
            몰아 올리면 네이버가 기계발행으로 봐서 저품질 위험이 있어요. 그래서 하루 안에서도 {DEFAULT_ANCHORS.join(' · ')} 처럼 시간을 나눠 배치합니다.
          </p>
        </div>
      </div>

      <div className={styles.resultCard}>
        <div className={styles.resultCardHeader}>
          <span className={styles.cardLabel}>예약 시간표 ({schedule.length}편)</span>
        </div>
        {gapViolations.length > 0 && (
          <p style={{ color: '#d33', fontSize: 13 }}>⚠️ 간격이 1.5시간보다 좁은 곳이 있어요. 하루 편수를 줄이는 걸 권해요.</p>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#666' }}>
                <th style={{ padding: '6px 8px' }}>회차</th>
                <th style={{ padding: '6px 8px' }}>날짜</th>
                <th style={{ padding: '6px 8px' }}>시각(KST)</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((s) => (
                <tr key={s.round} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: '6px 8px' }}>{s.round}</td>
                  <td style={{ padding: '6px 8px' }}>{s.kstDate}</td>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{s.kstTime}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.resultCard}>
        <div className={styles.resultCardHeader}>
          <span className={styles.cardLabel}>발행 도우미용 예약 옵션</span>
          <button type="button" className={copied === 'args' ? styles.copyBtnCopied : styles.copyBtn} onClick={() => copy('args', scheduleArgsText)}>
            {copied === 'args' ? '복사됨' : '복사'}
          </button>
        </div>
        <p style={{ fontSize: 13, color: '#888', margin: '0 0 8px' }}>
          각 글을 PC 발행 도우미로 올릴 때 이 <code>--schedule</code> 값을 그 글에 붙이면 그 시각에 예약돼요.
        </p>
        <p className={styles.resultText} style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13 }}>{scheduleArgsText}</p>
      </div>
    </main>
  );
}
