import type { SupabaseClient } from '@supabase/supabase-js'

type Cubeta = ReturnType<SupabaseClient['storage']['from']>

/**
 * Si Storage contestó que no guardó nada: un 4xx que no es el 409. Un 5xx (la
 * pasarela que no esperó, un 502 o un 504) o un corte sin respuesta pueden
 * llegar con el archivo ya guardado detrás.
 */
export const noGuardoNada = (error: { statusCode?: string } | null) =>
  Boolean(error?.statusCode && /^4\d\d$/.test(error.statusCode) && error.statusCode !== '409')

/**
 * Sube a una ruta que ninguna fila nombra todavía: la que se acaba de inventar
 * (`…/{uuid}.pdf`) o la de un registro que aún no existe. Si la subida falla sin
 * que Storage diga que no guardó nada, el archivo se quita en el acto: esa ruta
 * no se vuelve a usar y nadie lo encontraría después. Si el borrado también se
 * corta, queda como antes. Lo encontró la undécima pasada con el voucher del
 * pago de la OC con boleta: la subida llegaba a Storage, al navegador le llegaba
 * un 504 y el voucher quedaba suelto aunque el segundo intento entrara.
 */
export async function subirARutaNueva(
  cubeta: Cubeta,
  ruta: string,
  cuerpo: Parameters<Cubeta['upload']>[1],
  contentType: string,
) {
  const { error } = await cubeta.upload(ruta, cuerpo, { contentType, upsert: false })
  if (error && !noGuardoNada(error)) await cubeta.remove([ruta]).catch(() => undefined)
  return { error }
}

/** Storage ya tiene un archivo en esa ruta (409). */
export const ocupada = (error: { statusCode?: string } | null) => error?.statusCode === '409'
