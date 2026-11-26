import 'server-only'

import { diasEnEspera } from '@/lib/datos/dias-en-espera'
import { todasLasFilas } from '@/lib/datos/todas-las-filas'
import { createClient } from '@/lib/supabase/server'

/**
 * Una salida del kardex hecha contra un insumo de un RQ, como la ve quien lo
 * pidió (plan 2, entrega 2.2): cuánto, cuándo, quién la recibió y si tiene foto.
 * Sin precio: la da la base (`salidas_de_requerimientos`), no la tabla del kardex.
 */
export type SalidaDelInsumo = {
  id: string
  requerimientoId: string
  lineaId: string
  cantidad: number
  unidad: string | null
  /** El material que salió: puede no ser el que se pidió (otra marca u otra medida del mismo almacén). */
  material: string | null
  numero: string | null
  en: string
  recibio: string | null
  conFoto: boolean
  /** Si quien mira puede anotar «no llegó» o «llegó incompleto» (decisión 1 del plan). */
  puedeAnotar: boolean
  /** La nota que Almacén todavía no cierra; vacía si no hay. */
  notaAbierta: string | null
}

/** Lo que quien pidió anotó sobre una salida y, si ya la cerró, lo que respondió Almacén. */
export type NotaDeConformidad = {
  id: string
  movimientoId: string
  requerimientoId: string
  requerimiento: string
  item: number
  material: string
  unidad: string | null
  salio: number
  numeroSalida: string | null
  salioEn: string
  tipo: 'NO_LLEGO' | 'LLEGO_INCOMPLETO'
  recibido: number | null
  nota: string
  anotadoPor: string | null
  anotadoEn: string
  respuesta: string | null
  atendidoPor: string | null
  atendidoEn: string | null
  /** Si quien mira puede cerrarla (`almacen.despachar`). */
  puedeAtender: boolean
  /** Los días que la abierta lleva esperando a Almacén, contados por la base; `null` si no se pudieron contar o está cerrada. */
  dias: number | null
}

/** Lo que Almacén necesita a la vista para responder una nota: de qué área y código es, quién recibió y la foto. */
export type NotaParaAlmacen = NotaDeConformidad & { area: string | null; codigoInterno: string | null; recibio: string | null; conFoto: boolean }

/** Las salidas de estos RQ, por insumo (el id de su línea). Lanza si la base no contesta. */
export async function salidasDeRequerimientos(ids: readonly string[]): Promise<Map<string, SalidaDelInsumo[]>> {
  const porLinea = new Map<string, SalidaDelInsumo[]>()
  if (ids.length === 0) return porLinea
  const db = await createClient()
  // Una fila por salida: con 300 RQ pasa de mil, y Supabase corta en mil sin avisar.
  const { data, error } = await todasLasFilas(
    () => db.rpc('salidas_de_requerimientos', { p_ids: [...ids] }),
    ['requerimiento_id', 'item', 'salio_en', 'movimiento_id'],
  )
  if (error) throw new Error(`No se pudieron leer las salidas de los requerimientos: ${error.message}`)
  for (const s of data ?? []) {
    if (!s.movimiento_id || !s.requerimiento_linea_id || !s.requerimiento_id || !s.salio_en) continue
    const lista = porLinea.get(s.requerimiento_linea_id) ?? []
    lista.push({
      id: s.movimiento_id,
      requerimientoId: s.requerimiento_id,
      lineaId: s.requerimiento_linea_id,
      cantidad: Number(s.cantidad ?? 0),
      unidad: s.unidad,
      material: s.material,
      numero: s.numero_salida,
      en: s.salio_en,
      recibio: s.recibido_por,
      conFoto: Boolean(s.con_foto),
      puedeAnotar: Boolean(s.puede_anotar),
      notaAbierta: s.nota_abierta,
    })
    porLinea.set(s.requerimiento_linea_id, lista)
  }
  return porLinea
}

/**
 * Las notas de conformidad: con `requerimientos`, solo las de esos RQ; con
 * `soloAbiertas`, las que Almacén todavía no cierra, la más antigua primero.
 * Lanza si la base no contesta.
 */
export async function notasDeConformidad(opciones: { requerimientos?: readonly string[]; soloAbiertas?: boolean } = {}): Promise<NotaDeConformidad[]> {
  if (opciones.requerimientos && opciones.requerimientos.length === 0) return []
  const db = await createClient()
  // De mil en mil, las abiertas primero y la más antigua arriba.
  const { data, error } = await todasLasFilas(
    () =>
      db.rpc('notas_de_conformidad', {
        p_requerimientos: opciones.requerimientos ? [...opciones.requerimientos] : undefined,
        p_solo_abiertas: opciones.soloAbiertas ?? false,
      }),
    ['atendido_en.asc.nullsfirst', 'anotado_en', 'id'],
  )
  if (error) throw new Error(`No se pudieron leer las notas de las salidas: ${error.message}`)
  const notas: NotaDeConformidad[] = (data ?? []).flatMap((n) =>
    n.id && n.movimiento_id && n.requerimiento_id && n.anotado_en && n.salio_en && (n.tipo === 'NO_LLEGO' || n.tipo === 'LLEGO_INCOMPLETO')
      ? [
          {
            id: n.id,
            movimientoId: n.movimiento_id,
            requerimientoId: n.requerimiento_id,
            requerimiento: n.requerimiento ?? '',
            item: Number(n.item ?? 0),
            material: n.material ?? 'Material',
            unidad: n.unidad,
            salio: Number(n.salio ?? 0),
            numeroSalida: n.numero_salida,
            salioEn: n.salio_en,
            tipo: n.tipo,
            recibido: n.cantidad_recibida === null ? null : Number(n.cantidad_recibida),
            nota: n.nota ?? '',
            anotadoPor: n.anotado_por,
            anotadoEn: n.anotado_en,
            respuesta: n.respuesta,
            atendidoPor: n.atendido_por,
            atendidoEn: n.atendido_en,
            puedeAtender: Boolean(n.puede_atender),
            dias: null,
          },
        ]
      : [],
  )
  // Cuánto espera cada abierta, con la fecha de Lima de la base: solo para la
  // lista de Almacén. Sin eso la lista sigue, sin los días.
  if (!opciones.soloAbiertas) return notas
  const abiertas = notas.filter((n) => !n.atendidoEn)
  const dias = await diasEnEspera(abiertas.map((n) => n.anotadoEn)).catch((e: unknown) => {
    console.error('Notas de las salidas: no se pudieron contar los días.', e)
    return null
  })
  abiertas.forEach((n, i) => (n.dias = dias?.[i] ?? null))
  return notas
}

/** Cómo se dice lo anotado: «No llegó» o «Llegó 3 de 4 UND». */
export function loAnotado(n: Pick<NotaDeConformidad, 'tipo' | 'recibido' | 'salio' | 'unidad'>, cantidad: (v: number) => string) {
  return n.tipo === 'NO_LLEGO'
    ? 'No llegó'
    : `Llegó ${cantidad(n.recibido ?? 0)} de ${cantidad(n.salio)}${n.unidad ? ` ${n.unidad}` : ''}`
}

/** Las salidas de cada insumo y las notas de cada salida, para las tarjetas de estos RQ. */
export type ConformidadDeLosRq = { salidas: Map<string, SalidaDelInsumo[]>; notas: Map<string, NotaDeConformidad[]> }

export async function conformidadDeRequerimientos(ids: readonly string[]): Promise<ConformidadDeLosRq> {
  const [salidas, lista] = await Promise.all([salidasDeRequerimientos(ids), notasDeConformidad({ requerimientos: ids })])
  const notas = new Map<string, NotaDeConformidad[]>()
  for (const n of lista) notas.set(n.movimientoId, [...(notas.get(n.movimientoId) ?? []), n])
  return { salidas, notas }
}

/**
 * Las notas abiertas, para la tarjeta de arriba de Atención, con el área y el
 * código interno del RQ y quién recibió la salida y si tiene foto. Almacén lee
 * el RQ y el kardex con su permiso; si eso falla, las notas siguen sin esos datos.
 */
export async function notasAbiertasParaAlmacen(): Promise<NotaParaAlmacen[]> {
  const notas = await notasDeConformidad({ soloAbiertas: true })
  if (notas.length === 0) return []
  const db = await createClient()
  const [rqs, salidas] = await Promise.all([
    db.from('requerimientos').select('id, codigo_interno, area:areas(nombre)').in('id', [...new Set(notas.map((n) => n.requerimientoId))]),
    db.from('movimientos_materiales').select('id, recibido_por_nombre, foto_ruta').in('id', notas.map((n) => n.movimientoId)),
  ])
  if (rqs.error) console.error('Notas de las salidas: no se pudo leer el área y el código de los RQ.', rqs.error)
  if (salidas.error) console.error('Notas de las salidas: no se pudo leer quién recibió cada salida.', salidas.error)
  const rq = new Map((rqs.data ?? []).map((r) => [r.id, r]))
  const salida = new Map((salidas.data ?? []).map((m) => [m.id, m]))
  return notas.map((n) => ({
    ...n,
    area: rq.get(n.requerimientoId)?.area?.nombre ?? null,
    codigoInterno: rq.get(n.requerimientoId)?.codigo_interno ?? null,
    recibio: salida.get(n.movimientoId)?.recibido_por_nombre ?? null,
    conFoto: Boolean(salida.get(n.movimientoId)?.foto_ruta),
  }))
}
