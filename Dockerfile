FROM node:20-slim

WORKDIR /app

# package.json만 먼저 복사하여 의존성 캐싱
COPY package.json package-lock.json ./
RUN npm ci --production

# 서비스 코드 복사
COPY services/ ./services/

EXPOSE 8080

CMD ["node", "services/shortform-stt-service/server.js"]
