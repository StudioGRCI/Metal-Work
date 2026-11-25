/**
 * Clic real sobre la ruta del conductor en /recojos (Plan 5, entrega 5.1), con
 * la cuenta de cada puesto (nunca ADMIN), en teléfono (390) y en monitor (1440):
 *
 *   1. El conductor ve cada parada con «Abrir en el mapa» (la dirección de
 *      recojo del proveedor) y un «Llamar» por cada número del padrón, que es
 *      texto libre: «999 000 111 - 988 000 222» son dos botones, no un número
 *      de 18 dígitos. Todos miden 44 px o más, en teléfono y en monitor. Si el
 *      padrón dice más que el número («anexo 205», «en caja»), eso
 *      se sigue leyendo en la tarjeta, y el anexo no se marca.
 *   2. Sin nada recogido, «Recogido y dejado hoy» dice que todavía no hay.
 *   3. Recoge una y la deja en almacén, y recoge otra: la sección de hoy las
 *      lista en el orden en que pasaron, cada una con su hora de Lima, y la
 *      base tiene esas mismas horas.
 *   4. Recogida o dejada, los botones grandes dejan su lugar a los enlaces del
 *      texto, como estaban antes: la dirección abre el mapa y cada número llama.
 *   5. Logística abre la misma pantalla, ve lo de hoy y no tiene los botones
 *      del conductor; llama y abre el mapa desde los enlaces del texto.
 *   6. La pantalla no enseña precios ni totales.
 *
 * Siembra dos proveedores y sus cuatro OC aprobadas y programadas (Logística
 * las emite y programa y Gerencia las aprueba, con las funciones de la base) y
 * las sigue por su número. Al terminar, también si la prueba se cae, cierra el
 * circuito con las funciones de la base: las que quedan sin recoger salen de la
 * lista y Gerencia las anula con su motivo, y la que el conductor tiene encima
 * la deja en almacén.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE, CAPTURAS y
 * los correos de cada cuenta si no son las `*.local@metalwork.test`.
 */
import { mkdirSync } from 'node:fs'

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
const DIRECCION = `Calle Prueba 3458, Callao ${SUFIJO}`
// La dirección fiscal no es adonde va el conductor: va a la de recojo.
const [{ id: conDosNumeros }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, direccion_recojo, telefono, contacto)
   values ($1, $2, 'Jr. Fiscal 100, Lima', $3, '999 000 111 - 988 000 222', 'Rosa Quispe') returning id`,
  [await rucLibre(), `ACEROS DE RUTA ${SUFIJO}`, DIRECCION],
)
// El padrón dice más que el número: el anexo no se marca y lo escrito se sigue leyendo.
// El padrón guarda hasta 40 letras.
const TELEFONO_CON_ANEXO = 'en caja: (01) 000-0111 anexo 205'
const [{ id: conAnexo }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. Los Pernos 45, Ate', $3) returning id`,
  [await rucLibre(), `PERNOS DE RUTA ${SUFIJO}`, TELEFONO_CON_ANEXO],
)
const [material] = await consulta(`select id from materiales where activo and not coalesce(unidad_pendiente, false) order by codigo limit 1`)
if (!material) throw new Error('El banco no tiene materiales.')
await como('logistica')
const sembradas = []
for (const [i, proveedor] of [conDosNumeros, conDosNumeros, conAnexo, conDosNumeros].entries()) {
  const [{ id }] = await consulta(
    `select public.emitir_compra_directa(gen_random_uuid(), $1, $2, 'Reposición del almacén, prueba de la ruta', $3::jsonb,
                                         current_date + 5, 'CONTADO', 0, 'PEN', false, 'PLANTA') as id`,
    [proveedor, `COT-RUTA-${SUFIJO}-${i + 1}`, JSON.stringify([{ material_id: material.id, cantidad: 2, precio: 87.65 }])],
  )
  sembradas.push(id)
}
await como('gerencia')
for (const id of sembradas) await consulta(`select public.aprobar_compra($1)`, [id])
await como('logistica')
for (const [i, id] of sembradas.entries()) await consulta(`select public.programar_recojo($1, $2)`, [id, 12.5 + i])
const porId = Object.fromEntries((await consulta(`select id, numero from ordenes_compra_materiales where id = any($1)`, [sembradas])).map((f) => [f.id, f.numero]))
const [ocA, ocB, ocC, ocD] = sembradas.map((id) => porId[id])
console.log(`Sembradas: ${ocA}, ${ocB}, ${ocC}, ${ocD}`)

/** En un banco compartido, lo que la prueba deja a medias estorbaría a la siguiente: se cierra con las funciones de la base. */
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
      // Lo que el conductor tiene encima lo deja en almacén, como en la ruta de verdad.
      await como('conductor', en)
      await en(`select public.marcar_compra_recogida(id) from ordenes_compra_materiales where id = any($1) and recojo = 'EN_RECOJO'`, [sembradas])
      await en(`select public.marcar_compra_dejada_almacen(id) from ordenes_compra_materiales where id = any($1) and recojo = 'RECOGIDO'`, [sembradas])
      // Las que nadie recogió no se borran (un documento numerado no se borra): Gerencia las anula con su motivo.
      await como('gerencia', en)
      await en(
        `select public.anular_orden_compra(id, 'Compra sembrada por la prueba de la ruta del conductor: no es una compra real.')
           from ordenes_compra_materiales where id = any($1) and recojo = 'POR_RECOGER'`,
        [sembradas],
      )
    } finally {
      await propia.end().catch(() => {})
    }
  })().catch((e) => console.error('No se pudo limpiar la lista:', e.message))
  return limpiando
}
for (const senal of ['SIGINT', 'SIGTERM']) process.on(senal, () => limpiar().finally(() => process.exit(1)))
process.on('uncaughtException', (e) => {
  console.error(e)
  limpiar().finally(() => process.exit(1))
})

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
async function entrar(correo, ancho, escala = 1) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: ancho < 500 ? 844 : 900 }, hasTouch: ancho < 500, deviceScaleFactor: escala })
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
/** Lo que se ve, sin lo que es solo para el lector de pantalla. */
const seLee = (loc) =>
  loc.evaluate((el) => {
    const copia = el.cloneNode(true)
    copia.querySelectorAll('.sr-only').forEach((x) => x.remove())
    return copia.textContent.replace(/\s+/g, ' ').trim()
  })
/** La tarjeta de una compra: el bloque que lleva su número en el título. */
const tarjeta = (pagina, oc) => pagina.locator('main section > div').filter({ has: pagina.getByRole('heading', { name: new RegExp(oc.replace(/[-]/g, '\\-')) }) })
const deHoy = (pagina) => pagina.locator('section[aria-labelledby="recojos-de-hoy"]')
const horaLima = (instante) =>
  new Date(instante).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false })
async function sinDesborde(pagina, donde) {
  const [ancho, ventana] = await pagina.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  comprobar(ancho <= ventana, `${donde}: la página no se desborda a lo ancho (${ancho} de ${ventana})`)
}

try {
  // ------------------------------------------------ 1 y 2. Las paradas, en teléfono y en monitor
  for (const ancho of [390, 1440]) {
    const { pagina, contexto, errores } = await entrar(CUENTAS.conductor, ancho, 2)
    await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
    const donde = `conductor a ${ancho}`
    const a = tarjeta(pagina, ocA)
    await a.waitFor({ timeout: 15000 })
    comprobar((await texto(a)).includes(DIRECCION), `${donde}: ${ocA} muestra la dirección de recojo, no la fiscal`)
    comprobar(!(await texto(a)).includes('Jr. Fiscal 100'), `${donde}: la dirección fiscal no sale`)

    const mapa = a.getByRole('link', { name: /Abrir en el mapa/ })
    comprobar((await mapa.count()) === 1, `${donde}: ${ocA} tiene un «Abrir en el mapa»`)
    const hrefMapa = await mapa.getAttribute('href')
    comprobar(
      hrefMapa === `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(DIRECCION)}`,
      `${donde}: el mapa lleva la dirección de recojo (${hrefMapa?.slice(0, 80)}…)`,
    )
    comprobar((await mapa.getAttribute('target')) === '_blank', `${donde}: el mapa abre fuera de la pantalla, sin perderla`)

    const llamar = a.getByRole('link', { name: /^Llamar .*, Rosa Quispe$/ })
    const hrefs = await llamar.evaluateAll((l) => l.map((x) => x.getAttribute('href')))
    comprobar(hrefs.length === 2 && hrefs[0] === 'tel:999000111' && hrefs[1] === 'tel:988000222', `${donde}: dos números, dos «Llamar»: ${hrefs.join(' y ')}`)
    comprobar((await seLee(llamar.first())) === 'Llamar 999 000 111', `${donde}: el botón dice a qué número llama: «${await seLee(llamar.first())}»`)
    // Lo que se oye empieza con lo que se lee (WCAG 2.5.3): quien dicta «Llamar 999 000 111» lo encuentra.
    // Chrome pone un espacio delante de lo que es solo para el lector; lo que importa es que empiece igual.
    comprobar((await a.getByRole('link', { name: /^Llamar 999 000 111\s*,\s*Rosa Quispe$/ }).count()) === 1, `${donde}: el lector oye el número y a quién llama`)
    comprobar(!(await texto(a)).includes('999 000 111 - 988 000 222'), `${donde}: el padrón no se repite cuando los botones ya dicen todo`)

    // 44 px o más, también con ratón: en el monitor los botones normales bajan a 36.
    const altos = await a.locator('a[href^="tel:"], a[href*="google.com/maps"], button').evaluateAll((l) => l.map((x) => Math.round(x.getBoundingClientRect().height)))
    comprobar(altos.length >= 4 && altos.every((h) => h >= 44), `${donde}: los botones de la parada miden 44 px o más (${altos.join(', ')})`)
    // Y no más de dos renglones: apretados en una fila, «Abrir en el mapa» salía partido en tres.
    comprobar(altos.every((h) => h <= 64), `${donde}: ningún botón de la parada parte su texto en tres renglones (${altos.join(', ')})`)

    const c = tarjeta(pagina, ocC)
    const hrefsC = await c.locator('a[href^="tel:"]').evaluateAll((l) => l.map((x) => x.getAttribute('href')))
    comprobar(hrefsC.length === 1 && hrefsC[0] === 'tel:010000111', `${donde}: «${TELEFONO_CON_ANEXO}» da un solo «Llamar», sin el anexo: ${hrefsC.join(', ')}`)
    comprobar((await texto(c)).includes(TELEFONO_CON_ANEXO), `${donde}: y lo que dice el padrón, con el anexo, se sigue leyendo`)
    comprobar((await c.getByRole('link', { name: /Abrir en el mapa/ }).count()) === 1, `${donde}: ${ocC} sí abre su dirección en el mapa`)

    comprobar(
      /Todavía no recogiste ni dejaste nada hoy\./.test(await texto(deHoy(pagina))) || (await deHoy(pagina).locator('li').count()) > 0,
      `${donde}: «Recogido y dejado hoy» está debajo de la lista`,
    )
    const sinPrecio = await texto(pagina.locator('main'))
    comprobar(!/S\/|US\$|87[.,]65|175[.,]30/.test(sinPrecio), `${donde}: la pantalla no enseña precios ni totales`)
    await sinDesborde(pagina, donde)
    await pagina.screenshot({ path: `${CAPTURAS}/recojos-conductor-${ancho}-1-ruta.png`, fullPage: true })
    comprobar(errores.length === 0, `${donde}: sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // ------------------------------------------------ 3 y 4. Recoge, deja, y lo de hoy lo cuenta
  {
    const { pagina, contexto, errores } = await entrar(CUENTAS.conductor, 390, 2)
    await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
    const donde = 'conductor a 390'
    const antes = await deHoy(pagina).locator('li').count()

    const a = tarjeta(pagina, ocA)
    await a.getByRole('button', { name: 'Salgo a recoger' }).click()
    await a.getByRole('button', { name: 'Ya la recogí' }).waitFor({ timeout: 15000 })
    await a.getByRole('button', { name: 'Ya la recogí' }).click()
    await a.getByRole('button', { name: 'La dejé en almacén' }).waitFor({ timeout: 15000 })
    await deHoy(pagina).locator('li').filter({ hasText: ocA }).filter({ hasText: 'Recogida' }).waitFor({ timeout: 15000 })
    comprobar(true, `${donde}: al marcar «Ya la recogí», ${ocA} aparece en lo de hoy como «Recogida»`)
    comprobar(
      (await a.getByRole('link', { name: /^Llamar / }).count()) === 0 && (await a.locator('a[href^="tel:"]').count()) === 2,
      `${donde}: recogida, ${ocA} deja los botones grandes y sigue llamando desde el texto`,
    )

    await a.getByRole('button', { name: 'La dejé en almacén' }).click()
    await pagina.getByRole('button', { name: 'Sí, la dejé' }).click()
    await deHoy(pagina).locator('li').filter({ hasText: ocA }).filter({ hasText: 'En almacén' }).waitFor({ timeout: 15000 })

    const b = tarjeta(pagina, ocB)
    await b.getByRole('button', { name: 'Salgo a recoger' }).click()
    await b.getByRole('button', { name: 'Ya la recogí' }).waitFor({ timeout: 15000 })
    await b.getByRole('button', { name: 'Ya la recogí' }).click()
    await deHoy(pagina).locator('li').filter({ hasText: ocB }).filter({ hasText: 'Recogida' }).waitFor({ timeout: 15000 })

    const [fa] = await consulta(`select recojo, recogido_en, dejado_en from ordenes_compra_materiales where id = $1`, [sembradas[0]])
    const [fb] = await consulta(`select recojo, recogido_en, dejado_en from ordenes_compra_materiales where id = $1`, [sembradas[1]])
    comprobar(fa.recojo === 'DEJADO' && fb.recojo === 'RECOGIDO' && fb.dejado_en === null, `la base tiene ${ocA} dejada y ${ocB} recogida`)

    const filas = await deHoy(pagina).locator('li').evaluateAll((l) => l.map((x) => x.innerText.replace(/\s+/g, ' ')))
    const mias = filas.filter((f) => f.includes(ocA) || f.includes(ocB))
    comprobar(mias.length === 3, `${donde}: lo de hoy tiene los tres pasos de la prueba (${mias.length})`)
    comprobar(
      mias[0]?.startsWith(horaLima(fa.recogido_en)) && mias[0].includes(ocA) && mias[0].includes('Recogida'),
      `${donde}: primero ${ocA} recogida, con la hora de Lima que guardó la base: «${mias[0]}»`,
    )
    comprobar(
      mias.some((f) => f.startsWith(horaLima(fa.dejado_en)) && f.includes(ocA) && f.includes('En almacén')),
      `${donde}: ${ocA} dejada en almacén a las ${horaLima(fa.dejado_en)}`,
    )
    comprobar(
      mias.some((f) => f.startsWith(horaLima(fb.recogido_en)) && f.includes(ocB) && f.includes('Recogida')),
      `${donde}: ${ocB} recogida a las ${horaLima(fb.recogido_en)}`,
    )
    comprobar(filas.length === antes + 3, `${donde}: lo de hoy suma los tres pasos (${antes} → ${filas.length})`)
    comprobar(mias.every((f) => f.includes(`ACEROS DE RUTA ${SUFIJO}`)), `${donde}: cada paso dice de qué proveedor es`)

    // La dejada baja a «Dejadas en almacén esta semana»: conserva sus datos y sus enlaces, sin botones grandes.
    const dejada = tarjeta(pagina, ocA)
    await dejada.getByText('En almacén').first().waitFor({ timeout: 15000 })
    comprobar((await dejada.getByRole('link', { name: /^Llamar |^Abrir en el mapa/ }).count()) === 0, `${donde}: ya dejada, ${ocA} no tiene los botones de la ruta`)
    comprobar(
      (await dejada.locator('a[href^="tel:"]').count()) === 2 && (await dejada.getByRole('link', { name: DIRECCION }).count()) === 1,
      `${donde}: y la dirección abre el mapa y cada número llama desde el texto, como antes`,
    )
    await sinDesborde(pagina, donde)
    await pagina.screenshot({ path: `${CAPTURAS}/recojos-conductor-390-2-lo-de-hoy.png`, fullPage: true })
    comprobar(errores.length === 0, `${donde}: sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }
  {
    const { pagina, contexto } = await entrar(CUENTAS.conductor, 1440, 2)
    await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
    await deHoy(pagina).locator('li').filter({ hasText: ocB }).waitFor({ timeout: 15000 })
    await sinDesborde(pagina, 'conductor a 1440')
    await pagina.screenshot({ path: `${CAPTURAS}/recojos-conductor-1440-2-lo-de-hoy.png`, fullPage: true })
    await contexto.close()
  }

  // ------------------------------------------------ 5. Logística la sigue, sin los botones del conductor
  {
    const { pagina, contexto, errores } = await entrar(CUENTAS.logistica, 390, 2)
    await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
    await deHoy(pagina).locator('li').filter({ hasText: ocB }).waitFor({ timeout: 15000 })
    comprobar((await deHoy(pagina).locator('li').filter({ hasText: ocA }).count()) === 2, `Logística ve lo que el conductor recogió y dejó hoy de ${ocA}`)
    comprobar((await pagina.getByRole('button', { name: /Salgo a recoger|Ya la recogí|La dejé en almacén/ }).count()) === 0, 'Logística no tiene los botones del conductor')
    const d = tarjeta(pagina, ocD)
    comprobar(
      (await d.locator('a[href^="tel:"]').count()) === 2 && (await d.getByRole('link', { name: DIRECCION }).count()) === 1,
      'Logística llama al proveedor y abre el mapa desde los enlaces del texto',
    )
    comprobar((await d.getByRole('link', { name: /^Llamar |^Abrir en el mapa/ }).count()) === 0, 'Logística no tiene los botones grandes del conductor')
    await pagina.screenshot({ path: `${CAPTURAS}/recojos-logistica-390.png`, fullPage: true })
    comprobar(errores.length === 0, `Logística: sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }
} finally {
  await navegador.close().catch(() => {})
  await limpiar()
  await base.end().catch(() => {})
}

console.log(fallas.length ? `\n${fallas.length} comprobaciones fallaron:\n- ${fallas.join('\n- ')}` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
