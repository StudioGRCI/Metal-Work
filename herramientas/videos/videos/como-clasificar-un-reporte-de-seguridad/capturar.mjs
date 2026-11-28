/**
 * Las capturas de «Cómo clasificar un reporte de seguridad», con la cuenta de
 * prueba de SSOMA (`ssoma.local@metalwork.test`) en el banco local.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-clasificar-un-reporte-de-seguridad/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado (`herramientas/banco/preparar.sh`).
 * Fuera de cámara: el supervisor de Maestranza reporta, con su sesión, que a la
 * plegadora le falta la guarda lateral. En cámara, SSOMA abre el reporte, lo
 * clasifica con su causa y le encarga la corrección al supervisor del área.
 */
import { conectar } from '../../scripts/banco.mjs'
import { abrir, cenido, cerrar, formatoPedido } from '../../scripts/captura.mjs'

const formato = formatoPedido()
if (formato !== 'horizontal') {
  console.error('Este video se entrega solo en horizontal.')
  process.exit(2)
}
const LUGAR = 'Plegadora, guarda lateral'
const QUE_PASA = 'A la plegadora le falta la guarda lateral desde el mantenimiento del lunes.'
const CAUSA = 'La guarda se retiró en el mantenimiento y nadie la volvió a poner antes de arrancar.'
const ACCION = 'Poner la guarda lateral de la plegadora y revisar las de las otras máquinas.'

const b = await conectar()
const [{ n: ya }] = await b.consulta('select count(*)::int as n from public.ssoma_reportes where descripcion = $1', [QUE_PASA])
if (ya > 0) throw new Error('Ese reporte ya está en el banco (un reporte no se borra): rehaz el banco con preparar.sh.')
const [rep] = await b.como(
  'sup.mtz',
  `select reporte::text as id, numero_reporte as numero from public.ssoma_reportar(gen_random_uuid(), 'CONDICION_INSEGURA',
     (select id from public.areas where codigo = 'MTZ'), $1, $2, null, null, null, '[]'::jsonb)`,
  [LUGAR, QUE_PASA],
)

const { pagina, ir, tomar } = await abrir({ video: import.meta.url, formato, cuenta: 'ssoma' })

// 1. Los reportes: el nuevo, sin clasificar.
await ir('/ssoma')
const menu = pagina.locator('nav[aria-label="Menú principal"]').locator('a[href="/ssoma"]').first()
const fila = pagina.locator('main').getByText(rep.numero).first().locator('xpath=ancestor::tr[1]')
await tomar('01-lista', { fila, menu })

// 2. La ficha: qué se reportó, todavía sin clasificar.
await ir(`/ssoma/${rep.id}`)
const que = pagina.getByText(QUE_PASA).first()
const clasificar = pagina.locator('[data-clasificar-reporte]')
await tomar('02-ficha', { que: cenido(que), clasificar }, { arriba: pagina.locator('main h1') })

// 3. Clasificar: la clase y la causa.
await clasificar.click()
const v = pagina.locator('[role="dialog"]', { has: pagina.locator(`#ssoma-causa-${rep.id}`) })
await v.waitFor()
const clase = v.locator('label', { has: pagina.locator('input[name="clasificacion"][value="CONDICION_INSEGURA"]') })
await tomar('03-clase', { clase })
const causa = v.locator(`#ssoma-causa-${rep.id}`)
await causa.fill(CAUSA)
const guardar = v.getByRole('button', { name: 'Guardar la clasificación' })
await tomar('04-causa', { causa, guardar })
await guardar.click()
await v.waitFor({ state: 'hidden', timeout: 30000 })
const tarjeta = pagina.locator('[data-clasificacion]')
await tarjeta.getByText(CAUSA).waitFor({ timeout: 30000 })
await tomar('05-clasificado', { tarjeta })

// 4. Encargar la corrección al supervisor del área.
const agregar = pagina.getByRole('button', { name: 'Agregar acción' })
await agregar.scrollIntoViewIfNeeded()
await tomar('06-agregar', { agregar })
await agregar.click()
const va = pagina.locator('[role="dialog"]', { has: pagina.getByRole('button', { name: 'Encargar la acción' }) })
await va.waitFor()
await va.locator('textarea[name="descripcion"]').fill(ACCION)
await va.locator('[id^="ssoma-responsable-"]').click()
await pagina.getByPlaceholder('Nombre, puesto o área…').fill('maestranza')
await pagina.getByRole('option', { name: /maestranza/i }).first().click()
const encargar = va.getByRole('button', { name: 'Encargar la acción' })
await tomar('07-accion', { descripcion: va.locator('textarea[name="descripcion"]'), responsable: va.locator('[id^="ssoma-responsable-"]'), encargar })
await encargar.click()
const verde = pagina.locator('p[role="status"]').filter({ hasText: 'Acción registrada' }).first()
await verde.waitFor({ timeout: 30000 })
await tomar('08-encargada', { verde: cenido(verde) })

await cerrar()
await b.cerrar()
console.log(`Capturas de ${formato} listas. Reporte de prueba: ${rep.numero}.`)
