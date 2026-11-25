FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "server/line-status-proxy.js"]
