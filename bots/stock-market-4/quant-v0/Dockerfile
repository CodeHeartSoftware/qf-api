FROM node:25-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY vendor ./vendor
RUN npm ci
COPY src ./src
RUN npm run build

# @quant-fusion/bot-sdk-js is a real runtime dependency now (not just a type-checking-time one), so
# the final image needs node_modules too — installed separately here with --omit=dev so
# typescript/@types/node/vitest/research-core/research-fusion never end up in the runtime image.
FROM node:25-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev

FROM node:25-alpine
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ENTRYPOINT ["node", "dist/index.js"]
