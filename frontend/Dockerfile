FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM alpine:3.19
RUN apk add --no-cache nginx
WORKDIR /usr/share/nginx/html
COPY --from=builder /app/dist .
COPY nginx.conf /etc/nginx/http.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]