/**
 * Clic real sobre la migración 20261023200000: el reenvío con algo cambiado
 * dice que el primero ya quedó, en RR. HH., la caja y el gasto del mes. Con la
 * cuenta de cada puesto, nunca ADMIN. En cada ventana:
 *
 *   a. La respuesta no llega; «Cancelar» y volver a abrir lleva el mismo id, y
 *      lo mismo otra vez deja un solo registro (donde el id no cambia con la
 *      pantalla).
 *   b. La respuesta no llega; se cambia un dato y se vuelve a pulsar. La ventana
 *      dice sin rojo que el primero ya quedó, traba los campos, solo ofrece
 *      «Cerrar» y se lleva el cursor. Queda uno, con lo de la primera vez:
 *      antes la pantalla decía «listo» y lo cambiado no se guardaba.
 *   c. Cerrada esa ventana, la siguiente registra otro.
 *
 *   1. RR. HH., «Registrar observación».
 *   2. RR. HH., «Registrar permiso».
 *   3. RR. HH., «Cargar horas» (la ventana sigue abierta tras cada carga).
 *   4. RR. HH., «Usar horas» del saldo (el id cambia con el saldo: solo b y c).
 *   5. Tesorería, «Agregar cuenta» (el alta repetida no corrige la cuenta).
 *   6. Tesorería, «Cerrar el día» (cerrado, no hay c).
 *   7. Administración, «Registrar gasto» del mes.
 *   8. Almacén, «Registrar salida» del kardex, con su foto.
 *
 * El corte deja pasar el envío al servidor y no le entrega la respuesta al
 * navegador, como una señal que se cae a medio camino.
 *
 * Siembra sus datos en la base del banco con un sufijo nuevo. Variables:
 * BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE, SOLO (las
 * partes que corren, p. ej. `obs,cierre`; de obs, permiso, horas, saldo, cuenta,
 * cierre, gasto y salida), CELULAR (con cualquier valor, a 390 × 844) y el
 * correo de cada cuenta si no es `<puesto>.local@metalwork.test`.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
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
const CUENTAS = Object.fromEntries(['rrhh', 'tesoreria', 'administracion', 'almacen'].map((p) => [p, cuenta(p)]))
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
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
const diaAtras = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date(Date.now() - n * 86400000))
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)

// Una persona del personal con su costo mensual, para la carga de horas, y con
// horas reservadas en su saldo, para usarlas. Cada corrida, la suya.
const [{ id: persona }] = await consulta(
  `insert into trabajadores (nombres, apellidos, dni, cargo, area_id, creado_por)
   values ('Prueba', $1, $2, 'Soldador', (select id from areas where codigo = 'MTZ'), $3) returning id`,
  [`Reenvío ${SUFIJO}`, `7${SUFIJO.padStart(7, '0')}`.slice(0, 8), ids[CUENTAS.rrhh]],
)
const PERSONA = `Reenvío ${SUFIJO}`
await consulta(`insert into trabajador_costos (trabajador_id, costo_mensual) values ($1, 2400)`, [persona])
await consulta(
  `insert into horas_extras_decisiones (trabajador_id, fecha, horas, horas_tramo1, horas_tramo2, decision, registrado_por)
   values ($1, $2::date, 8, 2, 6, 'RESERVAR', $3)`,
  [persona, diaAtras(3), ids[CUENTAS.rrhh]],
)
const CAJA = await crearCajaDePrueba(consulta, CUENTAS.tesoreria)

// Un material que no es accesorio, con 20 libres para la salida: los ingresa
// Almacén, con su permiso.
const [material] = await consulta(
  `select id, descripcion from materiales where activo and public.almacen_de_material(id) is distinct from 'ACCESORIOS' order by codigo limit 1`)
await base.query('begin')
try {
  await base.query(`select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true),
                           set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)`, [ids[CUENTAS.almacen]])
  await base.query('set local role authenticated')
  await base.query(`select public.registrar_ingreso_almacen(gen_random_uuid(), $1, 20, 'INGRESO_GENERAL', 'Ingreso de la prueba del reenvío', 1, 'PEN')`, [material.id])
  await base.query('commit')
} catch (e) {
  await base.query('rollback')
  throw e
}
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
let cortando = false
const VENTANA = '[role="dialog"]:not([data-nextjs-dialog])'

const ANCHO = process.env.CELULAR ? { width: 390, height: 844 } : { width: 1280, height: 900 }

async function entrar(puesto, viewport = ANCHO) {
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (cortando && /net::ERR_FAILED|Failed to fetch|TypeError/.test(m.text())) return
    // La misma foto otra vez en su ruta: Storage contesta que ya está, y la subida sigue con ella.
    if (puesto === 'almacen' && m.text().includes('status of 400')) return
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

/** Las acciones de servidor que llevan `marca` llegan al servidor, pero las próximas `quedan` respuestas no llegan al navegador. */
async function cortarRespuestas(pagina) {
  const corte = { marca: null, quedan: 0 }
  await pagina.route('**/*', async (r) => {
    const q = r.request()
    if (q.method() !== 'POST' || !q.headers()['next-action'] || !corte.marca || !(q.postData() ?? '').includes(corte.marca) || corte.quedan <= 0) {
      return r.continue()
    }
    corte.quedan--
    await r.fetch().catch(() => {})
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
    // La «i» de la ayuda de un campo (`data-ayuda`) no envía ni cierra: no cuenta.
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

/** Elige en una lista con buscador, como la persona: escribe y toca la opción. */
async function elegir(pagina, disparador, texto) {
  await disparador.click()
  const buscador = pagina.getByRole('searchbox')
  if (await buscador.isVisible().catch(() => false)) await buscador.fill(texto)
  await pagina.locator('[role="option"]', { hasText: texto }).first().click()
}

/** a, b y c de una ventana (ver arriba). */
async function reenvio(d) {
  if (!corre(d.clave)) return
  const { pagina, contexto } = await entrar(d.puesto)
  try {
    await pasos(d, pagina)
  } catch (e) {
    await pagina.screenshot({ path: join(CAPTURAS, `reenvio-${d.clave}-falla.png`) }).catch(() => {})
    throw e
  }
  await contexto.close()
}

async function pasos(d, pagina) {
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
    corte.quedan = d.cortes ?? 1
    cortando = true
    await enviar()
    const texto = limpio(await hasta(aviso, (t) => /respuesta/.test(t ?? ''), 30000))
    cortando = false
    return texto
  }
  /** Envía y espera a que entre: la ventana se cierra, o (la carga de horas) dice que quedó y sigue abierta. */
  async function enviarYEsperar(marca, cuantos) {
    await enviar()
    const filas = await hasta(() => d.contar(marca), (r) => r.length >= cuantos, 30000)
    await pagina.waitForLoadState('networkidle')
    const error = limpio(await aviso())
    if (d.quedaAbierta && (await v.isVisible())) {
      await hasta(() => v.locator('[role="status"]').count(), (n) => n > 0, 10000)
      await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
    }
    await v.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
    return { filas, error }
  }

  await ir()
  // a. Sin respuesta, «Cancelar», y lo mismo otra vez.
  if (d.reabrir) {
    const A = `${SUFIJO}a`
    await abrir()
    await d.llenar(v, pagina, A, d.valores[0])
    const corto = await sinRespuesta(A)
    await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await v.waitFor({ state: 'hidden' })
    const entro = await hasta(() => d.contar(A), (r) => r.length > 0)
    comprobar(corto.startsWith('No llegó la respuesta') && entro.length === 1, `[${d.nombre}] sin respuesta lo dice, y el primero sí entró: «${corto}»`)
    await pagina.waitForLoadState('networkidle')
    await abrir()
    const limpia = (await v.locator('[role="alert"]').count()) === 0
    await d.llenar(v, pagina, A, d.valores[0])
    const { filas, error } = await enviarYEsperar(A, 1)
    await new Promise((r) => setTimeout(r, 1000))
    const quedaron = await d.contar(A)
    comprobar(limpia && !error && filas.length === 1 && quedaron.length === 1,
      `[${d.nombre}] vuelto a abrir, limpio, lo mismo otra vez no registra otro (${quedaron.length})${error ? ` (dijo «${error}»)` : ''}`)
  }

  // b. Sin respuesta, se cambia un dato y se vuelve a pulsar.
  const B = `${SUFIJO}b`
  await ir()
  await abrir()
  await d.llenar(v, pagina, B, d.valores[0])
  const corto = await sinRespuesta(B)
  await d.cambiar(v, pagina, d.valores[1])
  await enviar()
  const yaQuedo = limpio(await hasta(aviso, (t) => /ya quedó/.test(t ?? ''), 30000))
  const estado = await hasta(() => laVentana(pagina), (e) => e.cursor && e.abiertos.length === 0, 5000)
  comprobar(corto.startsWith('No llegó la respuesta') && yaQuedo.startsWith(d.yaQuedo)
    && yaQuedo.endsWith('Si cambiaste algo después, no se guardó: al cerrar, la pantalla muestra lo que quedó.'),
    `[${d.nombre}] con otro dato dice que el primero ya quedó: «${yaQuedo}»`)
  comprobar(estado.neutro && estado.cursor && estado.envia === 0 && estado.botones.join() === 'Cerrar' && estado.campos > 0 && estado.abiertos.length === 0,
    `[${d.nombre}] sin rojo, con el cursor, los campos trabados y solo «Cerrar» (${JSON.stringify(estado)})`)
  await pagina.screenshot({ path: join(CAPTURAS, `reenvio-${d.clave}-ya-quedo${process.env.CELULAR ? '-celular' : ''}.png`) })
  await v.locator('form').getByRole('button', { name: 'Cerrar', exact: true }).click()
  await v.waitFor({ state: 'hidden' })
  const [primero, ...demas] = await d.contar(B)
  comprobar(Boolean(primero) && demas.length === 0 && String(primero.valor) === String(d.esperado ?? d.valores[0]),
    `[${d.nombre}] queda uno, con lo de la primera vez (${primero?.valor})`)
  if (d.enPantalla) comprobar(await hasta(() => d.enPantalla(pagina, B), Boolean, 15000), `[${d.nombre}] al cerrar, la pantalla lo muestra`)

  // c. Cerrada esa ventana, la siguiente es otro.
  if (d.otro !== false) {
    const C = `${SUFIJO}c`
    await pagina.waitForLoadState('networkidle')
    await abrir()
    const limpia = (await v.locator('[role="alert"]').count()) === 0 && (await v.getByRole('button', { name: d.enviar, exact: true }).isVisible())
    await d.llenar(v, pagina, C, d.valores[1])
    const { filas, error } = await enviarYEsperar(C, 1)
    comprobar(limpia && !error && filas.length === 1 && String(filas[0].valor) === String(d.valores[1]),
      `[${d.nombre}] la ventana siguiente sale limpia y registra otro${error ? ` (dijo «${error}»)` : ''}`)
  }
}

// ---------------------------------------------------------------- 1. Observación
await reenvio({
  nombre: 'Observación',
  clave: 'obs',
  puesto: 'rrhh',
  ruta: '/rrhh/observaciones',
  nuevo: (p) => p.getByRole('button', { name: 'Registrar observación' }),
  enviar: 'Registrar',
  reabrir: true,
  valores: ['OBSERVACION', 'AMONESTACION_VERBAL'],
  yaQuedo: 'Esta observación ya quedó registrada la primera vez que la enviaste.',
  async llenar(v, p, marca, tipo) {
    await elegir(p, v.locator('[id^="obs-persona-"]'), PERSONA)
    await v.locator('select[name="tipo"]').selectOption(tipo)
    await v.locator('select[name="motivo"]').selectOption('EPP')
    await v.locator('textarea[name="detalle"]').fill(`Trabajaba sin careta en la prueba ${marca}`)
  },
  cambiar: (v, p, tipo) => v.locator('select[name="tipo"]').selectOption(tipo),
  contar: (marca) => consulta(`select tipo as valor from observaciones_personal where detalle = $1`, [`Trabajaba sin careta en la prueba ${marca}`]),
})

// ---------------------------------------------------------------- 2. Permiso
// Un día propio de esta corrida: las horas del día no pasan de 8.
const DIA_PERMISO = diaAtras(10 + (Number(SUFIJO) % 300))
await reenvio({
  nombre: 'Permiso',
  clave: 'permiso',
  puesto: 'rrhh',
  ruta: '/rrhh/permisos',
  nuevo: (p) => p.locator('[data-registrar-permiso]'),
  enviar: 'Registrar',
  reabrir: true,
  valores: ['1', '1.5'],
  yaQuedo: 'Este permiso ya quedó registrado la primera vez que lo enviaste.',
  async llenar(v, p, marca, horas) {
    await elegir(p, v.locator('[id^="permiso-persona-"]'), PERSONA)
    await v.locator('input[name="fecha"]').fill(DIA_PERMISO)
    await v.locator('input[name="horas"]').fill(horas)
    await v.locator('textarea[name="motivo"]').fill(`Trámite en el banco ${marca}`)
  },
  cambiar: (v, p, horas) => v.locator('input[name="horas"]').fill(horas),
  contar: (marca) => consulta(`select horas::float as valor from permisos_personal where motivo = $1`, [`Trámite en el banco ${marca}`]),
})

// ---------------------------------------------------------------- 3. Carga de horas
await reenvio({
  nombre: 'Carga de horas',
  clave: 'horas',
  puesto: 'rrhh',
  ruta: '/rrhh/costeo',
  nuevo: (p) => p.getByRole('button', { name: 'Cargar horas', exact: true }).first(),
  enviar: 'Cargar horas',
  reabrir: true,
  quedaAbierta: true,
  valores: ['1', '2'],
  yaQuedo: 'Esta carga de horas ya quedó registrada la primera vez que la enviaste.',
  async llenar(v, p, marca, horas) {
    await elegir(p, v.locator('[id^="tareo-persona-"]'), PERSONA)
    await v.locator('input[name="fecha"]').fill(diaAtras(1))
    await escribirCodigo(v.locator('[id^="tareo-codigo-"]').first(), 'PLANTA')
    await v.locator('input[name="horas"]').fill(horas)
    await v.locator('input[name="labor"]').fill(`Soldadura de prueba ${marca}`)
  },
  cambiar: (v, p, horas) => v.locator('input[name="horas"]').fill(horas),
  contar: (marca) => consulta(`select horas::float as valor from tareos where labor = $1`, [`Soldadura de prueba ${marca}`]),
})

// ---------------------------------------------------------------- 4. Usar horas del saldo
await reenvio({
  nombre: 'Usar horas',
  clave: 'saldo',
  puesto: 'rrhh',
  ruta: '/rrhh/horas-extras',
  nuevo: (p) => p.locator(`[data-usar-saldo="${persona}"]`),
  enviar: 'Usar del saldo',
  valores: ['1', '1.5'],
  yaQuedo: 'Este uso de las horas reservadas ya quedó registrado la primera vez que lo enviaste.',
  async llenar(v, p, marca, horas) {
    await v.locator('input[name="horas"]').fill(horas)
    await v.locator('textarea[name="motivo"]').fill(`Descanso del sábado ${marca}`)
  },
  cambiar: (v, p, horas) => v.locator('input[name="horas"]').fill(horas),
  contar: (marca) => consulta(`select horas::float as valor from horas_compensadas where motivo = $1`, [`Descanso del sábado ${marca}`]),
})

// ---------------------------------------------------------------- 5. Cuenta nueva
await reenvio({
  nombre: 'Cuenta nueva',
  clave: 'cuenta',
  puesto: 'tesoreria',
  ruta: '/tesoreria/caja-diaria',
  nuevo: (p) => p.locator('[data-agregar-cuenta]').first(),
  enviar: 'Agregar la cuenta',
  reabrir: true,
  valores: ['250', '300'],
  yaQuedo: 'Esta cuenta ya quedó registrada la primera vez que la enviaste.',
  async llenar(v, p, marca, saldo) {
    await v.locator('select[name="tipo"]').selectOption('EFECTIVO')
    await v.locator('input[name="nombre"]').fill(`Caja de obra ${marca}`)
    await v.locator('input[name="saldo_inicial"]').fill(saldo)
    await v.locator('input[name="fecha_inicio"]').fill(diaAtras(2))
  },
  cambiar: (v, p, saldo) => v.locator('input[name="saldo_inicial"]').fill(saldo),
  contar: (marca) => consulta(`select saldo_inicial::float as valor from cajas where nombre = $1`, [`Caja de obra ${marca}`]),
})

// ---------------------------------------------------------------- 6. Cierre del día
await reenvio({
  nombre: 'Cierre del día',
  clave: 'cierre',
  puesto: 'tesoreria',
  ruta: '/tesoreria/caja-diaria',
  nuevo: (p) => p.locator(`[data-cerrar-dia="${CAJA}"]`),
  enviar: 'Cerrar el día',
  otro: false,
  valores: ['100000', '99990'],
  yaQuedo: 'Este cierre del día ya quedó registrado la primera vez que lo enviaste.',
  // La marca va en las observaciones: el corte reconoce el envío por ella.
  async llenar(v, p, marca, saldo) {
    await v.locator('input[name="saldo_banco"]').fill(saldo)
    await v.locator('textarea[name="observaciones"]').fill(`Cuadra con el estado de cuenta ${marca}`)
  },
  async cambiar(v, p, saldo) {
    await v.locator('input[name="saldo_banco"]').fill(saldo)
    await v.locator('textarea[name="observaciones"]').fill('Comisión del banco que falta registrar')
  },
  contar: () => consulta(`select k.saldo_banco::float as valor from cierres_caja k join cajas c on c.id = k.caja_id where c.nombre = $1 and k.anulado_en is null`, [CAJA]),
  enPantalla: async (p) => (await p.locator(`[data-cerrar-dia="${CAJA}"]`).count()) === 0,
})

// ---------------------------------------------------------------- 7. Gasto del mes
await reenvio({
  nombre: 'Gasto del mes',
  clave: 'gasto',
  puesto: 'administracion',
  ruta: '/costos/gastos-generales',
  nuevo: (p) => p.getByRole('button', { name: 'Registrar gasto', exact: true }).first(),
  enviar: 'Registrar gasto',
  reabrir: true,
  valores: ['100', '150'],
  yaQuedo: 'Este gasto ya quedó registrado la primera vez que lo enviaste.',
  async llenar(v, p, marca, monto) {
    await v.locator('select[name="concepto"]').selectOption({ index: 1 })
    await v.locator('input[name="descripcion"]').fill(`Recibo de prueba ${marca}`)
    await v.locator('input[name="monto"]').fill(monto)
  },
  cambiar: (v, p, monto) => v.locator('input[name="monto"]').fill(monto),
  contar: (marca) => consulta(`select monto::float as valor from gastos_generales_mes where descripcion = $1`, [`Recibo de prueba ${marca}`]),
})

// ---------------------------------------------------------------- 8. Salida del kardex
await reenvio({
  nombre: 'Salida del kardex',
  clave: 'salida',
  puesto: 'almacen',
  ruta: '/almacen/kardex',
  nuevo: (p) => p.getByRole('button', { name: 'Registrar salida', exact: true }),
  enviar: 'Confirmar salida',
  reabrir: true,
  // La subida con su foto pregunta otra vez con el mismo id antes de decir que no llegó.
  cortes: 2,
  valores: ['1', '2'],
  yaQuedo: 'Esta salida ya quedó registrada la primera vez que la enviaste.',
  async llenar(v, p, marca, cantidad) {
    await elegir(p, v.locator('#sal-material'), material.descripcion)
    if (await v.locator('#sal-destino-codigo').isVisible().catch(() => false)) await v.locator('#sal-destino-codigo').click()
    await escribirCodigo(v.locator('#sal-codigo'), 'PLANTA')
    await v.locator('#sal-cantidad').fill(cantidad)
    await v.locator('#sal-motivo').fill(`Vale de la prueba ${marca}`)
    await v.locator('#sal-recibe').fill('Soldador de la prueba')
    // Del disco, como la persona que vuelve a elegir la misma foto: con el mismo
    // nombre, tamaño y fecha, la subida la reconoce. Una foto armada en memoria
    // nace con otra fecha cada vez y cuenta como otra.
    const foto = join(CAPTURAS, `salida-${marca}.jpg`)
    if (!existsSync(foto)) writeFileSync(foto, JPG)
    await v.locator('#sal-foto').setInputFiles(foto)
  },
  cambiar: (v, p, cantidad) => v.locator('#sal-cantidad').fill(cantidad),
  contar: (marca) => consulta(`select cantidad::float as valor from movimientos_materiales where tipo = 'SALIDA' and documento_referencia = $1`, [`Vale de la prueba ${marca}`]),
})

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.slice(0, 3).join(' | ')}` : ''}`)
await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} FALLAS` : '\nTodo en orden.')
process.exit(fallas.length ? 1 : 0)
