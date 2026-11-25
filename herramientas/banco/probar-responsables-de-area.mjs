/**
 * Clic real sobre «Responsables de área» (migración 20261125205000, entrega A.0
 * del plan de las demás áreas): el responsable de cada área es una cuenta.
 *
 * El administrador del sistema abre Configuración, asigna la cuenta responsable
 * de un área, la cambia y la quita, y después de cada clic se mira la base. La
 * cuenta que se dio de baja mientras él tenía la pantalla abierta no entra, y
 * lo dice la fila. Diseño, que entra a Configuración por las plantillas, no ve
 * la tarjeta; Gerencia no entra a Configuración; y ninguno de los dos cambia el
 * responsable aunque llame a la base por su cuenta.
 *
 * Deja la base como la encontró. Variables: BANCO_CLAVE, BASE
 * (http://localhost:3111), BANCO_BASE (mw_demo), BANCO_ADMIN (si no se da, la
 * cuenta ADMIN activa del banco), BANCO_CHROMIUM, CAPTURAS.
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
  // Sin BANCO_ADMIN se lee de la base: el repositorio es público y no nombra cuentas reales.
  admin: process.env.BANCO_ADMIN,
  diseno: 'diseno.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
  // Las dos que se asignan: una que queda y una que se da de baja a medio camino.
  supervisor: 'sup.prd.local@metalwork.test',
  almacen: 'almacen.local@metalwork.test',
}
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const base = new pg.Client({ host: '/tmp', port: 5433, user: 'postgres', database: process.env.BANCO_BASE ?? 'mw_demo' })
await base.connect()

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const una = async (sql, valores = []) => (await base.query(sql, valores)).rows[0]
// Las pantallas nombran la cuenta por su puesto (migración 109), no por la persona.
const cuenta = async (correo) => una('select u.id, public.puesto(u) as puesto from public.usuarios u where lower(u.correo) = lower($1)', [correo])
const area = async (codigo) =>
  una('select a.id, a.nombre, a.encargado, a.jefe_id from public.areas a where a.codigo = $1', [codigo])

CUENTAS.admin ??= (
  await una(
    `select u.correo from public.usuarios u join public.roles r on r.id = u.rol_id
      where r.codigo = 'ADMIN' and u.activo order by u.creado_en limit 1`,
  )
)?.correo
const admin = CUENTAS.admin && (await cuenta(CUENTAS.admin))
const supervisor = await cuenta(CUENTAS.supervisor)
const almacen = await cuenta(CUENTAS.almacen)
if (!admin || !supervisor || !almacen) {
  console.error('Faltan las cuentas del banco: corre herramientas/banco/preparar.sh.')
  process.exit(1)
}

// Cómo estaban las dos áreas que se tocan, para dejarlas igual al final.
const ANTES = { CAL: await area('CAL'), MKT: await area('MKT') }
// La base es compartida (los auditores la usan a la vez): si la prueba se corta
// a medio camino, deja igual las dos cuentas que da de baja y las dos áreas.
async function dejarComoEstaba() {
  await base.query('rollback').catch(() => {})
  for (const c of [almacen, supervisor]) await activar(c.id, true).catch(() => {})
  for (const a of [ANTES.CAL, ANTES.MKT])
    await base.query('update public.areas set jefe_id = $2 where id = $1', [a.id, a.jefe_id]).catch(() => {})
}
process.on('uncaughtException', async (error) => {
  console.error(error)
  await dejarComoEstaba()
  process.exit(1)
})
// El administrador da de baja o de alta una cuenta: `fn_usuario_proteger_rol` pide su sesión.
async function activar(id, activo) {
  await base.query('begin')
  await base.query(`select set_config('request.jwt.claim.sub', $1, true)`, [admin.id])
  await base.query('update public.usuarios set activo = $2 where id = $1', [id, activo])
  await base.query('commit')
}
// Lo que haría la acción de servidor, con la sesión de esa cuenta y el RLS puesto.
async function cambiarPorLaBase(usuarioId, areaId, jefeId) {
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true)`, [usuarioId])
    await base.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: usuarioId, role: 'authenticated' })])
    await base.query('set local role authenticated')
    return (await base.query('update public.areas set jefe_id = $2 where id = $1', [areaId, jefeId])).rowCount
  } finally {
    await base.query('rollback')
  }
}
await base.query('update public.areas set jefe_id = null where codigo in ($1, $2)', ['CAL', 'MKT'])

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, viewport = { width: 1440, height: 900 }, tactil = false) {
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima', hasTouch: tactil, isMobile: tactil })
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

const TARJETA = '#responsables'
const fila = (pagina, nombre) =>
  pagina.locator(`${TARJETA} li`).filter({ has: pagina.getByText(nombre, { exact: true }) })
const textoDe = async (localizador) => (await localizador.innerText()).replace(/\s+/g, ' ')
const nombreDe = (c) => c.puesto
const resumenDe = (pagina) => textoDe(pagina.locator(TARJETA).getByText(/áreas tienen? (su )?cuenta responsable/))
// Lo que tiene que decir la cabecera con `con` de `total` áreas con cuenta activa.
const resumenEsperado = (con, total) =>
  con === 0 ? `Ninguna de las ${total} áreas tiene cuenta responsable todavía` : `${con} de ${total} áreas tienen cuenta responsable`

/** Abre la ventana de un área con su botón («Asignar» o «Cambiar») y la devuelve. */
async function abrir(pagina, nombre) {
  await fila(pagina, nombre).getByRole('button', { name: new RegExp(`la cuenta responsable de ${nombre}$`) }).click()
  const ventana = pagina.getByRole('dialog', { name: `Responsable de ${nombre}` })
  await ventana.waitFor({ timeout: 15000 })
  return ventana
}

// ============================================================ el administrador
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.admin)
  await pagina.goto(`${BASE}/configuracion`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator(TARJETA)
  await tarjeta.waitFor({ timeout: 15000 })
  comprobar(await tarjeta.getByRole('heading', { name: 'Responsables de área' }).isVisible(), 'el administrador ve «Responsables de área» en Configuración')

  const { total, con } = await una(
    `select count(*)::int as total,
            count(*) filter (where exists (select 1 from public.usuarios u where u.id = a.jefe_id and u.activo))::int as con
       from public.areas a where a.activo`,
  )
  const filas = await tarjeta.locator('li').count()
  comprobar(filas === total, `la lista trae las ${total} áreas activas de la base (${filas} filas)`)
  const resumen = await resumenDe(pagina)
  comprobar(resumen.includes(resumenEsperado(con, total)), `el resumen cuenta las que tienen: «${resumen}»`)

  const calidad = fila(pagina, 'Calidad')
  comprobar((await textoDe(calidad)).includes('Sin cuenta'), 'Calidad dice «Sin cuenta» y ofrece «Asignar»')
  const rrh = await area('RRH')
  comprobar(
    !rrh.encargado || (await textoDe(fila(pagina, 'Recursos Humanos'))).includes(`En el organigrama: ${rrh.encargado}`),
    `Recursos Humanos conserva el nombre del organigrama (${rrh.encargado ?? 'sin nombre'})`,
  )
  await pagina.screenshot({ path: join(CAPTURAS, 'a0-configuracion-1440-antes.png'), fullPage: true })

  // --- asignar
  let ventana = await abrir(pagina, 'Calidad')
  comprobar(
    (await ventana.getByRole('combobox', { name: 'Cuenta responsable' }).inputValue()) === '',
    'la ventana de Calidad abre con «Sin cuenta responsable»',
  )
  await ventana.getByRole('combobox', { name: 'Cuenta responsable' }).selectOption(supervisor.id)
  await pagina.screenshot({ path: join(CAPTURAS, 'a0-ventana-1440.png') })
  // Tres toques seguidos: un solo envío, con el botón trabado.
  const { ultimo } = await una('select coalesce(max(id), 0)::text as ultimo from public.audit_log')
  const guardar = ventana.getByRole('button', { name: 'Guardar' })
  // Una acción de servidor es un POST con la cabecera `next-action`: se cuentan
  // los envíos, porque la auditoría no anota un UPDATE que deja la fila igual.
  let envios = 0
  const contarEnvio = (q) => {
    if (q.method() === 'POST' && q.headers()['next-action']) envios++
  }
  pagina.on('request', contarEnvio)
  await guardar.click()
  await guardar.click({ force: true, timeout: 1000 }).catch(() => {})
  await guardar.click({ force: true, timeout: 1000 }).catch(() => {})
  await ventana.waitFor({ state: 'detached', timeout: 15000 })
  await calidad.getByText(nombreDe(supervisor)).waitFor({ timeout: 15000 })
  comprobar((await area('CAL')).jefe_id === supervisor.id, 'en la base, la cuenta responsable de Calidad es la que se eligió')
  comprobar((await area('CAL')).encargado === ANTES.CAL.encargado, 'el texto del organigrama de Calidad no cambió')
  comprobar(!(await textoDe(calidad)).includes('Sin cuenta'), `la fila de Calidad muestra a ${nombreDe(supervisor)} y ya no dice «Sin cuenta»`)
  comprobar(
    (await calidad.getByRole('status').textContent()).includes('Calidad ya tiene su cuenta responsable.'),
    'y lo anuncia para el lector de pantalla',
  )
  const resumenDespues = await resumenDe(pagina)
  comprobar(resumenDespues.includes(resumenEsperado(con + 1, total)), `el resumen sube a ${con + 1}: «${resumenDespues}»`)
  const { responsable } = await una(`select public.responsable_del_area('CAL') as responsable`)
  comprobar(responsable === supervisor.id, 'responsable_del_area(«CAL») da esa cuenta')
  const cambios = await una(
    `select count(*)::int as n from public.audit_log where tabla = 'areas' and registro_id = $1 and id > $2::bigint`,
    [ANTES.CAL.id, ultimo],
  )
  pagina.off('request', contarEnvio)
  comprobar(envios === 1, `los tres toques salieron como un solo envío (${envios})`)
  comprobar(cambios.n === 1, `y un solo cambio en la auditoría (${cambios.n})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'a0-configuracion-1440-asignado.png'), fullPage: true })

  // --- recargar: lo guardado sigue ahí
  await pagina.reload({ waitUntil: 'networkidle' })
  ventana = await abrir(pagina, 'Calidad')
  comprobar(
    (await ventana.getByRole('combobox', { name: 'Cuenta responsable' }).inputValue()) === supervisor.id,
    'al recargar, la ventana de Calidad trae elegida su cuenta',
  )
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 15000 })

  // --- la cuenta que se da de baja con la pantalla abierta no entra
  ventana = await abrir(pagina, 'Marketing')
  await activar(almacen.id, false)
  await ventana.getByRole('combobox', { name: 'Cuenta responsable' }).selectOption(almacen.id)
  await ventana.getByRole('button', { name: 'Guardar' }).click()
  const alerta = ventana.getByRole('alert')
  await alerta.waitFor({ timeout: 15000 })
  const rechazo = await textoDe(alerta)
  comprobar(rechazo.includes('se dio de baja hace un momento'), `la cuenta dada de baja no entra y la ventana dice por qué: «${rechazo}»`)
  const lista = ventana.getByRole('combobox', { name: 'Cuenta responsable' })
  comprobar((await lista.getAttribute('aria-invalid')) === 'true', 'el rechazo marca el campo «Cuenta responsable», no solo el pie')
  // La lista se pone al día y deja de ofrecer la cuenta dada de baja.
  await pagina.waitForFunction(
    ([id]) => !document.querySelector(`[role="dialog"] select option[value="${id}"]`),
    [almacen.id],
    { timeout: 15000 },
  ).catch(() => {})
  comprobar((await lista.locator(`option[value="${almacen.id}"]`).count()) === 0, 'la ventana ya no ofrece la cuenta dada de baja')
  await pagina.waitForTimeout(300)
  comprobar(
    await lista.evaluate((el) => document.activeElement === el),
    'el cursor queda en el campo para elegir otra cuenta',
  )
  comprobar((await area('MKT')).jefe_id === null, 'en la base, Marketing sigue sin cuenta')
  await activar(almacen.id, true)
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 15000 })
  ventana = await abrir(pagina, 'Marketing')
  comprobar((await ventana.getByRole('alert').count()) === 0, 'vuelta a abrir, la ventana de Marketing no arrastra el rechazo de antes')
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 15000 })

  // --- el mismo rechazo en un área que ya tiene responsable: el campo vuelve
  // a lo guardado, y otro «Guardar» no se lo lleva
  await pagina.reload({ waitUntil: 'networkidle' })
  ventana = await abrir(pagina, 'Calidad')
  await activar(almacen.id, false)
  await ventana.getByRole('combobox', { name: 'Cuenta responsable' }).selectOption(almacen.id)
  await ventana.getByRole('button', { name: 'Guardar' }).click()
  await ventana.getByRole('alert').waitFor({ timeout: 15000 })
  await pagina
    .waitForFunction(([id]) => !document.querySelector(`[role="dialog"] select option[value="${id}"]`), [almacen.id], { timeout: 15000 })
    .catch(() => {})
  comprobar(
    (await ventana.getByRole('combobox', { name: 'Cuenta responsable' }).inputValue()) === supervisor.id,
    'tras el rechazo, el campo de Calidad vuelve a su cuenta guardada, no a «Sin cuenta responsable»',
  )
  await ventana.getByRole('button', { name: 'Guardar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 15000 })
  comprobar((await area('CAL')).jefe_id === supervisor.id, 'y otro «Guardar» no le quita el responsable')
  await activar(almacen.id, true)
  await pagina.reload({ waitUntil: 'networkidle' })

  // --- la cuenta que se da de baja después de asignada: la fila lo dice
  await activar(supervisor.id, false)
  await pagina.reload({ waitUntil: 'networkidle' })
  const textoDeBaja = await textoDe(fila(pagina, 'Calidad'))
  comprobar(textoDeBaja.includes('Cuenta dada de baja') && textoDeBaja.includes('ya no responde por el área'), 'con la cuenta dada de baja, Calidad lo dice y pide elegir otra')
  comprobar((await una(`select public.responsable_del_area('CAL') as r`)).r === null, 'y responsable_del_area(«CAL») ya no la da')
  const resumenDeBaja = await resumenDe(pagina)
  comprobar(resumenDeBaja.includes(resumenEsperado(con, total)), `el resumen no la cuenta: «${resumenDeBaja}»`)
  ventana = await abrir(pagina, 'Calidad')
  comprobar(
    (await textoDe(ventana.getByRole('combobox', { name: 'Cuenta responsable' }).locator('option:checked'))).includes('(dada de baja)'),
    'la ventana muestra la cuenta guardada como dada de baja',
  )
  // «Guardar» sin cambiarla no es «listo»: esa cuenta no responde por nada.
  await ventana.getByRole('button', { name: 'Guardar' }).click()
  await ventana.getByRole('alert').waitFor({ timeout: 15000 })
  comprobar(
    (await textoDe(ventana.getByRole('alert'))).includes('se dio de baja'),
    'guardar la cuenta dada de baja sin cambiarla se rechaza junto al campo',
  )
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 15000 })
  await activar(supervisor.id, true)
  await pagina.reload({ waitUntil: 'networkidle' })
  ventana = await abrir(pagina, 'Calidad')

  // --- cambiar por otra y quitar
  await ventana.getByRole('combobox', { name: 'Cuenta responsable' }).selectOption(almacen.id)
  await ventana.getByRole('button', { name: 'Guardar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 15000 })
  await fila(pagina, 'Calidad').getByText(nombreDe(almacen)).waitFor({ timeout: 15000 })
  comprobar((await area('CAL')).jefe_id === almacen.id, `el administrador la cambia por otra cuenta (${nombreDe(almacen)})`)
  ventana = await abrir(pagina, 'Calidad')
  await ventana.getByRole('combobox', { name: 'Cuenta responsable' }).selectOption('')
  await ventana.getByRole('button', { name: 'Guardar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 15000 })
  await fila(pagina, 'Calidad').getByText('Sin cuenta', { exact: true }).waitFor({ timeout: 15000 })
  comprobar((await area('CAL')).jefe_id === null, 'y la quita: Calidad vuelve a «Sin cuenta»')

  // --- Escape cierra la ventana sin guardar y el cursor vuelve a su botón
  ventana = await abrir(pagina, 'Calidad')
  await ventana.getByRole('combobox', { name: 'Cuenta responsable' }).selectOption(supervisor.id)
  await pagina.keyboard.press('Escape')
  await ventana.waitFor({ state: 'detached', timeout: 15000 })
  comprobar((await area('CAL')).jefe_id === null, 'Escape cierra la ventana sin guardar nada')
  const conCursor = await pagina.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
  comprobar(conCursor === 'Asignar la cuenta responsable de Calidad', `y el cursor vuelve al botón que la abrió («${conCursor}»)`)

  comprobar(errores.length === 0, `sin errores de consola como administrador ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================================ en el teléfono
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.admin, { width: 390, height: 844 }, true)
  await pagina.goto(`${BASE}/configuracion`, { waitUntil: 'networkidle' })
  await pagina.locator(TARJETA).scrollIntoViewIfNeeded()
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `en el teléfono la página no se sale por el costado (${ancho} px de 390)`)
  const boton = await fila(pagina, 'Calidad').getByRole('button', { name: 'Asignar la cuenta responsable de Calidad' }).boundingBox()
  comprobar(boton.height >= 44, `«Asignar» se acierta con el dedo (${Math.round(boton.height)} px de alto)`)
  await pagina.locator(TARJETA).screenshot({ path: join(CAPTURAS, 'a0-responsables-390.png') })

  // Asignar y quitar desde el teléfono, con toque.
  let ventana = await abrir(pagina, 'Calidad')
  const selector = await ventana.getByRole('combobox', { name: 'Cuenta responsable' }).boundingBox()
  const guardar = await ventana.getByRole('button', { name: 'Guardar' }).boundingBox()
  comprobar(selector.height >= 44 && guardar.height >= 44 && guardar.y + guardar.height <= 844, `en la ventana, el selector y «Guardar» se aciertan con el dedo y quedan a la vista (${Math.round(selector.height)} y ${Math.round(guardar.height)} px)`)
  await ventana.getByRole('combobox', { name: 'Cuenta responsable' }).selectOption(supervisor.id)
  await pagina.screenshot({ path: join(CAPTURAS, 'a0-ventana-390.png') })
  await ventana.getByRole('button', { name: 'Guardar' }).tap()
  await ventana.waitFor({ state: 'detached', timeout: 15000 })
  await fila(pagina, 'Calidad').getByText(nombreDe(supervisor)).waitFor({ timeout: 15000 })
  comprobar((await area('CAL')).jefe_id === supervisor.id, 'desde el teléfono, el administrador asigna la cuenta de Calidad')
  await pagina.locator(TARJETA).screenshot({ path: join(CAPTURAS, 'a0-responsables-390-asignado.png') })
  ventana = await abrir(pagina, 'Calidad')
  await ventana.getByRole('combobox', { name: 'Cuenta responsable' }).selectOption('')
  await ventana.getByRole('button', { name: 'Guardar' }).tap()
  await ventana.waitFor({ state: 'detached', timeout: 15000 })
  await fila(pagina, 'Calidad').getByText('Sin cuenta', { exact: true }).waitFor({ timeout: 15000 })
  comprobar((await area('CAL')).jefe_id === null, 'y la vuelve a quitar')
  comprobar(errores.length === 0, `sin errores de consola en el teléfono ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================================ los que no
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.diseno)
  await pagina.goto(`${BASE}/configuracion`, { waitUntil: 'networkidle' })
  comprobar(pagina.url().endsWith('/configuracion'), 'Diseño abre Configuración, por sus plantillas')
  comprobar((await pagina.locator(TARJETA).count()) === 0, 'y no ve «Responsables de área»')
  comprobar(errores.length === 0, `sin errores de consola como Diseño ${errores.join(' | ')}`)
  await contexto.close()

  const diseno = await cuenta(CUENTAS.diseno)
  const filas = await cambiarPorLaBase(diseno.id, ANTES.CAL.id, diseno.id)
  comprobar(filas === 0 && (await area('CAL')).jefe_id === null, 'aunque llame a la base, Diseño no cambia el responsable: cero filas')
}
{
  const { pagina, contexto } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/configuracion`, { waitUntil: 'networkidle' })
  comprobar(pagina.url().includes('/sin-permiso'), 'Gerencia no entra a Configuración')
  await contexto.close()

  const gerencia = await cuenta(CUENTAS.gerencia)
  const filas = await cambiarPorLaBase(gerencia.id, ANTES.CAL.id, gerencia.id)
  comprobar(filas === 0, 'ni cambia el responsable por la base: cero filas')
}

// La base queda como estaba.
await dejarComoEstaba()

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} comprobación(es) fallaron.` : '\nTodo bien: el administrador asigna la cuenta responsable de cada área y nadie más la cambia.')
process.exit(fallas.length ? 1 : 0)
