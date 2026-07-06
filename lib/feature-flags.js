/**
 * 기능 켜기/끄기 깃발 — 페이지 공개 여부를 한 곳에서 관리.
 *
 * SHORTFORM_PAGE_ENABLED:
 *   2026-06-13 대표 지시로 숏폼 페이지 임시 비공개 (생성 품질 점검 중).
 *   true로 바꾸면 페이지·진입 버튼·새 영상 버튼이 모두 다시 보임.
 *
 * *_PAGE_ENABLED (아래 5종):
 *   2026-07-06 대표 지시 — 시즌2(유료 사용권) 준비로 기존 무료 도구 닫음.
 *   무료로 남기는 것: 제목(/)·후킹(/hook-generator)·칼럼(/column)·사용법·충전.
 *   각 도구는 시즌2 유료 상품으로 회수 예정. 재오픈 시 해당 값을 true로.
 */
export const SHORTFORM_PAGE_ENABLED = false;
export const THREADS_PAGE_ENABLED = false;
export const BLOG_WRITER_PAGE_ENABLED = false;
export const BLOG_IMAGE_PRO_PAGE_ENABLED = false;
export const CARD_NEWS_PAGE_ENABLED = false;
export const KEYWORD_FINDER_PAGE_ENABLED = false;
