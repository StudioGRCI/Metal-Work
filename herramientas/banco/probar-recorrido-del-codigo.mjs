/**
 * Recorre con clic real «De la cotización al cobro» en la cabecera del código
 * interno (plan 12, entrega 12.3), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Gerencia abre el código `QA-CI <sello>` que deja `probar-facturacion.mjs`
 *      (cotización aprobada, su OT, una factura por la mitad y un cobro a
 *      cuenta) y ve los cinco pasos con su situación: la cotización y la OT que
 *      da la base (`codigo_interno_recorrido`, leída aquí con la sesión de
 *      Gerencia), el costo hasta hoy, lo facturado en parte contra lo vendido
 *      con IGV y lo cobrado con lo que falta cobrar. Las cifras salen de la
 *      base y del costeo: no se recalculan. Cada enlace lleva a su documento:
 *      la cotización, el expediente de la OT, el costeo y la factura.
 *   2. En el teléfono (390 px) los pasos van uno bajo otro, sin correr la página.
 *   3. Administración, que consulta el código en lectura, ve el mismo recorrido.
 *   4. PLANTA no tiene recorrido; un código sin cotización ni OT dice qué falta.
 *   5. Gerencia de Producción, sin `codigos_internos.ver`, no entra.
 *   6. Los códigos `QA-AUD` del auditor, si están: la OT de fabricación
 *      entregada manda sobre la garantía en borrador que llegó después, y el
 *      costeo cerrado muestra lo congelado.
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
const [gerente] = await consulta(`select id from public.usuarios where correo = $1`, [CUENTAS.gerencia])

/** Lo que la base elige para el código, con la sesión de Gerencia (nunca ADMIN). */
async function loQueDiceLaBase(c) {
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true)`, [gerente.id])
    await base.query('set local role authenticated')
    const [r] = await consulta('select * from public.codigo_interno_recorrido($1)', [c])
    return r
  } finally {
    await base.query('rollback')
  }
}
const dinero = (n, m = 'PEN') => `${m === 'USD' ? 'US$' : 'S/'} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const delSembrado = await loQueDiceLaBase(codigo)
// Lo vendido con IGV, la cuenta de la bandeja de Contabilidad: sin confirmar, el monto se toma con IGV.
const [venta] = await consulta(
  `select c.moneda::text as moneda, case when ig.incluye_igv = false then round(c.monto_venta * 1.18, 2) else c.monto_venta end as vendido,
          (select sum(f.total) from public.facturas_venta f where f.cotizacion_pdf_id = c.id and f.anulada_en is null) as facturado
     from public.cotizaciones_pdf c left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id
    where c.numero = $1`,
  [sembrado.cotizacion],
)

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
    comprobar(
      de.cotizacion?.situacion === 'HECHO' && delSembrado.cotizacion_numero === sembrado.cotizacion && de.cotizacion.texto.includes(delSembrado.cotizacion_numero),
      `la cotización ${delSembrado.cotizacion_numero}, la que elige la base, aprobada, va hecha`,
    )
    comprobar(
      de.orden?.situacion === 'AHORA' && delSembrado.ot_numero === sembrado.ot_numero && de.orden.texto.includes(`OT ${delSembrado.ot_numero}`),
      `la OT ${delSembrado.ot_numero}, la que elige la base, va en curso`,
    )
    comprobar(de.costo?.situacion === 'AHORA' && /S\/\s?[\d,]+\.\d\d/.test(de.costo.texto) && de.costo.texto.includes('hasta hoy'), 'el costo va en curso, con su cifra hasta hoy')
    const facturadoEsperado = `${dinero(venta.facturado, venta.moneda)} de ${dinero(venta.vendido, venta.moneda)}`
    comprobar(
      Number(venta.facturado) < Number(venta.vendido) &&
        de.facturado?.situacion === 'AHORA' &&
        de.facturado.texto.includes(facturadoEsperado) &&
        de.facturado.texto.includes(`falta facturar ${dinero(venta.vendido - venta.facturado, venta.moneda)}`),
      `lo facturado en parte va en curso, no hecho: ${facturadoEsperado}`,
    )
    comprobar(
      de.cobrado?.situacion === 'AHORA' && de.cobrado.texto.includes('US$ 10,000.00') && de.cobrado.texto.includes('por cobrar US$ 19,500.00 de lo facturado'),
      'lo cobrado, en curso, con lo que falta cobrar de lo facturado',
    )
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
    // «Ver el costeo» baja a la sección, como las pestañas: en el teléfono empieza dos pantallas más abajo.
    await paso(pagina, 'costo').getByRole('link', { name: 'Ver el costeo' }).click()
    await pagina.waitForURL(/vista=costeo/, { timeout: 30000 })
    await quieta(pagina)
    await pagina.waitForFunction(() => window.scrollY > 0, null, { timeout: 10000 }).catch(() => {})
    const y = await pagina.evaluate(() => window.scrollY)
    comprobar(y > 0, `en el teléfono, «Ver el costeo» baja hasta la sección (scrollY ${Math.round(y)})`)
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

  // ----------------------------------------------------- 6. La garantía y el costeo cerrado (códigos del auditor)
  {
    const aud = await consulta(`
      select distinct u.codigo_interno as codigo from public.unidades u
       where u.codigo_interno like 'QA-AUD %'
         and (exists (select 1 from public.ordenes_trabajo o where o.unidad_id = u.id and o.tipo_trabajo = 'GARANTIA' and o.estado <> 'ANULADA')
              or exists (select 1 from public.codigo_interno_cierres k where k.codigo = u.codigo_interno and k.reabierto_en is null))
       order by 1`)
    if (aud.length === 0) console.log('     (no están los códigos QA-AUD: se salta el caso 6)')
    const { pagina, contexto } = await entrar(CUENTAS.gerencia)
    for (const { codigo: c } of aud) {
      const r = await loQueDiceLaBase(c)
      await ir(pagina, detalle(c))
      const de = Object.fromEntries((await pasos(pagina)).map((p) => [p.clave, p]))
      const [conGarantia] = await consulta(
        `select count(*)::int as n from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id
          where u.codigo_interno = $1 and o.tipo_trabajo = 'GARANTIA' and o.estado <> 'ANULADA'`,
        [c],
      )
      if (conGarantia.n > 0 && r.ot_tipo !== 'GARANTIA') {
        comprobar(
          de.orden?.texto.includes(`OT ${r.ot_numero}`) && de.orden.texto.includes(`y ${r.ordenes - 1} más`) && !de.orden.texto.includes('garantía'),
          `${c}: la OT ${r.ot_numero} de fabricación manda sobre la garantía, y dice que hay ${r.ordenes - 1} más`,
        )
        if (r.ot_entregada_el) {
          const [d] = await consulta(`select to_char($1::date, 'DD/MM/YYYY') as f`, [r.ot_entregada_el])
          comprobar(de.orden.situacion === 'HECHO' && de.orden.texto.toLowerCase().includes(`entregada el ${d.f}`), `${c}: con la fecha de entrega de esa OT (${d.f})`)
        }
      }
      const [cierre] = await consulta(
        `select costo_pen, to_char(cerrado_en at time zone 'America/Lima', 'DD/MM/YYYY') as el from public.codigo_interno_cierres
          where codigo = $1 and reabierto_en is null order by cerrado_en desc limit 1`,
        [c],
      )
      const [cobro] = await consulta(
        `select coalesce(sum(total), 0) as total, coalesce(sum(cobrado), 0) as cobrado, coalesce(sum(saldo), 0) as saldo
           from public.v_facturas_venta where codigo_interno = $1 and anulada_en is null`,
        [c],
      )
      if (Number(cobro.saldo) === 0 && Number(cobro.cobrado) < Number(cobro.total)) {
        comprobar(
          de.cobrado?.texto.includes('dio por cancelada con menos de lo facturado') && !de.cobrado.texto.includes('todo lo facturado está cobrado'),
          `${c}: cancelada con ${dinero(cobro.cobrado)} de ${dinero(cobro.total)}, no dice «todo cobrado»`,
        )
      }
      if (cierre) {
        comprobar(
          de.costo?.texto.includes(dinero(cierre.costo_pen)) && de.costo.texto.includes(`costeo cerrado el ${cierre.el}`) && !de.costo.texto.includes('del presupuesto'),
          `${c}: el costo es el congelado al cierre (${dinero(cierre.costo_pen)}), sin porcentaje del presupuesto`,
        )
        comprobar(de.costo.situacion === 'HECHO', `${c}: con el costeo cerrado, el paso del costo va hecho`
        )
      }
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
