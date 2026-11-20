/**
 * Clic real sobre los DXF de corte en plasma (DKS, 2026-11-20: «son archivos
 * .DXF para que Diseño suba y Maestranza descargue para generar los cortes»),
 * con la cuenta de cada puesto (nunca ADMIN) y la base mirada después de cada paso:
 *
 *   1. Diseño elige tres .dxf sueltos de una vez y los carga: quedan tres
 *      archivos de un mismo envío, y a Maestranza y Producción les llega un
 *      solo aviso que los cuenta.
 *   2. Un PDF con el nombre cambiado a .dxf se marca en rojo y no se envía.
 *   3. Diseño carga además un .zip, como antes, y quita de una vez un envío
 *      de dos .dxf que subió por error.
 *   4. El supervisor de Maestranza ve los DXF en Planos y etapas, bajo una sola
 *      descripción, y descarga cada .dxf con su nombre y su contenido; el de
 *      Producción también los ve; el de Acabados no.
 *   5. Gerencia no entra a los DXF.
 *
 * Usa la base del banco (`preparar.sh`, `mw_demo`) con un código de unidad
 * puesto a mano a una de sus unidades (CODIGO, por omisión SRQ_PL_N3_2_26/41).
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE, BANCO_CHROMIUM, CAPTURAS.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas/dxf-sueltos'
const CODIGO = process.env.CODIGO ?? 'SRQ_PL_N3_2_26/41'
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const base = new pg.Client({
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BANCO_BASE ?? 'mw_demo',
})
await base.connect()
const uno = async (sql, valores = []) => (await base.query(sql, valores)).rows[0]

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const sello = Date.now().toString().slice(-6)

// Tres DXF de texto como los que saca el programa de corte, uno con la extensión en mayúsculas.
const dxf = (n) => `  0\r\nSECTION\r\n  2\r\nENTITIES\r\n  0\r\nLINE\r\n  8\r\nCORTE\r\n 10\r\n${n}.0\r\n 20\r\n0.0\r\n  0\r\nENDSEC\r\n  0\r\nEOF\r\n`
const DXFS = ['cartela-a', 'cartela-b', 'PLANCHA-PISO'].map((n, i) => {
  const ruta = `${CAPTURAS}/${n}-${sello}.${i === 2 ? 'DXF' : 'dxf'}`
  writeFileSync(ruta, dxf(i + 1))
  return ruta
})
const FALSO = `${CAPTURAS}/no-es-dxf-${sello}.dxf`
writeFileSync(FALSO, '%PDF-1.4\n%falso\n')
const ZIP = `${CAPTURAS}/juego-${sello}.zip`
writeFileSync(ZIP, Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]))
const nombre = (ruta) => ruta.split('/').pop()

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(puesto, ancho = 1280) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 900 } })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', `${puesto}.local@metalwork.test`)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  return { pagina, contexto, errores }
}
const ir = (pagina, ruta) => pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
const estado = async (pagina) =>
  limpio(await pagina.locator('[role="status"], [role="alert"]').filter({ hasText: /\S/ }).first().innerText({ timeout: 30000 }).catch(() => ''))
const idDe = async (correo) => (await uno(`select id from usuarios where correo = $1`, [`${correo}.local@metalwork.test`])).id
// Los avisos de esta corrida: su descripción lleva el sello.
const avisos = async (correo) =>
  (await base.query(`select cuerpo, leida_en from notificaciones where usuario_id = $1 and titulo = $2 and cuerpo like $3 order by creado_en`, [
    await idDe(correo),
    `DXF nuevos: ${CODIGO}`,
    `%${sello}%`,
  ])).rows
// El aviso de este envío, no el que quedó en pantalla del anterior.
const esperarAviso = async (pagina, patron) =>
  limpio(await pagina.locator('[role="status"], [role="alert"]').filter({ hasText: patron }).first().innerText({ timeout: 60000 }).catch(async () => `(no llegó; en pantalla: ${await estado(pagina)})`))
const enVista = `/diseno/codigo?${new URLSearchParams({ codigo: CODIGO, vista: 'dxf' })}`

// ------------------------------------------------ 1–3. Diseño
{
  const { pagina, contexto, errores } = await entrar('diseno')
  await ir(pagina, enVista)
  const form = pagina.locator('form').filter({ has: pagina.locator('#dxf-archivos') })
  comprobar((await form.count()) === 1, 'Diseño tiene el formulario de los DXF en el código')

  // 2. El PDF disfrazado: se marca y no se envía.
  await form.locator('#dxf-descripcion').fill('Prueba que no debe entrar')
  await form.locator('#dxf-archivos').setInputFiles([DXFS[0], FALSO])
  await pagina.waitForTimeout(600)
  const caja = limpio(await form.innerText())
  comprobar(/no es un \.dxf de verdad/i.test(caja) && caja.includes(`«${nombre(FALSO)}» no sirve`), `el PDF con nombre .dxf sale en rojo y con su nombre: «${caja.slice(0, 220)}»`)
  const antes = Number((await uno(`select count(*) n from codigo_dxf where codigo_interno = $1`, [CODIGO])).n)
  await form.getByRole('button', { name: 'Cargar DXF' }).click()
  await pagina.waitForTimeout(1500)
  const tras = Number((await uno(`select count(*) n from codigo_dxf where codigo_interno = $1`, [CODIGO])).n)
  comprobar(tras === antes, `con uno que no sirve no sube nada (${antes} → ${tras})`)

  // 1. Tres .dxf sueltos de una vez.
  await form.locator('#dxf-descripcion').fill(`Cartelas y piso ${sello}`)
  await form.locator('#dxf-archivos').setInputFiles(DXFS)
  await pagina.waitForTimeout(600)
  const elegidos = limpio(await form.innerText())
  comprobar(/3 archivos elegidos/.test(elegidos) && DXFS.every((r) => elegidos.includes(nombre(r))), `dice cuántos eligió y sus nombres: «${elegidos.slice(0, 260)}»`)
  await pagina.screenshot({ path: `${CAPTURAS}/1-diseno-tres-dxf-elegidos.png`, fullPage: true })
  await form.getByRole('button', { name: 'Cargar DXF' }).click()
  const aviso1 = await esperarAviso(pagina, /archivos cargados|no subió|No se/)
  comprobar(/3 archivos cargados/.test(aviso1), `Diseño ve que quedaron los tres: «${aviso1}»`)
  await pagina.waitForTimeout(500)
  comprobar((await pagina.evaluate(() => document.activeElement?.id)) === 'dxf-descripcion', 'tras cargar, el cursor vuelve a «Qué traen»')
  await pagina.waitForTimeout(800)
  const filas = (await base.query(`select nombre_archivo, ruta, envio, tamano_bytes from codigo_dxf where descripcion = $1 order by nombre_archivo`, [`Cartelas y piso ${sello}`])).rows
  comprobar(
    filas.length === 3 && new Set(filas.map((f) => f.envio)).size === 1 && filas.every((f) => /^[0-9a-f-]{36}\.dxf$/.test(f.ruta) && Number(f.tamano_bytes) > 0),
    `quedan tres .dxf de un mismo envío: ${filas.map((f) => `${f.nombre_archivo}→${f.ruta.slice(-8)}`).join(', ')}`,
  )
  const mtz = await avisos('sup.mtz')
  const prd = await avisos('sup.prd')
  comprobar(
    mtz.length === 1 && prd.length === 1 && /Cartelas y piso \d+ \(3 archivos: /.test(mtz[0].cuerpo) && mtz[0].leida_en === null,
    `un solo aviso a Maestranza y a Producción que los cuenta: «${mtz[0]?.cuerpo}»`,
  )
  comprobar((await avisos('sup.acb')).length === 0 && (await avisos('gerencia')).length === 0, 'Acabados y Gerencia no reciben el aviso')
  await ir(pagina, enVista)
  const lista = limpio(await pagina.locator('main').innerText())
  comprobar(lista.includes(`Cartelas y piso ${sello}`) && /3 archivos ·/.test(lista), 'Diseño ve el envío con sus tres archivos bajo una descripción')
  await pagina.screenshot({ path: `${CAPTURAS}/2-diseno-dxf-cargados.png`, fullPage: true })

  // 3. Un .zip, como antes.
  await form.locator('#dxf-descripcion').fill(`Juego comprimido ${sello}`)
  await form.locator('#dxf-archivos').setInputFiles([ZIP])
  await form.getByRole('button', { name: 'Cargar DXF' }).click()
  const aviso2 = await esperarAviso(pagina, /DXF cargado\.|no subió|No se/)
  comprobar(/DXF cargado\./.test(aviso2), `el .zip sigue entrando: «${aviso2}»`)
  await pagina.waitForTimeout(800)
  comprobar((await avisos('sup.mtz')).length === 2, 'y su aviso es otro, aparte del de los tres .dxf')
  await ir(pagina, enVista)

  // Se corta a la mitad: el segundo archivo no llega al almacenamiento. Se
  // dice qué quedó y qué falta, la descripción se traba y lo que falta entra
  // en el mismo envío y el mismo aviso.
  let subidas = 0
  await pagina.route('**/storage/v1/object/dxf-codigo/**', (ruta) => {
    if (ruta.request().method() === 'POST' && ++subidas === 2) return ruta.abort()
    return ruta.continue()
  })
  await form.locator('#dxf-descripcion').fill(`A medias ${sello}`)
  await form.locator('#dxf-archivos').setInputFiles(DXFS)
  await form.getByRole('button', { name: 'Cargar DXF' }).click()
  const medias = await esperarAviso(pagina, /Quedaron|no subió|No se/)
  comprobar(/Quedaron 1 de 3/.test(medias) && /Envía solo los que faltan/.test(medias) && !/no se repiten/.test(medias), `a medias dice qué quedó y qué falta: «${medias.slice(0, 260)}»`)
  comprobar(await form.locator('#dxf-descripcion').evaluate((el) => el.readOnly), 'y traba la descripción')
  await pagina.unroute('**/storage/v1/object/dxf-codigo/**')
  await form.locator('#dxf-archivos').setInputFiles(DXFS.slice(1))
  await form.getByRole('button', { name: 'Cargar DXF' }).click()
  comprobar(/2 archivos cargados/.test(await esperarAviso(pagina, /2 archivos cargados|Quedaron|No se/)), 'los que faltaban entran')
  await pagina.waitForTimeout(800)
  const mediasFilas = (await base.query(`select envio from codigo_dxf where descripcion = $1 and quitado_en is null`, [`A medias ${sello}`])).rows
  const mediasAvisos = (await avisos('sup.mtz')).filter((a) => a.cuerpo.startsWith(`A medias ${sello}`))
  comprobar(
    mediasFilas.length === 3 && new Set(mediasFilas.map((f) => f.envio)).size === 1 && mediasAvisos.length === 1 && /\(3 archivos/.test(mediasAvisos[0].cuerpo),
    `quedan los tres, sin repetir, en un envío y un aviso (${mediasFilas.length} filas, ${mediasAvisos.length} aviso: «${mediasAvisos[0]?.cuerpo}»)`,
  )
  await ir(pagina, enVista)

  // Un envío al código equivocado se quita entero.
  await form.locator('#dxf-descripcion').fill(`Por error ${sello}`)
  await form.locator('#dxf-archivos').setInputFiles(DXFS.slice(0, 2))
  await form.getByRole('button', { name: 'Cargar DXF' }).click()
  comprobar(/2 archivos cargados/.test(await esperarAviso(pagina, /2 archivos cargados|no subió|No se/)), 'carga dos más por error')
  await ir(pagina, enVista)
  await pagina.getByRole('button', { name: `Quitar los 2 de «Por error ${sello}»` }).click()
  await pagina.locator('[role="dialog"], [role="alertdialog"]').getByRole('button', { name: /Quitar|Confirmar|Sí/ }).last().click()
  await pagina.waitForTimeout(1500)
  const quitados = await uno(`select count(*) filter (where quitado_en is not null) q, count(*) n from codigo_dxf where descripcion = $1`, [`Por error ${sello}`])
  comprobar(Number(quitados.q) === 2 && Number(quitados.n) === 2, `«Quitar los 2» los quita de una vez y quedan en el historial (${quitados.q} de ${quitados.n})`)
  await ir(pagina, enVista)
  comprobar(!limpio(await pagina.locator('main').innerText()).includes(`Por error ${sello}`), 'y ya no salen en la lista')
  // El corte a propósito de la subida deja su «Failed to load resource» en la consola: ese no cuenta.
  const otros = errores.filter((e) => !/Failed to load resource: net::ERR_FAILED/.test(e))
  comprobar(otros.length === 0, `sin errores en la consola de Diseño ${otros.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 4. Los supervisores
const enPlanos = `/planos?${new URLSearchParams({ q: CODIGO })}`
for (const [puesto, nombreArea] of [['sup.mtz', 'Maestranza'], ['sup.prd', 'Producción']]) {
  const { pagina, contexto, errores } = await entrar(puesto, puesto === 'sup.mtz' ? 390 : 1280)
  await ir(pagina, enPlanos)
  const seccion = pagina.locator('section[aria-label="DXF para cortar"]')
  const texto = limpio(await seccion.innerText().catch(() => ''))
  comprobar(texto.includes(`Cartelas y piso ${sello}`) && DXFS.every((r) => texto.includes(nombre(r))) && texto.includes(nombre(ZIP)), `${nombreArea} ve los DXF en Planos y etapas`)
  if (puesto === 'sup.mtz') {
    await seccion.screenshot({ path: `${CAPTURAS}/3-maestranza-telefono-dxf.png` })
    for (const r of DXFS) {
      // Del envío «Cartelas y piso»: «A medias» trae archivos con el mismo nombre.
      const enlace = seccion.locator('li').filter({ hasText: `Cartelas y piso ${sello}` }).first().getByRole('link', { name: `Descargar ${nombre(r)}` })
      const descarga = await Promise.all([pagina.waitForEvent('download', { timeout: 15000 }), enlace.click()]).then(([d]) => d).catch(() => null)
      const bajado = descarga ? readFileSync(await descarga.path()).toString() : null
      comprobar(
        descarga?.suggestedFilename() === nombre(r) && bajado === readFileSync(r).toString(),
        `Maestranza descarga ${nombre(r)} con su nombre y su contenido (${descarga?.suggestedFilename() ?? 'no bajó'})`,
      )
    }
  }
  comprobar(errores.length === 0, `sin errores en la consola de ${nombreArea} ${errores.join(' | ')}`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('sup.acb')
  await ir(pagina, enPlanos)
  const texto = limpio(await pagina.locator('main').innerText())
  comprobar(!texto.includes('DXF para cortar') && !texto.includes(nombre(DXFS[0])), 'Acabados no ve los DXF')
  await contexto.close()
}

// ------------------------------------------------ 5. Gerencia
{
  const { pagina, contexto } = await entrar('gerencia')
  await ir(pagina, '/diseno/dxf')
  const texto = limpio(await pagina.locator('body').innerText())
  comprobar(!texto.includes(`Cartelas y piso ${sello}`) && !/Cargar DXF/.test(texto), `Gerencia no entra a los DXF (${pagina.url().replace(BASE, '')})`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
