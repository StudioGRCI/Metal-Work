/**
 * Las capturas de «Cómo validar un ingreso y contar el stock», con la cuenta
 * de prueba de Almacén (`almacen.local@metalwork.test`) en el banco local.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-validar-un-ingreso-y-contar-el-stock/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado:
 *
 *   BANCO_CLAVE='…' ./herramientas/banco/preparar.sh
 *
 * Fuera de cámara (`sembrar.mjs`): dos compras para stock que el conductor
 * dejó en almacén, una hace 3 días. En cámara, Almacén valida la más antigua
 * con su guía y registra un conteo físico de los discos, que da 2 de menos.
 */
import { abrir, cenido, cerrar, formatoPedido } from '../../scripts/captura.mjs'
import { STOCK, sembrar } from './sembrar.mjs'

const formato = formatoPedido()
if (formato !== 'horizontal') {
  console.error('Este video se entrega solo en horizontal.')
  process.exit(2)
}
const GUIA = 'GR-T001-456'
const CONTADO = STOCK.discos.hay - 2
const MOTIVO = 'Conteo del viernes: en el estante hay 2 discos menos.'

const s = await sembrar()
const { pagina, ir, tomar } = await abrir({ video: import.meta.url, formato, cuenta: 'almacen' })

// 1. Lo que dejó el conductor, el que más espera arriba.
await ir('/almacen/kardex')
const titulo = pagina.getByText(/^Ingresos por validar/).first()
const compra = pagina.locator('form', { has: pagina.getByRole('heading', { name: new RegExp(s.oc.electrodos) }) })
await compra.waitFor()
const espera = compra.getByText('hace 3 días')
await tomar('01-por-validar', { titulo, espera, oc: compra.getByRole('heading') }, { arriba: titulo })

// 2. Cuenta lo que llegó y anota la guía.
const llego = compra.locator('input[type="number"]').first()
const linea = compra.locator('li').first()
await tomar('02-llego', { linea: cenido(linea.locator('div').first()), llego }, { arriba: titulo })
const guia = compra.locator('input[name="documento"]')
await guia.fill(GUIA)
await guia.blur()
const validar = compra.getByRole('button', { name: 'Validar ingreso' })
await tomar('03-guia', { guia, validar }, { arriba: titulo })
await validar.click()
for (let i = 0; ; i++) {
  const [{ n }] = await s.consulta(
    `select count(*)::int as n from public.ingresos_pendientes_almacen where orden_compra_id = $1 and validado_en is not null`,
    [s.compras.electrodos],
  )
  if (n > 0) break
  if (i > 60) throw new Error('El ingreso no se validó en 30 s.')
  await pagina.waitForTimeout(500)
}
await ir('/almacen/kardex')

// 3. El ingreso ya está en el kardex y suma al saldo.
const movimiento = pagina.locator('tbody tr', { hasText: GUIA }).first()
await movimiento.waitFor()
await tomar('04-en-el-kardex', { movimiento }, { arriba: pagina.getByRole('heading', { name: 'Historial de movimientos' }) })

// 4. El conteo físico de los discos.
await pagina.getByRole('button', { name: /Conteo físico/ }).first().click()
const dialogo = pagina.locator('[role="dialog"]')
await dialogo.waitFor()
await dialogo.locator('#conteo-material').click()
await pagina.keyboard.type(STOCK.discos.codigo, { delay: 15 })
await pagina.getByRole('option', { name: new RegExp(STOCK.discos.codigo) }).first().click()
await dialogo.locator('#conteo-cantidad').fill(String(CONTADO))
await dialogo.locator('#conteo-motivo').fill(MOTIVO)
await dialogo.locator('#conteo-motivo').blur()
const campo = (id) => dialogo.locator(`div:has(label[for="${id}"]):has(#${id})`).last()
const ajuste = dialogo.getByText(/^Quedará un ajuste/)
await tomar('05-conteo', { contado: campo('conteo-cantidad'), ajuste })
const guardar = dialogo.getByRole('button', { name: 'Guardar conteo' })
await tomar('06-guardar', { motivo: campo('conteo-motivo'), guardar })
await guardar.click()
await dialogo.waitFor({ state: 'detached', timeout: 20000 })
await ir('/almacen/kardex')

// 5. Los conteos físicos, con su diferencia y quién contó.
const conteos = pagina.locator('details#conteos')
const resumen = conteos.locator('summary')
if (!(await conteos.evaluate((e) => e.open))) await resumen.click()
const conteo = conteos.locator('[data-conteo]').first()
await conteo.waitFor()
const diferencia = conteo.locator('[data-diferencia]')
await tomar('07-conteos', { conteo, diferencia }, { arriba: conteos })

await s.cerrar()
await cerrar()
console.log(`Capturas de ${formato} listas. Compras de prueba: ${s.oc.electrodos} y ${s.oc.discos}.`)
