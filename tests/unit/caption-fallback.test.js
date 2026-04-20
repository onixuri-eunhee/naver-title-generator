import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCaptionFallbacks,
  captionsAreDuplicate,
  isValidCaption,
} from '../../lib/shortform/caption-fallback.js';

describe('caption fallback', () => {
  test('platform captions are structurally different and valid', () => {
    const scenes = [
      { script: '우리 아이가 밥을 남김없이 싹 비웠습니다.' },
      { script: '첫 번째는 간장 버터 밥이에요. 밥 한 공기에 버터 한 조각만 넣어도 잘 먹어요.' },
      { script: '두 번째는 간장 감자 조림이에요. 짜지 않게 졸이면 반찬으로 좋습니다.' },
      { script: '저장해두셨다가 오늘 저녁 메뉴 고민될 때 바로 꺼내보세요.' },
    ];

    const { captionInstagram, captionYouTube } = buildCaptionFallbacks(scenes);

    assert.equal(isValidCaption(captionInstagram), true);
    assert.equal(isValidCaption(captionYouTube), true);
    assert.equal(captionsAreDuplicate(captionInstagram, captionYouTube), false);
    assert.match(captionYouTube, /#Shorts/i);
    assert.match(captionInstagram, /#릴스/);
  });

  test('empty scenes still produce safe captions', () => {
    const { captionInstagram, captionYouTube } = buildCaptionFallbacks([]);

    assert.equal(isValidCaption(captionInstagram), true);
    assert.equal(isValidCaption(captionYouTube), true);
    assert.match(captionYouTube, /#Shorts/i);
  });
});
