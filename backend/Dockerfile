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

# Cuidado com `*.tsbuildinfo`: o `tsc` roda com `incremental: true` e, se
# esse arquivo entrar no contexto, ele considera o build "atualizado" e
# reemite SÓ os arquivos alterados. O resultado é um `dist/` incompleto que
# AINDA tem `dist/main.js` (o `test -f` passa) mas explode no boot com
# MODULE_NOT_FOUND em `require('./modules/auth/auth.module')` — o container morre
# na hora e o EasyPanel responde 502 em todas as rotas. Por isso zeramos o
# tsbuildinfo antes e depois do build, e exigimos que o app.module carregue.

# --- Build stage ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY . /tmp/context
# Guard de contexto: falha o build se o .dockerignore excluir codigo do
# backend do contexto. Foi exatamente isso que quebrou a imagem e deixou a
# API em 502 em todas as rotas (MODULE_NOT_FOUND no `nest build`).
# Roda antes do build porque depois do build a imagem ja esta quebrada.
RUN set -e; \
    if [ -f /tmp/context/backend/scripts/check-docker-context.js ]; then \
      node /tmp/context/backend/scripts/check-docker-context.js /tmp/context; \
    elif [ -f /tmp/context/scripts/check-docker-context.js ]; then \
      node /tmp/context/scripts/check-docker-context.js /tmp/context; \
    else \
      echo '[ctx] FALHA: guard de contexto ausente do build context'; \
      exit 1; \
    fi
RUN if [ -f /tmp/context/backend/package.json ]; then \
      cp -a /tmp/context/backend/. /app/; \
    else \
      cp -a /tmp/context/. /app/; \
    fi \
 && cd /app \
 && rm -rf node_modules dist sites uploads \
 && find . -name '*.tsbuildinfo' -delete \
 && npm install --include=dev --no-audit --no-fund \
 && test -x node_modules/.bin/nest \
 && npm run build \
 && find . -name '*.tsbuildinfo' -delete \
 && test -f dist/main.js \
 && test -f dist/seeds/bootstrap.js \
 && node -e "require('./dist/app.module.js')"

# --- Production stage ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Instala apenas deps de produção (package.json vem do stage de build,
# já normalizado para a pasta backend/)
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force \
 && node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.scripts.start='/usr/local/bin/docker-entrypoint.sh';fs.writeFileSync('package.json',JSON.stringify(p,null,2))"

# Copia build (inclui dist/main.js e dist/seeds/bootstrap.js compilados)
COPY --from=builder /app/dist ./dist

# Diretórios usados em runtime (uploads do editor, páginas de vendas em ZIP).
# Criar aqui evita 404/500 por pasta inexistente no primeiro request.
RUN mkdir -p uploads sites

# Entrypoint que roda bootstrap (schema + super admin) antes da API
COPY --from=builder /app/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3001

# Health check: o orquestrador usa isto para decidir se o container está
# pronto. A rota / responde 200 sem tocar o banco.
HEALTHCHECK --interval=30s --timeout=5s --start-period=150s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
