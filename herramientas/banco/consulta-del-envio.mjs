/**
 * El cuerpo de la pregunta que hace la ventana al volver a abrirse:
 * `consultarEnvio(clave, id, cuenta)` (`src/lib/envio.ts`), que React manda
 * como `["orden_compra","<id>","<cuenta>"]`, o con `null` si la pantalla aún no
 * sabe quién la usa. Las suites que la detienen la reconocen por aquí: con la
 * cuenta, la pregunta de dos datos ya no coincidía, no se detenía nada y la
 * prueba pasaba sin probar lo que dice (2026-10-23).
 */
export function esConsultaDelEnvio(cuerpo, clave = '[a-z_]+') {
  return new RegExp(`^\\["${clave}","[0-9a-f-]{36}",(?:"[0-9a-f-]{36}"|null)\\]$`).test((cuerpo ?? '').trim())
}
