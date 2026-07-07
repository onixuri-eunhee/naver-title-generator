import PublishSchedule from './PublishSchedule';

export const metadata = {
  title: '발행 분산 스케줄러 | 뚝딱툴',
  description: '여러 글을 저품질 안 걸리게 시간 나눠 예약하는 시간표를 계산합니다.',
  robots: { index: false, follow: false }, // 내부 도구 — 검색 노출 불필요
};

export default function PublishSchedulePage() {
  return <PublishSchedule />;
}
