import Link from 'next/link'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { Marca, Recorrido } from '@/components/ui/recorrido'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import type { RecorridoDelCodigoBase, ResumenCodigo } from '@/lib/datos/codigos-internos'
import type { FacturadoDelCodigo } from '@/lib/datos/facturacion'
import { cambioDesdeElCierre, costoDelCodigo, enlaceCodigo, faltanteDelCosto } from '@/lib/dominio/codigos-internos'
import { ESTADO_COTIZACION, TIPO_TRABAJO, definir, estadoDeOrden } from '@/lib/dominio/estados'
import type { PasoDescrito } from '@/lib/dominio/recorrido'
import { fecha, moneda, porcentaje, type CodigoMoneda } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Hecho, en curso, todavía no, o no se pudo leer. */
type Situacion = 'HECHO' | 'AHORA' | 'FALTA' | 'SIN_LEER'

type Paso = {
  clave: 'cotizacion' | 'orden' | 'costo' | 'facturado' | 'cobrado'
  titulo: string
  situacion: Situacion
  /** La cifra o el documento, en una línea. */
  valor: string
  /** Lo que la acompaña: estado, fecha, cuánto falta. */
  pie?: string | null
  tono?: 'exito' | 'aviso' | 'peligro' | 'neutro'
  /** El pie en aviso: algo no cuadra o falta para que la cifra esté completa. */
  pieEnAviso?: boolean
  /** El pie en peligro: el costo de hoy pasó el presupuesto. */
  pieEnPeligro?: boolean
  enlace?: { href: string; texto: string } | null
}

/** El símbolo y la cifra no se separan de renglón: «US$» arriba y «29,500.00» abajo no se lee. */
const sinPartir = (t: string) => t.replace(/(S\/|US\$) /g, '$1\u00a0')
const monto = (n: number, m: CodigoMoneda = 'PEN') => sinPartir(moneda(n, m))
const montos = (r: Record<CodigoMoneda, number>) =>
  (['PEN', 'USD'] as const)
    .filter((m) => r[m] > 0)
    .map((m) => monto(r[m], m))
    .join(' + ') || monto(0)

/** Por qué lo facturado no se comparó con lo vendido: se dice, no se da por hecho. */
const SIN_COMPARAR: Record<NonNullable<FacturadoDelCodigo['sinComparar']>, string> = {
  SIN_PERMISO: 'sin comparar con lo vendido',
  SIN_MONTO: 'no se compara: una cotización no tiene monto',
  NO_SE_PUDO: 'no se pudo comparar con lo vendido',
}

const ENTREGADA = new Set(['ENTREGADA', 'FACTURADA'])
const SIN_LEER = 'No se pudo leer'
const LECTOR: Record<Situacion, string> = { HECHO: 'Hecho:', AHORA: 'En curso:', FALTA: 'Todavía no:', SIN_LEER: 'No se pudo leer:' }

/**
 * El código de la cotización al cobro, en una fila (plan 12, entrega 12.3): la
 * cotización, la OT, el costo contra el presupuesto, lo facturado y lo cobrado,
 * cada paso con su estado y su enlace a donde se ve entero, y debajo el
 * recorrido de la cotización del Plan 0 (quién la tuvo y desde cuándo).
 *
 * No calcula nada: la cotización y la OT las elige la base con la regla del
 * costeo (`codigo_interno_recorrido`); las cifras son las del costeo del código
 * (`codigos_internos_costo`) y lo facturado, las de `facturadoDelCodigo`.
 *
 * Cada paso sale solo con su permiso: el presupuesto con el precio de venta
 * (`venta` llega en nulo sin él), lo facturado y cobrado con quien lo lee, y el
 * enlace a la OT y a la cotización con quien las abre.
 */
export function RecorridoDelCodigo({
  codigo,
  c,
  base,
  facturado,
  abreOrden,
  abreCotizacion,
  recorridoDeLaCotizacion,
}: {
  codigo: string
  c: ResumenCodigo
  /** `null`: no se pudieron leer; el paso lo dice en vez de decir «sin OT». */
  base: RecorridoDelCodigoBase | null
  facturado: FacturadoDelCodigo | null
  abreOrden: boolean
  abreCotizacion: boolean
  /** Los pasos de la cotización; `null` si no se pudieron leer, `undefined` si no van. */
  recorridoDeLaCotizacion?: PasoDescrito[] | null
}) {
  const pasos: Paso[] = []
  const cotizacion = base?.cotizacion ?? null
  const orden = base?.orden ?? null

  // 1. La cotización que vendió el código.
  if (!base) {
    pasos.push({ clave: 'cotizacion', titulo: 'Cotización', situacion: 'SIN_LEER', valor: SIN_LEER, tono: 'aviso' })
  } else if (!cotizacion) {
    pasos.push({
      clave: 'cotizacion',
      titulo: 'Cotización',
      situacion: 'FALTA',
      valor: 'Sin cotización',
      pie: orden ? `La OT ${orden.numero} no viene de una cotización` : 'La sube Ventas y la aprueba Gerencia',
    })
  } else {
    const e = definir(ESTADO_COTIZACION, cotizacion.estado)
    pasos.push({
      clave: 'cotizacion',
      titulo: 'Cotización',
      situacion: cotizacion.estado === 'APROBADA' ? 'HECHO' : 'AHORA',
      valor: cotizacion.numero,
      pie: [e.etiqueta, cotizacion.fecha && `del ${fecha(cotizacion.fecha)}`, base.cotizaciones > 1 && `y ${base.cotizaciones - 1} más`]
        .filter(Boolean)
        .join(' · '),
      tono: e.tono === 'peligro' ? 'peligro' : undefined,
      enlace: abreCotizacion ? { href: `/cotizaciones/pdf?${new URLSearchParams({ q: cotizacion.numero })}`, texto: 'Ver la cotización' } : null,
    })
  }

  // 2. La OT que la fabrica, y su expediente, que dice el plan contra lo real.
  if (!base) {
    pasos.push({ clave: 'orden', titulo: 'Orden de trabajo', situacion: 'SIN_LEER', valor: SIN_LEER, tono: 'aviso' })
  } else if (!orden) {
    pasos.push({
      clave: 'orden',
      titulo: 'Orden de trabajo',
      situacion: 'FALTA',
      valor: 'Sin OT',
      pie: cotizacion ? 'La carga Administración con la cotización aprobada' : 'La carga Administración',
    })
  } else {
    const e = estadoDeOrden(orden.estado, orden.delTaller)
    pasos.push({
      clave: 'orden',
      titulo: 'Orden de trabajo',
      situacion: ENTREGADA.has(orden.estado) || orden.entregadaEl ? 'HECHO' : 'AHORA',
      valor: `OT ${orden.numero}`,
      pie: [
        orden.entregadaEl && orden.estado === 'ENTREGADA' ? `Entregada el ${fecha(orden.entregadaEl)}` : e.etiqueta,
        orden.tipo && orden.tipo !== 'FABRICACION' && definir(TIPO_TRABAJO, orden.tipo).etiqueta.toLowerCase(),
        orden.entregadaEl && orden.estado !== 'ENTREGADA' && `entregada el ${fecha(orden.entregadaEl)}`,
        base.ordenes > 1 && `y ${base.ordenes - 1} más`,
      ]
        .filter(Boolean)
        .join(' · '),
      tono: orden.delTaller && orden.estado === 'BORRADOR' ? 'aviso' : undefined,
      enlace: abreOrden ? { href: `/ordenes/${orden.id}/expediente`, texto: 'Ver el expediente' } : null,
    })
  }

  // 3. El costo contra el presupuesto, las cifras del costeo. Con el costeo cerrado manda lo congelado,
  //    y si el costo de hoy es otro, se dice.
  const costo = costoDelCodigo(c)
  const cerrado = c.cierre?.costo_pen ?? null
  const desdeElCierre = cerrado !== null ? cambioDesdeElCierre(costo.pen, cerrado) : 0
  const presupuesto = c.venta?.presupuesto_pen ?? null
  const faltante = faltanteDelCosto({ sinPrecio: c.materiales_sin_precio, horasSinCosto: c.horas_sin_costo, sinCambio: c.lineas_sin_cambio })
  const cifra = cerrado ?? costo.pen
  // Sin presupuesto por un dato que falta en la cotización; el motivo ya lo dice la cifra de Margen.
  const sinPresupuesto = presupuesto === null && c.venta ? 'sin presupuesto' : null
  // Cerrado, manda lo congelado; pero si el costo de hoy ya pasó el presupuesto, se dice.
  const hoySePaso = cerrado !== null && presupuesto !== null && costo.pen > presupuesto
  pasos.push({
    clave: 'costo',
    titulo: presupuesto !== null ? 'Costo contra presupuesto' : 'Costo',
    situacion: cerrado !== null ? 'HECHO' : costo.pen + costo.usd > 0 ? 'AHORA' : 'FALTA',
    valor: presupuesto !== null ? `${monto(cifra)} de ${monto(presupuesto)}` : monto(cifra),
    pie: [
      costo.usd > 0 && `+ ${monto(costo.usd, 'USD')} sin cambio`,
      cerrado === null && c.venta?.consumido_pct != null && `${porcentaje(c.venta.consumido_pct)} del presupuesto`,
      cerrado === null && c.venta?.semaforo === 'EXCEDIDO' && 'se pasó',
      c.cierre ? `costeo cerrado el ${fecha(c.cierre.cerrado_en)}` : 'hasta hoy',
      desdeElCierre !== 0 && `hoy ${monto(costo.pen)}: ${desdeElCierre > 0 ? 'subió' : 'bajó'} ${monto(Math.abs(desdeElCierre))} desde el cierre`,
      hoySePaso && presupuesto !== null && `hoy pasa el presupuesto en ${monto(costo.pen - presupuesto)}`,
      faltante,
      sinPresupuesto,
    ]
      .filter(Boolean)
      .join(' · '),
    pieEnAviso: desdeElCierre !== 0 || Boolean(faltante) || costo.usd > 0 || Boolean(sinPresupuesto),
    pieEnPeligro: hoySePaso,
    tono: cerrado !== null ? undefined : c.venta?.semaforo === 'EXCEDIDO' ? 'peligro' : c.venta?.semaforo === 'AJUSTADO' ? 'aviso' : undefined,
    // Baja a la sección, como las pestañas: en el teléfono empieza dos pantallas más abajo.
    enlace: { href: `${enlaceCodigo(codigo, 'costeo')}#seccion-elegida`, texto: 'Ver el costeo' },
  })

  // 4 y 5. Lo facturado y lo cobrado, para quien los lee.
  if (facturado) {
    const sinFactura = facturado.facturas === 0
    const porCobrar = facturado.saldo.PEN + facturado.saldo.USD > 0
    // Sin saldo y con menos cobrado que facturado: un cobro la dio por cancelada (`cancela`), no se cobró todo.
    const canceladaConMenos = !sinFactura && !porCobrar && (['PEN', 'USD'] as const).some((m) => facturado.cobrado[m] < facturado.total[m] - 0.005)
    const cuantas = `en ${facturado.facturas} ${facturado.facturas === 1 ? 'factura' : 'facturas'}`
    // Contra lo vendido con IGV, cotización por cotización con la regla de la bandeja de Contabilidad
    // (`comoVaLaFactura`): hecho solo si se comparó y no falta nada.
    const v = facturado.contraVendido
    const enParte = Boolean(v?.como.some((c) => c === 'EN_PARTE' || c === 'POR_FACTURAR'))
    const otraMoneda = Boolean(v?.como.includes('OTRA_MONEDA'))
    const sinComparar = facturado.sinComparar ? SIN_COMPARAR[facturado.sinComparar] : null
    pasos.push({
      clave: 'facturado',
      titulo: 'Facturado',
      situacion: sinFactura ? 'FALTA' : !v || enParte || otraMoneda ? 'AHORA' : 'HECHO',
      valor: sinFactura ? 'Sin factura' : enParte && v ? `${montos(facturado.total)} de ${montos(v.vendido)}` : montos(facturado.total),
      pie: sinFactura
        ? v
          ? `por facturar ${montos(v.vendido)} con IGV · la registra Contabilidad`
          : 'La registra Contabilidad sobre la cotización aprobada'
        : [cuantas, enParte && v && `falta facturar ${montos(v.falta)}`, otraMoneda && 'en otra moneda que la cotización: no se compara', sinComparar]
            .filter(Boolean)
            .join(' · '),
      pieEnAviso: enParte || otraMoneda || Boolean(sinComparar),
      tono: enParte ? 'aviso' : undefined,
      enlace: { href: `${enlaceCodigo(codigo, 'facturacion')}#seccion-elegida`, texto: 'Ver factura y cobro' },
    })
    pasos.push({
      clave: 'cobrado',
      titulo: 'Cobrado',
      situacion: sinFactura ? 'FALTA' : porCobrar ? 'AHORA' : 'HECHO',
      valor: sinFactura ? '—' : montos(facturado.cobrado),
      pie: sinFactura
        ? null
        : porCobrar
          ? `por cobrar ${montos(facturado.saldo)} de lo facturado`
          : canceladaConMenos
            ? 'Tesorería la dio por cancelada con menos de lo facturado'
            : 'todo lo facturado está cobrado',
      pieEnAviso: canceladaConMenos,
      // Un solo «Ver factura y cobro»: el de lo facturado lleva al mismo lugar.
    })
  }

  const enColumnas = pasos.length === 5 ? 'xl' : 'md'
  return (
    <Tarjeta className="overflow-hidden" data-recorrido-del-codigo>
      <TarjetaCabecera titulo="De la cotización al cobro" />
      {/* Cinco columnas recién desde xl: en md cada una quedaba en 150 px y las cifras se partían en tres renglones. */}
      <ol
        className={cn(
          'grid divide-y divide-borde border-t border-borde',
          enColumnas === 'xl' ? 'xl:grid-cols-5 xl:divide-x xl:divide-y-0' : 'md:grid-cols-3 md:divide-x md:divide-y-0',
        )}
      >
        {pasos.map((p) => (
          // En el teléfono el enlace va a la derecha del paso, para que los cinco no midan una pantalla; en el monitor, debajo.
          <li
            key={p.clave}
            className={cn(
              'grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 px-4 py-3',
              enColumnas === 'xl' ? 'xl:grid-cols-[auto_minmax(0,1fr)] xl:grid-rows-[1fr_auto]' : 'md:grid-cols-[auto_minmax(0,1fr)] md:grid-rows-[1fr_auto]',
            )}
            data-paso={p.clave}
            data-situacion={p.situacion}
          >
            <Marca situacion={p.situacion === 'FALTA' || p.situacion === 'SIN_LEER' ? 'PENDIENTE' : p.situacion} />
            <div className="min-w-0 space-y-0.5">
              <p className="text-xs text-texto-suave">
                <span className="sr-only">{LECTOR[p.situacion]} </span>
                {p.titulo}
              </p>
              <p className={cn('tabular text-sm font-medium break-words', p.situacion === 'FALTA' ? 'text-texto-suave' : 'text-texto')}>
                {p.tono ? <Insignia tono={p.tono}>{p.valor}</Insignia> : p.valor}
              </p>
              {p.pie && <p className={cn('text-xs break-words', p.pieEnPeligro ? 'text-peligro' : p.pieEnAviso ? 'text-aviso' : 'text-texto-suave')}>{p.pie}</p>}
            </div>
            {p.enlace && (
              <Link
                href={p.enlace.href}
                className={cn(
                  '-my-2 inline-flex min-h-11 items-center justify-self-end text-xs font-medium text-acento hover:underline',
                  enColumnas === 'xl'
                    ? 'xl:col-start-2 xl:my-0 xl:min-h-0 xl:justify-self-start xl:pt-1'
                    : 'md:col-start-2 md:my-0 md:min-h-0 md:justify-self-start md:pt-1',
                )}
              >
                {p.enlace.texto}
              </Link>
            )}
          </li>
        ))}
      </ol>
      {cotizacion && recorridoDeLaCotizacion !== undefined && (
        <Recorrido pasos={recorridoDeLaCotizacion} femenino titulo={`Recorrido de la cotización ${cotizacion.numero}`} className="border-t border-borde" />
      )}
    </Tarjeta>
  )
}
