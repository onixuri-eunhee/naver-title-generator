FROM node:20-slim

WORKDIR /app

# 서비스 코드 복사
COPY services/ ./services/

# services/ 레벨에서 의존성 설치 (core.js가 여기서 import)
WORKDIR /app/services
RUN npm install --production

WORKDIR /app

EXPOSE 8080

CMD ["node", "services/shortform-stt-service/server.js"]
