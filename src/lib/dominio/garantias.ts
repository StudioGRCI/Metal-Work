import type { Tono } from '@/components/ui/etiqueta-estado'

/*
 * El reclamo de garantía (plan «Las demás áreas», A.2, migración
 * 20261126991000): el cliente vuelve con su unidad. Ventas lo registra con su
 * número RG, Administración abre su OT de garantía (o dice que no procede) y
 * Calidad anota la causa cuando la garantía está terminada. Lo que la pantalla
 * y las acciones comparten con la base.
 */

type Def = { etiqueta: string; tono: Tono; descripcion?: string }

/**
 * En qué está el reclamo y a quién espera, como lo cuenta
 * `garantias_reclamos_visibles.situacion`: la base la calcula con el estado
 * del reclamo y el de su OT, y la pantalla no la vuelve a deducir.
 */
export const SITUACION_RECLAMO: Record<string, Def & { quien?: string }> = {
  POR_ABRIR_OT: {
    etiqueta: 'Espera su OT',
    tono: 'aviso',
    quien: 'Administración',
    descripcion: 'Registrado: Administración abre su OT de garantía o dice que no procede.',
  },
  OT_ANULADA: {
    etiqueta: 'Su OT se anuló',
    tono: 'peligro',
    quien: 'Administración',
    descripcion: 'La OT de garantía se anuló: Administración le enlaza otra o lo cierra como «No procede».',
  },
  EN_TALLER: {
    etiqueta: 'En el taller',
    tono: 'info',
    quien: 'el taller',
    descripcion: 'Con su OT de garantía: el taller la trabaja hasta que Administración la da por terminada.',
  },
  POR_CAUSA: {
    etiqueta: 'Espera la causa',
    tono: 'aviso',
    quien: 'Calidad',
    descripcion: 'La garantía está terminada: Calidad anota por qué falló y el reclamo se cierra.',
  },
  CERRADO: { etiqueta: 'Cerrado', tono: 'exito', descripcion: 'Cerrado con la causa que anotó Calidad.' },
  NO_PROCEDE: { etiqueta: 'No procede', tono: 'neutro', descripcion: 'Administración lo cerró sin OT de garantía viva, con su motivo.' },
  ANULADO: { etiqueta: 'Anulado', tono: 'neutro', descripcion: 'Quedó sin efecto, con su motivo.' },
}

/** Las situaciones que todavía esperan a alguien. */
export const SITUACIONES_ABIERTAS = ['POR_ABRIR_OT', 'OT_ANULADA', 'EN_TALLER', 'POR_CAUSA'] as const

/** Por qué falló lo que se hizo, como la lista de `garantias_anotar_causa`. */
export const CAUSAS_GARANTIA = ['FABRICACION', 'MATERIAL', 'MONTAJE', 'USO_DEL_CLIENTE', 'DESGASTE', 'OTRA'] as const
export type CausaGarantia = (typeof CAUSAS_GARANTIA)[number]

export const CAUSA_GARANTIA: Record<string, Def> = {
  FABRICACION: { etiqueta: 'Fabricación', tono: 'peligro', descripcion: 'Algo se hizo mal en el taller: una soldadura, un corte, una medida.' },
  MATERIAL: { etiqueta: 'Material', tono: 'peligro', descripcion: 'El material o la pieza vino falla o no era la que correspondía.' },
  MONTAJE: { etiqueta: 'Montaje', tono: 'peligro', descripcion: 'Se armó o se instaló mal: pernos, ajustes, el montaje sobre el chasis.' },
  USO_DEL_CLIENTE: { etiqueta: 'Uso del cliente', tono: 'neutro', descripcion: 'El cliente la usó fuera de lo que soporta: sobrecarga, un golpe, un mal uso.' },
  DESGASTE: { etiqueta: 'Desgaste', tono: 'neutro', descripcion: 'Es el desgaste normal por el uso y el tiempo.' },
  OTRA: { etiqueta: 'Otra', tono: 'neutro', descripcion: 'Ninguna de las anteriores: cuéntala en el detalle.' },
}

/** El bucket privado de las fotos: la ruta es `{cuenta}/{reclamo}/{foto}.jpg`. */
export const BUCKET_FOTOS_GARANTIAS = 'fotos-garantias'

/** Hasta cuatro fotos por reclamo, como exige `garantias_anotar_fotos`. */
export const MAXIMO_FOTOS_GARANTIA = 4

/** Lo que pesa como máximo una foto ya achicada en el teléfono (el tope del bucket). */
export const MAXIMO_MB_FOTO_GARANTIA = 5

/** Los permisos de la pantalla: quien tiene alguno ve todos los reclamos (`puede_ver_los_reclamos_de_garantia`). */
export const PERMISOS_GARANTIAS = ['garantias.registrar', 'garantias.atender', 'garantias.causa', 'garantias.ver'] as const

/** A quién le llegó el aviso del reclamo, como lo cuenta `garantias_registrar`. */
export type AvisosDelReclamo = { administracion: boolean; garantias: boolean; gerencia: boolean }

/**
 * Lo que dice el verde según a quién le llegó el aviso: nunca «ya le avisamos a
 * Administración» si no había una cuenta de Administración que lo recibiera.
 */
export function aQuienSeAvisoDelReclamo(numero: string, avisos: AvisosDelReclamo): string {
  const partes = [...(avisos.administracion ? ['a Administración'] : []), ...(avisos.garantias ? ['al responsable de Garantías'] : [])]
  let texto = `Reclamo ${numero} registrado.`
  if (partes.length > 0) texto += ` Ya ${partes.length === 1 ? 'le' : 'les'} avisamos ${partes.join(' y ')}.`
  if (!avisos.administracion) {
    texto += avisos.gerencia
      ? ' No hay una cuenta activa de Administración: le avisamos a Gerencia.'
      : ' No hay una cuenta activa de Administración para recibir el aviso: cuéntaselo a Gerencia.'
  }
  return texto
}

/** «Garantía del reclamo RG-0001-2026: …», la descripción con que nace su OT, dentro del tope del formulario. */
export function descripcionDeLaOt(numero: string, descripcion: string): string {
  return `Garantía del reclamo ${numero}: ${descripcion}`.slice(0, 2000)
}
