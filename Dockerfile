# ---- Build Stage ----
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* .npmrc pnpm-workspace.yaml ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm build

# ---- Runtime Stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
RUN corepack enable
# Medien-Tools für die Upload-Pipeline (ffprobe kommt mit ffmpeg).
RUN apk add --no-cache ffmpeg yt-dlp
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml* .npmrc pnpm-workspace.yaml ./
RUN pnpm install --prod --no-frozen-lockfile
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data
EXPOSE 8080
CMD ["node", "dist/backend/main.js"]
