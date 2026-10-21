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
MAX_TRIES="${BOOTSTRAP_MAX_TRIES:-3}"
ATTEMPT=1

echo "[entrypoint] 🛠  Rodando bootstrap (schema + super admin + planos)..."
while :; do
  if node dist/seeds/bootstrap.js; then
    echo "[entrypoint] ✅ Bootstrap OK."
    break
  fi

  if [ "$ATTEMPT" -ge "$MAX_TRIES" ]; then
    echo "════════════════════════════════════════════════════════"
    echo "[entrypoint] ❌ BOOTSTRAP FALHOU após $ATTEMPT tentativas"
    echo "[entrypoint] Verifique as envs DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME"
    echo "[entrypoint] Seguindo assim mesmo: a API tem retry próprio de conexão ao banco."
    echo "════════════════════════════════════════════════════════"
    break
  fi

  echo "[entrypoint] ⚠️  Bootstrap falhou (tentativa $ATTEMPT/$MAX_TRIES). Banco indisponível? Tentando de novo em 5s..."
  ATTEMPT=$((ATTEMPT + 1))
  sleep 5
done

echo ""
echo "[entrypoint] 🚀 Subindo API..."

# Supervisor: se a API cair por qualquer motivo (exceção não tratada, OOM,
# banco reiniciando), o processo volta em vez de deixar o container morto —
# com o container parado o proxy responde 502 em todas as rotas.
RESTART_DELAY="${API_RESTART_DELAY_SECONDS:-5}"
while :; do
  code=0
  # `set -e` abortaria o script num exit != 0; o `|| code=$?` mantém o supervisor vivo.
  node dist/main.js || code=$?
  echo "[entrypoint] ⚠️  API terminou com código $code — reiniciando em ${RESTART_DELAY}s"
  sleep "$RESTART_DELAY"
done
