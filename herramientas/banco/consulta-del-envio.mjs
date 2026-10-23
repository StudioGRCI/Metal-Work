/**
 * El cuerpo de la pregunta que hace la ventana al volver a abrirse:
 * `consultarEnvio(clave, ids)` (`src/lib/envio.ts`), que React manda como
 * `["orden_compra",["<id>", …]]`: el id pendiente de la pantalla y los que la
 * pestaña guardó con otras cuentas en ese lugar. Las suites que la detienen la
 * reconocen por aquí: cuando cambió la forma, la pregunta vieja ya no coincidía,
 * no se detenía nada y la prueba pasaba sin probar lo que dice (2026-10-23).
 */
export function esConsultaDelEnvio(cuerpo, clave = '[a-z_]+') {
  const id = '"[0-9a-f-]{36}"'
  return new RegExp(`^\\["${clave}",\\[${id}(?:,${id})*\\]\\]$`).test((cuerpo ?? '').trim())
}
