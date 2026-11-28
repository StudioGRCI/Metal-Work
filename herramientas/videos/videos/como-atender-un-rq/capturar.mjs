/**
 * Las capturas de «Cómo atender un RQ», con la cuenta de prueba de Almacén
 * (`almacen.local@metalwork.test`) en el banco local.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-atender-un-rq/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado y con las unidades de prueba:
 *
 *   BANCO_CLAVE='…' ./herramientas/banco/preparar.sh
 *   psql -h /tmp -p 5433 -U postgres -d mw_demo -f herramientas/banco/sembrar-diseno-por-codigo.sql
 *
 * Fuera de cámara (`sembrar.mjs`): el supervisor de Maestranza pide 10 KG de
 * electrodos y 6 discos para SR-101 (hay 4 KG y 20 discos), y el de
 * Producción, 4 discos de corte para su área (gasto operativo). Logística
 * compra lo que faltó cuando Almacén ya revisó.
 *
 * En cámara, Almacén hace su trabajo de verdad: revisa el stock, registra la
 * salida con su foto y mira lo que falta entregar de cada insumo. La foto es
 * una imagen inventada que se hace aquí mismo con ffmpeg.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { abrir, cenido, cerrar, formatoPedido } from '../../scripts/captura.mjs'
import { RQ_UNIDAD, sembrar } from './sembrar.mjs'

const formato = formatoPedido()
if (formato !== 'horizontal') {
  console.error('Este video se entrega solo en horizontal.')
  process.exit(2)
}
const RECIBE = 'Soldador de Maestranza'
const RECIBE_AREA = 'Supervisor de Producción'

// La foto de la salida: una imagen inventada, sin nada del taller.
const carpetaFoto = mkdtempSync(join(tmpdir(), 'foto-salida-'))
const foto = join(carpetaFoto, 'salida-electrodos.jpg')
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x9aa3ad:s=800x600', '-frames:v', '1', foto])

const s = await sembrar()
const { pagina, ir, tomar } = await abrir({ video: import.meta.url, formato, cuenta: 'almacen' })
const filaDe = (numero) => pagina.locator('tbody tr', { hasText: numero })
const dialogo = pagina.locator('[role="dialog"]')

// 1. Lo que espera por Almacén: el menú, la bandeja y cuántos esperan.
await ir('/requerimientos/atencion')
const menu = pagina.locator('nav[aria-label="Menú principal"]').getByRole('link', { name: /Atención de requerimiento/ })
const esperan = pagina.locator('[data-esperan-por-ti]')
await tomar('01-bandeja', { menu, esperan, fila: filaDe(s.unidad.numero).locator('td').first() }, { arriba: pagina.locator('main h1') })

// 2. Revisar el stock del RQ de la unidad: 4 KG de electrodos y los 6 discos.
await filaDe(s.unidad.numero).getByRole('button', { name: 'Revisar stock' }).click()
await dialogo.waitFor()
const tienes = dialogo.locator('input[type="number"]')
await tienes.nth(0).fill(String(RQ_UNIDAD.electrodos.hay))
await tienes.nth(1).fill(String(RQ_UNIDAD.discos.pide))
await tienes.nth(1).blur()
const electrodo = dialogo.getByText(/se compran 6/)
const resumen = dialogo.getByText(/a Logística le llega solo lo que falta/)
await tomar('02-revisar', { tienes: tienes.nth(0), electrodo, resumen })
const guardar = dialogo.getByRole('button', { name: 'Guardar la revisión' })
await tomar('03-guardar', { guardar, resumen })
await guardar.click()
await dialogo.waitFor({ state: 'detached', timeout: 20000 })

// Fuera de cámara, Logística compra los 6 KG que faltan.
const llega = await s.comprar()
console.log(`  Logística compra lo que falta; se espera el ${llega}.`)

// 3. La salida de los 4 KG, con quién recibe y la foto.
await ir(`/almacen/kardex?rq=${s.unidad.id}`)
await dialogo.waitFor({ timeout: 60000 })
const campo = (id) => dialogo.locator(`div:has(label[for="${id}"]):has(#${id})`).last()
const cantidad = campo('sal-cantidad')
const opcion = campo('sal-rq')
await dialogo.locator('#sal-cantidad').waitFor()
const hay = dialogo.getByText(/el RQ pide/)
await tomar('04-salida', { cantidad, hay, rq: opcion })
await dialogo.locator('#sal-recibe').fill(RECIBE)
await dialogo.locator('#sal-foto').setInputFiles(foto)
await dialogo.locator('#sal-recibe').blur()
const recibe = dialogo.locator('#sal-recibe')
const campoFoto = campo('sal-foto')
const destino = dialogo.locator('p, div', { hasText: /^Va a la unidad/ }).last()
await tomar('05-foto', { recibe, foto: campoFoto, destino })
const confirmar = dialogo.getByRole('button', { name: 'Confirmar salida' })
await tomar('06-confirmar', { confirmar })
await confirmar.click()
// La salida entra cuando la base la tiene: la ventana puede quedarse con el aviso de imprimir el formato.
for (let i = 0; ; i++) {
  const [{ n }] = await s.consulta(
    `select count(*)::int as n from public.movimientos_materiales m join public.requerimiento_lineas l on l.id = m.requerimiento_linea_id
      where l.requerimiento_id = $1 and m.tipo = 'SALIDA'`,
    [s.unidad.id],
  )
  if (n === 1) break
  const alerta = dialogo.locator('[role="alert"]')
  if (await alerta.count()) throw new Error(`La salida no entró: ${await alerta.first().innerText()}`)
  if (i > 60) throw new Error('La salida no llegó a la base en 30 s.')
  await pagina.waitForTimeout(500)
}

// 4. Lo que falta entregar, en cifras.
await ir('/requerimientos/atencion')
const cuenta = filaDe(s.unidad.numero).locator('[data-entrega-insumo]').first()
await cuenta.waitFor()
const textoCuenta = (await cuenta.innerText()).replace(/\s+/g, ' ')
if (!textoCuenta.startsWith(`Entregado ${RQ_UNIDAD.electrodos.hay} de ${RQ_UNIDAD.electrodos.pide} KG`)) throw new Error(`La cuenta no es la esperada: «${textoCuenta}»`)
await tomar('07-falta', { cuenta: cenido(cuenta), insumo: filaDe(s.unidad.numero).locator('td').nth(1) }, { arriba: filaDe(s.unidad.numero) })

// 5. El RQ del área: gasto operativo. Almacén lo tiene todo y la salida va a PLANTA.
const area = filaDe(s.delArea.numero)
await area.getByRole('button', { name: 'Revisar stock' }).click()
await dialogo.waitFor()
await dialogo.getByRole('button', { name: 'Tengo todo' }).click()
await dialogo.getByRole('button', { name: 'Guardar la revisión' }).click()
await dialogo.waitFor({ state: 'detached', timeout: 20000 })
await ir('/requerimientos/atencion')
const insignia = filaDe(s.delArea.numero).locator('[data-gasto-operativo]')
const registrar = filaDe(s.delArea.numero).getByRole('link', { name: 'Registrar la salida en el kardex' })
await tomar('08-gasto', { insignia, registrar, rq: filaDe(s.delArea.numero).locator('td').first() }, { arriba: filaDe(s.delArea.numero) })
await registrar.click()
await dialogo.waitFor({ timeout: 60000 })
const planta = dialogo.locator('[data-salida-gasto-operativo]')
await planta.waitFor()
await dialogo.locator('#sal-recibe').fill(RECIBE_AREA)
await dialogo.locator('#sal-recibe').blur()
await tomar('09-planta', { planta })

await s.cerrar()
await cerrar()
console.log(`Capturas de ${formato} listas. RQ de prueba: ${s.unidad.numero} y ${s.delArea.numero}.`)
