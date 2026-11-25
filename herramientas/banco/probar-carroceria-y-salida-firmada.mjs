/**
 * Clic real sobre tres fallas que venían de main y vio la revisión del PR #184
 * (2026-11-25), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Ventas edita una carrocería con un nombre de dos letras: el aviso sale en
 *      castellano («El nombre de la carrocería debe tener entre 3 y 120
 *      caracteres.»), no «Too small: expected string to have >=3 characters».
 *   2. Ventas le cambia el nombre y la desactiva: el código de la carrocería se
 *      queda (migración 20261125300000). Antes `editar_carroceria_ventas` lo
 *      volvía a armar del nombre: VPC pasaba a TOLVA_VOLQUETE_PISO_CIRCULAR.
 *      Diseño, que corrige la fila directo, tampoco lo cambia.
 *   3. Almacén carga el formato firmado de una salida de EPP en el
 *      Kardex: la salida sale de «Salidas por cerrar» y el aviso de que se
 *      cerró se queda después de que la pantalla se pone al día (antes vivía
 *      en la fila y se iba con ella). La base la da por cerrada, con su archivo.
 *
 * Siembra una carrocería y una salida propias, con un sufijo por corrida.
 * `SOLO=salida` corre solo la parte 3.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, PGHOST,
 * PGPORT, BANCO_BASE (mw_demo).
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
  ventas: 'ventas.local@metalwork.test',
  diseno: 'diseno.local@metalwork.test',
  almacen: 'almacen.local@metalwork.test',
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

// ============================================ 0. Lo que se siembra
const sufijo = Date.now().toString(36).slice(-4).toUpperCase()
// Con código de tres letras, como las de la hoja COD; su nombre armaría otro.
const CODIGO = `Q${sufijo.slice(-3)}`
const [carroceria] = await consulta(`insert into public.tipos_carroceria (codigo, nombre, orden_secuencia, activo)
  values ($1, $2, 99, true) returning id::text, nombre`, [CODIGO, `Tolva del banco ${sufijo}`])
const deLaCarroceria = async () =>
  (await consulta('select codigo, nombre, activo from public.tipos_carroceria where id = $1', [carroceria.id]))[0]

// Una salida de EPP abierta, sin su formato firmado (la materia prima sale solo
// con su RQ, que tiene su propia prueba): como dueño de las
// tablas, la salida del kardex tiene sus propias pruebas.
const [plancha] = await consulta(`insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ($1, $2, (select id from public.categorias_material where activo and almacen = 'EPP' order by codigo limit 1),
          (select id from public.unidades_medida where codigo = 'UND'))
  returning id::text, descripcion`, [`PRB-FIR-${sufijo}`, `Guantes del formato firmado ${sufijo}`])
await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
  select gen_random_uuid(), 'INGRESO', $1::uuid, 10, 'INGRESO_GENERAL', $2, u.id from public.usuarios u where u.correo = $3`,
[plancha.id, `GR BANCO FIR ${sufijo}`, CUENTAS.almacen])
const [salida] = await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, recibido_por_nombre, codigo_unidad)
  select gen_random_uuid(), 'SALIDA', $1::uuid, 3, 'SALIDA_GENERAL', $2, u.id, 'Soldador del banco', 'PLANTA' from public.usuarios u where u.correo = $3
  returning id::text, formato_cerrado_en`, [plancha.id, `VALE BANCO FIR ${sufijo}`, CUENTAS.almacen])
comprobar(salida.formato_cerrado_en === null, 'la salida de EPP sembrada queda abierta')
console.log(`    sembrados: carrocería ${CODIGO} «${carroceria.nombre}», salida de ${plancha.descripcion}`)

const formato = join(CAPTURAS, `formato-firmado-${sufijo}.pdf`)
writeFileSync(formato, Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'))

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
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto, errores }
}
const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim()

/** Abre «Editar» de la carrocería sembrada, escribe `nombre` y guarda. Devuelve la ventana. */
async function editar(pagina, nombre) {
  await pagina.goto(`${BASE}/carrocerias`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tr', { hasText: CODIGO }).first()
  await fila.getByRole('button', { name: 'Editar' }).click()
  const ventana = pagina.getByRole('dialog')
  await ventana.waitFor()
  await ventana.getByLabel('Nombre').fill(nombre)
  await ventana.getByRole('button', { name: 'Guardar cambios' }).click()
  return ventana
}

const SOLO = process.env.SOLO ?? ''

// ============================================ 1 y 2. Ventas
if (SOLO !== 'salida') {
  const { pagina, contexto, errores } = await entrar(CUENTAS.ventas)
  const ventana = await editar(pagina, 'ab')
  const alerta = ventana.getByRole('alert')
  await alerta.waitFor({ timeout: 15000 })
  const dice = await texto(alerta)
  console.log(`    con «ab»: «${dice}»`)
  comprobar(dice === 'El nombre de la carrocería debe tener entre 3 y 120 caracteres.', 'el nombre corto se rechaza en castellano')
  comprobar(!/too small|expected|characters/i.test(dice), 'sin el aviso en inglés de zod')
  await pagina.screenshot({ path: join(CAPTURAS, 'carroceria-nombre-corto.png') })
  comprobar((await deLaCarroceria()).nombre === carroceria.nombre, 'la base no cambió con el rechazo')

  const nuevo = `Tolva volquete del banco ${sufijo}`
  await ventana.getByLabel('Nombre').fill(nuevo)
  await ventana.getByRole('button', { name: 'Guardar cambios' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 15000 })
  const tras = await deLaCarroceria()
  comprobar(tras.nombre === nuevo && tras.codigo === CODIGO, `Ventas cambia el nombre y el código sigue siendo ${CODIGO} (${tras.codigo})`)
  const fila = pagina.locator('tr', { hasText: CODIGO }).first()
  await fila.filter({ hasText: nuevo }).waitFor({ timeout: 15000 })
  comprobar(true, 'la lista muestra el nombre nuevo con el mismo código')

  await fila.getByRole('button', { name: 'Desactivar' }).click()
  for (let i = 0; i < 30 && (await deLaCarroceria()).activo; i++) await pagina.waitForTimeout(500)
  const desactivada = await deLaCarroceria()
  comprobar(!desactivada.activo && desactivada.codigo === CODIGO, `desactivada por Ventas, conserva su código (${desactivada.codigo})`)
  comprobar(errores.length === 0, `sin errores de consola como Ventas ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 2b. Diseño, que corrige la fila directo
if (SOLO !== 'salida') {
  await consulta('update public.tipos_carroceria set activo = true where id = $1', [carroceria.id])
  const { pagina, contexto, errores } = await entrar(CUENTAS.diseno)
  const ventana = await editar(pagina, 'x')
  const alerta = ventana.getByRole('alert')
  await alerta.waitFor({ timeout: 15000 })
  comprobar((await texto(alerta)) === 'El nombre de la carrocería debe tener entre 3 y 120 caracteres.', 'a Diseño también se lo dice en castellano')
  const nuevo = `Tolva corregida por Diseño ${sufijo}`
  await ventana.getByLabel('Nombre').fill(nuevo)
  await ventana.getByRole('button', { name: 'Guardar cambios' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 15000 })
  const tras = await deLaCarroceria()
  comprobar(tras.nombre === nuevo && tras.codigo === CODIGO, `Diseño cambia el nombre y el código se queda (${tras.codigo})`)
  comprobar(errores.length === 0, `sin errores de consola como Diseño ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 3. Almacén carga el formato firmado
for (const ancho of [1440, 390]) {
  // La segunda vuelta, con otra salida igual.
  let id = salida.id
  if (ancho === 390) {
    ;[{ id }] = await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, recibido_por_nombre, codigo_unidad)
      select gen_random_uuid(), 'SALIDA', $1::uuid, 2, 'SALIDA_GENERAL', $2, u.id, 'Soldador del banco', 'PLANTA' from public.usuarios u where u.correo = $3
      returning id::text`, [plancha.id, `VALE BANCO FIR2 ${sufijo}`, CUENTAS.almacen])
  }
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen, ancho)
  await pagina.goto(`${BASE}/almacen/kardex`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator('#por-cerrar')
  const fila = tarjeta.locator('li', { hasText: plancha.descripcion }).filter({ hasText: ancho === 390 ? '2 UND' : '3 UND' })
  await fila.getByRole('button', { name: 'Cargar firmado' }).click()
  await fila.locator('input[type="file"]').setInputFiles(formato)
  await fila.getByRole('button', { name: 'Cerrar salida' }).click()
  // Se espera lo que cambia: la fila se va y el aviso queda en la lista.
  await fila.waitFor({ state: 'detached', timeout: 20000 })
  const aviso = tarjeta.getByRole('status').filter({ hasText: 'Salida cerrada con su formato firmado' })
  await aviso.waitFor({ timeout: 15000 })
  // Tras ponerse al día la pantalla (revalidatePath), el aviso sigue ahí.
  await pagina.waitForLoadState('networkidle')
  await pagina.waitForTimeout(2500)
  const dice = (await aviso.count()) === 1 ? await texto(aviso) : ''
  console.log(`    [${ancho}] aviso: «${dice}»`)
  comprobar(dice.includes(plancha.descripcion) && dice.includes('Salida cerrada con su formato firmado'),
    `[${ancho}] el aviso de la salida cerrada sigue a la vista después de ponerse al día la pantalla`)
  comprobar((await tarjeta.locator('li', { hasText: plancha.descripcion }).filter({ hasText: ancho === 390 ? '2 UND' : '3 UND' }).count()) === 0,
    `[${ancho}] la salida cerrada ya no está en la lista`)
  const [cerrada] = await consulta('select formato_cerrado_en, formato_ruta from public.movimientos_materiales where id = $1', [id])
  const [objeto] = cerrada.formato_ruta
    ? await consulta(`select count(*)::int as n from storage.objects where bucket_id = 'evidencias-almacen' and name = $1`, [cerrada.formato_ruta])
    : [{ n: 0 }]
  comprobar(cerrada.formato_cerrado_en !== null && objeto.n === 1, `[${ancho}] la base la da por cerrada, con su formato en Storage`)
  const ancho_ = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho_ <= ancho, `[${ancho}] la pantalla no se corre de costado (${ancho_} px)`)
  await pagina.screenshot({ path: join(CAPTURAS, `salida-firmada-${ancho}.png`), fullPage: false })
  comprobar(errores.length === 0, `[${ancho}] sin errores de consola como Almacén ${errores.join(' | ')}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallas.`)
process.exit(fallas.length === 0 ? 0 : 1)
