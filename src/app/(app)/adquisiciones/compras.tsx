import { FileUp } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { Paginacion } from '@/components/estructura/paginacion'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import {
  bucketDelDocumento,
  bucketDelPago,
  claveDeArchivo,
  enlacesDeCompras,
  trazabilidadDeCompras,
  type CompraTrazada,
} from '@/lib/datos/trazabilidad-compras'
import {
  ESTADO_PAGO,
  SITUACIONES,
  TIPO_DOCUMENTO_COMPRA,
  TIPO_DOCUMENTO_SERVICIO,
  anexoPorRevisarAlAnular,
  bloqueoDelAnexo,
  enSituacion,
  guiaPorCargar,
} from '@/lib/dominio/adquisiciones'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { TIPO_COMPROBANTE, definir } from '@/lib/dominio/estados'
import { BUCKET_PAGOS_FACTURAS } from '@/lib/dominio/finanzas'
import { ESTADO_SERVICIO, situacionCompra } from '@/lib/dominio/logistica'
import { APROBACION_COMPRA, condicionDePago } from '@/lib/dominio/proveedores'
import { cantidad, fecha, hoyLima, moneda } from '@/lib/format'
import { puede, type PerfilSesion } from '@/lib/sesion'
import { PasarCompraATesoreria } from '@/app/(app)/tesoreria/formularios'

import { AnularAnexo } from './anular-anexo'
import { AnularGuia, CargarGuia } from './guia-remision'

const POR_PAGINA = 50
const RUTA = '/adquisiciones'
const enlace = 'font-medium text-acento hover:underline'
// En el teléfono cada enlace mide 44 px de alto, como las pastillas: son los
// comprobantes que se abren con el dedo.
const toque = 'inline-flex min-h-11 items-center sm:min-h-0'
const codigo = (m: string | null) => (m === 'USD' ? 'USD' : 'PEN')

type Params = Record<string, string | string[] | undefined>

/** A qué puede ir quien mira: cada enlace solo sale si su pantalla o su archivo lo deja entrar. */
type Acceso = {
  rq: boolean
  oc: boolean
  proveedor: boolean
  codigo: boolean
  /** «pagar» salta a pagar; «ver», a mirar: Gerencia lee Cuentas por pagar pero no paga. */
  porPagar: 'pagar' | 'ver' | null
  pagosServicio: 'pagar' | 'ver' | null
  /** Contabilidad carga y anula la guía de remisión aquí (migración 20261020171000). */
  cargaGuia: boolean
  /** Logística, que anexa la factura o la boleta de la OC, la anula si se equivocó (migración 20261020210000). */
  anulaAnexo: boolean
  /** El administrador del sistema anula también el anexo de la factura ya pagada; a nadie más se le ofrece. */
  esAdmin: boolean
  hoy: string
}

function texto(valor: string | string[] | undefined) {
  return typeof valor === 'string' ? valor.trim() : ''
}

/** Lo que encuentra el buscador: la orden, el proveedor, de dónde salió y sus comprobantes. */
function camposDeBusqueda(f: CompraTrazada): (string | null)[] {
  return [
    f.numero,
    f.referencia,
    f.proveedor,
    f.descripcion,
    f.emitido_por,
    ...f.requerimientos.map((r) => r.numero),
    ...f.ordenes,
    ...f.codigos,
    ...f.areas,
    ...f.facturas.map((x) => x.numero),
    ...f.pagos.flatMap((p) => [p.comprobante, p.operacion]),
    ...f.documentos.map((d) => d.numero),
    f.guia?.numero ?? null,
  ]
}

/**
 * Cada OC y cada OS en una fila, de izquierda a derecha como se vive la compra:
 * de qué RQ u OT salió, el proveedor, el total, la aprobación y en qué va, sus
 * documentos (cotización, factura, boleta, guía…) y si se pagó, con el voucher.
 * Se lee de `trazabilidad_de_compras()` (migración 20261020170000); los enlaces
 * se firman solo para la página que se muestra.
 */
export async function PestanaCompras({ perfil, params }: { perfil: PerfilSesion; params: Params }) {
  const acceso: Acceso = {
    rq: puede(perfil, ['requerimientos.emitir', 'requerimientos.administracion', 'requerimientos.ver', 'compras.crear', 'almacen.recibir']),
    oc: puede(perfil, ['compras.ver', 'almacen.recibir']),
    proveedor: puede(perfil, 'proveedores.ver'),
    codigo: puede(perfil, 'codigos_internos.ver'),
    // Como las pantallas de Tesorería: pagar pide además la caja de la que sale.
    porPagar:
      puede(perfil, 'tesoreria.registrar_pagos') && puede(perfil, 'tesoreria.caja')
        ? 'pagar'
        : puede(perfil, 'tesoreria.ver_documentos')
          ? 'ver'
          : null,
    pagosServicio:
      puede(perfil, 'tesoreria.pagar_servicios') && puede(perfil, 'tesoreria.caja')
        ? 'pagar'
        : puede(perfil, ['tesoreria.pagar_servicios', 'tesoreria.ver_documentos'])
          ? 'ver'
          : null,
    cargaGuia: puede(perfil, 'compras.guia_remision'),
    anulaAnexo: puede(perfil, 'compras.crear'),
    esAdmin: perfil.rol.codigo === 'ADMIN',
    hoy: hoyLima(),
  }
  const busqueda = texto(params.q)
  const palabras = palabrasDeBusqueda(busqueda)
  const tipo = params.tipo === 'oc' ? 'OC' : params.tipo === 'os' ? 'OS' : null
  // «Guía por cargar» es el trabajo de Contabilidad: para ella va primera, porque
  // el conductor la espera; a los demás no les dice nada.
  const situaciones = acceso.cargaGuia
    ? [...SITUACIONES.filter((s) => s.valor === 'guia'), ...SITUACIONES.filter((s) => s.valor !== 'guia')]
    : SITUACIONES.filter((s) => s.valor !== 'guia')
  const situacion = situaciones.find((s) => s.valor === params.situacion)?.valor ?? null

  const todas = await trazabilidadDeCompras()
  const guiasPorCargar = acceso.cargaGuia ? todas.filter(guiaPorCargar).length : 0
  const buscadas = todas.filter((f) => coincide(palabras, camposDeBusqueda(f)))
  const delTipo = buscadas.filter((f) => !tipo || f.tipo === tipo)
  const enSuSituacion = buscadas.filter((f) => !situacion || enSituacion(f, situacion))
  const filas = delTipo.filter((f) => !situacion || enSituacion(f, situacion))

  const paginas = Math.max(1, Math.ceil(filas.length / POR_PAGINA))
  const pagina = Math.min(Math.max(1, Number.parseInt(texto(params.pagina), 10) || 1), paginas)
  const visibles = filas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  const { urls, sinFirmar } = await enlacesDeCompras(visibles)
  const hayFiltros = Boolean(busqueda || tipo || situacion)
  const vacio =
    todas.length === 0
      ? {
          titulo: 'Todavía no hay órdenes de compra ni de servicio',
          descripcion: 'Cuando Logística emita la primera, sale aquí con su RQ, su aprobación, su factura y su pago.',
        }
      : situacion === 'guia' && !busqueda && !tipo
        ? {
            titulo: 'No hay guías de remisión por cargar',
            descripcion: 'Cuando Logística ponga una OC en la lista del conductor, sale aquí con su peso para que cargues su guía.',
          }
        : { titulo: 'Ninguna orden con ese filtro', descripcion: 'Borra la búsqueda o elige «Todas».' }

  return (
    <>
      <div className="mb-4 space-y-3">
        {sinFirmar && (
          <p role="alert" className="text-sm text-peligro">
            No se pudieron preparar los enlaces de algunos documentos: salen sin enlace. Recarga la página para volver a intentar.
          </p>
        )}
        {guiasPorCargar > 0 && situacion !== 'guia' && (
          <p className="text-sm text-aviso">
            <Link href={`${RUTA}?situacion=guia`} className={`${toque} gap-1.5 font-medium hover:underline`}>
              <FileUp aria-hidden className="size-4" />
              {guiasPorCargar === 1 ? 'Una guía de remisión por cargar' : `${cantidad(guiasPorCargar)} guías de remisión por cargar`}
            </Link>
          </p>
        )}
        <BuscadorSimple ruta={RUTA} etiqueta="Buscar orden" marcador="OC, OS, RQ, OT, código, proveedor o factura" />
        <PastillaFiltro
          ruta={RUTA}
          clave="tipo"
          params={params}
          activo={texto(params.tipo) || null}
          etiqueta="Qué órdenes mostrar"
          opciones={[
            { valor: null, etiqueta: `Todas las órdenes (${enSuSituacion.length})` },
            { valor: 'oc', etiqueta: `Órdenes de compra (${enSuSituacion.filter((f) => f.tipo === 'OC').length})` },
            { valor: 'os', etiqueta: `Órdenes de servicio (${enSuSituacion.filter((f) => f.tipo === 'OS').length})` },
          ]}
        />
        <PastillaFiltro
          ruta={RUTA}
          clave="situacion"
          params={params}
          activo={situacion}
          etiqueta="En qué van"
          opciones={[
            { valor: null, etiqueta: `Todas (${delTipo.length})` },
            ...situaciones.map((s) => ({ valor: s.valor, etiqueta: `${s.etiqueta} (${delTipo.filter((f) => enSituacion(f, s.valor)).length})` })),
          ]}
        />
      </div>

      {/* En el teléfono, una tarjeta por orden: siete columnas se corrían de costado. */}
      <div className="sm:hidden">
        {visibles.length === 0 ? (
          <Tarjeta className="px-4 py-8 text-center">
            <p className="text-sm font-medium text-texto">{vacio.titulo}</p>
            <p className="mt-1 text-xs text-texto-suave">{vacio.descripcion}</p>
          </Tarjeta>
        ) : (
          <Tarjeta className="overflow-hidden">
            <ul className="divide-y divide-borde" aria-label="Órdenes de compra y de servicio">
              {visibles.map((f) => (
                <li key={f.id} className="space-y-2 px-4 py-3" data-orden-telefono={nombreDe(f)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <NumeroDeOrden f={f} acceso={acceso} />
                      <p className="text-sm text-texto">
                        <NombreProveedor proveedor={f.proveedor} acceso={acceso} />
                      </p>
                    </div>
                    <Total f={f} />
                  </div>
                  <Origen f={f} acceso={acceso} />
                  <EnQueVa f={f} />
                  <Documentos f={f} urls={urls} acceso={acceso} />
                  <Pago f={f} urls={urls} acceso={acceso} />
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}
      </div>

      <Tarjeta className="hidden overflow-hidden sm:block">
        <Tabla aria-label="Órdenes de compra y de servicio: de dónde salen, su aprobación, sus documentos y su pago">
          <TablaCabecera>
            <tr>
              <TH>Orden</TH>
              <TH>De dónde sale</TH>
              <TH>Proveedor</TH>
              <TH className="text-right">Total</TH>
              <TH>En qué va</TH>
              <TH>Documentos</TH>
              <TH>Pago</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {visibles.length === 0 ? (
              <SinDatos colSpan={7} titulo={vacio.titulo} descripcion={vacio.descripcion} />
            ) : (
              visibles.map((f) => (
                <TR key={f.id} data-orden={nombreDe(f)}>
                  <TD className="min-w-36 align-top">
                    <NumeroDeOrden f={f} acceso={acceso} />
                  </TD>
                  <TD className="min-w-32 align-top">
                    <Origen f={f} acceso={acceso} />
                  </TD>
                  <TD className="min-w-36 align-top">
                    <NombreProveedor proveedor={f.proveedor} acceso={acceso} />
                    {f.referencia && f.referencia !== f.numero && (
                      <p className="mt-0.5 max-w-48 text-[11px] text-texto-suave">Ref. del proveedor: {f.referencia}</p>
                    )}
                  </TD>
                  <TD className="align-top">
                    <Total f={f} />
                  </TD>
                  <TD className="align-top">
                    <EnQueVa f={f} />
                  </TD>
                  <TD className="min-w-44 align-top">
                    <Documentos f={f} urls={urls} acceso={acceso} />
                  </TD>
                  <TD className="min-w-40 align-top">
                    <Pago f={f} urls={urls} acceso={acceso} />
                  </TD>
                </TR>
              ))
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      <div className="mt-4">
        <Paginacion ruta={RUTA} pagina={pagina} paginas={paginas} total={filas.length} porPagina={POR_PAGINA} params={params} />
      </div>
      {hayFiltros && filas.length > 0 && (
        <p className="mt-2 text-xs text-texto-suave">
          {filas.length === 1 ? 'Una orden' : `${cantidad(filas.length)} órdenes`} con ese filtro, de {cantidad(todas.length)}.
        </p>
      )}
    </>
  )
}

/**
 * El número de la OC o de la OS. Las OC de antes de la serie OC-…-MW no tienen
 * número propio: su referencia es la cotización del proveedor y no se muestra
 * como si fuera el número (así salía «OC-0001» en Adquisiciones).
 */
function nombreDe(f: CompraTrazada) {
  return f.numero ?? (f.tipo === 'OC' ? 'OC sin número' : 'OS sin número')
}

function NumeroDeOrden({ f, acceso }: { f: CompraTrazada; acceso: Acceso }) {
  // El PDF de la OC no sale mientras espera a Gerencia o si la rechazó (compras/[id]/pdf).
  const conPdf = f.tipo === 'OC' && acceso.oc && f.aprobacion !== 'POR_APROBAR' && f.aprobacion !== 'RECHAZADA'
  return (
    <div className="space-y-0.5">
      <p className="flex flex-wrap items-center gap-1.5">
        <Insignia tono={f.tipo === 'OC' ? 'neutro' : 'info'}>{f.tipo}</Insignia>
        {conPdf ? (
          <a href={`/compras/${f.id}/pdf`} target="_blank" rel="noopener" className={`tabular whitespace-nowrap ${toque} ${enlace}`}>
            {nombreDe(f)}
          </a>
        ) : (
          <span className="tabular font-medium whitespace-nowrap">{nombreDe(f)}</span>
        )}
      </p>
      <p className="text-[11px] text-texto-suave">
        <span className="tabular">{fecha(f.creado_en)}</span>
        {f.emitido_por && ` · ${f.emitido_por}`}
      </p>
      {f.tipo === 'OS' && f.descripcion && <p className="line-clamp-2 max-w-56 text-xs text-texto-suave">{f.descripcion}</p>}
      {!f.numero && f.referencia && <p className="text-[11px] text-texto-tenue sm:hidden">Ref. del proveedor: {f.referencia}</p>}
    </div>
  )
}

/** De dónde sale: los RQ que atiende, la OT, el código interno y el área. */
function Origen({ f, acceso }: { f: CompraTrazada; acceso: Acceso }) {
  const sinRq =
    f.tipo === 'OS' ? 'Sin RQ: servicio' : f.origen === 'REQUERIMIENTO' ? 'Requerimiento de la OT' : 'Compra directa'
  return (
    <div className="space-y-0.5 text-xs">
      {f.requerimientos.length > 0 ? (
        <p className="flex flex-wrap gap-x-2">
          {f.requerimientos.map((rq) =>
            acceso.rq ? (
              <Link key={rq.id} href={`/requerimientos?rq=${rq.id}`} className={`tabular whitespace-nowrap ${toque} ${enlace}`}>
                {rq.numero}
              </Link>
            ) : (
              <span key={rq.id} className="tabular whitespace-nowrap">
                {rq.numero}
              </span>
            ),
          )}
        </p>
      ) : (
        <p className="text-texto-suave">{sinRq}</p>
      )}
      {f.ordenes.length > 0 && <p className="tabular text-texto">OT {f.ordenes.join(', ')}</p>}
      {f.codigos.length > 0 && (
        <p className="flex flex-wrap gap-x-2">
          {f.codigos.map((c) =>
            acceso.codigo && c !== 'PLANTA' ? (
              <Link key={c} href={`/codigos-internos/detalle?codigo=${encodeURIComponent(c)}`} className={`tabular ${toque} ${enlace}`}>
                {c}
              </Link>
            ) : (
              <span key={c} className="tabular text-texto">
                {c}
              </span>
            ),
          )}
        </p>
      )}
      {f.areas.length > 0 && <p className="text-texto-suave">{f.areas.join(', ')}</p>}
    </div>
  )
}

function NombreProveedor({ proveedor, acceso }: { proveedor: string; acceso: Acceso }) {
  return acceso.proveedor ? (
    <Link href={`/proveedores?q=${encodeURIComponent(proveedor)}`} className={`${toque} ${enlace}`}>
      {proveedor}
    </Link>
  ) : (
    <>{proveedor}</>
  )
}

/** El total impreso, con IGV si va con factura, y cómo se paga. */
function Total({ f }: { f: CompraTrazada }) {
  return (
    <div className="shrink-0 text-right">
      <p className="tabular font-semibold whitespace-nowrap text-texto">
        {f.total === null ? '—' : f.sin_precio ? <span className="font-normal text-aviso">Precio pendiente</span> : moneda(f.total, codigo(f.moneda))}
      </p>
      <p className="text-[11px] whitespace-nowrap text-texto-suave">
        {condicionDePago(f.condicion_pago, f.dias_credito)}
        {/* La que iba con boleta y el proveedor entregó factura ya no es «sin factura». */}
        {f.tipo === 'OC' &&
          f.con_factura === false &&
          (f.facturas.length > 0 || f.documentos.some((d) => d.tipo === 'FACTURA' && !d.anulado_en) ? ' · iba con boleta' : ' · sin factura')}
      </p>
    </div>
  )
}

/** La aprobación de Gerencia y en qué va: el recojo y el almacén de la OC, la ejecución de la OS. */
function EnQueVa({ f }: { f: CompraTrazada }) {
  const aprobacion = definir(APROBACION_COMPRA, f.aprobacion)
  const detenida = f.aprobacion === 'POR_APROBAR' || f.aprobacion === 'RECHAZADA'
  const avance =
    f.tipo === 'OS'
      ? f.estado && f.estado !== 'EMITIDA'
        ? definir(ESTADO_SERVICIO, f.estado)
        : null
      : detenida
        ? null
        : situacionCompra({ aprobacion: f.aprobacion, recojo: f.recojo, entregado_almacen_en: f.entregado_almacen_en, validacion: f.ingreso })
  return (
    <div className="flex flex-wrap items-start gap-1 sm:flex-col">
      <Insignia tono={aprobacion.tono}>{aprobacion.etiqueta}</Insignia>
      {/* La fecha va pegada a la aprobación: debajo del avance parecía la del recojo. */}
      {f.aprobado_en && f.aprobacion === 'APROBADA' && <span className="tabular text-[11px] text-texto-suave">el {fecha(f.aprobado_en)}</span>}
      {avance && <Insignia tono={avance.tono}>{avance.etiqueta}</Insignia>}
      {f.aprobacion === 'RECHAZADA' && f.motivo_rechazo && <p className="w-full max-w-48 text-[11px] text-texto-suave">{f.motivo_rechazo}</p>}
      {f.anulado_en && (
        <p className="w-full max-w-48 text-[11px] text-texto-suave">
          Anulada el {fecha(f.anulado_en)}
          {f.motivo_anulacion && `: ${f.motivo_anulacion}`}
        </p>
      )}
    </div>
  )
}

function nombreDeComprobante(tipo: string) {
  return tipo === 'FACTURA_COMPRA' ? 'Factura' : definir(TIPO_COMPROBANTE, tipo).etiqueta
}

function Archivo({ url, children }: { url: string | undefined; children: ReactNode }) {
  // El texto va en un solo span: dentro del inline-flex de `toque`, el espacio
  // entre «Factura» y su número se perdía y se leía «FacturaF001-123».
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className={`${toque} ${enlace}`}>
      <span>{children}</span>
    </a>
  ) : (
    <span className="font-medium text-texto">{children}</span>
  )
}

/**
 * Los documentos de la orden: la factura que registró Contabilidad, los PDF que
 * adjuntó Logística con su tipo (la cotización, la boleta…), la guía de
 * remisión y, de la OS, su factura y su contrato, y el número del comprobante
 * que Tesorería anotó al pagar si nadie adjuntó ese comprobante.
 */
function Documentos({ f, urls, acceso }: { f: CompraTrazada; urls: Map<string, string>; acceso: Acceso }) {
  // La factura que Contabilidad registró sobre el PDF que anexó Logística es un solo archivo.
  const deFacturas = new Set(f.facturas.flatMap((x) => (x.bucket === 'documentos-compras' && x.ruta ? [x.ruta] : [])))
  // La factura o la boleta que Logística anuló ya no cuenta: sale tachada, al final, con su motivo.
  const vigentes = f.documentos.filter((d) => !d.anulado_en)
  // Y la que registró con el número del anexo es la misma factura: va en su línea, con el «Anular» del anexo.
  const anexoDe = new Map<string, Documento>()
  for (const d of vigentes) if (d.factura && f.facturas.some((x) => x.id === d.factura?.id)) anexoDe.set(d.factura.id, d)
  const enSuFactura = new Set([...anexoDe.values()].map((d) => d.id))
  const adjuntos = f.documentos.filter((d) => !deFacturas.has(d.ruta) && !enSuFactura.has(d.id))
  const aprobada = f.aprobacion === 'APROBADA' || f.aprobacion === 'NO_REQUERIDA'
  // La boleta falta solo si tampoco llegó factura: el proveedor pudo entregar factura en vez de boleta.
  // La de antes, que se dio por pagada fuera del sistema, no la pide.
  const sinComprobante =
    f.tipo === 'OC' &&
    f.con_factura === false &&
    aprobada &&
    f.pago !== 'SIN_FACTURA' &&
    f.facturas.length === 0 &&
    !vigentes.some((d) => d.tipo === 'COMPROBANTE' || d.tipo === 'FACTURA')
  const faltaFacturar =
    f.tipo === 'OC' && f.con_factura && aprobada && f.facturas.some((x) => x.estado === 'REGISTRADA') && !f.facturada_entera && f.total !== null
  const adjuntados = new Set(f.documentos.flatMap((d) => (d.numero ? [d.numero] : [])))
  const comprobantesOs =
    f.tipo === 'OS' ? f.pagos.flatMap((p) => (p.comprobante && !adjuntados.has(p.comprobante) ? [p.comprobante] : [])) : []
  const tipos = f.tipo === 'OS' ? TIPO_DOCUMENTO_SERVICIO : TIPO_DOCUMENTO_COMPRA
  const porCargar = guiaPorCargar(f)
  const vacio =
    f.facturas.length === 0 && adjuntos.length === 0 && !f.guia && !porCargar && comprobantesOs.length === 0 && !sinComprobante && !faltaFacturar

  return (
    <ul className="space-y-1 text-xs">
      {f.facturas.map((x) => {
        const anexo = anexoDe.get(x.id)
        return (
          <li key={x.id} className="flex flex-wrap items-center gap-x-2">
            <span>
              <Archivo url={x.bucket && x.ruta ? urls.get(claveDeArchivo(x.bucket, x.ruta)) : undefined}>
                {nombreDeComprobante(x.tipo)} <span className="tabular">{x.numero}</span>
              </Archivo>
              {x.fecha && <span className="tabular text-texto-suave"> · {fecha(x.fecha)}</span>}
              {x.parcial && <span className="text-texto-suave"> · en parte</span>}
              {/* Registrada sin ligarla a esta OC, pero es la que Logística le anexó: la OC se paga por ella. */}
              {x.anexada && <span className="text-texto-suave"> · por el anexo de Logística</span>}
              {x.estado === 'BORRADOR' && (
                <Insignia tono="aviso" className="ml-1">
                  En borrador
                </Insignia>
              )}
            </span>
            {anexo && <AnulaElAnexo f={f} d={anexo} acceso={acceso} />}
          </li>
        )
      })}
      {faltaFacturar && f.total !== null && (
        <li className="text-aviso">Falta facturar {moneda(Math.max(f.total - (f.facturado ?? 0), 0), codigo(f.moneda))}</li>
      )}
      {adjuntos
        .filter((d) => !d.anulado_en)
        .map((d) => (
          <li key={d.id} title={d.nombre} className="flex flex-wrap items-center gap-x-2">
            <span>
              <Archivo url={urls.get(claveDeArchivo(bucketDelDocumento(f, d), d.ruta))}>
                {tipos[d.tipo] ?? d.tipo}
                {d.numero && <span className="tabular"> {d.numero}</span>}
              </Archivo>
              <span className="tabular text-texto-suave"> · {fecha(d.creado_en)}</span>
            </span>
            <AnulaElAnexo f={f} d={d} acceso={acceso} />
          </li>
        ))}
      {sinComprobante && <li className="text-aviso">Falta la boleta, nota de venta o recibo</li>}
      {comprobantesOs.map((c, i) => (
        <li key={`${c}-${i}`} className="text-texto">
          Comprobante <span className="tabular">{c}</span> <span className="text-texto-suave">(anotado al pagar)</span>
        </li>
      ))}
      {f.guia && (
        <li className="flex flex-wrap items-center gap-x-2">
          <a href={`/compras/guia/${f.guia.id}`} target="_blank" rel="noopener" className={`${toque} ${enlace}`}>
            <span>
              Guía de remisión <span className="tabular">{f.guia.numero}</span>
            </span>
          </a>
          {acceso.cargaGuia && f.recojo !== 'DEJADO' && <AnularGuia id={f.guia.id} numero={f.guia.numero} />}
        </li>
      )}
      {porCargar && f.peso_kg !== null && (
        <li className="space-y-1">
          <p className="text-aviso">
            Guía de remisión por cargar · <span className="tabular">{cantidad(f.peso_kg)} kg</span>
          </p>
          {acceso.cargaGuia && (
            <CargarGuia ordenCompraId={f.id} solicitudId={crypto.randomUUID()} numero={nombreDe(f)} peso={f.peso_kg} hoy={acceso.hoy} />
          )}
        </li>
      )}
      {adjuntos
        .filter((d) => d.anulado_en)
        .map((d) => (
          <li key={d.id} title={d.nombre} className="text-texto-tenue">
            <span className="line-through">
              <Archivo url={urls.get(claveDeArchivo(bucketDelDocumento(f, d), d.ruta))}>
                {tipos[d.tipo] ?? d.tipo}
                {d.numero && <span className="tabular"> {d.numero}</span>}
              </Archivo>
            </span>
            <span> · anulada el {fecha(d.anulado_en)}</span>
            {d.motivo_anulacion && <span>: {d.motivo_anulacion}</span>}
          </li>
        ))}
      {f.guias_anuladas > 0 && (
        <li className="text-texto-tenue">
          {f.guias_anuladas === 1 ? 'Una guía anulada' : `${f.guias_anuladas} guías anuladas`}
        </li>
      )}
      {vacio && <li className="text-texto-suave">Sin documentos adjuntos</li>}
    </ul>
  )
}

type Documento = CompraTrazada['documentos'][number]

/**
 * «Anular» la factura o la boleta que anexó Logística o, si la base lo
 * rechazaría (la factura ya pagada por un camino que quedaría libre para el
 * otro), por qué no y quién lo corrige: el botón no se ofrece para fallar
 * después de escribir el motivo.
 */
function AnulaElAnexo({ f, d, acceso }: { f: CompraTrazada; d: Documento; acceso: Acceso }) {
  if (!acceso.anulaAnexo || f.tipo !== 'OC' || (d.tipo !== 'FACTURA' && d.tipo !== 'COMPROBANTE')) return null
  const bloqueo = acceso.esAdmin ? null : bloqueoDelAnexo(f, d)
  if (bloqueo) return <span className="basis-full text-texto-suave">{bloqueo}</span>
  // La factura registrada que no alcanza para esta OC: si no es de esta OC, el que está mal es el anexo.
  const porRevisar = d.factura ? anexoPorRevisarAlAnular({ nombre: nombreDe(f), pagos: f.pagos }, d.factura) : null
  return (
    <AnularAnexo
      id={d.id}
      etiqueta={`${d.tipo === 'FACTURA' ? 'la factura' : 'la boleta'}${d.numero ? ` ${d.numero}` : ''}`}
      oc={nombreDe(f)}
      factura={d.tipo === 'FACTURA'}
      porRevisar={porRevisar}
      borrador={d.factura?.estado === 'BORRADOR' ? d.factura.numero : null}
    />
  )
}

/** Si ya se pagó: el estado, lo que falta y cada voucher; Tesorería salta a pagarla. */
function Pago({ f, urls, acceso }: { f: CompraTrazada; urls: Map<string, string>; acceso: Acceso }) {
  const estado = definir(ESTADO_PAGO, f.pago)
  const registradas = f.facturas.filter((x) => x.estado === 'REGISTRADA')
  // La OC con boleta puede tener vouchers de su boleta y de su factura: cada uno dice de cuál es.
  const conBoleta = f.tipo === 'OC' && f.con_factura === false
  return (
    <div className="space-y-1.5 text-xs">
      <Insignia tono={estado.tono} title={ESTADO_PAGO[f.pago]?.descripcion}>
        {estado.etiqueta}
      </Insignia>
      {registradas.map((x) => {
        const m = codigo(x.moneda)
        return (
          <div key={x.id} className="space-y-0.5">
            {registradas.length > 1 && <p className="tabular text-texto-suave">{x.numero}</p>}
            {x.saldo > 0 && (
              <p className="tabular whitespace-nowrap text-texto">
                {x.pagado > 0 ? 'Saldo' : 'Por pagar'} {moneda(x.saldo, m)}
              </p>
            )}
            <Vouchers
              pagos={x.pagos.map((p) => ({ ...p, moneda: x.moneda }))}
              bucket={() => BUCKET_PAGOS_FACTURAS}
              urls={urls}
              rotulo={conBoleta ? 'Voucher de la factura' : 'Voucher'}
            />
            {/* Con un pago directo vigente de la OC con boleta, la factura no se paga: primero se anula ese pago o se pide la devolución (enlaces de abajo). */}
            {acceso.porPagar && x.saldo > 0 && !(conBoleta && f.pagos.length > 0) && (
              <Link href={`/tesoreria/por-pagar#factura-${x.id}`} className={`${toque} ${enlace}`}>
                {acceso.porPagar === 'pagar' ? 'Pagar en Cuentas por pagar' : 'Ver en Cuentas por pagar'}
              </Link>
            )}
          </div>
        )
      })}
      {/* La OS y, desde la migración 20261020210000, la OC con boleta: Tesorería las paga sin factura registrada. */}
      <Vouchers pagos={f.pagos} bucket={(p) => bucketDelPago(f, p)} urls={urls} rotulo={conBoleta ? 'Voucher de la boleta' : 'Voucher'} />
      {f.tipo === 'OS' && acceso.pagosServicio && (f.pago === 'POR_PAGAR' || f.pago === 'PAGO_PARCIAL') && (
        <Link href="/tesoreria/pagos-de-servicio" className={`${toque} ${enlace}`}>
          {acceso.pagosServicio === 'pagar' ? 'Pagar en Pagos de servicio' : 'Ver en Pagos de servicio'}
        </Link>
      )}
      {f.tipo === 'OC' && f.con_factura === false && acceso.porPagar === 'pagar' && (
        <PasarCompraATesoreria compraId={f.id} numero={nombreDe(f)} fueraDelSistema={f.pago === 'SIN_FACTURA'} />
      )}
      {f.tipo === 'OC' && f.con_factura === false && !f.facturas.some((x) => x.estado === 'REGISTRADA') && acceso.porPagar && (f.pago === 'POR_PAGAR' || f.pago === 'PAGO_PARCIAL') && (
        <Link href={`/tesoreria/por-pagar#compra-${f.id}`} className={`${toque} ${enlace}`}>
          {acceso.porPagar === 'pagar' ? 'Pagar en Cuentas por pagar' : 'Ver en Cuentas por pagar'}
        </Link>
      )}
      {/* Llegó su comprobante a una OC ya pagada directo: lo que falta es anular ese pago, no pagar. */}
      {f.tipo === 'OC' && f.pago === 'PAGO_POR_ANULAR' && (acceso.porPagar ? (
        <Link href={`/tesoreria/por-pagar#compra-${f.id}`} className={`${toque} ${enlace}`}>
          {acceso.porPagar === 'pagar' ? 'Anular el pago en Cuentas por pagar' : 'Ver en Cuentas por pagar'}
        </Link>
      ) : (
        // Quien no ve Cuentas por pagar (Contabilidad, que la registrará) lee a la vista a quién espera.
        <p className="text-xs text-texto-suave">Espera que Tesorería anule su pago directo.</p>
      ))}
      {/* Pagada por su boleta y por su factura: lo que falta es la devolución, y el pago directo se anula después. */}
      {f.tipo === 'OC' && f.pago === 'PAGADA_DOS_VECES' && (acceso.porPagar ? (
        <Link href={`/tesoreria/por-pagar#compra-${f.id}`} className={`${toque} ${enlace}`}>
          {acceso.porPagar === 'pagar' ? 'Pedir la devolución en Cuentas por pagar' : 'Ver en Cuentas por pagar'}
        </Link>
      ) : (
        <p className="text-xs text-texto-suave">Tesorería pide al proveedor la devolución de lo pagado de más.</p>
      ))}
      {/* La factura anexada no alcanza para esta OC: si no es suya, el que está mal es el anexo, y lo anula Logística en Documentos. */}
      {f.tipo === 'OC' && f.pago === 'ANEXO_POR_REVISAR' && (
        <p className="text-xs text-texto-suave">Logística revisa la factura que anexó: si no es de esta OC, la anula en sus documentos.</p>
      )}
    </div>
  )
}

function Vouchers({
  pagos,
  bucket,
  urls,
  rotulo,
}: {
  pagos: { id: string; fecha: string; monto: number; moneda: string; ruta: string | null; cancela?: boolean | null; bucket?: string }[]
  bucket: (pago: { bucket?: string }) => string
  urls: Map<string, string>
  rotulo: string
}) {
  if (pagos.length === 0) return null
  return (
    <ul className="space-y-0.5">
      {pagos.map((p, i) => (
        <li key={p.id}>
          <Archivo url={p.ruta ? urls.get(claveDeArchivo(bucket(p), p.ruta)) : undefined}>
            {rotulo}
            {pagos.length > 1 ? ` ${i + 1}` : ''}
          </Archivo>{' '}
          <span className="tabular text-texto-suave">
            {fecha(p.fecha)} · <span className="whitespace-nowrap">{moneda(p.monto, codigo(p.moneda))}</span>
            {p.cancela === false && ' · a cuenta'}
          </span>
        </li>
      ))}
    </ul>
  )
}
