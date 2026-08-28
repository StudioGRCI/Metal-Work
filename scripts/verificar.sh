#!/usr/bin/env bash
# Comprueba un cambio de código en una sola orden.
#
# Existe porque la comprobación real son tres pasos que hay que dar en orden y
# es fácil saltarse el primero: sin `next typegen`, TypeScript reporta decenas
# de «Cannot find name 'PageProps'» que no son errores del código y se pierde
# media hora persiguiendo un fallo inexistente.
#
# Resuelve `node` por su cuenta: en Windows no siempre está en el PATH.
set -u
cd "$(dirname "$0")/.." || exit 1

if command -v node >/dev/null 2>&1; then
  NODE=node
elif [ -x "/c/Program Files/nodejs/node.exe" ]; then
  NODE="/c/Program Files/nodejs/node.exe"
elif [ -x "/mnt/c/Program Files/nodejs/node.exe" ]; then
  NODE="/mnt/c/Program Files/nodejs/node.exe"
else
  echo "No encuentro node. Instálalo o ponlo en el PATH."; exit 127
fi

fallos=0
paso() {
  local nombre="$1"; shift
  local salida
  if salida="$("$@" 2>&1)"; then
    printf '  ok    %s\n' "$nombre"
  else
    printf '  FALLA %s\n' "$nombre"
    printf '%s\n' "$salida" | tail -40 | sed 's/^/        /'
    fallos=$((fallos + 1))
  fi
}

echo "Comprobando ($NODE)"
paso "tipos de Next"  "$NODE" node_modules/next/dist/bin/next typegen
paso "TypeScript"     "$NODE" node_modules/typescript/lib/tsc.js --noEmit
paso "ESLint"         "$NODE" node_modules/eslint/bin/eslint.js

if [ "$fallos" -eq 0 ]; then
  echo "Todo pasa. Falta lo que esto no ve: la pantalla y la base."
  exit 0
fi
echo "$fallos de 3 fallan."
exit 1
