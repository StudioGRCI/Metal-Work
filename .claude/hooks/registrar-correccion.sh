#!/usr/bin/env bash
# Hook UserPromptSubmit.
#
# Cuando el usuario corrige algo, lo normal es que el asistente arregle el
# síntoma en esta conversación y repita el error en la siguiente. Este hook
# existe para que eso no dependa de la buena voluntad del modelo: detecta el
# lenguaje de una corrección, lo anota, y le recuerda el protocolo de la skill
# `aprender` antes de que empiece a responder.
#
# No bloquea nada y no habla si no hay corrección: en un turno normal cuesta
# cero tokens.
set -u

entrada="$(cat)"
raiz="${CLAUDE_PROJECT_DIR:-.}"
raiz="${raiz%/}"

# El JSON llega en una o varias líneas; para detectar basta con verlo plano y
# en minúsculas. No se parsea con jq a propósito: jq no está en esta máquina.
texto="$(printf '%s' "$entrada" | tr '\n\r' '  ' | tr '[:upper:]' '[:lower:]')"

# Marcas de corrección en segunda persona. Deliberadamente NO incluye "no
# funciona" ni "hay un error": esos casi siempre hablan del código, no de una
# equivocación del asistente, y llenarían el registro de ruido.
patron='te equivocaste|te equivocas|estas equivocad|estás equivocad|equivocado|te lo dije|ya te dije|ya te lo|otra vez lo mismo|siempre haces|siempre lo mismo|no te pedi|no te pedí|no era eso|no era asi|no era así|no es asi|no es así|eso no es lo que|esta mal|está mal|estas mal|estás mal|mal hecho|fallaste|te fallo|te falló|no hagas|nunca hagas|deja de|no vuelvas a|te dije que|volviste a|de nuevo hiciste|me mentiste|no me hiciste caso'

printf '%s' "$texto" | grep -qE "$patron" || exit 0

registro="$raiz/.claude/aprendizaje/correcciones.log"
mkdir -p "$(dirname "$registro")" 2>/dev/null || true

# Se guarda recortado: sirve para ver reincidencia, no para archivar la
# conversación. El archivo está en .gitignore.
printf '%s\t%s\n' \
  "$(date -Iseconds 2>/dev/null || date)" \
  "$(printf '%s' "$texto" | cut -c1-300)" \
  >> "$registro" 2>/dev/null || true

total="$(wc -l < "$registro" 2>/dev/null | tr -d ' ')"
total="${total:-?}"

cat <<JSON
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Esto parece una corrección. Aplica la skill \`aprender\` antes de responder: busca la causa raíz (no el síntoma), y deja el aprendizaje escrito donde se vuelva a leer solo. Correcciones registradas: ${total} — si es reincidencia, la regla no está en el sitio correcto."}}
JSON
