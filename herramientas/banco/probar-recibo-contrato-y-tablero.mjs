/**
 * Clic real sobre lo que encontró la decimoséptima pasada en las ventanas que
 * preguntan a la base si el envío anterior entró (`useIdDelEnvio`), con la
 * cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Administración, el recibo por honorarios de un subcontrato:
 *      a. el recibo entra y su respuesta se pierde; con «Cancelar» y al volver
 *         a abrir, la ventana dice que aquel quedó, con su número (antes
 *         «Cancelar» empezaba otro y no se preguntaba nada);
 *      b. el siguiente entra desde esa misma ventana;
 *      c. otro se pierde igual y se reenvía con otro monto: dice sin rojo que
 *         ya quedó, traba los campos y solo ofrece «Cerrar» (antes en rojo y
 *         con «Registrar recibo» activo), y queda con el monto de la primera.
 *   2. Administración, el contrato del subcontrato: la respuesta se pierde y
 *      se elige otro archivo; el «ya se subió» va sin rojo y solo con «Cerrar».
 *   3. Logística, «Documentos para Tesorería» en el tablero de una OT: el tipo
 *      y el PDF elegidos siguen ahí tras dos puestas al día de la pantalla,
 *      con el mismo id (antes el id nacía en cada repintado y lo elegido se
 *      borraba); la respuesta se pierde y el reintento va al mismo id y a la
 *      misma ruta: una fila y ningún archivo suelto.
 *
 * El subcontrato lo registra Administración con las funciones de la base, con
 * un sello nuevo. La OT con compras en su tablero tiene que estar en el banco
 * (la trae `preparar.sh`). Deja en el banco el subcontrato, sus recibos y el
 * documento de la OC, con el sello de la corrida.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * CAPTURAS y el correo de cada cuenta si no es `<puesto>.local@metalwork.test`.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = join(process.env.CAPTURAS ?? '/tmp/banco-capturas', 'recibo-contrato-y-tablero')
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(['administracion', 'logistica'].map((p) => [p, cuenta(p)]))
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
/** Lee hasta que se cumple o se acaba el tiempo: se espera a lo que pasa, no un tiempo fijo. */
async function hasta(leer, cumple, ms = 15000) {
  const fin = Date.now() + ms
  let v = await leer()
  while (!cumple(v) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 250))
    v = await leer()
  }
  return v
}
const PDF = (relleno) =>
  Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n%${'x'.repeat(relleno)}\ntrailer<</Root 1 0 R>>\n%%EOF\n`)

// ---------------------------------------------------------------- siembra
const SELLO = String(100000 + (Date.now() % 900000))
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)
async function como(puesto) {
  const sub = ids[CUENTAS[puesto]]
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, JSON.stringify({ sub, role: 'authenticated' })])
}
const ruc = await uno(
  `select r from (select '10' || $1 || d as r from generate_series(0, 9) d) x
    where public.ruc_es_valido(r) and not exists (select 1 from subcontratistas s where s.ruc = r) limit 1`,
  [`${SELLO}00`.slice(0, 8)],
)
if (!ruc) throw new Error('No salió un RUC libre para el subcontratista de la prueba.')
await como('administracion')
const { sub } = await uno(`select public.guardar_subcontratista(gen_random_uuid(), $1, $2, null, null, null, null, true) as sub`,
  [ruc.r, `Soldador de la nota ${SELLO}`])
const { id: subcontrato } = await uno(
  `select public.registrar_subcontrato(gen_random_uuid(), $1, $2, 'Soldadura de la nota, prueba', 'PEN', 9000, null, null, 'PRD') as id`,
  [sub, `QA_NOTA_${SELLO}`],
)
await consulta(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`)

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
let cortando = false

async function entrar(puesto, viewport) {
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (cortando && /net::ERR_FAILED|Failed to fetch|TypeError/.test(m.text())) return
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
 * La próxima acción de servidor que lleve `marca` llega al servidor y se cumple,
 * pero su respuesta no llega al navegador: una señal que se cae a medio camino.
 */
async function cortarLaRespuesta(pagina) {
  const corte = { marca: null, cortadas: 0 }
  await pagina.route('**/*', async (r) => {
    const q = r.request()
    if (!corte.marca || q.method() !== 'POST' || !q.headers()['next-action'] || !(q.postData() ?? '').includes(corte.marca)) return r.continue()
    corte.marca = null
    corte.cortadas++
    await r.fetch({ timeout: 60000 }).catch(() => {})
    return r.abort('failed')
  })
  return corte
}

/** Cómo quedó la ventana tras el aviso: sin rojo, los campos trabados y qué botones se pueden tocar. */
function laVentana(v) {
  return v.evaluate((ventana) => {
    const aviso = ventana.querySelector('[role="alert"]')
    const campos = [...ventana.querySelectorAll('input:not([type=hidden]), select, textarea')]
    const botones = [...ventana.querySelectorAll('button:not([data-ayuda])')].filter((b) => !b.disabled && b.offsetParent !== null)
    return {
      neutro: aviso?.hasAttribute('data-ya-entro') ?? false,
      rojo: aviso ? getComputedStyle(aviso).color : null,
      abiertos: campos.filter((c) => !c.disabled).map((c) => c.name || c.id),
      botones: [...new Set(botones.map((b) => b.textContent.trim() || b.getAttribute('aria-label')))],
    }
  })
}

// ---------------------------------------------------------------- 1 y 2. Administración, el subcontrato
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const tam = viewport.width
  const { pagina, contexto } = await entrar('administracion', viewport)
  const corte = await cortarLaRespuesta(pagina)
  const v = pagina.getByRole('dialog')
  const ir = () => pagina.goto(`${BASE}/subcontratos/${subcontrato}`, { waitUntil: 'networkidle' })
  const abrirRecibo = async () => {
    await pagina.locator('[data-subir-recibo]').click()
    await v.waitFor()
  }
  const llenarRecibo = async (numero, monto) => {
    await v.locator('input[name="numero"]').fill(numero)
    await v.locator('input[name="monto_bruto"]').fill(monto)
    await v.locator('input[name="archivo"]').setInputFiles({ name: `recibo-${numero}.pdf`, mimeType: 'application/pdf', buffer: PDF(400) })
  }
  const recibos = (numero) => consulta(`select monto_bruto::numeric as monto from recibos_honorarios where subcontrato_id = $1 and numero = $2`, [subcontrato, numero])
  const alerta = () => v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => '')
  const nota = () => v.locator('[data-envio-anterior]').textContent({ timeout: 500 }).catch(() => '')

  // 1a. Sin respuesta, «Cancelar», y al volver a abrir dice que aquel quedó.
  const A = `E${tam === 390 ? '391' : '144'}-${SELLO}1`
  await ir()
  await abrirRecibo()
  await llenarRecibo(A, '1000')
  corte.marca = A
  cortando = true
  await v.getByRole('button', { name: 'Registrar recibo' }).click()
  const corto = limpio(await hasta(alerta, (t) => /respuesta/.test(t ?? ''), 30000))
  cortando = false
  await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await v.waitFor({ state: 'hidden' })
  const entro = await recibos(A)
  comprobar(corte.cortadas === 1 && /No llegó la respuesta/.test(corto) && entro.length === 1,
    `[Administración ${tam}] el recibo ${A} entra y su respuesta se pierde: «${corto}»`)
  await abrirRecibo()
  const dice = limpio(await hasta(nota, (t) => /sí quedó/.test(t ?? ''), 15000))
  comprobar(dice === `El recibo que enviaste antes sí quedó: ${A}. Lo que registres ahora será otro.` && (await v.locator('[role="alert"]').count()) === 0,
    `[Administración ${tam}] tras «Cancelar», al volver a abrir dice que aquel quedó, sin rojo: «${dice}»`)
  await pagina.screenshot({ path: join(CAPTURAS, `recibo-nota-${tam}.png`) })

  // 1b. El siguiente entra desde esa misma ventana.
  const B = `E${tam === 390 ? '391' : '144'}-${SELLO}2`
  await llenarRecibo(B, '1200')
  await v.getByRole('button', { name: 'Registrar recibo' }).click()
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  const deA = await recibos(A)
  const deB = await recibos(B)
  comprobar(deA.length === 1 && deB.length === 1, `[Administración ${tam}] y el siguiente, ${B}, entra aparte (${deA.length} y ${deB.length})`)

  // 1c. Otro se pierde igual y se reenvía con otro monto: «ya quedó» sin rojo, trabado y solo «Cerrar».
  const C = `E${tam === 390 ? '391' : '144'}-${SELLO}3`
  await abrirRecibo()
  comprobar((await v.locator('[data-envio-anterior]').count()) === 0, `[Administración ${tam}] tras registrarlo, la ventana siguiente ya no trae la nota`)
  await llenarRecibo(C, '1300')
  corte.marca = C
  cortando = true
  await v.getByRole('button', { name: 'Registrar recibo' }).click()
  await hasta(alerta, (t) => /respuesta/.test(t ?? ''), 30000)
  cortando = false
  await v.locator('input[name="monto_bruto"]').fill('1350')
  await v.getByRole('button', { name: 'Registrar recibo' }).click()
  const yaQuedo = limpio(await hasta(alerta, (t) => /ya está registrado|primera vez/.test(t ?? ''), 30000))
  const estado = await laVentana(v)
  const deC = await recibos(C)
  comprobar(/primera vez que lo enviaste/.test(yaQuedo) && estado.neutro && estado.abiertos.length === 0 && estado.botones.join() === 'Cerrar',
    `[Administración ${tam}] con otro monto dice sin rojo que ya quedó, trabado y solo con «Cerrar»: «${yaQuedo}» (${JSON.stringify(estado)})`)
  comprobar(deC.length === 1 && Number(deC[0].monto) === 1300, `[Administración ${tam}] y queda uno, con el monto de la primera vez (${deC.map((r) => Number(r.monto)).join(', ')})`)
  await pagina.screenshot({ path: join(CAPTURAS, `recibo-ya-quedo-${tam}.png`) })
  await v.getByRole('button', { name: 'Cerrar', exact: true }).filter({ hasText: 'Cerrar' }).click()
  await v.waitFor({ state: 'hidden' })

  // 2. El contrato: la respuesta se pierde y se elige otro archivo.
  const contratoA = `QA-NOTA-CONTRATO-A-${SELLO}-${tam}.pdf`
  const contratoB = `QA-NOTA-CONTRATO-B-${SELLO}-${tam}.pdf`
  await ir()
  await pagina.locator('[data-adjuntar-contrato]').click()
  await v.waitFor()
  await v.locator('input[name="contrato"]').setInputFiles({ name: contratoA, mimeType: 'application/pdf', buffer: PDF(300) })
  corte.marca = contratoA
  cortando = true
  await v.getByRole('button', { name: 'Adjuntar', exact: true }).click()
  await hasta(alerta, (t) => /respuesta/.test(t ?? ''), 30000)
  cortando = false
  await v.locator('input[name="contrato"]').setInputFiles({ name: contratoB, mimeType: 'application/pdf', buffer: PDF(900) })
  await v.getByRole('button', { name: 'Adjuntar', exact: true }).click()
  const subido = limpio(await hasta(alerta, (t) => /ya se subió/.test(t ?? ''), 30000))
  const enContrato = await laVentana(v)
  const contratos = await consulta(`select archivo_nombre from subcontrato_contratos where subcontrato_id = $1 and archivo_nombre in ($2, $3)`,
    [subcontrato, contratoA, contratoB])
  comprobar(subido.includes(`Antes ya se subió ${contratoA}`) && enContrato.neutro && enContrato.abiertos.length === 0 && enContrato.botones.join() === 'Cerrar',
    `[Administración ${tam}] el contrato que ya se subió lo dice sin rojo, trabado y solo con «Cerrar»: «${subido}» (${JSON.stringify(enContrato)})`)
  comprobar(contratos.length === 1 && contratos[0].archivo_nombre === contratoA, `[Administración ${tam}] y queda el primero, una vez (${contratos.map((c) => c.archivo_nombre).join(', ')})`)
  await pagina.screenshot({ path: join(CAPTURAS, `contrato-ya-quedo-${tam}.png`) })
  await v.getByRole('button', { name: 'Cerrar', exact: true }).filter({ hasText: 'Cerrar' }).click()
  await v.waitFor({ state: 'hidden' })
  await pagina.unrouteAll({ behavior: 'ignoreErrors' })
  await contexto.close()
}

// ---------------------------------------------------------------- 3. Logística, el tablero de la OT
{
  const fila = await uno(`select distinct a.orden_id, a.numero_ot, v.orden_compra_id, c.numero
    from v_atencion_materiales a join v_orden_compra_material_pendiente v on v.requerimiento_id = a.requerimiento_id
    join ordenes_compra_materiales c on c.id = v.orden_compra_id
   where c.anulada_en is null order by c.numero limit 1`)
  comprobar(Boolean(fila), 'el banco tiene una OT con una compra en su atención de materiales (la trae preparar.sh)')
  if (fila) {
    const { pagina, contexto } = await entrar('logistica', { width: 1440, height: 900 })
    let refrescos = 0
    pagina.on('requestfinished', (q) => {
      if (q.method() === 'GET' && q.headers()['rsc'] && !q.headers()['next-router-prefetch']) refrescos++
    })
    await pagina.goto(`${BASE}/ordenes/${fila.orden_id}?vista=materiales`, { waitUntil: 'networkidle' })
    const tipo = pagina.locator(`select#tipo-doc-compra-${fila.orden_compra_id}`)
    await tipo.waitFor({ timeout: 60000 })
    const form = pagina.locator('form', { has: tipo })
    const estado = async () => ({
      id: await form.locator('input[type=hidden][name=id]').inputValue(),
      tipo: await tipo.inputValue(),
      archivos: await form.locator('input[name=archivo]').evaluate((i) => i.files?.length ?? 0),
    })
    const nombre = `QA-NOTA-TABLERO-${SELLO}.pdf`
    await tipo.selectOption('OTRO')
    await form.locator('input[name=archivo]').setInputFiles({ name: nombre, mimeType: 'application/pdf', buffer: PDF(500) })
    const antes = await estado()
    const vistos = []
    for (let k = 0; k < 2; k++) {
      const r0 = refrescos
      await pagina.evaluate(() => window.next.router.refresh())
      await hasta(() => refrescos, (n) => n > r0, 30000)
      await pagina.waitForLoadState('networkidle')
      vistos.push(await estado())
    }
    comprobar(vistos.every((e) => e.id === antes.id && e.tipo === 'OTRO' && e.archivos === 1),
      `[Logística 1440] OT ${fila.numero_ot}, ${fila.numero}: lo elegido sigue tras dos puestas al día, con el mismo id (${JSON.stringify([antes, ...vistos])})`)

    // La respuesta se pierde; el reintento va con el mismo id y a la misma ruta.
    const corte = await cortarLaRespuesta(pagina)
    corte.marca = nombre
    cortando = true
    const adjuntar = form.getByRole('button', { name: 'Adjuntar' })
    await adjuntar.click()
    const aviso = () => form.locator('[role="alert"], [role="status"]').allInnerTexts().then((t) => limpio(t.join(' | '))).catch(() => '')
    const corto = await hasta(aviso, (t) => /respuesta/.test(t ?? ''), 30000)
    cortando = false
    const idTrasElCorte = await form.locator('input[type=hidden][name=id]').inputValue()
    await adjuntar.click()
    const dijo = await hasta(aviso, (t) => /adjuntado|ya quedó|primera vez/i.test(t ?? ''), 30000)
    const filas = await consulta(`select id, ruta_storage from documentos_compra_material where orden_compra_id = $1 and nombre_archivo = $2`,
      [fila.orden_compra_id, nombre])
    const sueltos = await consulta(`select o.name from storage.objects o where o.bucket_id = 'documentos-compras' and o.name like $1
                                      and not exists (select 1 from documentos_compra_material d where d.ruta_storage = o.name)`,
      [`compra/${fila.orden_compra_id}/%`])
    comprobar(corte.cortadas === 1 && /No llegó la respuesta/.test(corto) && idTrasElCorte === antes.id,
      `[Logística 1440] sin respuesta, el formulario se queda con el mismo id: «${corto}»`)
    comprobar(filas.length === 1 && filas[0].id === antes.id && filas[0].ruta_storage === `compra/${fila.orden_compra_id}/${antes.id}.pdf` && sueltos.length === 0,
      `[Logística 1440] el reintento entra una vez, con ese id y su ruta, y sin archivos sueltos («${dijo}»; ${filas.length} fila(s), ${sueltos.length} suelto(s))`)
    await pagina.screenshot({ path: join(CAPTURAS, 'tablero-ot.png'), fullPage: true })
    await pagina.unrouteAll({ behavior: 'ignoreErrors' })
    await contexto.close()
  }
}

await navegador.close()
await base.end()
comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.slice(0, 4).join(' | ')}` : ''}`)
console.log(fallas.length ? `\n${fallas.length} FALLAS` : '\nTODO EN VERDE')
process.exit(fallas.length ? 1 : 0)
