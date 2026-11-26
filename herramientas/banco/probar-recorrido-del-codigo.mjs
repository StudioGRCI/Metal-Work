/**
 * Recorre con clic real «De la cotización al cobro» en la cabecera del código
 * interno (plan 12, entrega 12.3), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Gerencia abre el código `QA-CI <sello>` que deja `probar-facturacion.mjs`
 *      (cotización aprobada, su OT, una factura y un cobro a cuenta) y ve los
 *      cinco pasos con su situación: la cotización aprobada, la OT en curso, el
 *      costo hasta hoy, lo facturado y lo cobrado
 *      con lo que falta cobrar. Las cifras son las de la pestaña «Factura y
 *      cobro» y las del costeo: no se recalculan. Cada enlace lleva a su
 *      documento: la cotización, el expediente de la OT, el costeo y la factura.
 *   2. En el teléfono (390 px) los pasos van uno bajo otro, sin correr la página.
 *   3. Administración, que consulta el código en lectura, ve el mismo recorrido.
 *   4. PLANTA no tiene recorrido; un código sin cotización ni OT dice qué falta.
 *   5. Gerencia de Producción, sin `codigos_internos.ver`, no entra.
 *
 * Correr antes `probar-facturacion.mjs`, que siembra el código; esta sonda no
 * escribe nada. Variables: BANCO_CLAVE, BASE
 * (http://localhost:3111), BANCO_BASE (mw_demo), BANCO_CHROMIUM, CAPTURAS.
 */
import { mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas/recorrido-del-codigo'
const CUENTAS = {
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
  administracion: process.env.ADMINISTRACION ?? 'administracion.local@metalwork.test',
  produccion: process.env.GERENCIA_PRODUCCION ?? 'gerencia.produccion.local@metalwork.test',
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

// ------------------------------------------------------------- la siembra
const [sembrado] = await consulta(`
  select u.codigo_interno as codigo, o.id as ot, o.numero as ot_numero, c.numero as cotizacion,
         (select f.numero from public.facturas_venta f where f.cotizacion_pdf_id = c.id and f.anulada_en is null order by f.creado_en limit 1) as factura
    from public.unidades u
    join public.ordenes_trabajo o on o.unidad_id = u.id and o.estado <> 'ANULADA'
    join public.cotizaciones_pdf c on c.id = o.cotizacion_pdf_id
   where u.codigo_interno like 'QA-CI %'
     and exists (select 1 from public.facturas_venta f where f.cotizacion_pdf_id = c.id and f.anulada_en is null)
   order by u.creado_en desc
   limit 1`)
if (!sembrado) {
  console.error('No hay un código QA-CI con factura: correr antes probar-facturacion.mjs.')
  process.exit(1)
}
const { codigo } = sembrado

console.log(`     código ${codigo}: cotización ${sembrado.cotizacion}, OT ${sembrado.ot_numero}, factura ${sembrado.factura}`)

// ------------------------------------------------------------- el navegador
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
async function ir(pagina, url) {
  await pagina.goto(url, { waitUntil: 'load' })
  await quieta(pagina)
}
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
async function entrar(correo, viewport = { width: 1440, height: 900 }) {
  const telefono = viewport.width < 500
  const contexto = await navegador.newContext({ viewport, isMobile: telefono, hasTouch: telefono, deviceScaleFactor: 2, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  await ir(pagina, `${BASE}/ingresar`)
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  await quieta(pagina)
  return { pagina, contexto }
}

const detalle = (c, vista) => `${BASE}/codigos-internos/detalle?${new URLSearchParams({ codigo: c, ...(vista ? { vista } : {}) })}`
/** Next pinta primero el esqueleto de la pantalla nueva: se espera a que el texto llegue, a lo sumo 20 s. */
const llega = (pagina, texto) =>
  pagina
    .waitForFunction((t) => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' ').includes(t), texto, { timeout: 20000 })
    .then(() => true)
    .catch(() => false)
const recorrido = (pagina) => pagina.locator('[data-recorrido-del-codigo]')
const paso = (pagina, clave) => recorrido(pagina).locator(`[data-paso="${clave}"]`)
async function pasos(pagina) {
  return recorrido(pagina)
    .locator('[data-paso]')
    .evaluateAll((li) => li.map((l) => ({ clave: l.dataset.paso, situacion: l.dataset.situacion, texto: l.textContent.replace(/\s+/g, ' ').trim() })))
}

try {
  // ----------------------------------------------------- 1. Gerencia, monitor
  {
    const { pagina, contexto } = await entrar(CUENTAS.gerencia)
    await ir(pagina, detalle(codigo))
    const lista = await pasos(pagina)
    console.log(lista.map((p) => `     ${p.clave} [${p.situacion}] ${p.texto}`).join('\n'))
    const de = Object.fromEntries(lista.map((p) => [p.clave, p]))
    comprobar(lista.map((p) => p.clave).join(',') === 'cotizacion,orden,costo,facturado,cobrado', 'Gerencia ve los cinco pasos, en orden')
    comprobar(de.cotizacion?.situacion === 'HECHO' && de.cotizacion.texto.includes(sembrado.cotizacion), `la cotización ${sembrado.cotizacion}, aprobada, va hecha`)
    comprobar(de.orden?.situacion === 'AHORA' && de.orden.texto.includes(`OT ${sembrado.ot_numero}`), `la OT ${sembrado.ot_numero} va en curso`)
    comprobar(de.costo?.situacion === 'AHORA' && /S\/\s?[\d,]+\.\d\d/.test(de.costo.texto) && de.costo.texto.includes('hasta hoy'), 'el costo va en curso, con su cifra hasta hoy')
    comprobar(de.facturado?.situacion === 'HECHO' && de.facturado.texto.includes('US$ 29,500.00'), 'lo facturado, hecho, con el total de la factura')
    comprobar(de.cobrado?.situacion === 'AHORA' && de.cobrado.texto.includes('US$ 10,000.00') && de.cobrado.texto.includes('por cobrar US$ 19,500.00'), 'lo cobrado, en curso, con lo que falta cobrar')
    comprobar((await recorrido(pagina).getByRole('button').count()) === 0, 'el recorrido no tiene botones: solo lleva a cada documento')

    // Las cifras no se recalculan: el costo es el mismo que dice la pestaña Costeo.
    const costoArriba = limpio(await paso(pagina, 'costo').locator('p').nth(1).textContent()).split(' de ')[0]
    await recorrido(pagina).screenshot({ path: `${CAPTURAS}/1440-gerencia-recorrido.png` })
    await pagina.screenshot({ path: `${CAPTURAS}/1440-gerencia.png` })

    await paso(pagina, 'costo').getByRole('link', { name: 'Ver el costeo' }).click()
    await pagina.waitForURL(/vista=costeo/, { timeout: 30000 })
    await quieta(pagina)
    comprobar(await llega(pagina, costoArriba), `«Ver el costeo» abre el costeo, que suma lo mismo (${costoArriba})`)

    await ir(pagina, detalle(codigo))
    await paso(pagina, 'facturado').getByRole('link', { name: 'Ver factura y cobro' }).click()
    await pagina.waitForURL(/vista=facturacion/, { timeout: 30000 })
    await quieta(pagina)
    comprobar(await llega(pagina, sembrado.factura), '«Ver factura y cobro» abre la factura del código')

    await ir(pagina, detalle(codigo))
    await paso(pagina, 'orden').getByRole('link', { name: 'Ver el expediente' }).click()
    await pagina.waitForURL(new RegExp(`/ordenes/${sembrado.ot}/expediente`), { timeout: 30000 })
    await quieta(pagina)
    comprobar(await llega(pagina, `Expediente de fabricación · ${sembrado.ot_numero}`), `«Ver el expediente» abre el de la OT ${sembrado.ot_numero}`)

    await ir(pagina, detalle(codigo))
    await paso(pagina, 'cotizacion').getByRole('link', { name: 'Ver la cotización' }).click()
    await pagina.waitForURL(/\/cotizaciones\/pdf/, { timeout: 30000 })
    await quieta(pagina)
    comprobar(await llega(pagina, `${sembrado.cotizacion}Aprobada`), `«Ver la cotización» abre la ${sembrado.cotizacion}`)

    // PLANTA no se cotiza: no tiene recorrido.
    await ir(pagina, detalle('PLANTA'))
    comprobar((await recorrido(pagina).count()) === 0, 'PLANTA no tiene recorrido')
    await contexto.close()
  }

  // ----------------------------------------------------- 2. Gerencia, teléfono
  {
    const { pagina, contexto } = await entrar(CUENTAS.gerencia, { width: 390, height: 844 })
    await ir(pagina, detalle(codigo))
    const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(ancho <= 390, `en 390 px la página no se corre de costado (${ancho} px)`)
    const cajas = await recorrido(pagina).locator('[data-paso]').evaluateAll((li) => li.map((l) => l.getBoundingClientRect().left))
    comprobar(cajas.length === 5 && new Set(cajas.map(Math.round)).size === 1, 'en el teléfono los pasos van uno bajo otro')
    const altos = await recorrido(pagina).getByRole('link').evaluateAll((a) => a.map((x) => x.getBoundingClientRect().height))
    comprobar(altos.every((h) => h >= 44), `cada enlace mide 44 px o más para el dedo (${altos.map(Math.round).join(', ')})`)
    await recorrido(pagina).screenshot({ path: `${CAPTURAS}/390-gerencia-recorrido.png` })
    await pagina.screenshot({ path: `${CAPTURAS}/390-gerencia.png` })
    await contexto.close()
  }

  // ----------------------------------------------------- 3. Administración
  {
    const { pagina, contexto } = await entrar(CUENTAS.administracion)
    await ir(pagina, detalle(codigo))
    const lista = await pasos(pagina)
    comprobar(lista.length === 5 && lista.find((p) => p.clave === 'cobrado')?.texto.includes('US$ 10,000.00'), 'Administración ve el mismo recorrido, con lo cobrado')
    await contexto.close()
  }

  // ----------------------------------------------------- 4. Un código sin cotización ni OT
  {
    // Un código que el sistema lista y que no tiene unidad: el primero cuyo detalle se abre con su recorrido.
    const candidatos = await consulta(`
      select r.codigo_interno as codigo
        from (select codigo_interno from public.reportes_diarios
              union select codigo_interno from public.requerimientos
              union select codigo_interno from public.ordenes_servicio) r
       where r.codigo_interno is not null and r.codigo_interno not in ('PLANTA', 'OFICINA', 'TODOS LOS ACTIVOS')
         and not exists (select 1 from public.unidades u where u.codigo_interno = r.codigo_interno)
       order by 1
       limit 8`)
    const { pagina, contexto } = await entrar(CUENTAS.gerencia)
    let otro = null
    for (const c of candidatos) {
      await ir(pagina, detalle(c.codigo))
      if ((await recorrido(pagina).count()) > 0) {
        otro = c
        break
      }
    }
    if (otro) {
      const lista = await pasos(pagina)
      const de = Object.fromEntries(lista.map((p) => [p.clave, p]))
      comprobar(
        de.cotizacion?.situacion === 'FALTA' && de.cotizacion.texto.includes('Sin cotización') && de.orden?.situacion === 'FALTA' && de.orden.texto.includes('Sin OT'),
        `${otro.codigo}, sin unidad, dice «Sin cotización» y «Sin OT»`,
      )
      comprobar(de.facturado?.texto.includes('Sin factura') && de.cobrado?.situacion === 'FALTA', 'y lo facturado y cobrado, todavía no')
      await recorrido(pagina).screenshot({ path: `${CAPTURAS}/1440-gerencia-sin-ot.png` })
    } else {
      console.log('     (no hay un código sin unidad en el banco: se salta el caso 4)')
    }
    await contexto.close()
  }

  // ----------------------------------------------------- 5. Quien no ve códigos no entra
  {
    const { pagina, contexto } = await entrar(CUENTAS.produccion)
    await ir(pagina, detalle(codigo))
    comprobar((await recorrido(pagina).count()) === 0 && !pagina.url().includes('/codigos-internos/detalle'), `Gerencia de Producción no entra al código (${new URL(pagina.url()).pathname})`)
    await contexto.close()
  }
} finally {
  await navegador.close()
  await base.end()
}

if (errores.length) console.log(`\nErrores de consola:\n${errores.map((e) => `  ${e}`).join('\n')}`)
console.log(fallas.length ? `\n${fallas.length} fallas.` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
