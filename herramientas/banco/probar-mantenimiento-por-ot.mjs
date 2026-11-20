/**
 * Recorre con clic real lo que pidió el área de Requerimientos el 2026-11-20
 * (migración 20261120500000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Requerimientos, en el celular: con el motivo «Mantenimiento» la ventana
 *      del ingreso pide el N.º de la OT de mantenimiento, no un código interno.
 *      La OT del banco no tiene unidad: pide la placa y el vehículo, y el
 *      ingreso queda con el código «OT 9455-AAAA». La salida queda apagada y
 *      dice que espera a Administración, sin hablar del avance.
 *   2. Administración da por terminado el mantenimiento desde la OT: la OT no
 *      cambia de estado y a Requerimientos le llega el aviso.
 *   3. Requerimientos ve el mantenimiento terminado, falta Tesorería.
 *   4. Requerimientos, en el monitor, abre un RQ: el buscador de código ofrece
 *      «OT 9455-AAAA» con «Mantenimiento», y en el insumo el grupo «NIPLERÍA»
 *      muestra todos los insumos de niplería del catálogo, y el de «SISTEMA
 *      ELECTRICO», los suyos. El RQ entra con el código de la OT.
 *
 * El visto de Tesorería y la salida los prueba la base en el check 455.
 *
 * Arma, como dueño de la base del banco, la OT de mantenimiento 9455-AAAA sin
 * unidad, aprobada, del primer cliente. Si una vuelta anterior la dio por
 * terminada, quita esa marca y anula el ingreso que quedó en la planta (es la
 * base local del banco).
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE, CAPTURAS.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
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

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const sinTildes = (t) => (t ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase()

// ------------------------------------------------------------ armazón
const anio = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric' }).format(new Date())
const NUMERO = `9455-${anio}`
const CODIGO_OT = `OT ${NUMERO}`
const PLACA = 'BMT-455'
const [cliente] = await consulta(
  `select c.id, c.razon_social, (select o.sede_id from public.ordenes_trabajo o limit 1) as sede_id
     from public.clientes c order by c.creado_en limit 1`,
)
if (!cliente?.sede_id) throw new Error('El banco no tiene clientes ni órdenes: rehaz la base con preparar.sh.')
let [orden] = await consulta(`select id, estado from public.ordenes_trabajo where numero = $1`, [NUMERO])
if (!orden) {
  ;[orden] = await consulta(
    `insert into public.ordenes_trabajo (numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
     values ($1, $2, $3, 'MANTENIMIENTO', 'NORMAL', 'Mantenimiento del banco: frenos y luces', 'APROBADA') returning id, estado`,
    [NUMERO, cliente.id, cliente.sede_id],
  )
}
await consulta(`delete from public.ot_garantia_terminada where orden_id = $1`, [orden.id])
await consulta(
  `update public.registro_vehiculos set anulado_en = now(), anulado_por = ingreso_por, motivo_anulacion = 'Vuelta anterior del banco'
    where (orden_id = $1 or placa = $2) and salida_en is null and anulado_en is null`,
  [orden.id, PLACA.replace('-', '')],
)
const [req] = await consulta(`select id from public.usuarios where correo = $1`, [CUENTAS.requerimientos])
// Lo de esta corrida, aunque otra haya dejado un RQ igual hace un minuto.
const [{ inicio }] = await consulta(`select now() as inicio`)
const [adm] = await consulta(`select id from public.usuarios where correo = $1`, [CUENTAS.administracion])
const [{ niples }] = await consulta(
  `select count(*)::int as niples from public.materiales m join public.categorias_material c on c.id = m.categoria_id
    where m.activo and c.activo and c.codigo like 'ALM\\_%' and (split_part(m.codigo, '-', 2) = 'NI' or m.descripcion ~* '^\\s*NIPLES?\\M')`,
)
const [{ electricos }] = await consulta(
  `select count(*)::int as electricos from public.materiales m join public.categorias_material c on c.id = m.categoria_id
    where m.activo and c.activo and upper(public.unaccent(c.nombre)) = 'SISTEMA ELECTRICO'`,
)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima' })
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

// Una foto chica basta: aquí no se prueba el achicado.
const fotos = join(CAPTURAS, 'fotos-mantenimiento')
mkdirSync(fotos, { recursive: true })
{
  const p = await (await navegador.newContext()).newPage()
  const datos = await p.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 640
    c.height = 480
    const g = c.getContext('2d')
    g.fillStyle = '#7a8'
    g.fillRect(0, 0, 640, 480)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
    const b = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(s)
  })
  writeFileSync(join(fotos, 'entra.jpg'), Buffer.from(datos, 'base64'))
  await p.context().close()
}

let registroId = null

// ---------------------------------------- 1. Requerimientos registra el ingreso por la OT
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos, CELULAR)
  await pagina.goto(`${BASE}/vehiculos`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('#veh-motivo').selectOption('MANTENIMIENTO')
  comprobar((await v.locator('#veh-codigo').count()) === 0, 'por mantenimiento no se pide el código interno')
  await v.locator('#veh-orden').click()
  await v.getByRole('listbox').getByRole('option').first().waitFor({ timeout: 10000 }).catch(() => {})
  const ofrecidas = (await v.getByRole('listbox').getByRole('option').allInnerTexts()).map(limpio)
  const nuestra = ofrecidas.find((o) => o.includes(NUMERO))
  comprobar(Boolean(nuestra) && nuestra.includes(cliente.razon_social), `se ofrece la OT por su número, con su cliente («${nuestra}»)`)
  await v.getByRole('option', { name: new RegExp(NUMERO) }).click()
  const resumen = limpio(await v.locator(`[data-ot-elegida="${NUMERO}"]`).innerText())
  comprobar(resumen.includes('no tiene su unidad registrada') && resumen.includes(CODIGO_OT), `la OT sin unidad lo dice: «${resumen}»`)
  await pagina.screenshot({ path: join(CAPTURAS, 'mantenimiento-1-ventana.png'), fullPage: true })
  // Sin la placa ni el chasis la base no lo deja entrar: se anota.
  await v.locator('#veh-placa').fill(PLACA)
  await v.locator('#veh-unidad').fill('Camioneta Toyota Hilux')
  await v.locator('#veh-obs').fill('Llega por frenos')
  await v.locator('input[type="file"]:not([capture])').setInputFiles(join(fotos, 'entra.jpg'))
  await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
  await v.getByRole('button', { name: 'Registrar ingreso' }).click()
  await pagina.locator('[role="status"]').filter({ hasText: /\S/ }).first().waitFor({ timeout: 20000 })

  const [reg] = await consulta(
    `select id, codigo_interno, placa, unidad, empresa, unidad_id from public.registro_vehiculos
      where orden_id = $1 and salida_en is null and anulado_en is null`,
    [orden.id],
  )
  registroId = reg?.id ?? null
  comprobar(reg?.codigo_interno === CODIGO_OT && reg?.placa === PLACA.replace('-', '') && reg?.unidad === 'Camioneta Toyota Hilux'
    && reg?.empresa === cliente.razon_social && reg?.unidad_id === null,
    `en la base: con el código de la OT, la placa, el vehículo y el cliente de la OT (${JSON.stringify(reg)})`)

  await pagina.reload({ waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: CODIGO_OT })
  await fila.first().waitFor({ timeout: 15000 }).catch(() => {})
  comprobar(await fila.getByRole('button', { name: 'Marcar salida' }).isDisabled(), 'en la lista, «Marcar salida» queda apagado')
  const porque = limpio(await fila.locator('[data-bloqueo-salida]').innerText().catch(() => ''))
  comprobar(porque.includes('Administración todavía no da por terminado el mantenimiento') && !porque.includes('%'),
    `y dice que espera a Administración, sin hablar del avance: «${porque}»`)
  const situacion = limpio(await fila.locator('[data-garantia-salida]:visible').first().innerText().catch(() => ''))
  comprobar(situacion.includes(`Mantenimiento OT ${NUMERO}`) && situacion.includes('por terminar') && (await fila.locator('[data-avance-salida]').count()) === 0,
    `la fila muestra el mantenimiento en vez del avance: «${situacion}»`)
  await pagina.screenshot({ path: join(CAPTURAS, 'mantenimiento-2-lista.png'), fullPage: true })

  // Otra vez la ventana: la OT que ya está en la planta no se ofrece.
  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click()
  await v.locator('#veh-motivo').selectOption('MANTENIMIENTO')
  const otra = limpio(await v.locator('#veh-orden').innerText().catch(() => ''))
  let siguen = []
  if (!otra.includes('No hay OT')) {
    await v.locator('#veh-orden').click()
    siguen = (await v.getByRole('listbox').getByRole('option').allInnerTexts()).map(limpio)
  }
  comprobar(!siguen.some((o) => o.includes(NUMERO)), `con su vehículo adentro la OT ya no se ofrece («${otra || siguen.join(' | ')}»)`)
  await pagina.keyboard.press('Escape')

  await pagina.goto(`${BASE}/vehiculos/${registroId}`, { waitUntil: 'networkidle' })
  const dato = limpio(await pagina.locator('[data-garantia-salida]').innerText().catch(() => ''))
  comprobar(dato.includes(NUMERO) && dato.includes('mantenimiento por terminar'), `el detalle dice «${dato}»`)
  const revision = limpio(await pagina.locator('#revision-salida').innerText().catch(() => ''))
  comprobar(revision.includes('dé por terminado el mantenimiento'), `la revisión de Tesorería espera el mantenimiento: «${revision.slice(0, 160)}»`)
  comprobar(errores.length === 0, `Requerimientos sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ---------------------------------------- 2. Administración lo da por terminado
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.administracion)
  await pagina.goto(`${BASE}/ordenes/${orden.id}`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('h1').getByText('Mantenimiento por terminar', { exact: true }).count()) === 1,
    'el título lleva la insignia «Mantenimiento por terminar»')
  const boton = pagina.getByRole('button', { name: 'Dar por terminado el mantenimiento' })
  comprobar((await boton.count()) === 1, 'Administración ve el botón «Dar por terminado el mantenimiento»')
  await pagina.screenshot({ path: join(CAPTURAS, 'mantenimiento-3-ot-por-terminar.png'), fullPage: true })
  await boton.click()
  const v = pagina.locator('[role="dialog"]')
  comprobar(limpio(await v.innerText()).includes('Terminar el mantenimiento'), 'la ventana dice que termina el mantenimiento')
  await v.locator('#nota_garantia').fill('Frenos cambiados, avisó Producción')
  const confirmar = v.getByRole('button', { name: 'Dar por terminado', exact: true })
  await Promise.all([1, 2, 3].map(() => confirmar.click({ force: true, timeout: 2000 }).catch(() => {})))
  await pagina.locator('p[role="status"]', { hasText: 'Mantenimiento terminado' }).first().waitFor({ timeout: 20000 })
  const hecho = limpio(await pagina.locator('p[role="status"]', { hasText: 'Mantenimiento terminado' }).innerText().catch(() => ''))
  comprobar(hecho.includes('Frenos cambiados, avisó Producción') && hecho.includes('sale con el visto de Tesorería'), `la OT dice «${hecho}»`)
  comprobar((await pagina.getByRole('button', { name: 'Dar por terminado el mantenimiento' }).count()) === 0, 'y el botón ya no está')
  await pagina.screenshot({ path: join(CAPTURAS, 'mantenimiento-4-ot-terminada.png'), fullPage: true })

  const marcas = await consulta(`select terminada_por, nota from public.ot_garantia_terminada where orden_id = $1`, [orden.id])
  comprobar(marcas.length === 1 && marcas[0].terminada_por === adm.id, `en la base: una marca, de Administración (${marcas.length})`)
  const [despues] = await consulta(`select estado from public.ordenes_trabajo where id = $1`, [orden.id])
  comprobar(despues.estado === orden.estado, `la OT sigue ${despues.estado}`)
  const avisos = await consulta(
    `select ruta from public.notificaciones where usuario_id = $1 and origen_id = $2 and titulo = $3`,
    [req.id, registroId, `El mantenimiento de la OT ${NUMERO} está terminado`],
  )
  comprobar(avisos.length === 1 && avisos[0].ruta === `/vehiculos/${registroId}`, 'a Requerimientos le llega el aviso, con el enlace al vehículo')
  comprobar(errores.length === 0, `Administración sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ---------------------------------------- 3 y 4. Requerimientos: la salida y el RQ
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  await pagina.goto(`${BASE}/vehiculos`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: CODIGO_OT })
  await fila.first().waitFor({ timeout: 15000 }).catch(() => {})
  const situacion = limpio(await fila.locator('[data-garantia-salida]:visible').first().innerText().catch(() => ''))
  comprobar(situacion.includes('terminado, falta Tesorería'), `la fila dice «${situacion}»`)

  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Nuevo requerimiento', exact: true }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('#rq-area').selectOption({ index: 1 })
  const codigo = v.locator('#rq-codigo')
  // Una OT que no existe no se ofrece como código nuevo: el costo iría a un código suelto.
  await codigo.fill('OT 9999-2026')
  await v.getByRole('listbox').waitFor({ timeout: 10000 }).catch(() => {})
  const lista = limpio(await v.getByRole('listbox').innerText().catch(() => ''))
  comprobar(lista.includes('No hay OT abierta de mantenimiento ni de garantía con ese número') && !lista.includes('como código nuevo'),
    `«OT 9999-2026» dice que no hay esa OT y no se ofrece como código nuevo («${lista.slice(0, 120)}»)`)
  await codigo.fill(`ot ${NUMERO.split('-')[0]}`)
  const opcion = v.getByRole('listbox').getByRole('option', { name: new RegExp(NUMERO) })
  await opcion.first().waitFor({ timeout: 10000 }).catch(() => {})
  const textoOpcion = limpio(await opcion.first().innerText().catch(() => ''))
  comprobar(textoOpcion.includes(CODIGO_OT) && textoOpcion.includes('Mantenimiento'), `el buscador de código ofrece la OT de mantenimiento: «${textoOpcion}»`)
  await opcion.first().click()
  comprobar((await codigo.inputValue()) === CODIGO_OT, `y queda elegido ${await codigo.inputValue()}`)
  await v.locator('#rq-justificacion').fill('Cambio de conexiones del mantenimiento')

  // El grupo: NIPLERÍA muestra toda la niplería del catálogo.
  const grupo = v.locator('[id^="rq-grupo-"]').first()
  const grupos = (await grupo.locator('option').allInnerTexts()).map(limpio)
  comprobar(grupos.includes(`NIPLERÍA (${niples})`) && grupos.includes(`SISTEMA ELECTRICO (${electricos})`),
    `el insumo ofrece los grupos con su cuenta (${grupos.filter((g) => /NIPLER|ELECTRICO|NEUMATICO/.test(g)).join(', ')})`)
  await grupo.selectOption({ label: `NIPLERÍA (${niples})` })
  const insumo = v.locator('[id^="rq-mat-"]').first()
  await insumo.click()
  await v.getByRole('listbox').getByRole('option').first().waitFor({ timeout: 10000 }).catch(() => {})
  const deNipleria = (await v.getByRole('listbox').getByRole('option').allInnerTexts()).map(limpio)
  comprobar(deNipleria.length === niples && deNipleria.every((o) => o.includes('NIPLERÍA')),
    `con NIPLERÍA salen sus ${niples} insumos y solo ellos (${deNipleria.length})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'mantenimiento-5-rq-nipleria.png'), fullPage: true })
  const elegido = deNipleria[0]
  await v.getByRole('listbox').getByRole('option').first().click()
  await grupo.selectOption({ label: `SISTEMA ELECTRICO (${electricos})` })
  const tras = limpio(await insumo.innerText())
  comprobar(tras.includes('Elige del grupo') && !tras.includes(elegido.split(' ')[0] + ' ' + (elegido.split(' ')[1] ?? '')),
    `al cambiar de grupo, el niple elegido se suelta («${tras}»)`)
  const soltado = limpio(await v.locator('[role="status"]').filter({ hasText: 'no es de este grupo' }).first().innerText().catch(() => ''))
  comprobar(soltado.includes('elige el insumo otra vez'), `y lo dice debajo del insumo («${soltado}»)`)
  await insumo.click()
  await v.getByRole('listbox').getByRole('option').first().waitFor({ timeout: 10000 }).catch(() => {})
  const electricas = (await v.getByRole('listbox').getByRole('option').allInnerTexts()).map(limpio)
  // «SISTEMA ELECTRICO» y «Sistema eléctrico» son un solo grupo: salen los de las dos.
  comprobar(electricas.length === electricos && electricas.every((o) => sinTildes(o).includes('SISTEMA ELECTRICO')),
    `con SISTEMA ELECTRICO salen sus ${electricos} insumos, también los de «Sistema eléctrico» (${electricas.length})`)
  await v.getByRole('listbox').getByRole('option').first().click()
  await v.locator('[id^="rq-cant-"]').first().fill('2')
  await v.getByRole('button', { name: 'Registrar y mandar a Almacén' }).click()
  await pagina.locator('[role="status"]').filter({ hasText: /RQ/ }).first().waitFor({ timeout: 20000 }).catch(() => {})
  const rqs = await consulta(
    `select r.numero, r.codigo_interno, c.nombre as categoria from public.requerimientos r
       join public.requerimiento_lineas l on l.requerimiento_id = r.id
       join public.materiales m on m.id = l.material_id join public.categorias_material c on c.id = m.categoria_id
      where r.creado_por = $1 and r.codigo_interno = $2 and r.creado_en > $3`,
    [req.id, CODIGO_OT, inicio],
  )
  comprobar(rqs.length === 1 && sinTildes(rqs[0].categoria) === 'SISTEMA ELECTRICO', `en la base: el RQ entra con ${CODIGO_OT} y el insumo eléctrico (${JSON.stringify(rqs)})`)
  comprobar(errores.length === 0, `Requerimientos sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallan:\n- ${fallas.join('\n- ')}`)
process.exit(fallas.length === 0 ? 0 : 1)
