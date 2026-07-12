# syntax=docker/dockerfile:1

# --- Étape 1: build du frontend web (React + Vite + Tailwind) ---
FROM node:22.12-alpine AS web

WORKDIR /web

ARG VITE_SHOW_DEMO_ACCOUNTS=false
ENV VITE_SHOW_DEMO_ACCOUNTS=$VITE_SHOW_DEMO_ACCOUNTS

COPY web/package*.json ./
RUN npm install

COPY web/ .
# build de production via Vite (le type-check est assuré par la CI / en local)
RUN npx vite build

# --- Étape 2: image backend (Node.js + Express) ---
FROM node:22.12-alpine

# Healthcheck docker compose (wget) + Chromium pour Puppeteer (bulletins PDF)
RUN apk add --no-cache \
    wget \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ .
COPY BackOffice /BackOffice

# Build du frontend web servi par Express sur /web
COPY --from=web /web/dist /web/dist

EXPOSE 5000

CMD ["npm", "start"]
