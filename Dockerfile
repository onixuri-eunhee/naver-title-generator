FROM node:20-slim

WORKDIR /app

# 루트에 최소 package.json (ESM "type": "module" 필요)
RUN echo '{"type":"module"}' > package.json

# 서비스 코드 복사
COPY services/ ./services/

# services/ 레벨에서 의존성 설치
WORKDIR /app/services
RUN npm install --omit=dev

WORKDIR /app

EXPOSE 8080

CMD ["node", "services/shortform-stt-service/server.js"]
