/**
 * Las capturas de «Cómo registrar un trámite», con la cuenta de prueba del
 * Tramitador (`tramitador.local@metalwork.test`) en el banco local.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-registrar-un-tramite/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado (`herramientas/banco/preparar.sh`). Registra
 * un trámite de verdad en el banco: la tarjeta de propiedad de una unidad de
 * demostración, con un expediente inventado.
 */
import { abrir, cenido, cerrar, formatoPedido } from '../../scripts/captura.mjs'

const formato = formatoPedido()
if (formato !== 'horizontal') {
  console.error('Este video se entrega solo en horizontal.')
  process.exit(2)
}
const PLACA = 'D8M-506'
const ASUNTO = `Tarjeta de propiedad de la unidad ${PLACA}`
const EXPEDIENTE = 'T-4521'
const dia = (n) => {
  const d = new Date(Date.now() + n * 86400000 - 5 * 3600000)
  return d.toISOString().slice(0, 10)
}

const { pagina, ir, tomar } = await abrir({ video: import.meta.url, formato, cuenta: 'tramitador' })

// 1. Por dónde se entra y la lista con sus vistas.
await ir('/tramites')
const menu = pagina.locator('nav[aria-label="Menú principal"]').getByRole('link', { name: /^Trámites/ })
const registrar = pagina.getByRole('button', { name: 'Registrar trámite' })
await tomar('01-entrada', { menu, registrar })
const vistas = pagina.locator('main').getByRole('link', { name: /^En curso/ }).locator('xpath=..')
await tomar('02-vistas', { vistas: cenido(vistas) })

// 2. El tipo propone su entidad.
await registrar.click()
const v = pagina.locator('[role="dialog"]')
await v.waitFor()
await v.locator('#tramite-tipo').selectOption({ label: 'Tarjeta de propiedad' })
await tomar('03-tipo', { tipo: v.locator('#tramite-tipo'), entidad: v.locator('#tramite-entidad') })

// 3. La unidad, y su cliente sale solo.
await v.locator('#tramite-unidad').click()
await pagina.getByPlaceholder('Placa, código interno o cliente…').fill(PLACA)
await pagina.getByRole('option', { name: new RegExp(PLACA) }).first().click()
const cliente = v.locator('[data-cliente-de-la-unidad]')
await cliente.waitFor()
await tomar('04-unidad', { unidad: v.locator('#tramite-unidad'), cliente: cenido(cliente) })

// 4. Qué se tramita, el expediente y las fechas.
await v.locator('#tramite-asunto').fill(ASUNTO)
await v.locator('#tramite-expediente').fill(EXPEDIENTE)
await v.locator('#tramite-inicio').fill(dia(0))
await v.locator('#tramite-limite').fill(dia(20))
await v.locator('#tramite-limite').blur()
await tomar('05-asunto', { asunto: v.locator('#tramite-asunto'), expediente: v.locator('#tramite-expediente') })
await tomar('06-fechas', { inicio: v.locator('#tramite-inicio'), limite: v.locator('#tramite-limite') })

// 5. Registrar: sale con su número.
const enviar = v.getByRole('button', { name: 'Registrar el trámite' })
await tomar('07-registrar', { enviar })
await enviar.click()
const aviso = pagina.getByText(/Trámite TR-\d{4}-\d{4} registrado/).first()
await aviso.waitFor({ timeout: 30000 })
const numero = (await aviso.innerText()).match(/TR-\d{4}-\d{4}/)[0]
await v.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
await tomar('08-registrado', { aviso: cenido(aviso) })

// 6. Su ficha: el expediente para subir el cargo y anotar cada gestión.
await ir('/tramites')
await pagina.locator('main').getByRole('link', { name: numero }).first().click()
await pagina.waitForURL(/\/tramites\/[0-9a-f-]{36}$/)
await pagina.waitForLoadState('networkidle')
const subir = pagina.getByRole('button', { name: 'Subir archivo' })
const gestion = pagina.getByRole('button', { name: 'Anotar gestión' })
await tomar('09-expediente', { subir, gestion }, { arriba: pagina.getByRole('heading', { name: 'Expediente' }) })
const cerrarCon = pagina.getByRole('button', { name: 'Cerrar con el documento final' })
await tomar('10-cerrar', { cerrarCon }, { arriba: pagina.locator('main h1') })

await cerrar()
console.log(`Capturas de ${formato} listas. Trámite de prueba: ${numero}.`)
