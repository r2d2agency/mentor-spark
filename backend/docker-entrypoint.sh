#!/bin/sh
set -e

echo "════════════════════════════════════════════════════════"
echo "[entrypoint] 🚀 MentorFlow API — iniciando deploy"
echo "════════════════════════════════════════════════════════"
echo "[entrypoint] NODE_ENV=$NODE_ENV"
echo "[entrypoint] DB_HOST=$DB_HOST DB_PORT=$DB_PORT DB_NAME=$DB_NAME"
echo "[entrypoint] PORT=${PORT:-3001}"
echo ""

# O banco pode não estar pronto logo após o deploy (ou reiniciar). Sem retry,
# o bootstrap falha uma vez, o entrypoint aborta, o container entra em crash
# loop e a API fica em 502 permanente. Aqui tentamos de novo algumas vezes.
MAX_TRIES="${BOOTSTRAP_MAX_TRIES:-10}"
ATTEMPT=1

echo "[entrypoint] 🛠  Rodando bootstrap (schema + super admin + planos)..."
while :; do
  if node dist/seeds/bootstrap.js; then
    echo "[entrypoint] ✅ Bootstrap OK."
    break
  fi

  if [ "$ATTEMPT" -ge "$MAX_TRIES" ]; then
    echo "════════════════════════════════════════════════════════"
    echo "[entrypoint] ❌ BOOTSTRAP FALHOU após $ATTEMPT tentativas — abortando"
    echo "[entrypoint] Verifique as envs DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME"
    echo "════════════════════════════════════════════════════════"
    exit 1
  fi

  echo "[entrypoint] ⚠️  Bootstrap falhou (tentativa $ATTEMPT/$MAX_TRIES). Banco indisponível? Tentando de novo em 10s..."
  ATTEMPT=$((ATTEMPT + 1))
  sleep 10
done

echo ""
echo "[entrypoint] 🚀 Subindo API..."
exec node dist/main.js
