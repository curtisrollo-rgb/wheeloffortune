FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV HOST=0.0.0.0
EXPOSE 8080

CMD ["node", "index.js"]
