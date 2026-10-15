import Link from 'next/link'

import { HistorialDeCorrecciones } from '@/components/correcciones/historial'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { comprasSinFactura, tablaDeAdquisiciones, type CompraSinFactura, type FacturaEnTabla, type OcEnTabla } from '@/lib/datos/adquisiciones'
import { correccionesDe, type CorreccionVista } from '@/lib/datos/correcciones'
import { documentosDeCompraParaTesoreria } from '@/lib/datos/tesoreria'
import { ESTADO_COMPROBANTE, TIPO_COMPROBANTE, definir } from '@/lib/dominio/estados'
import { CONTROL_FACTURA_COMPRA } from '@/lib/dominio/finanzas'
import { fecha, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

import { CorregirFactura } from './corregir'
import { AvisosDelDetector, avisosDeFacturaRegistrada, InsigniaDelDetector } from './detector'
import { DocumentosDeCompras } from './documentos-compras'
import { CompletarAdquisicion, FormularioAdquisicion } from './formulario'

export const metadata = { title: 'Adquisiciones' }

const codigo = (m: string | null) => (m === 'USD' ? 'USD' : 'PEN')

const VISTAS = [
  { valor: 'todas', titulo: 'Todas' },
  { valor: 'por-pagar', titulo: 'Por pagar' },
  { valor: 'no-calzan', titulo: 'No calzan' },
  { valor: 'sin-factura', titulo: 'Sin factura' },
] as const
type Vista = (typeof VISTAS)[number]['valor']

/** A qué documento puede ir quien mira: cada enlace solo sale si su pantalla lo deja entrar. */
type Acceso = { rq: boolean; oc: boolean; proveedor: boolean; porPagar: boolean; codigo: boolean }

const enlace = 'font-medium text-acento hover:underline'

/**
 * Todo lo comprado, en una tabla: de izquierda a derecha el RQ, la OC que lo
 * compró, la factura que cubre esa OC (número y fecha) y su pago con el voucher,
 * cada uno con su enlace para abrirlo. Una factura puede cubrir varias OC
 * (migración 20261015122000): sus celdas abarcan las filas de todas ellas. Las
 * OC que esperan su factura salen al final. Contabilidad registra las facturas
 * aquí mismo; Tesorería las paga en Cuentas por pagar; Logística consulta.
 */
export default async function PaginaAdquisiciones({ searchParams }: PageProps<'/adquisiciones'>) {
  const perfil = await exigirPermiso('adquisiciones.ver')
  const registra = puede(perfil, 'adquisiciones.registrar')
  const verDocumentosCompra = puede(perfil, 'tesoreria.ver_documentos')
  const acceso: Acceso = {
    rq: puede(perfil, ['requerimientos.emitir', 'requerimientos.administracion', 'requerimientos.ver', 'compras.crear', 'almacen.recibir']),
    oc: puede(perfil, ['compras.ver', 'almacen.recibir']),
    proveedor: puede(perfil, 'proveedores.ver'),
    porPagar: puede(perfil, 'tesoreria.ver_documentos'),
    codigo: puede(perfil, 'codigos_internos.ver'),
  }
  const params = await searchParams
  const vista: Vista = VISTAS.find((v) => v.valor === params.vista)?.valor ?? 'todas'

  const supabase = await createClient()
  const sinFactura = await comprasSinFactura()
  const [tabla, ordenes, documentos, documentosCompra] = await Promise.all([
    tablaDeAdquisiciones(sinFactura),
    registra
      ? supabase.from('ordenes_trabajo').select('id, numero').neq('estado', 'ANULADA').order('creado_en', { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    registra
      ? supabase.from('documentos_compra_material').select('id, nombre_archivo').eq('tipo', 'FACTURA').order('creado_en', { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    verDocumentosCompra ? documentosDeCompraParaTesoreria() : Promise.resolve([]),
  ])
  if (ordenes.error) throw new Error(`No se pudieron leer las OT: ${ordenes.error.message}`)
  if (documentos.error) throw new Error(`No se pudieron leer las facturas existentes: ${documentos.error.message}`)
  const correcciones = await correccionesDe('FACTURA_COMPRA', tabla.facturas.map((f) => f.factura.id))
  // Lo que el detector leyó del papel frente a lo registrado y a sus OC (#98).
  const avisosDe = new Map(
    tabla.facturas.map(({ factura: f }) => [f.id, f.estado === 'BORRADOR' ? [] : avisosDeFacturaRegistrada(f, f.control)]),
  )

  const porPagar = tabla.facturas.filter((f) => f.factura.saldo !== null && f.factura.saldo > 0)
  const noCalzan = tabla.facturas.filter((f) => f.factura.control?.control === 'NO_CALZA' || (avisosDe.get(f.factura.id)?.length ?? 0) > 0)
  const cuenta: Record<Vista, number> = {
    todas: tabla.facturas.length + tabla.sinFactura.length,
    'por-pagar': porPagar.length,
    'no-calzan': noCalzan.length,
    'sin-factura': tabla.sinFactura.length,
  }
  const facturas = vista === 'por-pagar' ? porPagar : vista === 'no-calzan' ? noCalzan : vista === 'sin-factura' ? [] : tabla.facturas
  const esperan = vista === 'todas' || vista === 'sin-factura' ? tabla.sinFactura : []

  return (
    <>
      <EncabezadoPagina
        titulo="Adquisiciones"
        descripcion="Todo lo comprado, de cada RQ a su OC, su factura y su pago, con el enlace a cada documento. Contabilidad registra cada factura con las OC que cubre y aquí se ve si su total calza con el de sus OC. Tesorería la paga en Cuentas por pagar."
      />

      {registra && (
        <Tarjeta className="mb-5">
          <TarjetaCabecera titulo="Nuevo comprobante" descripcion="Marca las OC que cubre la factura y adjunta el PDF." />
          <TarjetaCuerpo>
            <FormularioAdquisicion ordenes={ordenes.data ?? []} compras={sinFactura} documentos={documentos.data ?? []} />
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      <nav aria-label="Qué compras ver" className="mb-3 flex flex-wrap items-center gap-2">
        {VISTAS.map((v) => (
          <Link
            key={v.valor}
            href={v.valor === 'todas' ? '/adquisiciones' : `/adquisiciones?vista=${v.valor}`}
            aria-current={vista === v.valor ? 'page' : undefined}
            className={`inline-flex min-h-9 items-center rounded-lg border px-3 text-sm font-medium ${
              vista === v.valor ? 'border-acento bg-acento-suave text-texto' : 'border-borde text-texto-suave hover:text-texto'
            }`}
          >
            {v.titulo}
            <span className="ml-2 tabular text-xs text-texto-suave">{cuenta[v.valor]}</span>
          </Link>
        ))}
      </nav>

      {noCalzan.length > 0 && vista !== 'sin-factura' && (
        <p className="mb-3 text-sm text-aviso">
          {noCalzan.length === 1 ? 'Una factura no calza' : `${noCalzan.length} facturas no calzan`} con sus OC o con lo que dice el papel: revisa
          si falta una OC, si cubre otra cosa o si hay que corregirla. Es solo un aviso.
        </p>
      )}

      <Tarjeta className="overflow-hidden">
        <Tabla aria-label="Compras: RQ, OC, factura y pago">
          <TablaCabecera>
            <tr>
              <TH>RQ</TH>
              <TH>OC</TH>
              <TH>Factura</TH>
              <TH>Fecha de factura</TH>
              <TH>Proveedor</TH>
              <TH>Código interno</TH>
              <TH className="text-right">Total</TH>
              <TH>Pago</TH>
            </tr>
          </TablaCabecera>
          {facturas.length === 0 && esperan.length === 0 ? (
            <tbody>
              <SinDatos titulo={vacio(vista).titulo} descripcion={vacio(vista).descripcion} />
            </tbody>
          ) : (
            <>
              {facturas.length > 0 &&
                facturas.map(({ factura, ordenes }) => (
                    <GrupoFactura
                      key={factura.id}
                      factura={factura}
                      ordenes={ordenes}
                      acceso={acceso}
                      propia={factura.registrado_por === perfil.id}
                      avisos={avisosDe.get(factura.id) ?? []}
                      correcciones={correcciones.get(factura.id)}
                      corrige={registra ? sinFactura : null}
                    />
                  ))}
              {esperan.length > 0 && (
                <tbody>
                  <tr className="border-b border-borde bg-superficie-2">
                    <th colSpan={8} scope="rowgroup" className="px-3 py-2 text-left text-xs font-semibold text-texto">
                      OC que esperan su factura <span className="tabular font-normal text-texto-suave">({esperan.length})</span>
                      <span className="block font-normal text-texto-suave">Aprobadas, van con factura y todavía no están en ninguna factura registrada.</span>
                    </th>
                  </tr>
                  {esperan.map(({ compra, orden }) => (
                    <TR key={orden.id}>
                      <CeldaRq orden={orden} acceso={acceso} />
                      <CeldaOc orden={orden} acceso={acceso} />
                      <TD className="align-top">
                        <Insignia tono="neutro">Sin factura</Insignia>
                        {compra.en_borrador && (
                          <Insignia tono="aviso" className="ml-1">
                            En un borrador
                          </Insignia>
                        )}
                      </TD>
                      <TD className="align-top text-xs text-texto-suave">OC del {fecha(compra.creado_en)}</TD>
                      <CeldaProveedor proveedor={compra.proveedor} acceso={acceso} />
                      <CeldaCodigo orden={orden} acceso={acceso} />
                      <TD className="text-right align-top tabular whitespace-nowrap">
                        {compra.sin_precio ? <span className="text-aviso">Precio pendiente</span> : moneda(compra.total, codigo(compra.moneda))}
                      </TD>
                      <TD className="align-top text-xs text-texto-suave">{compra.condicion_pago === 'CREDITO' ? 'A crédito' : 'Al contado'}</TD>
                    </TR>
                  ))}
                </tbody>
              )}
            </>
          )}
        </Tabla>
      </Tarjeta>

      {verDocumentosCompra && <DocumentosDeCompras documentos={documentosCompra} />}
    </>
  )
}

function vacio(vista: Vista) {
  switch (vista) {
    case 'por-pagar':
      return { titulo: 'Ninguna factura por pagar', descripcion: 'Las facturas que registra Contabilidad salen aquí hasta que Tesorería las paga.' }
    case 'no-calzan':
      return { titulo: 'Todas las facturas calzan con sus OC', descripcion: 'Si el total de una factura no calza con el de sus OC, sale aquí.' }
    case 'sin-factura':
      return { titulo: 'Ninguna OC espera su factura', descripcion: 'Cuando Gerencia aprueba una OC que va con factura, sale aquí hasta que Contabilidad la registra.' }
    default:
      return {
        titulo: 'Todavía no hay compras',
        descripcion: 'Cuando Logística emite una OC aprobada sale aquí; Contabilidad le registra la factura con el formulario de arriba.',
      }
  }
}

/**
 * Una factura y sus OC: una fila por OC. Las celdas de la factura (número,
 * fecha, proveedor, total y pago) abarcan todas sus filas, y la factura entera
 * se resalta junta al pasar el puntero: va en su propio `tbody`.
 */
function GrupoFactura({
  factura: f,
  ordenes,
  acceso,
  propia,
  avisos,
  correcciones,
  corrige,
}: {
  factura: FacturaEnTabla
  ordenes: OcEnTabla[]
  acceso: Acceso
  /** La registró quien mira: si es un borrador, la completa. */
  propia: boolean
  /** Los avisos del detector: la factura dice otra cosa que lo registrado o que sus OC. */
  avisos: string[]
  correcciones: CorreccionVista[] | undefined
  /** Contabilidad la corrige con las OC que esperan factura; null para quien solo consulta. */
  corrige: CompraSinFactura[] | null
}) {
  const filas: (OcEnTabla | null)[] = ordenes.length > 0 ? ordenes : [null]
  const alto = filas.length
  const m = codigo(f.moneda)
  return (
    <tbody className="border-b border-borde hover:bg-superficie-2">
      {filas.map((orden, i) => (
        <TR key={orden?.id ?? 'sin-oc'} className="hover:bg-transparent">
          {orden ? (
            <>
              <CeldaRq orden={orden} acceso={acceso} />
              <CeldaOc orden={orden} acceso={acceso} />
            </>
          ) : (
            <>
              <TD className="align-top text-texto-suave">—</TD>
              <TD className="align-top text-xs text-texto-suave">Sin OC</TD>
            </>
          )}
          {i === 0 && (
            <>
              <TD rowSpan={alto} className="align-top">
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noreferrer" className={`tabular ${enlace}`}>
                    {f.numero_documento}
                  </a>
                ) : (
                  <span className="tabular font-medium">{f.numero_documento}</span>
                )}
                <p className="text-[11px] text-texto-suave">{definir(TIPO_COMPROBANTE, f.tipo).etiqueta}</p>
                <p className="mt-1 flex flex-wrap gap-1">
                  {f.estado !== 'REGISTRADA' && <Insignia tono={definir(ESTADO_COMPROBANTE, f.estado).tono}>{definir(ESTADO_COMPROBANTE, f.estado).etiqueta}</Insignia>}
                  {f.control && (
                    <Insignia tono={CONTROL_FACTURA_COMPRA[f.control.control]?.tono ?? 'neutro'}>
                      {CONTROL_FACTURA_COMPRA[f.control.control]?.etiqueta ?? f.control.control}
                    </Insignia>
                  )}
                  <InsigniaDelDetector avisos={avisos} />
                </p>
                {f.control?.control === 'NO_CALZA' && f.control.total_oc !== null && f.control.diferencia !== null && (
                  <p className="mt-1 max-w-56 text-xs text-aviso">
                    Sus OC suman {moneda(f.control.total_oc, m)}: {f.control.diferencia > 0 ? 'sobran' : 'faltan'} {moneda(Math.abs(f.control.diferencia), m)}.
                  </p>
                )}
                <div className="max-w-64">
                  <AvisosDelDetector avisos={avisos} />
                </div>
                {f.estado === 'BORRADOR' && propia && <CompletarAdquisicion id={f.id} />}
                <HistorialDeCorrecciones correcciones={correcciones} />
                {corrige && f.estado === 'REGISTRADA' && (
                  <div className="mt-1">
                    <CorregirFactura
                      factura={{
                        id: f.id,
                        tipo: f.tipo,
                        proveedor: f.proveedor,
                        numero_documento: f.numero_documento,
                        fecha_emision: f.fecha_emision,
                        fecha_vencimiento: f.fecha_vencimiento,
                        moneda: f.moneda,
                        total: f.total,
                        condicion_pago: f.condicion_pago,
                        observacion: f.observacion ?? '',
                        pagado: f.pagado ?? 0,
                      }}
                      ordenes={f.control?.ordenes ?? []}
                      disponibles={corrige}
                    />
                  </div>
                )}
              </TD>
              <TD rowSpan={alto} className="align-top whitespace-nowrap">
                <span className="tabular">{fecha(f.fecha_emision)}</span>
                <p className="text-[11px] text-texto-suave">
                  {f.condicion_pago === 'CREDITO' ? `Crédito, vence ${fecha(f.fecha_vencimiento)}` : 'Contado'}
                </p>
              </TD>
              <CeldaProveedor proveedor={f.proveedor} acceso={acceso} alto={alto} />
            </>
          )}
          {orden ? <CeldaCodigo orden={orden} acceso={acceso} /> : <TD className="align-top text-texto-suave">—</TD>}
          {i === 0 && (
            <>
              <TD rowSpan={alto} className="text-right align-top tabular font-semibold whitespace-nowrap">
                {moneda(f.total, m)}
              </TD>
              <TD rowSpan={alto} className="min-w-44 align-top">
                <Pago factura={f} acceso={acceso} />
              </TD>
            </>
          )}
        </TR>
      ))}
    </tbody>
  )
}

function CeldaRq({ orden, acceso }: { orden: OcEnTabla; acceso: Acceso }) {
  return (
    <TD className="align-top">
      {orden.requerimientos.length > 0 ? (
        <ul className="space-y-0.5">
          {orden.requerimientos.map((rq) => (
            <li key={rq.id} className="whitespace-nowrap">
              {acceso.rq ? (
                <Link href={`/requerimientos?rq=${rq.id}`} className={`tabular ${enlace}`}>
                  {rq.numero}
                </Link>
              ) : (
                <span className="tabular">{rq.numero}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-xs text-texto-suave">{orden.numero_ot ? `OT ${orden.numero_ot}` : 'Directa'}</span>
      )}
    </TD>
  )
}

function CeldaOc({ orden, acceso }: { orden: OcEnTabla; acceso: Acceso }) {
  return (
    <TD className="align-top whitespace-nowrap">
      {acceso.oc ? (
        <a href={`/compras/${orden.id}/pdf`} target="_blank" rel="noopener" className={`tabular ${enlace}`}>
          {orden.numero}
        </a>
      ) : (
        <span className="tabular">{orden.numero}</span>
      )}
      <p className="tabular text-[11px] text-texto-suave">{orden.sin_precio ? 'Sin precio' : moneda(orden.total, codigo(orden.moneda))}</p>
    </TD>
  )
}

function CeldaProveedor({ proveedor, acceso, alto }: { proveedor: string; acceso: Acceso; alto?: number }) {
  return (
    <TD rowSpan={alto} className="align-top">
      {acceso.proveedor && proveedor ? (
        <Link href={`/proveedores?q=${encodeURIComponent(proveedor)}`} className={enlace}>
          {proveedor}
        </Link>
      ) : (
        proveedor || '—'
      )}
    </TD>
  )
}

function CeldaCodigo({ orden, acceso }: { orden: OcEnTabla; acceso: Acceso }) {
  const c = orden.codigo_interno
  return (
    <TD className="align-top whitespace-nowrap">
      {!c ? (
        <span className="text-texto-suave">—</span>
      ) : acceso.codigo && c !== 'PLANTA' ? (
        <Link href={`/codigos-internos/detalle?codigo=${encodeURIComponent(c)}`} className={`tabular ${enlace}`}>
          {c}
        </Link>
      ) : (
        <span className="tabular">{c}</span>
      )}
    </TD>
  )
}

/** Si está pagada, cuánto falta y cada voucher vigente; Tesorería salta a pagarla en Cuentas por pagar. */
function Pago({ factura: f, acceso }: { factura: FacturaEnTabla; acceso: Acceso }) {
  const m = codigo(f.moneda)
  return (
    <div className="space-y-1 text-xs">
      {f.saldo === null ? (
        <p className="text-texto-suave">{f.estado === 'BORRADOR' ? 'Falta registrarla' : '—'}</p>
      ) : f.saldo <= 0 ? (
        <Insignia tono="exito">Pagada</Insignia>
      ) : (
        <p className="tabular whitespace-nowrap text-texto">
          {f.pagado && f.pagado > 0 ? 'Saldo' : 'Por pagar'} {moneda(f.saldo, m)}
        </p>
      )}
      {f.pagos.length > 0 && (
        <ul className="space-y-0.5">
          {f.pagos.map((p, i) => (
            <li key={p.id}>
              {p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer" className={enlace}>
                  Voucher{f.pagos.length > 1 ? ` ${i + 1}` : ''}
                </a>
              ) : (
                'Sin voucher'
              )}{' '}
              <span className="tabular text-texto-suave">
                {fecha(p.fecha)} · {moneda(p.monto, m)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* Solo la que falta pagar: la pagada ya trae aquí sus vouchers, y allá va plegada. */}
      {acceso.porPagar && f.estado === 'REGISTRADA' && f.saldo !== null && f.saldo > 0 && (
        <Link href={`/tesoreria/por-pagar#factura-${f.id}`} className={`inline-flex min-h-11 items-center sm:min-h-0 ${enlace}`}>
          Pagar en Cuentas por pagar
        </Link>
      )}
    </div>
  )
}
