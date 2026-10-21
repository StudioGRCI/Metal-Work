/**
 * La última página que sí existe, cuando se pidió una que ya no (una dirección
 * guardada, o estar en la última página cuando bajó el total); `null` si la
 * pedida vale. PostgREST la rechaza con PGRST103 sin decir el total, y eso
 * tumbaba Órdenes en producción (2026-10-21); el banco local la devuelve vacía
 * con su total. Las dos se resuelven igual: se muestra la última.
 */
export async function paginaQueExiste(
  pedida: number,
  porPagina: number,
  respuesta: { error: { code?: string } | null; count: number | null; filas: number },
  contar: () => Promise<number>,
): Promise<number | null> {
  if (pedida <= 1) return null
  let total: number
  if (respuesta.error?.code === 'PGRST103') total = await contar()
  else if (!respuesta.error && respuesta.filas === 0 && respuesta.count !== null) total = respuesta.count
  else return null
  const ultima = Math.max(1, Math.ceil(total / porPagina))
  return ultima < pedida ? ultima : null
}
