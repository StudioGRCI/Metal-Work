import 'server-only'

import { codigosParaElegir } from '@/lib/datos/codigos-para-elegir'
import { CAJA_NO_SE_MOVIO, CAJA_SIN_LEER, monedaDeCuenta, type CuentaParaPagar } from '@/lib/dominio/caja'
import type { CodigoParaElegir } from '@/lib/dominio/codigos-internos'
import { fecha as textoFecha, hoyLima, type CodigoMoneda } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'

/*
 * La caja diaria de Tesorería (migración 20261017200000). Todo sale de las
 * funciones de la base, que corren con los permisos de quien mira: sin
 * `tesoreria.caja` devuelven vacío.
 */

/** Una cuenta en el día: su saldo al empezar y al terminar, lo que entró y salió, y su cierre. */
export type CuentaDelDia = {
  id: string
  nombre: string
  tipo: string
  banco: string | null
  moneda: string
  activa: boolean
  fecha_inicio: string
  /** El saldo con que se dio de alta: el del día `fecha_inicio`, antes de sus movimientos. */
  saldo_alta: number
  /** `null` antes de que la cuenta empiece. */
  saldo_inicial: number | null
  ingresos: number
  egresos: number
  saldo_final: number | null
  movimientos: number
  cierre_id: string | null
  saldo_banco: number | null
  diferencia: number | null
  observaciones: string | null
  cerrado_en: string | null
  cerrado_por: string | null
  ultimo_cierre: string | null
  /** El primer día con movimientos después del último cierre: lo que falta cerrar. */
  primer_dia_sin_cerrar: string | null
  /** Con algo registrado, aunque esté anulado, el saldo inicial ya no cambia. */
  con_movimientos: boolean
  /** La captura del aplicativo con su saldo inicial, en Storage; null si no la tiene (migración 20261020174500). */
  apertura_ruta: string | null
}

export type MovimientoDelDia = {
  id: string
  caja_id: string
  tipo: 'INGRESO' | 'EGRESO'
  monto: number
  descripcion: string
  codigo_interno: string | null
  operacion: string | null
  tipo_cambio: number | null
  origen: string
  origen_id: string | null
  /** La planilla del pago, si es de la planilla diaria: «se anula en» lleva a ella y no a la lista. */
  planilla_id: string | null
  /** La otra cuenta de una transferencia. */
  otra_cuenta: string | null
  registrado_por: string | null
  creado_en: string
  anulado_en: string | null
  anulado_por: string | null
  motivo_anulacion: string | null
}

export type CierreReabierto = {
  id: string
  caja_id: string
  saldo_final: number
  saldo_banco: number
  cerrado_por: string | null
  creado_en: string
  anulado_por: string | null
  anulado_en: string
  motivo_anulacion: string | null
}

export type CajaDelDia = {
  cuentas: CuentaDelDia[]
  movimientos: MovimientoDelDia[]
  reabiertos: CierreReabierto[]
  /** El cambio de compra del día (o de los diez anteriores), para pasar los dólares a soles. */
  cambioCompra: number | null
  /** Los códigos internos para elegir en un egreso, con su unidad; `null` si no se pudieron leer. */
  codigos: CodigoParaElegir[] | null
}

const n = (v: number | null | undefined) => Number(v ?? 0)
const o = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v))

export async function cajaDelDia(dia: string): Promise<CajaDelDia> {
  const supabase = await createClient()
  const [cuentas, movimientos, reabiertos, cambio, codigos, capturas] = await Promise.all([
    supabase.rpc('caja_del_dia', { p_fecha: dia }),
    supabase.rpc('movimientos_caja_del_dia', { p_fecha: dia }),
    supabase.rpc('cierres_caja_reabiertos', { p_fecha: dia }),
    supabase.rpc('cambio_del_dia', { p_fecha: dia, p_operacion: 'COMPRA' }),
    codigosParaElegir(supabase),
    // `caja_del_dia` no la trae: cambiar lo que devuelve obligaría a borrarla y volver a crearla.
    supabase.from('cajas').select('id, apertura_ruta').not('apertura_ruta', 'is', null),
  ])
  if (cuentas.error) throw new Error(`No se pudo leer la caja del día: ${cuentas.error.message}`)
  if (movimientos.error) throw new Error(`No se pudieron leer los movimientos del día: ${movimientos.error.message}`)
  if (reabiertos.error) throw new Error(`No se pudieron leer los cierres del día: ${reabiertos.error.message}`)
  if (cambio.error) throw new Error(`No se pudo leer el tipo de cambio: ${cambio.error.message}`)
  if (capturas.error) throw new Error(`No se pudo leer qué cuentas tienen la captura de su saldo: ${capturas.error.message}`)
  const capturaDe = new Map((capturas.data ?? []).map((c) => [c.id, c.apertura_ruta]))

  // La planilla de cada pago de la planilla diaria. Si no se puede leer, el
  // enlace lleva a la lista de planillas: no dice nada falso, solo es más largo.
  const pagosPlanilla = (movimientos.data ?? []).flatMap((m) => (m.origen === 'PAGO_PLANILLA_DIARIA' && m.origen_id ? [m.origen_id] : []))
  const planillaDe = new Map<string, string>()
  if (pagosPlanilla.length > 0) {
    const { data, error } = await supabase.from('planilla_diaria_pagos').select('id, planilla_id').in('id', pagosPlanilla)
    if (error) console.error(`No se pudieron leer las planillas de los pagos de la caja: ${error.message}`)
    for (const g of data ?? []) planillaDe.set(g.id, g.planilla_id)
  }

  return {
    cuentas: (cuentas.data ?? []).flatMap((c) =>
      c.caja_id
        ? [
            {
              id: c.caja_id,
              nombre: c.nombre ?? '',
              tipo: c.tipo ?? 'BANCO',
              banco: c.banco,
              moneda: c.moneda ?? 'PEN',
              activa: c.activa ?? true,
              fecha_inicio: c.fecha_inicio ?? dia,
              saldo_alta: n(c.saldo_alta),
              saldo_inicial: o(c.saldo_inicial),
              ingresos: n(c.ingresos),
              egresos: n(c.egresos),
              saldo_final: o(c.saldo_final),
              movimientos: n(c.movimientos),
              cierre_id: c.cierre_id,
              saldo_banco: o(c.saldo_banco),
              diferencia: o(c.diferencia),
              observaciones: c.observaciones,
              cerrado_en: c.cerrado_en,
              cerrado_por: c.cerrado_por,
              ultimo_cierre: c.ultimo_cierre,
              primer_dia_sin_cerrar: c.primer_dia_sin_cerrar,
              con_movimientos: c.con_movimientos ?? false,
              apertura_ruta: capturaDe.get(c.caja_id) ?? null,
            },
          ]
        : [],
    ),
    movimientos: (movimientos.data ?? []).flatMap((m) =>
      m.id && m.caja_id
        ? [
            {
              id: m.id,
              caja_id: m.caja_id,
              tipo: m.tipo === 'INGRESO' ? ('INGRESO' as const) : ('EGRESO' as const),
              monto: n(m.monto),
              descripcion: m.descripcion ?? '',
              codigo_interno: m.codigo_interno,
              operacion: m.operacion,
              tipo_cambio: o(m.tipo_cambio),
              origen: m.origen ?? 'MANUAL',
              origen_id: m.origen_id,
              planilla_id: (m.origen_id && planillaDe.get(m.origen_id)) ?? null,
              otra_cuenta: m.otra_cuenta,
              registrado_por: m.registrado_por,
              creado_en: m.creado_en ?? '',
              anulado_en: m.anulado_en,
              anulado_por: m.anulado_por,
              motivo_anulacion: m.motivo_anulacion,
            },
          ]
        : [],
    ),
    reabiertos: (reabiertos.data ?? []).flatMap((k) =>
      k.id && k.caja_id && k.anulado_en
        ? [
            {
              id: k.id,
              caja_id: k.caja_id,
              saldo_final: n(k.saldo_final),
              saldo_banco: n(k.saldo_banco),
              cerrado_por: k.cerrado_por,
              creado_en: k.creado_en ?? '',
              anulado_por: k.anulado_por,
              anulado_en: k.anulado_en,
              motivo_anulacion: k.motivo_anulacion,
            },
          ]
        : [],
    ),
    cambioCompra: o(cambio.data),
    codigos,
  }
}

/**
 * Las cuentas activas de la caja, en el orden de la caja diaria, para que
 * Tesorería elija de cuál salió un pago o a cuál entró un cobro (migración
 * 20261019100000). Sin `tesoreria.caja` sale vacía.
 */
export async function cuentasParaPagar(): Promise<CuentaParaPagar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('caja_del_dia', { p_fecha: hoyLima() })
  if (error) throw new Error(`No se pudieron leer las cuentas de la caja: ${error.message}`)
  return (data ?? []).flatMap((c) =>
    c.caja_id && c.activa
      ? [
          {
            id: c.caja_id,
            nombre: c.nombre ?? '',
            tipo: c.tipo ?? 'BANCO',
            banco: c.banco,
            moneda: monedaDeCuenta(c.moneda),
            fecha_inicio: c.fecha_inicio ?? '',
            cerrada_hasta: c.ultimo_cierre,
          },
        ]
      : [],
  )
}

/**
 * La cuenta que movió un pago o un cobro del sistema, cuánto movió en su moneda
 * y si ese movimiento ya se anuló. `devuelto` es el día en que volvió a la
 * cuenta al anularlo, cuando el día del pago ya estaba cerrado y no se podía
 * tocar (la devolución entra ese día, del otro tipo).
 */
export type CajaDelPago = { cuenta: string; anulado: boolean; devuelto: string | null; monto: number; moneda: CodigoMoneda }

/** El tipo del movimiento que deja cada origen: el cobro entra, el pago sale. La devolución de una anulación es del otro. */
const tipoDelOrigen = (origen: string) => (origen === 'COBRO_FACTURA_VENTA' ? 'INGRESO' : 'EGRESO')

/**
 * La cuenta de la caja que movió cada pago o cobro (migración 20261019100000),
 * para decirlo en la línea del pago: ahí se ve aunque el documento quede
 * saldado y su botón desaparezca. Sin `tesoreria.caja` el RLS no deja ver
 * ningún movimiento, así que a quien no lleva la caja no se le pregunta.
 */
export async function cajaDeLosPagos(origen: string, ids: string[]): Promise<Map<string, CajaDelPago>> {
  const mapa = new Map<string, CajaDelPago>()
  if (ids.length === 0) return mapa
  const supabase = await createClient()
  const filas = []
  // En tandas de 150, como `correccionesDe`: Cuentas por pagar trae cientos de pagos y la URL no se alarga sin fin.
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase
      .from('movimientos_caja')
      .select('origen_id, tipo, fecha, anulado_en, monto, caja:cajas!movimientos_caja_caja_id_fkey(nombre, moneda)')
      .eq('origen', origen)
      .in('origen_id', ids.slice(i, i + 150))
    if (error) throw new Error(`No se pudo leer la caja de los pagos: ${error.message}`)
    filas.push(...(data ?? []))
  }
  const propio = tipoDelOrigen(origen)
  // Primero el movimiento del pago o del cobro: uno vigente manda sobre uno anulado.
  for (const m of filas) {
    if (!m.origen_id || m.tipo !== propio) continue
    const previo = mapa.get(m.origen_id)
    if (previo && !previo.anulado) continue
    mapa.set(m.origen_id, {
      cuenta: m.caja?.nombre ?? 'una cuenta',
      anulado: !!m.anulado_en,
      devuelto: null,
      monto: Number(m.monto),
      moneda: monedaDeCuenta(m.caja?.moneda),
    })
  }
  // Después su devolución, si al anularlo su día ya estaba cerrado.
  for (const m of filas) {
    if (!m.origen_id || m.tipo === propio || m.anulado_en) continue
    const mov = mapa.get(m.origen_id)
    if (mov) mapa.set(m.origen_id, { ...mov, devuelto: m.fecha })
  }
  return mapa
}

/**
 * Cómo quedó la caja después del pago o el cobro, para decirlo en el aviso: de
 * qué cuenta salió —la del movimiento, no la del formulario: un reintento con
 * otra cuenta devuelve el pago que ya estaba— o por qué no se movió. Si no se
 * puede leer, lo dice en vez de callar.
 */
export async function cajaTrasElPago(origen: string, id: string, cajaId: string, dia: string, tipo: 'pago' | 'cobro'): Promise<string> {
  const supabase = await createClient()
  const [movimientos, caja] = await Promise.all([
    cajaDeLosPagos(origen, [id]).catch(() => null),
    supabase.from('cajas').select('nombre, fecha_inicio').eq('id', cajaId).maybeSingle(),
  ])
  if (!movimientos || caja.error) return CAJA_SIN_LEER
  const mov = movimientos.get(id)
  if (mov && !mov.anulado) return tipo === 'cobro' ? `Entró a ${mov.cuenta}.` : `Salió de ${mov.cuenta}.`
  const inicio = caja.data?.fecha_inicio
  if (!caja.data || !inicio || dia >= inicio) return ''
  return `${CAJA_NO_SE_MOVIO}: la cuenta ${caja.data.nombre} lleva la caja desde el ${textoFecha(inicio)} y este ${tipo} ya está en su saldo inicial.`
}

/**
 * Tras anular un pago o un cobro: si había movido la caja, que su movimiento
 * quedó anulado o, si su día ya estaba cerrado, que la devolución entró hoy.
 */
export async function cajaTrasAnular(origen: string, id: string, tipo: 'pago' | 'cobro'): Promise<string> {
  const movimientos = await cajaDeLosPagos(origen, [id]).catch(() => null)
  if (!movimientos) return CAJA_SIN_LEER
  const mov = movimientos.get(id)
  if (!mov) return ''
  if (mov.devuelto) {
    return tipo === 'cobro'
      ? `Su día ya estaba cerrado en la caja: hoy sale de ${mov.cuenta} lo que entró con el cobro.`
      : `Su día ya estaba cerrado en la caja: hoy vuelve a ${mov.cuenta} lo que salió con el pago.`
  }
  if (!mov.anulado) return ''
  return tipo === 'cobro' ? 'Su ingreso en la caja diaria también quedó anulado.' : 'Su egreso en la caja diaria también quedó anulado.'
}
