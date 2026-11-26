import 'server-only'

import { cargarAprobacionCompras, esAprobadorDeCompras } from '@/lib/datos/aprobacion-compras'
import { leerListaDeCodigos } from '@/lib/datos/codigos-internos'
import { controlDeFacturas } from '@/lib/datos/adquisiciones'
import { diasEnEspera } from '@/lib/datos/dias-en-espera'
import { mesesSinPagosDeOficina, mesesSinPlanillaDeTaller, repartoDelMes } from '@/lib/datos/gastos-generales'
import { nombreDeOc } from '@/lib/dominio/adquisiciones'
import { enlaceCodigo, faltaParaCerrar, noEsUnidad } from '@/lib/dominio/codigos-internos'
import { destinoDeCompra } from '@/lib/dominio/logistica'
import { fecha, hoyLima, moneda, type CodigoMoneda } from '@/lib/format'
import { apruebaSinOrden, puede, type PerfilSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Lo que espera la decisión de Gerencia, en un solo sitio (plan 12, entrega
 * 12.1). No se decide aquí: cada fila lleva a su pantalla, donde vive la regla
 * de esa aprobación. Cada grupo se pide solo si quien mira tiene el permiso que
 * lo resuelve —a quien no aprueba compras no se le leen las compras— y se lee
 * con su sesión, así que el RLS y las funciones de la base dejan fuera lo que
 * no es suyo. Un grupo que no se pudo leer lo dice: nunca sale como vacío.
 */
export type ClaveGrupo = 'cotizaciones' | 'compras' | 'pagos' | 'reportes' | 'trabajos' | 'cierres' | 'tramites'

export type FilaPorDecidir = {
  id: string
  /** Qué es: el documento con su número. */
  que: string
  /** Lo que lo distingue: cliente, proveedor, monto, código. */
  detalle: string | null
  /** Quién lo pide: el puesto o el área, como lo dice su pantalla. */
  quien: string | null
  /** Desde cuándo espera a Gerencia. */
  desde: string | null
  dias: number | null
  /** El salto a su pantalla, al documento cuando se puede. */
  ruta: string
}

export type GrupoPorDecidir = {
  clave: ClaveGrupo
  titulo: string
  /** El nombre corto, para la cifra de arriba: en media columna del teléfono el largo se partía en tres. */
  corto: string
  /** La pantalla donde se decide. */
  pantalla: { titulo: string; ruta: string }
  /** El verbo del botón de cada fila: lo que se hace allá. */
  accion: string
  /** Lo que es cada fila en la cuenta del grupo: «2 por revisar». */
  cuenta: { uno: string; varios: string }
  /**
   * Las facturas detenidas no son una decisión más: se resuelven aprobando su
   * OC, que ya está en «Compras y servicios». No suman al total de arriba.
   */
  aparte: boolean
  filas: FilaPorDecidir[]
  /** Lo que el grupo dice además de sus filas: los códigos entregados que esperan a otras áreas. */
  nota: string | null
  /** No se pudo leer: la pantalla lo dice y no lo cuenta como cero. */
  sinLeer: boolean
}

type Lectura = Omit<FilaPorDecidir, 'dias'>

/** Lo que lee cada grupo: sus filas y, si hace falta, una nota o el enlace a su pantalla ya filtrado. */
type Leido = { filas: Lectura[]; nota?: string | null; ruta?: string }

/** Una fecha sin hora espera desde el mediodía de Lima: a medianoche UTC caía el día anterior. */
const delDia = (dia: string | null) => (dia ? `${dia.slice(0, 10)}T12:00:00-05:00` : null)

const divisa = (m: string | null): CodigoMoneda => (m === 'USD' ? 'USD' : 'PEN')

/** Si la lectura llegó a su tope, lo dice: la cifra del grupo no puede pasar por el total. */
const siLlegoAlTope = (leidas: number, tope: number) =>
  leidas >= tope ? `Aquí van los ${tope} más antiguos y hay más: la lista completa está en su pantalla.` : null

async function cotizacionesPorRevisar(): Promise<Leido> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_cotizaciones_pdf')
    .select('id, numero, cliente, carroceria, monto_venta, moneda, version, registrado_por_nombre, creado_en, archivo_subido_en')
    .eq('estado', 'POR_REVISAR')
    .order('creado_en')
    .limit(300)
  if (error) throw new Error(`No se pudieron leer las cotizaciones por revisar: ${error.message}`)
  return { nota: siLlegoAlTope(data?.length ?? 0, 300), filas: (data ?? []).flatMap((c) =>
    c.id
      ? [
          {
            id: c.id,
            que: `Cotización ${c.numero ?? 'sin número'}${(c.version ?? 1) > 1 ? ` · versión ${c.version}` : ''}`,
            detalle: [c.cliente, c.carroceria, c.monto_venta === null ? null : moneda(Number(c.monto_venta), divisa(c.moneda))].filter(Boolean).join(' · ') || null,
            quien: c.registrado_por_nombre && c.registrado_por_nombre !== 'Ventas' ? `Ventas · ${c.registrado_por_nombre}` : 'Ventas',
            // La corregida espera desde que se subió su versión nueva.
            desde: c.archivo_subido_en ?? c.creado_en,
            ruta: `/cotizaciones/pdf?estado=POR_REVISAR#${c.id}`,
          },
        ]
      : [],
  ) }
}

/** Las compras y servicios que esperan al puesto que aprueba: se leen como en su pantalla, con su destino. */
async function comprasPorAprobar(): Promise<Leido> {
  const { compras } = await cargarAprobacionCompras({ puestos: false })
  return {
    filas: compras
      .filter((c) => c.aprobacion === 'POR_APROBAR' && c.id)
      .map((c) => ({
        id: `${c.tipo}-${c.id}`,
        que: c.tipo === 'OS' ? `Orden de servicio ${c.nombre}`.trim() : c.nombre,
        detalle: [c.proveedor, destinoDeCompra(c), `${moneda(c.monto, divisa(c.moneda))} sin IGV`].filter(Boolean).join(' · '),
        quien: c.emitida_por,
        desde: c.pedida_en,
        ruta: `/compras/aprobacion#${c.tipo}-${c.id}`,
      })),
  }
}

/**
 * Las facturas de compra con saldo que Tesorería no puede pagar porque alguna de
 * sus OC espera a Gerencia (migración 20261027100000). Se resuelven aprobando la
 * OC: el salto lleva a ella.
 */
async function pagosDetenidos(): Promise<Leido> {
  const supabase = await createClient()
  // Se parte de las OC que esperan a Gerencia: las facturas detenidas son las recientes,
  // y un corte por las más viejas con saldo las dejaba fuera sin avisar.
  const { data: ocs, error: errorOc } = await supabase
    .from('ordenes_compra_materiales')
    .select('id')
    .eq('aprobacion', 'POR_APROBAR')
    .is('anulada_en', null)
  if (errorOc) throw new Error(`No se pudieron leer las compras por aprobar: ${errorOc.message}`)
  const idsOc = (ocs ?? []).map((o) => o.id)
  if (idsOc.length === 0) return { filas: [] }
  const ligadas = new Set<string>()
  for (let i = 0; i < idsOc.length; i += 150) {
    const { data: tanda, error: errorTanda } = await supabase
      .from('adquisiciones_ordenes_compra')
      .select('adquisicion_id')
      .is('quitada_en', null)
      .in('orden_compra_id', idsOc.slice(i, i + 150))
    if (errorTanda) throw new Error(`No se pudieron leer las facturas de las compras por aprobar: ${errorTanda.message}`)
    for (const t of tanda ?? []) ligadas.add(t.adquisicion_id)
  }
  if (ligadas.size === 0) return { filas: [] }
  const { data, error } = await supabase
    .from('v_cuentas_pagar')
    .select('id, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, saldo')
    .in('id', [...ligadas])
    .gt('saldo', 0)
    .order('fecha_emision')
  if (error) throw new Error(`No se pudieron leer las facturas por pagar: ${error.message}`)
  const facturas = (data ?? []).filter((f): f is typeof f & { id: string } => Boolean(f.id))
  const control = await controlDeFacturas(facturas.map((f) => f.id))
  return { filas: facturas.flatMap((f) => {
    const esperan = (control.get(f.id)?.ordenes ?? []).filter((o) => o.aprobacion === 'POR_APROBAR')
    if (esperan.length === 0) return []
    const ocs = esperan.map((o) => nombreDeOc(o))
    return [
      {
        id: f.id,
        que: `Factura ${f.numero_documento ?? ''}`.trim(),
        detalle: [
          f.proveedor,
          `saldo ${moneda(Number(f.saldo ?? 0), divisa(f.moneda))}`,
          f.fecha_vencimiento ? `vence el ${fecha(f.fecha_vencimiento)}` : null,
          `espera que apruebes ${ocs.length === 1 ? 'la' : 'las'} ${ocs.join(', ')}`,
        ]
          .filter(Boolean)
          .join(' · '),
        quien: 'Tesorería, para pagarla',
        desde: delDia(f.fecha_emision),
        ruta: `/compras/aprobacion#OC-${esperan[0].id}`,
      },
    ]
  }) }
}

async function reportesSinVisto(): Promise<Leido> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reportes_diarios')
    .select('id, fecha, codigo_interno, asunto, creado_en, area:areas(nombre)')
    .is('anulado_en', null)
    .is('observado_en', null)
    .is('visto_gerencia_en', null)
    .order('fecha')
    .limit(500)
  if (error) throw new Error(`No se pudieron leer los reportes diarios: ${error.message}`)
  // Su pantalla va por mes: el enlace abre el mes del más antiguo, con lo que falta de Gerencia (como el globo del menú).
  const primero = data?.[0]?.fecha
  const ruta = primero ? `/reportes-diarios?mes=${primero.slice(0, 7)}&estado=falta-gerencia` : undefined
  const filas = (data ?? []).map((r) => {
    const area = (Array.isArray(r.area) ? r.area[0] : r.area)?.nombre ?? null
    return {
      id: r.id,
      que: `Reporte diario del ${fecha(r.fecha)}`,
      detalle: [r.codigo_interno, r.asunto].filter(Boolean).join(' · ') || null,
      quien: area ? `Supervisión de ${area}` : 'Supervisión',
      desde: r.creado_en,
      ruta: `/reportes-diarios/${r.id}`,
    }
  })
  return { filas, ruta, nota: siLlegoAlTope(data?.length ?? 0, 500) }
}

async function trabajosSinOrden(): Promise<Leido> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_flota_avance_diario')
    .select('id, flota_id, fecha, trabajo, placa, unidad, area, registrado_por_nombre, creado_en, corregido_en')
    .eq('revision', 'PENDIENTE')
    .order('creado_en')
    .limit(300)
  if (error) throw new Error(`No se pudieron leer los reportes de los trabajos sin orden: ${error.message}`)
  return { nota: siLlegoAlTope(data?.length ?? 0, 300), filas: (data ?? []).flatMap((t) =>
    t.id && t.flota_id
      ? [
          {
            id: t.id,
            que: `Reporte del ${fecha(t.fecha)} · ${t.placa ?? t.unidad ?? 'trabajo sin orden'}`,
            detalle: t.trabajo,
            quien: [t.area, t.registrado_por_nombre].filter(Boolean).join(' · ') || null,
            // El observado y corregido espera desde que el supervisor lo corrigió, no desde que lo subió.
            desde: t.corregido_en ?? t.creado_en,
            ruta: `/avance/trabajos/${t.flota_id}`,
          },
        ]
      : [],
  ) }
}

/**
 * Los códigos con acta de entrega y el costeo todavía abierto que Gerencia puede
 * cerrar hoy: con la misma regla que el detalle del código (`faltaParaCerrar`).
 * El que espera a Logística, RR. HH. o Contabilidad no es una decisión de
 * Gerencia: no va como fila, solo se cuenta en la nota del grupo.
 */
async function codigosPorCerrar(perfil: PerfilSesion): Promise<Leido> {
  const { codigos } = await leerListaDeCodigos()
  // Sin nada costeado no hay qué congelar: su pantalla tampoco ofrece cerrarlo.
  const entregados = codigos.filter((c) => c.entregada_el && !c.cierre && c.costo_pen > 0 && !noEsUnidad(c.codigo))
  if (entregados.length === 0) return { filas: [] }
  // Lo mismo que lee el detalle del código antes de ofrecer el botón.
  const miraMes = puede(perfil, ['costos.gastos_generales', 'costos.ver'])
  const [delMes, esperas] = await Promise.all([
    miraMes ? repartoDelMes(`${hoyLima().slice(0, 7)}-01`) : Promise.resolve([]),
    Promise.all(entregados.map((c) => Promise.all([mesesSinPagosDeOficina(c.codigo), mesesSinPlanillaDeTaller(c.codigo)]))),
  ])
  const conHorasEsteMes = new Set(delMes.map((r) => r.codigo))
  const listos = entregados.filter((c, i) => {
    const [faltaOficina, faltaPlanilla] = esperas[i]
    return faltaParaCerrar(c, { esperaElMes: conHorasEsteMes.has(c.codigo), faltaOficina, faltaPlanilla }).length === 0
  })
  const listosSet = new Set(listos)
  const esperan = entregados.filter((c) => !listosSet.has(c)).map((c) => c.codigo)
  const cuales = esperan.length > 5 ? `${esperan.slice(0, 5).join(', ')} y ${esperan.length - 5} más` : esperan.join(', ')
  return {
    filas: listos.map((c) => ({
      id: c.codigo,
      que: `Cierre del costeo de ${c.codigo}`,
      detalle: [`entregada el ${fecha(c.entregada_el)}`, `costo hoy ${moneda(c.costo_pen)}`].join(' · '),
      quien: 'Taller, con el acta de entrega',
      desde: delDia(c.entregada_el),
      ruta: `${enlaceCodigo(c.codigo)}#cierre-del-costeo`,
    })),
    nota:
      esperan.length > 0
        ? `${esperan.length === 1 ? `${listos.length > 0 ? 'Otro código entregado' : 'Un código entregado'}, ${cuales}, espera` : `${listos.length > 0 ? 'Otros' : ''} ${esperan.length} códigos entregados (${cuales}) esperan`.trim()} algo de otra área antes de poder cerrarse (precios, horas, la planilla, los pagos de la oficina o que termine el mes): cada código dice qué le falta.`
        : null,
  }
}

/**
 * Los trámites que quien los lleva pidió anular y esperan el visto de quien
 * mira: lo dice la base (`puede_resolver_anulacion`), con la misma regla que
 * `tramites_resolver_anulacion`.
 */
async function tramitesPorAnular(): Promise<Leido> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('tramites_visibles', { p_id: null })
    .select('id, numero, tipo, asunto, placa, cliente, ambito, anulacion_pidio, registro_puesto, anulacion_pedida_en')
    .eq('puede_resolver_anulacion', true)
    .order('anulacion_pedida_en')
    .limit(300)
  if (error) throw new Error(`No se pudieron leer las anulaciones de trámites: ${error.message}`)
  return {
    nota: siLlegoAlTope(data?.length ?? 0, 300),
    filas: (data ?? []).flatMap((t) =>
      t.id
        ? [
            {
              id: t.id,
              que: `Anulación del trámite ${t.numero ?? 'sin número'}`,
              detalle: [t.tipo, t.ambito === 'UNIDAD' ? (t.placa ?? 'Sin placa') : 'De la empresa', t.cliente, t.asunto].filter(Boolean).join(' · ') || null,
              quien: [t.registro_puesto, t.anulacion_pidio].filter(Boolean).join(' · ') || null,
              desde: t.anulacion_pedida_en,
              ruta: `/tramites/${t.id}`,
            },
          ]
        : [],
    ),
  }
}

type DefGrupo = {
  clave: ClaveGrupo
  titulo: string
  corto: string
  pantalla: { titulo: string; ruta: string }
  accion: string
  cuenta: { uno: string; varios: string }
  aparte?: boolean
  /** Si quien mira resuelve este grupo; `async` cuando lo decide la base. */
  resuelve: (perfil: PerfilSesion, aprueba: () => Promise<boolean>) => boolean | Promise<boolean>
  leer: (perfil: PerfilSesion) => Promise<Leido>
}

const GRUPOS: DefGrupo[] = [
  {
    clave: 'cotizaciones',
    corto: 'Cotizaciones',
    titulo: 'Cotizaciones por revisar',
    pantalla: { titulo: 'Cotización', ruta: '/cotizaciones/pdf?estado=POR_REVISAR' },
    accion: 'Revisar',
    cuenta: { uno: 'por revisar', varios: 'por revisar' },
    resuelve: (p) => puede(p, 'cotizaciones.revisar'),
    leer: cotizacionesPorRevisar,
  },
  {
    clave: 'compras',
    corto: 'Compras y servicios',
    titulo: 'Compras y servicios por aprobar',
    pantalla: { titulo: 'Aprobación de compras', ruta: '/compras/aprobacion' },
    accion: 'Aprobar o rechazar',
    cuenta: { uno: 'por aprobar', varios: 'por aprobar' },
    // Quién aprueba lo decide la regla de la base, como en su pantalla.
    resuelve: (_p, aprueba) => aprueba(),
    leer: comprasPorAprobar,
  },
  {
    clave: 'pagos',
    corto: 'Pagos detenidos',
    titulo: 'Pagos detenidos por una OC sin aprobar',
    pantalla: { titulo: 'Aprobación de compras', ruta: '/compras/aprobacion' },
    accion: 'Ver la OC',
    cuenta: { uno: 'factura detenida', varios: 'facturas detenidas' },
    aparte: true,
    resuelve: async (p, aprueba) => puede(p, ['adquisiciones.ver', 'tesoreria.ver_documentos']) && (await aprueba()),
    leer: pagosDetenidos,
  },
  {
    clave: 'reportes',
    corto: 'Reportes diarios',
    titulo: 'Reportes diarios sin tu visto',
    pantalla: { titulo: 'Reporte diario', ruta: '/reportes-diarios?estado=falta-gerencia' },
    accion: 'Dar el visto',
    cuenta: { uno: 'sin tu visto', varios: 'sin tu visto' },
    // El administrador no da el visto de Gerencia (como en los globos del menú).
    resuelve: (p) => p.rol.codigo !== 'ADMIN' && puede(p, 'reporte_diario.validar_gerencia'),
    leer: reportesSinVisto,
  },
  {
    clave: 'trabajos',
    corto: 'Trabajos sin orden',
    titulo: 'Trabajos sin orden por aprobar',
    pantalla: { titulo: 'Trabajos sin orden', ruta: '/avance/trabajos' },
    accion: 'Aprobar u observar',
    cuenta: { uno: 'por aprobar', varios: 'por aprobar' },
    resuelve: (p) => apruebaSinOrden(p),
    leer: trabajosSinOrden,
  },
  {
    clave: 'cierres',
    corto: 'Cierre de códigos',
    titulo: 'Códigos entregados listos para cerrar el costeo',
    pantalla: { titulo: 'Códigos internos', ruta: '/codigos-internos' },
    accion: 'Cerrar el costeo',
    cuenta: { uno: 'listo para cerrar', varios: 'listos para cerrar' },
    resuelve: (p) => puede(p, 'codigos_internos.cerrar'),
    leer: codigosPorCerrar,
  },
  {
    clave: 'tramites',
    corto: 'Trámites por anular',
    titulo: 'Trámites que esperan tu visto para anularse',
    pantalla: { titulo: 'Trámites', ruta: '/tramites?vista=por-anular' },
    accion: 'Aprobar o no',
    cuenta: { uno: 'por anular', varios: 'por anular' },
    // El administrador entra por `es_admin()`: el visto es de quien tiene el permiso.
    resuelve: (p) => p.rol.codigo !== 'ADMIN' && puede(p, 'tramites.aprobar_anulacion'),
    leer: tramitesPorAnular,
  },
]

/**
 * Los grupos que quien mira resuelve, cada uno con lo que espera del más
 * antiguo al más nuevo y sus días contados por la base con la fecha de Lima.
 * Cada grupo averigua si es suyo y lo lee en una sola cadena, todos a la vez;
 * si la base no dice si este puesto aprueba compras, el grupo sale «sin leer»:
 * ni vacío ni leído con otro permiso.
 */
export async function porDecidir(perfil: PerfilSesion): Promise<{ grupos: GrupoPorDecidir[]; diasSinLeer: boolean }> {
  // `es_aprobador_compras` una sola vez, aunque la pregunten dos grupos.
  let aprobador: Promise<boolean> | null = null
  const aprueba = () => (aprobador ??= esAprobadorDeCompras())

  const leidos = (
    await Promise.all(
      GRUPOS.map(async (g) => {
        let resuelve: boolean
        try {
          resuelve = await g.resuelve(perfil, aprueba)
        } catch (e) {
          console.error(`Por decidir: no se pudo saber si quien mira resuelve «${g.titulo}».`, e)
          return { g, leido: { filas: [] } as Leido, sinLeer: true }
        }
        if (!resuelve) return null
        try {
          return { g, leido: await g.leer(perfil), sinLeer: false }
        } catch (e) {
          console.error(`Por decidir: no se pudo leer «${g.titulo}».`, e)
          return { g, leido: { filas: [] } as Leido, sinLeer: true }
        }
      }),
    )
  ).filter((l) => l !== null)

  // Los días de todas las filas en una sola pregunta.
  const todas = leidos.flatMap((l) => l.leido.filas)
  let diasSinLeer = false
  const dias = await diasEnEspera(todas.map((f) => f.desde)).catch((e: unknown) => {
    console.error('Por decidir: no se pudieron contar los días en espera.', e)
    diasSinLeer = todas.length > 0
    return todas.map(() => null)
  })
  let i = 0
  const grupos = leidos.map(({ g, leido, sinLeer }): GrupoPorDecidir => ({
    clave: g.clave,
    titulo: g.titulo,
    corto: g.corto,
    pantalla: { titulo: g.pantalla.titulo, ruta: leido.ruta ?? g.pantalla.ruta },
    accion: g.accion,
    cuenta: g.cuenta,
    aparte: g.aparte ?? false,
    nota: leido.nota ?? null,
    sinLeer,
    filas: leido.filas
      .map((f) => ({ ...f, dias: dias[i++] ?? null }))
      // Lo más antiguo primero; sin hora, al final.
      .sort((a, b) => (a.desde ? Date.parse(a.desde) : Infinity) - (b.desde ? Date.parse(b.desde) : Infinity)),
  }))
  return { grupos, diasSinLeer }
}
