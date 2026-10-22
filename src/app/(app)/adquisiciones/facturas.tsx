import Link from 'next/link'

import { HistorialDeCorrecciones } from '@/components/correcciones/historial'
import { Vistas } from '@/components/estructura/vistas'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  comprasSinFactura,
  facturasDeLogistica,
  tablaDeAdquisiciones,
  type CompraSinFactura,
  type FacturaDeLogistica,
  type FacturaEnTabla,
  type OcEnTabla,
} from '@/lib/datos/adquisiciones'
import { correccionesDe, type CorreccionVista } from '@/lib/datos/correcciones'
import { ESTADO_COMPROBANTE, TIPO_COMPROBANTE, definir } from '@/lib/dominio/estados'
import { CONTROL_FACTURA_COMPRA, detalleDelControl } from '@/lib/dominio/finanzas'
import { fecha, hoyLima, moneda } from '@/lib/format'
import { puede, type PerfilSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

import { CorregirFactura } from './corregir'
import { AvisosDelDetector, avisosDeFacturaRegistrada, InsigniaDelDetector } from './detector'
import { CompletarAdquisicion, FormularioAdquisicion } from './formulario'
import { ConAvisosDeLoAnotado, ConfirmarPagoDeBoleta } from './pago-de-boleta'

const codigo = (m: string | null) => (m === 'USD' ? 'USD' : 'PEN')

/** Las vistas de la pestaña Facturas. `por-pagar`, `no-calzan` y `sin-factura` son las de antes: sus enlaces siguen sirviendo. */
export const VISTAS_DE_FACTURAS = [
  { valor: 'facturas', titulo: 'Todas' },
  { valor: 'por-pagar', titulo: 'Por pagar' },
  { valor: 'no-calzan', titulo: 'No calzan' },
  // «Sin factura» es la OC que va con boleta (así se elige al emitirla); esta
  // vista es la de las que esperan la suya.
  { valor: 'sin-factura', titulo: 'Esperan su factura' },
  // La factura de una OC con boleta que se dio por pagada fuera: espera que Contabilidad diga si se pagó (20261022175000).
  { valor: 'por-confirmar', titulo: 'Pago por confirmar' },
] as const
type Vista = (typeof VISTAS_DE_FACTURAS)[number]['valor']
type Params = Record<string, string | string[] | undefined>

/** A qué documento puede ir quien mira: cada enlace solo sale si su pantalla lo deja entrar. */
type Acceso = { rq: boolean; oc: boolean; proveedor: boolean; porPagar: boolean; codigo: boolean }

const enlace = 'font-medium text-acento hover:underline'

/**
 * La pestaña Facturas: de izquierda a derecha el RQ, la OC que lo compró, la
 * factura que cubre esa OC (número y fecha) y su pago con el voucher, cada uno
 * con su enlace para abrirlo. Una factura puede cubrir varias OC (migración
 * 20261015122000): sus celdas abarcan las filas de todas ellas. Las OC que
 * esperan su factura salen al final. Contabilidad registra las facturas aquí
 * mismo; Tesorería las paga en Cuentas por pagar; Logística consulta.
 */
export async function PestanaFacturas({ perfil, params }: { perfil: PerfilSesion; params: Params }) {
  const registra = puede(perfil, 'adquisiciones.registrar')
  const acceso: Acceso = {
    rq: puede(perfil, ['requerimientos.emitir', 'requerimientos.administracion', 'requerimientos.ver', 'compras.crear', 'almacen.recibir']),
    oc: puede(perfil, ['compras.ver', 'almacen.recibir']),
    proveedor: puede(perfil, 'proveedores.ver'),
    porPagar: puede(perfil, 'tesoreria.ver_documentos'),
    codigo: puede(perfil, 'codigos_internos.ver'),
  }
  const vista: Vista = VISTAS_DE_FACTURAS.find((v) => v.valor === params.vista)?.valor ?? 'facturas'

  const supabase = await createClient()
  const sinFactura = await comprasSinFactura()
  const [tabla, ordenes, deLogistica] = await Promise.all([
    tablaDeAdquisiciones(sinFactura),
    registra
      ? supabase.from('ordenes_trabajo').select('id, numero').neq('estado', 'ANULADA').order('creado_en', { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    facturasDeLogistica(),
  ])
  if (ordenes.error) throw new Error(`No se pudieron leer las OT: ${ordenes.error.message}`)
  // Las facturas que Logística anexó y Contabilidad todavía no registra, por OC.
  const porRegistrar = deLogistica.filter((d) => !d.registrada)
  const porRegistrarDe = new Map<string, FacturaDeLogistica[]>()
  for (const d of porRegistrar) porRegistrarDe.set(d.orden_compra_id, [...(porRegistrarDe.get(d.orden_compra_id) ?? []), d])
  const correcciones = await correccionesDe('FACTURA_COMPRA', tabla.facturas.map((f) => f.factura.id))
  // Lo que el detector leyó del papel frente a lo registrado y a sus OC (#98).
  const avisosDe = new Map(
    tabla.facturas.map(({ factura: f }) => [f.id, f.estado === 'BORRADOR' ? [] : avisosDeFacturaRegistrada(f, f.control)]),
  )

  const porPagar = tabla.facturas.filter((f) => f.factura.saldo !== null && f.factura.saldo > 0)
  const porConfirmar = tabla.facturas.filter((f) => f.factura.enEspera)
  const noCalzan = tabla.facturas.filter((f) => f.factura.control?.control === 'NO_CALZA' || (avisosDe.get(f.factura.id)?.length ?? 0) > 0)
  const cuenta: Record<Vista, number> = {
    facturas: tabla.facturas.length + tabla.sinFactura.length,
    'por-pagar': porPagar.length,
    'no-calzan': noCalzan.length,
    'sin-factura': tabla.sinFactura.length,
    'por-confirmar': porConfirmar.length,
  }
  const facturas =
    vista === 'por-pagar'
      ? porPagar
      : vista === 'no-calzan'
        ? noCalzan
        : vista === 'por-confirmar'
          ? porConfirmar
          : vista === 'sin-factura'
            ? []
            : tabla.facturas
  const esperan = vista === 'facturas' || vista === 'sin-factura' ? tabla.sinFactura : []

  return (
    <>
      {registra && (
        <Tarjeta id="nuevo-comprobante" className="mb-5 scroll-mt-20">
          <TarjetaCabecera
            titulo="Nuevo comprobante"
            ayuda="Elige la factura que anexó Logística, que trae su número, su fecha y su OC; o marca las OC que cubre y adjunta el PDF."
          />
          <TarjetaCuerpo>
            <FormularioAdquisicion ordenes={ordenes.data ?? []} compras={sinFactura} documentos={porRegistrar} />
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      <Vistas
        etiqueta="Qué facturas ver"
        className="mb-3"
        vistas={VISTAS_DE_FACTURAS.map((v) => ({
          clave: v.valor,
          titulo: v.titulo,
          href: `/adquisiciones?vista=${v.valor}`,
          activa: vista === v.valor,
          cuenta: cuenta[v.valor],
        }))}
      />

      {/* Lo anotado de un pago por confirmar: la fila se va de «Pago por confirmar» y con ella el botón. */}
      <ConAvisosDeLoAnotado>
      {noCalzan.length > 0 && vista !== 'sin-factura' && (
        <p className="mb-3 text-sm text-aviso">
          {noCalzan.length === 1 ? 'Una factura no calza' : `${noCalzan.length} facturas no calzan`} con sus OC o con lo que dice el papel: revisa
          si falta una OC, si cubre otra cosa o si hay que corregirla. Es solo un aviso.
        </p>
      )}

      {/* En el teléfono, una tarjeta por factura: la tabla de ocho columnas se corría de costado y el proveedor salía cortado. */}
      <ComprasEnTelefono
        facturas={facturas}
        esperan={esperan}
        vacio={facturas.length === 0 && esperan.length === 0 ? vacio(vista) : null}
        acceso={acceso}
        yo={perfil.id}
        avisosDe={avisosDe}
        correcciones={correcciones}
        corrige={registra ? sinFactura : null}
        porRegistrarDe={porRegistrarDe}
      />

      <Tarjeta className="hidden overflow-hidden sm:block">
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
                      <span className="block font-normal text-texto-suave">
                        Aprobadas, van con factura y ninguna factura registrada las completa. Una OC puede ir en varias facturas.
                      </span>
                    </th>
                  </tr>
                  {esperan.map(({ compra, orden }) => (
                    <TR key={orden.id}>
                      <CeldaRq orden={orden} acceso={acceso} />
                      <CeldaOc orden={orden} acceso={acceso} />
                      <TD className="align-top">
                        <Insignia tono="neutro">{compra.facturas.length > 0 ? 'Facturada en parte' : 'Espera su factura'}</Insignia>
                        {compra.en_borrador && (
                          <Insignia tono="aviso" className="ml-1">
                            En un borrador
                          </Insignia>
                        )}
                        {compra.facturas.length > 0 && (
                          <p className="mt-1 text-[11px] text-texto-suave">
                            {compra.facturas.join(', ')}: {moneda(compra.facturado, codigo(compra.moneda))}
                          </p>
                        )}
                        <AnexadasPorRegistrar facturas={porRegistrarDe.get(compra.orden_compra_id) ?? []} />
                      </TD>
                      <TD className="align-top text-xs text-texto-suave">OC del {fecha(compra.creado_en)}</TD>
                      <CeldaProveedor proveedor={compra.proveedor} acceso={acceso} />
                      <CeldaCodigo orden={orden} acceso={acceso} />
                      <TD className="text-right align-top tabular whitespace-nowrap">
                        {compra.sin_precio ? <span className="text-aviso">Precio pendiente</span> : moneda(compra.total, codigo(compra.moneda))}
                        {!compra.sin_precio && compra.facturado > 0 && (
                          <p className="text-[11px] font-normal text-texto-suave">
                            Falta {moneda(Math.max(compra.total - compra.facturado, 0), codigo(compra.moneda))}
                          </p>
                        )}
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
      </ConAvisosDeLoAnotado>
    </>
  )
}

/**
 * Lo mismo que la tabla, para el teléfono: cada factura con su proveedor, su
 * total, sus OC y su pago; al final, las OC que esperan su factura.
 */
function ComprasEnTelefono({
  facturas,
  esperan,
  vacio,
  acceso,
  yo,
  avisosDe,
  correcciones,
  corrige,
  porRegistrarDe,
}: {
  facturas: { factura: FacturaEnTabla; ordenes: OcEnTabla[] }[]
  esperan: { compra: CompraSinFactura; orden: OcEnTabla }[]
  vacio: { titulo: string; descripcion: string } | null
  acceso: Acceso
  yo: string
  avisosDe: Map<string, string[]>
  correcciones: Map<string, CorreccionVista[]>
  corrige: CompraSinFactura[] | null
  porRegistrarDe: Map<string, FacturaDeLogistica[]>
}) {
  if (vacio) {
    return (
      <Tarjeta className="px-4 py-8 text-center sm:hidden">
        <p className="text-sm font-medium text-texto">{vacio.titulo}</p>
        <p className="mt-1 text-xs text-texto-suave">{vacio.descripcion}</p>
      </Tarjeta>
    )
  }
  return (
    <div className="space-y-4 sm:hidden">
      {facturas.length > 0 && (
        <Tarjeta className="overflow-hidden">
          <ul className="divide-y divide-borde" aria-label="Facturas de compra">
            {facturas.map(({ factura: f, ordenes }) => {
              const m = codigo(f.moneda)
              return (
                <li key={f.id} className="space-y-1.5 px-4 py-3" data-factura-telefono={f.numero_documento}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <NumeroDeFactura factura={f} />
                      {/* Sin enlace: pegado al número, que abre el PDF, el dedo tocaba uno por el otro. */}
                      <p className="text-sm text-texto">{f.proveedor || '—'}</p>
                    </div>
                    <p className="tabular shrink-0 font-semibold text-texto">{moneda(f.total, m)}</p>
                  </div>
                  <p className="text-xs text-texto-suave">
                    {definir(TIPO_COMPROBANTE, f.tipo).etiqueta} del <span className="tabular">{fecha(f.fecha_emision)}</span> ·{' '}
                    {f.condicion_pago === 'CREDITO' ? `crédito, vence ${fecha(f.fecha_vencimiento)}` : 'contado'}
                  </p>
                  <DatosDeFactura
                    factura={f}
                    conNumero={false}
                    propia={f.registrado_por === yo}
                    avisos={avisosDe.get(f.id) ?? []}
                    correcciones={correcciones.get(f.id)}
                    corrige={corrige}
                  />
                  {ordenes.length > 0 && (
                    <ul className="space-y-0.5 text-xs text-texto-suave">
                      {ordenes.map((o) => (
                        <OcEnUnaLinea key={o.id} orden={o} acceso={acceso} />
                      ))}
                    </ul>
                  )}
                  <Pago factura={f} acceso={acceso} />
                </li>
              )
            })}
          </ul>
        </Tarjeta>
      )}
      {esperan.length > 0 && (
        <Tarjeta className="overflow-hidden">
          <h2 className="border-b border-borde bg-superficie-2 px-4 py-2 text-xs font-semibold text-texto">
            OC que esperan su factura <span className="tabular font-normal text-texto-suave">({esperan.length})</span>
          </h2>
          <ul className="divide-y divide-borde">
            {esperan.map(({ compra, orden }) => (
              <li key={orden.id} className="space-y-1 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <ul className="text-sm">
                      <OcEnUnaLinea orden={orden} acceso={acceso} />
                    </ul>
                    <p className="text-sm text-texto">{compra.proveedor || '—'}</p>
                  </div>
                  <p className="tabular shrink-0 text-right font-semibold text-texto">
                    {compra.sin_precio ? <span className="font-normal text-aviso">Precio pendiente</span> : moneda(compra.total, codigo(compra.moneda))}
                  </p>
                </div>
                <p className="flex flex-wrap items-center gap-1 text-xs text-texto-suave">
                  <Insignia tono="neutro">{compra.facturas.length > 0 ? 'Facturada en parte' : 'Espera su factura'}</Insignia>
                  {compra.en_borrador && <Insignia tono="aviso">En un borrador</Insignia>}
                  <span>
                    OC del {fecha(compra.creado_en)} · {compra.condicion_pago === 'CREDITO' ? 'a crédito' : 'al contado'}
                  </span>
                </p>
                {compra.facturas.length > 0 && (
                  <p className="text-xs text-texto-suave">
                    {compra.facturas.join(', ')}: {moneda(compra.facturado, codigo(compra.moneda))}
                    {!compra.sin_precio && ` · falta ${moneda(Math.max(compra.total - compra.facturado, 0), codigo(compra.moneda))}`}
                  </p>
                )}
                <AnexadasPorRegistrar facturas={porRegistrarDe.get(compra.orden_compra_id) ?? []} />
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
    </div>
  )
}

/** Una OC en un renglón: su número, de qué RQ salió y para qué código. */
function OcEnUnaLinea({ orden: o, acceso }: { orden: OcEnTabla; acceso: Acceso }) {
  return (
    <li>
      {acceso.oc ? (
        <a href={`/compras/${o.id}/pdf`} target="_blank" rel="noopener" className={`tabular ${enlace}`}>
          {o.numero}
        </a>
      ) : (
        <span className="tabular text-texto">{o.numero}</span>
      )}
      {o.requerimientos.length > 0 ? (
        <>
          {' · '}
          {o.requerimientos.map((rq, i) => (
            <span key={rq.id}>
              {i > 0 && ', '}
              {acceso.rq ? (
                <Link href={`/requerimientos?rq=${rq.id}`} className={`tabular ${enlace}`}>
                  {rq.numero}
                </Link>
              ) : (
                <span className="tabular">{rq.numero}</span>
              )}
            </span>
          ))}
        </>
      ) : (
        <> · {o.numero_ot ? `OT ${o.numero_ot}` : 'directa'}</>
      )}
      {o.codigos.length > 0 && (
        <>
          {' · '}
          {o.codigos.map((c, i) => (
            <span key={c}>
              {i > 0 && ', '}
              {acceso.codigo && c !== 'PLANTA' ? (
                <Link href={`/codigos-internos/detalle?codigo=${encodeURIComponent(c)}`} className={`tabular ${enlace}`}>
                  {c}
                </Link>
              ) : (
                <span className="tabular">{c}</span>
              )}
            </span>
          ))}
        </>
      )}
    </li>
  )
}

/** Lo que Logística anexó a la OC y espera que Contabilidad lo registre. */
function AnexadasPorRegistrar({ facturas }: { facturas: FacturaDeLogistica[] }) {
  if (facturas.length === 0) return null
  return (
    <ul className="mt-1 space-y-0.5 text-[11px] text-aviso">
      {facturas.map((d) => (
        <li key={d.id}>
          Logística anexó <span className="tabular">{d.numero ?? d.nombre_archivo}</span>
          {d.fecha && ` del ${fecha(d.fecha)}`}: falta registrarla.
        </li>
      ))}
    </ul>
  )
}

function vacio(vista: Vista) {
  switch (vista) {
    case 'por-pagar':
      return { titulo: 'Ninguna factura por pagar', descripcion: 'Las facturas que registra Contabilidad salen aquí hasta que Tesorería las paga.' }
    case 'no-calzan':
      return { titulo: 'Todas las facturas calzan con sus OC', descripcion: 'Si el total de una factura no calza con el de sus OC, sale aquí.' }
    case 'por-confirmar':
      return {
        titulo: 'Ningún pago por confirmar',
        descripcion: 'Cuando llega la factura de una OC con boleta que se dio por pagada fuera del sistema, sale aquí hasta que digas si ya se pagó.',
      }
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
              <TD className="align-top text-texto-suave">—</TD>
            </>
          )}
          {i === 0 && (
            <>
              <TD rowSpan={alto} className="align-top">
                <DatosDeFactura factura={f} propia={propia} avisos={avisos} correcciones={correcciones} corrige={corrige} />
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

/** Lo que se dice de una factura: su número con el PDF, su tipo, sus avisos y, para Contabilidad, completarla o corregirla. */
function DatosDeFactura({
  factura: f,
  conNumero = true,
  propia,
  avisos,
  correcciones,
  corrige,
}: {
  factura: FacturaEnTabla
  /** En el teléfono el número encabeza la tarjeta, junto al total. */
  conNumero?: boolean
  propia: boolean
  avisos: string[]
  correcciones: CorreccionVista[] | undefined
  corrige: CompraSinFactura[] | null
}) {
  const m = codigo(f.moneda)
  return (
    <>
      {conNumero && (
        <>
          <NumeroDeFactura factura={f} />
          <p className="text-[11px] text-texto-suave">{definir(TIPO_COMPROBANTE, f.tipo).etiqueta}</p>
        </>
      )}
      <p className="mt-1 flex flex-wrap gap-1">
        {f.estado !== 'REGISTRADA' && <Insignia tono={definir(ESTADO_COMPROBANTE, f.estado).tono}>{definir(ESTADO_COMPROBANTE, f.estado).etiqueta}</Insignia>}
        {f.control && (
          <Insignia tono={CONTROL_FACTURA_COMPRA[f.control.control]?.tono ?? 'neutro'}>
            {CONTROL_FACTURA_COMPRA[f.control.control]?.etiqueta ?? f.control.control}
          </Insignia>
        )}
        {f.enEspera && <Insignia tono="aviso">{corrige ? 'Di si se pagó' : 'Espera a Contabilidad'}</Insignia>}
        <InsigniaDelDetector avisos={avisos} />
      </p>
      {/* La OC con boleta se dio por pagada fuera: hasta que Contabilidad lo diga, Tesorería no la paga (migración 20261022175000). */}
      {f.ruc_proveedor && <p className="tabular text-[11px] text-texto-suave">RUC {f.ruc_proveedor}</p>}
      {f.enEspera && (
        <p className="mt-1 max-w-72 text-xs text-aviso">
          {corrige
            ? `Di si la ${f.enEspera.compra} ya se pagó fuera del sistema o si falta pagarla: hasta entonces Tesorería no paga esta factura.`
            : `La ${f.enEspera.compra} va con boleta y se dio por pagada fuera del sistema: Tesorería no paga esta factura hasta que Contabilidad diga si esa OC ya se pagó o si falta pagarla.`}
        </p>
      )}
      {/* Fuera de la espera, para que lo anotado se quede a la vista cuando la fila deja de esperar. */}
      {corrige && f.estado === 'REGISTRADA' && <ConfirmarPagoDeBoleta espera={f.enEspera} factura={f.numero_documento} monedaFactura={f.moneda} hoy={hoyLima()} />}
      {f.control && detalleDelControl(f.control, (n) => moneda(n, m)) && (
        <p className={`mt-1 max-w-56 text-xs ${f.control.control === 'NO_CALZA' ? 'text-aviso' : 'text-texto-suave'}`}>
          {detalleDelControl(f.control, (n) => moneda(n, m))}
        </p>
      )}
      <div className="max-w-64">
        <AvisosDelDetector avisos={avisos} />
      </div>
      {f.estado === 'BORRADOR' && propia && <CompletarAdquisicion id={f.id} pideRuc={f.tipo === 'FACTURA_COMPRA' && !f.ruc_proveedor} />}
      <HistorialDeCorrecciones correcciones={correcciones} />
      {corrige && f.estado === 'REGISTRADA' && (
        <div className="mt-1">
          <CorregirFactura
            factura={{
              id: f.id,
              tipo: f.tipo,
              proveedor: f.proveedor,
              ruc_proveedor: f.ruc_proveedor,
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
    </>
  )
}

function NumeroDeFactura({ factura: f }: { factura: FacturaEnTabla }) {
  return f.url ? (
    <a href={f.url} target="_blank" rel="noreferrer" className={`tabular ${enlace}`}>
      {f.numero_documento}
    </a>
  ) : (
    <span className="tabular font-medium">{f.numero_documento}</span>
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
      <NombreProveedor proveedor={proveedor} acceso={acceso} />
    </TD>
  )
}

function NombreProveedor({ proveedor, acceso }: { proveedor: string; acceso: Acceso }) {
  return acceso.proveedor && proveedor ? (
    <Link href={`/proveedores?q=${encodeURIComponent(proveedor)}`} className={enlace}>
      {proveedor}
    </Link>
  ) : (
    <>{proveedor || '—'}</>
  )
}

function CeldaCodigo({ orden, acceso }: { orden: OcEnTabla; acceso: Acceso }) {
  if (orden.codigos.length === 0) {
    return (
      <TD className="align-top">
        <span className="text-texto-suave">—</span>
      </TD>
    )
  }
  // La OC que junta insumos de varios RQ lleva el código de cada uno.
  return (
    <TD className="align-top">
      <ul className="space-y-0.5">
        {orden.codigos.map((c) => (
          <li key={c} className="whitespace-nowrap">
            {acceso.codigo && c !== 'PLANTA' ? (
              <Link href={`/codigos-internos/detalle?codigo=${encodeURIComponent(c)}`} className={`tabular ${enlace}`}>
                {c}
              </Link>
            ) : (
              <span className="tabular">{c}</span>
            )}
          </li>
        ))}
      </ul>
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
              {/* Lo que tomó de lo pagado por la boleta de una OC lleva el voucher de ese pago; el que Tesorería pasó a mano dice cómo. */}
              {p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer" className={enlace}>
                  {p.pago_orden_compra_id ? (p.esNota ? 'Nota de crédito o documento' : 'Voucher de la boleta') : 'Voucher'}
                  {f.pagos.length > 1 ? ` ${i + 1}` : ''}
                </a>
              ) : (
                'Sin voucher'
              )}{' '}
              <span className="tabular text-texto-suave">
                {fecha(p.fecha)} · {moneda(p.monto, m)}
                {/* La referencia la escribe la base al pasarlo: «Tomado al cambio…» o «Descontado…». */}
                {p.monto_de_la_boleta !== null && (p.referencia?.startsWith('Tomado al cambio') ? ' (al cambio)' : ' (descontado)')}
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
