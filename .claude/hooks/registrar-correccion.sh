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
#
# La línea del registro es TSV de tres campos, y el orden importa:
#
#   fecha <TAB> tema <TAB> texto de la corrección (200 caracteres)
#
# El campo 2 es el que cuenta la skill `aprender` con
# `cut -f2 … | sort | uniq -c`; el campo 3 es lo que permite leer después qué
# se dijo de verdad. Antes se guardaba el JSON del evento aplanado y el
# registro no servía para ver qué se repite.
set -u

entrada="$(cat)"
raiz="${CLAUDE_PROJECT_DIR:-.}"
raiz="${raiz%/}"

# El JSON llega en una o varias líneas. Se aplana —y se le quitan los
# tabuladores, que romperían el TSV— antes de mirar nada.
plano="$(printf '%s' "$entrada" | tr '\n\r\t' '   ')"
texto="$(printf '%s' "$plano" | tr '[:upper:]' '[:lower:]')"

# Marcas de corrección en segunda persona. Deliberadamente NO incluye "no
# funciona" ni "hay un error": esos casi siempre hablan del código, no de una
# equivocación del asistente, y llenarían el registro de ruido.
patron='te equivocaste|te equivocas|estas equivocad|estás equivocad|equivocado|te lo dije|ya te dije|ya te lo|otra vez lo mismo|siempre haces|siempre lo mismo|no te pedi|no te pedí|no era eso|no era asi|no era así|no es asi|no es así|eso no es lo que|esta mal|está mal|estas mal|estás mal|mal hecho|fallaste|te fallo|te falló|no hagas|nunca hagas|deja de|no vuelvas a|te dije que|volviste a|de nuevo hiciste|me mentiste|no me hiciste caso'

printf '%s' "$texto" | grep -qE "$patron" || exit 0

# --- Sacar el texto del prompt ------------------------------------------------
# Aquí NO hay jq, ni python, ni perl. Se intenta con node (que tampoco está en
# el PATH: vive en "C:\Program Files\nodejs"), y si falla se recorta con sed.
# Pase lo que pase, se escribe algo: un registro incompleto sirve más que
# ninguno, y este hook nunca puede tumbar un turno.
nodo=''
for candidato in node /c/Program\ Files/nodejs/node.exe 'C:/Program Files/nodejs/node.exe'; do
  if command -v "$candidato" >/dev/null 2>&1 || [ -x "$candidato" ]; then
    nodo="$candidato"
    break
  fi
done

prompt=''
if [ -n "$nodo" ]; then
  prompt="$(printf '%s' "$entrada" | "$nodo" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const p=String(j.prompt==null?"":j.prompt).replace(/[\r\n\t]+/g," ").replace(/ +/g," ").trim();process.stdout.write(p)}catch(e){}})' 2>/dev/null || true)"
fi

# Sin node, o si node no pudo parsear: recortar el JSON aplanado a mano.
if [ -z "$prompt" ]; then
  prompt="$(printf '%s' "$plano" \
    | sed -e 's/.*"prompt"[[:space:]]*:[[:space:]]*"//' \
          -e 's/",[[:space:]]*"[a-zA-Z_]*"[[:space:]]*:.*$//' \
          -e 's/"[[:space:]]*}[[:space:]]*$//' 2>/dev/null || true)"
fi

# Último recurso: el evento entero. Feo, pero no se pierde el turno.
[ -n "$prompt" ] || prompt="$plano"

prompt="$(printf '%s' "$prompt" | tr '\n\r\t' '   ' | cut -c1-200)"

# --- Clasificar el tema -------------------------------------------------------
# El tema es un cubo, no una etiqueta exacta: sirve para contar reincidencia con
# `cut -f2 | sort | uniq -c`. El texto completo queda en el campo 3.
minus="$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')"
tema='otro'
if   printf '%s' "$minus" | grep -qE 'indice|índice|advisor|rendimiento|lento|explain|clave foránea|clave foranea'; then tema='indices-rendimiento'
elif printf '%s' "$minus" | grep -qE 'rls|permiso|politica|política|tiene_permiso|es_admin|rol real|admin'; then       tema='rls-permisos'
elif printf '%s' "$minus" | grep -qE 'no probaste|no comprobaste|no lo probaste|sin probar|no verificaste|terminado'; then tema='sin-probar'
elif printf '%s' "$minus" | grep -qE 'no te pedi|no te pedí|no era eso|eso no es lo que|no es asi|no es así'; then     tema='alcance'
elif printf '%s' "$minus" | grep -qE 'migracion|migración|esquema|tabla|columna|trigger|sql'; then                     tema='esquema-sql'
elif printf '%s' "$minus" | grep -qE 'pantalla|component|boton|botón|formulario|interfaz|diseño'; then                 tema='pantalla'
elif printf '%s' "$minus" | grep -qE 'node|psql|bash|heredoc|jq|comando|script|path'; then                             tema='entorno'
fi

registro="$raiz/.claude/aprendizaje/correcciones.log"
mkdir -p "$(dirname "$registro")" 2>/dev/null || true

printf '%s\t%s\t%s\n' \
  "$(date -Iseconds 2>/dev/null || date)" \
  "$tema" \
  "$prompt" \
  >> "$registro" 2>/dev/null || true

total="$(wc -l < "$registro" 2>/dev/null | tr -d ' ')"
total="${total:-?}"

cat <<JSON
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Esto parece una corrección. Aplica la skill \`aprender\` antes de responder: busca la causa raíz (no el síntoma), y deja el aprendizaje escrito donde se vuelva a leer solo. Correcciones registradas: ${total} — si es reincidencia, la regla no está en el sitio correcto."}}
JSON

exit 0
