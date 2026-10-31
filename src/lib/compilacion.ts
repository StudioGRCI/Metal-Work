import 'server-only'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let leida: string | null | undefined

/**
 * De qué despliegue es el servidor que contesta. La pantalla se pinta con este
 * valor y `RefrescoAlVolver` lo vuelve a preguntar al volver y cada minuto: si
 * cambió, hubo un despliegue y `router.refresh()` ya no repintaría, recargaría
 * el documento entero (Next lo hace cuando la compilación de la respuesta no es
 * la de la pestaña). En Vercel es el id del despliegue; en `next start`, el
 * `BUILD_ID` de la compilación, el mismo que Next compara. Sin ninguno de los
 * dos, `null`, y la pantalla se repinta como antes.
 */
export function compilacionDelServidor() {
  if (leida === undefined) leida = process.env.VERCEL_DEPLOYMENT_ID || leerBuildId()
  return leida
}

/**
 * Si la pantalla que llama se pintó con otro despliegue (`deLaPestana`, la que
 * anotó `RefrescoAlVolver`). Ahí revalidar no repinta: Next ve otra
 * compilación en la respuesta y recarga el documento entero. Sin una de las
 * dos no se sabe, y se repinta como antes.
 */
export function esDeOtroDespliegue(deLaPestana: unknown) {
  const delServidor = compilacionDelServidor()
  return typeof deLaPestana === 'string' && deLaPestana !== '' && delServidor !== null && deLaPestana !== delServidor
}

function leerBuildId() {
  try {
    return readFileSync(join(/* turbopackIgnore: true */ process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() || null
  } catch {
    return null
  }
}
