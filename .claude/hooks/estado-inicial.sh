#!/usr/bin/env bash
# Hook SessionStart: lo que cambia y CLAUDE.md no puede saber.
# Ahorra el `git status` y el `ls supabase/migrations` de cada arranque.
set -u
raiz="${CLAUDE_PROJECT_DIR:-.}"; raiz="${raiz%/}"
cd "$raiz" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

rama="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
sucios="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
ultima="$(basename "$(ls supabase/migrations/*.sql 2>/dev/null | tail -1)" 2>/dev/null)"

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Estado: rama %s, %s archivos sin commitear, última migración %s. Comprobar un cambio: ./scripts/verificar.sh"}}\n' \
  "$rama" "$sucios" "${ultima:-ninguna}"
