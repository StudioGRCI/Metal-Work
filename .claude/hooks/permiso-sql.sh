#!/usr/bin/env bash
# Hook PreToolUse para `execute_sql` y `apply_migration` de Supabase.
#
# Lo pidió el usuario el 2026-09-30: que no le pregunten por cada consulta,
# solo cuando la orden puede borrar datos o cambiar una tabla de forma
# radical. Leer es libre y escribir se piensa (skill `datos`), pero pensar lo
# hace quien escribe la orden; la pregunta al usuario se reserva para lo que
# no tiene vuelta atrás.
#
# Pregunta (ask) cuando el SQL:
#   - borra filas: DELETE FROM, TRUNCATE
#   - tira objetos que guardan datos: DROP TABLE/SCHEMA/DATABASE/COLUMN/
#     SEQUENCE/OWNED/MATERIALIZED VIEW, o cualquier DROP … CASCADE
#   - cambia una tabla a lo grande: ALTER TABLE … DROP <columna>, RENAME,
#     ALTER … TYPE (quitar una restricción o un default no cuenta)
#   - apaga reglas: DISABLE ROW LEVEL SECURITY, DISABLE TRIGGER,
#     session_replication_role
#   - toca la numeración: ALTER SEQUENCE … RESTART, setval(
#   - modifica sin WHERE: un UPDATE … SET sin WHERE en la misma sentencia
# Todo lo demás —SELECT, EXPLAIN, INSERT, UPDATE con WHERE, CREATE, políticas,
# funciones, GRANT— pasa sin preguntar.
#
# Ante la duda pregunta: un comentario que diga «truncate» también hace
# preguntar, y está bien. Si este script falla, Claude Code vuelve a su
# comportamiento normal, que es preguntar: un error nunca abre la puerta.
set -u

entrada="$(cat)"

# El SQL viaja escapado dentro del JSON: los saltos de línea llegan como \n.
# Se aplana a una sola línea en minúsculas; el ; separa sentencias.
plano="$(printf '%s' "$entrada" | sed -e 's/\\[nrt]/ /g' | tr '\n\r\t' '   ' | tr '[:upper:]' '[:lower:]')"

hay() { printf '%s' "$plano" | grep -Eq "$1"; }
sentencias() { printf '%s' "$plano" | tr ';' '\n'; }

B='(^|[^a-z_])'   # borde de palabra por la izquierda
E='([^a-z_]|$)'   # borde de palabra por la derecha
S='[[:space:]]'

motivo=''
if hay "${B}delete${S}+from${S}"; then
  motivo='borra filas de la base (DELETE)'
elif hay "${B}truncate${E}"; then
  motivo='vacía tablas (TRUNCATE)'
elif hay "${B}drop${S}+(table|schema|database|column|sequence|owned|materialized${S}+view)${E}"; then
  motivo='elimina tablas, columnas o secuencias (DROP)'
elif hay "${B}drop${S}[^;]*${S}cascade${E}"; then
  motivo='elimina en cascada (DROP … CASCADE)'
elif sentencias | grep -E "${B}alter${S}+table${S}" | grep -Eo "drop${S}+[a-z_\"]+" \
     | grep -Evq "drop${S}+(constraint|not|default|identity|expression)$"; then
  motivo='quita una columna (ALTER TABLE … DROP)'
elif sentencias | grep -E "${B}alter${S}+table${S}" | grep -Eq "${S}rename${S}"; then
  motivo='renombra una tabla o columna (ALTER TABLE … RENAME)'
elif hay "${B}alter${S}+table${S}[^;]*${S}alter${S}[^;]*${S}type${S}"; then
  motivo='cambia el tipo de una columna (ALTER … TYPE)'
elif hay "disable${S}+(row${S}+level${S}+security|trigger)|session_replication_role"; then
  motivo='apaga reglas de la base (RLS o triggers)'
elif hay "${B}alter${S}+sequence${S}[^;]*${S}restart${E}|${B}setval${S}*\\("; then
  motivo='toca la numeración de documentos (secuencias)'
elif sentencias | grep -E "${B}update${S}+[a-z_.\"]+${S}+(as${S}+[a-z_]+${S}+)?set${S}" \
     | grep -Evq "${B}where${E}"; then
  motivo='modifica filas sin WHERE (UPDATE)'
fi

if [ -n "$motivo" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"Esta orden %s. Confírmala antes de que corra."}}\n' "$motivo"
else
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"SQL sin borrado de datos ni cambio radical de tablas"}}\n'
fi
exit 0
