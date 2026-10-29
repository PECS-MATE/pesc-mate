FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci && sha256sum package-lock.json | cut -d ' ' -f 1 > node_modules/.pesc-mate-lock-hash

COPY . .

EXPOSE 5173

CMD ["sh", "./start-dev.sh"]
