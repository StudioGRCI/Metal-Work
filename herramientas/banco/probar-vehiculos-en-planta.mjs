/**
 * Clic real sobre el plan 3, entrega 3.2: cada vehículo en planta dice cuántos
 * días lleva, qué puesto registró su ingreso y su salida, y si ya puede salir o
 * qué le falta según la base (`vehiculos_estado_de_salida`, sin cambiarla).
 * Con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Requerimientos registra, con su rol y por `registrar_ingreso_vehiculo`,
 *      un vehículo en cochera que entró hace seis días, otro que entró hoy y
 *      otro que entró hace nueve días y salió hace dos
 *      (`registrar_salida_vehiculo`). Uno de fabricación, con un código que va
 *      en 0 %, se pone como dueño: el banco no tiene un código interno con OT
 *      por el que pueda entrar, y solo sirve para ver que «Puede salir» no
 *      aparece donde la base dice qué falta. Y uno de mantenimiento con su OT
 *      terminada y Tesorería atendida, también como dueño, que sí dice «Puede salir».
 *   2. En «En planta» va primero el que lleva más días; cada uno dice sus días
 *      y «Lo registró Requerimientos»; el de cochera y el de «otro» no dicen
 *      «Puede salir» (la base no les exige nada para salir: decisión de DKS del
 *      26/11), y el de fabricación dice lo que le falta.
 *   3. En «Historial», el que salió dice «La registró Requerimientos» y
 *      «Estuvo 7 días».
 *   4. Gerencia (`vehiculos.ver`) ve lo mismo sin los botones; Ventas no entra.
 *   5. En el teléfono (390) el dato de la columna escondida sigue en la fila y
 *      nada se sale. Capturas en 390 y 1440.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_CHROMIUM, CAPTURAS.
 */
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { conReact } from './con-react.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
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
const correoDe = (puesto) => `${puesto}.local@metalwork.test`

/** Corre `sql` con la sesión de esa cuenta y el rol authenticated, en su propia transacción. */
async function como(puesto, sql, valores = []) {
  const [cuenta] = await consulta('select id from public.usuarios where correo = $1', [correoDe(puesto)])
  if (!cuenta) throw new Error(`El banco no tiene la cuenta ${correoDe(puesto)}: corre preparar.sh.`)
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true),
      set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [cuenta.id])
    await base.query('set local role authenticated')
    const filas = (await base.query(sql, valores)).rows
    await base.query('commit')
    return filas
  } catch (e) {
    await base.query('rollback').catch(() => {})
    throw e
  }
}

// ------------------------------------------------ 1. La siembra, con el rol de Requerimientos
const sufijo = randomUUID().slice(0, 4).toUpperCase()
// Sin guion: la base guarda la placa normalizada.
const placa = { cochera: `C${sufijo}6`, hoy: `H${sufijo}0`, salio: `S${sufijo}9`, fabrica: `F${sufijo}3`, listo: `M${sufijo}2` }
const ids = { cochera: randomUUID(), hoy: randomUUID(), salio: randomUUID(), fabrica: randomUUID(), listo: randomUUID() }

const [{ id: requerimientos }] = await consulta('select id from public.usuarios where correo = $1', [correoDe('requerimientos')])
/** La foto que exige la base, «subida» por Requerimientos a su carpeta: en el banco Storage es una tabla. */
async function foto(clave, momento) {
  const ruta = `${requerimientos}/${ids[clave]}/${momento}/${randomUUID()}.jpg`
  await como('requerimientos',
    `insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('fotos-vehiculos', $1, $2, '{"mimetype": "image/jpeg", "size": 120000}')`, [ruta, requerimientos])
  return JSON.stringify([ruta])
}
async function ingreso(clave, motivo, dias) {
  await como('requerimientos',
    `select public.registrar_ingreso_vehiculo($1, $2, null, null, 'CAMIÓN DE PRUEBA', 'TRANSPORTES SONDA S.A.C.', $3,
       now() - make_interval(days => $4), 'sonda 3.2', $5::jsonb, null)`,
    [ids[clave], placa[clave], motivo, dias, await foto(clave, 'ingreso')])
}
await ingreso('cochera', 'COCHERA', 6)
await ingreso('hoy', 'OTRO', 0)
await ingreso('salio', 'COCHERA', 9)
await como('requerimientos', `select public.registrar_salida_vehiculo($1, now() - interval '2 days', 'sonda 3.2', $2::jsonb)`,
  [ids.salio, await foto('salio', 'salida')])
// La de fabricación, como dueño (ver arriba): sin disparadores, con el ingreso a nombre de Requerimientos.
await base.query('begin')
await base.query('set local session_replication_role = replica')
await base.query(
  `insert into public.registro_vehiculos (id, placa, unidad, empresa, motivo, codigo_interno, ingreso_en, ingreso_por)
   values ($1, $2, 'CARROCERÍA DE PRUEBA', 'TRANSPORTES SONDA S.A.C.', 'FABRICACION', $3, now() - interval '3 days',
           (select id from public.usuarios where correo = $4))`,
  [ids.fabrica, placa.fabrica, `S${sufijo}`, correoDe('requerimientos')],
)
// Uno de mantenimiento con su OT terminada y Tesorería ya atendida: la base le exige algo y no le
// falta nada, el único caso en que la pantalla dice «Puede salir» (DKS, 26/11). Como dueño, por lo
// mismo que el de fabricación: la OT y el visto de Tesorería son de otros puestos.
const { rows: [ot] } = await base.query(
  `select o.id from public.ordenes_trabajo o
    where o.tipo_trabajo = 'MANTENIMIENTO' and o.estado <> 'ANULADA' and public.orden_garantia_terminada(o.id)
    order by o.numero limit 1`)
if (!ot) throw new Error('El banco no tiene una OT de mantenimiento terminada para probar «Puede salir».')
await base.query(
  `insert into public.registro_vehiculos (id, placa, unidad, empresa, motivo, codigo_interno, orden_id, ingreso_en, ingreso_por)
   values ($1, $2, 'CAMIÓN DE PRUEBA', 'TRANSPORTES SONDA S.A.C.', 'MANTENIMIENTO', $3, $4, now() - interval '1 day',
           (select id from public.usuarios where correo = $5))`,
  [ids.listo, placa.listo, `OT M${sufijo}`, ot.id, correoDe('requerimientos')],
)
await base.query(
  `insert into public.registro_vehiculo_revisiones (registro_id, concepto, estado, respuesta, solicitado_por, atendido_por, atendido_en)
   select $1, 'Salida del mantenimiento', 'ATENDIDA', 'Sin nada que cobrar', u.id, u.id, now()
     from public.usuarios u where u.correo = $2`,
  [ids.listo, correoDe('requerimientos')],
)
await base.query('commit')

// La base, con el rol real: el puesto de quien registró se lee, y lo que falta lo dice ella.
{
  const filas = await como('requerimientos',
    `select r.placa, i.puesto as ingreso, s.puesto as salida
       from public.registro_vehiculos r
       left join public.usuarios i on i.id = r.ingreso_por
       left join public.usuarios s on s.id = r.salida_por
      where r.id = any($1::uuid[])`, [Object.values(ids)])
  comprobar(filas.length === 5 && filas.every((f) => f.ingreso === 'Requerimientos'), 'Requerimientos lee el puesto de quien registró cada ingreso')
  comprobar(filas.find((f) => f.placa === placa.salio)?.salida === 'Requerimientos', 'y el de quien registró la salida')
  const gerencia = await como('gerencia',
    `select count(*)::int as n from public.registro_vehiculos r join public.usuarios i on i.id = r.ingreso_por where r.id = any($1::uuid[])`,
    [Object.values(ids)])
  comprobar(gerencia[0].n === 5, `Gerencia (vehiculos.ver) también lo lee (${gerencia[0].n} de 5)`)
  const ventas = await como('ventas', 'select count(*)::int as n from public.registro_vehiculos where id = any($1::uuid[])', [Object.values(ids)])
  comprobar(ventas[0].n === 0, 'Ventas no ve ningún registro de vehículos')
}

// ------------------------------------------------ 2 a 5. La pantalla
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
try {

  async function entrar(puesto, ancho = 1440) {
    const correo = correoDe(puesto)
    const telefono = ancho <= 480
    const contexto = await navegador.newContext({
      viewport: { width: ancho, height: telefono ? 844 : 900 },
      deviceScaleFactor: 2,
      hasTouch: telefono,
      isMobile: telefono,
      timezoneId: 'America/Lima',
    })
    const pagina = await contexto.newPage()
    pagina.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
    })
    pagina.on('pageerror', (e) => errores.push(`${correo}: ${String(e).slice(0, 300)}`))
    await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
    await pagina.fill('input[type="email"]', correo)
    await pagina.fill('input[type="password"]', CLAVE)
    await Promise.all([
      pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
      pagina.click('button[type="submit"]'),
    ])
    if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
    await pagina.waitForLoadState('networkidle')
    return { pagina, contexto }
  }

  async function ir(pagina, ruta) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    await conReact(pagina)
  }

  async function capturar(pagina, archivo) {
    await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
    const ventana = pagina.viewportSize()
    const alto = await pagina.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
    await pagina.setViewportSize({ width: ventana.width, height: Math.min(Math.max(alto, ventana.height), 6000) })
    await pagina.evaluate(() => window.scrollTo(0, 0))
    await pagina.screenshot({ path: `${CAPTURAS}/${archivo}` })
    await pagina.setViewportSize(ventana)
  }

  async function sinDesborde(pagina, donde) {
    const sobra = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    comprobar(sobra <= 0, `${donde}: nada se sale de la pantalla (sobran ${sobra} px)`)
  }

  /** De cada fila visible: su placa, sus días, si dice «Puede salir», lo que falta y quién la registró. */
  const filas = (pagina) =>
    pagina.locator('tbody tr').evaluateAll((es) =>
      es.flatMap((e) => {
        const enlace = e.querySelector('a[href^="/vehiculos/"]')
        if (!enlace) return []
        const visible = (sel) => [...e.querySelectorAll(sel)].find((x) => x.offsetParent !== null) ?? null
        const dias = visible('[data-dias-en-planta]')
        return [{
          placa: enlace.textContent.trim(),
          dias: dias ? Number(dias.dataset.diasEnPlanta) : null,
          textoDias: dias?.textContent?.trim() ?? null,
          puedeSalir: visible('[data-puede-salir]') !== null,
          faltaParaSalir: visible('[data-falta-para-salir]') !== null,
          falta: visible('[data-bloqueo-salida]')?.textContent?.trim() ?? null,
          ingreso: visible('[data-registro-ingreso]')?.textContent?.trim() ?? null,
          salida: visible('[data-registro-salida]')?.textContent?.trim() ?? null,
          texto: e.innerText.replace(/\s+/g, ' '),
        }]
      }),
    )

  for (const puesto of ['requerimientos', 'gerencia']) {
    const { pagina, contexto } = await entrar(puesto)
    await ir(pagina, '/vehiculos')
    const todas = await filas(pagina)
    const de = (clave) => todas.find((f) => f.placa === placa[clave])
    comprobar(de('cochera')?.textoDias === '6 días en planta', `${puesto}: ${placa.cochera} dice «6 días en planta» (${de('cochera')?.textoDias})`)
    comprobar(de('hoy')?.textoDias === 'Entró hoy', `${puesto}: ${placa.hoy} dice «Entró hoy» (${de('hoy')?.textoDias})`)
    comprobar(de('fabrica')?.textoDias === '3 días en planta', `${puesto}: ${placa.fabrica} dice «3 días en planta» (${de('fabrica')?.textoDias})`)
    comprobar(!de('cochera')?.puedeSalir && !de('hoy')?.puedeSalir, `${puesto}: los de cochera y «otro» no dicen «Puede salir»: la base no les exige nada`)
    comprobar(!de('fabrica')?.puedeSalir && de('fabrica')?.faltaParaSalir && /va en 0 %/.test(de('fabrica')?.falta ?? ''),
      `${puesto}: el de fabricación dice «Falta para salir» y qué le falta («${de('fabrica')?.falta}»), no «Puede salir»`)
    comprobar(!de('cochera')?.faltaParaSalir, `${puesto}: el de cochera no dice «Falta para salir»`)
    comprobar(de('listo')?.puedeSalir && !de('listo')?.faltaParaSalir, `${puesto}: el mantenimiento terminado, con Tesorería atendida, dice «Puede salir»`)
    comprobar((de('fabrica')?.texto ?? '').includes(`Código S${sufijo}`), `${puesto}: el de fabricación rotula su código interno («Código S${sufijo}»)`)
    if (puesto === 'requerimientos') {
      // Lo que falta va en la columna de la salida, junto a su estado, con el id que cita «Marcar salida».
      const enSalida = await pagina.locator(`#veh-bloqueo-${ids.fabrica}`).evaluate((e) => e.closest('td')?.cellIndex ?? -1)
      comprobar(enSalida === 3, `lo que falta va en la columna de la salida (columna ${enSalida})`)
    }
    comprobar(['cochera', 'hoy', 'fabrica', 'listo'].every((c) => de(c)?.ingreso === 'Lo registró Requerimientos'), `${puesto}: cada ingreso dice «Lo registró Requerimientos»`)
    comprobar(!de('salio'), `${puesto}: el que salió no está en «En planta»`)
    const conDias = todas.filter((f) => f.dias !== null).map((f) => f.dias)
    comprobar(conDias.every((d, i) => i === 0 || conDias[i - 1] >= d), `${puesto}: va primero el que lleva más días (${conDias.join(', ')})`)
    const botones = await pagina.getByRole('button', { name: /Marcar salida/i }).count()
    comprobar(puesto === 'requerimientos' ? botones > 0 : botones === 0, `${puesto}: ${puesto === 'requerimientos' ? 'tiene' : 'no tiene'} los botones de salida (${botones})`)
    if (puesto === 'requerimientos') await capturar(pagina, 'vehiculos-en-planta-1440.png')

    await ir(pagina, '/vehiculos?vista=historial')
    const salio = (await filas(pagina)).find((f) => f.placa === placa.salio)
    comprobar(salio?.salida === 'La registró Requerimientos', `${puesto}: en el historial, la salida dice «La registró Requerimientos» (${salio?.salida})`)
    comprobar(/Estuvo 7 días/.test(salio?.texto ?? ''), `${puesto}: y «Estuvo 7 días»`)
    if (puesto === 'requerimientos') await capturar(pagina, 'vehiculos-historial-1440.png')
    await contexto.close()
  }

  // Quien no debe entrar.
  {
    const { pagina, contexto } = await entrar('ventas')
    await pagina.goto(`${BASE}/vehiculos`, { waitUntil: 'networkidle' })
    comprobar(pagina.url().includes('/sin-permiso'), 'Ventas no entra a Vehículos')
    await contexto.close()
  }

  // En el teléfono, lo de las columnas escondidas va en la fila.
  {
    const { pagina, contexto } = await entrar('requerimientos', 390)
    await ir(pagina, '/vehiculos')
    const todas = await filas(pagina)
    const cochera = todas.find((f) => f.placa === placa.cochera)
    comprobar(cochera?.textoDias === '6 días en planta' && !cochera?.puedeSalir, 'a 390, la fila dice sus días, sin «Puede salir»')
    comprobar(/lo registró Requerimientos/.test(cochera?.texto ?? ''), 'a 390, la fila dice quién registró el ingreso')
    await sinDesborde(pagina, '«En planta» a 390')
    await capturar(pagina, 'vehiculos-en-planta-390.png')
    await ir(pagina, '/vehiculos?vista=historial')
    const salio = (await filas(pagina)).find((f) => f.placa === placa.salio)
    comprobar(/Su salida la registró Requerimientos/.test(salio?.texto ?? '') && /Estuvo 7 días/.test(salio?.texto ?? ''), 'a 390, el que salió dice quién registró la salida y cuánto estuvo')
    await sinDesborde(pagina, '«Historial» a 390')
    await capturar(pagina, 'vehiculos-historial-390.png')
    await contexto.close()
  }

  comprobar(errores.length === 0, `sin errores de consola ni de hidratación ${errores.slice(0, 5).join(' | ')}`)
} finally {
  // Lo sembrado no se queda en la planta del banco, aunque algo falle: Requerimientos lo anula,
  // con motivo, como se haría con un ingreso mal anotado.
  for (const clave of ['cochera', 'hoy', 'fabrica', 'listo']) {
    await como('requerimientos', 'select public.anular_registro_vehiculo($1, $2)', [ids[clave], 'Registro de la sonda 3.2 del banco de pruebas'])
  }
  await navegador.close()
}

await base.end()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} cosa(s) no cuadran:\n${fallas.map((f) => ` - ${f}`).join('\n')}`)
  process.exit(1)
}
console.log('\nTodo en orden.')
