import type { ResultadoAccion } from '@/lib/acciones'
import { problemaDeContrato, TIPOS_CONTRATO } from '@/lib/dominio/contratos'
import { subirArchivoPrivado } from '@/lib/subida-privada'

/**
 * Subir el contrato de un subcontrato desde el navegador (migración
 * 20261020202000) y anotarlo. El archivo va a `{carpeta}/{id}.ext`, donde la
 * carpeta es el subcontrato y el id
 * es el del contrato, decidido una vez por formulario: un reintento sube a la
 * misma ruta y la base no lo duplica. Si la anotación se rechaza, el archivo se
 * retira; si la respuesta no llega, se pregunta otra vez y se quita solo si
 * sigue suelto (ver `anotarSinDejarloSuelto`).
 */
export async function subirContrato({
  bucket,
  carpeta,
  id,
  archivo,
  adjuntar,
}: {
  bucket: string
  carpeta: string
  id: string
  archivo: File
  adjuntar: (datos: { id: string; ruta: string; nombre: string }) => Promise<ResultadoAccion>
}): Promise<ResultadoAccion> {
  const problema = problemaDeContrato(archivo)
  if (problema) return { ok: false, error: problema }
  const ruta = `${carpeta}/${id}.${TIPOS_CONTRATO[archivo.type]}`
  return subirArchivoPrivado({
    bucket,
    ruta,
    archivo,
    contentType: archivo.type,
    registrar: () => adjuntar({ id, ruta, nombre: archivo.name }),
  })
}
