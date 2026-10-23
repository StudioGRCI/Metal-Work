'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { BUCKET_GUIAS_REMISION, MAXIMO_MB_GUIA, NUMERO_GUIA, normalizarNumeroGuia, rutaGuiaRemision } from '@/lib/dominio/logistica'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * La guía de remisión la carga Contabilidad desde Adquisiciones, en la fila de
 * la OC: la Gestión de compras es de Logística y del conductor (migración
 * 20261020171000). La guía se ve también en la gestión y en la lista del
 * conductor: se repintan las tres.
 */
function repintar() {
  revalidatePath('/adquisiciones')
  revalidatePath('/compras/gestion')
  revalidatePath('/recojos')
}

const GUIA = z.object({
  id: z.guid(),
  orden_compra_id: z.guid(),
  numero: z.string().transform(normalizarNumeroGuia).pipe(z.string().regex(NUMERO_GUIA)),
  fecha: z.iso.date(),
  nombre_archivo: z.string().trim().min(1).max(200),
})

/**
 * El PDF ya subió al almacenamiento; aquí se comprueba que sea un PDF y se
 * registra con `cargar_guia_remision`, que exige `compras.guia_remision` igual
 * que esta acción. Con el mismo id, un reintento no duplica la guía.
 */
export async function registrarGuiaRemision(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.guia_remision')) return { ok: false, error: 'No tienes permiso para cargar la guía de remisión.' }
  const datos = GUIA.safeParse({
    id: formulario.get('id'),
    orden_compra_id: formulario.get('orden_compra_id'),
    numero: formulario.get('numero'),
    fecha: formulario.get('fecha'),
    nombre_archivo: formulario.get('nombre_archivo'),
  })
  if (!datos.success) {
    const campo = datos.error.issues[0]?.path[0]
    return {
      ok: false,
      error:
        campo === 'numero'
          ? 'Escribe el número de la guía como figura en ella: serie y número, por ejemplo T001-00000123.'
          : campo === 'fecha'
            ? 'Escribe la fecha de emisión de la guía.'
            : 'Elige el PDF de la guía.',
    }
  }

  const supabase = await createClient()
  const ruta = rutaGuiaRemision(datos.data.orden_compra_id, datos.data.id)
  const { data: archivo, error: errorArchivo } = await supabase.storage.from(BUCKET_GUIAS_REMISION).download(ruta)
  if (errorArchivo || !archivo) {
    return { ok: false, error: 'No se pudo comprobar el PDF cargado. Revisa la conexión y vuelve a intentar.' }
  }
  if (archivo.size < 1 || archivo.size > MAXIMO_MB_GUIA * 1024 * 1024 || (await archivo.slice(0, 5).text()) !== '%PDF-') {
    return { ok: false, error: `La guía tiene que ser un PDF de hasta ${MAXIMO_MB_GUIA} MB.` }
  }

  const { error } = await supabase.rpc('cargar_guia_remision', {
    p_id: datos.data.id,
    p_compra: datos.data.orden_compra_id,
    p_numero: datos.data.numero,
    p_fecha: datos.data.fecha,
    p_nombre_archivo: datos.data.nombre_archivo,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }

  repintar()
  return { ok: true, mensaje: `Guía ${datos.data.numero} cargada: el conductor ya la ve en su lista.` }
}

/** Anular la guía con su motivo; queda como evidencia y se puede cargar otra. */
export async function anularGuiaRemision(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.guia_remision')) return { ok: false, error: 'No tienes permiso para anular la guía de remisión.' }
  const datos = z
    .object({ id: z.guid(), motivo: z.string().trim().min(5).max(500) })
    .safeParse({ id: formulario.get('id'), motivo: formulario.get('motivo') })
  if (!datos.success) return { ok: false, error: 'Escribe por qué se anula la guía (al menos 5 letras).' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('anular_guia_remision', { p_guia: datos.data.id, p_motivo: datos.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }

  repintar()
  return { ok: true, mensaje: 'Guía anulada. Ya puedes cargar la buena.' }
}
