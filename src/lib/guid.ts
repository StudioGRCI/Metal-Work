/**
 * Un identificador con la forma que acepta Postgres. Las pantallas de detalle
 * lo miran antes de consultar: un enlace mal copiado da «no existe» (404) y no
 * la pantalla de error, que es lo que pasaba cuando Postgres rechazaba el texto.
 */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function esGuid(valor: string): boolean {
  return GUID.test(valor)
}
