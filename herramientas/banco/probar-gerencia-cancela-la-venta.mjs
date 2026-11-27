/**
 * Recorre con clic real las dos decisiones de StudioGRCI del 2026-11-26 sobre la
 * venta cuya OT pasó a otro comprador (migración 20261126998600), con la cuenta
 * de cada puesto (nunca ADMIN):
 *
 *   1. «Sí, también Gerencia». Dos ventas se reabren (su OT pasó a otro
 *      comprador y Gerencia la anuló allí): una de un vendedor activo y otra de
 *      una vendedora que ya no tiene cuenta activa. Gerencia ve «Cancelar la
 *      venta» en las dos, con la nota de cuándo le toca; Gerencia Comercial y
 *      Administración no lo ven; Ventas lo sigue viendo en la suya. El aviso de
 *      la reapertura le llega a Gerencia solo por la de quien ya no está.
 *      Gerencia cancela esa (motivo corto rechazado, tres toques, un envío) y
 *      la pantalla va a su tarjeta en «Anuladas».
 *   2. «Avisar a Contabilidad». En Facturación, la cotización de tres unidades
 *      de la que una pasó a otro comprador dice «1 de 3 unidades pasó a otro
 *      comprador» y sigue mostrando el total de la cotización entera; las demás
 *      no llevan esa nota.
 *   3. «Que se cierre sola, sin botón» (StudioGRCI, 2026-11-26, ya con la
 *      facturación por unidad). La unidad que pasó dice «Pasó a otro comprador»
 *      y no «Falta su OT», no se puede elegir en la ventana de la factura ni
 *      queda «Toda la cotización». Administración carga la OT que faltaba,
 *      Contabilidad factura con clic real las dos unidades que quedan y la
 *      tarjeta de Facturación queda «Facturada», fuera de «Por facturar». Y si
 *      la que pasó ya tenía un adelanto facturado, la fila y el aviso lo dicen.
 *      (El «Recorrido» de la tarjeta lo arma otra función de la base.)
 *
 * Capturas en teléfono (390) y monitor (1440). Arma sus datos ficticios
 * (QA-P8G-…) y las cuentas `*.p8g@banco.test` con la clave local. Variables:
 * BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_ARCHIVOS (el mismo del servidor del banco), CAPTURAS.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ARCHIVOS = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'
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
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()

/** Un PDF de una página con estas líneas de texto. */
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
const anio = (await uno(`select to_char((now() at time zone 'America/Lima')::date, 'YYYY') as a`)).a
const CUENTAS = {
  ventas: ['VENDEDOR', 'GCO', 'Vico'],
  vendedora: ['VENDEDOR', 'GCO', 'Vera'],
  gerencia: ['GERENTE', 'GGE', 'Gema'],
  comercial: ['GERENTE_COMERCIAL', 'GCO', 'Gala'],
  administracion: ['ADMINISTRACION', 'ADM', 'Olga'],
  contabilidad: ['CONTABILIDAD', 'CON', 'Cora'],
}
const ids = {}
const nombres = {}
for (const [clave, [rol, area, nombre]] of Object.entries(CUENTAS)) {
  const correo = `${clave}.p8g@banco.test`
  let fila = await uno('select id from public.usuarios where correo = $1', [correo])
  if (!fila) {
    fila = await uno(`insert into auth.users (id, email, encrypted_password) values (gen_random_uuid(), $1, null) returning id`, [correo])
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, $2, 'Banco P8G', $3, r.id, (select id from public.areas where codigo = $5) from public.roles r where r.codigo = $4`,
      [fila.id, nombre, correo, rol, area],
    )
  }
  await consulta(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where email = $1`, [correo, CLAVE])
  ids[clave] = fila.id
  nombres[clave] = nombre
}

// Dar de baja una cuenta es del administrador del sistema (Personal): solo para eso se usa la suya.
ids.admin = (await uno(`select u.id from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'ADMIN' and u.activo order by u.creado_en limit 1`)).id

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

// La vendedora empieza activa (por si quedó de baja de una corrida anterior): registra su cotización y después deja de tener cuenta.
await como('admin', 'update public.usuarios set activo = true where id = $1 and not activo', [ids.vendedora])

async function rucLibre() {
  return (await uno(`select n::text as ruc from generate_series(20990059000::bigint, 20990059999::bigint) n
                      where public.ruc_es_valido(n::text) and not exists (select 1 from public.clientes c where c.numero_documento = n::text)
                      limit 1`)).ruc
}
const clientes = {}
for (const [clave, nombre] of [['a', `QA PRIMER COMPRADOR P8G ${sello} S.A.C.`], ['b', `QA OTRO COMPRADOR P8G ${sello} S.A.C.`]]) {
  clientes[clave] = { nombre, id: (await uno(
    `insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', $1, $2) returning id`,
    [await rucLibre(), nombre],
  )).id }
}
const carroceria = (await uno(`select id from public.tipos_carroceria where activo order by orden_secuencia limit 1`)).id

// 1. Las cotizaciones: cada una la sube quien la vende, y Gerencia las aprueba.
const cot = {}
for (const [clave, cliente, unidades, autor] of [
  ['delvendedor', 'a', 1, 'ventas'], ['otro1', 'b', 1, 'ventas'],
  ['delaquesefue', 'a', 1, 'vendedora'], ['otro2', 'b', 1, 'ventas'],
  ['tres', 'a', 3, 'ventas'], ['otro3', 'b', 1, 'ventas'],
  ['entera', 'a', 2, 'ventas'],
  ['adelanto', 'a', 2, 'ventas'], ['otro4', 'b', 1, 'ventas'],
]) {
  const id = (await uno('select gen_random_uuid() as id')).id
  const numero = `QA-P8G-${sello}-${clave.toUpperCase()}`
  const ruta = `cot/${id}/${id}.pdf`
  const contenido = pdfConTexto([`COTIZACION ${numero}`, `CLIENTE: ${clientes[cliente].nombre}`, `${unidades} semirremolque(s) de prueba`])
  const destino = join(ARCHIVOS, 'cotizaciones-pdf', ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, contenido)
  await como(autor, `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                                          mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
                     values ($1, $2, $3, $4, $5, $6, 'application/pdf', $7, $8, 45000, 'USD', $9)`,
  [id, numero, clientes[cliente].id, carroceria, `Cotización ${numero}.pdf`, ruta, contenido.length, ids[autor], unidades])
  await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
                  values ('cotizaciones-pdf', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
  [ruta, ids[autor], contenido.length])
  const [ap] = await como('gerencia', `update public.cotizaciones_pdf set estado = 'APROBADA' where id = $1 returning id`, [id])
  comprobar(Boolean(ap), `Gerencia aprueba ${numero}, de ${nombres[autor]} (con su rol)`)
  cot[clave] = { id, numero, unidades }
}

// 2. Administración carga las OT y pasa tres a otro comprador.
const libres = (await consulta(`select n from generate_series(8100, 8999) n
                                 where not exists (select 1 from public.ordenes_trabajo o where o.numero = n || '-' || $1)
                                 order by random() limit 8`, [anio])).map((f) => String(f.n))
const ots = {}
async function cargarOt(clave, cotizacion, numero, codigo) {
  const id = (await uno('select gen_random_uuid() as id')).id
  const ruta = `ot/${id}/orden.pdf`
  const contenido = pdfConTexto([`ORDEN DE TRABAJO N ${numero}-${anio}`, 'Archivo de prueba del banco local de Metal Work.'])
  const destino = join(ARCHIVOS, 'adjuntos-ot', ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, contenido)
  await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
                  values ('adjuntos-ot', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
  [ruta, ids.administracion, contenido.length])
  await como('administracion', `select public.cargar_codigo_y_ot_de_cotizacion($1, $2, $3, $4, 'SEMIRREMOLQUE',
                                  (now() at time zone 'America/Lima')::date + 30, $5, 'orden.pdf', $6)`,
  [cot[cotizacion].id, id, codigo, numero, ruta, contenido.length])
  ots[clave] = { id, numero: `${numero}-${anio}` }
}
async function pasar(ot, cotizacion) {
  const v = await uno(`select o.actualizado_en::text as actualizado_en, o.descripcion, o.prioridad, o.fecha_entrega_comprometida::text as fecha,
                              u.codigo_interno, u.marca, u.modelo, u.actualizado_en::text as u_ver
                         from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id where o.id = $1`, [ot.id])
  await como('administracion', `select public.editar_ot_con_historial($1, $2, $3::jsonb, 'El cliente cedió la unidad a otro comprador (banco)')`, [
    ot.id, v.actualizado_en, JSON.stringify({
      descripcion: v.descripcion, prioridad: v.prioridad, fecha_entrega_comprometida: v.fecha, codigo_interno: v.codigo_interno,
      marca: v.marca ?? '', modelo: v.modelo ?? '', unidad_version: v.u_ver, cotizacion_nueva_id: cotizacion.id,
    }),
  ])
}
for (const [clave, cotizacion, numero, codigo] of [
  ['ot1', 'delvendedor', libres[0], `QA_P8G_${sello}_A`],
  ['ot2', 'delaquesefue', libres[1], `QA_P8G_${sello}_B`],
  ['ot3', 'tres', libres[2], `QA_P8G_${sello}_C`],
  ['ot4', 'tres', libres[3], `QA_P8G_${sello}_D`],
  ['ot5', 'entera', libres[4], `QA_P8G_${sello}_E`],
]) await cargarOt(clave, cotizacion, numero, codigo)
await pasar(ots.ot1, cot.otro1)
await pasar(ots.ot2, cot.otro2)
await pasar(ots.ot3, cot.otro3)

// La vendedora deja de tener cuenta activa antes de que su venta se reabra.
{
  const [baja] = await como('admin', 'update public.usuarios set activo = false where id = $1 returning id', [ids.vendedora])
  comprobar(Boolean(baja), `El administrador da de baja la cuenta de ${nombres.vendedora}`)
}
for (const ot of [ots.ot1, ots.ot2]) {
  const [an] = await como('gerencia', `update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El otro comprador desistió (banco)'
                                        where id = $1 returning id`, [ot.id])
  comprobar(Boolean(an), `Gerencia anula la OT ${ot.numero}, que había pasado a otro comprador (con su rol)`)
}
{
  const aGerencia = await consulta(`select n.origen_id, n.cuerpo, n.ruta from public.notificaciones n
                                     where n.usuario_id = $1 and n.titulo = 'Una venta volvió a esperar su OT' and n.origen_id = any($2::uuid[])`,
  [ids.gerencia, [cot.delvendedor.id, cot.delaquesefue.id]])
  comprobar(aGerencia.length === 1 && aGerencia[0].origen_id === cot.delaquesefue.id
    && aGerencia[0].cuerpo.includes('ya no tiene cuenta activa o cambió de puesto') && aGerencia[0].cuerpo.includes('cancélala con «Cancelar la venta»')
    && aGerencia[0].ruta === `/cotizaciones/pdf?estado=APROBADA_SIN_OT#${cot.delaquesefue.id}`,
  `Gerencia recibe un solo aviso, el de la venta de quien ya no está («${aGerencia[0]?.cuerpo ?? ''}»)`)
  const aVentas = await consulta(`select n.origen_id from public.notificaciones n
                                   where n.usuario_id = $1 and n.titulo = 'Tu venta volvió a esperar su OT' and n.origen_id = any($2::uuid[])`,
  [ids.ventas, [cot.delvendedor.id, cot.delaquesefue.id]])
  comprobar(aVentas.length === 1 && aVentas[0].origen_id === cot.delvendedor.id, 'Y el vendedor activo recibe el suyo, como antes')
}

// Para mirar el orden de la lista: «recién revisada» (15 minutos) sube la tarjeta a Gerencia, y la
// lista va de la más nueva a la más antigua. Las dos ventas reabiertas quedan revisadas hace una
// hora, y la de quien ya no está, como la más antigua: por fecha iría debajo de la otra.
await base.query('begin')
await base.query('set local session_replication_role = replica')
await base.query(`update public.cotizaciones_pdf set revisado_en = now() - interval '1 hour', creado_en = now() - interval '2 hours' where id = $1`, [cot.delaquesefue.id])
await base.query(`update public.cotizaciones_pdf set revisado_en = now() - interval '1 hour', creado_en = now() - interval '90 minutes' where id = $1`, [cot.delvendedor.id])
await base.query('commit')

/** En qué orden salen las dos ventas reabiertas en «Aprobadas sin OT» para quien mira. */
async function ordenDeLasReabiertas(pagina) {
  await pagina.goto(`${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT&q=${encodeURIComponent(`QA-P8G-${sello}`)}`, { waitUntil: 'networkidle' })
  await pagina.locator(`li[id="${cot.delvendedor.id}"]`).waitFor({ timeout: 15000 }).catch(() => {})
  const orden = await pagina.evaluate(() => [...document.querySelectorAll('li[id]')].map((e) => e.id))
  return [orden.indexOf(cot.delaquesefue.id), orden.indexOf(cot.delvendedor.id)]
}

// ------------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'], env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } })
const errores = []

async function entrar(clave, viewport = { width: 1440, height: 900 }) {
  const correo = `${clave}.p8g@banco.test`
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima', deviceScaleFactor: 2,
    ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}) })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
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

/** La tarjeta de la cotización en Cotización, buscada por su número. */
async function laTarjeta(pagina, c, estado = '') {
  await pagina.goto(`${BASE}/cotizaciones/pdf?q=${encodeURIComponent(c.numero)}${estado ? `&estado=${estado}` : ''}`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`li[id="${c.id}"]`)
  await t.waitFor({ timeout: 15000 }).catch(() => {})
  return t
}
const reabierta = async (t) => limpio(await t.locator('[data-venta-reabierta]').first().textContent({ timeout: 3000 }).catch(() => ''))
const botonCancelar = (t) => t.getByRole('button', { name: 'Cancelar la venta', exact: true })

// ------------------------------------------- 1. Quién ve «Cancelar la venta»
{
  const { pagina, contexto } = await entrar('comercial')
  const t = await laTarjeta(pagina, cot.delvendedor)
  const dice = await reabierta(t)
  comprobar((await botonCancelar(t).count()) === 0 && /la cancela quien la registró \([^)]+\) o Gerencia General\.$/.test(dice),
    `Gerencia Comercial: sin «Cancelar la venta», y lee quién la cancela («${dice}»)`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('administracion')
  const t = await laTarjeta(pagina, cot.delvendedor)
  const dice = await reabierta(t)
  comprobar((await botonCancelar(t).count()) === 0 && dice.includes('la cancela esa persona o Gerencia General'),
    `Administración: sin «Cancelar la venta», y lee que la cancela quien la registró o Gerencia General («${dice}»)`)
  // A Administración no se le dice quién sigue con cuenta: sus dos ventas reabiertas van por fecha.
  const [laQueSeFue, laDelVendedor] = await ordenDeLasReabiertas(pagina)
  const nota = await reabierta(pagina.locator(`li[id="${cot.delaquesefue.id}"]`))
  comprobar(laDelVendedor >= 0 && laQueSeFue > laDelVendedor && !nota.includes('cuenta activa'),
    `Administración: la venta de quien ya no está va por su fecha, y su nota no dice nada de la cuenta (${laQueSeFue} tras ${laDelVendedor}; «${nota}»)`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('ventas')
  const t = await laTarjeta(pagina, cot.delvendedor)
  const dice = await reabierta(t)
  comprobar((await botonCancelar(t).count()) === 1 && dice.includes('Si ya no sigue, cancélala con «Cancelar la venta».'),
    `Ventas: sigue con su «Cancelar la venta» y su nota de siempre («${dice}»)`)
  const ajena = await laTarjeta(pagina, cot.delaquesefue)
  const [{ puede }] = await como('ventas', 'select public.puede_cancelar_la_venta($1) as puede', [cot.delaquesefue.id])
  comprobar((await botonCancelar(ajena).count()) === 0 && puede === false,
    `Ventas: y no lo tiene en la venta de otra persona, ni en la pantalla ni en la base (tarjetas ${await ajena.count()}, puede ${puede})`)
  await contexto.close()
}

// ------------------------------------------------------------ 2. Gerencia
for (const [ancho, alto] of [[390, 844], [1440, 900]]) {
  const { pagina, contexto } = await entrar('gerencia', { width: ancho, height: alto })
  // La de quien ya no tiene cuenta: sube entre lo que le toca, y su nota dice por qué le toca a ella.
  {
    const [laQueSeFue, laDelVendedor] = await ordenDeLasReabiertas(pagina)
    const nota = await reabierta(pagina.locator(`li[id="${cot.delaquesefue.id}"]`))
    comprobar(laQueSeFue >= 0 && laQueSeFue < laDelVendedor,
      `Gerencia ${ancho}: la venta de quien ya no tiene cuenta sale antes que la del vendedor activo, aunque es más antigua (${laQueSeFue} antes de ${laDelVendedor})`)
    comprobar(nota.endsWith('Quien la registró ya no tiene cuenta activa o cambió de puesto. Si la venta ya no sigue, cancélala tú con «Cancelar la venta».'),
      `Gerencia ${ancho}: y su nota dice que quien la registró ya no está para cancelarla («${nota}»)`)
  }
  // La del vendedor activo: tiene el botón, y la nota dice que decide primero quien la registró.
  const t = await laTarjeta(pagina, cot.delvendedor)
  const dice = await reabierta(t)
  comprobar(dice.includes(`Su OT ${ots.ot1.numero} pasó a otro comprador y allí se anuló`)
    && /Si la venta ya no sigue, la cancela quien la registró \([^)]+\)\. También puedes cancelarla tú con «Cancelar la venta»\.$/.test(dice),
  `Gerencia ${ancho}: la nota de la del vendedor activo dice quién la cancela y que ella también puede («${dice}»)`)
  comprobar((await botonCancelar(t).count()) === 1, `Gerencia ${ancho}: ofrece «Cancelar la venta» en la venta que no registró`)
  await botonCancelar(t).click()
  const formulario = t.locator('form[data-cancelar-venta]')
  await formulario.waitFor({ timeout: 5000 }).catch(() => {})
  comprobar((await formulario.getByLabel('Por qué se cancela la venta').count()) === 1
    && limpio(await formulario.textContent()).includes('Al menos 10 caracteres'),
  `Gerencia ${ancho}: el motivo lleva su etiqueta y dice el mínimo`)
  if (ancho === 390) {
    const desliza = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(desliza <= 390, `390: la tarjeta con el formulario abierto no se desliza de costado (${desliza} px)`)
    await pagina.waitForTimeout(400)
    const aLaVistaLosDos = await formulario.evaluate((f) => {
      const barra = [...document.querySelectorAll('nav')].map((n) => n.getBoundingClientRect()).filter((r) => r.top > window.innerHeight / 2)
      const tope = barra.length ? Math.min(...barra.map((r) => r.top)) : window.innerHeight
      return [...f.querySelectorAll('button')].every((b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= tope })
    })
    comprobar(aLaVistaLosDos, '390: «Sí, cancelar la venta» y «No cancelar» quedan a la vista, sobre la barra de abajo')
    await pagina.screenshot({ path: join(CAPTURAS, 'gerencia-cancela-390-1-formulario.png') })
  } else {
    await pagina.screenshot({ path: join(CAPTURAS, 'gerencia-cancela-1440-1-formulario.png'), fullPage: true })
  }
  await formulario.getByRole('button', { name: 'No cancelar' }).click()
  const foco = limpio(await pagina.evaluate(() => document.activeElement?.textContent ?? ''))
  comprobar(foco === 'Cancelar la venta', `Gerencia ${ancho}: «No cancelar» devuelve el cursor a «Cancelar la venta» («${foco}»)`)
  const sigue = await uno('select estado::text as estado from public.cotizaciones_pdf where id = $1', [cot.delvendedor.id])
  comprobar(sigue.estado === 'APROBADA', `Gerencia ${ancho}: y la venta del vendedor activo sigue aprobada`)

  if (ancho === 1440) {
    // La de quien ya no está: el aviso lleva a su tarjeta, y Gerencia la cancela.
    await pagina.goto(`${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT#${cot.delaquesefue.id}`, { waitUntil: 'networkidle' })
    const t2 = pagina.locator(`li[id="${cot.delaquesefue.id}"]`)
    comprobar((await t2.count()) === 1 && (await botonCancelar(t2).count()) === 1,
      'Gerencia: el aviso lleva a la tarjeta de la venta de quien ya no está, con su «Cancelar la venta»')
    await botonCancelar(t2).click()
    const f2 = t2.locator('form[data-cancelar-venta]')
    await f2.waitFor({ timeout: 5000 }).catch(() => {})
    // Sin el mínimo del navegador, un motivo corto lo rechaza el servidor y lo escrito queda.
    await f2.locator('textarea[name="motivo"]').evaluate((e) => e.removeAttribute('minlength'))
    await f2.locator('textarea[name="motivo"]').fill('corto')
    await f2.getByRole('button', { name: 'Sí, cancelar la venta' }).click()
    const rechazo = limpio(await f2.locator('[role="alert"]').textContent({ timeout: 10000 }).catch(() => ''))
    const campo = f2.locator('textarea[name="motivo"]')
    comprobar(rechazo.includes('al menos 10 caracteres') && (await campo.inputValue()) === 'corto'
      && (await campo.getAttribute('aria-invalid')) === 'true',
    `Gerencia: el motivo corto se rechaza en su campo y lo escrito queda («${rechazo}»)`)
    const motivo = `La vendedora ya no trabaja aquí y el cliente desistió (banco ${sello})`
    await campo.fill(motivo)
    let envios = 0
    pagina.on('request', (q) => { if (q.method() === 'POST' && q.headers()['next-action']) envios += 1 })
    const enviar = f2.getByRole('button', { name: 'Sí, cancelar la venta' })
    await enviar.click()
    await enviar.click({ timeout: 1000 }).catch(() => {})
    await enviar.click({ timeout: 1000 }).catch(() => {})
    await pagina.waitForURL((u) => u.searchParams.get('estado') === 'ANULADA', { timeout: 20000 }).catch(() => {})
    await pagina.waitForLoadState('networkidle')
    comprobar(envios === 1, `Gerencia: tres toques, un solo envío (${envios})`)
    const quedo = await uno(`select c.estado::text as estado, c.motivo_anulacion, c.anulado_por, c.numero, c.registrado_por
                               from public.cotizaciones_pdf c where c.id = $1`, [cot.delaquesefue.id])
    comprobar(quedo.estado === 'ANULADA' && quedo.motivo_anulacion === motivo && quedo.anulado_por === ids.gerencia
      && quedo.numero === cot.delaquesefue.numero && quedo.registrado_por === ids.vendedora,
    `Gerencia: «Cancelar la venta» anula la cotización con su motivo y su nombre; no se borra (${quedo.estado}, «${quedo.motivo_anulacion}»)`)
    const aqui = new URL(pagina.url())
    const anulada = pagina.locator(`li[id="${cot.delaquesefue.id}"]`)
    const texto = limpio(await anulada.textContent({ timeout: 10000 }).catch(() => ''))
    comprobar(aqui.searchParams.get('estado') === 'ANULADA' && aqui.hash === `#${cot.delaquesefue.id}`
      && texto.includes('Anulada') && texto.includes(motivo) && (await botonCancelar(anulada).count()) === 0,
    `Gerencia: cancelada, la pantalla va a «Anuladas», a su tarjeta, con el motivo y sin más botón (${aqui.search}${aqui.hash})`)
    await anulada.evaluate((e) => e.scrollIntoView({ block: 'start' })).catch(() => {})
    await pagina.evaluate(() => window.scrollBy(0, -80))
    await pagina.screenshot({ path: join(CAPTURAS, 'gerencia-cancela-1440-2-venta-cancelada.png') })
  }
  await contexto.close()
}
// Cancelada, sale de «Por completar» de Administración; la del vendedor activo sigue ahí.
{
  const { pagina, contexto } = await entrar('administracion')
  await pagina.goto(`${BASE}/ordenes`, { waitUntil: 'networkidle' })
  await pagina.locator('[data-pendientes-ot-resto] summary').click().catch(() => {})
  comprobar((await pagina.locator(`[data-pendiente-ot="${cot.delaquesefue.numero}"]`).count()) === 0
    && (await pagina.locator(`[data-pendiente-ot="${cot.delvendedor.numero}"]`).count()) === 1,
  'Administración: la venta que canceló Gerencia ya no está en «Por completar», y la del vendedor activo sigue')
  await contexto.close()
}

// ------------------------------------------------------------ 3. Contabilidad
// El monto con el que se registra cada cotización de la prueba, como lo escribe la pantalla.
const ESPERADO_TOTAL = '45,000.00'
for (const [ancho, alto] of [[1440, 900], [390, 844]]) {
  const { pagina, contexto } = await entrar('contabilidad', { width: ancho, height: alto })
  await pagina.goto(`${BASE}/contabilidad/facturacion`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`li[data-cotizacion="${cot.tres.numero}"]`)
  await t.waitFor({ timeout: 15000 }).catch(() => {})
  const texto = limpio(await t.textContent().catch(() => ''))
  const frase = limpio(await t.locator('[data-unidades-a-otro-comprador]').first().textContent({ timeout: 3000 }).catch(() => ''))
  comprobar(frase === '1 de 3 unidades pasó a otro comprador. Se facturan las 2 que quedan, cada una por su parte: el total de venta de arriba es el de la cotización entera.',
    `Contabilidad ${ancho}: la de tres unidades avisa que una pasó a otro comprador («${frase}»)`)
  const totalDeVenta = (texto.match(/Total de venta: ?[^\d]*([\d,]+\.\d{2})/) ?? [])[1] ?? ''
  comprobar(totalDeVenta === ESPERADO_TOTAL,
    `Contabilidad ${ancho}: y sigue mostrando el total de la cotización entera (${totalDeVenta}; se esperaba ${ESPERADO_TOTAL})`)
  comprobar(texto.includes('Por facturar') && (await t.getByRole('button', { name: /Registrar factura/ }).count()) === 1,
    `Contabilidad ${ancho}: sigue «Por facturar», con su botón para registrar la factura`)
  // La unidad que pasó (la 1: su OT conserva el número al pasar) no espera OT ni factura.
  const filas = await t.locator('li[data-unidad]').evaluateAll((l) => l.map((e) => ({
    unidad: e.getAttribute('data-unidad'), paso: e.hasAttribute('data-paso-a-otro-comprador'), texto: e.textContent.replace(/\s+/g, ' ').trim(),
  })))
  console.log('     unidades:', filas.map((f) => f.texto).join(' | '))
  comprobar(filas.length === 3 && filas[0].paso && filas[0].texto.includes('Pasó a otro comprador') && filas[0].texto.includes('Ya no se factura en esta cotización')
    && !filas[0].texto.includes('Falta su OT') && !filas[0].texto.includes('Le toca'),
  `Contabilidad ${ancho}: la unidad 1, la que pasó, dice «Pasó a otro comprador» y ya no «Falta su OT» ni lo que le toca`)
  comprobar(!filas[1]?.paso && filas[1]?.texto.includes(`código QA_P8G_${sello}_D`) && filas[1]?.texto.includes('Por facturar') && filas[1]?.texto.includes('Le toca US$ 15,000.00')
    && !filas[2]?.paso && filas[2]?.texto.includes('Falta su OT') && filas[2]?.texto.includes('Le toca US$ 15,000.00'),
  `Contabilidad ${ancho}: la 2 espera su factura y la 3, su OT, cada una por US$ 15,000.00`)
  comprobar(texto.includes('Falta que Administración cargue la OT de una unidad: cada unidad se factura cuando tiene la suya.')
    && !texto.includes('la OT de 2 unidades') && !texto.includes('por toda la cotización'),
  `Contabilidad ${ancho}: la nota pide a Administración una OT, no dos, y ya no ofrece la factura por toda la cotización`)
  {
    await t.getByRole('button', { name: /Registrar factura/ }).click()
    const ventana = pagina.getByRole('dialog')
    await ventana.waitFor({ timeout: 5000 }).catch(() => {})
    const opciones = await ventana.locator('select[name="unidad"] option').evaluateAll((l) => l.map((o) => ({ texto: o.textContent.trim(), valor: o.value, apagada: o.disabled })))
    console.log('     opciones:', opciones.map((o) => `${o.texto}${o.apagada ? ' (apagada)' : ''}`).join(' | '))
    const de = (v) => opciones.find((o) => o.valor === v)
    comprobar(de('1')?.apagada === true && de('1')?.texto === 'Unidad 1 · pasó a otro comprador'
      && de('2')?.apagada === false && de('3')?.apagada === true && de('3')?.texto === 'Unidad 3 · falta su OT',
    `Contabilidad ${ancho}: en la ventana la unidad que pasó no se puede elegir y dice por qué; la que tiene OT sí`)
    comprobar(de('0')?.apagada === true && de('0')?.texto === 'Toda la cotización · no va: una unidad pasó a otro comprador'
      && !limpio(await ventana.textContent()).includes('o si es por toda la cotización'),
    `Contabilidad ${ancho}: «Toda la cotización» queda apagada y dice por qué («${de('0')?.texto ?? ''}»)`)
    await ventana.getByRole('button', { name: 'Cancelar' }).click()
    await ventana.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  }
  // Donde se escribe el monto, el aviso se repite: la ventana tapa la nota de la tarjeta.
  for (const [li, lleva] of [[t, true], [pagina.locator(`li[data-cotizacion="${cot.entera.numero}"]`), false]]) {
    await li.getByRole('button', { name: /Registrar factura/ }).click()
    const ventana = pagina.getByRole('dialog')
    await ventana.waitFor({ timeout: 5000 }).catch(() => {})
    const aviso = ventana.locator('[data-unidades-a-otro-comprador]')
    const dice = (await aviso.count()) === 1 ? limpio(await aviso.textContent()) : ''
    // A la vista sin abrir nada: detrás de la «i» del total no lo leía nadie.
    const seVe = dice !== '' && await aviso.isVisible()
    comprobar(lleva
      ? seVe && dice === '1 de sus 3 unidades pasó a otro comprador: se factura cada una de las que quedan, por su parte.'
      : dice === '',
    `Contabilidad ${ancho}: «Registrar factura» ${lleva ? `repite el aviso a la vista («${dice}»)` : 'de la que no perdió unidades no lo lleva'}`)
    if (lleva) await aviso.scrollIntoViewIfNeeded().catch(() => {})
    if (lleva && ancho === 390) {
      const desliza = await pagina.evaluate(() => document.documentElement.scrollWidth)
      comprobar(desliza <= 390, `390: la ventana de la factura no se desliza de costado (${desliza} px)`)
    }
    if (lleva) await pagina.screenshot({ path: join(CAPTURAS, `facturacion-avisa-${ancho}-ventana-de-la-factura.png`) })
    await ventana.getByRole('button', { name: 'Cancelar' }).click()
    await ventana.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  }
  const otra = pagina.locator(`li[data-cotizacion="${cot.entera.numero}"]`)
  comprobar((await otra.count()) === 1 && (await otra.locator('[data-unidades-a-otro-comprador]').count()) === 0,
    `Contabilidad ${ancho}: la de dos unidades de la que ninguna pasó no lleva esa nota`)
  comprobar((await pagina.locator('[data-unidades-a-otro-comprador]').count()) === (await pagina.locator(`li[data-cotizacion="${cot.tres.numero}"] [data-unidades-a-otro-comprador]`).count())
    + (await pagina.locator(`li:not([data-cotizacion^="QA-P8G-${sello}"]) [data-unidades-a-otro-comprador]`).count()),
  `Contabilidad ${ancho}: de las de esta prueba, solo esa la lleva`)
  if (ancho === 390) {
    const desliza = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(desliza <= 390, `390: Facturación no se desliza de costado (${desliza} px)`)
  }
  await t.evaluate((e) => e.scrollIntoView({ block: 'start' })).catch(() => {})
  await pagina.evaluate(() => window.scrollBy(0, -80))
  await pagina.screenshot({ path: join(CAPTURAS, `facturacion-avisa-${ancho}-una-unidad-paso.png`) })
  await contexto.close()
}
{
  const total = await uno(`select f.monto_venta::numeric as monto from public.cotizaciones_pdf f where f.id = $1`, [cot.tres.id])
  comprobar(Number(total.monto) === 45000, `La cotización de tres unidades conserva su monto entero en la base (${total.monto})`)
}

// ------------------------------- 4. Facturadas las que quedan, se cierra sola
// La base numera la OT que faltaba saltando la unidad que pasó: es la 3.
await cargarOt('ot6', 'tres', libres[5], `QA_P8G_${sello}_F`)
{
  const n = await uno('select numero_de_unidad from public.ordenes_trabajo where id = $1', [ots.ot6.id])
  comprobar(Number(n.numero_de_unidad) === 3, `Administración carga la OT que faltaba y la base la cuenta como la unidad 3, no la 1 que pasó (${n.numero_de_unidad})`)
}
const PDF_FACTURA = join(CAPTURAS, `factura-p8g-${sello}.pdf`)
writeFileSync(PDF_FACTURA, pdfConTexto([`FACTURA ELECTRONICA E9${sello.slice(-2)}`, clientes.a.nombre, 'Archivo de prueba del banco local']))
const serie = `E9${sello.slice(-2)}`
/** Lo que queda en la ventana tras enviar: vacío si se cerró, o el error que mostró. */
async function esperarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([v.waitFor({ state: 'hidden', timeout: 30000 }), v.locator('[role="alert"]').waitFor({ timeout: 30000 })]).catch(() => {})
  return limpio(await v.locator('[role="alert"]').first().textContent({ timeout: 500 }).catch(() => ''))
}
{
  const { pagina, contexto } = await entrar('contabilidad')
  await pagina.goto(`${BASE}/contabilidad/facturacion`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`li[data-cotizacion="${cot.tres.numero}"]`)
  await t.waitFor({ timeout: 15000 }).catch(() => {})
  const antes = limpio(await t.textContent())
  comprobar(!antes.includes('Falta que Administración') && (await t.locator('li[data-unidad="3"]').textContent()).includes('Por facturar')
    && (await t.locator('li[data-unidad="1"]').textContent()).includes('Pasó a otro comprador'),
  'Con la OT de la 3 cargada ya no se pide ninguna OT: la 1 sigue «Pasó a otro comprador» y la 3 espera su factura')

  // La base tampoco deja facturar la unidad que pasó, por si alguien salta la pantalla.
  let rechazo = ''
  try {
    await como('contabilidad', `select public.registrar_factura_venta_de_unidad(gen_random_uuid(), $1, $2, (now() at time zone 'America/Lima')::date,
                                  (now() at time zone 'America/Lima')::date, 'USD', 15000, 'Unidad que pasó', 'x/x.pdf', 'x.pdf', 1)`, [cot.tres.id, `${serie}-99`])
  } catch (e) { rechazo = e.message }
  comprobar(rechazo.includes('La unidad 1 de la cotización') && Number((await uno('select count(*)::int n from public.facturas_venta where cotizacion_pdf_id = $1', [cot.tres.id])).n) === 0,
    `La base no deja facturar la unidad que pasó («${rechazo.slice(0, 140)}»)`)

  // «Facturar» de cada unidad que queda, por su parte.
  for (const [unidad, numero] of [[2, `${serie}-2`], [3, `${serie}-3`]]) {
    await t.locator(`[data-facturar-unidad="${unidad}"]`).click()
    const v = pagina.locator('[role="dialog"]')
    await v.waitFor({ timeout: 5000 }).catch(() => {})
    comprobar((await v.locator('select[name="unidad"]').inputValue()) === String(unidad)
      && limpio(await v.textContent()).includes(`A la unidad ${unidad} le tocan US$ 15,000.00`),
    `«Facturar» de la unidad ${unidad} abre la ventana con esa unidad y lo que le toca`)
    await v.locator('input[name="numero"]').fill(numero)
    await v.locator('input[name="total"]').fill('15000')
    await v.locator('input[name="archivo"]').setInputFiles(PDF_FACTURA)
    await v.locator('button[type="submit"]').click()
    const dijo = await esperarVentana(pagina)
    comprobar(dijo === '', `la factura ${numero} de la unidad ${unidad} se registra${dijo ? ` (dijo: ${dijo})` : ''}`)
    await t.locator(`article[data-factura="${numero}"]`).waitFor({ timeout: 30000 }).catch(() => {})
  }
  const enBase = await consulta(
    `select p.numero_de_unidad, p.monto::numeric as monto from public.facturas_venta_unidades p join public.facturas_venta f on f.id = p.factura_id
      where f.cotizacion_pdf_id = $1 and f.anulada_en is null order by 1`, [cot.tres.id])
  comprobar(enBase.length === 2 && enBase.every((f) => Number(f.monto) === 15000) && enBase.map((f) => Number(f.numero_de_unidad)).join() === '2,3',
    `En la base quedan dos facturas, la de la unidad 2 y la de la 3, por 15 000 cada una (${enBase.map((f) => `${f.numero_de_unidad}:${f.monto}`).join(' | ')})`)

  for (const [ancho, alto] of [[1440, 900], [390, 844]]) {
    const s = ancho === 1440 ? { pagina, contexto: null } : await entrar('contabilidad', { width: ancho, height: alto })
    await s.pagina.goto(`${BASE}/contabilidad/facturacion`, { waitUntil: 'networkidle' })
    const c = s.pagina.locator(`li[data-cotizacion="${cot.tres.numero}"]`)
    await c.waitFor({ timeout: 15000 }).catch(() => {})
    const dice = limpio(await c.textContent())
    const insignia = limpio(await c.locator('p').first().textContent())
    comprobar(insignia.includes('Facturada') && !insignia.includes('en parte') && !insignia.includes('Por facturar') && !insignia.includes('Falta la OT'),
      `Contabilidad ${ancho}: facturadas las dos que quedan, la cotización dice «Facturada» («${insignia}»)`)
    comprobar(dice.includes('Facturado: US$ 30,000.00 · 100 % de lo que se factura aquí') && !/falta\s+US\$/.test(dice) && !dice.includes('Falta que Administración'),
      `Contabilidad ${ancho}: lo facturado es el 100 % de lo que se factura aquí, dicho así, y no le falta nada`)
    const aviso = c.locator('[data-unidades-a-otro-comprador]')
    const avisoDice = limpio(await aviso.textContent().catch(() => ''))
    comprobar(avisoDice === '1 de 3 unidades pasó a otro comprador. Se facturaron las 2 que quedaron, cada una por su parte: el total de venta de arriba es el de la cotización entera.'
      && !((await aviso.getAttribute('class')) ?? '').includes('bg-aviso-suave'),
    `Contabilidad ${ancho}: el aviso ya no pide nada: lo dice en pasado y sin ámbar («${avisoDice}»)`)
    comprobar((await c.locator('[data-facturar-unidad]').count()) === 0 && (await c.locator('li[data-unidad="1"]').textContent()).includes('Pasó a otro comprador')
      && (await c.locator('[data-unidades-a-otro-comprador]').count()) === 1,
    `Contabilidad ${ancho}: ninguna unidad ofrece «Facturar» y la 1 sigue diciendo que pasó a otro comprador`)
    const enEspera = await s.pagina.locator(`#por-facturar [data-por-facturar^="QA_P8G_${sello}_D"], #por-facturar [data-por-facturar^="QA_P8G_${sello}_F"]`).count()
    comprobar(enEspera === 0, `Contabilidad ${ancho}: ninguna de sus unidades figura en «Por facturar»`)
    if (ancho === 390) {
      const desliza = await s.pagina.evaluate(() => document.documentElement.scrollWidth)
      comprobar(desliza <= 390, `390: la tarjeta cerrada no se desliza de costado (${desliza} px)`)
    }
    await c.evaluate((e) => e.scrollIntoView({ block: 'start' })).catch(() => {})
    await s.pagina.evaluate(() => window.scrollBy(0, -80))
    await s.pagina.screenshot({ path: join(CAPTURAS, `unidad-que-paso-${ancho}-facturada.png`) })
    if (s.contexto) await s.contexto.close()
  }
  const pendientes = await como('contabilidad', 'select por_facturar from public.facturacion_pendientes()')
  const deEsta = await como('contabilidad', `select count(*)::int n from public.facturacion_por_unidad(array[$1::uuid]) u
                                             where u.codigo_interno is not null and u.facturado < u.parte - 0.005`, [cot.tres.id])
  comprobar(Number(deEsta[0].n) === 0, `Y para la base ninguna unidad con OT de esa cotización espera factura (el globo de Facturación cuenta ${pendientes[0].por_facturar} de otras)`)
  await contexto.close()
}

// --------------------- 5. La unidad que pasó ya tenía algo facturado (un adelanto)
// Las dos unidades con su OT, una factura por toda la cotización, y después la unidad 1 pasa a otro comprador.
await cargarOt('ot7', 'adelanto', libres[6], `QA_P8G_${sello}_G`)
await cargarOt('ot8', 'adelanto', libres[7], `QA_P8G_${sello}_H`)
{
  const { pagina, contexto } = await entrar('contabilidad')
  await pagina.goto(`${BASE}/contabilidad/facturacion`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`li[data-cotizacion="${cot.adelanto.numero}"]`)
  await t.waitFor({ timeout: 15000 }).catch(() => {})
  await t.getByRole('button', { name: /Registrar factura/ }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.waitFor({ timeout: 5000 }).catch(() => {})
  await v.locator('select[name="unidad"]').selectOption('0')
  await v.locator('input[name="numero"]').fill(`${serie}-10`)
  await v.locator('input[name="total"]').fill('9000')
  await v.locator('input[name="archivo"]').setInputFiles(PDF_FACTURA)
  await v.locator('button[type="submit"]').click()
  const dijo = await esperarVentana(pagina)
  comprobar(dijo === '', `Contabilidad registra un adelanto por toda la cotización de dos unidades${dijo ? ` (dijo: ${dijo})` : ''}`)
  await t.locator(`article[data-factura="${serie}-10"]`).waitFor({ timeout: 30000 }).catch(() => {})

  await pasar(ots.ot7, cot.otro4)
  for (const [ancho, alto] of [[1440, 900], [390, 844]]) {
    const s = ancho === 1440 ? { pagina, contexto: null } : await entrar('contabilidad', { width: ancho, height: alto })
    await s.pagina.goto(`${BASE}/contabilidad/facturacion`, { waitUntil: 'networkidle' })
    const c = s.pagina.locator(`li[data-cotizacion="${cot.adelanto.numero}"]`)
    await c.waitFor({ timeout: 15000 }).catch(() => {})
    const fila = limpio(await c.locator('li[data-unidad="1"]').textContent().catch(() => ''))
    comprobar(fila.includes('Pasó a otro comprador') && fila.includes('Facturado antes de pasar: US$ 4,500.00') && !fila.includes('falta') && !fila.includes('Le toca'),
      `Contabilidad ${ancho}: la unidad que pasó con un adelanto dice lo que tenía facturado, sin «falta» ni lo que le tocaba («${fila}»)`)
    const aviso = c.locator('[data-unidades-a-otro-comprador]')
    const dice = limpio(await aviso.textContent().catch(() => ''))
    comprobar(dice.includes('1 de 2 unidades pasó a otro comprador. Se factura la que queda, por su parte')
      && dice.includes('La unidad 1 ya tenía algo facturado en esta cotización cuando pasó: revisa qué corresponde hacer con esa factura.')
      && ((await aviso.getAttribute('class')) ?? '').includes('bg-aviso-suave'),
    `Contabilidad ${ancho}: y el aviso dice que esa factura queda por revisar («${dice}»)`)
    const cabecera = limpio(await c.textContent())
    // De los 22 500 de la unidad 2, 4 500 ya van: el 20 %, y faltan 18 000. Los 18 000 de la 1 ya no se cuentan.
    comprobar(cabecera.includes('Facturado: US$ 9,000.00 · 33 % de lo que se factura aquí') && /falta\s+US\$ 18,000\.00/.test(cabecera),
      `Contabilidad ${ancho}: arriba, lo que falta es solo lo de la unidad que queda (US$ 18,000.00)`)
    if (ancho === 390) {
      const desliza = await s.pagina.evaluate(() => document.documentElement.scrollWidth)
      comprobar(desliza <= 390, `390: esa tarjeta no se desliza de costado (${desliza} px)`)
    }
    await c.evaluate((e) => e.scrollIntoView({ block: 'start' })).catch(() => {})
    await s.pagina.evaluate(() => window.scrollBy(0, -80))
    await s.pagina.screenshot({ path: join(CAPTURAS, `unidad-que-paso-${ancho}-con-adelanto.png`) })
    if (s.contexto) await s.contexto.close()
  }
  await contexto.close()
}

await navegador.close()
await base.end()

if (errores.length) {
  console.log('\nErrores de consola:')
  for (const e of errores) console.log(`  ${e}`)
}
console.log(fallas.length ? `\n${fallas.length} comprobaciones fallaron.` : '\nTodo en orden.')
process.exit(fallas.length || errores.length ? 1 : 0)
