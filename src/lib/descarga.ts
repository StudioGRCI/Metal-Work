/**
 * El enlace firmado de Storage que baja el archivo con este nombre; con `true`,
 * con el nombre con que quedó guardado.
 *
 * No se usa la opción `download` de `createSignedUrl`: supabase-js la codifica
 * dos veces (`URLSearchParams` y después `encodeURI` sobre todo el enlace), y un
 * nombre con tilde o eñe bajaba como «Cotizaci%C3%B3n QA-1.pdf» (banco local,
 * 2026-10-27; el banco responde como Supabase). Aquí se codifica una sola vez.
 */
export function bajarComo(enlace: string, nombre: string | true): string {
  const separador = enlace.includes('?') ? '&' : '?'
  return `${enlace}${separador}download=${nombre === true ? '' : encodeURIComponent(nombre)}`
}
