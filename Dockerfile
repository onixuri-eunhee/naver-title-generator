FROM node:20-bookworm

WORKDIR /app

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium

# Remotion headless Chrome + ffmpeg runtime deps
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  chromium \
  ffmpeg \
  fonts-noto-cjk \
  fonts-noto-color-emoji \
  fonts-liberation \
  libc6 \
  libcairo-gobject2 \
  libcairo2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libatspi2.0-0 \
  libasound2 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libexpat1 \
  libfontconfig1 \
  libgcc-s1 \
  libgbm1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxkbcommon0 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxshmfence1 \
  libxtst6 \
  lsb-release \
  wget \
  xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# 루트에 최소 package.json (ESM "type": "module" 필요)
RUN echo '{"type":"module"}' > package.json

# 서비스 코드 복사
COPY services/ ./services/

# Remotion 컴포지션 복사
COPY remotion/ ./remotion/

# services/ 레벨에서 의존성 설치
WORKDIR /app/services
RUN npm install --omit=dev

WORKDIR /app

EXPOSE 8080

CMD ["node", "services/shortform-stt-service/server.js"]
