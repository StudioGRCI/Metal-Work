/**
 * Clic real sobre la migración 20261020195000: el stock libre y lo separado
 * para cada código interno (DKS, 2026-10-20). Con la cuenta de cada puesto,
 * nunca ADMIN:
 *
 *   1. Almacén tiene «Stock en almacén» junto a su kardex. Al revisar el stock
 *      de un RQ ve, junto a cada insumo, lo que dice el sistema: cuánto está
 *      libre y cuánto ya es de otros códigos internos; lo que otro RQ del mismo
 *      código ya separó, aparte y sin contarlo como suyo, y si anota más de lo
 *      que hay para él, un aviso. «Tienes» no se llena solo. Lo que separa
 *      para un RQ deja de estar libre para el siguiente.
 *      El material nuevo que asocia a uno del catálogo queda con ese material
 *      y dice el stock del elegido.
 *   2. Requerimientos y Administración tienen el stock en su menú y lo ven con
 *      lo libre y lo de cada código, con el RQ que lo separó; no abren el kardex.
 *   3. El supervisor lo sigue viendo; Ventas no entra.
 *   4. En el teléfono, la página no se sale de la pantalla.
 *   5. En la salida del kardex, lo devuelto se descuenta una vez: el ítem del
 *      RQ dice lo que de verdad falta entregar.
 *   6. El accesorio que entró para una unidad le sirve a un RQ de ese código;
 *      lo que un RQ tomó de él ya no le sirve al siguiente.
 *
 * Siembra por SQL un material propio de la corrida con un ingreso de 20, y tres
 * RQ como Requerimientos (`emitir_requerimiento` con su sesión). Después de cada
 * clic consulta la base. Se puede correr cuantas veces haga falta.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  requerimientos: 'requerimientos.local@metalwork.test',
  administracion: 'administracion.local@metalwork.test',
  almacen: 'almacen.local@metalwork.test',
  supervisor: 'sup.mtz.local@metalwork.test',
  ventas: 'ventas.local@metalwork.test',
}
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

/** Corre `sql` con la sesión de `correo`, con su rol y no como dueño de las tablas. */
async function como(correo, sql, valores = []) {
  await base.query('begin')
  try {
    const [u] = await consulta('select id::text from public.usuarios where correo = $1', [correo])
    await base.query(
      `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
              set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
      [u.id],
    )
    await base.query('set local role authenticated')
    const filas = await consulta(sql, valores)
    await base.query('commit')
    return filas
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

// ============================================ 0. Lo que se siembra
const sufijo = Date.now().toString(36).slice(-4).toUpperCase()
const CODIGO_A = `BANCO-A${sufijo}`
const CODIGO_B = `BANCO-B${sufijo}`
// Un consumible propio de esta corrida, sin RQ ni kardex: le entran 20. Como
// dueño de las tablas; el alta y el ingreso tienen sus propias pruebas.
const [material] = await consulta(`
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  select $1, $2,
         (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1),
         (select id from public.unidades_medida where codigo = 'UND')
  returning id::text, codigo, descripcion, 'UND' as unidad`, [`PRB-SL-${sufijo}`, `Disco de prueba del stock libre ${sufijo}`])
const U = material.unidad
await consulta(`
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
  select gen_random_uuid(), 'INGRESO', $1::uuid, 20, 'INGRESO_GENERAL', $2, u.id from public.usuarios u where u.correo = $3`,
  [material.id, `GR BANCO ${sufijo}`, CUENTAS.almacen])
const [elegido] = await consulta(`
  select m.id::text, m.codigo, m.descripcion, m.categoria_id::text, m.unidad_medida_id::text
    from public.materiales m join public.unidades_medida u on u.id = m.unidad_medida_id
   where u.codigo = 'UND' and m.activo and m.id::text <> $1 and not m.unidad_pendiente and m.descripcion !~* 'prueba'
   order by m.codigo limit 1`, [material.id])
const areas = Object.fromEntries((await consulta(`select codigo, id::text from public.areas where codigo in ('MTZ', 'PRD')`)).map((a) => [a.codigo, a.id]))
const stockComo = async (correo) =>
  (await como(correo, 'select existencia, separado, libre, por_codigo from public.stock_libre_en_almacen(array[$1::uuid])', [material.id]))[0]
const antes = await stockComo(CUENTAS.almacen)
console.log(`    material: ${material.codigo} ${material.descripcion} · kardex ${antes.existencia} · libre ${antes.libre}`)
const E = Number(antes.existencia)
comprobar(Number(antes.libre) === E && Number(antes.separado) === 0, `antes de los RQ, todo está libre: ${antes.libre} de ${E}`)

const rq1 = crypto.randomUUID()
const rq2 = crypto.randomUUID()
const rq3 = crypto.randomUUID()
await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Discos para la prueba del stock libre', null, $4::jsonb)`,
  [rq1, areas.MTZ, CODIGO_A, JSON.stringify([{ material_id: material.id, cantidad: 4 }])])
await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Material para la prueba del stock libre', null, $4::jsonb)`,
  [rq2, areas.PRD, CODIGO_B, JSON.stringify([
    { material_id: material.id, cantidad: 3 },
    { nuevo: true, descripcion: `Pieza nueva de prueba ${sufijo}`, cantidad: 2, unidad_medida_id: elegido.unidad_medida_id, categoria_id: elegido.categoria_id },
  ])])
// RQ3 pide para el mismo código que RQ1, más de lo que el sistema le puede dar.
await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Lo mismo otra vez, para la prueba del stock libre', null, $4::jsonb)`,
  [rq3, areas.MTZ, CODIGO_A, JSON.stringify([{ material_id: material.id, cantidad: 18 }])])
const numero = async (id) => (await consulta('select numero from public.requerimientos where id = $1', [id]))[0].numero
const N1 = await numero(rq1)
const N2 = await numero(rq2)
const N3 = await numero(rq3)
console.log(`    sembrados: ${N1} y ${N3} (${CODIGO_A}), ${N2} (${CODIGO_B})`)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, ancho = 1280) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 900 } })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 60000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto, errores }
}
async function menu(pagina) {
  return pagina.locator('nav[aria-label="Menú principal"] > div').evaluateAll((divs) =>
    divs.map((d) => ({ grupo: d.querySelector('p')?.textContent?.trim(), items: [...d.querySelectorAll('a')].map((a) => a.textContent?.trim()) })),
  )
}
const pestanas = (pagina) => pagina.locator('nav[aria-label="Secciones"] a').evaluateAll((as) => as.map((a) => a.textContent?.trim()))
const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim()
const ir = (pagina, ruta) => pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 120000 })
const fmt = (n) => new Intl.NumberFormat('es-PE', { maximumFractionDigits: 3 }).format(n)

/** La fila del stock de un material, buscado por su código. */
async function filaDelStock(pagina) {
  await ir(pagina, `/almacen/stock?q=${encodeURIComponent(material.codigo)}`)
  const fila = pagina.locator(`tr[data-material="${material.codigo}"]`)
  return { fila, libre: Number(await fila.locator('[data-libre]').getAttribute('data-libre')), texto: await texto(fila) }
}

// ============================================ 1. Almacén revisa con el stock del sistema a la vista
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  // Sin el número de pendientes que lleva al lado («Kardex1»).
  const deAlmacen = ((await menu(pagina)).find((g) => g.grupo === 'Almacén')?.items ?? []).map((t) => t?.replace(/\d+\+?$/, ''))
  comprobar(deAlmacen.join(',') === 'Kardex,Stock en almacén', `su menú «Almacén»: ${deAlmacen.join(' · ')}`)

  await ir(pagina, '/requerimientos/atencion')
  const filaRq = (n) => pagina.locator('tr', { hasText: n })
  await filaRq(N1).getByRole('button', { name: 'Revisar stock' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor()
  const linea1 = await texto(ventana.locator('[data-en-el-sistema]').first())
  comprobar(linea1 === `En el sistema: ${fmt(E)} ${U} libres`, `${N1}: «${linea1}»`)
  comprobar((await ventana.locator('input[type="number"]').first().inputValue()) === '', '«Tienes» no se llena solo')
  await ventana.getByRole('button', { name: 'Tengo todo' }).click()
  await ventana.getByRole('button', { name: 'Guardar la revisión' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
  const [r1] = await consulta(`select r.estado, l.cantidad_en_stock::numeric as en_stock from public.requerimientos r
                                 join public.requerimiento_lineas l on l.requerimiento_id = r.id where r.id = $1`, [rq1])
  comprobar(r1.estado === 'LISTO_EN_ALMACEN' && Number(r1.en_stock) === 4, `${N1} queda listo con 4 separados (base: ${r1.estado}, ${r1.en_stock})`)

  await ir(pagina, '/requerimientos/atencion')
  await filaRq(N2).getByRole('button', { name: 'Revisar stock' }).click()
  await ventana.waitFor()
  const lineas2 = await ventana.locator('[data-en-el-sistema]').allInnerTexts()
  const esperado = `En el sistema hay ${fmt(E)} ${U}: ${fmt(E - 4)} libres · 4 separados para otros códigos (${CODIGO_A}: 4)`
  comprobar(lineas2.length === 1 && lineas2[0].replace(/\s+/g, ' ').trim() === esperado,
    `${N2}: lo que separó para ${N1} ya no está libre, y el material nuevo no dice nada: ${JSON.stringify(lineas2)}`)
  await pagina.screenshot({ path: join(CAPTURAS, 'stock-libre-revisar.png') })
  // El material nuevo: Almacén lo asocia a uno del catálogo.
  const [entrada1, entrada2] = await ventana.locator('input[type="number"]').all()
  await entrada1.fill('3')
  await entrada2.fill('0')
  await ventana.locator(`#rq-mat-${rq2}-2`).click()
  await pagina.getByPlaceholder('Nombre o código del material…').fill(elegido.codigo)
  await pagina.locator('[role="option"]', { hasText: elegido.descripcion }).first().click()
  const conElegido = await ventana.locator('[data-en-el-sistema]').allInnerTexts()
  comprobar(conElegido.length === 2, `al elegir ${elegido.codigo} para el material nuevo, dice su stock: «${conElegido[1] ?? ''}»`)
  await ventana.getByRole('button', { name: 'Guardar la revisión' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
  const lineas = await consulta(`select l.item, l.cantidad_en_stock::numeric as en_stock, m.codigo, r.estado from public.requerimiento_lineas l
                                   join public.requerimientos r on r.id = l.requerimiento_id left join public.materiales m on m.id = l.material_id
                                  where l.requerimiento_id = $1 order by l.item`, [rq2])
  comprobar(lineas[0]?.estado === 'SIN_STOCK' && Number(lineas[0]?.en_stock) === 3 && Number(lineas[1]?.en_stock) === 0,
    `${N2} pasa a compra con 3 separados y 0 del nuevo (base: ${JSON.stringify(lineas)})`)
  comprobar(lineas[1]?.codigo === elegido.codigo,
    `el material nuevo queda con el del catálogo que eligió Almacén, ${elegido.codigo} (base: ${lineas[1]?.codigo})`)
  // RQ3 es del mismo código que RQ1: lo de RQ1 sale aparte, y pedir más de lo que hay avisa.
  await ir(pagina, '/requerimientos/atencion')
  await filaRq(N3).getByRole('button', { name: 'Revisar stock' }).click()
  await ventana.waitFor()
  const principal = await texto(ventana.locator('[data-en-el-sistema]').first())
  const mismo = await texto(ventana.locator('[data-mismo-codigo]').first()).catch(() => '')
  comprobar(principal === `En el sistema hay ${fmt(E)} ${U}: ${fmt(E - 7)} libres · 3 separados para otros códigos (${CODIGO_B}: 3)`,
    `${N3}: lo de otros códigos, sin el suyo: «${principal}»`)
  comprobar(mismo === `4 ${U} ya están separados para ${CODIGO_A}, el código de este RQ, en ${N1}: si es el mismo pedido, no los separes otra vez.`,
    `${N3}: lo de su mismo código, aparte: «${mismo}»`)
  comprobar((await ventana.locator('[data-separa-de-mas]').count()) === 0, 'sin anotar nada, no avisa')
  // Lo que separó RQ1 para el mismo código es de RQ1: a RQ3 solo le sirve lo libre.
  const tienes = ventana.locator('input[type="number"]').first()
  await tienes.fill(String(E - 7))
  comprobar((await ventana.locator('[data-separa-de-mas]').count()) === 0, `anotar ${E - 7}, lo libre, no avisa`)
  await tienes.fill(String(E - 7 + 1))
  const aviso = await texto(ventana.locator('[data-separa-de-mas]').first()).catch(() => '')
  comprobar(aviso === `El sistema tiene ${fmt(E - 7)} ${U} para este RQ: revisa antes de separar más.`,
    `anotar ${E - 7 + 1} (uno de los que ya son de ${N1}) avisa: «${aviso}»`)
  const describe = await tienes.getAttribute('aria-describedby')
  comprobar(Boolean(describe) && (await ventana.locator(`[id="${describe}"]`).getAttribute('aria-live')) === 'polite',
    'el aviso está atado al campo y lo anuncia el lector de pantalla')
  await pagina.screenshot({ path: join(CAPTURAS, 'stock-libre-mismo-codigo.png') })
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  comprobar((await consulta('select estado from public.requerimientos where id = $1', [rq3]))[0].estado === 'POR_ATENDER', `${N3} sigue por atender`)
  comprobar(errores.length === 0, `sin errores de consola como Almacén ${errores.join(' | ')}`)

  const s = await filaDelStock(pagina)
  comprobar(s.libre === E - 7, `en «Stock en almacén», libre ${s.libre} de ${E}: «${s.texto}»`)
  comprobar((await pagina.getByRole('link', { name: 'Abrir el kardex' }).count()) === 1, 'Almacén tiene el enlace a su kardex')
  await contexto.close()
}

// La base dice lo mismo que la pantalla, con el rol de cada uno.
const despues = await stockComo(CUENTAS.requerimientos)
comprobar(Number(despues.libre) === E - 7 && Number(despues.separado) === 7,
  `la base, como Requerimientos: libre ${despues.libre}, separado ${despues.separado} (${JSON.stringify(despues.por_codigo)})`)

// ============================================ 2. Requerimientos y Administración, sin el kardex
for (const [puesto, grupo, migas] of [
  ['requerimientos', 'Consultas', 'Requerimientos'],
  ['administracion', 'Requerimiento de Administración', 'Requerimientos'],
]) {
  const { pagina, contexto, errores } = await entrar(CUENTAS[puesto])
  const items = (await menu(pagina)).find((g) => g.grupo === grupo)?.items ?? []
  comprobar(items.includes('Stock en almacén'), `${puesto}: «Stock en almacén» en «${grupo}»: ${items.join(' · ')}`)
  const s = await filaDelStock(pagina)
  comprobar(s.libre === E - 7, `${puesto} ve libre ${s.libre}`)
  comprobar(s.texto.includes(`${CODIGO_A} 4 ${U} ${N1}`) && s.texto.includes(`${CODIGO_B} 3 ${U} ${N2}`),
    `${puesto} ve cada código con su RQ: «${s.texto}»`)
  comprobar(!/S\/|precio|valor/i.test(await texto(pagina.locator('main'))), `${puesto} no ve precios`)
  const migasTexto = await texto(pagina.locator('nav[aria-label="Ruta de navegación"]').first()).catch(() => '')
  comprobar(migasTexto === `${migas} Stock en almacén`
            && (await pagina.locator('nav[aria-label="Ruta de navegación"] a[href="/requerimientos"]').count()) === 1,
    `${puesto}: vuelve a sus requerimientos desde las migas «${migasTexto}»`)
  comprobar((await pagina.getByRole('link', { name: 'Abrir el kardex' }).count()) === 0, `${puesto}: sin el enlace al kardex`)
  // Por código interno también lo encuentra.
  await ir(pagina, `/almacen/stock?q=${encodeURIComponent(CODIGO_B)}`)
  comprobar((await pagina.locator(`tr[data-material="${material.codigo}"]`).count()) === 1, `${puesto} lo encuentra por el código ${CODIGO_B}`)
  await ir(pagina, '/almacen/kardex')
  const h1 = await texto(pagina.locator('h1').first()).catch(() => '')
  comprobar(h1 !== 'Kardex' && !pagina.url().endsWith('/almacen/kardex'), `${puesto} no abre el kardex (queda en ${pagina.url().replace(BASE, '')} · «${h1}»)`)
  comprobar(errores.length === 0, `sin errores de consola como ${puesto} ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 3. Supervisión sí, Ventas no
{
  const { pagina, contexto } = await entrar(CUENTAS.supervisor)
  const s = await filaDelStock(pagina)
  comprobar(s.libre === E - 7, `el supervisor ve libre ${s.libre}: «${s.texto}»`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.ventas)
  await ir(pagina, '/almacen/stock')
  const h1 = await texto(pagina.locator('h1').first()).catch(() => '')
  comprobar(h1 !== 'Stock en almacén', `Ventas no entra al stock (queda en ${pagina.url().replace(BASE, '')} · «${h1}»)`)
  await contexto.close()
}

// ============================================ 4. En el teléfono
for (const puesto of ['requerimientos', 'almacen']) {
  const { pagina, contexto } = await entrar(CUENTAS[puesto], 390)
  console.log(`    pestañas de ${puesto}: ${(await pestanas(pagina)).join(' · ')}`)
  await filaDelStock(pagina)
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `${puesto} en el teléfono: la página mide ${ancho} px de ancho`)
  const tabla = await pagina.locator('.tabla-con-corte').first().evaluate((t) => ({ contenido: t.scrollWidth, caja: t.clientWidth }))
  comprobar(tabla.contenido <= tabla.caja, `${puesto} en el teléfono: la tabla cabe sin deslizarse (${tabla.contenido} de ${tabla.caja} px)`)
  const debajo = await texto(pagina.locator(`tr[data-material="${material.codigo}"] td`).first())
  comprobar(debajo.includes(CODIGO_A) && debajo.includes(CODIGO_B), `${puesto} en el teléfono: lo separado va debajo del material: «${debajo}»`)
  await pagina.screenshot({ path: join(CAPTURAS, `stock-libre-telefono-${puesto}.png`), fullPage: true })
  await contexto.close()
}

// ============================================ 5. La salida del kardex descuenta bien lo devuelto
// De los 4 de RQ1 salen 3 y vuelven 1 y otra vez 1: lo entregado es 1 y faltan 3.
// Antes la lista contaba la salida una vez por cada devolución (3 + 3 − 2 = 4)
// y el ítem desaparecía de la salida como si ya estuviera entregado. Como
// Almacén, con su sesión; la foto, como dueño (el banco no aplica Storage).
{
  const [{ id: almacenero }] = await consulta('select id::text from public.usuarios where correo = $1', [CUENTAS.almacen])
  const salida = crypto.randomUUID()
  const foto = `${almacenero}/${salida}.jpg`
  await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
                  values ('evidencias-almacen', $1, $2::uuid, $2::text, '{"mimetype":"image/jpeg","size":100}')`, [foto, almacenero])
  const [insumo] = await consulta('select id::text from public.requerimiento_lineas where requerimiento_id = $1 and item = 1', [rq1])
  await como(CUENTAS.almacen, `select public.registrar_salida_material($1, $2, 3, null, null, 'Entrega parcial de la prueba del stock libre', 'Soldador MTZ', $3, $4)`,
    [salida, material.id, foto, insumo.id])
  for (let i = 1; i <= 2; i++) {
    await como(CUENTAS.almacen, `select public.registrar_ingreso_almacen($1, $2, 1, 'DEVOLUCION', $3, null, 'PEN', $4)`,
      [crypto.randomUUID(), material.id, `Devolución ${i} de la prueba del stock libre`, salida])
  }
  const [vista] = await como(CUENTAS.almacen, 'select entregado, pendiente from public.v_rq_lineas_para_salida where linea_id = $1', [insumo.id])
  comprobar(Number(vista?.entregado) === 1 && Number(vista?.pendiente) === 3,
    `la base, como Almacén: ${N1} lleva 1 entregado y faltan 3 (${JSON.stringify(vista)})`)

  const { pagina, contexto } = await entrar(CUENTAS.almacen)
  await ir(pagina, '/almacen/kardex')
  await pagina.getByRole('button', { name: 'Registrar salida' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor()
  await ventana.locator('#sal-rq').click()
  await pagina.getByPlaceholder('Número de RQ, código interno o material').fill(N1)
  const opcion = pagina.locator('[role="option"]', { hasText: N1 }).first()
  const detalle = await texto(opcion).catch(() => '')
  comprobar(detalle.includes(`faltan 3 ${U}`), `en «Registrar salida», ${N1} dice que faltan 3: «${detalle}»`)
  await opcion.click()
  const cantidadSalida = ventana.locator('#sal-cantidad')
  const tope = { valor: await cantidadSalida.inputValue(), max: await cantidadSalida.getAttribute('max') }
  comprobar(tope.valor === '3' && tope.max === '3', `y propone entregar 3, con tope 3 (${JSON.stringify(tope)})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'stock-libre-salida-con-devoluciones.png') })
  await contexto.close()

  const s = await stockComo(CUENTAS.requerimientos)
  comprobar(Number(s.existencia) === E - 1 && Number(s.libre) === E - 7,
    `y el stock: de ${s.existencia} en almacén, los 3 por entregar siguen siendo de ${CODIGO_A}; libre ${s.libre}`)
}

// ============================================ 6. El accesorio que entró para su unidad
// Entran 3 faros marcados para BANCO-C…: son de esa unidad y no están libres,
// pero a un RQ de ese mismo código le sirven. Lo que un RQ toma de ellos ya no
// le sirve al siguiente del mismo código.
{
  const CODIGO_C = `BANCO-C${sufijo}`
  const [faro] = await consulta(`
    insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
    select $1, $2,
           (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1),
           (select id from public.unidades_medida where codigo = 'UND')
    returning id::text, codigo`, [`PRB-SLA-${sufijo}`, `Faro de prueba del stock libre ${sufijo}`])
  await consulta(`
    insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
    select gen_random_uuid(), 'INGRESO', $1::uuid, 3, 'INGRESO_GENERAL', $2, u.id, $4 from public.usuarios u where u.correo = $3`,
    [faro.id, `GR BANCO ${sufijo}-C`, CUENTAS.almacen, CODIGO_C])
  const rq4 = crypto.randomUUID()
  const rq5 = crypto.randomUUID()
  for (const rq of [rq4, rq5]) {
    await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Faros para la prueba del stock libre', null, $4::jsonb)`,
      [rq, areas.PRD, CODIGO_C, JSON.stringify([{ material_id: faro.id, cantidad: 2 }])])
  }
  const N4 = await numero(rq4)
  const N5 = await numero(rq5)

  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  const ventana = pagina.locator('[role="dialog"]')
  const filaRq = (n) => pagina.locator('tr', { hasText: n })
  await ir(pagina, '/requerimientos/atencion')
  await filaRq(N4).getByRole('button', { name: 'Revisar stock' }).click()
  await ventana.waitFor()
  const principal4 = await texto(ventana.locator('[data-en-el-sistema]').first())
  const mismo4 = await texto(ventana.locator('[data-mismo-codigo]').first()).catch(() => '')
  comprobar(principal4 === `En el sistema hay 3 ${U}: nada libre`, `${N4}: «${principal4}»`)
  comprobar(mismo4 === `3 ${U} entraron para ${CODIGO_C}, el código de este RQ: sirven para este pedido.`, `${N4}: «${mismo4}»`)
  await ventana.locator('input[type="number"]').first().fill('2')
  comprobar((await ventana.locator('[data-separa-de-mas]').count()) === 0, `${N4}: anotar 2 de los 3 de su unidad no avisa`)
  await ventana.getByRole('button', { name: 'Guardar la revisión' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
  const [r4] = await consulta(`select r.estado, l.cantidad_en_stock::numeric as en_stock from public.requerimientos r
                                 join public.requerimiento_lineas l on l.requerimiento_id = r.id where r.id = $1`, [rq4])
  comprobar(r4?.estado === 'LISTO_EN_ALMACEN' && Number(r4?.en_stock) === 2, `${N4} queda listo con 2 de su unidad (base: ${JSON.stringify(r4)})`)

  await ir(pagina, '/requerimientos/atencion')
  await filaRq(N5).getByRole('button', { name: 'Revisar stock' }).click()
  await ventana.waitFor()
  const mismo5 = await texto(ventana.locator('[data-mismo-codigo]').first()).catch(() => '')
  comprobar(mismo5 === `3 ${U} son de ${CODIGO_C}, el código de este RQ: 2 ya separados en ${N4}; 1 entró para la unidad y sirve para este pedido.`,
    `${N5}: «${mismo5}»`)
  const tienes = ventana.locator('input[type="number"]').first()
  await tienes.fill('1')
  comprobar((await ventana.locator('[data-separa-de-mas]').count()) === 0, `${N5}: anotar el 1 que queda no avisa`)
  await tienes.fill('2')
  const aviso = await texto(ventana.locator('[data-separa-de-mas]').first()).catch(() => '')
  comprobar(aviso === `El sistema tiene 1 ${U} para este RQ: revisa antes de separar más.`, `${N5}: anotar 2 avisa: «${aviso}»`)
  await pagina.screenshot({ path: join(CAPTURAS, 'stock-libre-accesorio.png') })
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  comprobar(errores.length === 0, `sin errores de consola con el accesorio ${errores.join(' | ')}`)
  await contexto.close()

  // Quien pide para ese código ve en el stock que 1 sigue para la unidad, sin RQ.
  {
    const { pagina, contexto } = await entrar(CUENTAS.requerimientos)
    await ir(pagina, `/almacen/stock?q=${encodeURIComponent(faro.codigo)}`)
    const fila = pagina.locator(`tr[data-material="${faro.codigo}"]`)
    const deLaUnidad = await texto(fila.locator('[data-para-la-unidad]:visible').first()).catch(() => '')
    comprobar(deLaUnidad === `1 ${U} para la unidad, sin RQ`, `Requerimientos ve en el stock lo de la unidad aparte: «${deLaUnidad}»`)
    await contexto.close()
  }

  const [s] = await como(CUENTAS.requerimientos,
    'select existencia, separado, libre, por_codigo from public.stock_libre_en_almacen(array[$1::uuid])', [faro.id])
  comprobar(Number(s.existencia) === 3 && Number(s.separado) === 3 && Number(s.libre) === 0
    && s.por_codigo.length === 1 && s.por_codigo[0].codigo === CODIGO_C && Number(s.por_codigo[0].cantidad) === 3
    && Number(s.por_codigo[0].de_requerimientos) === 2 && s.por_codigo[0].requerimientos.join() === N4,
    `la base, como Requerimientos: los 3 faros son de ${CODIGO_C}, 2 de ellos ya de ${N4} (${JSON.stringify(s)})`)
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
