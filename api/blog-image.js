/**
 * 기본 이미지 생성기 (폐지됨)
 * → 모든 요청을 /api/blog-image-pro 로 전달
 */
import handler from './blog-image-pro.js';
export { handler as default };
export const config = { maxDuration: 300 };
