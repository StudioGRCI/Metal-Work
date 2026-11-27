#!/usr/bin/env node
/**
 * Hace un video de punta a punta. Los videos se entregan en horizontal; el
 * vertical sigue en la plantilla y se hace solo si se pide por su nombre:
 *
 *   node scripts/hacer.mjs videos/como-pedir-un-rq [horizontal] [vertical] [--desde=voz|imagen|mezcla|revision]
 *
 *   1. voz       `voz.py`: Edge TTS + Whisper → generado/<formato>/voz.wav y linea.json
 *   2. imagen    Remotion arma las escenas con la plantilla → generado/<formato>/imagen.mp4 (sin sonido)
 *   3. mezcla    ffmpeg une imagen, voz y música 25 dB por debajo de la voz → salida/<video>-<formato>.mp4 (H.264 + AAC)
 *   4. revisión  `revisar.py`: Whisper sobre el MP4 contra el guion, cuadros sin datos reales y desfase de subtítulos
 *
 * Las capturas se toman antes y aparte, con el banco local levantado
 * (`videos/<video>/capturar.mjs`): este script no abre el sistema.
 *
 * Termina con código distinto de cero si la voz se sale del formato o la
 * revisión automática encuentra algo: un video que no pasa no se entrega.
 *
 * Variables: VIDEOS_NAVEGADOR (el Chrome sin ventana que usa Remotion; si no
 * se da, usa el de Playwright si está o deja que Remotion baje el suyo),
 * WHISPER_MODELO.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FORMATOS = JSON.parse(readFileSync(join(RAIZ, 'src/plantilla/formatos.json'), 'utf8'))
const ETAPAS = ['voz', 'imagen', 'mezcla', 'revision']
/** Cuánto más baja va la música que la voz. Parte del formato: igual en todos los videos. */
const MUSICA_BAJO_LA_VOZ = 25
const SONORIDAD_DE_LA_VOZ = -16 // LUFS: lo que se oye bien en el teléfono sin subir el volumen

const argumentos = process.argv.slice(2)
const desde = (argumentos.find((a) => a.startsWith('--desde='))?.split('=')[1] ?? 'voz').replace('revisión', 'revision')
const posicionales = argumentos.filter((a) => !a.startsWith('--'))
const carpeta = posicionales[0] ? resolve(posicionales[0]) : null
/** Todos los videos son horizontales (lo pidió DKS el 26/11/2026). */
const FORMATOS_QUE_SE_ENTREGAN = ['horizontal']
const formatos = posicionales.slice(1).length > 0 ? posicionales.slice(1) : FORMATOS_QUE_SE_ENTREGAN
if (!carpeta || !existsSync(join(carpeta, 'guion.json')) || !ETAPAS.includes(desde) || formatos.some((f) => !FORMATOS[f])) {
  console.error('Uso: node scripts/hacer.mjs videos/<video> [horizontal] [vertical] [--desde=voz|imagen|mezcla|revision]')
  process.exit(2)
}
const toca = (etapa) => ETAPAS.indexOf(etapa) >= ETAPAS.indexOf(desde)
const guion = JSON.parse(readFileSync(join(carpeta, 'guion.json'), 'utf8'))
const generado = join(carpeta, 'generado')
const salida = join(carpeta, 'salida')
mkdirSync(salida, { recursive: true })

function correr(orden, args, { capturar = false } = {}) {
  const r = spawnSync(orden, args, { cwd: RAIZ, encoding: 'utf8', stdio: capturar ? 'pipe' : 'inherit', maxBuffer: 64 * 1024 * 1024 })
  if (r.error) throw r.error
  return r
}

let fallos = 0

// ---------------------------------------------------------------------- voz
if (toca('voz')) {
  console.log('\n— 1. Voz y tiempos (Edge TTS + Whisper)')
  if (correr('python3', ['scripts/voz.py', carpeta, ...formatos]).status !== 0) {
    console.error('La voz no cumple el formato: corregir el guion antes de seguir.')
    process.exit(1)
  }
}

// ------------------------------------------------------------------- imagen
if (toca('imagen')) {
  console.log('\n— 2. Imagen (Remotion)')
  // Lo que la plantilla lee del disco: la marca oficial y las capturas del video.
  const publico = join(generado, 'publico')
  rmSync(publico, { recursive: true, force: true })
  mkdirSync(join(publico, 'capturas'), { recursive: true })
  const marca = [join(RAIZ, 'public/marca'), join(RAIZ, '../../public/marca')].find((r) => existsSync(join(r, 'logo-metal-work-claro.png')))
  if (!marca) throw new Error('No encuentro el logo: public/marca del repositorio.')
  for (const archivo of ['logo-metal-work-claro.png', 'logo-metal-work.png', 'taller.jpg']) cpSync(join(marca, archivo), join(publico, 'marca', archivo))
  for (const formato of formatos) cpSync(join(carpeta, 'capturas', formato), join(publico, 'capturas', formato), { recursive: true })
  // La imagen y el MP4 anteriores se van antes de armar: si el render falla a medias, `--desde=mezcla`
  // no puede armar el video con la imagen de unas capturas que ya no son estas.
  for (const formato of formatos) {
    rmSync(join(generado, formato, 'imagen.mp4'), { force: true })
    rmSync(join(salida, `${guion.id}-${formato}.mp4`), { force: true })
  }

  const paquete = await bundle({ entryPoint: join(RAIZ, 'src/index.ts'), publicDir: publico })
  const navegador = process.env.VIDEOS_NAVEGADOR ?? ['/opt/pw-browsers/chromium_headless_shell'].find((r) => existsSync(r)) ?? null
  for (const formato of formatos) {
    const capturas = JSON.parse(readFileSync(join(carpeta, 'capturas', formato, 'capturas.json'), 'utf8'))
    for (const c of Object.values(capturas)) c.archivo = `${formato}/${c.archivo}`
    const linea = JSON.parse(readFileSync(join(generado, formato, 'linea.json'), 'utf8'))
    const inputProps = { formato, guion, linea, capturas }
    const composition = await selectComposition({ serveUrl: paquete, id: FORMATOS[formato].nombre, inputProps, browserExecutable: navegador })
    let ultimo = -1
    await renderMedia({
      composition,
      serveUrl: paquete,
      inputProps,
      codec: 'h264',
      crf: 18,
      pixelFormat: 'yuv420p',
      muted: true,
      browserExecutable: navegador,
      concurrency: Math.max(1, cpus().length - 1),
      outputLocation: join(generado, formato, 'imagen.mp4'),
      onProgress: ({ progress }) => {
        const p = Math.floor(progress * 10)
        if (p > ultimo) process.stdout.write(`  ${formato}: ${p * 10} %\n`)
        ultimo = p
      },
    })
  }
}

// ------------------------------------------------------------------- mezcla
/** La sonoridad de un audio (LUFS), midiendo solo donde suena. */
function sonoridad(archivo) {
  const r = correr('ffmpeg', ['-hide_banner', '-nostats', '-i', archivo, '-af', 'ebur128', '-f', 'null', '-'], { capturar: true })
  const m = [...r.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop()
  if (!m) throw new Error(`No pude medir la sonoridad de ${archivo}.`)
  return Number(m[1])
}

if (toca('mezcla')) {
  console.log(`\n— 3. Mezcla (ffmpeg): voz a ${SONORIDAD_DE_LA_VOZ} LUFS y música ${MUSICA_BAJO_LA_VOZ} dB por debajo`)
  const musica = join(RAIZ, 'public/musica/base.m4a')
  if (!existsSync(musica)) correr('python3', ['scripts/musica.py'])
  const fuerzaMusica = sonoridad(musica)
  for (const formato of formatos) {
    const linea = JSON.parse(readFileSync(join(generado, formato, 'linea.json'), 'utf8'))
    const voz = join(generado, formato, 'voz.wav')
    const subeVoz = SONORIDAD_DE_LA_VOZ - sonoridad(voz)
    const bajaMusica = SONORIDAD_DE_LA_VOZ - MUSICA_BAJO_LA_VOZ - fuerzaMusica
    const d = linea.duracion
    const filtro = [
      `[1:a]volume=${subeVoz.toFixed(2)}dB,alimiter=limit=0.89[voz]`,
      `[2:a]atrim=0:${d},volume=${bajaMusica.toFixed(2)}dB,afade=t=in:d=0.6,afade=t=out:st=${(d - 1.6).toFixed(2)}:d=1.6[musica]`,
      `[voz][musica]amix=inputs=2:duration=first:normalize=0[a]`,
    ].join(';')
    const destino = join(salida, `${guion.id}-${formato}.mp4`)
    const r = correr('ffmpeg', [
      '-y', '-v', 'error',
      '-i', join(generado, formato, 'imagen.mp4'), '-i', voz, '-i', musica,
      '-filter_complex', filtro, '-map', '0:v', '-map', '[a]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      '-t', String(d), '-movflags', '+faststart', destino,
    ])
    if (r.status !== 0) process.exit(1)
    writeFileSync(join(generado, formato, 'mezcla.json'), `${JSON.stringify({ voz_db: Number(subeVoz.toFixed(2)), musica_db: Number(bajaMusica.toFixed(2)), musica_bajo_la_voz_db: MUSICA_BAJO_LA_VOZ }, null, 1)}\n`)
    console.log(`  ${formato}: salida/${guion.id}-${formato}.mp4 (voz ${subeVoz.toFixed(1)} dB, música ${bajaMusica.toFixed(1)} dB)`)
  }
}

// ----------------------------------------------------------------- revisión
if (toca('revision')) {
  console.log('\n— 4. Revisión automática')
  if (correr('python3', ['scripts/revisar.py', carpeta, ...formatos]).status !== 0) fallos += 1
}

if (fallos > 0) {
  console.error('\nLa revisión automática encontró algo: corregir y volver a hacer. Este video NO se entrega así.')
  process.exit(1)
}
console.log(`\nListo: ${formatos.map((f) => `salida/${guion.id}-${f}.mp4`).join(' y ')}. Falta verlo completo antes de entregar.`)
