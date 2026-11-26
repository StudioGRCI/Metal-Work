/**
 * Qué le falta a cada pago y de quién (plan 11, entrega 11.2), con la cuenta de
 * Tesorería y la de Gerencia (nunca ADMIN), y con Almacén, que no debe entrar:
 *
 *   1. Cuentas por pagar dice en su cabecera la regla que hace esperar a
 *      Gerencia, tal como está en `regla_aprobacion_compras`.
 *   2. La factura de una OC por aprobar dice «Falta la aprobación de la OC…»,
 *      de Gerencia, con los días que lleva esperando (los cuenta la base desde
 *      `aprobacion_pedida_en`): a Tesorería «Lo tiene Gerencia», a Gerencia
 *      «Te toca».
 *   3. La factura que ya se puede pagar: «Falta el pago, con su voucher», de
 *      Tesorería («Te toca» para Tesorería, «Lo tiene Tesorería» para Gerencia).
 *   4. La OC con boleta sin boleta: la boleta, de Logística, y el pago, de
 *      Tesorería. La que tiene factura anexada: su comprobante, de Contabilidad.
 *   5. La compra a crédito sin comprobante: la factura, de Contabilidad.
 *   6. Pagos de servicio: la OS sin factura ni conformidad dice las dos cosas
 *      de Logística y el pago de Tesorería; a Tesorería le dice que también la
 *      puede adjuntar ella, a Gerencia no.
 *   7. Almacén no entra a ninguna de las dos pantallas.
 *   8. Sin desborde a 390 px y sin errores de consola; capturas en CAPTURAS.
 *
 * Siembra sus datos con un sufijo nuevo. Variables: BANCO_CLAVE, BASE
 * (http://localhost:3111), CAPTURAS, BANCO_BASE, BANCO_ARCHIVOS.
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
const CUENTAS = Object.fromEntries(['logistica', 'tesoreria', 'gerencia', 'contabilidad', 'requerimientos', 'almacen'].map((p) => [p, cuenta(p)]))
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

// ---------------------------------------------------------------- siembra
const SUFIJO = String(100000 + (Date.now() % 900000))
const PROVEEDOR = `PROVEEDOR LO QUE FALTA ${SUFIJO}`
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)

async function como(puesto) {
  const sub = puesto ? ids[CUENTAS[puesto]] : ''
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, puesto ? JSON.stringify({ sub, role: 'authenticated' }) : ''])
}
async function subir(bucket, ruta, puesto) {
  const destino = join(ARCHIVOS, bucket, ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, PDF)
  await consulta(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ($1, $2, $3::uuid, $3::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $4::bigint)) on conflict do nothing`,
    [bucket, ruta, ids[CUENTAS[puesto]], PDF.length],
  )
  return ruta
}

let ruc
while (!ruc) {
  const prefijo = `20${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  ;[ruc] = await consulta(
    `select n from (select $1 || d as n from generate_series(0, 9) d) x
      where public.ruc_es_valido(n) and not exists (select 1 from proveedores p where p.numero_documento = n) limit 1`,
    [prefijo],
  )
}
const [{ id: proveedor }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. Argentina 421, Lima', '999 421 421') returning id`,
  [ruc.n, PROVEEDOR],
)
// Como en producción: toda compra la aprueba Gerencia (regla activa desde S/ 0).
await consulta(`update regla_aprobacion_compras set activa = true, monto_desde = 0, rol_aprobador_id = (select id from roles where codigo = 'GERENTE')`)
const [regla] = await consulta(`select r.nombre as puesto from regla_aprobacion_compras g join roles r on r.id = g.rol_aprobador_id`)

const [{ id: area }] = await consulta(`select id from areas where codigo = 'MTZ'`)
const [{ id: und }] = await consulta(`select id from unidades_medida where codigo = 'UND'`)
const [{ id: cat }] = await consulta(`select id from categorias_material where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1`)
const [{ id: material }] = await consulta(
  `insert into materiales (codigo, descripcion, categoria_id, unidad_medida_id) values ($1, $2, $3, $4) returning id`,
  [`FALTA-${SUFIJO}`, `Tubo LAF 2x2 (${SUFIJO})`, cat, und],
)
const [{ id: rq }] = await consulta(`select gen_random_uuid() as id`)
await como('requerimientos')
await consulta(
  `select public.emitir_requerimiento($1, $2, 'PLA_SR_O4_1_26/21', $3, null,
     (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 2, 'unidad_medida_id', $4::text, 'categoria_id', $5::text))
        from generate_series(1, 6) n))`,
  [rq, area, `Prueba de lo que falta ${SUFIJO}`, und, cat],
)
await como('almacen')
await consulta(`select public.rq_marcar_sin_stock($1, 'No hay nada de esto')`, [rq])

await como('logistica')
const emitir = async (linea, precio, factura, condicion = 'CREDITO', dias = 30) =>
  (
    await consulta(
      `select public.emitir_compra_del_requerimiento(gen_random_uuid(), $1, array[$2]::smallint[], $3, null,
         jsonb_build_array(jsonb_build_object('material_id', $4::text, 'cantidad', 2, 'precio', $5::numeric)), null, $6, $7, 'PEN', $8) as id`,
      [rq, linea, proveedor, material, precio, condicion, dias, factura],
    )
  )[0].id
// 1: factura de OC que espera a Gerencia; 2: factura que ya se paga; 3: OC con boleta sin boleta;
// 4: OC con boleta con factura anexada; 5: compra a crédito sin comprobante.
const ocGerencia = await emitir(1, 40, true)
const ocLista = await emitir(2, 90, true)
const ocSinBoleta = await emitir(3, 25, false, 'CONTADO', 0)
const ocAnexada = await emitir(4, 35, false, 'CONTADO', 0)
const ocCredito = await emitir(5, 55, true)
// 6: compra a crédito sin comprobante que todavía espera a Gerencia.
const ocCreditoGerencia = await emitir(6, 45, true)
await como('gerencia')
for (const oc of [ocLista, ocSinBoleta, ocAnexada, ocCredito]) await consulta(`select public.aprobar_compra($1)`, [oc])
// La que espera a Gerencia se pidió hace 4 días: se corre la fecha sin disparadores, como la dejaría el tiempo.
await como(null)
await base.query('begin')
await base.query('set local session_replication_role = replica')
await consulta(`update ordenes_compra_materiales set aprobacion_pedida_en = now() - interval '4 days' where id = $1`, [ocGerencia])
await base.query('commit')

const nombreDe = async (id) => (await consulta(`select public.nombre_de_oc(numero, referencia) as n from ordenes_compra_materiales where id = $1`, [id]))[0].n
const NOMBRE = {
  gerencia: await nombreDe(ocGerencia),
  lista: await nombreDe(ocLista),
  sinBoleta: await nombreDe(ocSinBoleta),
  anexada: await nombreDe(ocAnexada),
  credito: await nombreDe(ocCredito),
  creditoGerencia: await nombreDe(ocCreditoGerencia),
}

await como('contabilidad')
const FACTURA = {}
for (const [clave, oc, i] of [['gerencia', ocGerencia, 0], ['lista', ocLista, 1]]) {
  const [{ id }] = await consulta(`select gen_random_uuid() as id`)
  const [{ total }] = await consulta(`select public.total_orden_compra($1)::float as total`, [oc])
  await consulta(
    `insert into adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, ruc_proveedor)
     values ($1, 'FACTURA_COMPRA', $2, $3, $4::date, $5::date, 'PEN', $6, 'CREDITO', $7)`,
    [id, PROVEEDOR, `F08${i}-${SUFIJO}`, mas(-10), mas(5), total, ruc.n],
  )
  await consulta(`insert into adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values ($1, $2)`, [id, oc])
  await subir('comprobantes-financieros', `adquisiciones/${id}/comprobante.pdf`, 'contabilidad')
  await consulta(`update adquisiciones set ruta_storage = $2, estado = 'REGISTRADA' where id = $1`, [id, `adquisiciones/${id}/comprobante.pdf`])
  FACTURA[clave] = id
}
await como('logistica')
{
  const [{ id: doc }] = await consulta(`select gen_random_uuid() as id`)
  await subir('documentos-compras', `compra/${ocAnexada}/${doc}.pdf`, 'logistica')
  await consulta(
    `insert into documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por, numero_documento, fecha_emision)
     values ($1, $2, 'FACTURA', 'factura.pdf', $3, 'application/pdf', $4, $5, $6, $7::date)`,
    [doc, ocAnexada, `compra/${ocAnexada}/${doc}.pdf`, PDF.length, ids[CUENTAS.logistica], `F089-${SUFIJO}`, hoy],
  )
}
// Una OS aprobada, sin factura ni conformidad.
const NUMERO_OS = `QA-OSF-${SUFIJO}`
await como('gerencia')
await consulta(
  `insert into ordenes_servicio (numero, proveedor_id, proveedor, descripcion, monto, moneda, codigo_interno, aprobacion, aprobado_por, aprobado_en, creado_por)
   values ($1, $2, $3, $4, 300, 'PEN', 'PLA_SR_O4_1_26/21', 'APROBADA', $5, now(), $6)`,
  [NUMERO_OS, proveedor, PROVEEDOR, `Servicio de prueba (${SUFIJO})`, ids[CUENTAS.gerencia], ids[CUENTAS.logistica]],
)
await como(null)

// Lo que la base dice, para comparar: la regla, la espera de Gerencia y la compra a crédito.
const [{ dias: diasGerencia }] = await consulta(
  `select d.dias from ordenes_compra_materiales o, public.dias_en_espera_de(array[o.aprobacion_pedida_en]) d where o.id = $1`,
  [ocGerencia],
)
comprobar(Number(diasGerencia) === 4, `la base cuenta 4 días de espera de Gerencia (${diasGerencia})`)
console.log(`Sembrado ${SUFIJO}: ${Object.values(NOMBRE).join(', ')} y ${NUMERO_OS}`)

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

/** Las cosas que faltan en una fila: [{ quien, texto, insignia, dias }]. */
async function loQueFalta(fila) {
  return fila.locator('[data-lo-que-falta] > li').evaluateAll((lis) =>
    lis.map((li) => ({
      quien: li.getAttribute('data-falta-de'),
      traba: li.hasAttribute('data-traba'),
      texto: li.textContent.replace(/\s+/g, ' ').trim(),
      dias: li.querySelector('[data-dias-en-espera]')?.getAttribute('data-dias-en-espera') ?? null,
    })),
  )
}
const tiene = (falta, quien, parte) => falta.some((f) => f.quien === quien && f.texto.includes(parte))

for (const puesto of ['tesoreria', 'gerencia']) {
  const mia = (q) => (puesto === 'tesoreria' ? q === 'Tesorería' : q === 'Gerencia')
  const insignia = (q) => (mia(q) ? 'Te toca' : `Lo tiene ${q}`)
  for (const ancho of [390, 1440]) {
    const { contexto, pagina, errores } = await entrar(puesto, ancho)
    const t = `${puesto} ${ancho}`

    await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
    const cabecera = limpio(await pagina.locator('main').innerText())
    comprobar(
      cabecera.includes(`Regla vigente: ${regla.puesto} aprueba toda OC de cualquier monto y las OC directas`),
      `${t} · por pagar dice la regla de la base (${regla.puesto}, de cualquier monto)`,
    )

    const fGerencia = await loQueFalta(pagina.locator(`#factura-${FACTURA.gerencia}`))
    comprobar(tiene(fGerencia, 'Gerencia', `la aprobación de la ${NOMBRE.gerencia}`), `${t} · la factura por aprobar: falta la aprobación de la ${NOMBRE.gerencia} (${JSON.stringify(fGerencia)})`)
    comprobar(fGerencia[0]?.texto.includes(insignia('Gerencia')), `${t} · y dice «${insignia('Gerencia')}»`)
    comprobar(fGerencia[0]?.dias === '4' && fGerencia[0]?.texto.includes('hace 4 días'), `${t} · con los 4 días que lleva esperando`)
    comprobar(fGerencia.length === 1 && fGerencia[0]?.traba, `${t} · y es lo único que falta: traba el pago`)

    const fLista = await loQueFalta(pagina.locator(`#factura-${FACTURA.lista}`))
    comprobar(tiene(fLista, 'Tesorería', 'el pago, con su voucher') && fLista[0]?.texto.includes(insignia('Tesorería')),
      `${t} · la factura aprobada: falta el pago, «${insignia('Tesorería')}» (${JSON.stringify(fLista)})`)

    const fSinBoleta = await loQueFalta(pagina.locator(`#compra-${ocSinBoleta}`))
    comprobar(tiene(fSinBoleta, 'Logística', 'la boleta del proveedor') && tiene(fSinBoleta, 'Tesorería', 'el pago, con su voucher'),
      `${t} · la OC con boleta sin boleta: la boleta de Logística y el pago de Tesorería (${JSON.stringify(fSinBoleta)})`)

    const fAnexada = await loQueFalta(pagina.locator(`#compra-${ocAnexada}`))
    comprobar(tiene(fAnexada, 'Contabilidad', 'registrar su comprobante') && !tiene(fAnexada, 'Tesorería', 'el pago'),
      `${t} · la OC con factura anexada: su comprobante, de Contabilidad, y no el pago (${JSON.stringify(fAnexada)})`)

    const fCredito = await loQueFalta(pagina.locator(`[data-compra-credito="${ocCredito}"]`))
    comprobar(tiene(fCredito, 'Contabilidad', 'registrar la factura en Adquisiciones') && fCredito[0]?.texto.includes('Lo tiene Contabilidad'),
      `${t} · la compra a crédito sin comprobante: la factura, de Contabilidad (${JSON.stringify(fCredito)})`)

    const fCreditoGer = await loQueFalta(pagina.locator(`[data-compra-credito="${ocCreditoGerencia}"]`))
    comprobar(tiene(fCreditoGer, 'Gerencia', `la aprobación de la ${NOMBRE.creditoGerencia}`) && fCreditoGer[0]?.texto.includes(insignia('Gerencia'))
      && tiene(fCreditoGer, 'Contabilidad', 'registrar la factura'),
      `${t} · la compra a crédito por aprobar: primero Gerencia («${insignia('Gerencia')}»), después la factura (${JSON.stringify(fCreditoGer)})`)

    const anchoPagar = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(anchoPagar <= ancho, `${t} · por pagar entra en ${ancho} px (mide ${anchoPagar})`)
    await pagina.locator(`#factura-${FACTURA.gerencia}`).scrollIntoViewIfNeeded()
    await pagina.screenshot({ path: join(CAPTURAS, `11-2-${puesto}-${ancho}-por-pagar.png`) })

    await pagina.goto(`${BASE}/tesoreria/pagos-de-servicio`, { waitUntil: 'networkidle' })
    const fOs = await loQueFalta(pagina.locator(`[data-servicio="${NUMERO_OS}"]`))
    comprobar(tiene(fOs, 'Logística', 'la factura o el recibo del proveedor') && tiene(fOs, 'Logística', 'la conformidad del servicio'),
      `${t} · la OS: la factura y la conformidad, de Logística (${JSON.stringify(fOs)})`)
    comprobar(tiene(fOs, 'Tesorería', 'el pago al proveedor, con su voucher'), `${t} · la OS: el pago al proveedor, de Tesorería`)
    comprobar(fOs.some((f) => f.texto.includes('o tú aquí')) === (puesto === 'tesoreria'),
      `${t} · «o tú aquí» solo para quien puede adjuntarla (${puesto === 'tesoreria' ? 'sí' : 'no'})`)
    const anchoOs = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(anchoOs <= ancho, `${t} · pagos de servicio entra en ${ancho} px (mide ${anchoOs})`)
    await pagina.locator(`[data-servicio="${NUMERO_OS}"]`).scrollIntoViewIfNeeded()
    await pagina.screenshot({ path: join(CAPTURAS, `11-2-${puesto}-${ancho}-pagos-de-servicio.png`) })

    comprobar(errores.length === 0, `${t} · sin errores de consola${errores.length ? `: ${errores.slice(0, 3).join(' | ')}` : ''}`)
    await contexto.close()
  }
}

// Almacén no tiene nada que hacer en estas pantallas.
{
  const { contexto, pagina } = await entrar('almacen', 390)
  for (const ruta of ['/tesoreria/por-pagar', '/tesoreria/pagos-de-servicio']) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    const fuera = new URL(pagina.url()).pathname !== ruta || (await pagina.locator('[data-lo-que-falta]').count()) === 0
    comprobar(fuera, `almacén no entra a ${ruta} (queda en ${new URL(pagina.url()).pathname})`)
  }
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallas`)
process.exit(fallas.length === 0 ? 0 : 1)
