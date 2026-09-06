/**
 * Une los videos de los tramos en uno solo, en el orden del circuito.
 *
 *   node herramientas/recorrido/montar-video.mjs <carpeta> [salida.webm]
 *
 * Usa el ffmpeg que Playwright ya trae para grabar —no hace falta instalar
 * nada—, y copia los flujos sin recodificar: todos los tramos se graban con el
 * mismo tamaño y el mismo códec, así que unirlos es pegar, no volver a
 * comprimir. Recodificar una hora de pantallas en esta máquina tarda más que
 * grabarlas.
 */
import { existsSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const carpeta = resolve(process.argv[2] ?? 'capturas/circuito-grabado')
const salida = resolve(process.argv[3] ?? join(carpeta, 'circuito-completo.webm'))

/**
 * El ffmpeg de Playwright NO sirve acá: es una build mínima, compilada solo
 * para grabar —«Unrecognized option 'safe'», porque no trae el demuxer
 * `concat`—. Hace falta uno completo; `ffmpeg-static` lo trae y se puede
 * instalar fuera del proyecto:
 *
 *   npm install --prefix <carpeta de trabajo> ffmpeg-static
 */
const FFMPEG = [
  process.env.FFMPEG,
  `${process.env.LOCALAPPDATA ?? ''}/Temp/ffmpeg/ffmpeg.exe`,
  'ffmpeg',
].filter(Boolean)

const ffmpeg = FFMPEG.find((r) => r === 'ffmpeg' || existsSync(r))
if (!ffmpeg) {
  console.error('No encuentro ffmpeg. Pásalo en FFMPEG= o instala ffmpeg-static.')
  process.exit(2)
}

// Los tramos se llaman `tramo-NN-nombre.webm`: el número los ordena solo.
const tramos = readdirSync(carpeta)
  .filter((a) => /^tramo-\d\d-.+\.webm$/.test(a))
  .sort()

if (tramos.length === 0) {
  console.error(`No hay tramos que unir en ${carpeta}`)
  process.exit(1)
}

console.log(`Uniendo ${tramos.length} tramo(s):`)
for (const t of tramos) {
  console.log(`  ${t}  (${(statSync(join(carpeta, t)).size / 1048576).toFixed(1)} MB)`)
}

// La lista para el demuxer `concat`. Las rutas van con barras normales y entre
// comillas simples: en Windows, una barra invertida sin escapar rompe el
// archivo de lista sin decir por qué.
const lista = join(carpeta, 'lista-tramos.txt')
writeFileSync(
  lista,
  tramos.map((t) => `file '${join(carpeta, t).replace(/\\/g, '/')}'`).join('\n'),
)

const resultado = spawnSync(
  ffmpeg,
  ['-y', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', salida],
  { encoding: 'utf8' },
)

if (resultado.status !== 0) {
  console.error(resultado.stderr?.split('\n').slice(-15).join('\n'))
  process.exit(1)
}

console.log(`\n✔ ${salida}  (${(statSync(salida).size / 1048576).toFixed(1)} MB)`)
