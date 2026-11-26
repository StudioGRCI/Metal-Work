/**
 * «Cobrado» en la moneda de la factura (plan 12, arreglo de la entrega 12.3).
 *
 * Un código facturado en dólares y sin cobros decía «Cobrado S/ 0.00» en «De la
 * cotización al cobro» (lo vio Contabilidad). Esta sonda busca en el banco un
 * código cuyas facturas vivas sean todas en dólares y sin nada cobrado, lo abre
 * con la cuenta de Gerencia (nunca ADMIN) y comprueba que el paso «Cobrado» diga
 * «US$ 0.00», que no diga «S/» y que lo por cobrar vaya en dólares.
 *
 * No escribe nada. Si el banco no tiene un código así, lo dice y sale con 1.
 * Se arma con un `QA-CI` de `probar-facturacion.mjs` (factura en dólares con un
 * cobro a cuenta), anulando su cobro en el banco, nunca en producción:
 *
 *   psql -h /tmp -p 5433 -U postgres -d mw_demo -c "update cobros_factura_venta b
 *     set anulado_en = now(), anulado_por = b.registrado_por,
 *         motivo_anulacion = 'Prueba local: factura en dólares sin cobros'
 *     from facturas_venta f where f.id = b.factura_id
 *      and f.codigo_interno = 'QA-CI <sello>' and b.anulado_en is null"
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_CHROMIUM, CAPTURAS.
 */
import { mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas/cobrado-en-su-moneda'
const GERENCIA = process.env.GERENCIA ?? 'gerencia.local@metalwork.test'
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
const [codigo] = (
  await base.query(
    `select codigo_interno as codigo, sum(saldo) as saldo
       from public.v_facturas_venta
      where anulada_en is null and codigo_interno is not null
      group by codigo_interno
     having bool_and(moneda = 'USD') and sum(cobrado) = 0
      order by codigo_interno limit 1`,
  )
).rows
await base.end()
if (!codigo) {
  console.error('El banco no tiene un código facturado solo en dólares y sin cobros.')
  process.exit(1)
}

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const dolares = (n) => `US$ ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const navegador = await chromium.launch({ executablePath: NAVEGADOR })
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
    const pagina = await contexto.newPage()
    await pagina.goto(`${BASE}/ingresar`)
    await pagina.fill('input[type="email"]', GERENCIA)
    await pagina.fill('input[type="password"]', CLAVE)
    await Promise.all([pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }), pagina.click('button[type="submit"]')])
    await pagina.goto(`${BASE}/codigos-internos/detalle?${new URLSearchParams({ codigo: codigo.codigo })}`)
    const paso = pagina.locator('[data-recorrido-del-codigo] [data-paso="cobrado"]')
    await paso.waitFor({ timeout: 30000 })
    const texto = limpio(await paso.textContent())
    console.log(`${viewport.width} px · ${codigo.codigo} · ${texto}`)
    comprobar(texto.includes('US$ 0.00'), `${viewport.width} px: «Cobrado» dice US$ 0.00`)
    comprobar(!texto.includes('S/'), `${viewport.width} px: «Cobrado» no dice soles`)
    comprobar(texto.includes(`por cobrar ${dolares(codigo.saldo)}`), `${viewport.width} px: lo por cobrar va en dólares (${dolares(codigo.saldo)})`)
    await pagina.locator('[data-recorrido-del-codigo]').screenshot({ path: `${CAPTURAS}/${viewport.width}-gerencia.png` })
    await contexto.close()
  }
} finally {
  await navegador.close()
}
console.log(fallas.length ? `\n${fallas.length} fallas.` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
