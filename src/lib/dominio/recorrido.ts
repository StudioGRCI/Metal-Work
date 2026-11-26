/**
 * El recorrido de un documento numerado: por dónde pasó, quién hizo cada paso y
 * cuándo, quién lo tiene ahora y hace cuántos días (migración 20261125130000).
 * La base da las claves (`recorrido_de_requerimientos`,
 * `recorrido_de_cotizaciones`); las frases viven aquí. Un documento nuevo suma
 * su función con la misma forma y su mapa de pasos en este archivo.
 */

/** HECHO: alguien lo hizo. AHORA: alguien lo tiene. PENDIENTE: todavía no le toca a nadie. */
export type SituacionDelPaso = 'HECHO' | 'AHORA' | 'PENDIENTE'

/** Un paso como lo devuelve la base. */
export type PasoDelRecorrido = {
  orden: number
  paso: string
  situacion: SituacionDelPaso
  /**
   * De lo hecho, el puesto de la cuenta que lo hizo; de AHORA, quién lo tiene.
   * Solo el puesto, nunca el nombre de la persona (lo decidió DKS el 2026-11-25).
   */
  puesto: string | null
  /** Cuándo se hizo; de AHORA, desde cuándo espera. */
  en: string | null
  /**
   * De AHORA: días que lleva esperando. De lo hecho, solo en la cotización (Plan
   * 9.1): días desde el paso hecho anterior. Siempre por fecha de Lima.
   */
  dias: number | null
  /** Solo de AHORA: qué se espera. */
  espera: string | null
  /** Un dato corto del paso: el área, la OC, cómo terminó. */
  detalle: string | null
}

/** Un paso ya puesto en palabras, como lo pinta `Recorrido`. */
export type PasoDescrito = PasoDelRecorrido & {
  titulo: string
  /** Una línea más: qué se espera de quien lo tiene, o el dato del paso. */
  nota: string | null
}

/** «desde hoy», «hace 1 día», «hace 3 días». Los días los cuenta la base, por fecha de Lima. */
export function haceDias(dias: number): string {
  if (dias <= 0) return 'desde hoy'
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`
}

/** Lo que tardó un paso hecho: «el mismo día», «al día siguiente», «a los 3 días». */
export function tardo(dias: number): string {
  if (dias <= 0) return 'el mismo día'
  return dias === 1 ? 'al día siguiente' : `a los ${dias} días`
}

/** «Insumo 2», «Insumos 1 y 2», «Insumos 1, 2 y 4», a partir de «1,2,4». */
export function insumos(items: string): string | null {
  const n = items.split(',').map((x) => x.trim()).filter(Boolean).sort((a, b) => Number(a) - Number(b))
  if (n.length === 0) return null
  if (n.length === 1) return `Insumo ${n[0]}`
  return `Insumos ${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}`
}

/** El visto de Diseño llega como «AUTORIZADO:1,2»: la decisión y los insumos. */
function partirVisto(detalle: string | null): { decision: string | null; items: string } {
  if (!detalle) return { decision: null, items: '' }
  const i = detalle.indexOf(':')
  return i < 0 ? { decision: detalle, items: '' } : { decision: detalle.slice(0, i), items: detalle.slice(i + 1) }
}

type Frases = {
  /** Cómo se dice el paso ya hecho; con el detalle, si cambia la frase. */
  hecho: string | ((detalle: string | null) => string)
  /** Cómo se dice el paso que espera o que falta. */
  falta: string
  /** La nota del paso hecho, a partir de su detalle. */
  nota?: (detalle: string) => string | null
}

const PASOS_DEL_REQUERIMIENTO: Record<string, Frases> = {
  REGISTRO: { hecho: 'Registrado', falta: 'Registro', nota: (area) => `Para ${area}` },
  SUSTENTO: {
    hecho: 'Sustentó lo que se pasa del metrado',
    falta: 'Sustento de lo que se pasa del metrado',
    nota: insumos,
  },
  VISTO_DISENO: {
    hecho: (d) => (partirVisto(d).decision === 'RECHAZADO' ? 'Diseño no lo autorizó' : 'Diseño lo autorizó'),
    falta: 'Visto de Diseño',
    nota: (d) => insumos(partirVisto(d).items),
  },
  REVISION_STOCK: { hecho: 'Almacén revisó el stock', falta: 'Almacén revisa el stock' },
  COMPRA: { hecho: 'Tomado para comprar lo que falta', falta: 'Compra de lo que falta' },
  VUELTA_A_COMPRA: { hecho: 'Volvió a compra: Almacén devolvió parte al proveedor', falta: 'Vuelta a compra' },
  LISTO: { hecho: 'Listo para recoger', falta: 'Listo para recoger' },
  ENTREGA: {
    hecho: (d) => (d === 'CON_FALTANTE' ? 'Entregado al área, con faltante' : 'Entregado al área'),
    falta: 'Entrega al área',
  },
  ANULACION: { hecho: 'Anulado', falta: 'Anulación' },
}

/** Qué se espera de quien tiene el RQ. `oc` es la orden de compra del insumo más atrasado, si ya va en una. */
const ESPERAS_DEL_REQUERIMIENTO: Record<string, (oc: string | null) => string> = {
  SUSTENTO: () => 'Falta que sustente lo que se pasa del metrado de Diseño.',
  VISTO_DISENO: () => 'Revisa el sustento de lo que se pasa del metrado.',
  REVISION_STOCK: () => 'Revisa si hay stock.',
  POR_COMPRAR: () => 'Falta ponerlo en una orden de compra.',
  POR_PROGRAMAR: (oc) => `Falta programar el recojo de la ${oc ?? 'compra'} con el conductor.`,
  OC_POR_APROBAR: (oc) => `Aprueba la ${oc ?? 'orden de compra'}.`,
  PENDIENTE_RECOJO: (oc) => `Falta salir a recoger la ${oc ?? 'compra'}.`,
  EN_RECOJO: (oc) => `Salió a recoger la ${oc ?? 'compra'}.`,
  RECOGIDO: (oc) => `Lleva la ${oc ?? 'compra'} al almacén.`,
  POR_VALIDAR: (oc) => `Valida el ingreso de la ${oc ?? 'compra'}.`,
  OBSERVADO: (oc) => `Almacén observó el ingreso de la ${oc ?? 'compra'}: trae lo que falta.`,
  POR_REPONER: (oc) => `Espera que el proveedor reponga lo devuelto de la ${oc ?? 'compra'}.`,
  // La compra ya entró entera y no alcanzó para todo el insumo: lo dice igual la insignia de la tarjeta.
  COMPRA_CORTA: (oc) => `La ${oc ?? 'orden de compra'} compró menos: pide el resto en un RQ nuevo.`,
  // Ya no le falta llegar nada, aunque su orden de compra siga abierta: lo dice igual la insignia de la tarjeta.
  YA_LLEGO_TODO: () => 'Ya llegó todo: falta marcarlo listo para recoger.',
  RECOJO_DEL_AREA: () => 'Lo recoge en Almacén.',
}

// Con las palabras que usa Ventas con su cliente (Plan 9.1): enviada, devuelta
// con observación, aprobada, con OT. El título dice lo mismo que la insignia y
// la campana («Rechazada»), y la nota, lo que eso quiere decir para Ventas.
const PASOS_DE_LA_COTIZACION: Record<string, Frases> = {
  SUBIDA: { hecho: 'Enviada a Gerencia', falta: 'Envío a Gerencia' },
  REVISION: {
    hecho: (d) => (d === 'RECHAZADA' ? 'Rechazada' : d === 'APROBADA' ? 'Aprobada' : 'Revisada'),
    falta: 'Revisión de Gerencia',
    // Nadie la libera a mano desde la migración 20261027200000: aprobada, ya la
    // ven Contabilidad y Tesorería. Anulada después, ya no (`cotizacion_fue_aprobada`),
    // y la nota se quita en `describirRecorridoDeLaCotizacion`.
    nota: (d) =>
      d === 'APROBADA' ? 'Liberada: ya la ven Contabilidad y Tesorería' : d === 'RECHAZADA' ? 'Devuelta a Ventas con observación' : null,
  },
  CORRECCION: { hecho: 'Corrección subida', falta: 'Corrección', nota: (version) => `Pasó a la ${version}` },
  // El número de la OT llega solo a quien lee las órdenes.
  CODIGO_Y_OT: { hecho: 'Con código interno y OT', falta: 'Código interno y OT', nota: (ot) => ot },
  FACTURA: { hecho: 'Facturada', falta: 'Factura' },
  ANULACION: { hecho: 'Anulada', falta: 'Anulación' },
}

const ESPERAS_DE_LA_COTIZACION: Record<string, (detalle: string | null) => string> = {
  REVISION: () => 'La aprueba o la rechaza.',
  CORRECCION: () => 'Sube la corrección con el mismo número.',
  CODIGO_Y_OT: () => 'Le da el código interno de la unidad y sube la OT.',
  FACTURA: () => 'Registra su factura.',
}

/** «1 hora», «26.5 horas», como `horas` de averias.ts (aquí sin importarla: el test corre sin el alias). */
function horasParado(valor: number): string {
  const texto = Number.isInteger(valor) ? String(valor) : valor.toFixed(1)
  return `${texto} ${valor === 1 ? 'hora' : 'horas'}`
}

const PASOS_DE_LA_AVERIA: Record<string, Frases> = {
  REPORTE: {
    hecho: (d) => (d === 'PARADO' ? 'Reportada: el equipo quedó parado' : 'Reportada'),
    falta: 'Reporte',
  },
  ATENCION: { hecho: 'Mantenimiento anotó su diagnóstico', falta: 'Diagnóstico de Mantenimiento' },
  CIERRE: {
    hecho: 'Mantenimiento la cerró',
    falta: 'Cierre: el equipo vuelve a operativo',
    // Las horas que estuvo parado, como las anotó Mantenimiento.
    nota: (h) => (h && Number.isFinite(Number(h)) ? `Parado: ${horasParado(Number(h))}` : null),
  },
  REAPERTURA: { hecho: 'No quedó bien: volvió a Mantenimiento', falta: 'Reapertura' },
  CONFIRMACION: { hecho: 'Quien la reportó confirmó que quedó bien', falta: 'Quien la reportó confirma que quedó bien' },
  ANULACION: { hecho: 'Anulada por Mantenimiento', falta: 'Anulación' },
}

const ESPERAS_DE_LA_AVERIA: Record<string, (detalle: string | null) => string> = {
  ATENCION: () => 'La revisa y anota qué tiene.',
  CIERRE: () => 'La arregla y la cierra con el trabajo hecho y las horas parado.',
  CONFIRMACION: () => 'Prueba el equipo y dice si quedó bien.',
}

function describir(
  pasos: readonly PasoDelRecorrido[],
  frases: Record<string, Frases>,
  esperas: Record<string, (detalle: string | null) => string>,
): PasoDescrito[] {
  return [...pasos]
    .sort((a, b) => a.orden - b.orden)
    .map((p) => {
      const f = frases[p.paso]
      // Una clave que este mapa no conoce (la base va por delante) se pinta en llano, no se esconde.
      const llano = p.paso.replaceAll('_', ' ').toLowerCase()
      if (p.situacion === 'HECHO') {
        const titulo = f ? (typeof f.hecho === 'function' ? f.hecho(p.detalle) : f.hecho) : llano
        return { ...p, titulo, nota: p.detalle && f?.nota ? f.nota(p.detalle) : null }
      }
      const nota = p.situacion === 'AHORA' && p.espera ? (esperas[p.espera]?.(p.detalle) ?? null) : null
      return { ...p, titulo: f?.falta ?? llano, nota }
    })
}

/** El recorrido de un RQ, en palabras. */
export const describirRecorridoDelRequerimiento = (pasos: readonly PasoDelRecorrido[]) =>
  describir(pasos, PASOS_DEL_REQUERIMIENTO, ESPERAS_DEL_REQUERIMIENTO)

/** El recorrido de una cotización, en palabras. */
export function describirRecorridoDeLaCotizacion(pasos: readonly PasoDelRecorrido[]): PasoDescrito[] {
  const descritos = describir(pasos, PASOS_DE_LA_COTIZACION, ESPERAS_DE_LA_COTIZACION)
  const anulada = pasos.some((p) => p.paso === 'ANULACION' && p.situacion === 'HECHO')
  return anulada
    ? descritos.map((p) => (p.paso === 'REVISION' && p.detalle === 'APROBADA' ? { ...p, nota: null } : p))
    : descritos
}

/** El recorrido de un reporte de avería, en palabras. */
export const describirRecorridoDeLaAveria = (pasos: readonly PasoDelRecorrido[]) =>
  describir(pasos, PASOS_DE_LA_AVERIA, ESPERAS_DE_LA_AVERIA)
