FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY prisma ./prisma
RUN yarn prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN yarn build

RUN mkdir -p /data && chown -R node:node /data

FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=3333

COPY package.json yarn.lock ./
COPY prisma ./prisma
RUN yarn install --frozen-lockfile --production=true && yarn cache clean

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://localhost:${PORT:-3333}/check || exit 1

CMD ["yarn", "start:prod"]
