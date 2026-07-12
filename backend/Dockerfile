# syntax=docker/dockerfile:1

# --- Étape 1: build du frontend web (optionnel — désactivé en mode API-only) ---
FROM node:22.12-alpine AS web

WORKDIR /web

ARG SKIP_WEB_BUILD=false
ARG VITE_BASE_PATH=/web/
ARG VITE_API_URL=http://localhost:5000
ARG VITE_SHOW_DEMO_ACCOUNTS=false
ENV VITE_BASE_PATH=$VITE_BASE_PATH
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SHOW_DEMO_ACCOUNTS=$VITE_SHOW_DEMO_ACCOUNTS

COPY web/package*.json ./
RUN npm install

COPY web/ .
RUN if [ "$SKIP_WEB_BUILD" = "true" ]; then mkdir -p dist; else npx vite build; fi

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

# Frontend intégré (dev Docker local uniquement ; prod/preprod = Vercel)
COPY --from=web /web/dist /web/dist

EXPOSE 5000

CMD ["npm", "start"]
