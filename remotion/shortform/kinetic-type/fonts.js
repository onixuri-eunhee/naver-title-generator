import { cancelRender, continueRender, delayRender } from "remotion";

const CDN =
  "https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff2";

const FACES = [
  { weight: "400", file: "Pretendard-Regular.woff2" },
  { weight: "500", file: "Pretendard-Medium.woff2" },
  { weight: "700", file: "Pretendard-Bold.woff2" },
  { weight: "800", file: "Pretendard-ExtraBold.woff2" },
  { weight: "900", file: "Pretendard-Black.woff2" },
];

const handle = delayRender("Loading Pretendard font");

Promise.all(
  FACES.map((f) => {
    const face = new FontFace("Pretendard", `url(${CDN}/${f.file})`, {
      weight: f.weight,
      display: "block",
    });
    return face.load().then((loaded) => {
      document.fonts.add(loaded);
    });
  }),
)
  .then(() => continueRender(handle))
  .catch((err) => cancelRender(err));

export const PRETENDARD = "Pretendard, -apple-system, sans-serif";
