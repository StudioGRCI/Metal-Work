/**
 * Clic real sobre «Responsables de área» para la entrega A.4 del plan de las
 * demás áreas (migración 20261126998500): a Ingeniería la lleva Diseño, que es
 * un solo puesto, y mientras Ingeniería no tenga cuenta propia responde la de
 * Diseño, que la base le anota sola en su fila.
 *
 * El administrador del sistema asigna la cuenta de Diseño y la fila de
 * Ingeniería pasa a decir quién responde, sin que nadie la toque; le pone a
 * Ingeniería una cuenta propia, esa cuenta se da de baja y la fila lo marca;
 * se la quita y vuelve a responder la de Diseño, y la sigue cuando cambia.
 * Después de cada clic se mira la base. Diseño no ve la tarjeta ni cambia quién lleva a Ingeniería aunque llame
 * a la base por su cuenta.
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
  // La cuenta propia que se le pone a Ingeniería, y que se da de baja a medio camino.
  supervisor: 'sup.prd.local@metalwork.test',
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
const cuenta = async (correo) =>
  una(
    `select u.id, u.activo, public.puesto(u) as puesto, (select a.codigo from public.areas a where a.id = u.area_id) as area
       from public.usuarios u where lower(u.correo) = lower($1)`,
    [correo],
  )
const area = async (codigo) =>
  una('select a.id, a.nombre, a.jefe_id, a.jefe_heredado, a.llevada_por_id from public.areas a where a.codigo = $1', [codigo])
const responde = async (codigo) => (await una('select public.responsable_del_area($1) as r', [codigo])).r
// Lo que cuenta la cabecera: las áreas activas con a quién avisarle, propia o heredada.
const cubiertas = async () =>
  una(
    `select count(*)::int as total, count(*) filter (where public.responsable_del_area(a.codigo) is not null)::int as con
       from public.areas a where a.activo`,
  )

CUENTAS.admin ??= (
  await una(
    `select u.correo from public.usuarios u join public.roles r on r.id = u.rol_id
      where r.codigo = 'ADMIN' and u.activo order by u.creado_en limit 1`,
  )
)?.correo
const admin = CUENTAS.admin && (await cuenta(CUENTAS.admin))
const diseno = await cuenta(CUENTAS.diseno)
const supervisor = await cuenta(CUENTAS.supervisor)
if (!admin || !diseno || !supervisor) {
  console.error('Faltan las cuentas del banco: corre herramientas/banco/preparar.sh.')
  process.exit(1)
}

// Cómo estaban las dos áreas y la cuenta que se da de baja, para dejarlas igual.
const ANTES = { ING: await area('ING'), DIS: await area('DIS') }
const SUPERVISOR_ACTIVO = supervisor.activo
// El administrador da de baja o de alta una cuenta: `fn_usuario_proteger_rol` pide su sesión.
async function activar(id, activo) {
  await base.query('begin')
  await base.query(`select set_config('request.jwt.claim.sub', $1, true)`, [admin.id])
  await base.query('update public.usuarios set activo = $2 where id = $1', [id, activo])
  await base.query('commit')
}
async function dejarComoEstaba() {
  await base.query('rollback').catch(() => {})
  const pasos = [
    ['la cuenta del Supervisor de producción', () => activar(supervisor.id, SUPERVISOR_ACTIVO)],
    // Sin pasar por los disparadores: lo de antes vuelve tal cual.
    ...[ANTES.ING, ANTES.DIS].map((a) => [
      `el responsable de ${a.nombre}`,
      async () => {
        await base.query('begin')
        await base.query(`set local session_replication_role = replica`)
        await base.query('update public.areas set jefe_id = $2, llevada_por_id = $3, jefe_heredado = $4 where id = $1', [
          a.id,
          a.jefe_id,
          a.llevada_por_id,
          a.jefe_heredado,
        ])
        await base.query('commit')
      },
    ]),
  ]
  for (const [que, paso] of pasos) {
    try {
      await paso()
    } catch (error) {
      await base.query('rollback').catch(() => {})
      fallas.push(`no se pudo dejar como estaba ${que}: ${error.message}`)
      console.log(`FALLA · no se pudo dejar como estaba ${que}: ${error.message}`)
    }
  }
}
process.on('uncaughtException', async (error) => {
  console.error(error)
  await dejarComoEstaba()
  process.exit(1)
})
process.on('SIGINT', async () => {
  await dejarComoEstaba()
  process.exit(130)
})
// Lo que haría una acción de servidor, con la sesión de esa cuenta y el RLS puesto.
async function cambiarPorLaBase(usuarioId, sql, valores) {
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true)`, [usuarioId])
    await base.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: usuarioId, role: 'authenticated' })])
    await base.query('set local role authenticated')
    return (await base.query(sql, valores)).rowCount
  } finally {
    await base.query('rollback')
  }
}

comprobar(ANTES.ING.llevada_por_id === ANTES.DIS.id, 'en la base, a Ingeniería la lleva Diseño')
comprobar(diseno.area === 'DIS', 'la cuenta de Diseño e ingeniería es del área Diseño: no cambió de área')
// Parte sin responsables en las dos: al quitar la de Diseño, la heredada de Ingeniería se va sola.
await base.query('update public.areas set jefe_id = null where codigo = $1', ['ING'])
await base.query('update public.areas set jefe_id = null where codigo = $1', ['DIS'])

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, viewport = { width: 1440, height: 900 }, tactil = false) {
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima', hasTouch: tactil, isMobile: tactil, deviceScaleFactor: 2 })
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
const resumenDe = (pagina) => textoDe(pagina.locator(TARJETA).getByText(/áreas tienen? (su )?cuenta responsable/))
const resumenEsperado = (con, total) =>
  con === 0
    ? `Ninguna de las ${total} áreas tiene cuenta responsable todavía`
    : con === total
      ? `Las ${total} áreas tienen su cuenta responsable`
      : `${con} de ${total} áreas tienen cuenta responsable`
const campoDe = (ventana) => ventana.getByRole('combobox', { name: 'Cuenta responsable' })

/** Abre la ventana de un área con el botón de su fila y la devuelve. */
async function abrir(pagina, nombre) {
  await fila(pagina, nombre).getByRole('button').click()
  const ventana = pagina.getByRole('dialog', { name: `Responsable de ${nombre}` })
  await ventana.waitFor({ timeout: 15000 })
  return ventana
}
async function guardar(pagina, ventana) {
  await ventana.getByRole('button', { name: 'Guardar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 15000 })
}

// ============================================================ el administrador
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.admin)
  await pagina.goto(`${BASE}/configuracion`, { waitUntil: 'networkidle' })
  await pagina.locator(TARJETA).waitFor({ timeout: 15000 })
  const ingenieria = fila(pagina, 'Ingeniería')
  const filaDiseno = fila(pagina, 'Diseño')

  // --- ninguna de las dos tiene cuenta
  const antes = await cubiertas()
  let texto = await textoDe(ingenieria)
  comprobar(texto.includes('Sin cuenta'), 'sin cuenta en Diseño, Ingeniería dice «Sin cuenta»')
  comprobar(
    texto.includes('La lleva Diseño: va a responder su cuenta cuando Diseño tenga una.'),
    'y dice que la lleva Diseño y que va a responder su cuenta cuando la tenga',
  )
  comprobar((await textoDe(filaDiseno)).includes('Lleva también Ingeniería'), 'la fila de Diseño dice que lleva también Ingeniería')
  comprobar((await resumenDe(pagina)).includes(resumenEsperado(antes.con, antes.total)), `el resumen cuenta ${antes.con} de ${antes.total}`)
  comprobar((await responde('ING')) === null, 'responsable_del_area(«ING») no da a nadie')

  // --- se asigna la de Diseño: Ingeniería hereda sin que nadie la toque
  let ventana = await abrir(pagina, 'Diseño')
  await campoDe(ventana).selectOption(diseno.id)
  await guardar(pagina, ventana)
  await ingenieria.getByText('Responde Diseño').waitFor({ timeout: 15000 })
  texto = await textoDe(ingenieria)
  comprobar(!texto.includes('Sin cuenta'), 'con la cuenta de Diseño asignada, Ingeniería ya no dice «Sin cuenta»')
  comprobar(texto.includes(`Cuenta responsable: ${diseno.puesto}`), `y muestra la cuenta que responde: ${diseno.puesto}`)
  comprobar(
    texto.includes('La lleva Diseño: responde su cuenta mientras esta área no tenga una propia.'),
    'y dice por qué: la lleva Diseño',
  )
  let enLaBase = await area('ING')
  comprobar(enLaBase.jefe_id === diseno.id && enLaBase.jefe_heredado, 'en la base, la fila de Ingeniería tiene anotada la cuenta de Diseño, como heredada')
  comprobar((await responde('ING')) === diseno.id, 'responsable_del_area(«ING») da la cuenta de Diseño')
  comprobar((await responde('DIS')) === diseno.id, 'y responsable_del_area(«DIS») también')
  const conDos = await cubiertas()
  comprobar(conDos.con === antes.con + 2, `una sola asignación cubre las dos áreas (${antes.con} → ${conDos.con})`)
  comprobar((await resumenDe(pagina)).includes(resumenEsperado(conDos.con, conDos.total)), `y el resumen sube a ${conDos.con}`)
  await pagina.screenshot({ path: join(CAPTURAS, 'a4-configuracion-1440-heredada.png'), fullPage: true })
  await ingenieria.scrollIntoViewIfNeeded()
  await pagina.locator(TARJETA).screenshot({ path: join(CAPTURAS, 'a4-responsables-1440.png') })

  // --- la ventana de Ingeniería: sin cuenta propia, y las de Diseño primero
  ventana = await abrir(pagina, 'Ingeniería')
  const campo = campoDe(ventana)
  comprobar((await campo.inputValue()) === '', 'la ventana de Ingeniería abre sin cuenta propia')
  comprobar(
    (await campo.locator('option').first().textContent()) === 'Sin cuenta propia: responde la de Diseño',
    'y la opción vacía dice quién responde entonces',
  )
  const grupos = await campo.locator('optgroup').evaluateAll((g) => g.map((x) => x.label))
  comprobar(grupos[0] === 'Cuentas de Diseño, que la lleva', `las cuentas de Diseño van primero (${grupos.join(' | ')})`)
  const delPuesto = await campo.locator('optgroup').first().locator('option').evaluateAll((o) => o.map((x) => x.value))
  comprobar(delPuesto.includes(diseno.id), 'entre ellas, la de Diseño e ingeniería')
  const repetidas = await campo.locator('option').evaluateAll((o) => o.map((x) => x.value).filter((v, i, t) => v && t.indexOf(v) !== i))
  comprobar(repetidas.length === 0, 'y ninguna cuenta sale dos veces en la lista')
  comprobar(
    (await textoDe(ventana)).includes('A Ingeniería la lleva Diseño: sin cuenta propia, responde la de Diseño.'),
    'la ventana explica que elegir una es solo si debe responder otra',
  )
  await pagina.screenshot({ path: join(CAPTURAS, 'a4-ventana-ingenieria-1440.png') })

  // --- cuenta propia: tres toques, un solo envío
  await campo.selectOption(supervisor.id)
  let envios = 0
  const contarEnvio = (q) => {
    if (q.method() === 'POST' && q.headers()['next-action']) envios++
  }
  pagina.on('request', contarEnvio)
  const boton = ventana.getByRole('button', { name: 'Guardar' })
  await boton.click()
  await boton.click({ force: true, timeout: 1000 }).catch(() => {})
  await boton.click({ force: true, timeout: 1000 }).catch(() => {})
  await ventana.waitFor({ state: 'detached', timeout: 15000 })
  await ingenieria.getByText(supervisor.puesto).waitFor({ timeout: 15000 })
  pagina.off('request', contarEnvio)
  comprobar(envios === 1, `los tres toques salieron como un solo envío (${envios})`)
  enLaBase = await area('ING')
  comprobar(enLaBase.jefe_id === supervisor.id && !enLaBase.jefe_heredado, 'en la base, Ingeniería tiene la cuenta propia que se eligió, y ya no es heredada')
  comprobar((await responde('ING')) === supervisor.id, 'responsable_del_area(«ING») da la propia')
  comprobar((await responde('DIS')) === diseno.id, 'y Diseño sigue con la suya')
  texto = await textoDe(ingenieria)
  comprobar(!texto.includes('Responde Diseño'), 'la fila ya no dice «Responde Diseño»')
  comprobar(texto.includes('La lleva Diseño, y tiene su propia cuenta responsable.'), 'y dice que tiene su propia cuenta')
  comprobar((await cubiertas()).con === conDos.con, 'el resumen no cambia: ya estaba cubierta')

  // --- la cuenta propia se da de baja: como en cualquier área, nadie responde, y la fila dice cómo salir
  await activar(supervisor.id, false)
  await pagina.reload({ waitUntil: 'networkidle' })
  texto = await textoDe(ingenieria)
  comprobar(texto.includes('Cuenta dada de baja'), 'con la cuenta propia dada de baja, la fila lo marca')
  comprobar(
    texto.includes('Elige otra, o quítala para que responda la de Diseño.'),
    'y dice que quitándola responde la de Diseño',
  )
  comprobar((await responde('ING')) === null, 'responsable_del_area(«ING») no da a nadie mientras tanto')
  comprobar((await resumenDe(pagina)).includes(resumenEsperado(conDos.con - 1, conDos.total)), `y el resumen baja a ${conDos.con - 1}`)
  await ingenieria.scrollIntoViewIfNeeded()
  await pagina.locator(TARJETA).screenshot({ path: join(CAPTURAS, 'a4-responsables-1440-de-baja.png') })
  await activar(supervisor.id, true)
  await pagina.reload({ waitUntil: 'networkidle' })

  // --- se le quita la propia: sigue heredando, y el aviso lo dice
  ventana = await abrir(pagina, 'Ingeniería')
  comprobar((await campoDe(ventana).inputValue()) === supervisor.id, 'al recargar, la ventana trae elegida la cuenta propia')
  await campoDe(ventana).selectOption('')
  await guardar(pagina, ventana)
  await ingenieria.getByText('Responde Diseño').waitFor({ timeout: 15000 })
  enLaBase = await area('ING')
  comprobar(enLaBase.jefe_id === diseno.id && enLaBase.jefe_heredado, 'en la base, Ingeniería vuelve a tener anotada la de Diseño, como heredada')
  comprobar(
    (await ingenieria.getByRole('status').textContent()).includes('Ingeniería quedó sin cuenta propia: responde la del área que la lleva.'),
    'y el aviso para el lector de pantalla dice quién responde',
  )
  comprobar((await responde('ING')) === diseno.id, 'responsable_del_area(«ING») da otra vez la de Diseño')

  // --- cambia la de Diseño: la de Ingeniería la sigue
  ventana = await abrir(pagina, 'Diseño')
  await campoDe(ventana).selectOption(supervisor.id)
  await guardar(pagina, ventana)
  await ingenieria.getByText(supervisor.puesto).waitFor({ timeout: 15000 })
  enLaBase = await area('ING')
  comprobar(enLaBase.jefe_id === supervisor.id && enLaBase.jefe_heredado, 'al cambiar la cuenta de Diseño, la de Ingeniería cambia con ella')
  comprobar((await textoDe(ingenieria)).includes('Responde Diseño'), 'y la fila sigue diciendo «Responde Diseño»')

  // --- sin la de Diseño, ninguna de las dos
  ventana = await abrir(pagina, 'Diseño')
  await campoDe(ventana).selectOption('')
  await guardar(pagina, ventana)
  await ingenieria.getByText('Sin cuenta', { exact: true }).waitFor({ timeout: 15000 })
  comprobar((await responde('ING')) === null && (await responde('DIS')) === null, 'al quitar la de Diseño, ninguna de las dos tiene a quién avisar')
  comprobar((await cubiertas()).con === antes.con, `y el resumen vuelve a ${antes.con}`)
  // Un área que nadie lleva no cambió en todo el recorrido.
  comprobar(!(await textoDe(fila(pagina, 'Producción'))).includes('La lleva'), 'Producción, que nadie lleva, no dice nada de esto')
  comprobar(errores.length === 0, `sin errores en la consola (${errores.join(' | ') || 'ninguno'})`)
  await contexto.close()
}

// ============================================================ en el teléfono
{
  // Como lo haría el administrador: con su sesión, por los disparadores.
  await base.query('begin')
  await base.query(`select set_config('request.jwt.claim.sub', $1, true)`, [admin.id])
  await base.query('update public.areas set jefe_id = $1 where codigo = $2', [diseno.id, 'DIS'])
  await base.query('commit')
  const { pagina, contexto, errores } = await entrar(CUENTAS.admin, { width: 390, height: 844 }, true)
  await pagina.goto(`${BASE}/configuracion`, { waitUntil: 'networkidle' })
  const ingenieria = fila(pagina, 'Ingeniería')
  await ingenieria.waitFor({ timeout: 15000 })
  comprobar((await textoDe(ingenieria)).includes('Responde Diseño'), 'a 390, Ingeniería dice «Responde Diseño»')
  const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(desborde <= 0, `a 390 la pantalla no se desborda a lo ancho (${desborde} px)`)
  await ingenieria.scrollIntoViewIfNeeded()
  await pagina.locator(TARJETA).screenshot({ path: join(CAPTURAS, 'a4-responsables-390.png') })
  const ventana = await abrir(pagina, 'Ingeniería')
  await pagina.screenshot({ path: join(CAPTURAS, 'a4-ventana-ingenieria-390.png') })
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 15000 })
  comprobar(errores.length === 0, `sin errores en la consola a 390 (${errores.join(' | ') || 'ninguno'})`)
  await contexto.close()
}

// ============================================================ quien no es el administrador
{
  const { pagina, contexto } = await entrar(CUENTAS.diseno)
  await pagina.goto(`${BASE}/configuracion`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator(TARJETA).count()) === 0, 'Diseño entra a Configuración y no ve «Responsables de área»')
  await contexto.close()
  let filas = await cambiarPorLaBase(diseno.id, 'update public.areas set llevada_por_id = null where id = $1', [ANTES.ING.id])
  comprobar(filas === 0, 'aunque llame a la base, Diseño no cambia quién lleva a Ingeniería: cero filas')
  filas = await cambiarPorLaBase(diseno.id, 'update public.areas set jefe_id = $2 where id = $1', [ANTES.ING.id, diseno.id])
  comprobar(filas === 0, 'ni se pone de responsable de Ingeniería: cero filas')
  const gerencia = await cuenta(CUENTAS.gerencia)
  filas = await cambiarPorLaBase(gerencia.id, 'update public.areas set llevada_por_id = null where id = $1', [ANTES.ING.id])
  comprobar(filas === 0, 'Gerencia tampoco: cero filas')
  comprobar((await area('ING')).llevada_por_id === ANTES.DIS.id, 'a Ingeniería la sigue llevando Diseño')
}

// La base queda como estaba.
await dejarComoEstaba()
const alFinal = { ING: await area('ING'), DIS: await area('DIS') }
comprobar(
  alFinal.ING.jefe_id === ANTES.ING.jefe_id &&
    alFinal.ING.jefe_heredado === ANTES.ING.jefe_heredado &&
    alFinal.DIS.jefe_id === ANTES.DIS.jefe_id &&
    alFinal.ING.llevada_por_id === ANTES.ING.llevada_por_id,
  'la base queda como estaba',
)

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} comprobación(es) fallaron.` : '\nTodo bien: Ingeniería responde con la cuenta de Diseño mientras no tenga una propia, y solo el administrador lo cambia.')
process.exit(fallas.length ? 1 : 0)
