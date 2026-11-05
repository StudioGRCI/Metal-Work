/**
 * El cuerpo de la pregunta que hace la ventana al abrirse:
 * `consultarEnvio(clave, ids)` (`src/lib/envio.ts`), que React manda como
 * `["orden_compra",["<id>", …]]`: el id pendiente de la pantalla y los que la
 * pestaña guardó con otras cuentas en ese lugar. Sin nada pendiente va con la
 * lista vacía, `["orden_compra",[]]`: se pregunta igual, por la cuenta de la
 * sesión. Las suites que la detienen la reconocen por aquí: cuando cambió la
 * forma, la pregunta vieja ya no coincidía, no se detenía nada y la prueba
 * pasaba sin probar lo que dice (2026-10-23). Con `conIds`, solo la que lleva
 * algún id.
 */
export function esConsultaDelEnvio(cuerpo, clave = '[a-z_]+', { conIds = false } = {}) {
  const id = '"[0-9a-f-]{36}"'
  const lista = conIds ? `${id}(?:,${id})*` : `(?:${id}(?:,${id})*)?`
  return new RegExp(`^\\["${clave}",\\[${lista}\\]\\]$`).test((cuerpo ?? '').trim())
}
