import 'server-only'

import { esAprobadorDeCompras } from '@/lib/datos/aprobacion-compras'
import { leerListaDeCodigos } from '@/lib/datos/codigos-internos'
import { controlDeFacturas } from '@/lib/datos/adquisiciones'
import { diasEnEspera } from '@/lib/datos/dias-en-espera'
import { nombreDeOc } from '@/lib/dominio/adquisiciones'
import { enlaceCodigo, noEsUnidad } from '@/lib/dominio/codigos-internos'
import { fecha, moneda, type CodigoMoneda } from '@/lib/format'
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
export type ClaveGrupo = 'cotizaciones' | 'compras' | 'pagos' | 'reportes' | 'trabajos' | 'cierres'

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
  filas: FilaPorDecidir[]
  /** No se pudo leer: la pantalla lo dice y no lo cuenta como cero. */
  sinLeer: boolean
}

type Lectura = Omit<FilaPorDecidir, 'dias'>

/** Una fecha sin hora espera desde el mediodía de Lima: a medianoche UTC caía el día anterior. */
const delDia = (dia: string | null) => (dia ? `${dia.slice(0, 10)}T12:00:00-05:00` : null)

const divisa = (m: string | null): CodigoMoneda => (m === 'USD' ? 'USD' : 'PEN')

async function cotizacionesPorRevisar(): Promise<Lectura[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_cotizaciones_pdf')
    .select('id, numero, cliente, carroceria, monto_venta, moneda, version, registrado_por_nombre, creado_en, archivo_subido_en')
    .eq('estado', 'POR_REVISAR')
    .limit(300)
  if (error) throw new Error(`No se pudieron leer las cotizaciones por revisar: ${error.message}`)
  return (data ?? []).flatMap((c) =>
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
  )
}

async function comprasPorAprobar(): Promise<Lectura[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('documentos_por_aprobar')
  if (error) throw new Error(`No se pudieron leer las compras por aprobar: ${error.message}`)
  return (data ?? [])
    .filter((d) => d.aprobacion === 'POR_APROBAR' && d.id)
    .map((d) => ({
      id: `${d.tipo}-${d.id}`,
      que: d.tipo === 'OS' ? `Orden de servicio ${d.numero ?? d.referencia ?? ''}`.trim() : nombreDeOc({ numero: d.numero, referencia: d.referencia }),
      detalle: [d.proveedor, moneda(Number(d.monto ?? 0), divisa(d.moneda)) + ' sin IGV'].filter(Boolean).join(' · '),
      quien: d.emitida_por,
      desde: d.pedida_en,
      ruta: `/compras/aprobacion#${d.tipo}-${d.id}`,
    }))
}

/**
 * Las facturas de compra con saldo que Tesorería no puede pagar porque alguna de
 * sus OC espera a Gerencia (migración 20261027100000). Se resuelven aprobando la
 * OC: el salto lleva a ella.
 */
async function pagosDetenidos(): Promise<Lectura[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_cuentas_pagar')
    .select('id, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, saldo')
    .gt('saldo', 0)
    .limit(1000)
  if (error) throw new Error(`No se pudieron leer las facturas por pagar: ${error.message}`)
  const facturas = (data ?? []).filter((f): f is typeof f & { id: string } => Boolean(f.id))
  const control = await controlDeFacturas(facturas.map((f) => f.id))
  return facturas.flatMap((f) => {
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
  })
}

async function reportesSinVisto(): Promise<Lectura[]> {
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
  return (data ?? []).map((r) => {
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
}

async function trabajosSinOrden(): Promise<Lectura[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_flota_avance_diario')
    .select('id, flota_id, fecha, trabajo, placa, unidad, area, registrado_por_nombre, creado_en')
    .eq('revision', 'PENDIENTE')
    .limit(300)
  if (error) throw new Error(`No se pudieron leer los reportes de los trabajos sin orden: ${error.message}`)
  return (data ?? []).flatMap((t) =>
    t.id && t.flota_id
      ? [
          {
            id: t.id,
            que: `Reporte del ${fecha(t.fecha)} · ${t.placa ?? t.unidad ?? 'trabajo sin orden'}`,
            detalle: t.trabajo,
            quien: [t.area, t.registrado_por_nombre].filter(Boolean).join(' · ') || null,
            desde: t.creado_en,
            ruta: `/avance/trabajos/${t.flota_id}`,
          },
        ]
      : [],
  )
}

/** Los códigos con acta de entrega y el costeo todavía abierto: Gerencia lo cierra. */
async function codigosPorCerrar(): Promise<Lectura[]> {
  const { codigos } = await leerListaDeCodigos()
  return codigos
    // Sin nada costeado no hay qué congelar: su pantalla tampoco ofrece cerrarlo.
    .filter((c) => c.entregada_el && !c.cierre && c.costo_pen > 0 && !noEsUnidad(c.codigo))
    .map((c) => {
      const falta = c.materiales_sin_precio + c.horas_sin_costo + c.lineas_sin_cambio > 0
      return {
        id: c.codigo,
        que: `Cierre del costeo de ${c.codigo}`,
        detalle: [`entregada el ${fecha(c.entregada_el)}`, `costo hoy ${moneda(c.costo_pen)}`, falta ? 'con el costo incompleto' : null]
          .filter(Boolean)
          .join(' · '),
        quien: 'Taller, con el acta de entrega',
        desde: delDia(c.entregada_el),
        ruta: enlaceCodigo(c.codigo),
      }
    })
}

const GRUPOS: {
  clave: ClaveGrupo
  titulo: string
  corto: string
  pantalla: { titulo: string; ruta: string }
  accion: string
  /** Si quien mira resuelve este grupo; `async` cuando lo decide la base. */
  resuelve: (perfil: PerfilSesion) => boolean | Promise<boolean>
  leer: () => Promise<Lectura[]>
}[] = [
  {
    clave: 'cotizaciones',
    corto: 'Cotizaciones',
    titulo: 'Cotizaciones por revisar',
    pantalla: { titulo: 'Cotización', ruta: '/cotizaciones/pdf?estado=POR_REVISAR' },
    accion: 'Revisar',
    resuelve: (p) => puede(p, 'cotizaciones.revisar'),
    leer: cotizacionesPorRevisar,
  },
  {
    clave: 'compras',
    corto: 'Compras y servicios',
    titulo: 'Compras y servicios por aprobar',
    pantalla: { titulo: 'Aprobación de compras', ruta: '/compras/aprobacion' },
    accion: 'Aprobar o rechazar',
    // Quién aprueba lo decide la regla de la base, como en su pantalla.
    resuelve: () => esAprobadorDeCompras(),
    leer: comprasPorAprobar,
  },
  {
    clave: 'pagos',
    corto: 'Pagos detenidos',
    titulo: 'Pagos detenidos por una OC sin aprobar',
    pantalla: { titulo: 'Aprobación de compras', ruta: '/compras/aprobacion' },
    accion: 'Ver la OC',
    resuelve: async (p) => puede(p, ['adquisiciones.ver', 'tesoreria.ver_documentos']) && (await esAprobadorDeCompras()),
    leer: pagosDetenidos,
  },
  {
    clave: 'reportes',
    corto: 'Reportes diarios',
    titulo: 'Reportes diarios sin tu visto',
    pantalla: { titulo: 'Reporte diario', ruta: '/reportes-diarios?estado=por-validar' },
    accion: 'Dar el visto',
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
    resuelve: (p) => apruebaSinOrden(p),
    leer: trabajosSinOrden,
  },
  {
    clave: 'cierres',
    corto: 'Cierre de códigos',
    titulo: 'Códigos entregados con el costeo abierto',
    pantalla: { titulo: 'Códigos internos', ruta: '/codigos-internos' },
    accion: 'Cerrar el costeo',
    resuelve: (p) => puede(p, 'codigos_internos.cerrar'),
    leer: codigosPorCerrar,
  },
]

/** Las claves que este puesto puede resolver, sin leer nada más (para saber si entra a la pantalla). */
export const PERMISOS_POR_DECIDIR = [
  'cotizaciones.revisar',
  'compras.configurar_aprobacion',
  'reporte_diario.validar_gerencia',
  'produccion.aprobar_sin_orden',
  'codigos_internos.cerrar',
]

/**
 * Los grupos que quien mira resuelve, cada uno con lo que espera del más
 * antiguo al más nuevo y sus días contados por la base con la fecha de Lima.
 */
export async function porDecidir(perfil: PerfilSesion): Promise<{ grupos: GrupoPorDecidir[]; diasSinLeer: boolean }> {
  // Si la base no dice si este puesto aprueba compras, el grupo sale «sin leer»: ni vacío ni leído con otro permiso.
  const suyos = (
    await Promise.all(
      GRUPOS.map(async (g) => {
        const resuelve = await Promise.resolve(g.resuelve(perfil)).catch((e: unknown) => {
          console.error(`Por decidir: no se pudo saber si quien mira resuelve «${g.titulo}».`, e)
          return 'sin-saber' as const
        })
        return resuelve ? { g, sinSaber: resuelve === 'sin-saber' } : null
      }),
    )
  ).filter((s): s is { g: (typeof GRUPOS)[number]; sinSaber: boolean } => s !== null)

  const leidos = await Promise.all(
    suyos.map(async ({ g, sinSaber }) => {
      if (sinSaber) return { g, filas: [] as Lectura[], sinLeer: true }
      try {
        return { g, filas: await g.leer(), sinLeer: false }
      } catch (e) {
        console.error(`Por decidir: no se pudo leer «${g.titulo}».`, e)
        return { g, filas: [] as Lectura[], sinLeer: true }
      }
    }),
  )

  // Los días de todas las filas en una sola pregunta.
  const todas = leidos.flatMap((l) => l.filas)
  let diasSinLeer = false
  const dias = await diasEnEspera(todas.map((f) => f.desde)).catch((e: unknown) => {
    console.error('Por decidir: no se pudieron contar los días en espera.', e)
    diasSinLeer = todas.length > 0
    return todas.map(() => null)
  })
  let i = 0
  const grupos = leidos.map(({ g, filas, sinLeer }) => ({
    clave: g.clave,
    titulo: g.titulo,
    corto: g.corto,
    pantalla: g.pantalla,
    accion: g.accion,
    sinLeer,
    filas: filas
      .map((f) => ({ ...f, dias: dias[i++] ?? null }))
      // Lo más antiguo primero; sin hora, al final.
      .sort((a, b) => (a.desde ? Date.parse(a.desde) : Infinity) - (b.desde ? Date.parse(b.desde) : Infinity)),
  }))
  return { grupos, diasSinLeer }
}
