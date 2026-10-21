/**
 * Clic real sobre el despacho de un pedido de OT con decimales.
 *
 * Va con la cuenta de administración a propósito: el despacho de la OT pide
 * `almacen.despachar`, que hoy solo tiene ALMACENERO, y Almacén no abre la OT
 * (desde la migración 20261016120000 no tiene `ordenes.ver`; lo suyo es el
 * kardex). Ningún otro puesto llega a este formulario. Lo que se prueba aquí es
 * la cuenta del navegador, no un permiso. Para que el formulario salga, el
 * script le da al rol ADMIN **del banco** `requerimientos.ver`, `almacen.ver`
 * y `almacen.despachar` (sin ellos no lee las líneas ni el saldo). La función
 * de la base con el rol real de Almacén se prueba aparte, en SQL.
 *
 *   1. Se pidieron 5.3 KG y ya salieron 2.1. El despacho propone 3.2, no
 *      3.1999999999999997, y dice «Disponible para este requerimiento: 3.2».
 *   2. 3.2 escrito a mano es válido para el navegador (antes el tope era
 *      3.1999999999999997 y 3.2 quedaba «por encima del máximo»).
 *   3. Se despacha 3.2 con foto y quien recibe, la base lo registra y el
 *      pedido queda entregado entero (5.3 de 5.3): ya no ofrece despachar.
 *   4. Lo mismo, a 390 px de ancho.
 *
 * Siembra sola, como postgres y sin disparadores, lo que necesita (y lo rehace
 * en cada corrida): un pedido de la OT 0001-2026 para Maestranza, 5.3 KG de
 * PL-HRD-8 decidido de stock, 2.1 ya despachados y 20 KG de saldo.
 * Variables: BANCO_CLAVE, BANCO_CORREO, BANCO_BASE (mw_demo), PGHOST, PGPORT, BASE (http://localhost:3111), CAPTURAS, ANCHO.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ANCHO = Number(process.env.ANCHO ?? 1280)
const CORREO = process.env.BANCO_CORREO ?? 'studiogrci@gmail.com'
const ORDEN = 'c21a0d2e-55d4-4ef9-813c-ab98481d74f9'
const DETALLE = '00000000-0000-4000-8000-0000000000a3'
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

// Una foto JPG mínima válida (la acción revisa la cabecera).
const FOTO = join(CAPTURAS, 'entrega.jpg')
writeFileSync(FOTO, Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'))

const SIEMBRA = `
set session_replication_role = replica;
delete from movimientos_materiales where requerimiento_detalle_id = '${DETALLE}' or documento_referencia = 'Saldo de prueba de decimales';
delete from requerimiento_material_detalles where id = '${DETALLE}';
delete from requerimientos_materiales where id = '00000000-0000-4000-8000-0000000000a2';
delete from ot_materiales where id = '00000000-0000-4000-8000-0000000000a1';
with m as (select id from materiales where codigo = 'PL-HRD-8'),
     s as (select u.id from usuarios u join areas a on a.id = u.area_id where a.codigo = 'MTZ' and u.activo order by u.correo limit 1),
     om as (insert into ot_materiales (id, orden_id, material_id, cantidad, area_destino)
            select '00000000-0000-4000-8000-0000000000a1', '${ORDEN}', m.id, 5.3, 'MTZ' from m returning id),
     r as (insert into requerimientos_materiales (id, orden_id, area_destino, solicitado_por)
           select '00000000-0000-4000-8000-0000000000a2', '${ORDEN}', 'MTZ', s.id from s returning id),
     d as (insert into requerimiento_material_detalles (id, requerimiento_id, ot_material_id, cantidad_solicitada, aprobacion_diseno, decision_almacen, cantidad_stock)
           select '${DETALLE}', r.id, om.id, 5.3, 'APROBADO', 'STOCK', 5.3 from r, om returning id),
     i as (insert into movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
           select gen_random_uuid(), 'INGRESO', m.id, 20, 'SALDO_INICIAL', 'Saldo de prueba de decimales', s.id from m, s returning id)
insert into movimientos_materiales (id, tipo, requerimiento_detalle_id, material_id, cantidad, responsable_id, registrado_por, codigo_unidad, origen, recibido_por_nombre, cantidad_de_stock)
select gen_random_uuid(), 'DESPACHO', d.id, m.id, 2.1, s.id, s.id, 'V2G-841', 'DESPACHO', 'Aurelio', 2.1 from d, m, s;
set session_replication_role = origin;
insert into roles_permisos (rol_id, permiso_codigo)
select id, p from roles, unnest(array['requerimientos.ver', 'almacen.ver', 'almacen.despachar']) p where codigo = 'ADMIN'
on conflict do nothing;
`
execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', process.env.BANCO_BASE ?? 'mw_demo', '-c', SIEMBRA], {
  env: { PGHOST: '/tmp', PGPORT: '5433', PGUSER: 'postgres', ...process.env },
  stdio: ['ignore', 'ignore', 'inherit'],
})

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const contexto = await navegador.newContext({ viewport: { width: ANCHO, height: 900 } })
const pagina = await contexto.newPage()
const errores = []
pagina.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
})
await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
await pagina.fill('input[type="email"]', CORREO)
await pagina.fill('input[type="password"]', CLAVE)
await Promise.all([
  pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
  pagina.click('button[type="submit"]'),
])
if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${CORREO}`)

await pagina.goto(`${BASE}/ordenes/${ORDEN}?vista=materiales`, { waitUntil: 'networkidle' })
const cantidad = pagina.locator(`#sal-cant-${DETALLE}`)
await cantidad.waitFor({ timeout: 30000 })
await cantidad.scrollIntoViewIfNeeded()
await pagina.screenshot({ path: join(CAPTURAS, `despacho-propone-${ANCHO}.png`), fullPage: false })

const propuesto = await cantidad.inputValue()
const tope = await cantidad.getAttribute('max')
comprobar(propuesto === '3.2', `propone ${propuesto} (se espera 3.2)`)
comprobar(tope === '3.2', `el tope es ${tope} (se espera 3.2)`)
const formulario = cantidad.locator('xpath=ancestor::form')
const aviso = (await formulario.innerText()).replace(/\s+/g, ' ')
comprobar(/Disponible para este requerimiento: 3[.,]2\b/.test(aviso) && !/3[.,]1999/.test(aviso), 'dice «Disponible para este requerimiento: 3.2»')

await cantidad.fill('')
await cantidad.pressSequentially('3.2')
comprobar(await cantidad.evaluate((e) => e.validity.valid), '3.2 escrito a mano es válido para el navegador')

await formulario.locator('select[name="responsable_id"]').selectOption({ index: 1 })
await formulario.locator('input[name="recibido_por_nombre"]').fill('Aurelio de Maestranza')
await formulario.locator('input[name="foto"]').setInputFiles(FOTO)
await formulario.getByRole('button', { name: 'Despachar' }).click()
await pagina.waitForFunction((id) => !document.getElementById(`sal-cant-${id}`), DETALLE, { timeout: 30000 }).catch(() => {})
await pagina.waitForLoadState('networkidle')
const alerta = await formulario.locator('[role="alert"]').innerText().catch(() => '')
comprobar(!alerta, `sin error al despachar${alerta ? ` (dice: ${alerta})` : ''}`)
comprobar(await pagina.locator(`#sal-cant-${DETALLE}`).count() === 0, 'entregado entero: ya no ofrece despachar')
await pagina.screenshot({ path: join(CAPTURAS, `despacho-entregado-${ANCHO}.png`), fullPage: false })
comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)

await navegador.close()
if (fallas.length) {
  console.log(`\n${fallas.length} fallan.`)
  process.exit(1)
}
console.log('\nTodo pasa.')
