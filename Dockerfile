FROM node:22-slim

# better-sqlite3 needs build tools for native compilation
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci && npm install tsx

COPY . .

EXPOSE 3000

CMD ["npx", "tsx", "src/index.ts"]
