FROM node:22-bookworm-slim AS builder

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:22-bookworm-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev && apt-get purge -y python3 make g++ && apt-get autoremove -y
COPY --from=builder /app/build ./build
COPY src/fonts ./build/fonts

ENV NODE_ENV=production
ENV PORT=3456
ENV DATABASE_PATH=/data/ogbadge.db
EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://localhost:3456/api/ping').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "build/server.js"]
