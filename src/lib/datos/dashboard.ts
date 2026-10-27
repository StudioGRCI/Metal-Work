import 'server-only'

import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  Banknote,
  Boxes,
  CalendarClock,
  CarFront,
  ClipboardList,
  Clock,
  Coins,
  DraftingCompass,
  FileText,
  HandCoins,
  Handshake,
  Hash,
  Landmark,
  Layers,
  ListChecks,
  PackageCheck,
  Receipt,
  ReceiptText,
  Route,
  Truck,
  UserCheck,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react'

import type { TonoIndicador } from '@/components/ui/indicador'
import { leerListaDeCodigos, sumarCodigosDeDiseno } from '@/lib/datos/codigos-internos'
import { codigosDeDiseno, etapasDeCodigo, planosDeCodigo } from '@/lib/datos/diseno-codigos'
import { listarGastoPorCodigo } from '@/lib/datos/gasto-por-codigo'
import { consolidado, sumaEnLaCaja } from '@/lib/dominio/caja'
import { CODIGO_SIN_AVANCE, costoDelCodigo, enlaceCodigo } from '@/lib/dominio/codigos-internos'
import { faltaDelServicio } from '@/lib/dominio/detraccion'
import { estadoDeReporte } from '@/lib/dominio/reporte-diario'
import { ESTADOS_RQ_ABIERTOS, type TipoRequerimiento } from '@/lib/dominio/requerimientos'
import { hoyLima, moneda, numero, parteDe, porcentaje, sumarDias } from '@/lib/format'
import { menuDe } from '@/lib/navegacion'
import { puede, puedeHojaDeArea, type PerfilSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Las cifras clave del dashboard de cada puesto: lo que dice cómo va su área, cada una con el enlace a la pantalla donde se mira o
 * se atiende. Cada puesto tiene las suyas (`CIFRAS_POR_PUESTO`), en el orden de
 * su trabajo, como su menú.
 *
 * Dos reglas para no abrir lo que el puesto no ve:
 *   1. Una cifra sale solo si la pantalla a la que lleva está en el menú del
 *      puesto, que ya se filtra por su permiso. Es la misma regla de los globos
 *      del menú.
 *   2. Todo se lee con la sesión de quien mira: el RLS y las funciones de la
 *      base filtran lo que no es suyo. Ningún monto sale de una lectura que el
 *      puesto no podría hacer en su pantalla.
 *
 * Una lectura que falla no tumba el dashboard: su cifra sale con «—» y lo dice.
 */
export type Cifra = {
  clave: string
  titulo: string
  valor: string
  pie?: string
  href: string
  tono?: TonoIndicador
  icono?: LucideIcon
}

/** Un código con movimiento, para la lista corta de Gerencia. */
export type CodigoEnCurso = { codigo: string; href: string; /** null: no lleva avance (PLANTA). */ avance: number | null; costo: string | null; ultima: string | null }

export type DashboardDelPuesto = {
  /** El nombre del bloque: «Tu área», «Logística»… */
  titulo: string
  cifras: Cifra[]
  /** Gerencia: los códigos que se movieron hace poco, con su avance y su costo. */
  codigos: CodigoEnCurso[] | null
}

type Contexto = {
  perfil: PerfilSesion
  supabase: Awaited<ReturnType<typeof createClient>>
  hoy: string
  /** El día 1 del mes en curso (YYYY-MM-DD). */
  mes: string
  /** Una vez por lectura: varias cifras salen de la misma lista. */
  una: <T>(clave: string, leer: () => Promise<T>) => Promise<T>
}

type Generador = {
  ruta: string
  /** Si devuelve null, la cifra no aplica a este puesto (y no se muestra). */
  calcular: (c: Contexto) => Promise<Omit<Cifra, 'clave' | 'href'> & { href?: string } | null>
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const num = (v: number | string | null | undefined) => Number(v ?? 0)

/** «S/ 1 200,00»; con dólares, en el pie. */
function soles(pen: number, usd: number, pie?: string) {
  const extra = usd > 0 ? `y ${moneda(usd, 'USD')}` : null
  return { valor: moneda(pen), pie: [extra, pie].filter(Boolean).join(' · ') || undefined }
}

function fallo(lectura: { error: unknown }) {
  if (lectura.error) throw new Error('No se pudo leer la cifra.')
}

/**
 * Todas las filas de una lectura, de a 1000: lo que el servicio entrega por
 * consulta aunque se pida más. Para las cifras que suman dinero, que con un
 * tope salían cortas sin avisar en cuanto había más de mil documentos.
 */
async function todas<T>(
  leer: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: null }> {
  const filas: T[] = []
  for (let desde = 0; ; desde += 1000) {
    const r = await leer(desde, desde + 999)
    fallo(r)
    filas.push(...(r.data ?? []))
    if ((r.data ?? []).length < 1000) return { data: filas, error: null }
  }
}

// ── Las lecturas compartidas ────────────────────────────────────────────────

const rqAbiertos = (c: Contexto) =>
  c.una('rq', async () => {
    const r = await c.supabase.from('requerimientos').select('estado, tipo, area_id').in('estado', [...ESTADOS_RQ_ABIERTOS]).limit(1000)
    fallo(r)
    return r.data ?? []
  })

/** Los RQ que lleva este puesto: Requerimientos los de operación; la administradora los suyos; el supervisor los de su área. */
function rqDelPuesto<T extends { tipo: string | null; area_id: string | null }>(c: Contexto, filas: T[]): T[] {
  const tipos: TipoRequerimiento[] = [
    ...(puede(c.perfil, 'requerimientos.emitir') ? (['OPERACION'] as const) : []),
    ...(puede(c.perfil, 'requerimientos.administracion') ? (['ADMINISTRACION'] as const) : []),
  ]
  return filas.filter((r) => {
    if (c.perfil.rol.codigo === 'SUPERVISOR') return r.area_id === c.perfil.area_id
    if (tipos.length === 1) return (r.tipo === 'ADMINISTRACION' ? 'ADMINISTRACION' : 'OPERACION') === tipos[0]
    return true
  })
}

const enGestion = (c: Contexto) =>
  c.una('gestion', async () => {
    const r = await c.supabase.rpc('compras_en_gestion')
    fallo(r)
    return r.data ?? []
  })

const ordenesDeCompra = (c: Contexto) =>
  c.una('oc', async () => {
    const r = await c.supabase.rpc('ordenes_compra_listado')
    fallo(r)
    return r.data ?? []
  })

const deDiseno = (c: Contexto) => c.una('diseno', () => codigosDeDiseno())

const trabajadoresActivos = (c: Contexto) =>
  c.una('personal', async () => {
    const r = await c.supabase.from('trabajadores').select('id', { count: 'exact', head: true }).eq('activo', true)
    fallo(r)
    return r.count ?? 0
  })

const marcasDeHoy = (c: Contexto) =>
  c.una('marcas', async () => {
    const r = await c.supabase.from('asistencias').select('trabajador_id, tipo, es_tardanza').eq('fecha', c.hoy).is('anulado_en', null).limit(1000)
    fallo(r)
    return r.data ?? []
  })

const bajoMinimo = (c: Contexto) =>
  c.una('minimo', async () => {
    const [minimos, existencias] = await Promise.all([
      c.supabase.from('materiales').select('id, stock_minimo').not('stock_minimo', 'is', null).eq('activo', true).limit(5000),
      c.supabase.from('v_existencias_materiales').select('material_id, existencia').limit(5000),
    ])
    fallo(minimos)
    fallo(existencias)
    const saldo = new Map((existencias.data ?? []).map((e) => [e.material_id, num(e.existencia)]))
    const conSaldo = (existencias.data ?? []).filter((e) => num(e.existencia) > 0).length
    // Como en el kardex: cuenta el que tiene kardex y quedó por debajo de su mínimo.
    const bajo = (minimos.data ?? []).filter((m) => saldo.has(m.id) && (saldo.get(m.id) ?? 0) < num(m.stock_minimo)).length
    return { bajo, conSaldo }
  })

// ── El catálogo de cifras ───────────────────────────────────────────────────

const CIFRAS = {
  // Requerimientos
  rq_abiertos: {
    ruta: '/requerimientos',
    calcular: async (c) => {
      const mios = rqDelPuesto(c, await rqAbiertos(c))
      const listos = mios.filter((r) => r.estado === 'LISTO_EN_ALMACEN').length
      return {
        titulo: c.perfil.rol.codigo === 'SUPERVISOR' ? 'Requerimientos de tu área' : 'Requerimientos abiertos',
        valor: String(mios.length),
        pie: listos > 0 ? `${plural(listos, 'listo', 'listos')} en almacén` : 'ninguno listo en almacén',
        icono: ClipboardList,
        tono: mios.length > 0 ? 'acento' : 'neutro',
      }
    },
  },
  rq_por_comprar: {
    ruta: '/requerimientos',
    calcular: async (c) => {
      const mios = rqDelPuesto(c, await rqAbiertos(c))
      const sinStock = mios.filter((r) => r.estado === 'SIN_STOCK').length
      const enCompra = mios.filter((r) => r.estado === 'EN_ATENCION').length
      return { titulo: 'Esperan compra', valor: String(sinStock + enCompra), pie: `${sinStock} sin stock · ${enCompra} en compra`, icono: Truck }
    },
  },
  rq_en_compra: {
    ruta: '/requerimientos/atencion',
    calcular: async (c) => {
      const todos = await rqAbiertos(c)
      const sinStock = todos.filter((r) => r.estado === 'SIN_STOCK').length
      const enCompra = todos.filter((r) => r.estado === 'EN_ATENCION').length
      return { titulo: 'Por llegar al almacén', valor: String(sinStock + enCompra), pie: `${enCompra} en compra · ${sinStock} por comprar`, icono: Truck }
    },
  },
  gasto_por_codigo: {
    ruta: '/requerimientos/gasto-por-codigo',
    calcular: async (c) => {
      const codigos = await c.una('gasto', () => listarGastoPorCodigo())
      const pen = codigos.reduce((n, g) => n + g.materiales_pen, 0)
      const usd = codigos.reduce((n, g) => n + g.materiales_usd, 0)
      // Cuenta los códigos de los que salió algo; la lista trae también los que solo tienen un RQ o una compra.
      const conSalidas = codigos.filter((g) => g.salidas > 0 || g.materiales_pen !== 0 || g.materiales_usd !== 0).length
      return { titulo: 'Salido del almacén por código', ...soles(pen, usd, `en ${plural(conSalidas, 'código', 'códigos')}`), icono: Hash }
    },
  },

  // Vehículos
  vehiculos_en_planta: {
    ruta: '/vehiculos',
    calcular: async (c) => {
      const r = await c.supabase.from('registro_vehiculos').select('id', { count: 'exact', head: true }).is('salida_en', null).is('anulado_en', null)
      fallo(r)
      return { titulo: 'Vehículos en la planta', valor: String(r.count ?? 0), pie: 'entraron y no han salido', icono: CarFront }
    },
  },

  // Almacén
  bajo_minimo: {
    ruta: '/almacen/kardex',
    calcular: async (c) => {
      const { bajo } = await bajoMinimo(c)
      return { titulo: 'Bajo su stock mínimo', valor: String(bajo), pie: bajo > 0 ? 'materiales por reponer' : 'todo sobre su mínimo', icono: AlertTriangle, tono: bajo > 0 ? 'peligro' : 'exito' }
    },
  },
  materiales_con_saldo: {
    ruta: '/almacen/kardex',
    calcular: async (c) => {
      const { conSaldo } = await bajoMinimo(c)
      return { titulo: 'Materiales con saldo', valor: String(conSaldo), pie: 'en los cuatro almacenes', icono: Boxes }
    },
  },
  salidas_del_mes: {
    ruta: '/almacen/kardex',
    calcular: async (c) => {
      const r = await c.supabase
        .from('v_kardex_almacen')
        .select('id', { count: 'exact', head: true })
        .in('movimiento', ['DESPACHO', 'SALIDA'])
        .gte('fecha', c.mes)
      fallo(r)
      return { titulo: 'Salidas este mes', valor: String(r.count ?? 0), pie: 'despachos y salidas del kardex', icono: Route }
    },
  },

  // Logística
  oc_por_aprobar: {
    ruta: '/compras/ordenes',
    calcular: async (c) => {
      const oc = (await ordenesDeCompra(c)).filter((o) => o.aprobacion === 'POR_APROBAR')
      return { titulo: 'OC en Gerencia', valor: String(oc.length), pie: 'esperan su aprobación', icono: Clock, tono: oc.length > 0 ? 'aviso' : 'neutro' }
    },
  },
  compras_del_mes: {
    ruta: '/compras/ordenes',
    calcular: async (c) => {
      const delMes = (await ordenesDeCompra(c)).filter(
        (o) => o.creado_en && o.creado_en.slice(0, 10) >= c.mes && o.aprobacion !== 'RECHAZADA' && o.aprobacion !== 'ANULADA',
      )
      // Todo en soles al cambio de su fecha, como en la lista; sin cambio, en su moneda.
      const pen = delMes.reduce((n, o) => n + num(o.monto_pen ?? (o.moneda === 'USD' ? 0 : o.monto)), 0)
      const sinCambio = delMes.filter((o) => o.moneda === 'USD' && o.monto_pen === null).reduce((n, o) => n + num(o.monto), 0)
      return { titulo: 'Comprado este mes', ...soles(pen, sinCambio, plural(delMes.length, 'orden de compra', 'órdenes de compra')), icono: Wallet }
    },
  },
  en_recojo: {
    ruta: '/compras/gestion',
    calcular: async (c) => {
      const lista = await enGestion(c)
      const enCamino = lista.filter((g) => g.recojo === 'EN_RECOJO' || g.recojo === 'RECOGIDO').length
      const programadas = lista.filter((g) => g.recojo === 'POR_RECOGER' && g.en_lista).length
      return { titulo: 'Con el conductor', valor: String(enCamino + programadas), pie: `${programadas} programadas · ${enCamino} en camino`, icono: Truck }
    },
  },
  os_abiertas: {
    ruta: '/compras/servicios',
    calcular: async (c) => {
      const r = await c.supabase.rpc('ordenes_servicio_listado')
      fallo(r)
      const abiertas = (r.data ?? []).filter((s) => s.estado === 'EMITIDA' || s.estado === 'EN_EJECUCION')
      const atrasadas = abiertas.filter((s) => s.atrasada).length
      return {
        titulo: 'Servicios en curso',
        valor: String(abiertas.length),
        pie: atrasadas > 0 ? plural(atrasadas, 'atrasado', 'atrasados') : 'ninguno atrasado',
        icono: Wrench,
        tono: atrasadas > 0 ? 'aviso' : 'neutro',
      }
    },
  },

  // Conductor
  por_recoger: {
    ruta: '/recojos',
    calcular: async (c) => {
      const lista = await enGestion(c)
      const n = lista.filter((g) => g.recojo === 'POR_RECOGER' && g.en_lista).length
      return { titulo: 'Por recoger', valor: String(n), pie: 'en tu lista de hoy', icono: ListChecks, tono: n > 0 ? 'acento' : 'neutro' }
    },
  },
  en_camino: {
    ruta: '/recojos',
    calcular: async (c) => {
      const n = (await enGestion(c)).filter((g) => g.recojo === 'EN_RECOJO' || g.recojo === 'RECOGIDO').length
      return { titulo: 'En camino', valor: String(n), pie: 'por dejar en almacén', icono: Truck }
    },
  },
  dejadas_del_mes: {
    ruta: '/recojos',
    calcular: async (c) => {
      const n = (await enGestion(c)).filter((g) => g.dejado_en && g.dejado_en.slice(0, 10) >= c.mes).length
      return { titulo: 'Dejadas este mes', valor: String(n), pie: 'en el almacén', icono: PackageCheck }
    },
  },

  // Gerencia: los códigos internos
  codigos_en_trabajo: {
    // Cuenta abiertos y cerrados: la lista, también.
    ruta: '/codigos-internos?costeo=todos',
    calcular: async (c) => {
      // Con los que solo tienen planos o etapas de Diseño, como la lista.
      const lista = await c.una('codigos', () => leerListaDeCodigos())
      const codigos = sumarCodigosDeDiseno(lista.codigos, lista.diseno)
      const desde = sumarDias(c.hoy, -30)
      const activos = codigos.filter((k) => k.ultima_actividad && k.ultima_actividad.slice(0, 10) >= desde).length
      return { titulo: 'Códigos con movimiento', valor: String(activos), pie: `en 30 días · ${codigos.length} en total`, icono: Hash, tono: 'acento' }
    },
  },
  costo_de_codigos: {
    // La tarjeta suma abiertos y cerrados: la lista, también.
    ruta: '/codigos-internos?costeo=todos&ver=costo',
    calcular: async (c) => {
      const { codigos } = await c.una('codigos', () => leerListaDeCodigos())
      const pen = codigos.reduce((n, k) => n + costoDelCodigo(k).pen, 0)
      const usd = codigos.reduce((n, k) => n + costoDelCodigo(k).usd, 0)
      // Contra el presupuesto de los que lo tienen: el mismo «% gastado» de cada código, sumado.
      const conPresupuesto = codigos.filter((k) => k.venta?.presupuesto_pen)
      const presupuesto = conPresupuesto.reduce((n, k) => n + (k.venta?.presupuesto_pen ?? 0), 0)
      const gastadoConPresupuesto = conPresupuesto.reduce((n, k) => n + costoDelCodigo(k).pen, 0)
      const parte = parteDe(gastadoConPresupuesto, presupuesto)
      const pie = [
        usd > 0 ? `y ${moneda(usd, 'USD')} sin tipo de cambio` : null,
        parte === null
          ? 'todo lo que suma cada código, en soles'
          : `${porcentaje(parte)} del presupuesto de ${moneda(presupuesto)} (${plural(conPresupuesto.length, 'código con cotización', 'códigos con cotización')})`,
      ]
        .filter(Boolean)
        .join(' · ')
      return { titulo: 'Costo acumulado', valor: moneda(pen), pie, icono: Coins }
    },
  },
  codigos_por_completar: {
    ruta: '/codigos-internos?costeo=todos&ver=por-completar',
    calcular: async (c) => {
      const { codigos } = await c.una('codigos', () => leerListaDeCodigos())
      const n = codigos.filter((k) => k.horas_sin_costo > 0 || k.materiales_sin_precio > 0 || k.compras_sin_precio > 0 || k.lineas_sin_cambio > 0).length
      return { titulo: 'Costo por completar', valor: String(n), pie: 'horas sin costo, materiales sin precio o dólares sin cambio', icono: AlertTriangle, tono: n > 0 ? 'aviso' : 'exito' }
    },
  },
  facturado_y_cobrado: {
    ruta: '/codigos-internos?costeo=todos',
    calcular: async (c) => {
      const r = await todas((d, h) => c.supabase.from('v_facturas_venta').select('moneda, total, cobrado, saldo, cancelada').is('anulada_en', null).order('id').range(d, h))
      fallo(r)
      const pen = (r.data ?? []).filter((f) => f.moneda !== 'USD')
      const facturado = pen.reduce((n, f) => n + num(f.total), 0)
      const cobrado = pen.reduce((n, f) => n + num(f.cobrado), 0)
      const parte = parteDe(cobrado, facturado)
      return {
        titulo: 'Facturado',
        valor: moneda(facturado),
        pie: parte === null ? 'nada facturado todavía' : `cobrado ${moneda(cobrado)} (${porcentaje(parte)}) · por cobrar ${moneda(facturado - cobrado)}`,
        icono: ReceiptText,
      }
    },
  },

  // Tesorería
  // Lo primero que abre Tesorería: cuánto hay hoy en sus cuentas y si quedó un día sin cerrar.
  caja_de_hoy: {
    ruta: '/tesoreria/caja-diaria',
    calcular: async (c) => {
      const [cuentas, cambio] = await Promise.all([
        c.supabase.rpc('caja_del_dia', { p_fecha: c.hoy }),
        c.supabase.rpc('cambio_del_dia', { p_fecha: c.hoy, p_operacion: 'COMPRA' }),
      ])
      fallo(cuentas)
      fallo(cambio)
      const todas = (cuentas.data ?? []).filter((k) => k.caja_id)
      // Las mismas que suma la caja diaria.
      const filas = todas.filter((k) => sumaEnLaCaja(k, c.hoy))
      if (filas.length === 0) {
        return todas.length > 0
          ? // Una cuenta no puede empezar después de hoy: si ninguna suma, todas están desactivadas y en cero.
            { titulo: 'Caja de hoy', valor: 'Sin cuentas activas', pie: 'Todas las cuentas están desactivadas', icono: Landmark, tono: 'aviso' }
          : { titulo: 'Caja de hoy', valor: 'Sin cuentas', pie: 'Da de alta las cuentas de la caja', icono: Landmark, tono: 'aviso' }
      }
      const total = consolidado(
        filas.map((k) => ({ moneda: k.moneda ?? 'PEN', saldo_final: k.saldo_final === null ? null : num(k.saldo_final) })),
        cambio.data === null ? null : num(cambio.data),
      )
      // Como el aviso «Días sin cerrar» de la caja: de todas las cuentas.
      const sinCerrar = todas.filter((k) => k.primer_dia_sin_cerrar && k.primer_dia_sin_cerrar < c.hoy).length
      // Los dólares nunca se callan: pasados a soles, o aparte si falta el cambio.
      const dolares =
        total.dolares === 0
          ? null
          : total.totalEnSoles !== null
            ? `Con los dólares a ${numero(num(cambio.data), 3)}`
            : `y ${moneda(total.dolares, 'USD')}, falta el cambio de hoy`
      const pie = [dolares, sinCerrar > 0 ? plural(sinCerrar, 'cuenta con días sin cerrar', 'cuentas con días sin cerrar') : plural(filas.length, 'cuenta', 'cuentas')]
        .filter(Boolean)
        .join(' · ')
      return {
        titulo: 'Caja de hoy',
        valor: moneda(total.totalEnSoles ?? total.soles),
        pie,
        icono: Landmark,
        tono: sinCerrar > 0 ? 'aviso' : 'neutro',
      }
    },
  },
  por_cobrar: {
    ruta: '/tesoreria/por-cobrar',
    calcular: async (c) => {
      const r = await todas((d, h) =>
        c.supabase.from('v_facturas_venta').select('moneda, total, saldo, cancelada, fecha_vencimiento').is('anulada_en', null)
          .eq('cancelada', false).gt('saldo', 0).order('id').range(d, h))
      fallo(r)
      const pendientes = (r.data ?? []).filter((f) => !f.cancelada && num(f.saldo) > 0)
      const vencidas = pendientes.filter((f) => f.fecha_vencimiento && f.fecha_vencimiento < c.hoy).length
      const enSoles = pendientes.filter((f) => f.moneda !== 'USD')
      const saldoPen = enSoles.reduce((n, f) => n + num(f.saldo), 0)
      // Qué parte de lo facturado en esas facturas falta cobrar: el saldo contra su total.
      const parte = parteDe(saldoPen, enSoles.reduce((n, f) => n + num(f.total), 0))
      return {
        titulo: 'Por cobrar',
        ...soles(
          saldoPen,
          pendientes.filter((f) => f.moneda === 'USD').reduce((n, f) => n + num(f.saldo), 0),
          [
            vencidas > 0 ? plural(vencidas, 'factura vencida', 'facturas vencidas') : plural(pendientes.length, 'factura', 'facturas'),
            parte === null ? null : `falta cobrar el ${porcentaje(parte)} de esas facturas`,
          ]
            .filter(Boolean)
            .join(' · '),
        ),
        icono: HandCoins,
        tono: vencidas > 0 ? 'aviso' : 'neutro',
      }
    },
  },
  por_pagar: {
    ruta: '/tesoreria/por-pagar',
    calcular: async (c) => {
      const [r, espera] = await Promise.all([
        todas((d, h) => c.supabase.from('v_cuentas_pagar').select('id, moneda, total, saldo, fecha_vencimiento').gt('saldo', 0).order('id').range(d, h)),
        c.supabase.rpc('facturas_en_espera', {}),
      ])
      fallo(r)
      fallo(espera)
      // La que espera a Contabilidad pudo pagarse fuera: no suma hasta que lo diga (migración 20261022175000).
      const esperan = new Set((espera.data ?? []).map((e) => e.adquisicion_id))
      const filas = (r.data ?? []).filter((f) => !esperan.has(f.id))
      const vencidas = filas.filter((f) => f.fecha_vencimiento && f.fecha_vencimiento < c.hoy).length
      const enSoles = filas.filter((f) => f.moneda !== 'USD')
      const saldoPen = enSoles.reduce((n, f) => n + num(f.saldo), 0)
      const parte = parteDe(saldoPen, enSoles.reduce((n, f) => n + num(f.total), 0))
      return {
        titulo: 'Por pagar',
        ...soles(
          saldoPen,
          filas.filter((f) => f.moneda === 'USD').reduce((n, f) => n + num(f.saldo), 0),
          [
            vencidas > 0 ? plural(vencidas, 'factura vencida', 'facturas vencidas') : plural(filas.length, 'factura', 'facturas'),
            parte === null ? null : `falta pagar el ${porcentaje(parte)} de esas facturas`,
          ]
            .filter(Boolean)
            .join(' · '),
        ),
        icono: Banknote,
        tono: vencidas > 0 ? 'peligro' : 'neutro',
      }
    },
  },
  servicios_por_pagar: {
    ruta: '/tesoreria/pagos-de-servicio',
    calcular: async (c) => {
      const r = await c.supabase.rpc('servicios_por_pagar')
      fallo(r)
      const pendientes = (r.data ?? []).filter((s) => !s.cancelada)
      // Lo que falta de cada una, con IGV y con su detracción (migración 20261026100000).
      const ids = pendientes.flatMap((s) => (s.id ? [s.id] : []))
      const saldos = ids.length ? await c.supabase.rpc('saldos_de_servicios', { p_ids: ids }) : { data: [], error: null }
      fallo(saldos)
      const falta = (s: NonNullable<typeof saldos.data>[number]) =>
        faltaDelServicio({
          total: num(s.total), detraccion: num(s.detraccion), detraccionEnMoneda: num(s.detraccion_en_moneda), alProveedor: num(s.al_proveedor),
          pagadoProveedor: num(s.pagado_proveedor), pagadoDetraccion: num(s.pagado_detraccion),
          saldoProveedor: num(s.saldo_proveedor), saldoDetraccion: num(s.saldo_detraccion),
        })
      const filas = saldos.data ?? []
      const saldo = (m: string) => filas.filter((s) => (s.moneda === 'USD') === (m === 'USD')).reduce((n, s) => n + falta(s), 0)
      return { titulo: 'Servicios por pagar', ...soles(saldo('PEN'), saldo('USD'), plural(pendientes.length, 'orden de servicio', 'órdenes de servicio')), icono: Wrench }
    },
  },
  recibos_por_pagar: {
    ruta: '/tesoreria/recibos-por-honorarios',
    calcular: async (c) => {
      const r = await c.supabase
        .from('recibos_honorarios')
        .select('moneda, monto_neto, pagos:pagos_recibo_honorarios!pagos_recibo_honorarios_recibo_id_fkey(anulado_en)')
        .is('anulado_en', null)
        .limit(1000)
      fallo(r)
      const pagos = (f: { pagos: unknown }) => ([] as { anulado_en: string | null }[]).concat((f.pagos ?? []) as never)
      const pendientes = (r.data ?? []).filter((f) => !pagos(f).some((p) => !p.anulado_en))
      return {
        titulo: 'Honorarios por pagar',
        ...soles(
          pendientes.filter((f) => f.moneda !== 'USD').reduce((n, f) => n + num(f.monto_neto), 0),
          pendientes.filter((f) => f.moneda === 'USD').reduce((n, f) => n + num(f.monto_neto), 0),
          `${plural(pendientes.length, 'recibo', 'recibos')}, por su neto`,
        ),
        icono: Handshake,
      }
    },
  },

  // Contabilidad
  facturado_del_mes: {
    ruta: '/contabilidad/facturacion',
    calcular: async (c) => {
      const r = await todas((d, h) => c.supabase.from('v_facturas_venta').select('moneda, total').is('anulada_en', null).gte('fecha_emision', c.mes).order('id').range(d, h))
      fallo(r)
      const filas = r.data ?? []
      return {
        titulo: 'Facturado este mes',
        ...soles(
          filas.filter((f) => f.moneda !== 'USD').reduce((n, f) => n + num(f.total), 0),
          filas.filter((f) => f.moneda === 'USD').reduce((n, f) => n + num(f.total), 0),
          plural(filas.length, 'factura de venta', 'facturas de venta'),
        ),
        icono: ReceiptText,
      }
    },
  },
  adquisiciones_del_mes: {
    ruta: '/adquisiciones?vista=facturas',
    calcular: async (c) => {
      const r = await c.supabase.from('adquisiciones').select('id', { count: 'exact', head: true }).gte('creado_en', c.mes)
      fallo(r)
      return { titulo: 'Facturas de compra del mes', valor: String(r.count ?? 0), pie: 'registradas en Adquisiciones', icono: Receipt }
    },
  },
  // Contabilidad las carga en Adquisiciones (migración 20261020171000).
  guias_del_mes: {
    ruta: '/adquisiciones',
    calcular: async (c) => {
      const r = await c.supabase
        .from('guias_remision_compra')
        .select('id', { count: 'exact', head: true })
        .is('anulada_en', null)
        .gte('cargada_en', c.mes)
      fallo(r)
      return { titulo: 'Guías cargadas este mes', valor: String(r.count ?? 0), pie: 'de las compras que recoge el conductor', icono: FileText }
    },
  },

  // Diseño y seguimiento por código
  etapas_en_curso: {
    ruta: '/diseno/etapas?ver=en-curso',
    calcular: async (c) => {
      const codigos = await deDiseno(c)
      const n = codigos.filter((k) => k.etapas > 0 && k.etapas_terminadas < k.etapas).length
      const vencidas = codigos.filter((k) => k.etapas_vencidas > 0).length
      return {
        titulo: 'Códigos en curso',
        valor: String(n),
        pie: vencidas > 0 ? `${vencidas} con etapas vencidas` : 'ninguno con etapas vencidas',
        icono: CalendarClock,
        tono: vencidas > 0 ? 'peligro' : 'acento',
      }
    },
  },
  codigos_sin_etapas: {
    ruta: '/diseno/etapas?ver=sin',
    calcular: async (c) => {
      const n = (await deDiseno(c)).filter((k) => k.etapas === 0).length
      return { titulo: 'Sin etapas', valor: String(n), pie: 'códigos por programar', icono: CalendarClock }
    },
  },
  planos_sin_recibir: {
    ruta: '/diseno/planos?ver=por-recibir',
    calcular: async (c) => {
      const codigos = await deDiseno(c)
      const planos = codigos.reduce((n, k) => n + k.planos, 0)
      const porRecibir = codigos.reduce((n, k) => n + k.planos_por_recibir, 0)
      return { titulo: 'Planos sin recibir', valor: String(porRecibir), pie: `de ${planos} vigentes`, icono: DraftingCompass, tono: porRecibir > 0 ? 'aviso' : 'neutro' }
    },
  },
  codigos_sin_materiales: {
    ruta: '/diseno/materiales?ver=sin',
    calcular: async (c) => {
      const n = (await deDiseno(c)).filter((k) => k.materiales === 0).length
      return { titulo: 'Sin lista de materiales', valor: String(n), pie: 'códigos', icono: Layers }
    },
  },
  seguimiento_en_curso: {
    ruta: '/seguimiento?ver=en-curso',
    calcular: async (c) => {
      const codigos = await deDiseno(c)
      const n = codigos.filter((k) => k.etapas > 0 && k.etapas_terminadas < k.etapas).length
      const vencidas = codigos.filter((k) => k.etapas_vencidas > 0).length
      return {
        titulo: 'Códigos en curso',
        valor: String(n),
        pie: vencidas > 0 ? `${vencidas} con etapas vencidas` : 'ninguno con etapas vencidas',
        icono: CalendarClock,
        tono: vencidas > 0 ? 'peligro' : 'acento',
      }
    },
  },

  // Supervisión
  reportes_del_mes: {
    ruta: '/reportes-diarios',
    calcular: async (c) => {
      let consulta = c.supabase
        .from('reportes_diarios')
        .select('anulado_en, observado_en, visto_gerencia_en, visto_rrhh_en')
        .gte('fecha', c.mes)
        .is('anulado_en', null)
        .limit(2000)
      // El supervisor ve los suyos; RR. HH. y Gerencia, los de todos.
      if (!puede(c.perfil, 'reporte_diario.ver')) consulta = consulta.eq('registrado_por', c.perfil.id)
      const r = await consulta
      fallo(r)
      const filas = r.data ?? []
      const validados = filas.filter((f) => estadoDeReporte(f) === 'VALIDADO').length
      return { titulo: 'Reportes diarios del mes', valor: String(filas.length), pie: `${validados} validados`, icono: ClipboardList }
    },
  },
  planos_del_area: {
    ruta: '/planos',
    calcular: async (c) => {
      const [planos, etapas] = await Promise.all([planosDeCodigo(null, { conPeso: false }), etapasDeCodigo(null)])
      // La misma cuenta con que abre la pantalla: los códigos con un plano por recibir o una etapa sin terminar.
      const porRecibir = planos.filter((p) => !p.anulado_en && !p.recibido_en)
      const abiertas = etapas.filter((e) => e.area_id !== null && puedeHojaDeArea(c.perfil, e.area_id) && !e.fin_real)
      const porHacer = new Set([...porRecibir.map((p) => p.codigo), ...abiertas.map((e) => e.codigo)]).size
      return {
        titulo: 'Códigos por hacer',
        valor: String(porHacer),
        pie: `${plural(porRecibir.length, 'plano por recibir', 'planos por recibir')} · ${plural(abiertas.length, 'etapa abierta', 'etapas abiertas')}`,
        icono: DraftingCompass,
      }
    },
  },

  // Recursos Humanos y portería
  personal_activo: {
    ruta: '/rrhh/personal',
    calcular: async (c) => ({ titulo: 'Personal activo', valor: String(await trabajadoresActivos(c)), pie: 'en la ficha de RR. HH.', icono: Users }),
  },
  entraron_hoy: {
    ruta: '/rrhh/asistencia',
    calcular: async (c) => {
      const [marcas, total] = await Promise.all([marcasDeHoy(c), trabajadoresActivos(c)])
      const entraron = new Set(marcas.filter((m) => m.tipo === 'INGRESO').map((m) => m.trabajador_id)).size
      return { titulo: 'Marcaron ingreso hoy', valor: `${entraron} de ${total}`, pie: total > 0 ? `${porcentaje((entraron / total) * 100)} del personal activo` : 'sin personal activo', icono: UserCheck, tono: 'acento' }
    },
  },
  salieron_hoy: {
    ruta: '/rrhh/asistencia',
    calcular: async (c) => {
      const marcas = await marcasDeHoy(c)
      const salieron = new Set(marcas.filter((m) => m.tipo === 'SALIDA').map((m) => m.trabajador_id)).size
      return { titulo: 'Marcaron salida hoy', valor: String(salieron), icono: Clock }
    },
  },
  tardanzas_de_hoy: {
    ruta: '/rrhh/asistencia',
    calcular: async (c) => {
      const n = (await marcasDeHoy(c)).filter((m) => m.es_tardanza).length
      return { titulo: 'Tardanzas de hoy', valor: String(n), pie: 'pasaron la tolerancia', icono: AlertTriangle, tono: n > 0 ? 'aviso' : 'neutro' }
    },
  },
  tardanzas_del_mes: {
    ruta: '/rrhh/tardanzas',
    calcular: async (c) => {
      const r = await c.supabase.from('asistencias').select('id', { count: 'exact', head: true }).eq('es_tardanza', true).gte('fecha', c.mes).is('anulado_en', null)
      fallo(r)
      return { titulo: 'Tardanzas del mes', valor: String(r.count ?? 0), pie: 'cada tres, el descuento', icono: AlertTriangle }
    },
  },

  // Administración
  subcontratos_vigentes: {
    ruta: '/subcontratos',
    calcular: async (c) => {
      const r = await c.supabase.from('subcontratos').select('id', { count: 'exact', head: true }).eq('estado', 'VIGENTE')
      fallo(r)
      return { titulo: 'Subcontratos vigentes', valor: String(r.count ?? 0), icono: Handshake }
    },
  },
  gastos_del_mes: {
    ruta: '/costos/gastos-generales',
    calcular: async (c) => {
      const r = await c.supabase.from('gastos_generales_mes').select('monto, moneda').eq('periodo', c.mes).is('anulado_en', null).limit(2000)
      fallo(r)
      const filas = r.data ?? []
      return {
        titulo: 'Gastos generales del mes',
        ...soles(
          filas.filter((f) => f.moneda !== 'USD').reduce((n, f) => n + num(f.monto), 0),
          filas.filter((f) => f.moneda === 'USD').reduce((n, f) => n + num(f.monto), 0),
        ),
        icono: Wallet,
      }
    },
  },

  // Ventas
  // Las dos cifras de Ventas cuentan las cotizaciones que subió quien mira: con
  // más de un vendedor, la de la empresa entera no le decía nada de lo suyo. El
  // enlace abre la lista con el mismo recorte («de=mias»).
  cotizaciones_en_gerencia: {
    ruta: '/cotizaciones/pdf?estado=POR_REVISAR&de=mias',
    calcular: async (c) => {
      const r = await c.supabase
        .from('v_cotizaciones_pdf')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'POR_REVISAR')
        .eq('registrado_por', c.perfil.id)
      fallo(r)
      return { titulo: 'En revisión de Gerencia', valor: String(r.count ?? 0), pie: 'de las que subiste', icono: Clock }
    },
  },
  aprobadas_del_mes: {
    ruta: '/cotizaciones/pdf?estado=APROBADA_MES&de=mias',
    calcular: async (c) => {
      const r = await c.supabase
        .from('v_cotizaciones_pdf')
        .select('moneda, monto_venta')
        .eq('estado', 'APROBADA')
        .eq('registrado_por', c.perfil.id)
        .gte('revisado_en', `${c.mes}T00:00:00-05:00`)
        .limit(500)
      fallo(r)
      const filas = r.data ?? []
      // Cada moneda con su total: sumar solo los soles decía «por S/ 0.00» en
      // un mes de cotizaciones en dólares.
      const soles = filas.filter((f) => f.moneda !== 'USD').reduce((n, f) => n + num(f.monto_venta), 0)
      const dolares = filas.filter((f) => f.moneda === 'USD').reduce((n, f) => n + num(f.monto_venta), 0)
      const montos = [soles > 0 ? moneda(soles) : null, dolares > 0 ? moneda(dolares, 'USD') : null].filter(Boolean)
      return {
        titulo: 'Aprobadas este mes',
        valor: String(filas.length),
        pie: montos.length > 0 ? `de las que subiste, por ${montos.join(' y ')}` : 'de las que subiste',
        icono: FileText,
        tono: filas.length > 0 ? 'exito' : 'neutro',
      }
    },
  },
  clientes: {
    ruta: '/clientes',
    calcular: async (c) => {
      const r = await c.supabase.from('clientes').select('id', { count: 'exact', head: true }).eq('activo', true)
      fallo(r)
      return { titulo: 'Clientes', valor: String(r.count ?? 0), pie: 'en la cartera', icono: Users }
    },
  },
} satisfies Record<string, Generador>

type ClaveCifra = keyof typeof CIFRAS

/**
 * Las cifras de cada puesto, en el orden de su trabajo: cómo va su área, no lo
 * que tiene que hacer (el dashboard no manda; eso lo decidió DKS el 2026-10-19).
 */
const CIFRAS_POR_PUESTO: Record<string, { titulo: string; cifras: ClaveCifra[] }> = {
  REQUERIMIENTOS: { titulo: 'Requerimientos', cifras: ['rq_abiertos', 'rq_por_comprar', 'vehiculos_en_planta', 'gasto_por_codigo'] },
  ALMACENERO: { titulo: 'Almacén', cifras: ['rq_en_compra', 'bajo_minimo', 'materiales_con_saldo', 'salidas_del_mes'] },
  COMPRADOR: { titulo: 'Logística', cifras: ['oc_por_aprobar', 'en_recojo', 'os_abiertas', 'compras_del_mes'] },
  CONDUCTOR: { titulo: 'Tus recojos', cifras: ['por_recoger', 'en_camino', 'dejadas_del_mes'] },
  GERENTE: { titulo: 'Códigos internos', cifras: ['codigos_en_trabajo', 'costo_de_codigos', 'facturado_y_cobrado', 'codigos_por_completar'] },
  TESORERIA: { titulo: 'Tesorería', cifras: ['caja_de_hoy', 'por_cobrar', 'por_pagar', 'servicios_por_pagar', 'recibos_por_pagar'] },
  CONTABILIDAD: { titulo: 'Contabilidad', cifras: ['facturado_del_mes', 'adquisiciones_del_mes', 'guias_del_mes'] },
  DISENO: { titulo: 'Por código interno', cifras: ['etapas_en_curso', 'codigos_sin_etapas', 'planos_sin_recibir', 'codigos_sin_materiales'] },
  ADMINISTRACION: { titulo: 'Administración', cifras: ['rq_abiertos', 'subcontratos_vigentes', 'gastos_del_mes', 'clientes'] },
  RECURSOS_HUMANOS: { titulo: 'Recursos Humanos', cifras: ['personal_activo', 'entraron_hoy', 'tardanzas_del_mes', 'reportes_del_mes'] },
  PORTERO: { titulo: 'Portería hoy', cifras: ['entraron_hoy', 'salieron_hoy', 'tardanzas_de_hoy'] },
  SUPERVISOR: { titulo: 'Tu área', cifras: ['reportes_del_mes', 'planos_del_area', 'rq_abiertos'] },
  SUPERVISOR_GENERAL: { titulo: 'Seguimiento', cifras: ['seguimiento_en_curso', 'rq_abiertos', 'vehiculos_en_planta', 'bajo_minimo'] },
  VENDEDOR: { titulo: 'Ventas', cifras: ['cotizaciones_en_gerencia', 'aprobadas_del_mes', 'clientes'] },
}
// El líder de Diseño ve las cifras de Diseño (mismo menú, `navegacion.ts`).
CIFRAS_POR_PUESTO.DISENO_LIDER = CIFRAS_POR_PUESTO.DISENO

export async function dashboardDelPuesto(perfil: PerfilSesion): Promise<DashboardDelPuesto | null> {
  const esAdmin = perfil.rol.codigo === 'ADMIN'
  // ADMIN mira como Gerencia: es quien lo ve todo.
  const propio = CIFRAS_POR_PUESTO[esAdmin ? 'GERENTE' : perfil.rol.codigo]
  if (!propio) return null

  const supabase = await createClient()
  const hoy = hoyLima()
  const lecturas = new Map<string, Promise<unknown>>()
  const contexto: Contexto = {
    perfil,
    supabase,
    hoy,
    mes: `${hoy.slice(0, 7)}-01`,
    una: <T,>(clave: string, leer: () => Promise<T>) => {
      if (!lecturas.has(clave)) lecturas.set(clave, leer())
      return lecturas.get(clave) as Promise<T>
    },
  }

  const enMenu = new Set(menuDe(perfil.permisos, esAdmin, perfil.rol.codigo).flatMap((g) => g.items.map((i) => i.ruta.split('?')[0])))
  const suyas = propio.cifras.filter((clave) => enMenu.has(CIFRAS[clave].ruta.split('?')[0]))

  const cifras = await Promise.all(
    suyas.map(async (clave): Promise<Cifra | null> => {
      const g: Generador = CIFRAS[clave]
      try {
        const c = await g.calcular(contexto)
        return c ? { clave, href: c.href ?? g.ruta, ...c } : null
      } catch {
        return { clave, titulo: 'No se pudo leer', valor: '—', pie: 'Abre el módulo o vuelve a cargar', href: g.ruta, tono: 'aviso' }
      }
    }),
  )

  return {
    titulo: propio.titulo,
    cifras: cifras.filter((c): c is Cifra => c !== null),
    codigos: enMenu.has('/codigos-internos') && puede(perfil, 'codigos_internos.ver') ? await codigosEnCurso(contexto) : null,
  }
}

/** Los seis códigos que se movieron hace menos, con su avance y su costo: lo primero que Gerencia abre. */
async function codigosEnCurso(c: Contexto): Promise<CodigoEnCurso[]> {
  try {
    const { codigos, avances } = await c.una('codigos', () => leerListaDeCodigos())
    return [...codigos]
      .filter((k) => k.ultima_actividad)
      .sort((a, b) => (b.ultima_actividad ?? '').localeCompare(a.ultima_actividad ?? ''))
      .slice(0, 6)
      .map((k) => {
        const costo = costoDelCodigo(k)
        return {
          codigo: k.codigo,
          href: enlaceCodigo(k.codigo),
          // PLANTA es el trabajo de la planta, no una unidad: no lleva avance.
          avance: k.codigo === CODIGO_SIN_AVANCE ? null : (avances.get(k.codigo)?.avance ?? 0),
          costo:
            costo.pen + costo.usd > 0
              ? [costo.pen > 0 ? moneda(costo.pen) : null, costo.usd > 0 ? `${moneda(costo.usd, 'USD')} sin cambio` : null].filter(Boolean).join(' y ')
              : null,
          ultima: k.ultima_actividad,
        }
      })
  } catch {
    return []
  }
}
