/**
 * El recorrido de un documento numerado: por dónde pasó, quién hizo cada paso y
 * cuándo, quién lo tiene ahora y hace cuántos días (migración 20261125130000).
 * La base da las claves (`recorrido_de_requerimientos`,
 * `recorrido_de_cotizaciones`, `recorrido_de_informes_diseno`, `recorrido_de_planillas`);
 * las frases viven aquí. Un documento nuevo suma su función con la misma forma y
 * su mapa de pasos en este archivo.
 */

// Sin imports de valores: `recorrido.test.mjs` lo carga con `node --test`, que no
// resuelve el alias `@/` ni las rutas sin extensión.

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
  // Ya salió del kardex todo lo pedido (20261126170000): solo falta cerrarlo.
  POR_ENTREGAR: () => 'Ya salió todo del kardex: falta marcarlo entregado.',
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
  // En parte, solo a quien lee las facturas (migración 20261126470000): «Facturada» con la mitad sin facturar confundía.
  FACTURA: { hecho: (d) => (d === 'EN_PARTE' ? 'Facturada en parte' : 'Facturada'), falta: 'Factura' },
  // Facturada en parte: la factura de lo que falta del total (migración 20261126470000). Solo espera, nunca se dice hecha.
  FACTURA_RESTO: { hecho: 'Facturado lo que faltaba', falta: 'Factura de lo que falta' },
  // El cobro lo ve quien lee los cobros; a Ventas la base no se lo da.
  COBRO: { hecho: 'Cobrada', falta: 'Cobro' },
  ANULACION: { hecho: 'Anulada', falta: 'Anulación' },
}

const ESPERAS_DE_LA_COTIZACION: Record<string, (detalle: string | null) => string> = {
  REVISION: () => 'La aprueba o la rechaza.',
  CORRECCION: () => 'Sube la corrección con el mismo número.',
  // Con varias unidades el detalle dice cuántas OT lleva de cuántas («1/3»).
  CODIGO_Y_OT: (d) => {
    const [lleva, de] = (d ?? '').split('/').map(Number)
    if (!de) return 'Le da el código interno de la unidad y sube la OT.'
    const faltan = de - lleva
    return lleva
      ? `Lleva ${lleva} de ${de} OT: ${faltan === 1 ? 'falta la de 1 unidad, con su código interno' : `faltan las de ${faltan} unidades, cada una con su código interno`}.`
      : `Le da a cada una de las ${de} unidades su código interno y sube su OT.`
  },
  FACTURA: () => 'Registra su factura.',
  FACTURA_RESTO: () => 'Registra la factura de lo que falta del total.',
  COBRO: (detalle) => (detalle === 'EN_PARTE' ? 'Cobra lo que falta: ya cobró una parte.' : 'Cobra sus facturas.'),
}

/** «1 hora», «26.5 horas», como `horas` de averias.ts (aquí sin importarla: el test corre sin el alias). */
function horasParado(valor: number): string {
  const texto = Number.isInteger(valor) ? String(valor) : valor.toFixed(1)
  return `${texto} ${valor === 1 ? 'hora' : 'horas'}`
}

const PASOS_DEL_INFORME_DISENO: Record<string, Frases> = {
  REGISTRO: { hecho: 'Borrador empezado', falta: 'Borrador' },
  ENVIO: { hecho: 'Enviado a Diseño', falta: 'Envío a Diseño' },
  // El motivo va entero: es lo que el colaborador tiene que corregir.
  DEVOLUCION: { hecho: 'Devuelto para corregir', falta: 'Devolución', nota: (motivo) => `Motivo: ${motivo}` },
  CORRECCION: { hecho: 'Corregido', falta: 'Corrección' },
  APROBACION: { hecho: 'Aprobado por Diseño', falta: 'Aprobación' },
  // Del circuito anterior, cuando el informe pasaba a Administración (migración 20261001213000).
  RECEPCION: { hecho: 'Recibido por Administración', falta: 'Recepción de Administración' },
  REVISION: { hecho: 'Revisado por Diseño', falta: 'Revisión de Diseño' },
}

const ESPERAS_DEL_INFORME_DISENO: Record<string, () => string> = {
  ENVIO: () => 'Completa la semana y envía el informe a Diseño.',
  CORRECCION: () => 'Corrige lo que Diseño observó y vuelve a enviarlo.',
  REVISION: () => 'Lo aprueba o lo devuelve con su motivo.',
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
    // Las horas que estuvo parado y el trabajo hecho («26.5|Se cambió…»): si no
    // quedó bien, la ficha ya no muestra el primer trabajo, y quien la vuelve a
    // atender lo lee aquí.
    nota: (d) => {
      const [h, ...resto] = d.split('|')
      const trabajo = resto.join('|').trim()
      const parado = h && Number.isFinite(Number(h)) ? `Parado: ${horasParado(Number(h))}` : null
      return [parado, trabajo || null].filter(Boolean).join('. ') || null
    },
  },
  // Lo que dijo quien la reportó: la ficha muestra solo la última vez.
  REAPERTURA: { hecho: 'No quedó bien: volvió a Mantenimiento', falta: 'Reapertura', nota: (t) => (t ? `«${t}»` : null) },
  CONFIRMACION: {
    // Si quien la reportó ya no tenía cuenta, la confirmó otra persona (DKS, 2026-11-26): el puesto dice quién.
    hecho: (d) => (d === 'EN_LUGAR' ? 'Confirmó que quedó bien, en lugar de quien la reportó' : 'Quien la reportó confirmó que quedó bien'),
    falta: 'Quien la reportó confirma que quedó bien',
    nota: (d) => (d === 'EN_LUGAR' ? 'Quien la reportó ya no tenía cuenta activa.' : null),
  },
  ANULACION: { hecho: 'Anulada por Mantenimiento', falta: 'Anulación' },
}

const ESPERAS_DE_LA_AVERIA: Record<string, (detalle: string | null) => string> = {
  ATENCION: () => 'La revisa y anota qué tiene.',
  CIERRE: () => 'La arregla y la cierra con el trabajo hecho y las horas parado.',
  CONFIRMACION: (d) =>
    d === 'SIN_CUENTA'
      ? 'Quien la reportó ya no tiene cuenta activa: prueba el equipo y dice si quedó bien.'
      : 'Prueba el equipo y dice si quedó bien.',
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

/**
 * Lo que Logística anotó de una compra atrasada (Plan 4.2): el motivo llega como
 * «PROVEEDOR|nota» y la fecha corregida como «2026-11-21>2026-11-28|PROVEEDOR|nota».
 */
export type Seguimiento = { motivo: string; nota: string | null; anterior: string | null; nueva: string | null }

export function partirSeguimiento(paso: string, detalle: string | null): Seguimiento | null {
  if (!detalle) return null
  let resto = detalle
  let anterior: string | null = null
  let nueva: string | null = null
  if (paso === 'FECHA_CORREGIDA') {
    const i = resto.indexOf('|')
    const fechas = i < 0 ? resto : resto.slice(0, i)
    resto = i < 0 ? '' : resto.slice(i + 1)
    const [a, n] = fechas.split('>')
    anterior = a || null
    nueva = n || null
  }
  const j = resto.indexOf('|')
  const motivo = j < 0 ? resto : resto.slice(0, j)
  const nota = j < 0 ? '' : resto.slice(j + 1)
  return { motivo, nota: nota.trim() || null, anterior, nueva }
}

/** Lo último que Logística anotó del atraso, con quién y cuándo: el paso y lo que dice. */
export function ultimoSeguimiento(pasos: readonly PasoDelRecorrido[] | undefined) {
  const ultimo = [...(pasos ?? [])]
    .filter((p) => p.situacion === 'HECHO' && (p.paso === 'MOTIVO_ATRASO' || p.paso === 'FECHA_CORREGIDA'))
    .sort((a, b) => a.orden - b.orden)
    .at(-1)
  const lo = ultimo && partirSeguimiento(ultimo.paso, ultimo.detalle)
  return ultimo && lo ? { paso: ultimo, ...lo } : null
}

/** Si Logística corrigió la fecha prometida, la que valía antes de la última corrección. */
export function correccionDeLaFecha(pasos: readonly PasoDelRecorrido[] | null | undefined): { antes: string | null } | null {
  const ultima = [...(pasos ?? [])]
    .filter((p) => p.situacion === 'HECHO' && p.paso === 'FECHA_CORREGIDA')
    .sort((a, b) => a.orden - b.orden)
    .at(-1)
  if (!ultima) return null
  return { antes: partirSeguimiento(ultima.paso, ultima.detalle)?.anterior ?? null }
}

/**
 * Por qué se atrasó una compra, de la lista corta que decidió el plan 4.2
 * (migración 20261126462000). Con «Otro», la nota es obligatoria.
 */
export const MOTIVOS_DE_ATRASO = ['PROVEEDOR', 'PAGO', 'TRANSPORTE', 'APROBACION', 'OTRO'] as const
export type MotivoDeAtraso = (typeof MOTIVOS_DE_ATRASO)[number]

export const MOTIVO_DE_ATRASO: Record<MotivoDeAtraso, string> = {
  PROVEEDOR: 'Proveedor',
  PAGO: 'Pago',
  TRANSPORTE: 'Transporte',
  APROBACION: 'Aprobación',
  OTRO: 'Otro',
}

/** El motivo en palabras; una clave que la pantalla no conoce, en llano. */
export function motivoDeAtraso(clave: string): string {
  return MOTIVO_DE_ATRASO[clave as MotivoDeAtraso] ?? clave.replaceAll('_', ' ').toLowerCase()
}

/** Una fecha `YYYY-MM-DD` como DD/MM/AAAA, reordenada como texto, igual que `fecha()` de `format.ts`. */
function fecha(valor: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim())
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : valor
}

function notaDelSeguimiento(paso: string) {
  return (detalle: string) => {
    const s = partirSeguimiento(paso, detalle)
    if (!s) return null
    const fechas = s.nueva ? (s.anterior ? `Del ${fecha(s.anterior)} al ${fecha(s.nueva)}` : `Al ${fecha(s.nueva)}`) : null
    return [fechas, motivoDeAtraso(s.motivo), s.nota].filter(Boolean).join(' · ')
  }
}

const SEGUIMIENTO: Record<string, Frases> = {
  MOTIVO_ATRASO: { hecho: 'Anotó el motivo del atraso', falta: 'Motivo del atraso', nota: notaDelSeguimiento('MOTIVO_ATRASO') },
  FECHA_CORREGIDA: { hecho: 'Corrigió la fecha prometida', falta: 'Fecha prometida', nota: notaDelSeguimiento('FECHA_CORREGIDA') },
}

const PASOS_DE_LA_ORDEN_DE_COMPRA: Record<string, Frases> = {
  EMISION: { hecho: 'Emitida', falta: 'Emisión' },
  APROBACION: { hecho: 'Gerencia la aprobó', falta: 'Aprobación de Gerencia' },
  RECHAZO: { hecho: 'Gerencia la rechazó', falta: 'Aprobación de Gerencia' },
  MANDADA_A_RECOJO: { hecho: 'Mandada a recojo', falta: 'Mandarla a recojo' },
  PROGRAMACION: { hecho: 'Recojo programado con el conductor', falta: 'Programar el recojo' },
  GUIA: { hecho: 'Contabilidad cargó la guía de remisión', falta: 'Guía de remisión' },
  SALIDA: { hecho: 'El conductor salió a recogerla', falta: 'Salida a recogerla' },
  NO_SE_PUDO_RECOGER: { hecho: 'El conductor no la pudo recoger', falta: 'Recojo donde el proveedor', nota: (motivo) => motivo },
  RECOGIDA: { hecho: 'Recogida donde el proveedor', falta: 'Recojo donde el proveedor' },
  DEJADA: { hecho: 'Dejada en el almacén', falta: 'Llegada al almacén' },
  VALIDACION: {
    hecho: (d) => (d === 'OBSERVADO' ? 'Almacén observó el ingreso' : 'Almacén validó el ingreso'),
    falta: 'Validación de Almacén',
  },
  DEVOLUCION: { hecho: 'Almacén devolvió parte al proveedor', falta: 'Devolución al proveedor' },
  COMPLETA: { hecho: 'Completa: llegó todo lo pedido', falta: 'Completa' },
  ANULACION: { hecho: 'Anulada', falta: 'Anulación' },
  ...SEGUIMIENTO,
}

const ESPERAS_DE_LA_ORDEN_DE_COMPRA: Record<string, () => string> = {
  APROBACION: () => 'La aprueba o la rechaza.',
  MANDAR_A_RECOJO: () => 'Falta mandarla a recojo.',
  PROGRAMAR: () => 'Falta programar el recojo con el conductor.',
  GUIA: () => 'Carga la guía de remisión para el recojo.',
  SALIR: () => 'Falta salir a recogerla.',
  RECOGER: () => 'Salió a recogerla.',
  DEJAR: () => 'La lleva al almacén.',
  VALIDAR: () => 'Valida lo que llegó.',
  REPONER: () => 'Repone lo que Almacén le devolvió.',
  OBSERVADO: () => 'Almacén observó el ingreso: trae lo que falta.',
  FALTA_LLEGAR: () => 'Llegó en parte: trae lo que falta.',
}

const PASOS_DE_LA_ORDEN_DE_SERVICIO: Record<string, Frases> = {
  EMISION: { hecho: 'Emitida', falta: 'Emisión' },
  APROBACION: { hecho: 'Gerencia la aprobó', falta: 'Aprobación de Gerencia' },
  RECHAZO: { hecho: 'Gerencia la rechazó', falta: 'Aprobación de Gerencia' },
  INICIO: { hecho: 'Iniciada', falta: 'Inicio del trabajo' },
  EJECUCION: { hecho: 'En ejecución', falta: 'Trabajo del proveedor' },
  CONFORMIDAD: { hecho: 'Volvió conforme', falta: 'Conformidad' },
  ANULACION: { hecho: 'Anulada', falta: 'Anulación' },
  ...SEGUIMIENTO,
}

const ESPERAS_DE_LA_ORDEN_DE_SERVICIO: Record<string, () => string> = {
  APROBACION: () => 'La aprueba o la rechaza.',
  INICIAR: () => 'Falta marcar que el trabajo empezó.',
  EJECUTAR: () => 'Hace el trabajo; cuando vuelva, Logística da la conformidad.',
}

/** El recorrido de una orden de compra, en palabras. */
export const describirRecorridoDeLaOrdenDeCompra = (pasos: readonly PasoDelRecorrido[]) =>
  describir(pasos, PASOS_DE_LA_ORDEN_DE_COMPRA, ESPERAS_DE_LA_ORDEN_DE_COMPRA)

/** El recorrido de una orden de servicio, en palabras. */
export const describirRecorridoDeLaOrdenDeServicio = (pasos: readonly PasoDelRecorrido[]) =>
  describir(pasos, PASOS_DE_LA_ORDEN_DE_SERVICIO, ESPERAS_DE_LA_ORDEN_DE_SERVICIO)

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

/** El recorrido de un informe semanal de Diseño, en palabras. */
export const describirRecorridoDelInformeDiseno = (pasos: readonly PasoDelRecorrido[]) =>
  describir(pasos, PASOS_DEL_INFORME_DISENO, ESPERAS_DEL_INFORME_DISENO)

/** «1 persona», «12 personas». */
const personas = (n: string) => (Number(n) === 1 ? '1 persona' : `${n} personas`)

// La planilla del mes (migración 20261126610000): no es un documento numerado,
// pero RR. HH. la sigue igual, paso a paso, hasta cerrarla.
const PASOS_DE_LA_PLANILLA: Record<string, Frases> = {
  CREADA: { hecho: 'Creada', falta: 'Creación' },
  IMPORTACION: { hecho: 'Excel importado', falta: 'Excel', nota: (n) => `Entraron ${personas(n)}` },
  A_MANO: { hecho: 'Agregadas a mano', falta: 'Agregadas a mano', nota: (n) => `${personas(n)} fuera del Excel. La hora es la de la última que se agregó.` },
  QUITADAS: { hecho: 'Quitadas de la planilla', falta: 'Quitadas', nota: (n) => `${personas(n)}. La hora es la de la última que se quitó.` },
  CIERRE: { hecho: 'Cerrada', falta: 'Cierre' },
}

const ESPERAS_DE_LA_PLANILLA: Record<string, (detalle: string | null) => string> = {
  IMPORTAR: () => 'Importa el Excel del mes o agrega a la primera persona.',
  CERRAR: () => 'Revisa lo que falta y la cierra.',
}

/** El recorrido de una planilla del mes, en palabras. */
export const describirRecorridoDeLaPlanilla = (pasos: readonly PasoDelRecorrido[]) =>
  describir(pasos, PASOS_DE_LA_PLANILLA, ESPERAS_DE_LA_PLANILLA)

/** El recorrido de un reporte de avería, en palabras. */
export const describirRecorridoDeLaAveria = (pasos: readonly PasoDelRecorrido[]) =>
  describir(pasos, PASOS_DE_LA_AVERIA, ESPERAS_DE_LA_AVERIA).map((p) =>
    // Sin la cuenta de quien la reportó, la confirma otra persona: el título no la nombra.
    p.situacion === 'AHORA' && p.paso === 'CONFIRMACION' && p.detalle === 'SIN_CUENTA' ? { ...p, titulo: 'Confirmación: si quedó bien' } : p,
  )
