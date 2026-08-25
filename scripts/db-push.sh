#!/usr/bin/env bash
# Aplica las migraciones sobre el proyecto de Supabase enlazado.
#
#   supabase login && supabase link --project-ref <ref>
#   ./scripts/db-push.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "→ verificando el esquema contra Postgres local antes de subirlo"
./scripts/db-test.sh

echo "→ aplicando migraciones en Supabase"
npx --yes supabase db push

echo "✔ migraciones aplicadas"
