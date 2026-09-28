#!/usr/bin/env node
// Verificación de código desde Windows, Linux o macOS, sin depender de Bash.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pasos = [
  ['tipos de Next', 'node_modules/next/dist/bin/next', ['typegen']],
  ['TypeScript', 'node_modules/typescript/lib/tsc.js', ['--noEmit']],
  ['ESLint', 'node_modules/eslint/bin/eslint.js', []],
]

let fallos = 0
for (const [nombre, archivo, argumentos] of pasos) {
  const resultado = spawnSync(process.execPath, [resolve(raiz, archivo), ...argumentos], {
    cwd: raiz,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  if (resultado.status === 0) {
    console.log(`  ok    ${nombre}`)
    continue
  }
  fallos += 1
  console.error(`  FALLA ${nombre}`)
  const salida = [resultado.stdout, resultado.stderr, resultado.error?.message]
    .filter(Boolean)
    .join('\n')
    .trim()
    .split(/\r?\n/)
    .slice(-40)
  for (const linea of salida) console.error(`        ${linea}`)
}

if (fallos === 0) {
  console.log('Todo pasa. Falta comprobar la pantalla y la base para cada cambio.')
} else {
  console.error(`${fallos} de ${pasos.length} pasos fallan.`)
  process.exitCode = 1
}
