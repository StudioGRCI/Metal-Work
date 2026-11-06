/**
 * Clic real sobre las observaciones de Diseño (migración 20261106100000), con
 * la cuenta de cada puesto (nunca ADMIN), y la base mirada después de cada paso:
 *
 *   1. El colaborador de Diseño tiene en el menú su informe, las OT, los
 *      requerimientos y el stock; pide material por RQ; anota una actividad del
 *      día (una sola fecha, sin planificar) y ya no registra avance de planos;
 *      en la OT no tiene dónde subir un plano.
 *   2. Diseño ve la lista de Planos con la OT y el cliente, en el orden en que
 *      entraron las OT; adjunta la ficha técnica del vehículo junto a la OT;
 *      sube un DXF comprimido; carga el par Habilitado y Ensamblaje de otro
 *      juego de planos, que no hereda el avance del área, y no agrega etapas sueltas.
 *   3. El supervisor de Maestranza descarga los DXF y le agrega una subetapa al
 *      Habilitado; el de Producción también ve los DXF; el de Acabados no los ve y
 *      agrega su etapa.
 *   4. Gerencia no entra a los DXF.
 *
 * Usa la base de las semillas del manual (`mw_manual`): las de
 * /mnt/project-files/manual/v4/Diseno/proyecto-editable-diseno.tar.gz, con
 * `7-observaciones-diseno.sql`. Los códigos A y C y sus OT.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE, BANCO_CHROMIUM.
 */
import { mkdirSync, writeFileSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { escribirCodigo } from './campo-codigo.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas/observaciones-diseno'
const A = process.env.CODIGO_A ?? 'SRQ_PL_N3_2_26/41'
const C = process.env.CODIGO_C ?? 'MCO_VL_O4_3_26/43'
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const base = new pg.Client({
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BANCO_BASE ?? 'mw_manual',
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
const sello = Date.now().toString().slice(-6)
const hoy = (await uno(`select (now() at time zone 'America/Lima')::date::text as d`)).d

// Los archivos de prueba: una foto JPG mínima y un .zip vacío (con su firma «PK»).
const FOTO = `${CAPTURAS}/ficha-${sello}.jpg`
writeFileSync(FOTO, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]))
const ZIP = `${CAPTURAS}/dxf-${sello}.zip`
writeFileSync(ZIP, Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]))

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
const codigoEn = (ruta, codigo, vista) => `${ruta}?${new URLSearchParams({ codigo, ...(vista ? { vista } : {}) })}`
const estado = async (pagina) =>
  limpio(await pagina.locator('[role="status"], [role="alert"]').filter({ hasText: /\S/ }).first().innerText({ timeout: 20000 }).catch(() => ''))

const otA = (await uno(
  `select o.id from ordenes_trabajo o join unidades u on u.id = o.unidad_id where u.codigo_interno = $1 and o.estado <> 'ANULADA' order by o.creado_en limit 1`,
  [A],
)).id
const idDe = async (correo) => (await uno(`select id from usuarios where correo = $1`, [`${correo}.local@metalwork.test`])).id

// ------------------------------------------------ 1. El colaborador de Diseño
{
  const { pagina, contexto, errores } = await entrar('colaborador')
  const menu = await pagina.locator('nav').first().innerText()
  comprobar(['Informe', 'Requerimientos', 'Stock'].every((t) => menu.includes(t)), `el menú del colaborador trae informe, requerimientos y stock: ${limpio(menu).slice(0, 200)}`)

  // Pide material por requerimiento.
  const colaborador = await idDe('colaborador')
  const rqAntes = Number((await uno(`select count(*) n from requerimientos where creado_por = $1`, [colaborador])).n)
  await ir(pagina, '/requerimientos')
  await pagina.getByRole('button', { name: 'Nuevo requerimiento' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('#rq-area').selectOption({ label: 'Maestranza' })
  await escribirCodigo(v.locator('#rq-codigo'), A)
  await v.locator('#rq-justificacion').fill('Planchas para el habilitado del piso, según la lista de materiales del plano.')
  await v.getByRole('button', { name: 'Pedirlo como material nuevo' }).last().click()
  await v.locator('[id^="rq-desc-"]').first().fill(`Plancha LAF 3 mm 4x8 ${sello}`)
  await v.locator('[id^="rq-cant-"]').first().fill('4')
  await v.locator('[id^="rq-cat-"]').first().selectOption({ index: 1 })
  await v.getByRole('button', { name: 'Registrar y mandar a Almacén' }).click()
  const avisoRq = await estado(pagina)
  comprobar(/Requerimiento RQ-\d{4}-\d{4} registrado/.test(avisoRq), `el colaborador emite su RQ: «${avisoRq}»`)
  await pagina.waitForTimeout(800)
  const rqDespues = Number((await uno(`select count(*) n from requerimientos where creado_por = $1`, [colaborador])).n)
  comprobar(rqDespues === rqAntes + 1, `y queda en la base a su nombre (${rqAntes} → ${rqDespues})`)

  // Corrige y anula solo los suyos: en el RQ de otra persona no tiene los botones.
  const ajeno = await uno(`select numero from requerimientos where tipo = 'OPERACION' and creado_por <> $1 and estado in ('POR_ATENDER','SIN_STOCK') limit 1`, [colaborador])
  const suyo = await uno(`select numero from requerimientos where creado_por = $1 and estado = 'POR_ATENDER' order by creado_en desc limit 1`, [colaborador])
  await ir(pagina, '/requerimientos')
  if (ajeno) {
    const t = pagina.locator(`[data-rq="${ajeno.numero}"]`)
    comprobar((await t.count()) === 0 || (await t.getByRole('button', { name: /^(Anular|Corregir)/ }).count()) === 0,
      `en el RQ de otra persona (${ajeno.numero}) no tiene Anular ni Corregir`)
  }
  comprobar((await pagina.locator(`[data-rq="${suyo.numero}"]`).getByRole('button', { name: /^Anular/ }).count()) === 1,
    `en el suyo (${suyo.numero}) sí puede anular`)

  await ir(pagina, '/almacen/stock')
  comprobar((await pagina.locator('main').innerText()).length > 50 && !pagina.url().includes('sin-permiso'), 'mira el stock antes de pedir')

  // Anota una actividad del día.
  await ir(pagina, '/diseno/informe-semanal')
  const main = await pagina.locator('main').innerText()
  comprobar(main.includes('Actividades diarias') && !main.includes('Planificación de modelado'), 'la tabla se llama «Actividades diarias»')
  comprobar(!main.includes('Registrar una entrega de planos'), 'ya no registra el avance de planos')
  comprobar((await pagina.locator('#tarea-inicio, #tarea-fin').count()) === 0 && (await pagina.locator('#tarea-fecha').getAttribute('max')) === hoy,
    'una sola fecha, y no deja elegir un día que no llegó')
  const componente = `Soporte del guardafango ${sello}`
  await pagina.locator('#tarea-ot').selectOption({ index: 1 })
  await pagina.locator('#tarea-persona').selectOption({ index: 1 })
  await pagina.locator('#tarea-tipo').selectOption('MODELADO_3D')
  await pagina.locator('#tarea-componente').fill(componente)
  await pagina.getByRole('button', { name: 'Anotar actividad' }).click()
  const avisoTarea = await estado(pagina)
  comprobar(avisoTarea.includes('Actividad anotada'), `aviso: «${avisoTarea}»`)
  const tarea = await uno(`select fecha_inicio::text i, fecha_entrega::text e from diseno_tareas where componente = $1`, [componente])
  comprobar(tarea && tarea.i === hoy && tarea.e === hoy, `la actividad queda con el día de hoy como inicio y entrega (${JSON.stringify(tarea)})`)
  await pagina.screenshot({ path: `${CAPTURAS}/colaborador-informe.png`, fullPage: true })

  // En la OT, los planos se consultan: no hay dónde subir uno.
  await ir(pagina, `/ordenes/${otA}/planos`)
  const planosOt = await pagina.locator('main').innerText()
  comprobar(!pagina.url().includes('sin-permiso') && (await pagina.locator('main input[type="file"]').count()) === 0
    && !planosOt.includes('Adjunta el PDF en tu plano asignado'), 'en la OT el colaborador ve los planos y no tiene dónde subir uno')
  comprobar(errores.length === 0, `sin errores de consola como colaborador ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 2. Diseño
{
  const { pagina, contexto, errores } = await entrar('diseno')
  // La lista de Planos, con la OT y el cliente, en el orden en que entraron las OT.
  await ir(pagina, '/diseno/planos')
  const filas = await pagina.locator('[data-codigo]').evaluateAll((a) => a.map((x) => [x.getAttribute('data-codigo'), x.innerText]))
  const esperado = (await consulta(
    `select distinct on (upper(u.codigo_interno)) upper(u.codigo_interno) codigo, o.numero, o.fecha_registro
       from ordenes_trabajo o join unidades u on u.id = o.unidad_id
      where o.estado in ('APROBADA','PROGRAMADA','EN_PROCESO','PAUSADA','CONTROL_CALIDAD')
      order by upper(u.codigo_interno), o.fecha_registro, o.numero`,
  )).sort((x, y) => String(x.fecha_registro).localeCompare(String(y.fecha_registro)) || x.numero.localeCompare(y.numero))
  const conOt = filas.filter(([, t]) => /OT \d/.test(t)).map(([c]) => c)
  comprobar(conOt.length > 0 && conOt.slice(0, esperado.length).join() === esperado.map((e) => e.codigo).join(),
    `las unidades con OT abierta van primero, en el orden de ingreso de la OT (${conOt.slice(0, 4).join(', ')})`)
  const filaA = filas.find(([c]) => c === A)?.[1] ?? ''
  const cliente = (await uno(`select c.razon_social from ordenes_trabajo o join clientes c on c.id = o.cliente_id where o.id = $1`, [otA])).razon_social
  comprobar(/OT \d/.test(filaA) && filaA.includes(cliente), `la fila dice la OT y el cliente: ${limpio(filaA).slice(0, 160)}`)
  await pagina.screenshot({ path: `${CAPTURAS}/diseno-planos.png`, fullPage: true })

  // La ficha técnica junto a la OT.
  await ir(pagina, codigoEn('/diseno/codigo', A))
  const fichasAntes = await pagina.locator('[data-ficha]').count()
  comprobar(fichasAntes >= 1, 'la OT ya trae la ficha técnica que se adjuntó')
  await pagina.getByRole('button', { name: 'Adjuntar ficha técnica' }).first().click()
  const vf = pagina.locator('[role="dialog"]')
  await vf.locator('input[type="file"]').setInputFiles(FOTO)
  await vf.getByRole('button', { name: 'Adjuntar' }).click()
  await vf.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  await pagina.waitForTimeout(800)
  const fichas = await consulta(`select ruta_storage from ot_adjuntos where orden_id = $1 and tipo = 'FICHA_VEHICULO' order by creado_en`, [otA])
  comprobar(fichas.length === fichasAntes + 1 && /\/ficha-[0-9a-f-]{36}\.jpg$/.test(fichas.at(-1).ruta_storage), `la foto de la ficha queda en la OT (${fichas.map((f) => f.ruta_storage.split('/').pop()).join(', ')})`)
  await ir(pagina, codigoEn('/diseno/codigo', A))
  comprobar((await pagina.locator('[data-ficha]').count()) === fichasAntes + 1, 'y se ve junto a la OT')
  await pagina.screenshot({ path: `${CAPTURAS}/diseno-ficha.png`, fullPage: true })

  // Los DXF comprimidos.
  await ir(pagina, codigoEn('/diseno/codigo', A, 'dxf'))
  const dxfAntes = await pagina.locator('[data-dxf]').count()
  comprobar(dxfAntes >= 2, 'el código trae sus comprimidos de DXF')
  const descripcion = `Refuerzos de la compuerta ${sello}`
  await pagina.locator('#dxf-descripcion').fill(descripcion)
  await pagina.locator('#dxf-archivo').setInputFiles(ZIP)
  await pagina.getByRole('button', { name: 'Cargar DXF', exact: true }).click()
  const avisoDxf = await estado(pagina)
  comprobar(avisoDxf.includes('DXF cargados'), `aviso: «${avisoDxf}»`)
  const dxf = await uno(`select ruta, tamano_bytes from codigo_dxf where descripcion = $1`, [descripcion])
  comprobar(dxf && /^[0-9a-f-]{36}\.zip$/.test(dxf.ruta), `el comprimido queda registrado (${dxf?.ruta})`)
  const avisoMtz = await uno(`select count(*) n from notificaciones n join usuarios u on u.id = n.usuario_id
                               where u.correo = 'sup.mtz.local@metalwork.test' and n.titulo = $1`, [`DXF nuevos: ${A}`])
  comprobar(Number(avisoMtz.n) >= 1, 'al supervisor de Maestranza le llega el aviso')
  await pagina.screenshot({ path: `${CAPTURAS}/diseno-dxf.png`, fullPage: true })

  // El par de etapas de otro juego de planos, y solo Maestranza o Producción.
  await ir(pagina, codigoEn('/diseno/codigo', A, 'etapas'))
  comprobar((await pagina.locator('#etapa-area-nueva').count()) === 0 && (await pagina.getByText('Agregar una etapa', { exact: true }).count()) === 0,
    'Diseño ya no agrega etapas sueltas: solo el par de cada juego')
  comprobar((await pagina.locator('[data-subetapa]').count()) >= 4, 'las subetapas de Maestranza y Producción salen debajo de su etapa')
  const juego = `Caja ${sello}`
  await pagina.locator('#par-juego').fill(juego)
  await pagina.getByRole('button', { name: 'Cargar Habilitado y Ensamblaje' }).click()
  const avisoPar = await estado(pagina)
  comprobar(avisoPar.includes(`Habilitado y Ensamblaje de «${juego}»`), `aviso: «${avisoPar}»`)
  const par = await consulta(`select e.nombre, a.codigo area from codigo_etapas e join areas a on a.id = e.area_id
                               where e.codigo_interno = $1 and e.nombre like '%: ' || $2 and e.quitada_en is null order by e.orden`, [A, juego])
  comprobar(par.map((p) => `${p.nombre}/${p.area}`).join() === `Habilitado: ${juego}/MTZ,Ensamblaje: ${juego}/PRD`, `el par del juego «${juego}» (${par.map((p) => p.nombre).join(', ')})`)
  // El reporte diario es del área: el Habilitado del juego nuevo, sin empezar, no
  // hereda el avance que Maestranza reportó para el que ya empezó.
  const avances = Object.fromEntries((await consulta(
    `select nombre, avance_reportado::float a from codigo_interno_etapas_calculado($1) where nombre in ('Habilitado', $2)`,
    [A, `Habilitado: ${juego}`],
  )).map((r) => [r.nombre, r.a]))
  comprobar(avances['Habilitado'] > 0 && avances[`Habilitado: ${juego}`] === null,
    `el Habilitado nuevo no hereda el avance del área (${JSON.stringify(avances)})`)
  await ir(pagina, codigoEn('/diseno/codigo', A, 'etapas'))
  comprobar((await pagina.locator(`[data-etapa="Habilitado: ${juego}"]`).innerText()).includes('Todavía no empieza'),
    'y la pantalla dice que todavía no empieza, sin la barra del área')
  await pagina.screenshot({ path: `${CAPTURAS}/diseno-etapas.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como Diseño ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 3. Los supervisores
{
  const { pagina, contexto, errores } = await entrar('sup.mtz')
  await ir(pagina, `/planos?q=${encodeURIComponent(A)}`)
  const tarjeta = pagina.locator(`[data-codigo="${A}"]`)
  const dxfA = Number((await uno(`select count(*) n from codigo_dxf where codigo_interno = $1 and quitado_en is null`, [A])).n)
  comprobar((await tarjeta.locator('[data-dxf]').count()) === dxfA, `Maestranza ve los ${dxfA} DXF del código`)
  const enlace = await tarjeta.locator('[data-dxf] a').first().getAttribute('href')
  const descarga = await pagina.request.get(enlace)
  comprobar(descarga.ok(), `y los descarga (${descarga.status()})`)
  // El supervisor no tiene `ordenes.ver`: la tarjeta sigue sin la OT, como antes
  // (el jefe de Producción, que sí lo tiene, la ve).
  comprobar(!/OT \d/.test(await tarjeta.innerText()), 'al supervisor no se le muestra la OT, que no le toca ver')

  // Una subetapa debajo del Habilitado de C.
  await ir(pagina, `/planos?q=${encodeURIComponent(C)}`)
  const habilitado = pagina.locator(`[data-codigo="${C}"] [data-etapa="Habilitado"]`).first()
  await habilitado.getByRole('button', { name: 'Subetapa' }).click()
  const v = pagina.locator('[role="dialog"]')
  const nombre = `Corte de la tolva ${sello}`
  await v.locator('input[name="nombre"]').fill(nombre)
  await v.getByRole('button', { name: 'Agregar subetapa' }).click()
  await v.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  await pagina.waitForTimeout(800)
  const sub = await uno(`select s.de_area, p.nombre padre from codigo_etapas s join codigo_etapas p on p.id = s.padre_id where s.nombre = $1`, [nombre])
  comprobar(sub?.padre === 'Habilitado' && sub.de_area, `la subetapa queda debajo del Habilitado, como del área (${JSON.stringify(sub)})`)
  await ir(pagina, `/planos?q=${encodeURIComponent(C)}`)
  comprobar((await pagina.locator(`[data-codigo="${C}"] [data-subetapa][data-etapa="${nombre}"]`).count()) === 1, 'y se ve debajo de su etapa')
  await pagina.screenshot({ path: `${CAPTURAS}/sup-mtz.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como Maestranza ${errores.join(' | ')}`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('sup.prd')
  await ir(pagina, `/planos?q=${encodeURIComponent(A)}`)
  const dxfA = Number((await uno(`select count(*) n from codigo_dxf where codigo_interno = $1 and quitado_en is null`, [A])).n)
  comprobar(dxfA > 0 && (await pagina.locator('[data-dxf]').count()) === dxfA, `Producción también ve los ${dxfA} DXF del código`)
  const aviso = await uno(`select count(*) n from notificaciones n join usuarios u on u.id = n.usuario_id
                           where u.correo = 'sup.prd.local@metalwork.test' and n.titulo = $1`, [`DXF nuevos: ${A}`])
  comprobar(Number(aviso.n) >= 1, 'y le llegó el aviso')
  await contexto.close()
}
{
  const { pagina, contexto, errores } = await entrar('sup.acb')
  await ir(pagina, `/planos?q=${encodeURIComponent(A)}`)
  comprobar((await pagina.locator('[data-dxf]').count()) === 0, 'Acabados no ve los DXF')
  await ir(pagina, '/planos')
  await pagina.locator('summary', { hasText: 'Agregar una etapa de' }).click()
  await pagina.getByRole('combobox', { name: 'Unidad' }).click()
  await pagina.locator('input[type="search"]:focus').waitFor({ timeout: 10000 })
  await pagina.keyboard.type(C.slice(0, 6))
  await pagina.getByRole('option', { name: new RegExp(C.slice(0, 6), 'i') }).first().click()
  const nombre = `Arenado de la tolva ${sello}`
  await pagina.locator('#etapa-de-area-nombre-propia').fill(nombre)
  await pagina.getByRole('button', { name: 'Agregar etapa' }).click()
  const aviso = await estado(pagina)
  comprobar(aviso.includes('Etapa agregada'), `aviso: «${aviso}»`)
  const propia = await uno(`select e.codigo_interno, e.padre_id, e.de_area, a.codigo area from codigo_etapas e join areas a on a.id = e.area_id where e.nombre = $1`, [nombre])
  comprobar(propia?.codigo_interno === C && propia.padre_id === null && propia.de_area && propia.area === 'ACB', `Acabados agrega su propia etapa (${JSON.stringify(propia)})`)
  await pagina.screenshot({ path: `${CAPTURAS}/sup-acb.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como Acabados ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 4. Gerencia
{
  const { pagina, contexto } = await entrar('gerencia')
  await ir(pagina, '/diseno/dxf')
  comprobar(pagina.url().includes('sin-permiso'), 'Gerencia no entra a los DXF')
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallan.`)
process.exit(fallas.length === 0 ? 0 : 1)
