FROM node:20-slim

WORKDIR /app

# 서비스 코드 복사
COPY services/ ./services/

# 서비스 전용 의존성만 설치
WORKDIR /app/services/shortform-stt-service
RUN npm install --production

WORKDIR /app

EXPOSE 8080

CMD ["node", "services/shortform-stt-service/server.js"]
