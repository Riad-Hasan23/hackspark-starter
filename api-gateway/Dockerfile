FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM alpine:3.19
RUN apk add --no-cache nodejs wget
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8000/status || exit 1
CMD ["node", "server.js"]