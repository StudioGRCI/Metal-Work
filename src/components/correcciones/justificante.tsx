'use client'

import { useState } from 'react'

import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import type { ResultadoAccion } from '@/lib/acciones'
import {
  ACEPTA_JUSTIFICANTE,
  BUCKET_JUSTIFICANTES,
  problemaDelJustificante,
  rutaDeJustificante,
} from '@/lib/dominio/correcciones'
import { subirArchivoPrivado } from '@/lib/subida-privada'

/**
 * Lo que toda corrección pide: por qué se corrige y el justificante que lo
 * respalda (el correo, la nota de crédito, la factura correcta, el visto bueno).
 */
export function CamposDeCorreccion({ id, disabled }: { id: string; disabled?: boolean }) {
  return (
    <>
      <Campo etiqueta="Por qué se corrige" htmlFor={`correccion-motivo-${id}`} requerido>
        <AreaTexto
          id={`correccion-motivo-${id}`}
          name="motivo"
          required
          minLength={10}
          maxLength={500}
          disabled={disabled}
          placeholder="Por ejemplo: el proveedor confirmó otro precio por correo; el plano final pide 3 mm."
        />
      </Campo>
      <Campo
        etiqueta="Justificante"
        htmlFor={`correccion-justificante-${id}`}
        requerido
        ayuda="El PDF o la foto que respalda la corrección, hasta 10 MB. Sin justificante no se corrige."
      >
        <Entrada id={`correccion-justificante-${id}`} name="justificante" type="file" accept={ACEPTA_JUSTIFICANTE} required disabled={disabled} />
      </Campo>
    </>
  )
}

/**
 * Sube el justificante y después corrige: la acción de servidor recibe solo la
 * ruta, y la base comprueba que el archivo esté subido por quien corrige. El id
 * de la corrección se decide aquí y no cambia entre reintentos, así que un
 * reintento no anota dos veces. Si la corrección no entra, el archivo se retira.
 */
export function useCorreccion(
  documentoId: string,
  accion: (previo: unknown, datos: FormData) => Promise<ResultadoAccion>,
) {
  const [correccionId, setCorreccionId] = useState(() => crypto.randomUUID())
  async function corregir(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = datos.get('justificante')
    const problema = problemaDelJustificante(archivo instanceof File ? archivo : null)
    if (problema || !(archivo instanceof File)) return { ok: false, error: problema ?? 'Adjunta el justificante.' }
    const ruta = rutaDeJustificante(documentoId, correccionId, archivo.type)
    if (!ruta) return { ok: false, error: 'El justificante va en PDF o en foto (JPG, PNG o WEBP).' }
    datos.delete('justificante')
    datos.set('correccion_id', correccionId)
    datos.set('justificante_ruta', ruta)
    datos.set('justificante_nombre', archivo.name.trim().slice(0, 200) || 'justificante')
    return subirArchivoPrivado({
      bucket: BUCKET_JUSTIFICANTES,
      ruta,
      archivo,
      contentType: archivo.type,
      registrar: () => accion(null, datos),
    })
  }
  return { corregir, otra: () => setCorreccionId(crypto.randomUUID()) }
}
