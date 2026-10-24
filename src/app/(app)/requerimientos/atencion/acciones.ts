'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { fechaHora } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Cada paso del RQ después de que Almacén revisó el stock, con el mismo
 * permiso que exige su función en la base: Almacén lo deja listo cuando llega
 * lo que faltaba y lo entrega (`almacen.recibir`, `almacen.despachar`); quien
 * compra marca que está comprando (`compras.crear`; la base mira además de
 * quién es el RQ: Logística o la administradora).
 */
const PASOS = {
  listo: { funcion: 'rq_marcar_listo_en_almacen', permiso: 'almacen.recibir', hecho: 'Listo en almacén. Le avisamos al área para que lo recoja.' },
  en_atencion: { funcion: 'rq_marcar_en_atencion', permiso: 'compras.crear', hecho: 'En compra. Almacén lo recepciona cuando llegue.' },
  entregado: { funcion: 'rq_marcar_entregado', permiso: 'almacen.despachar', hecho: 'Entregado. El requerimiento queda cerrado.' },
} as const

/**
 * La entrega, leída después de la función. La base devuelve el id también
 * cuando el RQ ya estaba entregado —el segundo toque de un doble toque no es un
 * error—, así que si lo entregó otra persona, o esta misma en otra pestaña con
 * otra nota, la pantalla lo dice en vez de «Entregado» a secas: si no, quien
 * mira cree que quedó su nota, y en el RQ quedó la otra. `null` es que la
 * entrega es la que se acaba de enviar.
 */
async function yaEstabaEntregado(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  quien: string,
  nota: string,
  motivo: string | null,
): Promise<{ mensaje: string } | { faltante: boolean }> {
  const { data: rq, error } = await supabase
    .from('requerimientos')
    .select('entregado_en, entregado_por, nota_entrega, faltante_al_entregar, motivo_del_faltante')
    .eq('id', id)
    .maybeSingle()
  if (error || !rq) return { mensaje: 'Quedó entregado, pero no se pudo leer con qué nota: recarga la pantalla.' }
  const otra =
    rq.entregado_por !== quien ||
    (rq.nota_entrega ?? '').trim() !== nota ||
    (rq.faltante_al_entregar != null && (rq.motivo_del_faltante ?? '').trim() !== (motivo ?? ''))
  if (!otra) return { faltante: rq.faltante_al_entregar != null }
  // Primero lo que importa: no se cambió nada. La nota, que puede ser larga, al final y cortada.
  const como = rq.faltante_al_entregar ? 'entregado con faltante' : 'entregado'
  const quedo = (rq.nota_entrega ?? '').trim()
  const corta = quedo.length > 80 ? `${quedo.slice(0, 79)}…` : quedo
  const cuando = fechaHora(rq.entregado_en)
  // Sin punto al final: la hora ya termina en «p. m.».
  return { mensaje: `Ya estaba ${como}; no se cambió nada. ${corta ? `Lo recogió ${corta} el ${cuando}` : `Se entregó el ${cuando}`}` }
}

const QUIEN: Record<keyof typeof PASOS, string> = {
  listo: 'Lo deja listo Almacén.',
  en_atencion: 'La compra la marca quien compra: Logística o, si es de Administración, la administradora.',
  entregado: 'La entrega la registra Almacén.',
}

export async function marcarPasoRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ aviso: boolean }>> {
  const analisis = z
    .object({
      id: z.guid(),
      paso: z.enum(['listo', 'en_atencion', 'entregado']),
      nota: z.string().trim().max(500, 'La nota pasa de 500 caracteres.'),
    })
    .safeParse({ id: formulario.get('id'), paso: formulario.get('paso'), nota: formulario.get('nota') ?? '' })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const paso = PASOS[analisis.data.paso]
  const perfil = await exigirSesion()
  if (!puede(perfil, paso.permiso)) return { ok: false, error: QUIEN[analisis.data.paso] }
  if (analisis.data.paso === 'entregado' && analisis.data.nota.length < 3) return { ok: false, error: 'Anota quién del área lo recogió.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc(paso.funcion, { p_id: analisis.data.id, p_nota: analisis.data.nota || null })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El requerimiento no cambió. Recarga la pantalla.' }

  const entrega =
    analisis.data.paso === 'entregado'
      ? await yaEstabaEntregado(supabase, analisis.data.id, perfil.id, analisis.data.nota, null)
      : null

  revalidatePath('/requerimientos')
  revalidatePath('/requerimientos/atencion')
  // «Ya estaba entregado» no es un éxito: va en tono de aviso.
  if (entrega && 'mensaje' in entrega) return { ok: true, mensaje: entrega.mensaje, datos: { aviso: true } }
  return { ok: true, mensaje: paso.hecho }
}

/**
 * Almacén entrega un RQ listo aunque parte no haya salido del kardex, porque ya
 * no va a salir: el área no necesita el resto, devolvieron lo que sobró, se
 * compró en otra unidad. Escribe por qué; queda en el RQ y le llega a quien lo
 * pidió (`rq_entregar_con_faltante`, migración 20261020196000).
 */
export async function entregarConFaltante(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ aviso: boolean }>> {
  const analisis = z
    .object({
      id: z.guid(),
      nota: z.string().trim().min(3, 'Anota quién del área lo recogió.').max(500, 'La nota pasa de 500 caracteres.'),
      motivo: z
        .string()
        .trim()
        .min(10, 'Escribe por qué lo que falta ya no sale del kardex (al menos 10 caracteres).')
        .max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: formulario.get('id'), nota: formulario.get('nota') ?? '', motivo: formulario.get('motivo') ?? '' })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.despachar')) return { ok: false, error: QUIEN.entregado }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rq_entregar_con_faltante', {
    p_id: analisis.data.id,
    p_nota: analisis.data.nota,
    p_motivo: analisis.data.motivo,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El requerimiento no cambió. Recarga la pantalla.' }

  const entrega = await yaEstabaEntregado(supabase, analisis.data.id, perfil.id, analisis.data.nota, analisis.data.motivo)

  revalidatePath('/requerimientos')
  revalidatePath('/requerimientos/atencion')
  if ('mensaje' in entrega) return { ok: true, mensaje: entrega.mensaje, datos: { aviso: true } }
  return {
    ok: true,
    // Si mientras tanto salió todo del kardex, la base lo entregó sin
    // faltante: decir «con faltante» sería mentir.
    mensaje: entrega.faltante
      ? 'Entregado con faltante. Le avisamos a quien lo pidió.'
      : 'Entregado: mientras tanto salió todo del kardex, así que no quedó faltante.',
  }
}

const CANTIDAD_EN_STOCK = /^\d{1,9}(\.\d{1,3})?$/

/**
 * Almacén revisa el RQ insumo por insumo: cuánto tiene de cada uno, de 0 a lo
 * pedido. Si tiene todo, el RQ queda listo; si no, a quien compra le llega
 * solo lo que falta (`rq_revisar_stock`, migración 20261015162000).
 */
export async function revisarStockRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  let lineas: unknown
  try {
    lineas = JSON.parse(typeof formulario.get('lineas') === 'string' ? (formulario.get('lineas') as string) : '')
  } catch {
    return { ok: false, error: 'Vuelve a cargar la pantalla.' }
  }
  const analisis = z
    .object({
      id: z.guid(),
      nota: z.string().trim().max(500, 'La nota pasa de 500 caracteres.'),
      lineas: z
        .array(
          z.object({
            item: z.number().int().min(1).max(999),
            en_stock: z
              .string()
              .trim()
              .regex(CANTIDAD_EN_STOCK, 'Anota cuánto hay de cada insumo: de 0 a lo pedido, con hasta tres decimales.'),
            // El material del catálogo que Almacén eligió para un material nuevo.
            // Sin declararlo, zod lo quitaba en silencio y la base daba de alta
            // uno provisional en vez del elegido (visto en el banco, 2026-10-20).
            material_id: z.guid('Vuelve a cargar la pantalla.').nullable().optional(),
          }),
        )
        .min(1, 'Anota cuánto hay de cada insumo.')
        .max(100, 'Vuelve a cargar la pantalla.'),
    })
    .safeParse({ id: formulario.get('id'), nota: formulario.get('nota') ?? '', lineas })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.recibir')) return { ok: false, error: 'No tienes permiso para revisar el stock.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rq_revisar_stock', {
    p_id: analisis.data.id,
    p_lineas: analisis.data.lineas,
    p_nota: analisis.data.nota || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El requerimiento no cambió. Recarga la pantalla.' }

  const { data: rq } = await supabase.from('requerimientos').select('estado, tipo').eq('id', analisis.data.id).maybeSingle()

  revalidatePath('/requerimientos')
  revalidatePath('/requerimientos/atencion')
  if (rq?.estado === 'LISTO_EN_ALMACEN') return { ok: true, mensaje: 'Tienes todo: queda listo en almacén y le avisamos al área para que lo recoja.' }
  const quien = rq?.tipo === 'ADMINISTRACION' ? 'a la administradora' : 'a Logística'
  return { ok: true, mensaje: `Revisado. Le llegó ${quien} solo lo que falta comprar.` }
}
