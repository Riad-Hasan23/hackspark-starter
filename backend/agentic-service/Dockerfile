FROM node:20-alpine AS builder
WORKDIR /app/agentic-service
COPY agentic-service/package*.json ./
RUN npm install --omit=dev

FROM alpine:3.19
RUN apk add --no-cache nodejs wget
WORKDIR /app
COPY --from=builder /app/agentic-service/node_modules ./agentic-service/node_modules
COPY agentic-service/ ./agentic-service/
COPY protos/ ./protos/
EXPOSE 8004
WORKDIR /app/agentic-service
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8004/status || exit 1
CMD ["node", "server.js"]