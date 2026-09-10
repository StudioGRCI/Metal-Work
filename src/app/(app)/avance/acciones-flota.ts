'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { estadoDeFlota } from '@/lib/datos/flota'
import { exigirSesion, puede, puedeHojaDeArea } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Los trabajos sin orden —una unidad de un cliente que entró sin orden, o algo
 * que el taller está implementando— se escriben con dos manos, y cada una exige
 * exactamente el permiso que la base va a pedir:
 *
 *   · Registrar el trabajo, darlo por terminado, retomarlo o cerrarlo:
 *     `produccion.actividades` —los supervisores y los jefes—. Es «armar», como
 *     la lista de actividades.
 *   · Reportar lo que se le hizo ese día, con foto: `produccion.registrar`, y
 *     solo en el área propia. El área la comprueba `puedeHojaDeArea` acá para
 *     poder decir por qué; quien manda es el RLS.
 *
 * Toda escritura acotada por permiso termina en `.select('id').maybeSingle()`:
 * una fila que la seguridad esconde no es un error para Postgres, y sin esa
 * comprobación la pantalla diría «listo» sin haber hecho nada.
 */
const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

const REGLAS: Record<string, string> = {
  uq_flota_placa_en_taller:
    'Esa placa ya tiene un trabajo abierto en el taller. Búscalo en la lista y repórtalo ahí.',
  ck_flota_como_se_llama: 'Escribe qué es el trabajo, o la placa si es una unidad.',
  ck_flota_avance_fecha: 'El reporte no puede ser de pasado mañana.',
  ck_flota_foto_ruta: 'Una de las fotos no es de este trabajo.',
  uq_flota_avance_no_se_repite:
    'Ese mismo reporte ya se registró hoy. Si hubo algo más, cuéntalo con otras palabras.',
}

function traducir(error: { message: string; code?: string }) {
  for (const [regla, texto] of Object.entries(REGLAS)) {
    if (error.message.includes(regla)) return texto
  }
  return mensajeDeError(error)
}

const nulo = (v: string | undefined) => (v && v.trim().length > 0 ? v.trim() : null)

// ---------------------------------------------------------------- el trabajo
const esquemaTrabajo = z.object({
  placa: z.string().trim().max(20).optional(),
  descripcion: z.string().trim().max(200).optional(),
  cliente: z.string().trim().max(200).optional(),
  trajo: z.string().trim().max(200).optional(),
  trabajo: z.string().trim().min(5, 'Cuenta qué se va a hacer'),
})

export async function registrarTrabajoSinOrden(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion<{ id: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.actividades')) {
    return { ok: false, error: 'Los trabajos sin orden los registra el supervisor de cada área.' }
  }

  const analisis = esquemaTrabajo.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  if (!nulo(v.placa) && !nulo(v.descripcion)) {
    return { ok: false, error: 'Escribe qué es el trabajo, o la placa si es una unidad.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('flota_unidades')
    .insert({
      placa: nulo(v.placa),
      descripcion: nulo(v.descripcion),
      cliente: nulo(v.cliente),
      trajo: nulo(v.trajo),
      trabajo: v.trabajo,
      sede_id: perfil.sede_id,
      registrado_por: perfil.id,
    })
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: traducir(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/avance')
  revalidatePath('/avance/trabajos')
  revalidatePath('/avance/diario')
  return { ok: true, mensaje: 'Trabajo registrado.', datos: { id: data.id } }
}

// ------------------------------------------------------------- el reporte
const esquemaReporte = z.object({
  flota_id: z.string().uuid(),
  area_id: z.string().uuid('Elige el área'),
  fecha: z.string().regex(ES_FECHA, 'Falta la fecha'),
  descripcion: z.string().trim().min(5, 'Cuenta qué se hizo hoy'),
  avance_porcentaje: z.string().trim().optional(),
  impedimento: z.string().trim().optional(),
  // Las fotos ya están en Storage: acá viajan solo sus rutas, en JSON.
  fotos: z.string().optional(),
})

const esquemaFotos = z.array(
  z.object({
    ruta_storage: z.string().min(1),
    nombre_archivo: z.string().min(1),
    mime_type: z.string().optional(),
    tamano_bytes: z.number().int().positive().optional(),
  }),
)

export async function reportarFlota(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.registrar')) {
    return { ok: false, error: 'No tienes permiso para reportar avance del taller.' }
  }

  const analisis = esquemaReporte.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el reporte.' }
  }

  const v = analisis.data

  if (!puedeHojaDeArea(perfil, v.area_id)) {
    return { ok: false, error: 'Ese reporte es de otra área: cada uno reporta lo suyo.' }
  }

  const porcentaje = v.avance_porcentaje?.trim() ? Number(v.avance_porcentaje) : null
  if (porcentaje !== null && (Number.isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100)) {
    return { ok: false, error: 'El avance va de 0 a 100, a ojo.' }
  }

  const estado = await estadoDeFlota(v.flota_id)
  if (!estado) return { ok: false, error: 'Ese trabajo ya no está a la vista.' }
  if (estado === 'SALIO') {
    return { ok: false, error: 'Ese trabajo ya se cerró: si hay que retomarlo, regístralo de nuevo.' }
  }

  // Cada foto tiene que colgar de este trabajo: la base lo exige con un check,
  // y acá se dice antes para que el mensaje sea claro.
  let fotos: z.infer<typeof esquemaFotos> = []
  if (v.fotos) {
    try {
      fotos = esquemaFotos.parse(JSON.parse(v.fotos))
    } catch {
      return { ok: false, error: 'Las fotos no se pudieron leer: vuelve a agregarlas.' }
    }
    if (fotos.some((f) => !f.ruta_storage.startsWith(`flota/${v.flota_id}/`))) {
      return { ok: false, error: 'Una de las fotos no es de este trabajo.' }
    }
  }

  const supabase = await createClient()
  const { data: reporte, error } = await supabase
    .from('flota_avances')
    .insert({
      flota_id: v.flota_id,
      area_id: v.area_id,
      fecha: v.fecha,
      descripcion: v.descripcion,
      avance_porcentaje: porcentaje,
      impedimento: nulo(v.impedimento),
      registrado_por: perfil.id,
    })
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: traducir(error) }
  if (!reporte) return { ok: false, error: NO_TOCO_NADA }

  if (fotos.length > 0) {
    const { error: errorFotos } = await supabase.from('flota_avance_fotos').insert(
      fotos.map((f, i) => ({
        avance_id: reporte.id,
        flota_id: v.flota_id,
        bucket: 'fotos-avance',
        ruta_storage: f.ruta_storage,
        nombre_archivo: f.nombre_archivo,
        mime_type: f.mime_type ?? null,
        tamano_bytes: f.tamano_bytes ?? null,
        orden_visual: i + 1,
      })),
    )

    if (errorFotos) {
      // El reporte quedó escrito: se avisa lo que faltó, no se pierde el
      // trabajo de quien ya escribió.
      revalidarFlota(v.flota_id)
      return {
        ok: true,
        mensaje: `Reporte registrado, pero las fotos no se adjuntaron: ${traducir(errorFotos)}`,
      }
    }
  }

  revalidarFlota(v.flota_id)
  return { ok: true, mensaje: 'Reporte registrado.' }
}

// ------------------------------------------------- terminado, retomado, cerrado
const esquemaEstado = z.object({
  id: z.string().uuid(),
  estado: z.enum(['EN_TALLER', 'LISTA', 'SALIO']),
  retiro: z.string().trim().max(200).optional(),
})

/**
 * Darlo por terminado, retomarlo o cerrarlo. La fecha y la firma las sella la
 * base; de «cerrado» no se vuelve. En la base los estados siguen llamándose
 * EN_TALLER, LISTA y SALIO, de cuando esto era solo para unidades.
 */
export async function cambiarEstadoFlota(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.actividades')) {
    return { ok: false, error: 'Eso lo marca el supervisor del área.' }
  }

  const analisis = esquemaEstado.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'No se pudo identificar el trabajo.' }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('flota_unidades')
    .update({
      estado: v.estado,
      retiro: v.estado === 'SALIO' ? nulo(v.retiro) : null,
    })
    .eq('id', v.id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: traducir(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidarFlota(v.id)
  return {
    ok: true,
    mensaje:
      v.estado === 'LISTA'
        ? 'Trabajo terminado. Ya no cuenta como sin noticias.'
        : v.estado === 'SALIO'
          ? 'Trabajo cerrado.'
          : 'El trabajo vuelve a estar en curso.',
  }
}

function revalidarFlota(id: string) {
  revalidatePath('/avance')
  revalidatePath('/avance/trabajos')
  revalidatePath(`/avance/trabajos/${id}`)
  revalidatePath('/avance/diario')
}
