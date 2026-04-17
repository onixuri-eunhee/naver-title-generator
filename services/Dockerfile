FROM node:20-slim

# Chromium for Remotion headless rendering
RUN apt-get update && \
    apt-get install -y --no-install-recommends chromium fonts-noto-cjk && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=1

WORKDIR /app

# 1) Install root dependencies (Remotion components need @remotion/*, react, etc.)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 2) Install services dependencies
COPY services/package.json services/package-lock.json ./services/
RUN cd services && npm ci --omit=dev

# 3) Copy Remotion components (bundler entry point)
COPY remotion/ ./remotion/

# 4) Copy lib/ utilities used by Remotion components
COPY lib/ ./lib/

# 5) Copy services source
COPY services/*.mjs ./services/

WORKDIR /app/services

EXPOSE 8080

CMD ["node", "server.mjs"]
