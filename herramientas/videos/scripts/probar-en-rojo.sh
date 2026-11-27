#!/usr/bin/env bash
# La revisión automática, probada en rojo: estropea a propósito un video que
# pasa y comprueba que la revisión lo tumba en cada caso.
#
#   ./scripts/probar-en-rojo.sh [videos/<video>]     (por omisión, el de la OT de cada unidad)
#
# El video tiene que estar hecho y pasar (`node scripts/hacer.mjs videos/<video>`).
# Cada caso se arma en una carpeta temporal con una copia del video; el video
# de verdad no se toca. Tarda unos diez minutos por caso. Sale con 0 solo si la
# revisión falla en los seis, y en el punto que toca.
#
#   dato       un RUC y un monto con moneda, pintados un segundo
#   suelto     un DNI y un monto sin moneda, pintados un segundo
#   inventado  un monto inventado con una cifra cambiada y un monto sin moneda, pintados un segundo
#   corrido    la voz corrida 0,6 s respecto de la imagen
#   cortado    una frase del medio, muda
#   saturado   el audio subido 15 dB, hasta recortarse
set -uo pipefail
cd "$(dirname "$0")/.."
CARPETA="${1:-videos/como-cargar-la-ot-de-cada-unidad}"
ID="$(basename "$CARPETA")"
F=horizontal
BUENO="$CARPETA/salida/$ID-$F.mp4"
[ -f "$BUENO" ] || { echo "Falta $BUENO: hacer el video antes."; exit 2; }
TRABAJO="$(mktemp -d)"
trap 'rm -rf "$TRABAJO"' EXIT

# Lo que se pinta: letra negra sobre blanco en la cabecera, del segundo 30 al 31.
pintar() { echo "drawtext=text='$1':fontsize=40:fontcolor=black:box=1:boxcolor=white:boxborderw=14:x=360:y=34:enable='between(t,30,31)'"; }
# Una frase del medio del guion, para dejarla muda.
read -r A B < <(python3 -c "
import json
l = json.load(open('$CARPETA/generado/$F/linea.json'))
f = [f for e in l['escenas'] for f in e['frases']][8]
print(f['inicio'], f['fin'])")
# El monto inventado mayor, con una cifra cambiada: «135,000.00» → «135,800.00».
grep -q '"valor"' "$CARPETA/capturas/$F/origen.json" || { echo "$ID no declara montos inventados: el caso «inventado» necesita uno. Probar con otro video."; exit 2; }
CAMBIADO="$(python3 -c "
import json
m = max(json.load(open('$CARPETA/capturas/$F/origen.json'))['montosInventados'], key=lambda m: m['valor'])
t = f\"{m['valor']:,.2f}\"
i = len(t) - 6
print('US\$ ' + t[:i] + ('8' if t[i] != '8' else '7') + t[i + 1:])")"

declare -A ESPERA=(
  [dato]='cuadro\(s\) con algo que parece un dato real'
  [suelto]='cuadro\(s\) con algo que parece un dato real'
  [inventado]='cuadro\(s\) con algo que parece un dato real'
  [corrido]='las pistas no arrancan juntas'
  [cortado]='frases que no se oyen como en el guion'
  [saturado]='pico verdadero'
)
# Y en los casos pintados, cada valor tiene que salir como dato en el segundo pintado: uno solo no basta.
declare -A PINTADO=(
  [dato]='20512345678|1,250\.00'
  [suelto]='45678912|1,250\.00'
  [inventado]="${CAMBIADO#US\$ }|7,250\.00"
)
bien=0
for caso in dato suelto inventado corrido cortado saturado; do
  D="$TRABAJO/$caso/$ID"
  mkdir -p "$D/salida" "$D/capturas" "$D/generado/publico/capturas"
  cp "$CARPETA/guion.json" "$D/"
  cp -r "$CARPETA/capturas/$F" "$D/capturas/"
  cp -r "$CARPETA/generado/$F" "$D/generado/"
  cp -r "$CARPETA/generado/publico/capturas/$F" "$D/generado/publico/capturas/"
  rm -rf "$D/generado/$F/revision"
  S="$D/salida/$ID-$F.mp4"
  case $caso in
    dato) ffmpeg -y -v error -i "$BUENO" -vf "$(pintar 'RUC 20512345678   S/ 1,250.00')" -c:a copy "$S" ;;
    suelto) ffmpeg -y -v error -i "$BUENO" -vf "$(pintar '45678912     1,250.00')" -c:a copy "$S" ;;
    inventado) ffmpeg -y -v error -i "$BUENO" -vf "$(pintar "$CAMBIADO     7,250.00")" -c:a copy "$S" ;;
    corrido) ffmpeg -y -v error -i "$BUENO" -itsoffset 0.6 -i "$BUENO" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k "$S" ;;
    cortado) ffmpeg -y -v error -i "$BUENO" -af "volume=enable='between(t,$A,$B)':volume=0" -c:v copy -c:a aac -b:a 192k "$S" ;;
    saturado) ffmpeg -y -v error -i "$BUENO" -af "volume=15dB" -c:v copy -c:a aac -b:a 192k "$S" ;;
  esac
  python3 scripts/revisar.py "$D" "$F" > "$TRABAJO/$caso.log" 2>&1
  salida=$?
  falta=''
  if [ -n "${PINTADO[$caso]:-}" ]; then
    IFS='|' read -ra valores <<< "${PINTADO[$caso]}"
    for valor in "${valores[@]}"; do
      grep -qE "^  - 30\.[0-9]+ s:.*${valor}" "$D/salida/revision-$F.md" || falta="$falta $valor"
    done
  fi
  if [ "$salida" -ne 0 ] && grep -qE "FALLA · .*${ESPERA[$caso]}" "$TRABAJO/$caso.log" && [ -z "$falta" ]; then
    echo "ok    · $caso: la revisión no lo deja pasar"
  else
    echo "FALLA · $caso: la revisión lo deja pasar o falla por otra cosa (salida $salida)${falta:+; no marca como dato:$falta}"
    bien=1
  fi
  grep -E "FALLA|^  - [0-9.]+ s:" "$D/salida/revision-$F.md" "$TRABAJO/$caso.log" 2>/dev/null | sed 's/^/        /' | head -8
done
exit $bien
