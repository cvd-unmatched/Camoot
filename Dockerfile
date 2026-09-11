# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
RUN apk update && apk upgrade --no-cache
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk update && apk upgrade --no-cache
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install -g npm@latest
COPY server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p data/uploads
EXPOSE 3001
CMD ["node", "server/index.js"]
