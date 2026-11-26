# Videos de Metal Work

La plantilla fija de los videos que enseñan a usar el sistema. Todos salen con
los mismos colores, el mismo logo, los mismos rótulos, los mismos subtítulos y
la misma música: un video nuevo solo trae **su guion y sus capturas**.

Es un proyecto aparte de la aplicación, con sus propias dependencias
(`package.json` propio): nada de aquí entra al build de Next ni a Vercel.

## El formato

| | Horizontal | Vertical (WhatsApp) |
| --- | --- | --- |
| Tamaño | 1920×1080, 30 fps | 1080×1920 (9:16), 30 fps |
| Duración | de 1 a 2 min | de 30 a 60 s |
| Pantalla | captura de monitor (1440) | captura de teléfono (390), letra grande y zoom más cerrado |

**Un video por tarea, no por puesto.** El título es la tarea («Cómo pedir un
RQ»). Si un cambio toca a varios puestos, un video por puesto y por tarea.

Todo video tiene estas seis partes, en este orden. La plantilla las arma sola:

1. **Gancho** (primeros 5 s): qué gana quien lo ve.
2. **Portada** (2 s): logo, tarea y puesto.
3. **Antes y después**: cómo estaba y cómo se ve ahora.
4. **Paso a paso** en la pantalla real: zoom suave a lo que se toca, un
   recuadro rojo que lo resalta y un rótulo corto abajo.
5. **Por qué importa**: cómo ayuda al trabajo. El sistema guía, no ordena.
6. **Cierre**: resumen en 3 puntos y logo.

Español sencillo y frases cortas. La voz explica el porqué, no solo dónde tocar.
Subtítulos siempre visibles. Fundidos de 0,3 a 0,5 s, sin efectos.

## Con qué se hace

| Para | Herramienta |
| --- | --- |
| Las escenas | Remotion (React), con la plantilla de `src/plantilla/` |
| La voz | Microsoft Edge TTS, `es-PE-CamilaNeural`, velocidad normal o −5 % |
| Los tiempos de cada frase | Whisper (`faster-whisper`) |
| Las capturas | Playwright contra el **banco local**, con cuentas de prueba |
| La mezcla y el MP4 | ffmpeg: voz y música 25 dB por debajo, H.264 + AAC |
| La revisión de datos y subtítulos | Whisper y OCR (`tesseract`, idioma `spa`) |

```bash
cd herramientas/videos
npm install
pip install edge-tts faster-whisper pillow numpy
# y en la máquina: ffmpeg y tesseract-ocr con tesseract-ocr-spa
```

## Hacer un video

Hay dos hechos, que sirven de ejemplo:

| Video | Puesto | Muestra cómo |
| --- | --- | --- |
| `videos/como-subir-una-cotizacion-con-varias-unidades/` | Ventas | subir un documento inventado y declarar sus montos |
| `videos/como-pedir-un-rq/` | Supervisor de área | llenar un formulario y que otro puesto actúe fuera de cámara |

Las órdenes de abajo usan el primero; con el otro son iguales.

**1. El guion.** `videos/<video>/guion.json`, empezando por el gancho. Cada
frase es un subtítulo; el vertical puede decir una versión más corta
(`"vertical": "…"`) o saltarse una frase (`"vertical": ""`). Se revisa antes de
seguir: después todo depende de él. Cada paso lleva sus `tomas`: qué captura
se ve y qué se resalta, y desde qué frase (`desdeFrase`). Una toma con
`"solo": "horizontal"` no sale en el vertical (el menú del monitor no existe en
el teléfono).

**2. Las capturas**, con el banco levantado (`herramientas/banco/README.md`) y
la aplicación en el puerto 3111:

```bash
BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-subir-una-cotizacion-con-varias-unidades/capturar.mjs horizontal
BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-subir-una-cotizacion-con-varias-unidades/capturar.mjs vertical
```

Cada formato hace la tarea de verdad y deja su documento en el banco: se rehace
el banco entre uno y otro (`preparar.sh`) para que los dos salgan con el mismo
número.

Cada video trae su `capturar.mjs`: entra con la cuenta `*.local@metalwork.test`
del puesto, hace la tarea de verdad en el banco y en cada paso guarda la
pantalla y **el lugar exacto de lo que se va a resaltar**. El zoom y el
recuadro salen de esos números, no se miden a ojo. Un renglón que ocupa todo
el ancho se resalta con `cenido(…)`, que toma solo lo escrito: así la cámara se
acerca y la letra se lee. `scripts/captura.mjs` se
niega a capturar fuera de `localhost`: nunca se graba metalworkperu.app.

Si la tarea pide subir un documento, se inventa ahí mismo con `pdfConTexto`
(nunca se copia uno real) y **sin RUC ni DNI**: en un video no sale ninguno,
tampoco de prueba. Una cotización no se entiende sin su total: los montos que
el video inventa se declaran en `abrir({ montosInventados: [...] })` y la
revisión deja pasar esos y ningún otro.

**3. Todo lo demás, de una vez:**

```bash
node scripts/hacer.mjs videos/como-subir-una-cotizacion-con-varias-unidades
```

| Etapa | Qué hace | Deja |
| --- | --- | --- |
| voz | Edge TTS dice cada escena; Whisper mide cada palabra | `generado/<formato>/voz.wav`, `linea.json` |
| imagen | Remotion arma las escenas con la plantilla | `generado/<formato>/imagen.mp4` |
| mezcla | ffmpeg une imagen, voz y música | `salida/<video>-<formato>.mp4` |
| revisión | la revisión automática (abajo) | `salida/revision-<formato>.md` |

`--desde=imagen` (o `mezcla`, o `revision`) retoma sin repetir lo anterior, y
`horizontal` o `vertical` hace uno solo. Si la voz se sale de la duración del
formato o el gancho no cabe en 5 s, se detiene ahí: se corrige el guion.

**4. Verlo completo** y corregir. La revisión automática no reemplaza mirarlo.

**5. Entregar** los dos MP4 y el proyecto editable:

```bash
node scripts/empaquetar.mjs videos/como-subir-una-cotizacion-con-varias-unidades   # salida/<video>-proyecto-editable.tar.gz
```

Para ver y retocar una escena en vivo: `npm run estudio -- --props=…` con las
propiedades que usa `hacer.mjs` (guion, `linea.json` y `capturas.json`).

## La revisión automática

`scripts/revisar.py` mira el MP4 final y no deja pasar un video que falle:

- **Formato**: tamaño, 30 fps, H.264 + AAC, duración, y el gancho en 5 s.
- **La voz contra el guion**: Whisper transcribe el video final y se compara
  palabra por palabra. Nada cortado ni cambiado.
- **Datos reales**: compara todos los cuadros y lee con OCR cada uno en que la
  imagen cambia, y cada captura a su tamaño completo. No puede aparecer un RUC,
  un DNI, un teléfono, un correo que no sea de prueba ni una clave, ni más
  montos que los inventados que declaró la captura. Y las capturas tienen que
  venir del banco local con una cuenta de prueba.
- **Subtítulos**: cada uno se busca en pantalla con OCR en su cuadro de entrada,
  y se compara con el momento en que su primera palabra suena en el video
  final (Whisper da la palabra y el volumen, el instante). El desfase no pasa
  de 0,3 s.

Lo que marque como dato real puede ser un error de lectura: deja el cuadro en
`generado/<formato>/revision/` como `DATO-…png` para mirarlo. No se da por bueno
sin mirarlo. El OCR se equivoca con la letra chica y con dos pantallas
encimadas a medio fundido: cada cuadro marcado se lee dos veces más, al doble y
al triple de tamaño. Un dato que está de verdad en pantalla sale igual en dos
lecturas; si no se repite queda como `dudoso-…png`, anotado en el informe, sin
tumbar la revisión. Los dudosos también se miran.

La revisión se probó en rojo con tres videos estropeados a propósito —un RUC y
un monto pintados un segundo, la voz corrida 0,6 s y una frase muda— y los
tres fallan en el punto que toca.

## Qué es fijo y qué cambia

| Fijo (la plantilla) | De cada video |
| --- | --- |
| `src/plantilla/tema.ts`: colores, letras, medidas | `videos/<video>/guion.json` |
| `src/plantilla/escenas.tsx`: las seis escenas | `videos/<video>/capturar.mjs` |
| `src/plantilla/piezas.tsx`: cabecera, ventana, rótulo, subtítulos | |
| `public/musica/base.m4a`: la música | |
| `scripts/`: voz, tiempos, mezcla, revisión | |

Los colores son los tokens de `src/app/globals.css` (azul #13467F y rojo
#FD0002 del Manual de Identidad), las letras son Jost y Arimo como en la
aplicación, y el logo se lee de `public/marca/` del repositorio. La música se
sintetiza con `scripts/musica.py`: no usa ninguna pista de terceros.

Cambiar la plantilla cambia **todos** los videos que se hagan después: se hace
a propósito, no de paso para un video.

## Lo que no se sube al repositorio

`node_modules/`, y de cada video `capturas/`, `generado/` y `salida/`: se
rehacen con los pasos de arriba. El `.tar.gz` editable sí los lleva.

## Licencia de Remotion

Remotion es gratis para personas y para empresas de hasta 3 empleados; una
empresa más grande necesita su licencia de empresa
(<https://www.remotion.dev/docs/license>). Hay que revisarlo antes de usar los
videos de forma regular.
