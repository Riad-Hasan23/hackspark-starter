FROM node:20-alpine AS builder
WORKDIR /app/analytics-service
COPY analytics-service/package*.json ./
RUN npm install --omit=dev

FROM alpine:3.19
RUN apk add --no-cache nodejs wget
WORKDIR /app
COPY --from=builder /app/analytics-service/node_modules ./analytics-service/node_modules
COPY analytics-service/ ./analytics-service/
COPY protos/ ./protos/
EXPOSE 8003
WORKDIR /app/analytics-service
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8003/status || exit 1
CMD ["node", "server.js"]