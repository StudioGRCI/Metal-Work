/**
 * Las capturas de «Cómo registrar un reclamo de garantía», con la cuenta de
 * prueba de Ventas (`ventas.local@metalwork.test`) en el banco local.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-registrar-un-reclamo-de-garantia/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado (`herramientas/banco/preparar.sh`). Registra
 * un reclamo de verdad en el banco, de la unidad ya entregada de la OT 0004, con
 * una foto inventada. El contacto se deja vacío: un video no muestra teléfonos.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { conectar, fotoInventada } from '../../scripts/banco.mjs'
import { abrir, cenido, cerrar, formatoPedido } from '../../scripts/captura.mjs'

const formato = formatoPedido()
if (formato !== 'horizontal') {
  console.error('Este video se entrega solo en horizontal.')
  process.exit(2)
}
const RECLAMA = 'La compuerta trasera no cierra bien y entra agua a la tolva cuando llueve.'
const TRAE = 'El chofer de la unidad'

const b = await conectar()
const [unidad] = await b.consulta(
  `select u.placa from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id where o.numero = '0004-2026'`,
)
if (!unidad?.placa) throw new Error('La OT 0004-2026 del banco no tiene unidad con placa: rehaz el banco con preparar.sh.')
const PLACA = unidad.placa

const { pagina, ir, tomar } = await abrir({ video: import.meta.url, formato, cuenta: 'ventas' })
const foto = await fotoInventada(pagina, join(tmpdir(), 'garantia-foto-video.jpg'), 'Foto de ejemplo\nCompuerta trasera', '#6b5b4e')

// 1. Por dónde se entra.
await ir('/garantias')
const menu = pagina.locator('nav[aria-label="Menú principal"]').getByRole('link', { name: /^Garantías/ })
const registrar = pagina.getByRole('button', { name: 'Registrar reclamo' })
await tomar('01-entrada', { menu, registrar })

// 2. La unidad, y su cliente sale solo.
await registrar.click()
const v = pagina.locator('[role="dialog"]', { has: pagina.locator('form') }).last()
await v.waitFor()
await v.locator('#reclamo-unidad').click()
await pagina.getByPlaceholder('Placa, código interno o cliente…').fill(PLACA)
await pagina.getByRole('option', { name: new RegExp(PLACA) }).first().click()
const cliente = v.locator('[data-cliente-de-la-unidad]')
await cliente.waitFor()
await tomar('02-unidad', { unidad: v.locator('#reclamo-unidad'), cliente: cenido(cliente) })

// 3. Qué reclama, quién lo trae y la foto.
await v.locator('#reclamo-descripcion').fill(RECLAMA)
await v.locator('#reclamo-trae').fill(TRAE)
await tomar('03-reclamo', { reclama: v.locator('#reclamo-descripcion'), trae: v.locator('#reclamo-trae') })
await v.locator('input[type="file"]:not([capture])').setInputFiles(foto)
await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
const enviar = v.getByRole('button', { name: 'Registrar el reclamo' })
await enviar.waitFor()
const fotos = v.locator('input[type="file"]:not([capture])').locator('xpath=ancestor::*[.//img][1]')
await tomar('04-foto', { fotos, enviar })

// 4. Registrar: sale con su número y le llega a Administración.
await enviar.click()
const verde = pagina.locator('p[role="status"]', { hasText: /registrado/ }).first()
await verde.waitFor({ timeout: 30000 })
await v.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
await tomar('05-registrado', { verde: cenido(verde) })

// 5. En la lista: espera su OT de garantía.
const [rg] = await b.consulta('select numero, id::text from public.garantia_reclamos where descripcion = $1 order by creado_en desc limit 1', [RECLAMA])
await ir('/garantias')
const fila = pagina.locator(`[data-reclamo="${rg.numero}"]`)
await tomar('06-lista', { fila })

// 6. Su ficha: cómo va.
await ir(`/garantias/${rg.id}`)
const recorrido = pagina.locator('main').getByText('Espera su OT').first()
await tomar('07-ficha', { estado: cenido(recorrido) }, { arriba: pagina.locator('main h1') })

await cerrar()
await b.cerrar()
console.log(`Capturas de ${formato} listas. Reclamo de prueba: ${rg.numero}.`)
