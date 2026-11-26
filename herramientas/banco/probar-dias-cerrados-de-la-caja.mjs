/**
 * La historia de los días cerrados de la caja (plan 11, entrega 11.3), con la
 * cuenta de Tesorería y la de Gerencia (nunca ADMIN), y con Contabilidad, que
 * no debe entrar:
 *
 *   1. Tesorería da de alta una cuenta de banco con la captura de su saldo y
 *      cierra dos días: uno que cuadra y otro con diferencia y observación.
 *      Reabre el segundo con su motivo y lo vuelve a cerrar.
 *   2. En /tesoreria/caja-diaria/cierres, Tesorería y Gerencia ven los dos
 *      cierres vigentes con quién cerró, la hora, el saldo del sistema, el del
 *      estado de cuenta y la diferencia («Cuadra» o el monto), en el orden de
 *      la base; el reabierto va aparte, con quién, cuándo y su motivo.
 *   3. La pantalla no tiene ningún botón que cambie un cierre.
 *   4. La captura del saldo de apertura se abre para las dos (303 al archivo).
 *   5. Contabilidad no entra a la pantalla, ni la base le da la historia ni la
 *      captura; Gerencia sigue sin leer `cierres_caja` directo.
 *   6. Sin desborde a 390 px y sin errores de consola; capturas en CAPTURAS.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE,
 * BANCO_ARCHIVOS.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'
import { esperarReactAlNavegar } from './con-react.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ARCHIVOS = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(['tesoreria', 'gerencia', 'contabilidad'].map((p) => [p, cuenta(p)]))
// Costos tiene `tesoreria.ver_documentos` y StudioGRCI decidió que no vea la historia (2026-11-26).
// El banco no trae `costos.local`: se usa la cuenta de Costos de la siembra, solo en la base.
CUENTAS.costos = process.env.COSTOS ?? 'costos@metalworkperusac.com'
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
const consulta = async (sql, valores = []) => (await base.query(sql, valores)).rows

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
const mas = (n) => {
  const d = new Date(`${hoy}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const ddmmaaaa = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`

const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)
async function como(puesto) {
  const sub = puesto ? ids[CUENTAS[puesto]] : ''
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, puesto ? JSON.stringify({ sub, role: 'authenticated' }) : ''])
}
/** Corre `sql` con el rol real: `set local role authenticated` dentro de una transacción. */
async function conRol(puesto, sql, valores = []) {
  await como(puesto)
  await base.query('begin')
  try {
    await base.query('set local role authenticated')
    const r = (await base.query(sql, valores)).rows
    await base.query('commit')
    return r
  } catch (e) {
    await base.query('rollback')
    throw e
  } finally {
    await como(null)
  }
}

// ---------------------------------------------------------------- siembra, con el rol de Tesorería
// Los cierres de este mes, para que la pantalla los muestre sin cambiar de mes: los dos días van
// dentro del mes de hoy (si hoy es 1 o 2, el primero cae en el mes anterior y se mira ese).
const SUFIJO = String(100000 + (Date.now() % 900000))
const NOMBRE = `BCP PRUEBA ${SUFIJO}`
const [{ id: caja }] = await consulta(`select gen_random_uuid() as id`)
const [{ id: archivo }] = await consulta(`select gen_random_uuid() as id`)
const ruta = `${caja}/${archivo}.pdf`
{
  const destino = join(ARCHIVOS, 'apertura-caja', ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, PDF)
  await consulta(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ('apertura-caja', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
    [ruta, ids[CUENTAS.tesoreria], PDF.length],
  )
}
const DIA1 = mas(-2)
const DIA2 = mas(-1)
await conRol('tesoreria', `select public.guardar_caja($1, $2, 'BANCO', 'BCP', 'PEN', 1500, $3::date, true, $4)`, [caja, NOMBRE, DIA1, ruta])
const [{ id: c1 }] = await consulta(`select gen_random_uuid() as id`)
const [{ id: c2 }] = await consulta(`select gen_random_uuid() as id`)
const [{ id: c3 }] = await consulta(`select gen_random_uuid() as id`)
/** La captura del estado de cuenta de un cierre, subida como la sube el navegador (bucket cierre-caja, 20261126550000). */
async function capturaDelCierre(cuenta, cierre) {
  const r = `${cuenta}/${cierre}.pdf`
  const destino = join(ARCHIVOS, 'cierre-caja', r)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, PDF)
  await consulta(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ('cierre-caja', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
    [r, ids[CUENTAS.tesoreria], PDF.length],
  )
  return r
}
let sinCaptura = ''
try {
  await conRol('tesoreria', `select public.cerrar_dia_caja($1, $2, $3::date, 1500, null)`, [c1, caja, DIA1])
} catch (e) {
  sinCaptura = e.message
}
comprobar(sinCaptura.includes('Adjunta la captura del aplicativo'), `un banco no se cierra sin la captura del día («${sinCaptura.slice(0, 90)}»)`)
await conRol('tesoreria', `select public.cerrar_dia_caja($1, $2, $3::date, 1500, null, $4)`, [c1, caja, DIA1, await capturaDelCierre(caja, c1)])
await conRol('tesoreria', `select public.cerrar_dia_caja($1, $2, $3::date, 1480.50, 'Comisión del banco sin registrar', $4)`, [c2, caja, DIA2, await capturaDelCierre(caja, c2)])
const MOTIVO = `La comisión era de otra cuenta (${SUFIJO})`
await conRol('tesoreria', `select public.reabrir_dia_caja($1, $2)`, [c2, MOTIVO])
await conRol('tesoreria', `select public.cerrar_dia_caja($1, $2, $3::date, 1500, null, $4)`, [c3, caja, DIA2, await capturaDelCierre(caja, c3)])
// La caja chica, sin foto del conteo, cerrada con una diferencia que queda: la que el filtro «No cuadran» deja.
const NOMBRE_B = `CAJA CHICA PRUEBA ${SUFIJO}`
const [{ id: cajaB }] = await consulta(`select gen_random_uuid() as id`)
const [{ id: c4 }] = await consulta(`select gen_random_uuid() as id`)
await conRol('tesoreria', `select public.guardar_caja($1, $2, 'EFECTIVO', null, 'PEN', 800, $3::date, true, null)`, [cajaB, NOMBRE_B, DIA2])
await conRol('tesoreria', `select public.cerrar_dia_caja($1, $2, $3::date, 780.50, 'Falta un cargo del banco')`, [c4, cajaB, DIA2])
const MES = DIA1.slice(0, 7)
const [{ nombres: QUIEN }] = await consulta(`select nombres from usuarios where id = $1`, [ids[CUENTAS.tesoreria]])

// ---------------------------------------------------------------- la base, con cada rol
const desde = `${MES}-01`
const historia = await conRol('tesoreria', `select * from public.historia_cierres_caja($1::date, $2::date) where caja_id = $3`, [desde, hoy, caja])
comprobar(historia.length === 3, `Tesorería: la base da los 3 cierres de la cuenta, con el reabierto (${historia.length})`)
const deGerencia = await conRol('gerencia', `select id, cerrado_por, reabierto_por, motivo_reapertura from public.historia_cierres_caja($1::date, $2::date) where caja_id = $3`, [desde, hoy, caja])
comprobar(deGerencia.length === 3 && deGerencia.every((k) => k.cerrado_por), `Gerencia: la base le da los mismos 3, con quién cerró (${deGerencia.length})`)
comprobar(deGerencia.some((k) => k.motivo_reapertura === MOTIVO), 'Gerencia: con el motivo de la reapertura')
const directo = await conRol('gerencia', `select count(*)::int as n from public.cierres_caja where caja_id = $1`, [caja])
comprobar(directo[0].n === 3, `Gerencia lee los mismos cierres en la tabla, con tesoreria.ver_caja (${directo[0].n})`)
const conDif = await conRol('gerencia', `select diferencia from public.historia_cierres_caja($1::date, $2::date) where id = $3`, [desde, hoy, c4])
comprobar(Number(conDif[0]?.diferencia) === -19.5, `la diferencia de la otra cuenta es −19.50 (${conDif[0]?.diferencia})`)
let rechazo = ''
try {
  await conRol('contabilidad', `select * from public.historia_cierres_caja($1::date, $2::date)`, [desde, hoy])
} catch (e) {
  rechazo = e.message
}
comprobar(rechazo.includes('No tienes permiso para ver los días cerrados'), `Contabilidad: la base no le da la historia («${rechazo}»)`)
rechazo = ''
try {
  await conRol('costos', `select * from public.historia_cierres_caja($1::date, $2::date)`, [desde, hoy])
} catch (e) {
  rechazo = e.message
}
comprobar(rechazo.includes('No tienes permiso para ver los días cerrados'), `Costos, con tesoreria.ver_documentos: la base no le da la historia («${rechazo}»)`)
const cierresCostos = await conRol('costos', `select count(*)::int as n from public.cierres_caja where caja_id = $1`, [caja])
comprobar(cierresCostos[0].n === 0, `Costos no lee cierres_caja (${cierresCostos[0].n})`)
const objetos = await conRol('gerencia', `select count(*)::int as n from storage.objects where bucket_id = 'apertura-caja' and name = $1`, [ruta])
comprobar(objetos[0].n === 1, 'Gerencia ve el archivo de la captura en Storage (política apertura_caja_ver, tesoreria.ver_caja)')
for (const p of ['contabilidad', 'costos']) {
  const n = await conRol(p, `select count(*)::int as n from storage.objects where bucket_id = 'apertura-caja' and name = $1`, [ruta])
  comprobar(n[0].n === 0, `${p} no ve la captura en Storage (${n[0].n})`)
}
const rutaC1 = `${caja}/${c1}.pdf`
for (const [p, n] of [['tesoreria', 1], ['gerencia', 1], ['contabilidad', 0], ['costos', 0]]) {
  const v = await conRol(p, `select count(*)::int as n from storage.objects where bucket_id = 'cierre-caja' and name = $1`, [rutaC1])
  comprobar(v[0].n === n, `${p} ${n ? 've' : 'no ve'} la captura del cierre en Storage (${v[0].n})`)
}
const politicas = await consulta(`select count(*)::int as n from pg_policies where policyname = 'apertura_caja_ver_documentos'`)
comprobar(politicas[0].n === 0, 'la política apertura_caja_ver_documentos ya no está')
let edicion = ''
try {
  await conRol('tesoreria', `update public.cierres_caja set saldo_banco = 1 where id = $1`, [c1])
} catch (e) {
  edicion = e.message
}
comprobar(edicion !== '', `un cierre no se corrige ni por Tesorería («${edicion.slice(0, 80)}»)`)

// ---------------------------------------------------------------- pantallas
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
async function entrar(puesto, ancho) {
  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: ancho < 600 ? 844 : 900 },
    isMobile: ancho < 500,
    hasTouch: ancho < 500,
    deviceScaleFactor: 2,
    timezoneId: 'America/Lima',
  })
  const pagina = esperarReactAlNavegar(await contexto.newPage())
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', CUENTAS[puesto])
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 60000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${CUENTAS[puesto]}`)
  return { contexto, pagina, errores }
}

const RUTA = `/tesoreria/caja-diaria/cierres${MES === hoy.slice(0, 7) ? '' : `?mes=${MES}`}`
for (const puesto of ['tesoreria', 'gerencia']) {
  for (const ancho of [390, 1440]) {
    const { contexto, pagina, errores } = await entrar(puesto, ancho)
    const t = `${puesto} ${ancho}`
    await pagina.goto(`${BASE}${RUTA}`, { waitUntil: 'networkidle' })
    comprobar(new URL(pagina.url()).pathname === '/tesoreria/caja-diaria/cierres', `${t} · entra a la historia (${new URL(pagina.url()).pathname})`)

    const f1 = limpio(await pagina.locator(`tr[data-cierre="${c1}"]`).innerText().catch(() => ''))
    const f3 = limpio(await pagina.locator(`tr[data-cierre="${c3}"]`).innerText().catch(() => ''))
    comprobar(f1.includes(ddmmaaaa(DIA1)) && f1.includes(NOMBRE) && /cuadra/i.test(f1) && f1.includes('S/ 1,500.00'),
      `${t} · el primer día: fecha, cuenta, saldo y «Cuadra» («${f1.slice(0, 160)}»)`)
    comprobar(f1.includes(QUIEN), `${t} · dice quién cerró: ${QUIEN} («${f1.slice(0, 200)}»)`)
    comprobar(f3.includes(ddmmaaaa(DIA2)) && /cuadra/i.test(f3), `${t} · el segundo día, cerrado otra vez y cuadrado («${f3.slice(0, 120)}»)`)
    const orden = await pagina.locator('tr[data-cierre]').evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-cierre')))
    comprobar(orden.indexOf(c3) > -1 && orden.indexOf(c3) < orden.indexOf(c1), `${t} · del día más reciente al más antiguo`)
    comprobar((await pagina.locator(`tr[data-cierre="${c2}"]`).count()) === 0, `${t} · el reabierto no va entre los vigentes`)
    const f4 = limpio(await pagina.locator(`tr[data-cierre="${c4}"]`).innerText().catch(() => ''))
    comprobar(f4.includes('Falta S/ 19.50') && !f4.includes('-19.50') && !f4.includes('−'), `${t} · la diferencia dice que falta, sin signo que leer («${f4.slice(0, 200)}»)`)
    comprobar(f1.includes('Captura del estado de cuenta de ese día'), `${t} · el cierre lleva la captura de su día («${f1.slice(0, 200)}»)`)
    // La foto del conteo es opcional: sin ella no se dice nada, para que no parezca una falta.
    comprobar(!/Sin foto|Sin captura/.test(f4), `${t} · la caja chica cerrada sin foto no lo da como falta`)
    // «No cuadran» deja solo la que no cuadra (de las de prueba).
    await Promise.all([pagina.waitForURL(/solo=diferencia/), pagina.getByRole('link', { name: /^No cuadran \(\d+\)$/ }).click()])
    await pagina.waitForLoadState('networkidle')
    const soloDif = await pagina.locator('tr[data-cierre]').evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-diferencia')))
    comprobar(soloDif.length > 0 && soloDif.every((d) => Number(d) !== 0) && (await pagina.locator(`tr[data-cierre="${c4}"]`).count()) === 1
      && (await pagina.locator(`tr[data-cierre="${c1}"]`).count()) === 0, `${t} · «No cuadran» deja solo las que no cuadran (${soloDif.length})`)
    if (ancho < 768) await pagina.screenshot({ path: join(CAPTURAS, `11-3-${puesto}-${ancho}-no-cuadran.png`) })
    await pagina.goto(`${BASE}${RUTA}`, { waitUntil: 'networkidle' })

    // El reabierto, en su sección, con quién, cuándo y el motivo.
    await pagina.getByText(/Cierres reabiertos \(\d+\)/).click()
    const reab = limpio(await pagina.locator(`[data-cierres-reabiertos] li[data-cierre="${c2}"]`).innerText().catch(() => ''))
    comprobar(reab.includes(MOTIVO) && reab.includes('Lo reabrió') && reab.includes('S/ 1,480.50'), `${t} · el reabierto con su motivo y el saldo que tenía («${reab.slice(0, 200)}»)`)

    // Solo lectura: ningún botón ni formulario que escriba (solo el selector del mes).
    const botones = await pagina.locator('main button').evaluateAll((bs) => bs.map((b) => b.textContent.trim()).filter((x) => x && x !== 'Ver'))
    const escribe = botones.filter((b) => /cerrar|reabrir|anular|corregir|editar|borrar|eliminar/i.test(b))
    comprobar(escribe.length === 0, `${t} · sin botones que cambien un cierre (${JSON.stringify(escribe)})`)

    // La captura del día se abre, y lleva a la del cierre, no a la de apertura.
    const enlace = pagina.locator(`tr[data-cierre="${c1}"] a[data-captura-del-dia]`)
    const href = await enlace.getAttribute('href').catch(() => null)
    const respuesta = href ? await contexto.request.get(`${BASE}${href}`, { maxRedirects: 0 }) : null
    comprobar(href === `/tesoreria/caja-diaria/cierres/captura/${c1}` && respuesta?.status() === 303,
      `${t} · la captura del día se abre (${href} → ${respuesta?.status()})`)
    comprobar((respuesta?.headers().location ?? '').includes(`cierre-caja`), `${t} · y es la del bucket de cierres (${(respuesta?.headers().location ?? '').slice(0, 120)})`)
    const archivo = respuesta?.headers().location ? await contexto.request.get(respuesta.headers().location) : null
    comprobar(archivo?.status() === 200 && (await archivo.body()).length > 0, `${t} · y el archivo se descarga (${archivo?.status()}, ${archivo ? (await archivo.body()).length : 0} bytes)`)

    const anchoPagina = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(anchoPagina <= ancho, `${t} · entra en ${ancho} px (mide ${anchoPagina})`)
    await pagina.evaluate(() => window.scrollTo(0, 0))
    await pagina.screenshot({ path: join(CAPTURAS, `11-3-${puesto}-${ancho}-dias-cerrados.png`), fullPage: ancho > 800 })
    comprobar(errores.length === 0, `${t} · sin errores de consola${errores.length ? `: ${errores.slice(0, 3).join(' | ')}` : ''}`)
    await contexto.close()
  }
}

// Las dos llegan desde la caja diaria («Días cerrados»), que Gerencia consulta con tesoreria.ver_caja.
for (const p of ['tesoreria', 'gerencia']) {
  const { contexto, pagina } = await entrar(p, 1440)
  await pagina.goto(`${BASE}/tesoreria/caja-diaria`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('main a[href="/tesoreria/caja-diaria/cierres"]').count()) > 0, `${p} llega desde la caja diaria («Días cerrados»)`)
  await contexto.close()
}
{
  const { contexto, pagina } = await entrar('contabilidad', 390)
  await pagina.goto(`${BASE}/tesoreria/caja-diaria/cierres`, { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname !== '/tesoreria/caja-diaria/cierres' && (await pagina.locator('tr[data-cierre]').count()) === 0,
    `Contabilidad no entra (queda en ${new URL(pagina.url()).pathname})`)
  const r = await contexto.request.get(`${BASE}/tesoreria/caja-diaria/captura/${caja}`, { maxRedirects: 0 })
  comprobar(r.status() !== 303, `ni abre la captura de apertura (${r.status()})`)
  const r2 = await contexto.request.get(`${BASE}/tesoreria/caja-diaria/cierres/captura/${c1}`, { maxRedirects: 0 })
  comprobar(r2.status() !== 303, `ni la del cierre (${r2.status()})`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallas`)
process.exit(fallas.length === 0 ? 0 : 1)
