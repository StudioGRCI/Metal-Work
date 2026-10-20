import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * El logo oficial para fondo claro, leído del disco para meterlo en un PDF. Si
 * no se pudo leer devuelve `null` y el documento sale igual, con la razón
 * social en texto (`CabeceraDocumento`).
 */
export async function leerLogoDocumento(): Promise<Buffer | null> {
  try {
    return await readFile(path.join(process.cwd(), 'public', 'marca', 'logo-metal-work.png'))
  } catch (error) {
    console.error('No se pudo leer el logo para el PDF; sale la razón social en texto.', error)
    return null
  }
}
