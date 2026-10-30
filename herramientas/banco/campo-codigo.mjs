/**
 * Escribir un código interno en el buscador de código (`EntradaCodigoInterno`,
 * src/components/codigo-interno/elegir-codigo.tsx) como lo hace la persona.
 *
 * Desde el 2026-10-20 el formulario no se envía con un código que no está en la
 * lista: lo escrito para buscar («volvo») se quedaba como código. Si el código es
 * de la lista, basta escribirlo; si es de una unidad nueva —lo que hacen casi
 * todos los recorridos, con un código inventado para la prueba—, se toca «usa …
 * como código nuevo» debajo del campo. Sin ese toque, la validación del
 * navegador para el envío y el recorrido se queda esperando.
 *
 *   import { escribirCodigo } from './campo-codigo.mjs'
 *   await escribirCodigo(ventana.locator('#rq-codigo'), 'PLA_SR_O4_1_26/28')
 */
export async function escribirCodigo(campo, codigo) {
  await campo.fill(codigo)
  // Al salir del campo se cierra la lista y debajo dice qué falta. Sin Escape:
  // con la lista cerrada, Escape cerraría la ventana con todo lo escrito.
  await campo.blur()
  const id = await campo.getAttribute('id')
  if (!id) return
  const nuevo = campo.page().locator(`[id="${id}-estado"] button`, { hasText: 'como código nuevo' })
  if ((await nuevo.count()) > 0) await nuevo.click()
}

/**
 * Un código interno `<prefijo>NN` que esta base todavía no tiene: ni reportes
 * diarios ni actividades. Las suites que suben un reporte con «Tarea nueva» y un
 * nombre fijo no pueden caer en el de una corrida anterior, porque su actividad
 * sigue abierta y la base pide elegirla («Ya hay una actividad abierta…»). Con
 * dos cifras al azar, eso pasaba en una de cada cinco corridas en un banco usado.
 *
 *   const codigo = await codigoSinUsar(consulta, 'PRB_SR_O4_1_26/', sello)
 */
export async function codigoSinUsar(consulta, prefijo, sello) {
  const filas = await consulta(
    `select upper(codigo_interno) as codigo from reportes_diarios where starts_with(upper(codigo_interno), upper($1))
     union select upper(codigo_interno) from codigo_actividades where starts_with(upper(codigo_interno), upper($1))`,
    [prefijo],
  )
  const usados = new Set(filas.map((f) => f.codigo))
  const desde = Number(String(sello).slice(-2))
  for (let i = 0; i < 100; i++) {
    const codigo = `${prefijo}${String((desde + i) % 100).padStart(2, '0')}`
    if (!usados.has(codigo.toUpperCase())) return codigo
  }
  throw new Error(`Los cien códigos ${prefijo}NN ya se usaron en esta base: rehazla con preparar.sh.`)
}
