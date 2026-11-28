/**
 * Las capturas de «Cómo registrar una inspección de calidad», con la cuenta de
 * prueba de Calidad (`calidad.local@metalwork.test`) en el banco local.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-registrar-una-inspeccion-de-calidad/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado (`herramientas/banco/preparar.sh`).
 * Fuera de cámara: Diseño le pone al código de la OT 0001 su par de etapas
 * (Maestranza y Producción) y, después de la inspección, el supervisor de
 * Maestranza la marca corregida. En cámara, Calidad registra una observación
 * con su foto (una imagen inventada) y la ve volver para levantarla.
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
const OBSERVACION = 'Soldadura con poros en la unión del larguero trasero, lado izquierdo.'
const CORREGIDO = 'Se esmeriló la unión y se volvió a soldar.'

const b = await conectar()
const [orden] = await b.consulta(
  `select u.codigo_interno as codigo from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id where o.numero = '0001-2026'`,
)
if (!orden?.codigo) throw new Error('La OT 0001-2026 del banco no tiene código interno: rehaz el banco con preparar.sh.')
const CODIGO = orden.codigo
const [{ n: ya }] = await b.consulta('select count(*)::int as n from public.calidad_inspecciones where codigo_interno = $1', [CODIGO])
if (ya > 0) throw new Error(`${CODIGO} ya tiene inspecciones en el banco (una inspección no se borra): rehaz el banco con preparar.sh.`)
const [{ n: etapas }] = await b.consulta('select count(*)::int as n from public.codigo_etapas where codigo_interno = $1 and quitada_en is null', [CODIGO])
if (etapas === 0) await b.como('diseno', `select public.par_de_etapas_codigo($1, 'Chasis y piso')`, [CODIGO])

const { pagina, ir, tomar } = await abrir({ video: import.meta.url, formato, cuenta: 'calidad' })
const foto = await fotoInventada(pagina, join(tmpdir(), 'calidad-foto-video.jpg'), 'Foto de ejemplo\nUnión del larguero')

// 1. Por dónde se entra.
await ir('/calidad')
const menu = pagina.locator('nav[aria-label="Menú principal"]').getByRole('link', { name: /^Inspecciones de calidad/ })
const registrar = pagina.getByRole('button', { name: 'Registrar inspección' })
await tomar('01-entrada', { menu, registrar })

// 2. El código y su etapa.
await registrar.click()
const v = pagina.locator('[role="dialog"]', { has: pagina.locator('form') }).last()
await v.waitFor()
await v.locator('#calidad-codigo').click()
await pagina.getByPlaceholder('Código, OT, cliente o unidad…').fill(CODIGO.slice(0, 6))
await pagina.getByRole('option', { name: new RegExp(CODIGO.replace(/[/.]/g, '\\$&')) }).first().click()
await tomar('02-codigo', { codigo: v.locator('#calidad-codigo') })
const etapa = await v.locator('#calidad-etapa option', { hasText: 'Maestranza' }).first().getAttribute('value')
await v.locator('#calidad-etapa').selectOption(etapa ?? '')
await tomar('03-etapa', { etapa: v.locator('#calidad-etapa') })

// 3. No conforme, qué está mal y la foto.
await v.locator('input[name="resultado"][value="NO_CONFORME"]').check()
const resultado = v.locator('label', { has: pagina.locator('input[name="resultado"][value="NO_CONFORME"]') })
const ambos = v.locator('fieldset', { has: pagina.locator('input[name="resultado"]') }).last()
await tomar('04-resultado', { resultado, ambos })
await v.locator('#calidad-observacion').fill(OBSERVACION)
await v.locator('input[type="file"]:not([capture])').setInputFiles(foto)
await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
const enviar = v.getByRole('button', { name: 'Registrar', exact: true })
await enviar.waitFor()
await tomar('05-observacion', { observacion: v.locator('#calidad-observacion'), enviar })

// 4. Registrar: dice a quién le llegó.
await enviar.click()
const verde = pagina.locator('p[role="status"]', { hasText: /registrada/ }).first()
await verde.waitFor({ timeout: 30000 })
await tomar('06-registrada', { verde: cenido(verde) })

// 5. La lista: queda «Por corregir».
const [ins] = await b.consulta(`select id::text from public.calidad_inspecciones where observacion = $1 order by creado_en desc limit 1`, [OBSERVACION])
await ir('/calidad')
const fila = pagina.locator(`[data-inspeccion-calidad="${ins.id}"]`)
await tomar('07-lista', { fila })

// Fuera de cámara: Maestranza la corrige.
await b.como('sup.mtz', `select public.calidad_registrar_paso(gen_random_uuid(), $1, 'CORREGIDA', $2, '[]'::jsonb)`, [ins.id, CORREGIDO])

// 6. Vuelve corregida: Calidad la levanta o la vuelve a observar.
await ir(`/calidad/${ins.id}`)
const levantar = pagina.getByRole('button', { name: 'Levantar' })
const deNuevo = pagina.getByRole('button', { name: 'Volver a observar' })
await tomar('08-corregida', { levantar, deNuevo }, { arriba: pagina.locator('main h1') })

await cerrar()
await b.cerrar()
console.log(`Capturas de ${formato} listas. Inspección de prueba en ${CODIGO}.`)
