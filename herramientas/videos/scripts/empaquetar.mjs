#!/usr/bin/env node
/**
 * El proyecto editable de un video, en un `.tar.gz` que se abre y se vuelve a
 * renderizar en otra máquina:
 *
 *   node scripts/empaquetar.mjs videos/como-pedir-un-rq [vertical]
 *
 * Lleva la plantilla, los scripts, la música, la marca y, del video, su guion,
 * sus capturas, su voz y su línea de tiempo. No lleva `node_modules` (se
 * instala con `npm install`), ni los MP4, que se entregan aparte. Del vertical,
 * que no se entrega, no lleva nada si no se pide por su nombre.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const carpeta = process.argv[2] ? resolve(process.argv[2]) : null
if (!carpeta || !existsSync(join(carpeta, 'guion.json'))) {
  console.error('Uso: node scripts/empaquetar.mjs videos/<video>')
  process.exit(2)
}
const conVertical = process.argv.slice(3).includes('vertical')
const guion = JSON.parse(readFileSync(join(carpeta, 'guion.json'), 'utf8'))
const nombre = `${guion.id}-proyecto-editable`
const armado = join(mkdtempSync(join(tmpdir(), 'video-')), nombre)
mkdirSync(armado, { recursive: true })

for (const parte of ['README.md', 'package.json', 'package-lock.json', 'tsconfig.json', '.gitignore', 'src', 'scripts', 'public']) {
  if (existsSync(join(RAIZ, parte))) cpSync(join(RAIZ, parte), join(armado, parte), { recursive: true, filter: (origen) => !origen.includes('__pycache__') })
}
// La marca oficial vive en el repositorio; el paquete lleva su copia para no depender de él.
const marca = [join(RAIZ, 'public/marca'), join(RAIZ, '../../public/marca')].find((r) => existsSync(join(r, 'logo-metal-work-claro.png')))
for (const archivo of ['logo-metal-work-claro.png', 'logo-metal-work.png', 'taller.jpg']) cpSync(join(marca, archivo), join(armado, 'public/marca', archivo))

const destino = join(armado, 'videos', basename(carpeta))
cpSync(carpeta, destino, {
  recursive: true,
  // Fuera lo que se rehace solo y pesa: el render sin sonido, lo que Remotion copia, los cuadros de la revisión y los MP4.
  filter: (origen) => {
    const ruta = origen.replaceAll('\\', '/')
    if (!conVertical && /\/(capturas|generado)\/vertical(\/|$)|salida\/revision-vertical\.md$/.test(ruta)) return false
    return !/generado\/(publico|[^/]+\/(revision|imagen\.mp4))|salida\/.*\.(mp4|tar\.gz)$/.test(ruta)
  },
})

const salida = join(carpeta, 'salida', `${nombre}.tar.gz`)
mkdirSync(dirname(salida), { recursive: true })
const r = spawnSync('tar', ['-czf', salida, '-C', dirname(armado), nombre], { stdio: 'inherit' })
rmSync(dirname(armado), { recursive: true, force: true })
if (r.status !== 0) process.exit(1)
console.log(`${salida} (${(statSync(salida).size / 1048576).toFixed(1)} MB)`)
