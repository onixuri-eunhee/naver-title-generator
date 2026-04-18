FROM node:20-slim

# Chromium for Remotion headless rendering
RUN apt-get update && \
    apt-get install -y --no-install-recommends chromium fonts-noto-cjk && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=1

WORKDIR /app

# 1) Install services dependencies
COPY services/package.json services/package-lock.json ./services/
RUN cd services && npm ci --omit=dev

# 2) Install Remotion runtime deps at root (components need these)
COPY package.json ./
RUN npm install --no-package-lock --omit=dev \
    remotion@4.0.446 \
    @remotion/bundler@4.0.446 \
    @remotion/renderer@4.0.446 \
    @remotion/transitions@4.0.446 \
    @remotion/noise@4.0.446 \
    @remotion/lottie@4.0.446 \
    @remotion/shapes@4.0.446 \
    @remotion/paths@4.0.446 \
    @remotion/motion-blur@4.0.446 \
    @remotion/media-utils@4.0.446 \
    @remotion/media@4.0.446 \
    @remotion/player@4.0.446 \
    react@18.3.1 \
    react-dom@18.3.1

# 3) Copy Remotion components (bundler entry point)
COPY remotion/ ./remotion/

# 4) Copy lib/ utilities used by Remotion components
COPY lib/ ./lib/

# 5) Copy services source
COPY services/*.mjs ./services/

WORKDIR /app/services

EXPOSE 8080

CMD ["node", "server.mjs"]
