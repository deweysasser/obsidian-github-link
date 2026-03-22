FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM scratch
COPY --from=build /app/main.js /app/manifest.json /app/styles.css /
