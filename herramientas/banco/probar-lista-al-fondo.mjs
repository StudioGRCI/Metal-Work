/**
 * La lista de un `SeleccionBuscable` que queda al fondo de una ventana se tiene
 * que ver entera en el teléfono. Antes se abría por debajo del borde de la
 * pantalla: en la salida del kardex, a 390 px, no se veía ninguno de los
 * vehículos. Con la cuenta de Almacén, que es quien registra la salida.
 *
 *   1. A 390 px, la lista de vehículos queda dentro de lo visible y se ven
 *      opciones; una se elige con clic real y queda puesta en el campo.
 *   2. Si lo visible se achica (el teclado del teléfono), la lista se acorta
 *      a lo que queda y sigue dentro.
 *   3. En una página suelta (el material del filtro del kardex), el campo que
 *      sube queda debajo de la barra de arriba y no tapado por ella.
 *   4. En el monitor, donde la lista cabe, abre sin mover nada.
 *
 * Necesita más de un puñado de vehículos activos para que la lista sea larga;
 * si el banco trae menos de 30, siembra los que faltan (códigos `PRB_…`).
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CORREO = 'almacen.local@metalwork.test'
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
const { rows: [{ activas }] } = await base.query('select count(*)::int as activas from public.unidades where activo')
if (activas < 30) {
  await base.query(`insert into public.unidades (placa, marca, modelo, codigo_interno)
    select 'Z' || lpad(n::text, 2, '0') || '-' || (100 + n), 'VOLVO', 'FMX', 'PRB_' || lpad(n::text, 3, '0')
      from generate_series(1, $1::int) n
     where not exists (select 1 from public.unidades u where u.codigo_interno = 'PRB_' || lpad(n::text, 3, '0'))`, [30 - activas])
}
await base.end()

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(viewport) {
  const movil = viewport.width < 500
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima' })
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
  await pagina.goto(`${BASE}/almacen/kardex`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Registrar salida' }).click()
  await pagina.getByRole('dialog').waitFor()
  return { pagina, contexto, errores }
}

/** Cuánto de la lista queda dentro de lo visible, y cuántas opciones se ven enteras. */
const medir = (pagina, idLista) =>
  pagina.evaluate((id) => {
    const ul = document.getElementById(id)
    const v = window.visualViewport
    // Fuera de una ventana, la barra de las secciones del teléfono tapa el pie.
    const pie = ul.closest('[role="dialog"]') ? null : document.querySelector('[data-barra-inferior]')?.getBoundingClientRect()
    const pantalla = v ? v.offsetTop + v.height : window.innerHeight
    const alto = pie && pie.height > 0 ? Math.min(pantalla, pie.top) : pantalla
    const caja = ul.getBoundingClientRect()
    const opciones = [...ul.querySelectorAll('[role="option"]')]
    const vistas = opciones.filter((o) => {
      const r = o.getBoundingClientRect()
      return r.top >= Math.max(caja.top, 0) && r.bottom <= Math.min(caja.bottom, alto)
    }).length
    return { arriba: Math.round(caja.top), abajo: Math.round(caja.bottom), alto: Math.round(alto), opciones: opciones.length, vistas }
  }, idLista)

// ---------------------------------------------------------------- 1 y 2: teléfono
{
  console.log('Teléfono, 390 × 844')
  const { pagina, contexto, errores } = await entrar({ width: 390, height: 844 })
  await pagina.getByRole('button', { name: 'Vehículo registrado' }).click()
  await pagina.locator('#sal-unidad').click()
  await pagina.locator('#sal-unidad-lista').waitFor()
  await pagina.waitForTimeout(400)
  let m = await medir(pagina, 'sal-unidad-lista')
  await pagina.screenshot({ path: join(CAPTURAS, 'lista-al-fondo-1-telefono.png') })
  console.log(`     lista de ${m.arriba} a ${m.abajo} px, lo visible llega a ${m.alto}; ${m.vistas} de ${m.opciones} opciones a la vista`)
  comprobar(m.abajo <= m.alto, 'la lista de vehículos termina dentro de la pantalla')
  comprobar(m.vistas >= 3, 'se ven al menos tres vehículos enteros')

  // El teclado del teléfono achica lo visible: se simula con una ventana más baja.
  await pagina.setViewportSize({ width: 390, height: 520 })
  await pagina.waitForTimeout(400)
  m = await medir(pagina, 'sal-unidad-lista')
  await pagina.screenshot({ path: join(CAPTURAS, 'lista-al-fondo-2-con-teclado.png') })
  console.log(`     con teclado: lista de ${m.arriba} a ${m.abajo} px, lo visible llega a ${m.alto}; ${m.vistas} a la vista`)
  comprobar(m.abajo <= m.alto, 'con el teclado abierto, la lista se acorta y sigue dentro')
  comprobar(m.vistas >= 1, 'con el teclado abierto se sigue viendo al menos un vehículo')

  const opcion = pagina.locator('#sal-unidad-lista [role="option"]').nth(1)
  const nombre = (await opcion.locator('.line-clamp-2').innerText()).trim()
  await opcion.click()
  await pagina.waitForTimeout(200)
  const puesto = (await pagina.locator('#sal-unidad').innerText()).trim()
  comprobar(puesto === nombre, `el vehículo elegido con clic queda en el campo («${nombre}»)`)
  comprobar(await pagina.locator('select[name="unidad_id"]').inputValue() !== '', 'y viaja en el formulario')
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------- 3: página suelta
{
  console.log('Teléfono, 390 × 500, el filtro del kardex al fondo de la pantalla')
  const { pagina, contexto, errores } = await entrar({ width: 390, height: 500 })
  await pagina.keyboard.press('Escape')
  await pagina.getByRole('dialog').waitFor({ state: 'detached' })
  // El campo, pegado al borde de abajo: así la lista no cabe y tiene que subir.
  await pagina.evaluate(() => {
    const campo = document.getElementById('k-material')
    const sobra = document.documentElement.scrollHeight - window.innerHeight - window.scrollY
    document.body.style.paddingBottom = '600px'
    window.scrollBy(0, campo.getBoundingClientRect().bottom - window.innerHeight + 4 + Math.min(sobra, 0))
  })
  await pagina.locator('#k-material').click()
  await pagina.locator('#k-material-lista').waitFor()
  await pagina.waitForTimeout(400)
  const barra = await pagina.locator('header').first().evaluate((h) => Math.round(h.getBoundingClientRect().bottom))
  const campo = await pagina.locator('#k-material').evaluate((b) => Math.round(b.getBoundingClientRect().top))
  const m = await medir(pagina, 'k-material-lista')
  await pagina.screenshot({ path: join(CAPTURAS, 'lista-al-fondo-3-pagina.png') })
  console.log(`     barra hasta ${barra} px, campo desde ${campo}; lista de ${m.arriba} a ${m.abajo}, lo visible llega a ${m.alto}`)
  comprobar(campo >= barra, 'el campo subido queda debajo de la barra de arriba')
  comprobar(m.abajo <= m.alto && m.vistas >= 1, `la lista se ve dentro de la pantalla (${m.vistas} a la vista)`)
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------- 4: monitor
{
  console.log('Monitor, 1280 × 900')
  const { pagina, contexto, errores } = await entrar({ width: 1280, height: 900 })
  await pagina.getByRole('button', { name: 'Vehículo registrado' }).click()
  const antes = await pagina.getByRole('dialog').evaluate((d) => {
    const rodable = [d, ...d.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight && getComputedStyle(e).overflowY !== 'visible')
    return { ventana: window.scrollY, dialogo: rodable?.scrollTop ?? 0 }
  })
  await pagina.locator('#sal-unidad').click()
  await pagina.locator('#sal-unidad-lista').waitFor()
  await pagina.waitForTimeout(300)
  const despues = await pagina.getByRole('dialog').evaluate((d) => {
    const rodable = [d, ...d.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight && getComputedStyle(e).overflowY !== 'visible')
    return { ventana: window.scrollY, dialogo: rodable?.scrollTop ?? 0 }
  })
  const m = await medir(pagina, 'sal-unidad-lista')
  await pagina.screenshot({ path: join(CAPTURAS, 'lista-al-fondo-3-monitor.png') })
  comprobar(m.abajo <= m.alto && m.vistas >= 3, `la lista de vehículos se ve entera (${m.vistas} a la vista)`)
  comprobar(antes.ventana === despues.ventana && antes.dialogo === despues.dialogo, 'abrir una lista que cabe no mueve la ventana')
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}

await navegador.close()
console.log(fallas.length ? `\n${fallas.length} fallan.` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
