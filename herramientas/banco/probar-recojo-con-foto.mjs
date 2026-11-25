/**
 * Clic real sobre la evidencia del recojo en /recojos (Plan 5, entrega 5.2),
 * con la cuenta de cada puesto (nunca ADMIN), en el teléfono (390):
 *
 *   1. El conductor sale a recoger la A, toca «Ya la recogí», suma una foto y la
 *      marca: la base la tiene RECOGIDO con su foto anotada en `recojo_fotos`,
 *      la foto está en `fotos-recojo` bajo su cuenta y la tarjeta la muestra.
 *   2. La B, sin salir: «No se pudo recoger» no entra con un motivo corto; con
 *      el motivo, entra una sola vez aunque se toque dos veces, sale de su
 *      lista y vuelve a Logística.
 *   3. La C, ya en recojo: «No se pudo recoger» suelta la salida y queda la
 *      hora a la que había salido.
 *   4. A Logística le llega el aviso de cada una con el motivo; en Gestión de
 *      compras las ve en «Por programar» con lo que dijo el conductor, y ve la
 *      foto de la A, que abre.
 *   5. Ni Logística ni nadie más tiene los botones del conductor.
 *
 * Siembra un proveedor y tres OC aprobadas y programadas con las funciones de
 * la base. Al terminar, también si la prueba se cae, cierra el circuito: la que
 * el conductor tiene encima la deja en almacén, y las que nadie recogió las
 * saca de la lista Logística y las anula Gerencia con su motivo (un documento
 * numerado no se borra).
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE, CAPTURAS y
 * los correos de cada cuenta si no son las `*.local@metalwork.test`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(['logistica', 'conductor', 'gerencia'].map((p) => [p, cuenta(p)]))
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const CONEXION = {
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BANCO_BASE ?? 'mw_demo',
}
const base = new pg.Client(CONEXION)
await base.connect()
const consulta = async (sql, valores = []) => (await base.query(sql, valores)).rows

// ---------------------------------------------------------------- siembra
const SUFIJO = String(100000 + (Date.now() % 900000))
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)
/** Lo que hace la sesión de esa cuenta: los disparadores y las funciones leen el usuario de aquí. */
async function como(puesto, en = consulta) {
  const sub = ids[CUENTAS[puesto]]
  await en(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                  set_config('request.jwt.claims', $2, false)`, [sub, JSON.stringify({ sub, role: 'authenticated' })])
}
async function rucLibre() {
  for (;;) {
    const prefijo = `20${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    const [ruc] = await consulta(
      `select n from (select $1 || d as n from generate_series(0, 9) d) x
        where public.ruc_es_valido(n) and not exists (select 1 from proveedores p where p.numero_documento = n) limit 1`,
      [prefijo],
    )
    if (ruc) return ruc.n
  }
}
// Datos inventados: ni la dirección ni los números son de nadie.
const PROVEEDOR = `FIERROS DE PRUEBA ${SUFIJO}`
const [{ id: proveedor }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, direccion_recojo, telefono, contacto)
   values ($1, $2, 'Jr. Fiscal 100, Lima', $3, '999 000 111', 'Rosa Prueba') returning id`,
  [await rucLibre(), PROVEEDOR, `Calle Prueba 77, Ate ${SUFIJO}`],
)
const [material] = await consulta(`select id from materiales where activo and not coalesce(unidad_pendiente, false) order by codigo limit 1`)
if (!material) throw new Error('El banco no tiene materiales.')
await como('logistica')
const sembradas = []
for (const i of [1, 2, 3]) {
  const [{ id }] = await consulta(
    `select public.emitir_compra_directa(gen_random_uuid(), $1, $2, 'Reposición del almacén, prueba de la evidencia del recojo', $3::jsonb,
                                         current_date + 5, 'CONTADO', 0, 'PEN', false, 'PLANTA') as id`,
    [proveedor, `COT-EVID-${SUFIJO}-${i}`, JSON.stringify([{ material_id: material.id, cantidad: 2, precio: 87.65 }])],
  )
  sembradas.push(id)
}
await como('gerencia')
for (const id of sembradas) await consulta(`select public.aprobar_compra($1)`, [id])
await como('logistica')
for (const [i, id] of sembradas.entries()) await consulta(`select public.programar_recojo($1, $2)`, [id, 20 + i])
const porId = Object.fromEntries((await consulta(`select id, numero from ordenes_compra_materiales where id = any($1)`, [sembradas])).map((f) => [f.id, f.numero]))
const [ocA, ocB, ocC] = sembradas.map((id) => porId[id])
const [idA, idB, idC] = sembradas
console.log(`Sembradas: ${ocA}, ${ocB}, ${ocC}`)

let limpiando = null
function limpiar() {
  limpiando ??= (async () => {
    const propia = new pg.Client(CONEXION)
    await propia.connect()
    try {
      const en = async (sql, valores = []) => (await propia.query(sql, valores)).rows
      await como('logistica', en)
      await en(
        `select public.quitar_recojo_de_la_lista(c.id) from ordenes_compra_materiales c join programacion_recojo p on p.orden_compra_id = c.id
          where c.id = any($1) and c.recojo = 'POR_RECOGER' and p.posicion is not null`,
        [sembradas],
      )
      await como('conductor', en)
      await en(`select public.marcar_compra_recogida(id) from ordenes_compra_materiales where id = any($1) and recojo = 'EN_RECOJO'`, [sembradas])
      await en(`select public.marcar_compra_dejada_almacen(id) from ordenes_compra_materiales where id = any($1) and recojo = 'RECOGIDO'`, [sembradas])
      await como('gerencia', en)
      await en(
        `select public.anular_orden_compra(id, 'Compra sembrada por la prueba de la evidencia del recojo: no es una compra real.')
           from ordenes_compra_materiales where id = any($1) and recojo = 'POR_RECOGER'`,
        [sembradas],
      )
    } finally {
      await propia.end().catch(() => {})
    }
  })().catch((e) => console.error('No se pudo cerrar el circuito:', e.message))
  return limpiando
}
for (const senal of ['SIGINT', 'SIGTERM']) process.on(senal, () => limpiar().finally(() => process.exit(1)))
process.on('uncaughtException', (e) => {
  console.error(e)
  limpiar().finally(() => process.exit(1))
})

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
// Una foto de verdad, pequeña: el selector la sube tal cual.
let FOTO
{
  const p = await (await navegador.newContext()).newPage()
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 640
    c.height = 480
    const g = c.getContext('2d')
    g.fillStyle = '#5a4b2a'
    g.fillRect(0, 0, 640, 480)
    g.fillStyle = '#fff'
    g.font = '32px sans-serif'
    g.fillText('Guía firmada (prueba)', 40, 80)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
    const b = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(s)
  })
  FOTO = join(CAPTURAS, `guia-firmada-${SUFIJO}.jpg`)
  writeFileSync(FOTO, Buffer.from(b64, 'base64'))
  await p.context().close()
}

async function entrar(correo, ancho, escala = 1) {
  const contexto = await navegador.newContext({ locale: 'es-PE', viewport: { width: ancho, height: ancho < 500 ? 844 : 900 }, hasTouch: ancho < 500, deviceScaleFactor: escala })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto, errores }
}
const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ')
const tarjeta = (pagina, oc) => pagina.locator('main section > div').filter({ has: pagina.getByRole('heading', { name: new RegExp(oc.replace(/[-]/g, '\\-')) }) })
const fila = async (sql, valores) => (await consulta(sql, valores))[0]
/**
 * La miniatura carga con `loading="lazy"`: fuera de la vista no se pide. Se la
 * trae a la vista, se espera a que cargue y se pide su enlace, que es el que
 * abre la foto entera.
 */
async function fotoQueAbre(pagina, tarjetaDeLaOc) {
  const img = tarjetaDeLaOc.locator('img').first()
  await img.waitFor({ timeout: 10000 })
  await img.scrollIntoViewIfNeeded()
  const cargo = await img
    .evaluate((i) => (i.complete && i.naturalWidth > 0) || new Promise((listo) => {
      i.addEventListener('load', () => listo(i.naturalWidth > 0), { once: true })
      i.addEventListener('error', () => listo(false), { once: true })
      setTimeout(() => listo(false), 10000)
    }))
    .catch(() => false)
  const enlace = await tarjetaDeLaOc.locator('a:has(img)').first().getAttribute('href')
  const abre = enlace ? (await pagina.request.get(enlace)).ok() : false
  return cargo === true && abre
}

async function sinDesborde(pagina, donde) {
  const [ancho, ventana] = await pagina.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  comprobar(ancho <= ventana, `${donde}: la página no se desborda a lo ancho (${ancho} de ${ventana})`)
}
const MOTIVO_B = `El almacén del proveedor estaba cerrado; abren el lunes a las 8 (${SUFIJO}).`
const MOTIVO_C = `Llegué y el material todavía no estaba listo, dicen que mañana (${SUFIJO}).`

try {
  // ------------------------------------------------ 1. Ya la recogí, con su foto
  {
    const { pagina, contexto, errores } = await entrar(CUENTAS.conductor, 390, 2)
    await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
    const donde = 'conductor a 390'
    const a = tarjeta(pagina, ocA)
    await a.waitFor({ timeout: 15000 })
    const noSePudo = a.getByRole('button', { name: 'No se pudo recoger' })
    comprobar((await noSePudo.count()) === 1, `${donde}: la parada pendiente ofrece «No se pudo recoger»`)
    const altos = await a.getByRole('button').evaluateAll((l) => l.map((x) => Math.round(x.getBoundingClientRect().height)))
    comprobar(altos.every((h) => h >= 44), `${donde}: los botones del conductor miden 44 px o más (${altos.join(', ')})`)

    await a.getByRole('button', { name: 'Salgo a recoger' }).click()
    await a.getByRole('button', { name: 'Ya la recogí' }).waitFor({ timeout: 15000 })
    await a.getByRole('button', { name: 'Ya la recogí' }).click()
    const ventana = pagina.getByRole('dialog')
    await ventana.waitFor({ timeout: 10000 })
    comprobar((await texto(ventana)).includes('opcional'), `${donde}: la ventana dice que la foto es opcional`)
    await pagina.screenshot({ path: `${CAPTURAS}/5-2-conductor-390-1-ya-la-recogi.png` })
    await ventana.locator('input[type="file"]:not([capture])').setInputFiles(FOTO)
    const enviar = ventana.getByRole('button', { name: 'Sí, ya la recogí' })
    await enviar.waitFor({ timeout: 20000 })
    await pagina.waitForFunction(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent?.includes('Sí, ya la recogí'))
      return b && !b.disabled
    }, null, { timeout: 20000 })
    await pagina.screenshot({ path: `${CAPTURAS}/5-2-conductor-390-2-con-su-foto.png` })
    await enviar.click()
    await a.getByRole('button', { name: 'La dejé en almacén' }).waitFor({ timeout: 20000 })

    const fa = await fila(`select recojo, recogido_por from ordenes_compra_materiales where id = $1`, [idA])
    const fotos = await consulta(`select ruta, subida_por, mime_type from recojo_fotos where orden_compra_id = $1`, [idA])
    comprobar(fa.recojo === 'RECOGIDO' && fa.recogido_por === ids[CUENTAS.conductor], `la base tiene ${ocA} recogida por el conductor`)
    comprobar(
      fotos.length === 1 && fotos[0].ruta.startsWith(`${ids[CUENTAS.conductor]}/${idA}/`) && fotos[0].subida_por === ids[CUENTAS.conductor],
      `y su foto anotada, en la carpeta de su cuenta y de esa OC (${fotos[0]?.ruta})`,
    )
    const [enStorage] = await consulta(`select count(*)::int as n from storage.objects where bucket_id = 'fotos-recojo' and name = $1`, [fotos[0]?.ruta ?? ''])
    comprobar(enStorage.n === 1, 'la foto está en el bucket privado fotos-recojo')
    await a.getByText('Fotos del recojo (1 foto)').waitFor({ timeout: 10000 })
    comprobar(await fotoQueAbre(pagina, a), `${donde}: la tarjeta muestra la foto y abre`)
    comprobar((await a.getByRole('button', { name: 'No se pudo recoger' }).count()) === 0, `${donde}: ya recogida, no ofrece «No se pudo recoger»`)
    await sinDesborde(pagina, donde)
    comprobar(errores.length === 0, `${donde}: sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // ------------------------------------------------ 2. La B no se pudo recoger, sin salir
  {
    const { pagina, contexto, errores } = await entrar(CUENTAS.conductor, 390, 2)
    await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
    const donde = 'conductor a 390'
    const b = tarjeta(pagina, ocB)
    await b.getByRole('button', { name: 'No se pudo recoger' }).click()
    const ventana = pagina.getByRole('dialog')
    await ventana.waitFor({ timeout: 10000 })
    const motivo = ventana.getByRole('textbox')
    await motivo.fill('cerrado')
    await ventana.getByRole('button', { name: 'Devolver a Logística' }).click()
    await pagina.waitForTimeout(800)
    const [corto] = await consulta(`select count(*)::int as n from recojos_no_logrados where orden_compra_id = $1`, [idB])
    comprobar(corto.n === 0 && (await ventana.isVisible()), `${donde}: con «cerrado» (7 letras) no entra y la ventana sigue abierta`)
    await motivo.fill(MOTIVO_B)
    await pagina.screenshot({ path: `${CAPTURAS}/5-2-conductor-390-3-no-se-pudo.png` })
    // Dos toques seguidos: entra una vez.
    await ventana.getByRole('button', { name: 'Devolver a Logística' }).dblclick()
    await b.waitFor({ state: 'detached', timeout: 20000 })
    const intentos = await consulta(`select motivo, salio_en, registrado_por from recojos_no_logrados where orden_compra_id = $1`, [idB])
    const fb = await fila(
      `select c.recojo, p.posicion from ordenes_compra_materiales c left join programacion_recojo p on p.orden_compra_id = c.id where c.id = $1`,
      [idB],
    )
    comprobar(intentos.length === 1, `${donde}: dos toques, un solo aviso (${intentos.length})`)
    comprobar(intentos[0]?.motivo === MOTIVO_B && intentos[0]?.registrado_por === ids[CUENTAS.conductor] && intentos[0]?.salio_en === null, 'el aviso queda con su motivo y quién lo dio, sin hora de salida')
    comprobar(fb.recojo === 'POR_RECOGER' && fb.posicion === null, `${ocB} volvió a «Por programar»: pendiente y fuera de la lista`)
    comprobar((await tarjeta(pagina, ocB).count()) === 0, `${donde}: ${ocB} sale de la lista del conductor`)
    comprobar(errores.length === 0, `${donde}: sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // ------------------------------------------------ 3. La C, ya en recojo, tampoco
  {
    const { pagina, contexto, errores } = await entrar(CUENTAS.conductor, 390, 2)
    await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
    const donde = 'conductor a 390'
    const c = tarjeta(pagina, ocC)
    await c.getByRole('button', { name: 'Salgo a recoger' }).click()
    await c.getByRole('button', { name: 'Ya la recogí' }).waitFor({ timeout: 15000 })
    const salio = (await fila(`select en_recojo_en from ordenes_compra_materiales where id = $1`, [idC])).en_recojo_en
    await c.getByRole('button', { name: 'No se pudo recoger' }).click()
    const ventana = pagina.getByRole('dialog')
    await ventana.getByRole('textbox').fill(MOTIVO_C)
    await ventana.getByRole('button', { name: 'Devolver a Logística' }).click()
    await c.waitFor({ state: 'detached', timeout: 20000 })
    const fc = await fila(`select recojo, en_recojo_en, en_recojo_por from ordenes_compra_materiales where id = $1`, [idC])
    const [ic] = await consulta(`select salio_en from recojos_no_logrados where orden_compra_id = $1`, [idC])
    comprobar(fc.recojo === 'POR_RECOGER' && fc.en_recojo_en === null && fc.en_recojo_por === null, `${ocC} suelta la salida y vuelve a pendiente`)
    comprobar(ic && new Date(ic.salio_en).getTime() === new Date(salio).getTime(), 'y el aviso guarda la hora a la que había salido')
    comprobar(errores.length === 0, `${donde}: sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // ------------------------------------------------ 4 y 5. Logística recibe el aviso y ve el motivo y la foto
  {
    const avisos = await consulta(
      `select titulo, cuerpo, ruta from notificaciones where usuario_id = $1 and origen_id = any($2) and titulo like 'No se pudo recoger:%'`,
      [ids[CUENTAS.logistica], [idB, idC]],
    )
    comprobar(avisos.length === 2, `a Logística le llegan los dos avisos por la campana (${avisos.length})`)
    comprobar(
      avisos.some((a) => a.titulo.includes(ocB) && a.cuerpo.includes(MOTIVO_B) && a.ruta === '/compras/gestion'),
      'el aviso nombra la OC, trae el motivo y lleva a Gestión de compras',
    )
    const [alConductor] = await consulta(
      `select count(*)::int as n from notificaciones where usuario_id = $1 and origen_id = any($2) and titulo like 'No se pudo recoger:%'`,
      [ids[CUENTAS.conductor], [idB, idC]],
    )
    comprobar(alConductor.n === 0, 'al conductor no le llega su propio aviso')

    for (const ancho of [390, 1440]) {
      const { pagina, contexto, errores } = await entrar(CUENTAS.logistica, ancho, 2)
      const donde = `Logística a ${ancho}`
      await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
      const b = tarjeta(pagina, ocB)
      await b.waitFor({ timeout: 15000 })
      const enPorProgramar = await pagina.locator('section[aria-labelledby="titulo-por-programar"]').getByRole('heading', { name: new RegExp(ocB) }).count()
      comprobar(enPorProgramar === 1, `${donde}: ${ocB} está en «Por programar»`)
      comprobar((await texto(b)).includes('No se pudo recoger') && (await texto(b)).includes(MOTIVO_B), `${donde}: con lo que dijo el conductor`)
      const a = tarjeta(pagina, ocA)
      comprobar(await fotoQueAbre(pagina, a), `${donde}: ve la foto del recojo de ${ocA}, que abre`)
      comprobar((await pagina.getByRole('button', { name: /No se pudo recoger|Ya la recogí|Salgo a recoger/ }).count()) === 0, `${donde}: sin los botones del conductor`)
      await sinDesborde(pagina, donde)
      await b.scrollIntoViewIfNeeded()
      await pagina.screenshot({ path: `${CAPTURAS}/5-2-logistica-${ancho}-gestion.png` })
      comprobar(errores.length === 0, `${donde}: sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
      await contexto.close()
    }
  }
} finally {
  await navegador.close().catch(() => {})
  await limpiar()
  await base.end().catch(() => {})
}

console.log(fallas.length ? `\n${fallas.length} comprobaciones fallaron:\n- ${fallas.join('\n- ')}` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
