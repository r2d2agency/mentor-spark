# Backend Dockerfile — API NestJS
#
# Este Dockerfile funciona com DOIS contextos de build:
#   a) a pasta `backend/` como contexto (Build Path = /backend)
#   b) a raiz do repo como contexto (Build Path = /, Dockerfile = backend/Dockerfile)
#
# No caso (b), um `COPY package*.json ./` ingênuo pegaria o package.json do
# FRONTEND e o `npm run build` rodaria o Vite — o container subiria sem
# `dist/main.js` e a API ficaria em 502 para sempre. Por isso normalizamos
# o contexto em /tmp/context e copiamos só a pasta backend/ para /app.

# --- Build stage ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY . /tmp/context
RUN if [ -f /tmp/context/backend/package.json ]; then \
      cp -a /tmp/context/backend/. /app/; \
    else \
      cp -a /tmp/context/. /app/; \
    fi \
 && cd /app \
 && rm -rf node_modules dist sites uploads \
 && npm install --no-audit --no-fund \
 && npm run build \
 && test -f dist/main.js \
 && test -f dist/seeds/bootstrap.js

# --- Production stage ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Instala apenas deps de produção (package.json vem do stage de build,
# já normalizado para a pasta backend/)
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# Copia build (inclui dist/main.js e dist/seeds/bootstrap.js compilados)
COPY --from=builder /app/dist ./dist

# Entrypoint que roda bootstrap (schema + super admin) antes da API
COPY --from=builder /app/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3001

# Health check: o orquestrador usa isto para decidir se o container está
# pronto. A rota / responde 200 sem tocar o banco.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
