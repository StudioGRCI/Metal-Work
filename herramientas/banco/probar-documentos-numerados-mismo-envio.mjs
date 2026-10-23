/**
 * Clic real sobre la decimosexta pasada (migración 20261023100000): los
 * documentos numerados y la caja reconocen su mismo envío. Con la cuenta de
 * cada puesto, nunca ADMIN. En cada documento:
 *
 *   a. La respuesta no llega; «Cancelar» pone la lista al día con lo que sí
 *      entró. Al volver a abrir, la ventana pregunta a la base y dice, sin
 *      rojo, que aquel quedó y con qué número; lo que se registra ahí es otro.
 *   b. Lo mismo, pero se envía otro importe antes de que la base conteste esa
 *      pregunta: la ventana dice sin rojo que el primero ya quedó, con su
 *      número, traba los campos, solo ofrece «Cerrar» y se lleva el cursor; la
 *      respuesta tardía de la pregunta no se pinta encima. Al cerrar, la lista
 *      muestra el primero, con el importe de la primera vez.
 *   c. Cerrada esa ventana, la siguiente registra otro documento.
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
 *
 * El corte deja pasar el envío al servidor y no le entrega la respuesta al
 * navegador, como una señal que se cae a medio camino.
 *
 * Siembra sus datos en la base del banco con un sufijo nuevo. Variables:
 * BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE, SOLO (las
 * partes que corren, p. ej. `sc,caja`; de os, oc, rq, sc, caja, lista y planos) y el
 * correo de cada cuenta si no es `<puesto>.local@metalwork.test`.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { crearCajaDePrueba } from './caja-de-prueba.mjs'
import { escribirCodigo } from './campo-codigo.mjs'

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
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)

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
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (cortando && /net::ERR_FAILED|Failed to fetch|TypeError/.test(m.text())) return
    if (ruido?.test(m.text())) return
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${puesto}: ${m.text().slice(0, 300)}`)
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', CUENTAS[puesto])
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${CUENTAS[puesto]}`)
  await pagina.waitForLoadState('networkidle')
  return { pagina, contexto }
}

/**
 * Las acciones de servidor que llevan `marca` llegan al servidor, pero las
 * próximas `quedan` respuestas no llegan al navegador. Con `sinEnviar`, ni
 * siquiera llegan al servidor.
 */
async function cortarRespuestas(pagina) {
  // `retener`: la clave de `consultarEnvio` cuya pregunta se detiene hasta `soltar()`; `consultas`, las que terminaron.
  const corte = { marca: null, quedan: 0, sinEnviar: false, retener: null, soltar: () => {}, consultas: 0 }
  const esConsulta = (q, clave) => new RegExp(`^\\["${clave}","[0-9a-f-]{36}"\\]$`).test((q.postData() ?? '').trim())
  pagina.on('requestfinished', (q) => {
    if (q.method() === 'POST' && q.headers()['next-action'] && /^\["[a-z_]+","[0-9a-f-]{36}"\]$/.test((q.postData() ?? '').trim())) corte.consultas++
  })
  await pagina.route('**/*', async (r) => {
    const q = r.request()
    if (q.method() === 'POST' && q.headers()['next-action'] && corte.retener && esConsulta(q, corte.retener)) {
      await new Promise((listo) => (corte.soltar = listo))
      return r.continue()
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
    const botones = [...(v?.querySelectorAll('button') ?? [])].filter((b) => !b.disabled && b.offsetParent !== null)
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
  const anunciada = await v.locator('[role="status"] [data-envio-anterior]').count()
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
  await abrir()
  await d.llenar(v, pagina, B, d.valores[1])
  await enviar()
  const yaQuedo = limpio(await hasta(aviso, (t) => /ya quedó/.test(t ?? ''), 30000))
  const estado = await hasta(() => laVentana(pagina), (e) => e.cursor && e.abiertos.length === 0, 5000)
  corte.retener = null
  corte.soltar()
  await hasta(() => corte.consultas, (n) => n > consultasAntes, 15000)
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
await mismoEnvio({
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
})

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
  comprobar(/^El egreso que enviaste antes sí quedó: (S\/|US\$) 40\.00 del \d\d\/\d\d\/\d{4}\. Lo que registres ahora será otro\.$/.test(dice),
    `[Caja] desde el otro botón, la ventana dice que aquel egreso quedó: «${dice}»`)
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

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.slice(0, 3).join(' | ')}` : ''}`)
await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} FALLAS` : '\nTodo en orden.')
process.exit(fallas.length ? 1 : 0)
