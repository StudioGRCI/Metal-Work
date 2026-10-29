/**
 * Clic real sobre la decimosexta pasada (migración 20261023100000): los
 * documentos numerados y la caja reconocen su mismo envío. Con la cuenta de
 * cada puesto, nunca ADMIN. En cada documento:
 *
 *   a. La respuesta no llega; «Cancelar» pone la lista al día con lo que sí
 *      entró. Al volver a abrir, la ventana pregunta a la base y dice, sin
 *      rojo, que aquel quedó y con qué número; lo que se registra ahí es otro.
 *   b. Lo mismo, pero se envía otro importe antes de que la base conteste esa
 *      pregunta (Next despacha las acciones de una en una: el envío sale detrás
 *      de ella, con el id de antes): la ventana dice sin rojo que el primero ya
 *      quedó, con su número, traba los campos, solo ofrece «Cerrar» y se lleva
 *      el cursor; la respuesta de la pregunta no se pinta encima. Al cerrar, la
 *      lista muestra el primero, con el importe de la primera vez.
 *   c. Cerrada esa ventana, la siguiente registra otro documento.
 *   d. La respuesta de la pregunta llega con la ventana ya cerrada: al volver
 *      a abrir, la ventana dice que aquel quedó, y lo sigue diciendo al cerrar
 *      y abrir sin enviar; lo que se registra después es otro, y la ventana
 *      siguiente ya no trae la nota.
 *
 *   1. Logística, «Nueva orden de servicio».
 *   2. Logística, «Nueva OC directa».
 *   3. Requerimientos, «Nuevo requerimiento».
 *   4. Administración, «Nuevo subcontrato» (al guardarse, abre el subcontrato).
 *   5. Tesorería, caja diaria, sin cerrar la ventana: el mismo egreso enviado
 *      otra vez deja un movimiento; cambiado el importe, dice que ya quedó; al
 *      cerrar se ve el primero, y la siguiente apertura registra otro. Y sin
 *      respuesta desde el botón de una cuenta, «Cancelar» y abrir el de la caja:
 *      las dos ventanas comparten el envío, y la segunda dice que aquel quedó.
 *   6. Logística, «Sacar de la lista» sin respuesta: el aviso sale dentro de la
 *      ventana de confirmar, con el cursor, y no detrás.
 *   7. Diseño, el plano y su revisión: sin respuesta y con otro PDF, el plano
 *      (sin ventana) y la revisión (con ventana) dicen sin rojo que ya quedó, y
 *      el siguiente entra. La revisión se traba y solo ofrece «Cerrar».
 *   8. La OC directa con otra cuenta en otra pestaña (la emite Logística;
 *      Administración, desde la migración 20261026160000, solo la de su RQA):
 *      a. con la ventana abierta y escrita, entra Administración en otra
 *         pestaña: la pantalla entera queda bajo la traba al momento, con el
 *         puesto de las dos, el cursor en ella y solo «Recargar la pantalla»;
 *         lo de detrás no recibe el toque y un envío forzado no sale. Si vuelve
 *         Logística, se destraba con lo escrito y el cursor donde estaba, lo
 *         anuncia, y emite a su nombre;
 *      b. el hueco: sin ningún aviso todavía (sin `cookieStore` ni el de la
 *         otra pestaña), el toque de emitir mira la cookie, no sale y traba;
 *      c. un aviso viejo de Logística no destraba lo que la cookie dice que
 *         es de Administración;
 *      d. con lo de Logística pendiente, entra Administración: la pantalla se
 *         traba sin abrir nada; de vuelta Logística, dice que lo suyo quedó.
 *      Sin la cookie a la vista (un navegador que no la deja leer):
 *      e. sin el aviso de la otra pestaña, la pregunta al abrir traba, aunque
 *         antes conteste una anterior hecha con Logística;
 *      f. lo que sale antes de que la base conteste esa pregunta sale con la
 *         sesión que haya. Con la de Administración la base no lo deja entrar:
 *         de vuelta Logística, la ventana no dice que quedó nada y lo que envía
 *         entra una vez. Con la de otra persona de Logística (una segunda
 *         cuenta, que la prueba crea si falta y deja inactiva al terminar),
 *         entra a su nombre, la traba nombra a las dos con su nombre, y de
 *         vuelta la primera, la ventana dice cuál quedó y a nombre de quién,
 *         también con su nombre;
 *      g. lo mismo, y «Recargar la pantalla» con la segunda: lo ve como suyo y
 *         suelta lo de la primera.
 *      Con la cookie a la vista otra vez:
 *      h. la OC ya entró y su comprobante termina de subir cuando entra
 *         Administración: no se anota con ella, la ventana se cierra diciendo
 *         que falta, y de vuelta Logística el archivo suelto se quita y la
 *         lista se pone al día.
 *
 * El corte deja pasar el envío al servidor y no le entrega la respuesta al
 * navegador, como una señal que se cae a medio camino.
 *
 * Siembra sus datos en la base del banco con un sufijo nuevo. Variables:
 * BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE, SOLO (las
 * partes que corren, p. ej. `sc,caja`; de os, oc, rq, sc, caja, lista, planos y cuenta) y el
 * correo de cada cuenta si no es `<puesto>.local@metalwork.test` (la segunda de
 * Logística, LOGISTICA_DOS, si no es `logistica.dos.local@metalwork.test`).
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { crearCajaDePrueba } from './caja-de-prueba.mjs'
import { escribirCodigo } from './campo-codigo.mjs'
import { esperarReactAlNavegar } from './con-react.mjs'
import { esConsultaDelEnvio } from './consulta-del-envio.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const SOLO = process.env.SOLO?.split(',')
const corre = (parte) => !SOLO || SOLO.includes(parte)
const CUENTAS = Object.fromEntries(['logistica', 'gerencia', 'requerimientos', 'administracion', 'tesoreria', 'diseno'].map((p) => [p, cuenta(p)]))
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
async function hasta(leer, cumple, ms = 15000) {
  const fin = Date.now() + ms
  let v = await leer()
  while (!cumple(v) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 250))
    v = await leer()
  }
  return v
}

// ---------------------------------------------------------------- siembra
const SUFIJO = String(100000 + (Date.now() % 900000))
const PROVEEDOR = `PROVEEDOR MISMO ENVIO ${SUFIJO}`
const MATERIAL = `Disco de corte mismo envío ${SUFIJO}`
const SUBCONTRATISTA = `Subcontratista mismo envío ${SUFIJO}`
const CODIGO = 'PLA_SR_O4_1_26/21'
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
// La parte 8 necesita a dos personas del mismo puesto: una segunda cuenta de
// Logística, que se crea si falta y solo está activa mientras corre la parte 8,
// para no sumar a nadie a los avisos de Logística en las otras pruebas. Se apaga
// aunque la parte se caiga (`conLaSegundaDeLogistica`): con la clave común, una
// cuenta activa de más es una puerta (vigesimoquinta pasada).
const SEGUNDA_DE_LOGISTICA = process.env.LOGISTICA_DOS ?? 'logistica.dos.local@metalwork.test'
async function segundaDeLogistica(activa) {
  await consulta(
    `insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
     select gen_random_uuid(), $1::text, crypt($2, gen_salt('bf')), jsonb_build_object('nombres', 'Segunda', 'apellidos', 'de Logística')
      where not exists (select 1 from auth.users where email = $1::text)`,
    [SEGUNDA_DE_LOGISTICA, CLAVE],
  )
  await consulta(
    `insert into usuarios (id, nombres, apellidos, correo, cargo, rol_id, sede_id, area_id)
     select a.id, 'Segunda', 'de Logística', a.email, 'Logística', (select id from roles where codigo = 'COMPRADOR'),
            (select id from sedes where activo order by creado_en limit 1), (select id from areas where codigo = 'LOG')
       from auth.users a
      where a.email = $1::text and not exists (select 1 from usuarios u where u.correo = $1::text)`,
    [SEGUNDA_DE_LOGISTICA],
  )
  // El estado de una cuenta solo lo cambia quien administra usuarios
  // (fn_usuario_proteger_rol): se cambia como el administrador del banco, igual
  // que preparar.sh crea las cuentas, y solo dentro de esta transacción.
  await consulta('begin')
  try {
    await consulta(
      `select set_config('request.jwt.claim.sub',
         (select u.id::text from usuarios u join roles r on r.id = u.rol_id
           where r.codigo = 'ADMIN' and u.activo order by u.creado_en limit 1), true)`,
    )
    await consulta(`update usuarios set activo = $2 where correo = $1`, [SEGUNDA_DE_LOGISTICA, activa])
    await consulta('commit')
  } catch (error) {
    await consulta('rollback')
    throw error
  }
}
/** La parte 8 con la segunda cuenta de Logística activa, y apagada al salir aunque la parte se caiga. */
async function conLaSegundaDeLogistica(parte) {
  await segundaDeLogistica(true)
  try {
    await parte()
  } finally {
    await segundaDeLogistica(false)
  }
}
if (corre('cuenta')) {
  // Existe desde aquí, para saber su id; apagada hasta la parte 8.
  await segundaDeLogistica(false)
  CUENTAS.logistica_dos = SEGUNDA_DE_LOGISTICA
}
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco: preparar.sh crea las cuentas locales.`)

/** Lo que hace la sesión de esa cuenta: los disparadores y las funciones leen el usuario de aquí. */
async function como(puesto) {
  const sub = ids[CUENTAS[puesto]]
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, JSON.stringify({ sub, role: 'authenticated' })])
}
/** Un número de documento libre, con su dígito de control, que empieza con `prefijo` (2 cifras). */
async function rucLibre(prefijo, tabla, columna) {
  for (;;) {
    const cuerpo = `${prefijo}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    const [fila] = await consulta(
      `select n from (select $1 || d as n from generate_series(0, 9) d) x
        where public.ruc_es_valido(n) and not exists (select 1 from ${tabla} t where t.${columna} = n) limit 1`,
      [cuerpo],
    )
    if (fila) return fila.n
  }
}
const [{ id: proveedor }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. Argentina 433, Lima', '999 433 433') returning id`,
  [await rucLibre('20', 'proveedores', 'numero_documento'), PROVEEDOR],
)
const [{ id: und }] = await consulta(`select id from unidades_medida where codigo = 'UND'`)
const [{ id: cat }] = await consulta(`select id from categorias_material where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1`)
const [{ id: material }] = await consulta(
  `insert into materiales (codigo, descripcion, categoria_id, unidad_medida_id) values ($1, $2, $3, $4) returning id`,
  [`MISMO-${SUFIJO}`, MATERIAL, cat, und],
)
await consulta(
  `insert into subcontratistas (ruc, nombre, banco, numero_cuenta, cci, creado_por) values ($1, $2, 'BCP', $3, $4, $5)`,
  [await rucLibre('10', 'subcontratistas', 'ruc'), SUBCONTRATISTA, `1910${SUFIJO}0433`, `00219100${SUFIJO}043399`.slice(0, 20), ids[CUENTAS.administracion]],
)
const CAJA = await crearCajaDePrueba(consulta, CUENTAS.tesoreria)
// La OC que Logística saca de la lista del conductor (6): emitida, aprobada y en la lista.
const [{ id: ocLista }] = await consulta(`select gen_random_uuid() as id`)
await como('logistica')
await consulta(
  `select public.emitir_compra_directa($1, $2, null, $3, jsonb_build_array(jsonb_build_object('material_id', $4::text, 'cantidad', 2, 'precio', 35)),
     $5::date, 'CONTADO', 0, 'PEN', false, 'PLANTA')`,
  [ocLista, proveedor, `Para sacar de la lista ${SUFIJO}`, material, hoy],
)
await como('gerencia')
await consulta(`select public.aprobar_compra($1)`, [ocLista])
await como('logistica')
await consulta(`select public.programar_recojo($1, 50, null)`, [ocLista])
const [{ numero: NUMERO_LISTA }] = await consulta(`select numero from ordenes_compra_materiales where id = $1`, [ocLista])

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
// Mientras la prueba corta la respuesta a propósito, el navegador anota el corte en la consola.
let cortando = false
// Lo que la consola dice a propósito en una parte: la subida a la ruta que ya tiene su archivo da 400/409.
let ruido = null
const VENTANA = '[role="dialog"]:not([data-nextjs-dialog])'

async function entrar(puesto, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
  const pagina = esperarReactAlNavegar(await contexto.newPage())
  pagina.on('console', (m) => {
    if (cortando && /net::ERR_FAILED|Failed to fetch|TypeError/.test(m.text())) return
    if (ruido?.test(m.text())) return
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${puesto}: ${m.text().slice(0, 300)}`)
  })
  await ingresar(pagina, puesto)
  return { pagina, contexto }
}

async function ingresar(pagina, puesto) {
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', CUENTAS[puesto])
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${CUENTAS[puesto]}`)
  await pagina.waitForLoadState('networkidle')
}

/**
 * En otra pestaña del mismo navegador se cierra la sesión y entra `puesto`: la
 * sesión es de todas. Con `sinAviso`, esa pestaña no tiene `BroadcastChannel` y
 * las otras no se enteran por ella (un navegador sin él, o el instante entre la
 * sesión nueva y el aviso).
 */
async function enOtraPestana(contexto, puesto, { sinAviso = false } = {}) {
  const otra = esperarReactAlNavegar(await contexto.newPage())
  if (sinAviso) await otra.addInitScript(() => Object.defineProperty(window, 'BroadcastChannel', { value: undefined }))
  await otra.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await Promise.all([
    otra.waitForURL((u) => u.pathname.startsWith('/ingresar'), { timeout: 30000 }),
    otra.evaluate(() => document.querySelector('form[action="/auth/salir"]')?.requestSubmit()),
  ])
  await ingresar(otra, puesto)
  await otra.close()
}

/**
 * Las acciones de servidor que llevan `marca` llegan al servidor, pero las
 * próximas `quedan` respuestas no llegan al navegador. Con `sinEnviar`, ni
 * siquiera llegan al servidor.
 */
async function cortarRespuestas(pagina) {
  // `retener`: la clave de `consultarEnvio` cuya pregunta se detiene hasta `soltar()`, la que lleva algún id
  // pendiente o, con `retenerSinIds`, también la que no; `retenidas`, las que se detuvieron; `consultas`, las
  // que terminaron.
  // `retenerRespuesta`: la pregunta llega al servidor y lo que se detiene es su respuesta.
  const corte = { marca: null, quedan: 0, sinEnviar: false, retener: null, retenerSinIds: false, retenerRespuesta: false, esperan: [], retenidas: 0, consultas: 0 }
  corte.soltar = () => {
    for (const listo of corte.esperan.splice(0)) listo()
  }
  pagina.on('requestfinished', (q) => {
    if (q.method() === 'POST' && q.headers()['next-action'] && esConsultaDelEnvio(q.postData())) corte.consultas++
  })
  await pagina.route('**/*', async (r) => {
    const q = r.request()
    if (q.method() === 'POST' && q.headers()['next-action'] && corte.retener
      && esConsultaDelEnvio(q.postData(), corte.retener, { conIds: !corte.retenerSinIds })) {
      const respuesta = corte.retenerRespuesta ? await r.fetch() : null
      corte.retenidas++
      await new Promise((listo) => corte.esperan.push(listo))
      return respuesta ? r.fulfill({ response: respuesta }) : r.continue()
    }
    if (q.method() !== 'POST' || !q.headers()['next-action'] || !corte.marca || !(q.postData() ?? '').includes(corte.marca) || corte.quedan <= 0) {
      return r.continue()
    }
    corte.quedan--
    if (!corte.sinEnviar) await r.fetch().catch(() => {})
    return r.abort('failed')
  })
  return corte
}

/** Cómo quedó la ventana tras el aviso: el cursor, el color, los campos y los botones que se pueden tocar. */
function laVentana(pagina) {
  return pagina.evaluate((selector) => {
    const v = document.querySelector(selector)
    const aviso = v?.querySelector('[role="alert"]')
    const campos = [...(v?.querySelectorAll('input:not([type=hidden]), select, textarea') ?? [])]
    // La «i» de la ayuda de un campo no se traba (`PieDeVentana`): leerla no cambia nada.
    const botones = [...(v?.querySelectorAll('button:not([data-ayuda])') ?? [])].filter((b) => !b.disabled && b.offsetParent !== null)
    return {
      neutro: aviso?.hasAttribute('data-ya-entro') ?? false,
      cursor: Boolean(aviso) && document.activeElement === aviso,
      campos: campos.length,
      abiertos: campos.filter((c) => !c.disabled).map((c) => c.name || c.id),
      botones: [...new Set(botones.map((b) => b.textContent.trim() || b.getAttribute('aria-label')))],
      envia: v?.querySelectorAll('button[type=submit]').length ?? 0,
    }
  }, VENTANA)
}

/** La ventana se cerró (salió bien) o muestra su aviso. */
async function esperarVentana(pagina) {
  const v = pagina.locator(VENTANA)
  await Promise.race([
    v.waitFor({ state: 'hidden', timeout: 30000 }),
    v.locator('[role="alert"]').waitFor({ timeout: 30000 }),
  ]).catch(() => {})
  const error = limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  await pagina.waitForLoadState('networkidle')
  return error
}

/** Elige en una lista con buscador, como la persona: escribe y toca la opción. */
async function elegir(pagina, disparador, texto) {
  await disparador.click()
  const buscador = pagina.getByRole('searchbox')
  if (await buscador.isVisible().catch(() => false)) await buscador.fill(texto)
  await pagina.locator('[role="option"]', { hasText: texto }).first().click()
}

/** a, b y c de un documento numerado (ver arriba). */
async function mismoEnvio(d) {
  if (!corre(d.clave)) return
  const { pagina, contexto } = await entrar(d.puesto)
  const v = pagina.locator(VENTANA)
  const corte = await cortarRespuestas(pagina)
  const ir = () => pagina.goto(`${BASE}${d.ruta}`, { waitUntil: 'networkidle' })
  const abrir = async () => {
    await d.nuevo(pagina).click()
    await v.waitFor()
  }
  const aviso = () => v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => '')
  const enviar = () => v.getByRole('button', { name: d.enviar, exact: true }).click()
  async function sinRespuesta(marca) {
    corte.marca = marca
    corte.quedan = 1
    cortando = true
    await enviar()
    const texto = limpio(await hasta(aviso, (t) => /respuesta/.test(t ?? ''), 30000))
    cortando = false
    return texto
  }
  const enLaLista = (numero) => hasta(() => d.fila(pagina, numero).count(), (n) => n > 0, 20000)

  const nota = () => v.locator('[data-envio-anterior]').textContent({ timeout: 500 }).catch(() => '')

  // a. Sin respuesta, «Cancelar», y al volver a abrir la ventana dice que aquel quedó.
  const A = `${SUFIJO}a`
  await ir()
  await abrir()
  await d.llenar(v, pagina, A, d.valores[0])
  const corto = await sinRespuesta(A)
  await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await v.waitFor({ state: 'hidden' })
  const [entro] = await hasta(() => d.contar(A), (r) => r.length > 0)
  comprobar(corto.startsWith('No llegó la respuesta') && Boolean(entro), `[${d.nombre}] sin respuesta lo dice, y el primero sí entró (${entro?.numero ?? 'nada'}): «${corto}»`)
  comprobar((await enLaLista(entro?.numero)) > 0, `[${d.nombre}] al cancelar, la lista lo muestra`)
  await abrir()
  const dice = limpio(await hasta(nota, (t) => /sí quedó/.test(t ?? ''), 15000))
  const limpia = (await v.locator('[role="alert"]').count()) === 0
  const anunciada = await v.locator('[aria-live="polite"] [data-envio-anterior]').count()
  comprobar(limpia && anunciada === 1 && dice.startsWith(`${d.nota} que enviaste antes sí quedó: ${entro?.numero}.`) && dice.endsWith('Lo que registres ahora será otra.'.replace('otra', d.otra)),
    `[${d.nombre}] vuelto a abrir, limpio, dice que aquel quedó con su número: «${dice}»`)
  await pagina.screenshot({ path: join(CAPTURAS, `mismo-envio-${d.clave}-ya-entro.png`) })
  const A2 = `${SUFIJO}a2`
  await d.llenar(v, pagina, A2, d.valores[1])
  await enviar()
  const error = await esperarVentana(pagina)
  const [otroA] = await hasta(() => d.contar(A2), (r) => r.length > 0)
  const quedaron = await d.contar(A)
  comprobar(!error && quedaron.length === 1 && Boolean(otroA) && otroA.numero !== entro?.numero,
    `[${d.nombre}] y lo que se registra ahí es otro (${entro?.numero} y ${otroA?.numero ?? 'nada'})${error ? ` (dijo «${error}»)` : ''}`)
  if (d.alGuardar) comprobar(await d.alGuardar(pagina, otroA), `[${d.nombre}] y la pantalla lo da por guardado`)

  // b. Sin respuesta, y al volver a abrir otro importe antes de que la base conteste la pregunta.
  const B = `${SUFIJO}b`
  await ir()
  await abrir()
  await d.llenar(v, pagina, B, d.valores[0])
  await sinRespuesta(B)
  await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await v.waitFor({ state: 'hidden' })
  corte.retener = d.consulta
  const consultasAntes = corte.consultas
  const retenidasAntes = corte.retenidas
  await abrir()
  await d.llenar(v, pagina, B, d.valores[1])
  await enviar()
  // Next despacha las acciones de una en una: el envío sale cuando la pregunta contesta. Ya con el formulario
  // enviado (con el id de antes), se suelta la pregunta.
  corte.retener = null
  corte.soltar()
  await hasta(() => corte.consultas, (n) => n > consultasAntes, 15000)
  comprobar(corte.retenidas > retenidasAntes, `[${d.nombre}] la pregunta de la ventana se detuvo hasta después de enviar`)
  const yaQuedo = limpio(await hasta(aviso, (t) => /ya quedó/.test(t ?? ''), 30000))
  const estado = await hasta(() => laVentana(pagina), (e) => e.cursor && e.abiertos.length === 0, 5000)
  const sinNota = (await v.locator('[data-envio-anterior]').count()) === 0
  const [primero, ...demas] = await d.contar(B)
  comprobar(yaQuedo.startsWith(d.yaQuedo(primero?.numero)) && yaQuedo.endsWith('Si cambiaste algo después, no se guardó: al cerrar, la pantalla muestra lo que quedó.'),
    `[${d.nombre}] con otro importe dice que el primero ya quedó, con su número: «${yaQuedo}»`)
  comprobar(estado.neutro && estado.cursor && estado.envia === 0 && estado.botones.join() === 'Cerrar' && estado.campos > 0 && estado.abiertos.length === 0,
    `[${d.nombre}] sin rojo, con el cursor, los campos trabados y solo «Cerrar» (${JSON.stringify(estado)})`)
  comprobar(sinNota, `[${d.nombre}] la respuesta tardía de la pregunta no se pinta encima del «ya quedó»`)
  await pagina.screenshot({ path: join(CAPTURAS, `mismo-envio-${d.clave}-ya-quedo.png`) })
  await v.locator('form').getByRole('button', { name: 'Cerrar', exact: true }).click()
  await v.waitFor({ state: 'hidden' })
  comprobar(Boolean(primero) && demas.length === 0 && Number(primero.valor) === Number(d.valores[0]),
    `[${d.nombre}] queda uno, con el importe de la primera vez (${primero?.numero}: ${primero?.valor})`)
  comprobar((await enLaLista(primero?.numero)) > 0, `[${d.nombre}] al cerrar, la lista lo muestra`)

  // c. Cerrada esa ventana, la siguiente es otro documento.
  const C = `${SUFIJO}c`
  await abrir()
  const otra = (await v.locator('[role="alert"]').count()) === 0 && (await v.getByRole('button', { name: d.enviar, exact: true }).isVisible())
  await d.llenar(v, pagina, C, d.valores[1])
  await enviar()
  const errorC = await esperarVentana(pagina)
  const [nuevo] = await hasta(() => d.contar(C), (r) => r.length > 0)
  comprobar(otra && !errorC && Boolean(nuevo) && nuevo.numero !== primero?.numero,
    `[${d.nombre}] la ventana siguiente sale limpia y registra otro (${nuevo?.numero ?? 'nada'})${errorC ? ` (dijo «${errorC}»)` : ''}`)

  // d. Sin respuesta, «Cancelar», volver a abrir y cerrar antes de que la base conteste: la respuesta llega con
  //    la ventana cerrada. Al volver a abrir, la ventana dice que aquel quedó, y lo sigue diciendo al cerrar y
  //    abrir sin enviar; lo que se registra después es otro y el primero queda uno (decimoséptima pasada: salía
  //    muda, con un id nuevo, y lo mismo enviado otra vez entraba dos veces).
  const D = `${SUFIJO}d`
  await ir()
  await abrir()
  await d.llenar(v, pagina, D, d.valores[0])
  await sinRespuesta(D)
  await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await v.waitFor({ state: 'hidden' })
  const [entroD] = await hasta(() => d.contar(D), (r) => r.length > 0)
  corte.retener = d.consulta
  const consultasD = corte.consultas
  const retenidasD = corte.retenidas
  await abrir()
  await hasta(() => corte.retenidas, (n) => n > retenidasD, 10000)
  await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await v.waitFor({ state: 'hidden' })
  comprobar(corte.retenidas > retenidasD, `[${d.nombre}] la pregunta se detuvo hasta cerrar la ventana`)
  corte.retener = null
  corte.soltar()
  await hasta(() => corte.consultas, (n) => n > consultasD, 15000)
  await abrir()
  const notaD = limpio(await hasta(nota, (t) => /sí quedó/.test(t ?? ''), 10000))
  await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await v.waitFor({ state: 'hidden' })
  await abrir()
  const sigue = limpio(await hasta(nota, (t) => /sí quedó/.test(t ?? ''), 5000))
  comprobar(notaD.startsWith(`${d.nota} que enviaste antes sí quedó: ${entroD?.numero}.`) && sigue === notaD,
    `[${d.nombre}] si la base contesta con la ventana cerrada, al volver a abrir dice que aquel quedó, y lo sigue diciendo al cerrar y abrir sin enviar: «${notaD}»`)
  const D2 = `${SUFIJO}d2`
  await d.llenar(v, pagina, D2, d.valores[1])
  await enviar()
  const errorD = await esperarVentana(pagina)
  const [otroD] = await hasta(() => d.contar(D2), (r) => r.length > 0)
  const deD = await d.contar(D)
  comprobar(!errorD && deD.length === 1 && Boolean(otroD) && otroD.numero !== entroD?.numero,
    `[${d.nombre}] y lo que se registra después es otro, sin repetir el primero (${entroD?.numero} una vez y ${otroD?.numero ?? 'nada'})${errorD ? ` (dijo «${errorD}»)` : ''}`)
  if (!d.alGuardar) {
    await abrir()
    comprobar((await v.locator('[data-envio-anterior]').count()) === 0, `[${d.nombre}] tras registrarlo, la ventana siguiente ya no trae la nota`)
    await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
  }
  await contexto.close()
}

// ---------------------------------------------------------------- 1. OS
await mismoEnvio({
  nombre: 'OS',
  clave: 'os',
  puesto: 'logistica',
  ruta: '/compras/servicios',
  nuevo: (p) => p.getByRole('button', { name: 'Nueva orden de servicio' }),
  enviar: 'Emitir orden de servicio',
  valores: ['800', '950'],
  yaQuedo: (n) => `Esta orden de servicio ya quedó registrada como ${n} la primera vez que la enviaste.`,
  nota: 'La orden de servicio',
  otra: 'otra',
  consulta: 'orden_servicio',
  async llenar(v, p, marca, monto) {
    await elegir(p, v.locator('#os-proveedor'), PROVEEDOR)
    await v.locator('#os-descripcion').fill(`Torneado de prueba ${marca}`)
    await escribirCodigo(v.locator('#os-codigo'), CODIGO)
    await v.locator('#os-monto').fill(monto)
    await v.locator('#os-detraccion').selectOption('037')
  },
  contar: (marca) => consulta(`select numero, monto::float as valor from ordenes_servicio where descripcion = $1 order by creado_en`, [`Torneado de prueba ${marca}`]),
  fila: (p, numero) => p.locator(`tr[data-servicio="${numero}"]`),
  alGuardar: async (p, f) => limpio(await p.locator('[role="status"]').first().innerText().catch(() => '')).includes(f?.numero ?? '¿?'),
})

// ---------------------------------------------------------------- 2. OC directa
const ocDirecta = {
  nombre: 'OC directa',
  clave: 'oc',
  puesto: 'logistica',
  ruta: '/compras/ordenes',
  nuevo: (p) => p.getByRole('button', { name: /Nueva OC directa/ }).first(),
  enviar: 'Emitir orden de compra',
  valores: ['100', '120'],
  yaQuedo: (n) => `Esta orden de compra ya quedó registrada como ${n} la primera vez que la enviaste.`,
  nota: 'La orden de compra',
  otra: 'otra',
  consulta: 'orden_compra',
  async llenar(v, p, marca, precio) {
    await elegir(p, v.locator('#ocd-proveedor'), PROVEEDOR)
    await v.locator('#ocd-motivo').fill(`Reposición de prueba ${marca}`)
    await elegir(p, v.locator('[id^="ocd-mat-"]').first(), MATERIAL)
    await v.locator('[id^="ocd-cant-"]').first().fill('3')
    await v.locator('[id^="ocd-precio-"]').first().fill(precio)
  },
  contar: (marca) =>
    consulta(
      `select o.numero, d.precio_unitario::float as valor from ordenes_compra_materiales o join orden_compra_material_detalles d on d.orden_compra_id = o.id
        where o.motivo = $1 order by o.creado_en`,
      [`Reposición de prueba ${marca}`],
    ),
  fila: (p, numero) => p.locator(`tr[data-compra="${numero}"]`),
}
await mismoEnvio(ocDirecta)

// ---------------------------------------------------------------- 3. RQ
await mismoEnvio({
  nombre: 'RQ',
  clave: 'rq',
  puesto: 'requerimientos',
  ruta: '/requerimientos',
  nuevo: (p) => p.getByRole('button', { name: 'Nuevo requerimiento', exact: true }),
  enviar: 'Registrar y mandar a Almacén',
  valores: ['3', '5'],
  yaQuedo: (n) => `Este requerimiento ya quedó registrado como ${n} la primera vez que lo enviaste.`,
  nota: 'El requerimiento',
  otra: 'otro',
  consulta: 'requerimiento',
  async llenar(v, p, marca, cantidad) {
    await v.locator('#rq-area').selectOption({ label: 'Maestranza' })
    await escribirCodigo(v.locator('#rq-codigo'), CODIGO)
    await v.locator('#rq-justificacion').fill(`Prueba del mismo envío ${marca}`)
    await v.getByRole('button', { name: 'Pedirlo como material nuevo' }).first().click()
    await v.locator('[id^="rq-desc-"]').first().fill(`Plancha LAF 2 mm ${marca}`)
    await v.locator('[id^="rq-cant-"]').first().fill(cantidad)
    await v.locator('[id^="rq-cat-"]').first().selectOption({ index: 1 })
  },
  contar: (marca) =>
    consulta(
      `select r.numero, l.cantidad::float as valor from requerimientos r join requerimiento_lineas l on l.requerimiento_id = r.id
        where r.justificacion = $1 order by r.creado_en`,
      [`Prueba del mismo envío ${marca}`],
    ),
  fila: (p, numero) => p.locator(`[data-rq="${numero}"]`),
})

// ---------------------------------------------------------------- 4. Subcontrato
await mismoEnvio({
  nombre: 'SC',
  clave: 'sc',
  puesto: 'administracion',
  ruta: '/subcontratos',
  nuevo: (p) => p.locator('[data-nuevo-subcontrato]'),
  enviar: 'Registrar subcontrato',
  valores: ['3500', '3600'],
  yaQuedo: (n) => `Este subcontrato ya quedó registrado como ${n} la primera vez que lo enviaste.`,
  nota: 'El subcontrato',
  otra: 'otro',
  consulta: 'subcontrato',
  async llenar(v, p, marca, monto) {
    await v.getByRole('combobox', { name: 'Subcontratista' }).click()
    await p.keyboard.type(SUFIJO)
    await p.getByRole('option', { name: new RegExp(SUFIJO) }).first().click()
    await v.locator('textarea[name="descripcion"]').fill(`Instalación de prueba ${marca}`)
    await escribirCodigo(v.locator('#sc-codigo'), CODIGO)
    await v.locator('input[name="monto"]').fill(monto)
    await v.locator('select[name="area"]').selectOption('PRD')
  },
  contar: (marca) => consulta(`select id, numero, monto::float as valor from subcontratos where descripcion = $1 order by creado_en`, [`Instalación de prueba ${marca}`]),
  fila: (p, numero) => p.locator(`tr[data-subcontrato="${numero}"]`),
  alGuardar: async (p, f) => {
    await p.waitForURL(/\/subcontratos\/[0-9a-f-]{36}$/, { timeout: 30000 }).catch(() => {})
    return p.url().endsWith(`/subcontratos/${f?.id}`)
  },
})

// ---------------------------------------------------------------- 5. Caja diaria
if (corre('caja')) {
  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/caja-diaria`, { waitUntil: 'networkidle' })
  const v = pagina.locator(VENTANA)
  const corte = await cortarRespuestas(pagina)
  const abrir = async () => {
    await pagina.locator(`[data-registrar-movimiento="${CAJA}"]`).click()
    await v.waitFor()
  }
  const descripcion = (marca) => `Comisión de prueba ${marca}`
  const llenar = async (marca, monto) => {
    await v.locator('select[name="tipo"]').selectOption('EGRESO')
    await v.locator('input[name="descripcion"]').fill(descripcion(marca))
    await v.locator('input[name="monto"]').fill(monto)
  }
  const registrar = () => v.getByRole('button', { name: 'Registrar', exact: true }).click()
  const aviso = () => v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => '')
  const movimientos = (marca) =>
    consulta(
      `select m.monto::float as valor from movimientos_caja m join cajas c on c.id = m.caja_id
        where c.nombre = $1 and m.descripcion = $2 and m.anulado_en is null`,
      [CAJA, descripcion(marca)],
    )
  async function sinRespuesta(marca) {
    corte.marca = marca
    corte.quedan = 1
    cortando = true
    await registrar()
    const texto = limpio(await hasta(aviso, (t) => /respuesta/.test(t ?? ''), 30000))
    cortando = false
    return texto
  }

  // a. Sin respuesta, y «Registrar» otra vez desde la misma ventana.
  const A = `${SUFIJO}a`
  await abrir()
  await llenar(A, '12.50')
  const corto = await sinRespuesta(A)
  await registrar()
  const error = await esperarVentana(pagina)
  const a = await movimientos(A)
  comprobar(corto.startsWith('No llegó la respuesta') && !error && a.length === 1 && !(await v.isVisible()),
    `[Caja] sin respuesta y «Registrar» otra vez: un movimiento y la ventana se cierra (${a.length})${error ? ` (dijo «${error}»)` : ''}`)

  // b. Sin respuesta, y otro importe en la misma ventana.
  const B = `${SUFIJO}b`
  await abrir()
  await llenar(B, '20')
  await sinRespuesta(B)
  await v.locator('input[name="monto"]').fill('25')
  await registrar()
  const yaQuedo = limpio(await hasta(aviso, (t) => /ya quedó/.test(t ?? ''), 30000))
  const estado = await hasta(() => laVentana(pagina), (e) => e.cursor && e.abiertos.length === 0, 5000)
  comprobar(yaQuedo === 'Este movimiento ya quedó registrado la primera vez que lo enviaste. Si cambiaste algo después, no se guardó: al cerrar, la pantalla muestra lo que quedó.',
    `[Caja] con otro importe dice que el primero ya quedó: «${yaQuedo}»`)
  comprobar(estado.neutro && estado.cursor && estado.envia === 0 && estado.botones.join() === 'Cerrar' && estado.abiertos.length === 0,
    `[Caja] sin rojo, con el cursor, los campos trabados y solo «Cerrar» (${JSON.stringify(estado)})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'mismo-envio-caja-ya-quedo.png') })
  await v.locator('form').getByRole('button', { name: 'Cerrar', exact: true }).click()
  await v.waitFor({ state: 'hidden' })
  const b = await movimientos(B)
  comprobar(b.length === 1 && b[0].valor === 20, `[Caja] queda uno, con S/ 20 de la primera vez (${JSON.stringify(b)})`)
  const seVe = await hasta(() => pagina.getByText(descripcion(B)).count(), (n) => n > 0)
  comprobar(seVe > 0, '[Caja] al cerrar, la caja lo muestra')

  // c. La siguiente ventana registra otro.
  const C = `${SUFIJO}c`
  await abrir()
  const limpia = (await v.locator('[role="alert"]').count()) === 0
  await llenar(C, '30')
  await registrar()
  const errorC = await esperarVentana(pagina)
  const c = await movimientos(C)
  comprobar(limpia && !errorC && c.length === 1, `[Caja] la ventana siguiente sale limpia y registra otro (${c.length})${errorC ? ` (dijo «${errorC}»)` : ''}`)

  // d. Sin respuesta desde el botón de la cuenta, «Cancelar» y abrir el de la caja:
  // las dos ventanas comparten el envío, y la segunda dice que aquel quedó.
  const D = `${SUFIJO}d`
  await abrir()
  await llenar(D, '40')
  await sinRespuesta(D)
  await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await v.waitFor({ state: 'hidden' })
  await pagina.locator('[data-registrar-movimiento="caja"]').click()
  await v.waitFor()
  const dice = limpio(await hasta(() => v.locator('[data-envio-anterior]').textContent({ timeout: 500 }).catch(() => ''), (t) => /sí quedó/.test(t ?? ''), 15000))
  // Con la cuenta en que quedó: desde el botón de la caja se elige la cuenta, y la nota no la daba (decimoséptima pasada).
  const nombra = new RegExp(`^El egreso que enviaste antes sí quedó: (S/|US\\$) 40\\.00 del \\d\\d/\\d\\d/\\d{4}, en ${CAJA}\\. Lo que registres ahora será otro\\.$`)
  comprobar(nombra.test(dice), `[Caja] desde el otro botón, la ventana dice que aquel egreso quedó y en qué cuenta: «${dice}»`)
  const D2 = `${SUFIJO}d2`
  const valorCaja = await v.locator('select[name="caja_id"] option', { hasText: CAJA }).first().getAttribute('value')
  await v.locator('select[name="caja_id"]').selectOption(valorCaja ?? '')
  await llenar(D2, '30')
  await registrar()
  const errorD = await esperarVentana(pagina)
  const d = await movimientos(D)
  const d2 = await movimientos(D2)
  comprobar(!errorD && d.length === 1 && d2.length === 1,
    `[Caja] y lo que se registra ahí es otro movimiento (${d.length} y ${d2.length})${errorD ? ` (dijo «${errorD}»)` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------- 6. «Sacar de la lista» sin respuesta
if (corre('lista')) {
  const { pagina, contexto } = await entrar('logistica')
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator('section[aria-labelledby="titulo-lista"] > div').filter({ hasText: NUMERO_LISTA })
  comprobar((await tarjeta.count()) === 1, `Logística ve ${NUMERO_LISTA} en la lista del conductor`)
  const corte = await cortarRespuestas(pagina)
  corte.marca = ocLista
  corte.quedan = 1
  corte.sinEnviar = true
  await tarjeta.getByRole('button', { name: 'Sacar de la lista' }).click()
  const v = pagina.locator(VENTANA)
  await v.waitFor()
  cortando = true
  await v.getByRole('button', { name: 'Sí, sacarla' }).click()
  await v.locator('[role="alert"]').waitFor({ timeout: 30000 }).catch(() => {})
  cortando = false
  const dentro = limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  const cursor = await hasta(() => pagina.evaluate((s) => document.activeElement === document.querySelector(s)?.querySelector('[role="alert"]'), VENTANA), Boolean, 5000)
  const detras = await tarjeta.locator('[role="alert"]').count()
  comprobar(dentro.startsWith('No llegó la respuesta') && cursor && detras === 0,
    `el aviso sale dentro de la ventana, con el cursor, y no detrás: «${dentro}» (cursor: ${cursor}, detrás: ${detras})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'mismo-envio-sacar-de-la-lista.png') })
  await v.getByRole('button', { name: 'Sí, sacarla' }).click()
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  const fuera = await hasta(() => tarjeta.count(), (n) => n === 0, 20000)
  const [lugar] = await consulta(`select posicion from programacion_recojo where orden_compra_id = $1`, [ocLista])
  comprobar(fuera === 0 && lugar?.posicion === null, `otra vez «Sí, sacarla»: sale de la lista, en la pantalla y en la base (${JSON.stringify(lugar)})`)
  await contexto.close()
}

// ---------------------------------------------------------------- 7. Diseño: el plano y su revisión
if (corre('planos')) {
  const CODIGO_PLANOS = `MISMO${SUFIJO.slice(-4)}_SR_O4_1_26/40`
  const { pagina, contexto } = await entrar('diseno')
  const corte = await cortarRespuestas(pagina)
  await pagina.goto(`${BASE}/diseno/codigo?${new URLSearchParams({ codigo: CODIGO_PLANOS })}`, { waitUntil: 'networkidle' })
  const pdf = (n) => ({ name: `${n}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${n} ${SUFIJO}\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n`) })
  const formPlano = pagina.locator('form').filter({ has: pagina.locator('#plano-numero') })
  const avisoPlano = () => formPlano.locator('[role="alert"], [role="status"]').first().textContent({ timeout: 500 }).catch(() => '')
  const planos = (numero) =>
    consulta(
      `select p.id, (select count(*)::int from codigo_plano_revisiones r where r.plano_id = p.id) as revisiones
         from codigo_planos p where p.codigo_interno = $1 and p.numero = $2 and p.anulado_en is null`,
      [CODIGO_PLANOS, numero],
    )
  async function llenarPlano(numero, archivo) {
    await pagina.fill('#plano-numero', numero)
    await pagina.fill('#plano-nombre', `Plano de prueba ${numero}`)
    await pagina.selectOption('#plano-area', { label: 'Maestranza' })
    await pagina.fill('#plano-peso', '10')
    await pagina.setInputFiles('#plano-pdf', archivo)
    await pagina.fill('#plano-observacion', `Marca ${SUFIJO} ${numero}`)
  }
  const cargar = () => formPlano.getByRole('button', { name: 'Cargar plano' }).click()
  const cargado = (numero) => pagina.locator('[role="status"]').filter({ hasText: `Plano ${numero} cargado` }).waitFor({ timeout: 30000 }).then(() => true, () => false)
  ruido = /status of 40[09]|Duplicate/

  // El plano, sin ventana: el 001 entra; el 002 sin respuesta y con otro PDF dice que ya quedó; el 003 entra.
  await llenarPlano('001', pdf('001'))
  await cargar()
  comprobar(await cargado('001'), '[Plano] el 001 entra')
  await llenarPlano('002', pdf('002'))
  corte.marca = `Marca ${SUFIJO} 002`
  corte.quedan = 2
  cortando = true
  await cargar()
  const corto = limpio(await hasta(avisoPlano, (t) => /respuesta/.test(t ?? ''), 60000))
  cortando = false
  await pagina.setInputFiles('#plano-pdf', pdf('002-otro'))
  await cargar()
  const yaQuedo = limpio(await hasta(avisoPlano, (t) => /primera vez/.test(t ?? ''), 60000))
  const neutro = await formPlano.locator('[role="alert"][data-ya-entro]').count()
  const p2 = await planos('002')
  comprobar(corto.startsWith('No llegó la respuesta') && /la primera vez que lo enviaste/.test(yaQuedo) && neutro === 1 && p2.length === 1,
    `[Plano] sin respuesta y con otro PDF dice sin rojo que ya quedó, y queda un plano: «${corto}» → «${yaQuedo}» (${p2.length})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'mismo-envio-plano-ya-quedo.png'), fullPage: true })
  await llenarPlano('003', pdf('003'))
  await cargar()
  comprobar((await cargado('003')) && (await planos('003')).length === 1, '[Plano] el siguiente entra con otro id')

  // La revisión del 001, en su ventana.
  const v = pagina.locator(VENTANA)
  const fila = pagina.locator('li, tr, article, div').filter({ hasText: 'Plano de prueba 001' }).filter({ has: pagina.getByRole('button', { name: 'Subir revisión' }) }).last()
  const revisiones = async () => (await planos('001'))[0]?.revisiones ?? -1
  const aviso = () => v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => '')
  const abrir = async () => {
    await pagina.waitForLoadState('networkidle')
    await fila.getByRole('button', { name: 'Subir revisión' }).click()
    await v.waitFor()
  }
  const subir = () => v.getByRole('button', { name: 'Subir revisión', exact: true }).click()
  const antes = await revisiones()
  await abrir()
  await v.locator('textarea[name="cambios"]').fill(`Revisión de prueba ${SUFIJO}`)
  await v.locator('input[name="archivo"]').setInputFiles(pdf('001-r1'))
  corte.marca = `Revisión de prueba ${SUFIJO}`
  corte.quedan = 2
  cortando = true
  await subir()
  const sinRespuesta = limpio(await hasta(aviso, (t) => /respuesta/.test(t ?? ''), 60000))
  cortando = false
  await v.locator('input[name="archivo"]').setInputFiles(pdf('001-r1-otro'))
  await subir()
  const yaQuedoRevision = limpio(await hasta(aviso, (t) => /ya quedó|primera vez/.test(t ?? ''), 60000))
  const estado = await hasta(() => laVentana(pagina), (e) => e.cursor && e.abiertos.length === 0, 5000)
  comprobar(sinRespuesta.startsWith('No llegó la respuesta') && /la primera vez que lo enviaste\. Si cambiaste algo después, no se guardó/.test(yaQuedoRevision) && (await revisiones()) === antes + 1,
    `[Revisión] sin respuesta y con otro PDF dice que ya quedó, y entra una: «${yaQuedoRevision}» (${(await revisiones()) - antes})`)
  comprobar(estado.neutro && estado.cursor && estado.envia === 0 && estado.botones.join() === 'Cerrar' && estado.abiertos.length === 0,
    `[Revisión] sin rojo, con el cursor, los campos trabados y solo «Cerrar» (${JSON.stringify(estado)})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'mismo-envio-revision-ya-quedo.png') })
  await v.locator('form').getByRole('button', { name: 'Cerrar', exact: true }).click()
  await v.waitFor({ state: 'hidden' })
  await abrir()
  const limpia = (await v.locator('[role="alert"]').count()) === 0
  await v.locator('textarea[name="cambios"]').fill(`Otra revisión de prueba ${SUFIJO}`)
  await v.locator('input[name="archivo"]').setInputFiles(pdf('001-r2'))
  await subir()
  const errorRevision = await esperarVentana(pagina)
  comprobar(limpia && !errorRevision && (await hasta(revisiones, (n) => n === antes + 2)) === antes + 2,
    `[Revisión] la ventana siguiente sale limpia y sube otra${errorRevision ? ` (dijo «${errorRevision}»)` : ''}`)
  const ids = [...(await planos('001')), ...(await planos('002'))].map((f) => f.id)
  const sueltos = await consulta(
    `select o.name from storage.objects o where o.bucket_id = 'planos-codigo' and split_part(o.name, '/', 1) = any($1::text[])
        and not exists (select 1 from codigo_plano_revisiones r where r.ruta = o.name)`,
    [ids],
  )
  comprobar(ids.length === 2 && sueltos.length === 0, `[Plano y revisión] ningún PDF suelto en Storage (${sueltos.map((f) => f.name).join(', ') || 'ninguno'})`)
  ruido = null
  await contexto.close()
}

// ---------------------------------------------------------------- 8. La OC directa desde la pantalla de otra cuenta
if (corre('cuenta')) await conLaSegundaDeLogistica(async () => {
  const d = ocDirecta
  const { pagina, contexto } = await entrar('logistica')
  const v = pagina.locator(VENTANA)
  const corte = await cortarRespuestas(pagina)
  const ir = (p = pagina) => p.goto(`${BASE}${d.ruta}`, { waitUntil: 'networkidle' })
  const abrir = async (p = pagina) => {
    await d.nuevo(p).click()
    await p.locator(VENTANA).waitFor()
  }
  // Tras «No llegó la respuesta», al cerrar la pantalla se pone al día: se espera a que termine.
  const cancelar = async ({ sinEsperar = false } = {}) => {
    await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await v.waitFor({ state: 'hidden' })
    if (!sinEsperar) await pagina.waitForLoadState('networkidle')
  }
  const aviso = () => v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => '')
  const nota = () => v.locator('[data-envio-anterior]').textContent({ timeout: 500 }).catch(() => '')
  const enviar = (p = pagina) => p.locator(VENTANA).getByRole('button', { name: d.enviar, exact: true }).click()
  async function sinRespuesta(marca) {
    corte.marca = marca
    corte.quedan = 1
    cortando = true
    await enviar()
    const texto = limpio(await hasta(aviso, (t) => /respuesta/.test(t ?? ''), 30000))
    cortando = false
    return texto
  }
  const autor = async (numero) =>
    (await consulta(`select u.correo from ordenes_compra_materiales o join usuarios u on u.id = o.creado_por where o.numero = $1`, [numero]))[0]?.correo
  const pendientesDe = (puesto) =>
    pagina.evaluate((prefijo) => Object.keys(sessionStorage).filter((k) => k.startsWith(prefijo)), `metal-work:envio-pendiente:${ids[CUENTAS[puesto]]}:`)
  // Como nombra la cuenta el menú: el cargo, o el rol si no lo tiene; y el nombre, como lo pinta el layout.
  const cuentaDe = async (puesto) =>
    (await consulta(
      `select coalesce(nullif(trim(u.cargo), ''), r.nombre) as puesto, trim(u.nombres || ' ' || u.apellidos) as nombre
         from usuarios u join roles r on r.id = u.rol_id where u.correo = $1`,
      [CUENTAS[puesto]],
    ))[0]
  const { puesto: LOGISTICA, nombre: NOMBRE_LOGISTICA } = await cuentaDe('logistica')
  const { puesto: ADMINISTRACION } = await cuentaDe('administracion')
  const { puesto: PUESTO_DOS, nombre: NOMBRE_DOS } = await cuentaDe('logistica_dos')
  const TRABADA = `Esta pantalla se abrió con la cuenta de ${LOGISTICA}, y en otra pestaña entró la de ${ADMINISTRACION}: desde aquí no se envía nada. Para seguir aquí con lo escrito, vuelve a entrar con ${LOGISTICA} en esa pestaña. Si recargas, sigues con ${ADMINISTRACION} y se pierde lo escrito aquí.`
  // Si las dos son del mismo puesto, cada una va con su nombre.
  const PRIMERA = `${NOMBRE_LOGISTICA} (${LOGISTICA})`
  const SEGUNDA = `${NOMBRE_DOS} (${PUESTO_DOS})`
  const TRABADA_DOS = `Esta pantalla se abrió con la cuenta de ${PRIMERA}, y en otra pestaña entró la de ${SEGUNDA}: desde aquí no se envía nada. Para seguir aquí con lo escrito, vuelve a entrar con ${PRIMERA} en esa pestaña. Si recargas, sigues con ${SEGUNDA} y se pierde lo escrito aquí.`
  // Mientras nada dijo quién entró: solo la cookie, que lleva el id y no el puesto.
  const TRABADA_SIN_PUESTO = `Esta pantalla se abrió con la cuenta de ${LOGISTICA}, y en otra pestaña entró otra: desde aquí no se envía nada. Para seguir aquí con lo escrito, vuelve a entrar con ${LOGISTICA} en esa pestaña. Si recargas, sigues con la cuenta que entró y se pierde lo escrito aquí.`
  const TRABA = 'dialog[data-traba-otra-cuenta]'
  const deOtraCuenta = (p = pagina) => p.locator(`${TRABA}[open] [data-otra-cuenta]`).textContent({ timeout: 500 }).catch(() => '')
  /** La traba de la pantalla: un `<dialog>` modal, con el cursor adentro y solo «Recargar la pantalla». */
  const laTraba = async (p = pagina) => {
    const e = await p.evaluate((selector) => {
      const t = document.querySelector(selector)
      return {
        abierta: Boolean(t?.open),
        modal: Boolean(t?.matches(':modal')),
        cursor: Boolean(t?.contains(document.activeElement)),
        botones: [...(t?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim()),
      }
    }, TRABA)
    return { ...e, trabada: e.abierta && e.modal && e.cursor && e.botones.join() === 'Recargar la pantalla' }
  }
  /** Si un toque llegaría a `objetivo`: con la traba puesta, lo de detrás es inerte y no llega. */
  const tocable = (objetivo) => objetivo.click({ trial: true, timeout: 1500 }).then(() => true, () => false)
  // Las acciones que salen de cada pestaña, para saber si algo con la marca salió.
  const salidas = []
  const anotarSalidas = (p) =>
    p.on('request', (q) => {
      if (q.method() === 'POST' && q.headers()['next-action']) salidas.push(q.postData() ?? '')
    })
  const salieron = (marca) => salidas.filter((cuerpo) => cuerpo.includes(marca)).length
  anotarSalidas(pagina)
  /** El formulario de la ventana enviado por código, como un Enter que llegara a pesar de la traba. */
  const forzar = (p = pagina) => p.locator(VENTANA).locator('form').first().evaluate((f) => f.requestSubmit())
  const unRato = (p = pagina, ms = 1500) => p.evaluate((espera) => new Promise((listo) => setTimeout(listo, espera)), ms)

  /**
   * `otra` entra en otra pestaña sin avisar, y en esta se emite antes de que la
   * base conteste la pregunta de la ventana (se detiene): Next despacha las
   * acciones de una en una y el envío sale detrás, con la sesión que haya. Solo
   * pasa sin la cookie a la vista: con ella, el envío no sale. Su respuesta se
   * pierde: con la traba puesta no se ve «No llegó la respuesta», así que el
   * corte se da por terminado después (`cortando`). Con `entra: false` no se
   * espera la fila: se mira, cuando el servidor ya contestó, que no esté.
   */
  async function carrera(marca, precio, { otra = 'logistica_dos', entra = true } = {}) {
    await enOtraPestana(contexto, otra, { sinAviso: true })
    corte.retener = d.consulta
    corte.retenerSinIds = true
    const retenidas = corte.retenidas
    await abrir()
    await hasta(() => corte.retenidas, (n) => n > retenidas, 15000)
    await d.llenar(v, pagina, marca, precio)
    corte.marca = marca
    corte.quedan = 1
    cortando = true
    // El envío falla en el navegador cuando el servidor ya contestó.
    const fallo = pagina.waitForEvent('requestfailed', { predicate: (q) => (q.postData() ?? '').includes(marca), timeout: 60000 }).catch(() => null)
    await enviar()
    corte.retener = null
    corte.retenerSinIds = false
    corte.soltar()
    const [entro] = entra ? await hasta(() => d.contar(marca), (r) => r.length > 0, 30000) : []
    const dijo = limpio(await hasta(deOtraCuenta, (t) => Boolean(t), 15000))
    await fallo
    await unRato(pagina, 300)
    return { fila: entro ?? (await d.contar(marca))[0], dijo }
  }

  // a. Con la ventana abierta y escrita, en otra pestaña entra Administración.
  // La pantalla entera queda debajo de la traba en cuanto cambia la cookie: lo
  // de detrás no recibe el toque y ni un envío forzado sale. Antes la traba iba
  // en el pie de cada ventana y dejaba fuera las que no lo usan, los botones de
  // la pantalla y lo que salía antes del aviso (vigesimosegunda pasada).
  await ir()
  const G = `${SUFIJO}xg`
  await abrir()
  await d.llenar(v, pagina, G, '130')
  await v.locator('#ocd-motivo').focus()
  // Una tecla, como quien escribe: así el cursor que lleva la traba cuenta como
  // del teclado (`:focus-visible`), que es cuando aparecía el anillo.
  await pagina.keyboard.press('End')
  await enOtraPestana(contexto, 'administracion')
  const alMomento = limpio(await hasta(deOtraCuenta, (t) => limpio(t) === TRABADA, 15000))
  const enA = await laTraba()
  const detras = await tocable(v.locator('#ocd-motivo'))
  await forzar()
  await unRato()
  comprobar(alMomento === TRABADA && enA.trabada && !detras && salieron(G) === 0 && (await d.contar(G)).length === 0,
    `[Otra cuenta] con la ventana abierta entra Administración en otra pestaña: la pantalla se traba entera, con el cursor en la traba, lo de detrás sin toque y un envío forzado sin salir: «${alMomento}» (${JSON.stringify({ ...enA, detras, salieron: salieron(G) })})`)
  // El texto tiene el cursor para que el lector lo lea, pero no es un campo: sin
  // anillo, y sin `aria-describedby` hacia el mismo texto, que se oía dos veces
  // (vigesimotercera pasada).
  const anillo = await pagina.evaluate((selector) => {
    const traba = document.querySelector(selector)
    const p = traba?.querySelector('[data-otra-cuenta]')
    return {
      cursor: Boolean(p) && p === document.activeElement,
      teclado: Boolean(p?.matches(':focus-visible')),
      estilo: p ? getComputedStyle(p).outlineStyle : '',
      describe: traba?.getAttribute('aria-describedby') ?? null,
    }
  }, TRABA)
  comprobar(anillo.cursor && anillo.teclado && anillo.estilo === 'none' && anillo.describe === null,
    `[Otra cuenta] el texto de la traba tiene el cursor del teclado, sin anillo de campo, y no se describe dos veces (${JSON.stringify(anillo)})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'mismo-envio-otra-cuenta.png') })
  // Un toque en el fondo deja el cursor fuera de la traba; Escape, dos veces, no
  // la cierra ni cierra la ventana de detrás con lo escrito.
  await pagina.mouse.click(5, 5)
  await pagina.keyboard.press('Escape')
  await pagina.keyboard.press('Escape')
  await unRato(pagina, 500)
  const trasEscape = { traba: (await laTraba()).modal, ventana: await v.isVisible(), cursor: await pagina.evaluate(() => document.activeElement?.tagName) }
  comprobar(trasEscape.traba && trasEscape.ventana,
    `[Otra cuenta] tras un toque en el fondo, Escape no cierra la traba ni la ventana de detrás (${JSON.stringify(trasEscape)})`)
  await enOtraPestana(contexto, 'logistica')
  await hasta(deOtraCuenta, (t) => !t, 15000)
  const escrito = await v.locator('#ocd-motivo').inputValue()
  const libre = await laVentana(pagina)
  const vuelta = await pagina.evaluate(() => ({
    cursor: document.activeElement?.id ?? '',
    anuncio: document.querySelector('[data-volvio-la-cuenta]')?.textContent ?? '',
  }))
  comprobar(escrito === `Reposición de prueba ${G}` && libre.abiertos.length > 0 && libre.envia === 1 && vuelta.cursor === 'ocd-motivo'
    && vuelta.anuncio === `Volvió la cuenta de ${NOMBRE_LOGISTICA} (${LOGISTICA}): puedes seguir donde estabas.`,
    `[Otra cuenta] de vuelta Logística, se destraba con lo escrito, el cursor donde estaba y lo anuncia (${JSON.stringify({ escrito, abiertos: libre.abiertos.length, envia: libre.envia, ...vuelta })})`)
  await enviar()
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  const [deG] = await hasta(() => d.contar(G), (r) => r.length > 0)
  comprobar(Boolean(deG) && (await autor(deG.numero)) === CUENTAS.logistica && (await d.contar(G)).length === 1,
    `[Otra cuenta] y emite ${deG?.numero ?? 'nada'} a nombre de Logística, una vez`)

  // b. El hueco: la sesión cambió y nada lo dijo todavía —un navegador sin el
  // aviso de la cookie (`cookieStore`), sin el de la otra pestaña y sin volver a
  // esta—. Antes lo emitido en ese rato entraba a nombre de Administración
  // (vigesimosegunda pasada); ahora el toque mira la cookie, no sale y traba.
  const pb = esperarReactAlNavegar(await contexto.newPage())
  await pb.addInitScript(() => Object.defineProperty(window, 'cookieStore', { value: undefined }))
  pb.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`logistica (b): ${m.text().slice(0, 300)}`)
  })
  anotarSalidas(pb)
  const vb = pb.locator(VENTANA)
  const B = `${SUFIJO}xb`
  await ir(pb)
  await abrir(pb)
  await d.llenar(vb, pb, B, '135')
  await enOtraPestana(contexto, 'administracion', { sinAviso: true })
  const antesDelToque = await deOtraCuenta(pb)
  await enviar(pb)
  const alTocar = limpio(await hasta(() => deOtraCuenta(pb), (t) => Boolean(t), 5000))
  const enB = await laTraba(pb)
  await unRato(pb)
  comprobar(!antesDelToque && alTocar === TRABADA_SIN_PUESTO && enB.trabada && salieron(B) === 0 && (await d.contar(B)).length === 0,
    `[Otra cuenta] sin ningún aviso todavía, el toque de emitir mira la cookie: no sale y la pantalla se traba: «${alTocar}» (${JSON.stringify({ antesDelToque, ...enB, salieron: salieron(B) })})`)
  // Vuelve Logística, tampoco avisa: al volver a la pestaña se mira la cookie.
  await enOtraPestana(contexto, 'logistica', { sinAviso: true })
  await pb.evaluate(() => window.dispatchEvent(new Event('focus')))
  const libreB = await hasta(() => deOtraCuenta(pb), (t) => !t, 5000)
  await enviar(pb)
  await vb.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  const [deB] = await hasta(() => d.contar(B), (r) => r.length > 0)
  comprobar(!libreB && Boolean(deB) && (await autor(deB.numero)) === CUENTAS.logistica && (await d.contar(B)).length === 1,
    `[Otra cuenta] de vuelta Logística, al volver a la pestaña se destraba y emite ${deB?.numero ?? 'nada'} a su nombre, una vez`)
  await pb.close()

  // c. Un aviso viejo —la página de otra pestaña que se pintó con Logística y
  // avisó tarde— no destraba lo que la cookie dice que es de Administración.
  // Antes el último aviso mandaba (vigesimosegunda pasada).
  await enOtraPestana(contexto, 'administracion')
  await hasta(deOtraCuenta, (t) => limpio(t) === TRABADA, 15000)
  const vieja = await contexto.newPage()
  await vieja.goto(`${BASE}/sin-conexion.html`)
  await vieja.evaluate(
    (cuenta) => new BroadcastChannel('metal-work:cuenta').postMessage(cuenta),
    { usuario: ids[CUENTAS.logistica], puesto: LOGISTICA, nombre: NOMBRE_LOGISTICA },
  )
  await unRato()
  const trasElViejo = limpio(await deOtraCuenta())
  await vieja.close()
  comprobar(trasElViejo === TRABADA && (await laTraba()).trabada,
    `[Otra cuenta] un aviso viejo de Logística no destraba la pantalla mientras la sesión es de Administración: «${trasElViejo}»`)
  await enOtraPestana(contexto, 'logistica')
  await hasta(deOtraCuenta, (t) => !t, 15000)

  // d. Lo de Logística queda pendiente y en otra pestaña entra Administración:
  // la pantalla se traba sin abrir nada y no hay botón que tocar; de vuelta
  // Logística, sin recargar, dice que lo suyo quedó.
  await ir()
  const H = `${SUFIJO}xh`
  await abrir()
  await d.llenar(v, pagina, H, '160')
  await sinRespuesta(H)
  await cancelar()
  const [deH] = await hasta(() => d.contar(H), (r) => r.length > 0)
  await enOtraPestana(contexto, 'administracion')
  const conPendiente = limpio(await hasta(deOtraCuenta, (t) => limpio(t) === TRABADA, 15000))
  const enD = await laTraba()
  const nueva = await tocable(d.nuevo(pagina))
  comprobar(conPendiente === TRABADA && enD.trabada && !nueva && (await d.contar(H)).length === 1,
    `[Otra cuenta] con ${deH?.numero ?? 'nada'} pendiente y Administración en otra pestaña, la pantalla se traba y «Nueva OC directa» no recibe el toque (${JSON.stringify(enD)})`)
  await enOtraPestana(contexto, 'logistica')
  await hasta(deOtraCuenta, (t) => !t, 15000)
  await abrir()
  const alVolver = limpio(await hasta(nota, (t) => /sí quedó/.test(t ?? ''), 15000))
  comprobar(alVolver.startsWith(`La orden de compra que enviaste antes sí quedó: ${deH?.numero}.`) && (await d.contar(H)).length === 1,
    `[Otra cuenta] de vuelta Logística, sin recargar, dice que ${deH?.numero ?? 'nada'} quedó: «${alVolver}»`)
  await cancelar()

  // Sin la cookie a la vista —un navegador que no la deja leer—, quedan el aviso
  // de la otra pestaña y la pregunta al abrir.
  await pagina.addInitScript(() => {
    const propia = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      get() {
        return propia.get.call(this).split('; ').filter((c) => !/^sb-.+-auth-token/.test(c)).join('; ')
      },
      set(valor) {
        propia.set.call(this, valor)
      },
    })
  })
  await ir()
  const ciega = await pagina.evaluate(() => !/sb-.+-auth-token/.test(document.cookie))

  // e. Sin el aviso de la otra pestaña, la pregunta al abrir traba. Vale la
  // respuesta de la última pregunta aunque la de una anterior —hecha con la
  // sesión de Logística— llegue antes: antes esa gastaba la noticia y la de
  // «otra cuenta» se ignoraba (vigesimosegunda pasada). La primera llega al
  // servidor y su respuesta se detiene; Next despacha la segunda detrás.
  corte.retener = d.consulta
  corte.retenerSinIds = true
  corte.retenerRespuesta = true
  const retenidas = corte.retenidas
  await abrir()
  await hasta(() => corte.retenidas, (n) => n > retenidas, 15000)
  corte.retener = null
  corte.retenerSinIds = false
  corte.retenerRespuesta = false
  await cancelar({ sinEsperar: true })
  await enOtraPestana(contexto, 'administracion', { sinAviso: true })
  const nadaLoDijo = !(await deOtraCuenta())
  await abrir()
  corte.soltar()
  const alAbrir = limpio(await hasta(deOtraCuenta, (t) => limpio(t) === TRABADA, 15000))
  comprobar(ciega && nadaLoDijo && alAbrir === TRABADA && (await laTraba()).trabada,
    `[Otra cuenta] sin la cookie y sin el aviso, la pregunta al abrir traba aunque antes conteste la anterior, hecha con Logística: «${alAbrir}» (${JSON.stringify({ ciega, nadaLoDijo })})`)
  // Vuelve Logística con el aviso de su pestaña: la destraba.
  await enOtraPestana(contexto, 'logistica')
  const destrabada = await hasta(deOtraCuenta, (t) => !t, 15000)
  comprobar(!destrabada, '[Otra cuenta] sin la cookie, el aviso de la pestaña de Logística destraba la pantalla')
  await cancelar()

  // f. Lo que sale antes de que la base conteste esa pregunta sale con la
  // sesión que haya: es el borde que queda sin la cookie. Con la de
  // Administración no entra: compra solo lo de su RQA, y la base le rechaza la
  // OC directa (migración 20261026160000). La pantalla se traba al contestar; de
  // vuelta Logística, la ventana no dice que quedó nada y lo que envía entra una
  // vez, a su nombre.
  const A = `${SUFIJO}xa`
  const ca = await carrera(A, '135', { otra: 'administracion', entra: false })
  comprobar(!ca.fila && ca.dijo === TRABADA,
    `[Otra cuenta] sin la cookie, lo emitido con la sesión de Administración antes de que la base conteste no entra (compra solo lo de su RQA) y la pantalla se traba al contestar: «${ca.dijo}» (${ca.fila?.numero ?? 'nada'})`)
  await enOtraPestana(contexto, 'logistica')
  await hasta(deOtraCuenta, (t) => !t, 15000)
  await cancelar()
  cortando = false
  const preguntadas = corte.consultas
  await abrir()
  await hasta(() => corte.consultas, (n) => n > preguntadas, 15000)
  await unRato(pagina, 300)
  const nadaQuedo = limpio(await nota())
  await d.llenar(v, pagina, A, '135')
  await enviar()
  const errorA = await esperarVentana(pagina)
  const deA = await hasta(() => d.contar(A), (r) => r.length > 0, 15000)
  comprobar(!nadaQuedo && !errorA && deA.length === 1 && (await autor(deA[0].numero)) === CUENTAS.logistica,
    `[Otra cuenta] de vuelta Logística, la ventana no dice que quedó nada y lo que envía entra una vez, a su nombre (${deA.map((f) => f.numero).join(', ') || 'nada'}${nadaQuedo ? `; dijo «${nadaQuedo}»` : ''}${errorA ? `; avisó «${errorA}»` : ''})`)

  // Con otra persona del mismo puesto, sí entra a su nombre. La traba nombra a
  // las dos con su nombre, y de vuelta la primera, la ventana dice cuál quedó y
  // a nombre de quién, también con su nombre: «a nombre de Logística», dicho a
  // otra persona de Logística, no diría quién fue.
  const C = `${SUFIJO}xc`
  const c = await carrera(C, '140')
  comprobar(Boolean(c.fila) && (await autor(c.fila.numero)) === CUENTAS.logistica_dos && c.dijo === TRABADA_DOS,
    `[Otra cuenta] sin la cookie, lo emitido antes de que la base conteste entra a nombre de ${SEGUNDA} (${c.fila?.numero ?? 'nada'}) y la traba nombra a las dos con su nombre: «${c.dijo}»`)
  await enOtraPestana(contexto, 'logistica')
  await hasta(deOtraCuenta, (t) => !t, 15000)
  await cancelar()
  cortando = false
  await abrir()
  const aNombre = limpio(await hasta(nota, (t) => /sí quedó/.test(t ?? ''), 15000))
  comprobar(aNombre === `La orden de compra que se envió antes desde esta pestaña sí quedó, a nombre de ${SEGUNDA}, que tenía la sesión: ${c.fila?.numero}. Lo que registres ahora será otra.`,
    `[Otra cuenta] de vuelta ${PRIMERA}, la ventana dice cuál quedó y a nombre de quién, con su nombre: «${aNombre}»`)
  await cancelar()
  comprobar((await d.contar(C)).length === 1, `[Otra cuenta] ${c.fila?.numero} está una vez`)

  // g. Otra vez, y «Recargar la pantalla» con la segunda: lo ve como suyo y
  // suelta lo de la primera. Antes la ventana solo miraba lo de la cuenta
  // pintada, y el reintento entraba dos veces (vigésima pasada).
  const D = `${SUFIJO}xd`
  const dd = await carrera(D, '150')
  await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }), pagina.locator(TRABA).getByRole('button', { name: 'Recargar la pantalla' }).click()])
  await pagina.waitForLoadState('networkidle')
  cortando = false
  const recargada = new URL(pagina.url()).pathname
  await abrir()
  const suya = limpio(await hasta(nota, (t) => /sí quedó/.test(t ?? ''), 15000))
  const deLogistica = await pendientesDe('logistica')
  comprobar(recargada === d.ruta && Boolean(dd.fila) && suya.startsWith(`La orden de compra que enviaste antes sí quedó: ${dd.fila?.numero}.`) && deLogistica.length === 0,
    `[Otra cuenta] «Recargar la pantalla» la pinta con ${SEGUNDA} (${recargada}): dice que ${dd.fila?.numero ?? 'nada'} quedó y suelta lo de la primera: «${suya}» (${deLogistica.length} llaves de la primera)`)
  await cancelar()
  comprobar((await d.contar(D)).length === 1, `[Otra cuenta] ${dd.fila?.numero} está una vez`)
  await contexto.close()

  // h. La cadena se corta a la mitad: la OC ya entró y su comprobante terminaba
  // de subir cuando en otra pestaña entró Administración. Antes el comprobante se
  // anotaba con la sesión de Administración; ahora no se anota, la ventana se
  // cierra diciendo que falta, y el archivo de Logística se quita cuando ella
  // vuelve (vigesimotercera pasada). Con la cookie a la vista, en una pestaña nueva.
  const { pagina: ph, contexto: ch } = await entrar('logistica')
  const vh = ph.locator(VENTANA)
  const K = `${SUFIJO}xk`
  const subida = { retenidas: 0, esperan: [] }
  await ph.route((u) => u.pathname.includes('/storage/v1/object/documentos-compras/'), async (r) => {
    if (r.request().method() !== 'POST') return r.continue()
    // Llega a Storage con la sesión de Logística; lo que se detiene es la respuesta.
    const respuesta = await r.fetch()
    subida.retenidas++
    await new Promise((listo) => subida.esperan.push(listo))
    return r.fulfill({ response: respuesta })
  })
  await ir(ph)
  await abrir(ph)
  await d.llenar(vh, ph, K, '170')
  await vh.locator('#ocd-comprobante').selectOption('false')
  await vh.locator('#ocd-factura').setInputFiles({ name: `boleta-${K}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${K}\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n`) })
  await unRato(ph, 800)
  await enviar(ph)
  await hasta(() => subida.retenidas, (n) => n > 0, 30000)
  const [deK] = await hasta(() => d.contar(K), (r) => r.length > 0, 30000)
  const ocK = (await consulta(`select id from ordenes_compra_materiales where numero = $1`, [deK?.numero]))[0]?.id
  const enStorage = async () =>
    (await consulta(`select owner_id::text as dueno from storage.objects where bucket_id = 'documentos-compras' and name like $1`, [`compra/${ocK}/%`]))
  const documentos = async () =>
    (await consulta(`select u.correo from documentos_compra_material x join usuarios u on u.id = x.subido_por where x.orden_compra_id = $1`, [ocK]))
  await enOtraPestana(ch, 'administracion')
  await hasta(() => deOtraCuenta(ph), (t) => Boolean(t), 15000)
  for (const listo of subida.esperan.splice(0)) listo()
  const avisoK = ph.getByText(/no se adjuntó/)
  await hasta(() => avisoK.count(), (n) => n > 0, 30000)
  const dijoK = limpio(await avisoK.first().textContent())
  await unRato(ph)
  const trabadaK = await laTraba(ph)
  const subidoK = await enStorage()
  const anotadosK = await documentos()
  comprobar(Boolean(deK) && (await autor(deK.numero)) === CUENTAS.logistica && trabadaK.trabada && !(await vh.isVisible())
    && /no se adjuntó: en otra pestaña entró otra cuenta\. Adjúntal[oa] desde la lista\./.test(dijoK)
    && anotadosK.length === 0 && subidoK.length === 1 && subidoK[0].dueno === ids[CUENTAS.logistica],
    `[Otra cuenta] la OC ${deK?.numero ?? 'nada'} entra a nombre de Logística y su comprobante, cortado por Administración, no se anota con ella: la ventana se cierra y dice que falta (${JSON.stringify({ dijoK, anotados: anotadosK.length, enStorage: subidoK.length })})`)
  // La OC ya sale en la lista con la respuesta de la emisión: lo que dice que la
  // pantalla se puso al día es el refresco que esperaba a la cuenta, contado
  // desde que vuelve (vigesimoquinta pasada: con la traba puesta no hubo ninguno).
  let refrescosK = 0
  const contarRefresco = (q) => {
    const h = q.headers()
    if (q.method() === 'GET' && h.rsc === '1' && !h['next-router-prefetch'] && new URL(q.url()).pathname === new URL(`${BASE}${d.ruta}`).pathname) refrescosK++
  }
  const refrescosConTraba = { n: 0 }
  ph.on('request', contarRefresco)
  await unRato(ph)
  refrescosConTraba.n = refrescosK
  refrescosK = 0
  await enOtraPestana(ch, 'logistica')
  await hasta(() => deOtraCuenta(ph), (t) => !t, 15000)
  // El aviso nació con la traba puesta, fuera del árbol del lector. Al volver,
  // la ventana ya no está: el cursor va al aviso y el anuncio no dice «puedes
  // seguir donde estabas» (vigesimocuarta pasada). Puede sumar otros avisos que
  // cambiaron mientras tanto, pero no repite el que lee el cursor (vigesimoquinta).
  const vueltaK = await ph.evaluate(() => ({
    cursor: (document.activeElement?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    enElCuerpo: document.activeElement === document.body,
    anuncio: document.querySelector('[data-volvio-la-cuenta]')?.textContent ?? '',
  }))
  comprobar(/no se adjuntó: en otra pestaña entró otra cuenta/.test(vueltaK.cursor) && !vueltaK.enElCuerpo
    && (vueltaK.anuncio === `Volvió la cuenta de ${NOMBRE_LOGISTICA} (${LOGISTICA}).` || vueltaK.anuncio.startsWith(`Volvió la cuenta de ${NOMBRE_LOGISTICA} (${LOGISTICA}). Mientras tanto: `))
    && !/puedes seguir|no se adjuntó/.test(vueltaK.anuncio),
    `[Otra cuenta] de vuelta Logística, el cursor va al aviso de la OC, que nació con la traba puesta, y el anuncio no dice «puedes seguir donde estabas» (${JSON.stringify(vueltaK)})`)
  const quitado = await hasta(enStorage, (r) => r.length === 0, 15000)
  const refrescos = await hasta(() => refrescosK, (n) => n > 0, 15000)
  ph.off('request', contarRefresco)
  const enLista = await hasta(() => d.fila(ph, deK?.numero).count(), (n) => n > 0, 15000)
  comprobar(quitado.length === 0 && refrescosConTraba.n === 0 && refrescos > 0 && enLista > 0 && (await documentos()).length === 0,
    `[Otra cuenta] de vuelta Logística, el comprobante suelto se quita de Storage y la lista se pone al día con ${deK?.numero ?? 'nada'}, con la traba no (${JSON.stringify({ enStorage: quitado.length, refrescosConTraba: refrescosConTraba.n, refrescos, enLista })})`)
  await ph.unrouteAll({ behavior: 'ignoreErrors' })
  await ch.close()
})

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.slice(0, 3).join(' | ')}` : ''}`)
await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} FALLAS` : '\nTodo en orden.')
process.exit(fallas.length ? 1 : 0)
