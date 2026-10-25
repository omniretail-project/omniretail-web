# syntax=docker/dockerfile:1

# ---------- Etapa 1: dependencias ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- Etapa 2: build ----------
FROM node:22-alpine AS build
WORKDIR /app

# Las variables NEXT_PUBLIC_* se incrustan en el bundle del navegador en tiempo de BUILD,
# por eso llegan como build args (desde las variables de GitHub) y no en runtime.
ARG NEXT_PUBLIC_API_MODE=api
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ARG NEXT_PUBLIC_STOREFRONT_SLUG=
# SEO del sitio comercial: solo el build de marjym.com la fija a "https://marjym.com". Vacia (clientes, demo)
# no se emite canonical, Open Graph, datos estructurados, sitemap ni cabeceras noindex de MARJYM.
ARG NEXT_PUBLIC_SITE_URL=
# Demo publica (solo con NEXT_PUBLIC_API_MODE=mock): PUBLIC_DEMO=true activa banner, accesos rapidos y oculta funciones no demostrables.
# MARKETING_URL/DEMO_URL/SALES_CONTACT_URL son URLs absolutas (landing real, instancia demo, contacto comercial).
ARG NEXT_PUBLIC_PUBLIC_DEMO=
ARG NEXT_PUBLIC_MARKETING_URL=
ARG NEXT_PUBLIC_DEMO_URL=
ARG NEXT_PUBLIC_SALES_CONTACT_URL=
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Un slug vacio pisaria el valor por defecto del codigo (`?? "ferrepharma-demo"`), asi que se quita si no viene.
RUN [ -n "$NEXT_PUBLIC_STOREFRONT_SLUG" ] || unset NEXT_PUBLIC_STOREFRONT_SLUG; npm run build

# ---------- Etapa 3: runtime ----------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/ > /dev/null || exit 1

CMD ["node", "server.js"]
