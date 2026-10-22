/**
 * Recorre con clic real «todo se corrige con su justificante» (migración
 * 20261016602000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Requerimientos corrige el material y la cantidad de un insumo de su RQ:
 *      sin justificante el navegador no envía; con él, queda en el historial.
 *   2. Almacén ve la corrección en Atención, con su justificante, y no corrige.
 *   3. Logística corrige el precio de una línea de la OC, con su justificante.
 *   4. Contabilidad corrige la factura registrada: le suma la otra OC del mismo
 *      proveedor, el total y el PDF nuevo, que el detector lee en el navegador.
 *   5. Tesorería ve las correcciones de la factura en Cuentas por pagar.
 *
 * Arma sus propios datos ficticios (QA-CORR-…) y las cuentas `*.corr@banco.test`
 * con la clave local. Variables: BANCO_CLAVE, BASE (http://localhost:3111),
 * BANCO_BASE (mw_demo), CAPTURAS.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
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
const uno = async (sql, valores = []) => (await consulta(sql, valores))[0]

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

/** Un PDF de una página con estas líneas de texto, para que el detector lo lea. */
function pdfConTexto(lineas) {
  const texto = lineas.map((l, i) => `BT /F1 11 Tf 50 ${780 - i * 18} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n')
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(texto, 'latin1')} >>\nstream\n${texto}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let pdf = '%PDF-1.4\n'
  const posiciones = []
  objetos.forEach((o, i) => {
    posiciones.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  pdf += posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

// ------------------------------------------------------------------ armazón
const sello = Date.now().toString().slice(-6)
const CUENTAS = {
  requerimientos: ['REQUERIMIENTOS', 'REQ'],
  almacen: ['ALMACENERO', 'ALM'],
  logistica: ['COMPRADOR', 'LOG'],
  contabilidad: ['CONTABILIDAD', 'CON'],
  tesoreria: ['TESORERIA', 'TES'],
  gerencia: ['GERENTE', 'GGE'],
}
const ids = {}
for (const [clave, [rol, area]] of Object.entries(CUENTAS)) {
  const correo = `${clave}.corr@banco.test`
  let fila = await uno('select id from public.usuarios where correo = $1', [correo])
  if (!fila) {
    fila = await uno(
      `insert into auth.users (id, email, encrypted_password) values (gen_random_uuid(), $1, crypt($2, gen_salt('bf'))) returning id`,
      [correo, CLAVE],
    )
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, $2, 'Banco correcciones', $3, r.id, (select id from public.areas where codigo = $4) from public.roles r where r.codigo = $2`,
      [fila.id, rol, correo, area],
    )
  } else {
    await consulta(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where email = $1`, [correo, CLAVE])
  }
  ids[clave] = fila.id
}
await consulta(`insert into public.empresa (ruc, razon_social) select '20100000382', 'PRUEBAS CORRECCIONES S.A.C.' where not exists (select 1 from public.empresa)`)

/** Corre `sql` dentro de una transacción con la sesión de `quien` y el rol authenticated. */
async function como(quien, sql, valores = []) {
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                             set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [ids[quien]])
    await base.query('set local role authenticated')
    const r = (await base.query(sql, valores)).rows
    await base.query('commit')
    return r
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

const und = (await uno(`select id from public.unidades_medida where codigo = 'UND'`)).id
const cat = (await uno(`select id from public.categorias_material where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1`)).id
const mat = []
for (const [i, nombre] of ['Plancha LAC 2 mm', 'Plancha LAC 3 mm'].entries()) {
  mat.push(
    (await uno(
      `insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id, unidad_pendiente, activo)
       values ($1, $2, $3, $4, false, true) returning id`,
      [`QA-CORR-${sello}-${i + 1}`, `${nombre} QA ${sello}`, cat, und],
    )).id,
  )
}
const area = (await uno(`select id from public.areas where codigo = 'MTZ'`)).id
const rqId = (await uno('select gen_random_uuid() as id')).id
await como('requerimientos', `select public.emitir_requerimiento($1, 'OPERACION', $2, 'QA_CORR_1', 'Plataforma de prueba del banco', null, $3::jsonb)`, [
  rqId,
  area,
  JSON.stringify([{ material_id: mat[0], cantidad: 4 }]),
])
const rq = await uno('select numero from public.requerimientos where id = $1', [rqId])

const ruc = (await uno(`select n::text as ruc from generate_series(20100038200::bigint, 20100038299::bigint) n where public.ruc_es_valido(n::text) limit 1`)).ruc
const proveedor = (await uno(
  `insert into public.proveedores (numero_documento, razon_social) values ($1, 'PROVEEDOR BANCO CORRECCIONES')
   on conflict (tipo_documento, numero_documento) do update set activo = true returning id, razon_social`,
  [ruc],
))
const oc = []
for (const [i, [cantidad, precio]] of [[10, 100], [1, 50]].entries()) {
  const fila = await uno(
    `insert into public.ordenes_compra_materiales (proveedor_id, proveedor, referencia, condicion_pago, dias_credito, moneda, origen, motivo,
                                                   con_factura, codigo_interno, creado_por, aprobacion)
     values ($1, $2, $3, 'CONTADO', 0, 'PEN', 'DIRECTA', 'Reposición del banco de correcciones', true, 'PLANTA', $4, 'NO_REQUERIDA')
     returning id, numero`,
    [proveedor.id, proveedor.razon_social, `QA-CORR-${sello}-${i + 1}`, ids.logistica],
  )
  await consulta(`insert into public.orden_compra_material_detalles (orden_compra_id, cantidad, precio_unitario, material_id) values ($1, $2, $3, $4)`, [
    fila.id,
    cantidad,
    precio,
    mat[0],
  ])
  oc.push(fila)
}
// Gerencia aprueba todas las compras (DKS, 12/10): solo las aprobadas esperan su factura.
for (const o of oc) {
  const { aprobacion } = await uno('select aprobacion from public.ordenes_compra_materiales where id = $1', [o.id])
  if (aprobacion === 'POR_APROBAR') await como('gerencia', 'select public.aprobar_compra($1)', [o.id])
}
// La factura de la primera OC, registrada por Contabilidad: 10 × 100 + IGV.
const adq = (await uno('select gen_random_uuid() as id')).id
const numeroFactura = `F001-${sello}`
const hoy = (await uno(`select (now() at time zone 'America/Lima')::date::text as d`)).d
await como(
  'contabilidad',
  `insert into public.adquisiciones (id, orden_compra_id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
   values ($1, $2, 'FACTURA_COMPRA', $3, $4, $5, $5, 'PEN', 1180, 'CONTADO')`,
  [adq, oc[0].id, proveedor.razon_social, numeroFactura, hoy],
)
await consulta(`insert into storage.objects (bucket_id, name, owner_id, metadata) values ('comprobantes-financieros', $1, $2, '{"mimetype": "application/pdf", "size": 900}')`, [
  `adquisiciones/${adq}/comprobante.pdf`,
  ids.contabilidad,
])
// Como dueño: el banco no le da a `authenticated` la lectura de storage.objects que sí tiene en Supabase.
await consulta(`update public.adquisiciones set ruta_storage = $2, estado = 'REGISTRADA' where id = $1`, [adq, `adquisiciones/${adq}/comprobante.pdf`])
console.log(`armado: ${rq.numero}, ${oc[0].numero} y ${oc[1].numero}, factura ${numeroFactura}`)

const justificante = join(CAPTURAS, 'justificante-correccion.pdf')
writeFileSync(justificante, pdfConTexto(['Correo del proveedor', 'Confirma el cambio']))
const facturaNueva = join(CAPTURAS, `factura-corregida-${sello}.pdf`)
writeFileSync(
  facturaNueva,
  pdfConTexto([
    'FACTURA ELECTRONICA',
    numeroFactura,
    `Fecha de Emision : ${hoy.split('-').reverse().join('/')}`,
    `Observacion : ${oc[0].numero} y ${oc[1].numero}`,
    'Valor Venta : S/ 1,005.00',
    'IGV : S/ 180.90',
    'Importe Total : S/ 1,185.90',
  ]),
)

// ------------------------------------------------------------------ navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
/**
 * Mientras una prueba corta la respuesta a propósito, el «net::ERR_FAILED» de la consola es el corte, y el
 * 400 es Storage diciendo que el justificante ya está en su ruta (el reintento lo sube otra vez).
 */
let cortando = false
async function hasta(leer, cumple, ms = 30000) {
  const fin = Date.now() + ms
  let v = await leer()
  while (!cumple(v) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 250))
    v = await leer()
  }
  return v
}
async function entrar(clave) {
  const correo = `${clave}.corr@banco.test`
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (cortando && /net::ERR_FAILED|status of 400/.test(m.text())) return
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${clave}: ${m.text().slice(0, 300)}`)
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 60000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto }
}
async function terminarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([v.waitFor({ state: 'hidden', timeout: 60000 }), v.locator('[role="alert"]').waitFor({ timeout: 60000 })]).catch(() => {})
  const alerta = await v.locator('[role="alert"]').allTextContents().catch(() => [])
  return alerta.join(' ').trim()
}

try {
  // ---------------------------------------------------------------- 1. Requerimientos
  {
    const { pagina, contexto } = await entrar('requerimientos')
    await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
    await pagina.getByRole('button', { name: `Corregir el requerimiento ${rq.numero}` }).click()
    const v = pagina.locator('[role="dialog"]')
    await v.locator(`[id^="rq-corr-mat-"]`).first().click()
    await pagina.keyboard.type(`LAC 3 mm QA ${sello}`)
    await pagina.getByRole('option', { name: new RegExp(`Plancha LAC 3 mm QA ${sello}`) }).first().click()
    await v.locator('[id^="rq-corr-cant-"]').first().fill('6')
    await v.locator('[id^="correccion-motivo-"]').fill('El plano final pide plancha de 3 mm y seis piezas')
    // Sin justificante, el navegador no deja enviar.
    await v.getByRole('button', { name: 'Corregir', exact: true }).click()
    const sinArchivo = await v.locator('[id^="correccion-justificante-"]').evaluate((e) => !e.checkValidity())
    comprobar(sinArchivo && (await v.isVisible()), 'sin justificante la corrección del RQ no se envía')
    await v.locator('[id^="correccion-justificante-"]').setInputFiles(justificante)
    await pagina.screenshot({ path: `${CAPTURAS}/correccion-rq-ventana.png`, fullPage: true })
    // Las respuestas se pierden (la corrección entra) y, en la misma ventana, se cambia la cantidad y el motivo
    // antes de volver a enviar, con el mismo justificante: la base no da por hecho lo nuevo con lo de la primera
    // vez (undécima pasada, migración 20261022180000). Lo dice, queda lo primero y el justificante no queda suelto.
    cortando = true
    await pagina.route('**/*', async (r) => {
      const q = r.request()
      if (q.method() === 'POST' && q.headers()['next-action'] && (q.postData() ?? '').includes(rqId)) {
        await r.fetch().catch(() => {})
        return r.abort('failed')
      }
      return r.continue()
    })
    const aviso = () => v.locator('[role="alert"]').allTextContents().then((t) => t.join(' ').trim()).catch(() => '')
    await v.getByRole('button', { name: 'Corregir', exact: true }).click()
    const primera = await hasta(aviso, (t) => /No se confirmó/.test(t))
    await pagina.unrouteAll({ behavior: 'ignoreErrors' })
    await v.locator('[id^="rq-corr-cant-"]').first().fill('7')
    await v.locator('[id^="correccion-motivo-"]').fill('El plano final pide plancha de 3 mm y siete piezas')
    await v.getByRole('button', { name: 'Corregir', exact: true }).click()
    const segunda = await hasta(aviso, (t) => /ya quedó registrada/.test(t))
    cortando = false
    const alerta = segunda.startsWith('Esta corrección ya quedó registrada la primera vez que la enviaste') ? '' : segunda
    // Ya entró: sin rojo y sin «Corregir»; la ventana solo se cierra, con el cursor en el aviso (duodécima pasada).
    const yaEntro = {
      neutro: (await v.locator('[data-ya-entro]').count()) === 1,
      sinEnviar: (await v.getByRole('button', { name: 'Corregir', exact: true }).count()) === 0,
      cerrar: await v.getByRole('button', { name: 'Cerrar' }).isVisible(),
      cursor: await v.locator('[data-ya-entro]').evaluate((p) => document.activeElement === p).catch(() => false),
    }
    comprobar(Object.values(yaEntro).every(Boolean), `ya entró: el aviso sin rojo, con el cursor, y solo «Cerrar» (${JSON.stringify(yaEntro)})`)
    await v.getByRole('button', { name: 'Cerrar' }).click()
    const linea = await uno('select material_id, cantidad::float as cantidad from public.requerimiento_lineas where requerimiento_id = $1 and item = 1', [rqId])
    comprobar(/No se confirmó/.test(primera) && !alerta && linea.material_id === mat[1] && linea.cantidad === 6,
      `Requerimientos corrige material y cantidad, y el reenvío con otra cantidad no pasa por el mismo: «${primera}» → «${segunda}» (cantidad ${linea.cantidad})`)
    const corr = await uno(`select count(*)::int as n, max(justificante_nombre) as nombre, max(motivo) as motivo from public.correcciones where documento_id = $1`, [rqId])
    comprobar(corr.n === 1 && corr.nombre === 'justificante-correccion.pdf' && corr.motivo === 'El plano final pide plancha de 3 mm y seis piezas',
      `la corrección queda una vez con su justificante y su motivo de la primera vez (${corr.n}, «${corr.motivo}»)`)
    const sueltos = await consulta(`select o.name from storage.objects o where o.bucket_id = 'justificantes-correccion' and o.name like $1
                                      and not exists (select 1 from public.correcciones c where c.justificante_ruta = o.name)`, [`%${rqId}%`])
    comprobar(sueltos.length === 0, `y ningún justificante suelto (${sueltos.length})`)
    await pagina.reload({ waitUntil: 'networkidle' })
    // Desde el 2026-10-20 la lista de RQ son tarjetas, no filas.
    const fila = pagina.locator(`[data-rq="${rq.numero}"]`)
    comprobar((await fila.getByText('Corregido una vez').count()) === 1, 'el RQ muestra «Corregido una vez» en la lista')
    await fila.getByText('Corregido una vez').click()
    comprobar((await fila.getByText(/Insumo 1: Plancha LAC 2 mm QA .* → Plancha LAC 3 mm QA/).count()) === 1, 'el historial dice qué insumo cambió')
    await pagina.screenshot({ path: `${CAPTURAS}/correccion-rq.png`, fullPage: true })
    await contexto.close()
  }

  // ---------------------------------------------------------------- 2. Almacén
  {
    const { pagina, contexto } = await entrar('almacen')
    await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
    const fila = pagina.locator('tr', { hasText: rq.numero })
    comprobar((await fila.getByText('Corregido una vez').count()) === 1, 'Almacén ve la corrección del RQ en Atención')
    await fila.getByText('Corregido una vez').click()
    const enlace = fila.getByRole('link', { name: /Justificante: justificante-correccion\.pdf/ })
    comprobar((await enlace.count()) === 1, 'Almacén tiene el enlace al justificante')
    comprobar((await pagina.getByRole('button', { name: /Corregir el requerimiento/ }).count()) === 0, 'Almacén no tiene «Corregir»')
    await contexto.close()
  }

  // ---------------------------------------------------------------- 3. Logística
  {
    const { pagina, contexto } = await entrar('logistica')
    await pagina.goto(`${BASE}/compras/ordenes`, { waitUntil: 'networkidle' })
    await pagina.getByRole('button', { name: `Corregir la compra ${oc[0].numero}` }).click()
    const v = pagina.locator('[role="dialog"]')
    await v.locator('[id^="corregir-precio-"]').first().waitFor({ timeout: 30000 })
    await v.locator('[id^="corregir-precio-"]').first().fill('95.50')
    await v.locator('[id^="correccion-motivo-"]').fill('El proveedor confirmó 95.50 por plancha en su factura')
    await v.locator('[id^="correccion-justificante-"]').setInputFiles(justificante)
    await v.getByRole('button', { name: 'Corregir', exact: true }).click()
    const alerta = await terminarVentana(pagina)
    const precio = await uno('select precio_unitario::float as p from public.orden_compra_material_detalles where orden_compra_id = $1', [oc[0].id])
    comprobar(!alerta && precio.p === 95.5, `Logística corrige el precio de la OC ${alerta ? `(${alerta})` : ''}`)
    await pagina.reload({ waitUntil: 'networkidle' })
    const fila = pagina.locator('tr', { hasText: oc[0].numero })
    await fila.getByText('Corregido una vez').click()
    comprobar((await fila.getByText(/Precio sin IGV de Plancha LAC 2 mm QA .*: S\/ 100\.00 → S\/ 95\.50/).count()) === 1, 'el historial de la OC dice el precio de antes y el de ahora')
    await contexto.close()
  }

  // ---------------------------------------------------------------- 4. Contabilidad
  {
    const { pagina, contexto } = await entrar('contabilidad')
    await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
    await pagina.getByRole('button', { name: `Corregir el comprobante ${numeroFactura}` }).click()
    const v = pagina.locator('[role="dialog"]')
    await v.locator('[id^="fc-total-"]').fill('1185.90')
    // El detector lee el PDF nuevo: menciona las dos OC y solo una está marcada.
    await v.locator('[id^="fc-pdf-"]').setInputFiles(facturaNueva)
    const numeroOc2 = oc[1].numero.replace(/\D/g, '').replace(/^0+/, '')
    await v.locator('[role="status"]', { hasText: numeroOc2 }).waitFor({ timeout: 60000 }).catch(() => {})
    const antes = (await v.locator('[role="status"]').allTextContents()).join(' ')
    comprobar(antes.includes(numeroOc2) && /aviso/i.test(antes), `el detector avisa que la factura menciona la ${oc[1].numero} sin marcar (${antes.slice(0, 200)})`)
    await v.locator('label', { hasText: oc[1].numero }).locator('input[type="checkbox"]').check()
    await pagina.waitForTimeout(300)
    const avisos = (await v.locator('[role="status"]').allTextContents()).join(' ')
    comprobar(!avisos.includes(numeroOc2), `marcada la OC, el detector ya no avisa ${avisos ? `(${avisos.slice(0, 160)})` : ''}`)
    await v.locator('[id^="correccion-motivo-"]').fill('El proveedor juntó las dos OC en la misma factura')
    await v.locator('[id^="correccion-justificante-"]').setInputFiles(justificante)
    await pagina.screenshot({ path: `${CAPTURAS}/correccion-factura-ventana.png`, fullPage: true })
    await v.getByRole('button', { name: 'Corregir', exact: true }).click()
    const alerta = await terminarVentana(pagina)
    const a = await uno(
      `select total::float as total, ruta_storage, lectura_total::float as lectura_total, lectura_ordenes,
              (select count(*)::int from public.adquisiciones_ordenes_compra l where l.adquisicion_id = a.id and l.quitada_en is null) as ordenes
         from public.adquisiciones a where id = $1`,
      [adq],
    )
    comprobar(!alerta && a.total === 1185.9 && a.ordenes === 2, `Contabilidad corrige el total y suma la otra OC ${alerta ? `(${alerta})` : ''}`)
    comprobar(/\/correccion-[0-9a-f-]{36}\.pdf$/.test(a.ruta_storage ?? ''), 'el PDF nuevo reemplaza al anterior, en su ruta de corrección')
    comprobar(a.lectura_total === 1185.9 && (a.lectura_ordenes ?? []).length === 2, 'lo que el detector leyó del PDF nuevo queda con la factura')
    await pagina.reload({ waitUntil: 'networkidle' })
    // Desde #99 Adquisiciones es una tabla: cada factura, con sus OC, va en su propio tbody.
    const tarjeta = pagina.locator('tbody', { hasText: numeroFactura })
    await tarjeta.getByText('Corregido una vez').click()
    comprobar((await tarjeta.getByText(new RegExp(`Se sumó la ${oc[1].numero}`)).count()) === 1, 'el historial de la factura dice qué OC se sumó')
    await pagina.screenshot({ path: `${CAPTURAS}/correccion-factura.png`, fullPage: true })
    await contexto.close()
  }

  // ---------------------------------------------------------------- 5. Tesorería
  {
    const { pagina, contexto } = await entrar('tesoreria')
    await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
    const tarjeta = pagina.locator('article', { hasText: numeroFactura })
    comprobar((await tarjeta.getByText('Corregido una vez').count()) === 1, 'Tesorería ve la corrección de la factura que paga')
    comprobar((await pagina.getByRole('button', { name: /Corregir el comprobante/ }).count()) === 0, 'Tesorería no tiene «Corregir»')
    await contexto.close()
  }
} catch (e) {
  fallas.push(`se cortó el recorrido: ${e.message}`)
  console.log(`FALLA · se cortó el recorrido: ${e.message}`)
} finally {
  await navegador.close()
  await base.end()
}

if (errores.length) {
  console.log('Errores de consola:')
  for (const e of errores) console.log(`  ${e}`)
}
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length || errores.length ? 1 : 0)
