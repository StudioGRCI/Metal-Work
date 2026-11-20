/**
 * El supervisor pide el material de cada unidad de su área (migración
 * 20261120300000, pedido de supervisión de Acabados del 20/11/2026), con clic
 * real y la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. El supervisor de Acabados abre «RQ por unidad»: ve las unidades con
 *      trabajo en su área (no la que ya terminó ni la que solo tiene
 *      Maestranza) y PLANTA. Desde la tarjeta de una unidad registra un RQ con
 *      el código y el área ya puestos, y la tarjeta lo cuenta.
 *   2. Corrige ese RQ con su justificante, y registra otro para PLANTA y lo
 *      anula desde la lista: son suyos.
 *   3. El supervisor de Maestranza no ve las unidades de Acabados, y en «Todas
 *      las áreas» no tiene «Anular» en el RQ de Acabados.
 *   4. Requerimientos sigue eligiendo el área.
 *
 * Siembra (idempotente) las etapas de cuatro códigos BCO-… en la base del
 * banco. Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE
 * (mw_demo), PGHOST, PGPORT, PGUSER.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const cuenta = (puesto) => process.env[puesto.toUpperCase().replace('.', '_')] ?? `${puesto}.local@metalwork.test`
const CUENTAS = { acb: cuenta('sup.acb'), mtz: cuenta('sup.mtz'), requerimientos: cuenta('requerimientos') }
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
const carpeta = join(CAPTURAS, 'rq-por-unidad')
mkdirSync(carpeta, { recursive: true })

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

// ---------------------------------------------------------------- siembra
await consulta(`
  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_plan, inicio_real, fin_real, creado_por)
  select x.codigo, x.orden, x.nombre, (select id from public.areas where codigo = x.area), x.plan::date, x.ini::date, x.fin::date,
         (select u.id from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'ADMIN' order by u.creado_en limit 1)
    from (values ('BCO-ACB-01', 1, 'Armado de estructura', 'MTZ', null, '2026-11-10', '2026-11-15'),
                 ('BCO-ACB-01', 2, 'Pintura y acabado', 'ACB', null, '2026-11-18', null),
                 ('BCO-ACB-02', 1, 'Pintura y acabado', 'ACB', '2026-12-01', null, null),
                 ('BCO-ACB-03', 1, 'Pintura y acabado', 'ACB', null, '2026-11-01', '2026-11-05'),
                 ('BCO-MTZ-01', 1, 'Armado de estructura', 'MTZ', null, '2026-11-18', null)) as x(codigo, orden, nombre, area, plan, ini, fin)
   where not exists (select 1 from public.codigo_etapas e where e.codigo_interno = x.codigo and e.orden = x.orden and e.quitada_en is null)`)
// Dos unidades del padrón sin trabajo de Diseño: una en el taller y otra con el
// costeo cerrado (entregada), que no se ofrece.
await consulta(`insert into public.unidades (codigo_interno, placa, marca, modelo)
  select x.codigo, x.placa, x.marca, x.modelo from (values ('BCO-PAD-01', 'BCO-101', 'Volvo', 'FMX'), ('BCO-PAD-02', 'BCO-102', 'Scania', 'G460'))
    as x(codigo, placa, marca, modelo)
   where not exists (select 1 from public.unidades u where u.codigo_interno = x.codigo)`)
await consulta(`insert into public.codigo_interno_cierres (codigo, costo_pen, por_fuente, cerrado_por)
  select 'BCO-PAD-02', 0, '{}', (select id from public.usuarios order by creado_en limit 1)
   where not exists (select 1 from public.codigo_interno_cierres where codigo = 'BCO-PAD-02' and reabierto_en is null)`)
const [material] = await consulta(`select descripcion from public.materiales where activo and not unidad_pendiente order by descripcion limit 1`)
const usuarios = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!usuarios[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, ancho = 1280) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 900 } })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 300)))
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

const tarjetas = (pagina) => pagina.locator('ul[aria-label^="Unidades de"] > li')
const tarjeta = (pagina, codigo) => tarjetas(pagina).filter({ has: pagina.locator('h2', { hasText: new RegExp(`^${codigo}$`) }) })

/** Llena la ventana abierta con un insumo del catálogo y la registra; devuelve el aviso verde. */
async function registrar(pagina, justificacion, cantidad) {
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('#rq-justificacion').fill(justificacion)
  await ventana.locator('[id^="rq-mat-"]').first().click()
  await pagina.keyboard.type(material.descripcion.slice(0, 20))
  await pagina.getByRole('option', { name: material.descripcion }).first().click()
  await ventana.locator('[id^="rq-cant-"]').first().fill(String(cantidad))
  const enviar = ventana.getByRole('button', { name: 'Registrar y mandar a Almacén' })
  await enviar.click()
  await enviar.click({ timeout: 800 }).catch(() => {})
  await ventana.waitFor({ state: 'detached', timeout: 20000 })
  const aviso = pagina.locator('p[role="status"]', { hasText: /Requerimiento RQ-/ })
  await aviso.waitFor({ timeout: 20000 })
  return (await aviso.innerText()).trim()
}

const sello = Date.now().toString().slice(-6)

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
const justificante = join(carpeta, 'justificante.pdf')
writeFileSync(justificante, pdfConTexto(['Pedido de Acabados', 'Bastan tres']))

// ------------------------------------------------ 1. Acabados: sus unidades y el RQ de una
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.acb)
  const enMenu = await pagina.locator('a[href="/requerimientos/unidades"]').count()
  comprobar(enMenu > 0, 'el menú del supervisor trae «RQ por unidad»')
  await pagina.goto(`${BASE}/requerimientos/unidades`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('h1').innerText()).includes('RQ por unidad'), 'abre «RQ por unidad»')
  const codigos = await tarjetas(pagina).locator('h2').allInnerTexts()
  console.log(`     unidades: ${codigos.join(', ')}`)
  comprobar(codigos.includes('BCO-ACB-01') && codigos.includes('BCO-ACB-02'), 've las dos unidades con trabajo en Acabados')
  comprobar(!codigos.includes('BCO-ACB-03'), 'no ve la unidad cuya etapa de Acabados ya terminó')
  comprobar(!codigos.includes('BCO-MTZ-01'), 'no ve la unidad que solo tiene trabajo en Maestranza')
  comprobar(codigos.indexOf('BCO-ACB-01') < codigos.indexOf('BCO-ACB-02'), 'la que ya está en marcha va primero')
  const t1 = tarjeta(pagina, 'BCO-ACB-01')
  comprobar((await t1.innerText()).includes('Pintura y acabado') && (await t1.innerText()).includes('En marcha'), 'la tarjeta dice su etapa de Acabados y que va en marcha')
  comprobar(!(await t1.innerText()).includes('Armado de estructura'), 'no pinta la etapa de Maestranza')
  comprobar((await pagina.locator('h2', { hasText: /^PLANTA$/ }).count()) === 1, 'PLANTA va al final')
  const otras = await pagina.locator('ul[aria-label="Las demás unidades del taller"] li').count()
  const delPadron = Number((await consulta(`select count(distinct normalizar_codigo_interno(codigo_interno)) n from unidades where activo and codigo_interno is not null
      and normalizar_codigo_interno(codigo_interno) not in ('BCO-ACB-01', 'BCO-ACB-02')
      and not exists (select 1 from codigo_interno_cierres k where k.codigo = normalizar_codigo_interno(codigo_interno) and k.reabierto_en is null)`))[0].n)
  comprobar(otras === delPadron && otras > 0, `las demás unidades del taller, para pedir aunque Diseño no cargue nada (${otras} de ${delPadron} en el padrón)`)
  const lista = pagina.locator('ul[aria-label="Las demás unidades del taller"]')
  comprobar((await lista.getByText('BCO-PAD-01').count()) === 1 && (await lista.getByText('BCO-PAD-02').count()) === 0,
    'ofrece la unidad del padrón que sigue en el taller y no la entregada (costeo cerrado)')
  await lista.getByRole('button', { name: 'Nuevo RQ para BCO-PAD-01' }).click()
  const deLaLista = await pagina.locator('[role="dialog"] #rq-para').innerText()
  comprobar(deLaLista.includes('BCO-PAD-01') && deLaLista.includes('Volvo'), `desde la lista se pide con el código puesto («${deLaLista.replace(/\s+/g, ' ')}»)`)
  await pagina.keyboard.press('Escape')
  await pagina.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 10000 })
  await pagina.screenshot({ path: join(carpeta, '1-unidades-acabados.png'), fullPage: true })

  const antes = Number((await consulta(`select count(*) n from requerimientos where codigo_interno = 'BCO-ACB-01'`))[0].n)
  await t1.getByRole('button', { name: 'Nuevo RQ para BCO-ACB-01' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('#rq-para').waitFor({ timeout: 10000 })
  const para = await ventana.locator('#rq-para').innerText()
  comprobar(para.includes('Acabados') && para.includes('BCO-ACB-01') && (await ventana.locator('select#rq-area').count()) === 0
    && (await ventana.locator('input#rq-codigo').count()) === 0,
    `el área y el código van puestos en una línea y no se eligen («${para.replace(/\s+/g, ' ')}»)`)
  const enfocado = await pagina.evaluate(() => document.activeElement?.id)
  comprobar(enfocado === 'rq-justificacion', `el cursor empieza en la justificación (${enfocado})`)
  await pagina.screenshot({ path: join(carpeta, '2-ventana-de-la-unidad.png') })
  const aviso = await registrar(pagina, `Pintura para el acabado de la unidad ${sello}`, 2)
  const numero = (aviso.match(/RQ-\d{4}-\d{4}/) ?? [''])[0]
  comprobar(Boolean(numero), `registrado: «${aviso}»`)
  comprobar((await tarjeta(pagina, 'BCO-ACB-01').locator('p[role="status"]').innerText()).includes(numero),
    'el verde sale en la tarjeta de la unidad, no arriba de la lista')
  const filas = await consulta(
    `select r.numero, a.codigo area, r.codigo_interno, r.estado, r.creado_por from requerimientos r join areas a on a.id = r.area_id
      where r.codigo_interno = 'BCO-ACB-01' order by r.creado_en desc`)
  comprobar(filas.length === antes + 1, `un solo RQ nuevo aunque se tocó dos veces (${antes} → ${filas.length})`)
  comprobar(filas[0]?.area === 'ACB' && filas[0]?.estado === 'POR_ATENDER' && filas[0]?.creado_por === usuarios[CUENTAS.acb],
    `en la base: ${filas[0]?.numero}, Acabados, por revisar en Almacén, registrado por el supervisor`)
  await tarjeta(pagina, 'BCO-ACB-01').getByText(numero).waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await tarjeta(pagina, 'BCO-ACB-01').innerText()).includes(numero), `la tarjeta de la unidad ya muestra ${numero}`)
  await pagina.screenshot({ path: join(carpeta, '3-unidad-con-su-rq.png'), fullPage: true })

  // ---------------------------------------------- Lo corrige con su justificante: es suyo
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: `Corregir el requerimiento ${numero}` }).click()
  const corr = pagina.locator('[role="dialog"]')
  await corr.locator('[id^="rq-corr-cant-"]').first().fill('3')
  await corr.locator('[id^="correccion-motivo-"]').fill('El pintor pide un galón más para la segunda mano')
  await corr.locator('[id^="correccion-justificante-"]').setInputFiles(justificante)
  await corr.getByRole('button', { name: 'Corregir', exact: true }).click()
  await corr.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  const [corregido] = await consulta(
    `select l.cantidad::float n, (select count(*)::int from correcciones c where c.documento_id = r.id) correcciones,
            (select count(*)::int from storage.objects o join correcciones c on c.justificante_ruta = o.name
              where o.bucket_id = 'justificantes-correccion' and c.documento_id = r.id) archivos
       from requerimientos r join requerimiento_lineas l on l.requerimiento_id = r.id where r.numero = $1`, [numero])
  comprobar(corregido?.n === 3 && corregido?.correcciones === 1 && corregido?.archivos === 1,
    `el supervisor corrigió su ${numero} con su justificante subido (${JSON.stringify(corregido)})`)
  await pagina.goto(`${BASE}/requerimientos/unidades`, { waitUntil: 'networkidle' })

  // ---------------------------------------------- 2. PLANTA, y lo anula porque es suyo
  await pagina.getByRole('button', { name: 'Nuevo RQ para PLANTA' }).click()
  const avisoPlanta = await registrar(pagina, `Lijas para retoques del área ${sello}`, 5)
  const numeroPlanta = (avisoPlanta.match(/RQ-\d{4}-\d{4}/) ?? [''])[0]
  comprobar(Boolean(numeroPlanta), `PLANTA registrado: ${numeroPlanta}`)
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  const pestanas = await pagina.locator('nav[aria-label="Requerimiento"] a').allInnerTexts()
  comprobar(pestanas[0]?.startsWith('Por unidad'), `la lista tiene la pestaña «Por unidad» primero (${pestanas.join(' | ')})`)
  const delPlanta = pagina.locator(`[data-rq="${numeroPlanta}"]`)
  await delPlanta.getByRole('button', { name: 'Anular' }).click()
  const anular = pagina.locator('[role="dialog"]')
  await anular.locator('textarea[name="motivo"]').fill('Se usó lo que sobró de otra unidad.')
  await anular.getByRole('button', { name: 'Anular' }).click()
  await anular.waitFor({ state: 'detached', timeout: 20000 })
  const [anulado] = await consulta(`select estado, anulado_por from requerimientos where numero = $1`, [numeroPlanta])
  comprobar(anulado?.estado === 'ANULADO' && anulado?.anulado_por === usuarios[CUENTAS.acb], `el supervisor anuló su ${numeroPlanta} y quedó en la base`)
  comprobar(errores.length === 0, `sin errores de consola como supervisor de Acabados ${errores.join(' | ')}`)

  // En el teléfono, la misma pantalla.
  await pagina.setViewportSize({ width: 390, height: 844 })
  await pagina.goto(`${BASE}/requerimientos/unidades`, { waitUntil: 'networkidle' })
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `en el teléfono no se sale de lado (${ancho} px)`)
  await pagina.screenshot({ path: join(carpeta, '4-unidades-telefono.png'), fullPage: true })
  await contexto.close()
  globalThis.rqAcb = numero
}

// ------------------------------------------------ 3. Maestranza: lo suyo, y lo de Acabados sin anular
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.mtz)
  await pagina.goto(`${BASE}/requerimientos/unidades`, { waitUntil: 'networkidle' })
  const codigos = await tarjetas(pagina).locator('h2').allInnerTexts()
  comprobar(codigos.includes('BCO-MTZ-01') && !codigos.includes('BCO-ACB-01') && !codigos.includes('BCO-ACB-02'),
    `Maestranza ve su unidad y no las de Acabados (${codigos.join(', ')})`)
  await pagina.goto(`${BASE}/requerimientos?area=todas`, { waitUntil: 'networkidle' })
  const deAcabados = pagina.locator(`[data-rq="${globalThis.rqAcb}"]`)
  comprobar((await deAcabados.count()) === 1, `en «Todas las áreas» ve el ${globalThis.rqAcb} de Acabados`)
  comprobar((await deAcabados.getByRole('button', { name: /Anular|Corregir/ }).count()) === 0, 'sin «Anular» ni «Corregir» en el RQ de otra área')
  comprobar(errores.length === 0, `sin errores de consola como supervisor de Maestranza ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 4. Requerimientos sigue eligiendo el área
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Nuevo requerimiento', exact: true }).click()
  const ventana = pagina.locator('[role="dialog"]')
  comprobar((await ventana.locator('select#rq-area').count()) === 1 && (await ventana.locator('input#rq-codigo').count()) === 1,
    'Requerimientos elige el área y escribe el código, como antes')
  const deAcabados = pagina.locator(`[data-rq="${globalThis.rqAcb}"]`)
  await pagina.keyboard.press('Escape')
  comprobar((await deAcabados.getByRole('button', { name: 'Anular' }).count()) === 1, `Requerimientos puede anular el ${globalThis.rqAcb} del supervisor`)
  const directo = await pagina.goto(`${BASE}/requerimientos/unidades`, { waitUntil: 'networkidle' })
  comprobar(!pagina.url().endsWith('/requerimientos/unidades') || (directo?.status() ?? 200) >= 400,
    `«RQ por unidad» no se abre sin el permiso del supervisor (${pagina.url().replace(BASE, '')})`)
  comprobar(errores.length === 0, `sin errores de consola como Requerimientos ${errores.join(' | ')}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallas.`)
process.exit(fallas.length === 0 ? 0 : 1)
