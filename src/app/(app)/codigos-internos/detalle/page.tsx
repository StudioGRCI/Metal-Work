import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Download, FileText } from 'lucide-react'

import { LineaDeDiseno } from '@/components/codigo-interno/linea-diseno'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { FacturaDeVenta } from '@/components/finanzas/factura-de-venta'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Progreso } from '@/components/ui/progreso'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  avanceDeLosCodigos,
  avanceDelCodigo,
  comprasDelCodigo,
  costeoDelCodigo,
  documentosDelCodigo,
  listarCodigosInternos,
  personalDelCodigo,
  sumarCodigosDeDiseno,
  type AvanceDeCodigo,
  type ResumenCodigo,
} from '@/lib/datos/codigos-internos'
import { codigosDeDiseno, etapasDeCodigo } from '@/lib/datos/diseno-codigos'
import { cotizacionesAprobadas, facturadoDelCodigo, facturasDelCodigo, type FacturadoDelCodigo } from '@/lib/datos/facturacion'
import {
  CODIGO_SIN_AVANCE,
  ESTADO_DOCUMENTO_CODIGO,
  ESTADO_SERVICIO_CODIGO,
  TIPO_DOCUMENTO_CODIGO,
  VISTAS_CODIGO,
  costoDelCodigo,
  dondeAparece,
  enlaceCodigo,
  faltaElPrecio,
  normalizarCodigo,
  origenDelAvance,
  parecidos,
  ultimoAvancePorTrabajo,
  vistaValida,
  type VistaCodigo,
} from '@/lib/dominio/codigos-internos'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { totalConIgv } from '@/lib/dominio/finanzas'
import { situacionCompra, validacionDeCompra } from '@/lib/dominio/logistica'
import { ESTADO_REPORTE, type EstadoReporte } from '@/lib/dominio/reporte-diario'
import { ESTADO_REQUERIMIENTO } from '@/lib/dominio/requerimientos'
import { horasCortas } from '@/lib/dominio/rrhh'
import { cantidad, fecha, fechaLarga, moneda, porcentaje, type CodigoMoneda } from '@/lib/format'
import { exigirPermiso, puede, type PerfilSesion } from '@/lib/sesion'

import { CerrarCosteo, ReabrirCosteo } from './cierre-costeo'
import { VistaEtapas, VistaMateriales, VistaPlanos } from './vistas-diseno'

export const metadata = { title: 'Código interno' }

export default async function PaginaCodigoInterno({ searchParams }: PageProps<'/codigos-internos/detalle'>) {
  const perfil = await exigirPermiso('codigos_internos.ver')
  const params = await searchParams
  const codigo = typeof params.codigo === 'string' ? normalizarCodigo(params.codigo) : ''
  if (!codigo) notFound()
  // La factura y el cobro los ve quien lee las cotizaciones aprobadas (Gerencia) o las factura y cobra.
  const veFacturas = puede(perfil, ['cotizaciones.ver_aprobadas', 'contabilidad.facturar', 'tesoreria.ver_documentos'])
  const pedida = vistaValida(params.vista)
  const vista = pedida === 'facturacion' && !veFacturas ? 'avance' : pedida

  const [conDocumentos, deDiseno, avances, facturado] = await Promise.all([
    listarCodigosInternos(),
    codigosDeDiseno(),
    avanceDeLosCodigos(codigo),
    veFacturas ? facturadoDelCodigo(codigo) : Promise.resolve(null),
  ])
  const avance = avances.get(codigo)
  const todos = sumarCodigosDeDiseno(conDocumentos, deDiseno)
  const resumen = todos.find((c) => c.codigo === codigo)
  const diseno = deDiseno.find((d) => d.codigo === codigo)
  const otros = parecidos(todos.map((c) => c.codigo)).get(codigo) ?? []
  // Un código que no está en el sistema puede ser uno mal escrito: se ofrecen los parecidos.
  const sugeridos = resumen ? [] : (parecidos([...todos.map((c) => c.codigo), codigo]).get(codigo) ?? [])

  return (
    <>
      <EncabezadoPagina
        titulo={<span className="font-mono break-all">{codigo}</span>}
        descripcion={resumen ? `${diseno?.unidad ? `${diseno.unidad} · ` : ''}Aparece en ${dondeAparece(resumen, diseno)}.` : undefined}
        migas={[{ titulo: 'Códigos internos', ruta: '/codigos-internos' }, { titulo: codigo }]}
      />

      {!resumen ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">Este código no aparece en el sistema</p>
            <p className="text-sm text-texto-suave">
              Ningún reporte diario, salida del almacén, requerimiento, compra, unidad ni carga de horas lo lleva, y Diseño no le cargó planos,
              materiales ni etapas.
            </p>
            {sugeridos.length > 0 && (
              <p className="mt-2 text-sm text-texto">
                Se parece a{' '}
                {sugeridos.map((s, i) => (
                  <span key={s}>
                    {i > 0 && ', '}
                    <Link href={enlaceCodigo(s)} className="font-mono text-acento hover:underline">
                      {s}
                    </Link>
                  </span>
                ))}
                .
              </p>
            )}
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <div className="space-y-5">
          {otros.length > 0 && (
            <Tarjeta className="border-aviso">
              <TarjetaCuerpo className="text-sm">
                <p className="font-medium text-texto">¿Es el mismo código que {otros.length === 1 ? 'este' : 'estos'}?</p>
                <p className="text-texto-suave">
                  Se escribe casi igual que{' '}
                  {otros.map((o, i) => (
                    <span key={o}>
                      {i > 0 && ', '}
                      <Link href={enlaceCodigo(o, vista)} className="font-mono text-acento hover:underline">
                        {o}
                      </Link>
                    </span>
                  ))}
                  . Si es el mismo, cada uno lleva su parte del avance y del costo por separado: hay que pedir que se corrija donde se escribió.
                </p>
              </TarjetaCuerpo>
            </Tarjeta>
          )}

          <ComoVa
            c={resumen}
            avance={avance}
            facturado={facturado}
            codigo={codigo}
            verPrecio={puede(perfil, 'cotizaciones.ver_pdf_comercial')}
            cierra={puede(perfil, 'codigos_internos.cerrar')}
          />
          <LineaDeDiseno d={diseno} />

          <PastillaFiltro
            ruta="/codigos-internos/detalle"
            clave="vista"
            params={params}
            activo={vista === 'avance' ? null : vista}
            etiqueta="Secciones del código"
            opciones={VISTAS_CODIGO.filter((v) => v.valor !== 'facturacion' || veFacturas).map((v) => ({
              valor: v.valor === 'avance' ? null : v.valor,
              etiqueta: v.etiqueta,
            }))}
          />

          <Vista vista={vista} codigo={codigo} perfil={perfil} avance={avance} />
        </div>
      )}
    </>
  )
}

/** Las cifras de arriba: lo mismo que la fila de la lista, con más aire. */
function ComoVa({
  c,
  avance,
  facturado,
  codigo,
  verPrecio,
  cierra,
}: {
  c: ResumenCodigo
  avance: AvanceDeCodigo | undefined
  facturado: FacturadoDelCodigo | null
  codigo: string
  /** Quien ve el precio de venta (`cotizaciones.ver_pdf_comercial`) ve el margen. */
  verPrecio: boolean
  /** Quien cierra el costeo (`codigos_internos.cerrar`). */
  cierra: boolean
}) {
  const costo = costoDelCodigo(c)
  const manoObra = c.mano_obra + c.recargo_extras
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador
          titulo="Avance"
          valor={
            codigo === CODIGO_SIN_AVANCE ? (
              'No aplica'
            ) : (
              <span data-avance={avance?.avance ?? 0}>
                <Progreso valor={avance?.avance ?? 0} mostrarValor etiqueta="Avance del código" />
              </span>
            )
          }
          pie={origenDelAvance(codigo, avance)}
        />
        <Indicador
          titulo="Costo hasta hoy"
          valor={
            faltaElPrecio(costo.pen + costo.usd, c.materiales_sin_precio + c.horas_sin_costo) ?? (
              <span data-costo={costo.pen}>
                {moneda(costo.pen)}
                {costo.usd > 0 && <span className="block text-sm">+ {moneda(costo.usd, 'USD')} sin cambio</span>}
              </span>
            )
          }
          tono={c.lineas_sin_cambio > 0 ? 'aviso' : 'neutro'}
          pie={
            c.lineas_sin_cambio > 0
              ? 'Falta el tipo de cambio de Tesorería para pasar los dólares a soles'
              : 'Todo lo que suma, en soles: los dólares al cambio del día'
          }
        />
        {verPrecio && <IndicadorMargen c={c} codigo={codigo} />}
        <Indicador
          titulo="Mano de obra"
          valor={faltaElPrecio(manoObra, c.horas_sin_costo, 'Sin costo') ?? moneda(manoObra)}
          tono={c.horas_sin_costo > 0 ? 'aviso' : 'neutro'}
          pie={[
            `${horasCortas(c.horas)} de personal`,
            c.horas_sin_costo > 0 && `${horasCortas(c.horas_sin_costo)} sin costo`,
            c.recargo_extras > 0 && `${moneda(c.recargo_extras)} de recargo de extras`,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
        <Indicador
          titulo="Materiales"
          valor={
            faltaElPrecio(c.materiales_pen + c.materiales_usd, c.materiales_sin_precio) ?? (
              <>
                {moneda(c.materiales_pen)}
                {c.materiales_usd > 0 && <span className="block text-sm">+ {moneda(c.materiales_usd, 'USD')}</span>}
              </>
            )
          }
          tono={c.materiales_sin_precio > 0 ? 'aviso' : 'neutro'}
          pie={`${c.salidas} ${c.salidas === 1 ? 'salida' : 'salidas'} del almacén${c.materiales_sin_precio > 0 ? ` · ${c.materiales_sin_precio} sin precio` : ''}`}
        />
        <Indicador
          titulo="Servicios"
          valor={
            <>
              {moneda(c.servicios_pen)}
              {c.servicios_usd > 0 && <span className="block text-sm">+ {moneda(c.servicios_usd, 'USD')}</span>}
            </>
          }
          pie={piesDeServicios(c)}
        />
        <Indicador
          titulo="Subcontratos"
          valor={
            <>
              {moneda(c.subcontratos_pen)}
              {c.subcontratos_usd > 0 && <span className="block text-sm">+ {moneda(c.subcontratos_usd, 'USD')}</span>}
            </>
          }
          tono={c.subcontratos_por_pagar > 0 ? 'aviso' : 'neutro'}
          pie={piesDeSubcontratos(c)}
        />
        <Indicador
          titulo="Gastos del mes y caja"
          valor={
            <>
              {moneda(c.gastos_mes_pen + c.caja_pen)}
              {c.gastos_mes_usd + c.caja_usd > 0 && <span className="block text-sm">+ {moneda(c.gastos_mes_usd + c.caja_usd, 'USD')}</span>}
            </>
          }
          pie={
            c.gastos_mes_pen + c.gastos_mes_usd + c.caja_pen + c.caja_usd === 0
              ? 'Luz, agua y demás gastos del mes, y los egresos de caja con este código'
              : [
                  `${moneda(c.gastos_mes_pen)} de gastos del mes`,
                  `${c.egresos_caja} ${c.egresos_caja === 1 ? 'egreso' : 'egresos'} de caja`,
                ].join(' · ')
          }
        />
      </div>
      {facturado && <LineaFacturado f={facturado} codigo={codigo} />}
      {(c.compras_pen > 0 || c.compras_usd > 0 || c.compras > 0) && (
        <p className="text-xs text-texto-suave">
          Compras con este código: <span className="tabular text-texto">{moneda(c.compras_pen)}</span>
          {c.compras_usd > 0 && <span className="tabular text-texto"> + {moneda(c.compras_usd, 'USD')}</span>} sin IGV en {c.compras}{' '}
          {c.compras === 1 ? 'OC' : 'OC'}. No se suman al costo: lo comprado entra al almacén y se cuenta cuando sale para este código.
        </p>
      )}
      {codigo !== CODIGO_SIN_AVANCE && <LineaCierre c={c} codigo={codigo} verPrecio={verPrecio} cierra={cierra} />}
    </div>
  )
}

/** El margen: la cotización aprobada sin IGV menos el costo, con el presupuesto de la hoja. */
function IndicadorMargen({ c, codigo }: { c: ResumenCodigo; codigo: string }) {
  const v = c.venta
  if (codigo === CODIGO_SIN_AVANCE) return <Indicador titulo="Margen" valor="No aplica" pie="PLANTA no se vende" />
  if (!v) return <Indicador titulo="Margen" valor="Sin cotización" pie="Sale cuando Gerencia aprueba la cotización con este código" />
  if (v.precio_neto_pen === null || v.margen_pct === null) {
    return (
      <Indicador
        titulo="Margen"
        valor="Falta el precio"
        tono="aviso"
        pie={
          v.sin_igv > 0
            ? 'Ventas no confirmó si la cotización incluye IGV'
            : v.sin_cambio > 0
              ? 'Falta el tipo de cambio del día en que se aprobó la cotización'
              : 'La cotización no tiene monto de venta'
        }
      />
    )
  }
  const incompleto = c.materiales_sin_precio > 0 || c.horas_sin_costo > 0 || c.lineas_sin_cambio > 0
  const tono = v.margen_pct < 0 || v.semaforo === 'EXCEDIDO' ? 'peligro' : v.semaforo === 'AJUSTADO' || incompleto ? 'aviso' : 'exito'
  return (
    <Indicador
      titulo="Margen"
      valor={<span data-margen={v.margen_pct}>{porcentaje(v.margen_pct, 1)}</span>}
      tono={tono}
      pie={[
        `${moneda(v.margen_pen)} de ${moneda(v.precio_neto_pen)} sin IGV`,
        v.consumido_pct !== null && `${porcentaje(v.consumido_pct, 0)} del presupuesto`,
        incompleto && 'con el costo incompleto',
      ]
        .filter(Boolean)
        .join(' · ')}
    />
  )
}

/** El cierre del costeo: congelado al entregar la unidad, o el botón para cerrarlo. */
function LineaCierre({ c, codigo, verPrecio, cierra }: { c: ResumenCodigo; codigo: string; verPrecio: boolean; cierra: boolean }) {
  const z = c.cierre
  if (!z) {
    if (!cierra) return null
    const precio = verPrecio && c.venta?.margen_pct !== null && c.venta?.margen_pct !== undefined
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-base)] border border-borde p-3 text-xs text-texto-suave" data-cierre="abierto">
        <p>Cuando se entregue la unidad, cierra el costeo: el costo y el margen de ese día quedan congelados como el costo de la unidad.</p>
        <CerrarCosteo
          codigo={codigo}
          resumen={`Hoy suma ${moneda(c.costo_pen)}${precio ? ` y deja un margen de ${porcentaje(c.venta?.margen_pct, 1)}` : ''}.`}
        />
      </div>
    )
  }
  const diferencia = Math.round((c.costo_pen - z.costo_pen) * 100) / 100
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-base)] border border-exito p-3 text-xs" data-cierre="cerrado">
      <div>
        <p className="text-texto">
          <Insignia tono="exito">Costeo cerrado</Insignia> el {fechaLarga(z.cerrado_en)}
          {z.cerrado_por && ` por ${z.cerrado_por}`}: <span className="tabular font-medium">{moneda(z.costo_pen)}</span>
          {verPrecio && z.margen_pct !== null && (
            <>
              , margen <span className="tabular font-medium">{porcentaje(z.margen_pct, 1)}</span>
            </>
          )}
          .
        </p>
        {diferencia !== 0 && (
          <p className="mt-1 text-aviso" data-despues-del-cierre={diferencia}>
            Desde el cierre el costo {diferencia > 0 ? 'subió' : 'bajó'} <span className="tabular">{moneda(Math.abs(diferencia))}</span>: hoy suma{' '}
            <span className="tabular">{moneda(c.costo_pen)}</span>. Si ese cambio es de la unidad, reabre el costeo y ciérralo otra vez.
          </p>
        )}
      </div>
      {cierra && <ReabrirCosteo codigo={codigo} />}
    </div>
  )
}

/** «Facturado US$ 29,500.00 en 1 factura · cobrado … · por cobrar …»: lo vendido junto a lo gastado. */
function LineaFacturado({ f, codigo }: { f: FacturadoDelCodigo; codigo: string }) {
  const montos = (r: Record<CodigoMoneda, number>) =>
    (['PEN', 'USD'] as const)
      .filter((m) => r[m] > 0)
      .map((m) => moneda(r[m], m))
      .join(' + ') || moneda(0)
  const porCobrar = f.saldo.PEN + f.saldo.USD > 0
  return (
    <p className="text-xs text-texto-suave" data-facturado>
      {f.facturas === 0 ? (
        'Sin factura de venta todavía: la registra Contabilidad sobre la cotización aprobada.'
      ) : (
        <>
          Facturado <span className="tabular text-texto">{montos(f.total)}</span> en {f.facturas} {f.facturas === 1 ? 'factura' : 'facturas'} · cobrado{' '}
          <span className="tabular text-texto">{montos(f.cobrado)}</span>
          {porCobrar && (
            <>
              {' '}
              · por cobrar <span className="tabular text-texto">{montos(f.saldo)}</span>
            </>
          )}
          .
        </>
      )}{' '}
      <Link href={enlaceCodigo(codigo, 'facturacion')} className="text-acento hover:underline">
        Ver factura y cobro
      </Link>
    </p>
  )
}

/** «2 OS aprobadas · 1 por aprobar (S/ 700.00)»: lo que espera a Gerencia no suma todavía. */
function piesDeServicios(c: ResumenCodigo) {
  const aprobadas = c.servicios - c.servicios_por_aprobar
  if (c.servicios === 0) return 'Ninguna orden de servicio'
  const partes = [`${aprobadas} ${aprobadas === 1 ? 'OS aprobada' : 'OS aprobadas'}`]
  if (c.servicios_por_aprobar > 0) {
    const espera = [c.servicios_por_aprobar_pen > 0 && moneda(c.servicios_por_aprobar_pen), c.servicios_por_aprobar_usd > 0 && moneda(c.servicios_por_aprobar_usd, 'USD')]
      .filter(Boolean)
      .join(' + ')
    partes.push(`${c.servicios_por_aprobar} por aprobar${espera ? ` (${espera})` : ''}`)
  }
  return partes.join(' · ')
}

/** «2 RxH pagados · 1 por pagar (S/ 900.00)»: el que espera a Tesorería ya suma, porque se debe. */
function piesDeSubcontratos(c: ResumenCodigo) {
  if (c.subcontratos === 0) return 'Ningún recibo por honorarios'
  const pagados = c.subcontratos - c.subcontratos_por_pagar
  const partes = [`${pagados} RxH ${pagados === 1 ? 'pagado' : 'pagados'}`]
  if (c.subcontratos_por_pagar > 0) {
    const falta = [
      c.subcontratos_por_pagar_pen > 0 && moneda(c.subcontratos_por_pagar_pen),
      c.subcontratos_por_pagar_usd > 0 && moneda(c.subcontratos_por_pagar_usd, 'USD'),
    ]
      .filter(Boolean)
      .join(' + ')
    partes.push(`${c.subcontratos_por_pagar} por pagar${falta ? ` (${falta})` : ''}`)
  }
  return partes.join(' · ')
}

/** Cada pestaña carga solo lo suyo. */
async function Vista({
  vista,
  codigo,
  perfil,
  avance,
}: {
  vista: VistaCodigo
  codigo: string
  perfil: PerfilSesion
  avance: AvanceDeCodigo | undefined
}) {
  if (vista === 'etapas') return <VistaEtapas codigo={codigo} />
  if (vista === 'planos') return <VistaPlanos codigo={codigo} />
  if (vista === 'materiales') return <VistaMateriales codigo={codigo} />
  if (vista === 'costeo') return <VistaCosteo codigo={codigo} perfil={perfil} />
  if (vista === 'personal') return <VistaPersonal codigo={codigo} />
  if (vista === 'documentos') return <VistaDocumentos codigo={codigo} perfil={perfil} />
  if (vista === 'facturacion') return <VistaFacturacion codigo={codigo} />
  return <VistaAvance codigo={codigo} perfil={perfil} avance={avance} />
}

/**
 * Cómo sale el porcentaje de arriba, con las mismas filas que la pestaña
 * «Etapas»: cada etapa con lo que vale. El número lo da la base
 * (`codigos_internos_avance`); aquí solo se muestra de dónde sale.
 */
async function ComoSaleElAvance({ codigo, avance }: { codigo: string; avance: AvanceDeCodigo | undefined }) {
  if (codigo === CODIGO_SIN_AVANCE) {
    return (
      <Tarjeta>
        <TarjetaCuerpo>
          <p className="text-sm font-medium text-texto">PLANTA no lleva avance</p>
          <p className="text-sm text-texto-suave">
            Agrupa el trabajo de la planta que no es de una unidad. Sus reportes diarios suman horas al costeo, pero no tiene etapas ni un final.
          </p>
        </TarjetaCuerpo>
      </Tarjeta>
    )
  }
  if (!avance) {
    return (
      <Tarjeta>
        <TarjetaCuerpo>
          <p className="text-sm font-medium text-texto">Avance en 0 %</p>
          <p className="text-sm text-texto-suave">
            Diseño todavía no armó las etapas de este código y ningún supervisor subió un reporte diario de él. El avance sale de las etapas que
            Diseño carga en «Control de etapas» y de lo que cada área reporta.
          </p>
        </TarjetaCuerpo>
      </Tarjeta>
    )
  }
  if (avance.fuente === 'REPORTES') {
    return (
      <Tarjeta>
        <TarjetaCuerpo>
          <p className="text-sm font-medium text-texto">Cómo sale el {avance.avance} %</p>
          <p className="text-sm text-texto-suave">
            Diseño todavía no armó las etapas de este código, así que el avance es el promedio del último avance de cada trabajo del reporte
            diario, área por área (abajo). Cuando Diseño las arme, el avance saldrá de ellas.
          </p>
        </TarjetaCuerpo>
      </Tarjeta>
    )
  }
  const etapas = await etapasDeCodigo(codigo)
  return (
    <Tarjeta data-como-sale>
      <TarjetaCabecera
        titulo={`Cómo sale el ${avance.avance} %`}
        descripcion="Es el promedio de las etapas que armó Diseño, todas con el mismo peso. La etapa terminada vale 100 %; la que no, lo que su área reporta de este código en el reporte diario (el promedio del último avance de cada uno de sus trabajos); sin reporte, 0 %."
      />
      <TarjetaCuerpo>
        <ul className="space-y-2">
          {etapas.map((e, i) => {
            const vale = e.fin_real ? 100 : (e.avance_reportado ?? 0)
            return (
              <li key={e.id} className="grid grid-cols-[1fr_8rem] items-center gap-3 text-sm" data-etapa={e.nombre} data-vale={Math.round(vale)}>
                <span className="min-w-0">
                  <span className="text-texto">
                    {i + 1}. {e.nombre}
                  </span>{' '}
                  <span className="text-xs text-texto-suave">
                    {e.area ?? 'Sin área del taller'} ·{' '}
                    {e.fin_real
                      ? `terminada el ${fecha(e.fin_real)}`
                      : e.avance_reportado !== null
                        ? 'sin terminar: lo que reporta su área'
                        : 'sin terminar y sin reporte diario'}
                  </span>
                </span>
                <Progreso valor={vale} mostrarValor etiqueta={`Lo que vale ${e.nombre}`} />
              </li>
            )
          })}
        </ul>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

async function VistaAvance({ codigo, perfil, avance }: { codigo: string; perfil: PerfilSesion; avance: AvanceDeCodigo | undefined }) {
  const filas = await avanceDelCodigo(codigo)
  const trabajos = ultimoAvancePorTrabajo(filas)
  const abreReporte = puede(perfil, ['reporte_diario.ver', 'reporte_diario.registrar'])

  type Reporte = { id: string; fecha: string; creado_en: string; asunto: string; area: string | null; estado: string; horas: number; personal_general: boolean; trabajos: typeof filas }
  const reportes = new Map<string, Reporte>()
  for (const f of filas) {
    const r = reportes.get(f.reporte_id) ?? {
      id: f.reporte_id,
      fecha: f.fecha,
      creado_en: f.creado_en,
      asunto: f.asunto,
      area: f.area,
      estado: f.estado,
      horas: f.horas_reporte,
      personal_general: f.personal_general,
      trabajos: [],
    }
    r.trabajos.push(f)
    reportes.set(f.reporte_id, r)
  }
  const lista = [...reportes.values()].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado_en.localeCompare(a.creado_en))

  const comoSale = <ComoSaleElAvance codigo={codigo} avance={avance} />

  if (lista.length === 0) {
    return (
      <>
        {comoSale}
        {avance && (
          <Tarjeta>
            <TarjetaCuerpo>
              <p className="text-sm font-medium text-texto">Sin reportes diarios de este código</p>
              <p className="text-sm text-texto-suave">
                Ningún supervisor subió un reporte diario de este código: las etapas sin terminar cuentan 0 %. En «Costeo» se ve lo que ya se gastó.
              </p>
            </TarjetaCuerpo>
          </Tarjeta>
        )}
      </>
    )
  }

  return (
    <>
      {comoSale}
      <Tarjeta>
        <TarjetaCabecera
          titulo="Cada trabajo con su último avance"
          descripcion={`El porcentaje que el supervisor de cada área puso la última vez que reportó cada trabajo. ${
            avance?.fuente === 'ETAPAS'
              ? 'Su promedio, área por área, es lo que vale la etapa de esa área mientras no termine.'
              : 'El avance del código es el promedio de estos.'
          }`}
        />
        <TarjetaCuerpo>
          <ul className="space-y-3">
            {trabajos.map((t) => (
              <li key={`${t.area ?? ''}|${t.trabajo}`} className="text-sm" data-trabajo={t.trabajo} data-area={t.area ?? ''}>
                <div className="grid grid-cols-[1fr_8rem] items-center gap-3">
                  <span className="text-texto">
                    {t.trabajo} <span className="text-xs text-texto-suave">· {t.area ?? 'Sin área'}</span>
                  </span>
                  <Progreso valor={t.avance} mostrarValor etiqueta={`Avance de ${t.trabajo}`} />
                </div>
                <p className="text-xs text-texto-suave">
                  {t.historial.length > 1
                    ? t.historial.map((h) => `${h.avance} % el ${fecha(h.fecha)}`).join(' → ')
                    : `Reportado el ${fecha(t.fecha)}`}
                </p>
              </li>
            ))}
          </ul>
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera
          titulo="Reportes diarios"
          descripcion="Los reportes vigentes de este código, del más nuevo al más viejo. Los anulados no cuentan para el avance ni para las horas."
        />
        <TarjetaCuerpo>
          <ul className="space-y-3">
            {lista.map((r) => {
              const estado = ESTADO_REPORTE[r.estado as EstadoReporte] ?? ESTADO_REPORTE.POR_VALIDAR
              const cuerpo = (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-texto-suave first-letter:uppercase">
                        {fechaLarga(r.fecha)} · {r.area ?? 'Sin área'}
                      </p>
                      <p className="font-semibold text-texto">{r.asunto}</p>
                    </div>
                    <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {[...r.trabajos]
                      .sort((a, b) => a.trabajo_orden - b.trabajo_orden)
                      .map((t) => (
                        <li key={t.trabajo_orden} className="grid grid-cols-[1fr_6.5rem] items-center gap-3 text-xs">
                          <span className="text-texto">
                            {t.trabajo}
                            {t.horas !== null && t.horas > 0 && (
                              <span className="text-texto-suave">
                                {' '}
                                · {horasCortas(t.horas)}, {t.personas} {t.personas === 1 ? 'persona' : 'personas'}
                              </span>
                            )}
                          </span>
                          <Progreso valor={t.avance} alto="sm" mostrarValor etiqueta={`Avance de ${t.trabajo}`} />
                        </li>
                      ))}
                  </ul>
                  <p className="mt-2 text-xs text-texto-suave">
                    <span className="tabular">{horasCortas(r.horas)}</span> de personal{r.personal_general && ' · personal general'}
                  </p>
                </>
              )
              return (
                <li key={r.id} data-reporte={r.id}>
                  {abreReporte ? (
                    <Link href={`/reportes-diarios/${r.id}`} className="block rounded-[var(--radius-base)] border border-borde p-3 hover:border-acento">
                      {cuerpo}
                    </Link>
                  ) : (
                    <div className="rounded-[var(--radius-base)] border border-borde p-3">{cuerpo}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}

async function VistaCosteo({ codigo, perfil }: { codigo: string; perfil: PerfilSesion }) {
  const [lineas, compras] = await Promise.all([costeoDelCodigo(codigo), comprasDelCodigo(codigo)])
  const manoObra = lineas.filter((l) => l.fuente === 'MANO_OBRA' || l.fuente === 'MANO_OBRA_SIN_COSTO' || l.fuente === 'RECARGO_EXTRAS')
  const materiales = lineas.filter((l) => l.fuente === 'MATERIALES' || l.fuente === 'MATERIALES_SIN_PRECIO')
  const servicios = lineas.filter((l) => l.fuente === 'SERVICIOS' || l.fuente === 'SERVICIOS_POR_APROBAR')
  const aprobados = servicios.filter((l) => l.fuente === 'SERVICIOS')
  const recibos = lineas.filter((l) => l.fuente === 'SUBCONTRATOS' || l.fuente === 'SUBCONTRATOS_POR_PAGAR')
  const gastos = lineas.filter((l) => l.fuente === 'GASTOS_DEL_MES' || l.fuente === 'CAJA')
  const suma = (ls: typeof lineas, m: 'PEN' | 'USD') => ls.reduce((n, l) => n + (l.moneda === m ? (l.monto ?? 0) : 0), 0)
  // Las horas del recargo ya están en las del reporte: el recargo solo suma soles.
  const horasMo = manoObra.reduce((n, l) => n + (l.fuente === 'RECARGO_EXTRAS' ? 0 : (l.horas ?? 0)), 0)
  const abrePdf = puede(perfil, ['compras.ver', 'almacen.recibir'])
  const abreServicios = puede(perfil, ['compras.crear', 'compras.ver', 'compras.detraccion'])
  const abreSubcontratos = puede(perfil, ['subcontratos.gestionar', 'subcontratos.ver'])

  return (
    <>
      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera
          titulo="Mano de obra"
          descripcion="Las horas del reporte diario y las que carga Recursos Humanos, a lo que cuesta la hora de cada persona, y el recargo que la planilla diaria pagó por las horas extras, repartido entre los códigos que esa persona trabajó ese día. Las horas de quien todavía no tiene costo se muestran sin sumar hasta que RR. HH. se lo ponga."
        />
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Fecha</TH>
              <TH>Trabajo</TH>
              <TH className="text-right">Horas</TH>
              <TH className="text-right">Costo</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {manoObra.length === 0 ? (
              <SinDatos titulo="Sin horas en este código" descripcion="Llegan del reporte diario del supervisor o las carga RR. HH. en su costeo." />
            ) : (
              <>
                {manoObra.map((l, i) => (
                  <TR key={`${l.referencia_id ?? 'rrhh'}-${l.fecha}-${l.concepto}-${l.fuente}-${i}`}>
                    <TD className="tabular align-top whitespace-nowrap">{fecha(l.fecha)}</TD>
                    <TD className="align-top">
                      <p className="text-texto">{l.concepto}</p>
                      <p className="text-xs text-texto-suave">
                        {l.detalle}
                        {l.cantidad > 0 && ` · ${l.cantidad} ${l.cantidad === 1 ? 'persona' : 'personas'}`}
                      </p>
                    </TD>
                    <TD className="tabular text-right align-top">
                      {horasCortas(l.horas ?? 0)}
                      {l.fuente === 'RECARGO_EXTRAS' && <p className="text-[11px] text-texto-suave">extras</p>}
                    </TD>
                    <TD className="tabular text-right align-top" data-recargo={l.fuente === 'RECARGO_EXTRAS' ? l.monto : undefined}>
                      {l.fuente === 'MANO_OBRA_SIN_COSTO' ? <Insignia tono="aviso">Sin costo</Insignia> : moneda(l.monto)}
                    </TD>
                  </TR>
                ))}
                <TR className="font-semibold">
                  <TD colSpan={2}>Total</TD>
                  <TD className="tabular text-right">{horasCortas(horasMo)}</TD>
                  <TD className="tabular text-right">
                    {faltaElPrecio(suma(manoObra, 'PEN'), manoObra.filter((l) => l.fuente === 'MANO_OBRA_SIN_COSTO').length, 'Sin costo') ??
                      moneda(suma(manoObra, 'PEN'))}
                  </TD>
                </TR>
              </>
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera
          titulo="Materiales salidos del almacén"
          descripcion="Cada salida para este código a su precio: el que quedó en la salida, o el de la última compra del material hasta ese día, o el de la valorización del almacén. Lo que no tiene ninguno sale «Sin precio» y no se suma como cero."
        />
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Fecha</TH>
              <TH>Material</TH>
              <TH className="text-right">Cantidad</TH>
              <TH className="hidden text-right sm:table-cell">Precio</TH>
              <TH className="text-right">Importe</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {materiales.length === 0 ? (
              <SinDatos titulo="Ninguna salida del almacén para este código" descripcion="Almacén las registra en el kardex con el código de la unidad o por su requerimiento." />
            ) : (
              <>
                {materiales.map((l, i) => (
                  <TR key={`${l.referencia_id ?? i}`}>
                    <TD className="tabular align-top whitespace-nowrap">{fecha(l.fecha)}</TD>
                    <TD className="align-top">
                      <p className="text-texto">{l.concepto}</p>
                      <p className="text-xs text-texto-suave">
                        {[l.documento, l.detalle].filter(Boolean).join(' · ')}
                      </p>
                    </TD>
                    <TD className="tabular text-right align-top whitespace-nowrap">
                      {cantidad(l.cantidad)} {l.unidad}
                    </TD>
                    <TD className="tabular hidden text-right align-top sm:table-cell">
                      {l.precio_unitario === null ? '—' : moneda(l.precio_unitario, l.moneda ?? 'PEN')}
                    </TD>
                    <TD className="tabular text-right align-top">
                      {l.fuente === 'MATERIALES_SIN_PRECIO' ? <Insignia tono="aviso">Sin precio</Insignia> : moneda(l.monto, l.moneda ?? 'PEN')}
                    </TD>
                  </TR>
                ))}
                <TR className="font-semibold">
                  <TD colSpan={2}>Total</TD>
                  <TD />
                  <TD className="hidden sm:table-cell" />
                  <TD className="tabular text-right">
                    {faltaElPrecio(suma(materiales, 'PEN') + suma(materiales, 'USD'), materiales.filter((l) => l.fuente === 'MATERIALES_SIN_PRECIO').length) ??
                      moneda(suma(materiales, 'PEN'))}
                    {suma(materiales, 'USD') > 0 && <p>+ {moneda(suma(materiales, 'USD'), 'USD')}</p>}
                  </TD>
                </TR>
              </>
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      <Tarjeta className="overflow-hidden" data-servicios>
        <TarjetaCabecera
          titulo="Órdenes de servicio"
          descripcion="Los trabajos de terceros para este código —torno, pintura, flete—, sin IGV. La aprobada por Gerencia suma al costo, porque no pasa por el almacén; la que espera su aprobación se muestra y no se suma todavía. Las rechazadas y las anuladas no aparecen."
        />
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>OS</TH>
              <TH>Servicio</TH>
              <TH className="hidden sm:table-cell">Gerencia</TH>
              <TH className="text-right">Importe</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {servicios.length === 0 ? (
              <SinDatos titulo="Ninguna orden de servicio con este código" descripcion="Logística pone el código interno al emitir la orden de servicio." />
            ) : (
              <>
                {servicios.map((l) => {
                  const aprobada = l.fuente === 'SERVICIOS'
                  return (
                    <TR key={l.referencia_id ?? l.documento} data-servicio={l.documento}>
                      <TD className="align-top">
                        {abreServicios ? (
                          <Link href={`/compras/servicios?codigo=${encodeURIComponent(codigo)}`} className="font-medium text-acento hover:underline">
                            {l.documento}
                          </Link>
                        ) : (
                          <p className="font-medium text-texto">{l.documento}</p>
                        )}
                        <p className="tabular text-xs text-texto-suave">{fecha(l.fecha)}</p>
                      </TD>
                      <TD className="align-top">
                        <p className="text-texto">{l.concepto}</p>
                        <p className="text-xs text-texto-suave">{l.detalle}</p>
                        <p className="mt-1 sm:hidden">
                          <Insignia tono={aprobada ? 'exito' : 'aviso'}>{aprobada ? 'Aprobada' : 'Por aprobar'}</Insignia>
                        </p>
                      </TD>
                      <TD className="hidden align-top sm:table-cell">
                        <Insignia tono={aprobada ? 'exito' : 'aviso'}>{aprobada ? 'Aprobada' : 'Por aprobar'}</Insignia>
                      </TD>
                      <TD className={`tabular text-right align-top whitespace-nowrap ${aprobada ? '' : 'text-texto-suave'}`}>
                        {moneda(l.monto, l.moneda ?? 'PEN')}
                        {!aprobada && <p className="text-[11px]">no suma</p>}
                      </TD>
                    </TR>
                  )
                })}
                <TR className="font-semibold">
                  <TD colSpan={2}>Total aprobado</TD>
                  <TD className="hidden sm:table-cell" />
                  <TD className="tabular text-right whitespace-nowrap">
                    {moneda(suma(aprobados, 'PEN'))}
                    {suma(aprobados, 'USD') > 0 && <p>+ {moneda(suma(aprobados, 'USD'), 'USD')}</p>}
                  </TD>
                </TR>
              </>
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      <Tarjeta className="overflow-hidden" data-subcontratos>
        <TarjetaCabecera
          titulo="Subcontratos"
          descripcion="Los recibos por honorarios de los trabajos que Administración encargó a gente de fuera para este código, por su monto bruto: la retención también es parte de lo que cuesta. Todos suman al costo, pagados o no, porque el recibo ya se debe; el que espera a Tesorería se marca para saber cuánto falta pagar. Los anulados no aparecen."
        />
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Recibo</TH>
              <TH>Trabajo</TH>
              <TH className="hidden sm:table-cell">Tesorería</TH>
              <TH className="text-right">Bruto</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {recibos.length === 0 ? (
              <SinDatos titulo="Ningún recibo por honorarios con este código" descripcion="Administración registra el subcontrato con el código interno y sube cada recibo." />
            ) : (
              <>
                {recibos.map((l) => {
                  const pagado = l.fuente === 'SUBCONTRATOS'
                  const estado = <Insignia tono={pagado ? 'exito' : 'aviso'}>{pagado ? 'Pagado' : 'Por pagar'}</Insignia>
                  return (
                    <TR key={l.referencia_id ?? l.documento} data-recibo={l.documento}>
                      <TD className="align-top">
                        {abreSubcontratos ? (
                          <Link href={`/subcontratos?codigo=${encodeURIComponent(codigo)}`} className="font-medium text-acento hover:underline">
                            {l.documento}
                          </Link>
                        ) : (
                          <p className="font-medium text-texto">{l.documento}</p>
                        )}
                        <p className="tabular text-xs text-texto-suave">{fecha(l.fecha)}</p>
                      </TD>
                      <TD className="align-top">
                        <p className="text-texto">{l.concepto}</p>
                        <p className="text-xs text-texto-suave">{l.detalle}</p>
                        <p className="mt-1 sm:hidden">{estado}</p>
                      </TD>
                      <TD className="hidden align-top sm:table-cell">{estado}</TD>
                      <TD className="tabular text-right align-top whitespace-nowrap">{moneda(l.monto, l.moneda ?? 'PEN')}</TD>
                    </TR>
                  )
                })}
                <TR className="font-semibold">
                  <TD colSpan={2}>Total</TD>
                  <TD className="hidden sm:table-cell" />
                  <TD className="tabular text-right whitespace-nowrap">
                    {moneda(suma(recibos, 'PEN'))}
                    {suma(recibos, 'USD') > 0 && <p>+ {moneda(suma(recibos, 'USD'), 'USD')}</p>}
                  </TD>
                </TR>
              </>
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      <Tarjeta className="overflow-hidden" data-gastos-y-caja>
        <TarjetaCabecera
          titulo="Gastos del mes y caja"
          descripcion="La parte de este código en los gastos del mes que registra Administración —luz, agua, celulares—: con su tasa, o en partes iguales entre los códigos que trabajaron ese mes. Y los egresos que Tesorería escribió en la caja diaria con este código: trámites, comisiones, compras chicas. Los pagos de OC, OS y recibos no entran aquí, porque ya se cuentan arriba."
        />
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Fecha</TH>
              <TH>Gasto</TH>
              <TH className="hidden text-right sm:table-cell">Total</TH>
              <TH className="text-right">A este código</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {gastos.length === 0 ? (
              <SinDatos
                titulo="Ningún gasto del mes ni egreso de caja en este código"
                descripcion="Los gastos del mes se reparten entre los códigos que trabajaron ese mes; los egresos de caja entran cuando Tesorería les pone el código."
              />
            ) : (
              <>
                {gastos.map((l, i) => (
                  <TR key={`${l.fuente}-${l.referencia_id ?? i}`} data-gasto={l.fuente}>
                    <TD className="tabular align-top whitespace-nowrap">{l.fuente === 'GASTOS_DEL_MES' ? fecha(l.fecha).slice(3) : fecha(l.fecha)}</TD>
                    <TD className="align-top">
                      <p className="text-texto">{l.concepto}</p>
                      <p className="text-xs text-texto-suave">
                        {l.fuente === 'CAJA' ? ['Caja diaria', l.detalle, l.documento].filter(Boolean).join(' · ') : l.detalle}
                      </p>
                    </TD>
                    <TD className="tabular hidden text-right align-top whitespace-nowrap text-texto-suave sm:table-cell">
                      {l.precio_unitario === null ? '—' : moneda(l.precio_unitario, l.moneda ?? 'PEN')}
                    </TD>
                    <TD className="tabular text-right align-top whitespace-nowrap">{moneda(l.monto, l.moneda ?? 'PEN')}</TD>
                  </TR>
                ))}
                <TR className="font-semibold">
                  <TD colSpan={2}>Total</TD>
                  <TD className="hidden sm:table-cell" />
                  <TD className="tabular text-right whitespace-nowrap">
                    {moneda(suma(gastos, 'PEN'))}
                    {suma(gastos, 'USD') > 0 && <p>+ {moneda(suma(gastos, 'USD'), 'USD')}</p>}
                  </TD>
                </TR>
              </>
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera
          titulo="Compras con este código"
          descripcion="Las órdenes de compra sin IGV, menos las rechazadas. No se suman al costo: lo comprado entra al almacén y se cuenta cuando sale para este código."
        />
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>OC</TH>
              <TH className="hidden sm:table-cell">Proveedor</TH>
              <TH>En qué va</TH>
              <TH className="text-right">Importe</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {compras.length === 0 ? (
              <SinDatos titulo="Ninguna compra con este código" descripcion="Logística pone el código en la OC al comprar para una unidad." />
            ) : (
              compras.map((oc) => {
                const situacion = situacionCompra({ ...oc, validacion: validacionDeCompra(oc.validaciones) })
                const numero = oc.numero ?? 'OC sin número'
                return (
                  <TR key={oc.id} data-compra={oc.id}>
                    <TD className="align-top">
                      {abrePdf ? (
                        <a href={`/compras/${oc.id}/pdf`} className="font-medium text-acento hover:underline" target="_blank" rel="noopener">
                          {numero}
                        </a>
                      ) : (
                        <p className="font-medium text-texto">{numero}</p>
                      )}
                      <p className="text-xs text-texto-suave">
                        {fecha(oc.fecha)}
                        {oc.requerimientos && ` · ${oc.requerimientos}`}
                      </p>
                      <p className="text-xs text-texto sm:hidden">{oc.proveedor}</p>
                    </TD>
                    <TD className="hidden align-top sm:table-cell">{oc.proveedor}</TD>
                    <TD className="align-top">
                      <Insignia tono={situacion.tono}>{situacion.etiqueta}</Insignia>
                    </TD>
                    <TD className="tabular text-right align-top">
                      {moneda(oc.monto, oc.moneda)}
                      {oc.sin_precio > 0 && (
                        <p className="text-xs text-aviso">
                          {oc.sin_precio} de {oc.lineas} {oc.lineas === 1 ? 'línea' : 'líneas'} sin precio
                        </p>
                      )}
                    </TD>
                  </TR>
                )
              })
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}

async function VistaPersonal({ codigo }: { codigo: string }) {
  const personas = await personalDelCodigo(codigo)
  const horas = personas.reduce((n, p) => n + p.horas, 0)
  return (
    <Tarjeta className="overflow-hidden">
      <TarjetaCabecera
        titulo="Quién trabajó en este código"
        descripcion="Las horas de cada persona, del reporte diario y las cargadas por Recursos Humanos. Sin lo que cuesta cada una: eso lo ve solo RR. HH."
      />
      <Tabla>
        <TablaCabecera>
          <tr>
            <TH>Persona</TH>
            <TH className="text-right">Días</TH>
            <TH className="text-right">Horas</TH>
            <TH className="hidden sm:table-cell">Desde y hasta</TH>
          </tr>
        </TablaCabecera>
        <tbody>
          {personas.length === 0 ? (
            <SinDatos titulo="Nadie tiene horas en este código" descripcion="Llegan del reporte diario del supervisor o las carga RR. HH." />
          ) : (
            <>
              {personas.map((p) => (
                <TR key={p.trabajador_id} data-persona={p.trabajador_id}>
                  <TD className="align-top">
                    <p className="text-texto">{p.nombre}</p>
                    <p className="text-xs text-texto-suave">{p.cargo ?? 'Sin cargo'}</p>
                  </TD>
                  <TD className="tabular text-right align-top">{p.dias}</TD>
                  <TD className="tabular text-right align-top">
                    {horasCortas(p.horas)}
                    {p.horas_sin_costo > 0 && <p className="text-xs text-aviso">{horasCortas(p.horas_sin_costo)} sin costo</p>}
                  </TD>
                  <TD className="tabular hidden align-top text-xs text-texto-suave sm:table-cell">
                    {p.primer_dia === p.ultimo_dia ? fecha(p.primer_dia) : `${fecha(p.primer_dia)} al ${fecha(p.ultimo_dia)}`}
                  </TD>
                </TR>
              ))}
              <TR className="font-semibold">
                <TD colSpan={2}>
                  {personas.length} {personas.length === 1 ? 'persona' : 'personas'}
                </TD>
                <TD className="tabular text-right">{horasCortas(horas)}</TD>
                <TD className="hidden sm:table-cell" />
              </TR>
            </>
          )}
        </tbody>
      </Tabla>
    </Tarjeta>
  )
}

async function VistaDocumentos({ codigo, perfil }: { codigo: string; perfil: PerfilSesion }) {
  const documentos = await documentosDelCodigo(codigo)
  const enlace: Record<string, ((d: (typeof documentos)[number]) => string) | null> = {
    OT: puede(perfil, 'ordenes.ver') ? (d) => `/ordenes/${d.id}` : null,
    COTIZACION: puede(perfil, 'cotizaciones.ver_pdf_comercial') ? (d) => `/cotizaciones/pdf?q=${encodeURIComponent(d.numero)}` : null,
    UNIDAD: puede(perfil, ['clientes.ver', 'produccion.ver']) ? (d) => `/unidades/${d.id}` : null,
    REQUERIMIENTO: null,
    SERVICIO: puede(perfil, ['compras.crear', 'compras.ver', 'compras.detraccion'])
      ? () => `/compras/servicios?codigo=${encodeURIComponent(codigo)}`
      : null,
    VEHICULO: puede(perfil, ['vehiculos.registrar', 'vehiculos.ver']) ? (d) => `/vehiculos/${d.id}` : null,
  }
  const estado = (tipo: string, valor: string) =>
    tipo === 'REQUERIMIENTO'
      ? definir(ESTADO_REQUERIMIENTO, valor)
      : tipo === 'OT'
        ? definir(ESTADO_OT, valor)
        : tipo === 'SERVICIO'
          ? definir(ESTADO_SERVICIO_CODIGO, valor)
          : definir(ESTADO_DOCUMENTO_CODIGO, valor)

  return (
    <>
      <p className="text-sm text-texto-suave">
        Hoy la OT y la cotización se encuentran por la unidad: si en Unidades una unidad lleva este código, aquí salen su OT y la cotización PDF
        de esa OT. Los reportes, las salidas del almacén, los requerimientos, las compras y las órdenes de servicio llevan el código escrito a
        mano.
      </p>
      {Object.entries(TIPO_DOCUMENTO_CODIGO).map(([tipo, def]) => {
        const deTipo = documentos.filter((d) => d.tipo === tipo)
        const abrir = enlace[tipo]
        return (
          <Tarjeta key={tipo} data-tipo={tipo}>
            <TarjetaCabecera titulo={`${def.titulo}${deTipo.length > 0 ? ` (${deTipo.length})` : ''}`} />
            <TarjetaCuerpo>
              {deTipo.length === 0 ? (
                <p className="text-sm text-texto-suave">{def.vacio}</p>
              ) : (
                <ul className="divide-y divide-borde">
                  {deTipo.map((d) => {
                    const e = estado(tipo, d.estado)
                    return (
                      <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          {abrir ? (
                            <Link href={abrir(d)} className="font-medium text-acento hover:underline">
                              {d.numero}
                            </Link>
                          ) : (
                            <p className="font-medium text-texto">{d.numero}</p>
                          )}
                          {d.detalle && <p className="text-xs text-texto-suave">{d.detalle}</p>}
                        </div>
                        <div className="text-right">
                          <Insignia tono={e.tono}>{e.etiqueta}</Insignia>
                          {d.fecha && <p className="tabular mt-0.5 text-xs text-texto-suave">{fecha(d.fecha)}</p>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </TarjetaCuerpo>
          </Tarjeta>
        )
      })}
    </>
  )
}

/**
 * La cotización aprobada de este código y sus facturas de venta con cada cobro
 * y su voucher (migración 20261015124000). Solo lectura: factura Contabilidad y
 * cobra Tesorería, cada una en su pantalla.
 */
async function VistaFacturacion({ codigo }: { codigo: string }) {
  const [cotizaciones, facturas] = await Promise.all([cotizacionesAprobadas(codigo), facturasDelCodigo(codigo)])
  const deMoneda = (m: string | null): CodigoMoneda => (m === 'USD' ? 'USD' : 'PEN')
  return (
    <>
      <Tarjeta>
        <TarjetaCabecera
          titulo="Cotización aprobada"
          descripcion="Lo que se le cobra al cliente por este código. Contabilidad factura según ella."
        />
        <TarjetaCuerpo>
          {cotizaciones.length === 0 ? (
            <p className="text-sm text-texto-suave">
              Ninguna cotización aprobada lleva este código. Una cotización toma el código cuando Administración carga su OT con la unidad que lo lleva.
            </p>
          ) : (
            <ul className="divide-y divide-borde">
              {cotizaciones.map((c) => {
                const m = deMoneda(c.moneda)
                const total = totalConIgv(c.monto_venta === null ? null : Number(c.monto_venta), c.incluye_igv)
                const pdf = c.archivo_mime === 'application/pdf'
                return (
                  <li key={c.cotizacion_id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0" data-cotizacion={c.numero ?? undefined}>
                    <div className="min-w-0">
                      <p className="font-medium text-texto">Cotización {c.numero}</p>
                      <p className="text-xs text-texto-suave">{c.cliente ?? 'Cliente sin registrar'}</p>
                      <p className="tabular text-xs text-texto-suave">
                        {Number(c.facturas) === 0 ? 'Contabilidad aún no la factura' : `Facturado ${moneda(c.facturado, m)} · cobrado ${moneda(c.cobrado, m)}`}
                      </p>
                      {c.url && (
                        <a
                          href={c.url}
                          target={pdf ? '_blank' : undefined}
                          rel="noreferrer"
                          className="inline-flex min-h-11 items-center gap-1 text-xs text-acento hover:underline sm:min-h-0"
                        >
                          {pdf ? <FileText aria-hidden className="size-3.5" /> : <Download aria-hidden className="size-3.5" />}
                          {pdf ? 'Abrir la cotización' : 'Bajar la cotización'}
                        </a>
                      )}
                    </div>
                    <strong className="tabular">{total === null ? <span className="font-normal text-texto-suave">Sin total</span> : moneda(total, m)}</strong>
                  </li>
                )
              })}
            </ul>
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera
          titulo={`Facturas de venta${facturas.length > 0 ? ` (${facturas.length})` : ''}`}
          descripcion="Cada factura que registró Contabilidad, con los cobros que registró Tesorería y su voucher. Las anuladas salen tachadas."
        />
        <TarjetaCuerpo className="space-y-3">
          {facturas.length === 0 ? (
            <p className="text-sm text-texto-suave">Contabilidad todavía no registra una factura de este código.</p>
          ) : (
            facturas.map((f) => <FacturaDeVenta key={f.id} factura={f} />)
          )}
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}
