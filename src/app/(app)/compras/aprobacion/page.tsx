import { redirect } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  cargarAprobacionCompras,
  cargarComprasAnulables,
  esAprobadorDeCompras,
  type CompraAnulable,
  type CompraParaAprobar,
} from '@/lib/datos/aprobacion-compras'
import { resumenDetraccion } from '@/lib/dominio/detraccion'
import { ORIGEN_COMPRA, situacionCompra } from '@/lib/dominio/logistica'
import { APROBACION_COMPRA, condicionDePago } from '@/lib/dominio/proveedores'
import { cantidad, fecha, fechaHora, moneda } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'

import { AnularCompra, DecisionCompra, FormularioRegla } from './controles'

export const metadata = { title: 'Aprobación de compras' }

const NOMBRE_AREA: Record<string, string> = { MTZ: 'Maestranza', PRD: 'Producción', ACB: 'Acabados' }

function divisa(codigo: string) {
  return codigo === 'USD' ? 'USD' : 'PEN'
}

export default async function PaginaAprobacionCompras() {
  const perfil = await exigirSesion()
  const aprueba = await esAprobadorDeCompras()
  const configura = puede(perfil, 'compras.configurar_aprobacion')
  // Las mismas tres puertas que `documentos_por_aprobar` en la base.
  if (!aprueba && !configura && !puede(perfil, 'compras.ver')) redirect('/sin-permiso')

  const [{ regla, compras, puestos }, anulables] = await Promise.all([
    cargarAprobacionCompras({ puestos: configura }),
    aprueba ? cargarComprasAnulables() : Promise.resolve([]),
  ])
  const pendientes = compras.filter((c) => c.aprobacion === 'POR_APROBAR')
  const decididas = compras.filter((c) => c.aprobacion !== 'POR_APROBAR')

  let resumen = 'Falta la regla de aprobación en la base.'
  if (regla?.activa) {
    resumen = `Las compras desde ${moneda(regla.monto_desde)} sin IGV esperan la aprobación de ${regla.rol_aprobador ?? 'su puesto'} antes de enviarse al proveedor. Las compras directas y las órdenes de servicio la esperan siempre.`
  } else if (regla) {
    resumen = 'Apagada para las compras de requerimiento. Las compras directas y las órdenes de servicio esperan aprobación siempre.'
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Aprobación de compras y servicios"
        descripcion={resumen}
        migas={[{ titulo: 'Compras' }, { titulo: 'Aprobación' }]}
      />

      <div className="space-y-6">
        <Tarjeta>
          <TarjetaCabecera
            titulo="La regla"
            ayuda={
              configura
                ? 'Desde qué monto una orden de compra espera aprobación y qué puesto la da. Cambiarla no toca las compras ya emitidas.'
                : undefined
            }
            acciones={regla && <Insignia tono={regla.activa ? 'exito' : 'neutro'}>{regla.activa ? 'Encendida' : 'Apagada'}</Insignia>}
          />
          <TarjetaCuerpo>
            {configura ? (
              <FormularioRegla regla={regla} puestos={puestos} />
            ) : (
              <p className="text-sm text-texto-suave">{resumen}</p>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-texto">
            Por aprobar <span className="tabular text-texto-suave">({pendientes.length})</span>
          </h2>
          {pendientes.length === 0 ? (
            <Tarjeta>
              <SinDatos
                enTabla={false}
                titulo="Nada espera aprobación"
                descripcion={aprueba ? 'Cuando Logística emita una compra o un servicio que la pida, aparece aquí y te llega un aviso.' : undefined}
              />
            </Tarjeta>
          ) : (
            pendientes.map((c) => <CompraPorAprobar key={`${c.tipo}-${c.id}`} compra={c} aprueba={aprueba} />)
          )}
        </section>

        {anulables.length > 0 && <ComprasAnulables compras={anulables} />}

        {decididas.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-texto">Decididas en los últimos 30 días</h2>
            <Tarjeta className="overflow-hidden">
              <Tabla>
                <TablaCabecera>
                  <tr>
                    <TH>Orden</TH>
                    <TH className="text-right">Monto</TH>
                    <TH>Decisión</TH>
                    <TH className="hidden sm:table-cell">Quién y cuándo</TH>
                  </tr>
                </TablaCabecera>
                <tbody>
                  {decididas.map((c) => {
                    const estado = APROBACION_COMPRA[c.aprobacion]
                    return (
                      <TR key={`${c.tipo}-${c.id}`}>
                        <TD>
                          <p className="font-medium text-texto">
                            {c.numero} · {c.proveedor}
                          </p>
                          <p className="text-[11px] text-texto-suave">{destino(c)}</p>
                          {c.motivo_rechazo && <p className="mt-1 text-xs text-texto-suave">Motivo: {c.motivo_rechazo}</p>}
                        </TD>
                        <TD className="tabular text-right whitespace-nowrap">{moneda(c.monto, divisa(c.moneda))}</TD>
                        <TD>{estado && <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>}</TD>
                        <TD className="hidden text-texto-suave sm:table-cell">
                          {c.decidida_por ?? '—'}
                          <p className="text-[11px]">{fechaHora(c.decidida_en)}</p>
                        </TD>
                      </TR>
                    )
                  })}
                </tbody>
              </Tabla>
            </Tarjeta>
          </section>
        )}
      </div>
    </>
  )
}

/**
 * Las OC aprobadas que todavía no llegan a Almacén: las que se pueden anular,
 * con su botón, y aparte las que ya no, con lo que lo impide.
 */
function ComprasAnulables({ compras }: { compras: CompraAnulable[] }) {
  const se = compras.filter((c) => c.impide === null)
  const no = compras.filter((c) => c.impide !== null)
  return (
    <section className="space-y-3" id="anular">
      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera
          titulo="Aprobadas que se pueden anular"
          descripcion={`${se.length} ${se.length === 1 ? 'compra' : 'compras'} sin nada entrado ni pagado`}
          ayuda="Una OC aprobada se anula con su motivo mientras el conductor no la recogió, no entró a Almacén, no tiene factura y Tesorería no le pagó nada (o el proveedor ya devolvió todo lo pagado). Sus insumos vuelven a quedar por comprar y Logística recibe el motivo. La OC no se borra: queda anulada como evidencia."
        />
        {se.length === 0 ? (
          <SinDatos enTabla={false} titulo="Ninguna se puede anular hoy" descripcion="Las aprobadas que ya avanzaron están abajo, con lo que lo impide." />
        ) : (
          <Tabla>
            <TablaCabecera>
              <tr>
                <TH>Orden</TH>
                <TH className="text-right">Monto</TH>
                <TH className="hidden sm:table-cell">En qué va</TH>
                <TH className="text-right">
                  <span className="sr-only">Anular</span>
                </TH>
              </tr>
            </TablaCabecera>
            <tbody>
              {se.map((c) => {
                const situacion = situacionCompra({ aprobacion: c.aprobacion, recojo: c.recojo, entregado_almacen_en: null })
                return (
                  <TR key={c.id}>
                    <TD>
                      <p className="font-medium text-texto">
                        {c.numero} · {c.proveedor}
                      </p>
                      <p className="text-[11px] text-texto-suave">
                        {[c.codigos.join(', '), c.ordenes.length ? `OT ${c.ordenes.join(', ')}` : null, c.con_factura ? 'Con factura' : 'Con boleta', c.aprobado_en && `aprobada ${fecha(c.aprobado_en)}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </TD>
                    <TD className="tabular text-right whitespace-nowrap">{moneda(c.monto, divisa(c.moneda))}</TD>
                    <TD className="hidden sm:table-cell">
                      <Insignia tono={situacion.tono}>{situacion.etiqueta}</Insignia>
                    </TD>
                    <TD className="text-right">
                      <AnularCompra id={c.id} numero={c.numero} />
                    </TD>
                  </TR>
                )
              })}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>
      {no.length > 0 && (
        <details className="rounded-md border border-borde bg-superficie p-3 text-sm">
          <summary className="cursor-pointer font-medium text-texto">
            {no.length} {no.length === 1 ? 'aprobada que ya no se anula' : 'aprobadas que ya no se anulan'}, y por qué
          </summary>
          <ul className="mt-3 space-y-2">
            {no.map((c) => (
              <li key={c.id}>
                <span className="font-medium text-texto">
                  {c.numero} · {c.proveedor}
                </span>
                <p className="text-xs text-texto-suave">{c.impide}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

/** Para qué es: la OT y su unidad, o el almacén en la compra directa. */
function destino(c: CompraParaAprobar) {
  // La que compra insumos de RQ va al código interno de cada uno.
  if (c.requerimientos.length > 0) return [c.codigos.join(', '), c.requerimientos.join(', ')].filter(Boolean).join(' · ')
  if (c.origen === 'DIRECTA') return 'Para el almacén'
  const partes = [c.codigo_interno, c.ordenes.length ? `OT ${c.ordenes.join(', ')}` : null, ...c.unidades].filter(Boolean)
  return partes.length ? partes.join(' · ') : c.tipo === 'OS' ? 'Sin OT' : 'OT —'
}

function CompraPorAprobar({ compra: c, aprueba }: { compra: CompraParaAprobar; aprueba: boolean }) {
  const enDolares = c.moneda === 'USD'
  const deRq = c.requerimientos.length > 0
  const origen = ORIGEN_COMPRA[c.origen === 'DIRECTA' && deRq ? 'RQ' : c.origen]
  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo={`${c.numero} · ${c.proveedor}`}
        descripcion={[
          c.proveedor_documento && (c.proveedor_documento.length === 11 ? `RUC ${c.proveedor_documento}` : c.proveedor_documento),
          c.referencia && c.referencia !== c.numero && `Ref. ${c.referencia}`,
          c.emitida_por && `Emitida por ${c.emitida_por}`,
          c.pedida_en && fechaHora(c.pedida_en),
        ]
          .filter(Boolean)
          .join(' · ')}
        acciones={
          <div className="flex flex-wrap gap-1">
            <Insignia tono="neutro">{c.tipo === 'OS' ? 'Servicio' : 'Compra'}</Insignia>
            {c.tipo === 'OC' && origen && c.origen === 'DIRECTA' && <Insignia tono={origen.tono}>{origen.etiqueta}</Insignia>}
            <Insignia tono="aviso">Por aprobar</Insignia>
          </div>
        }
      />
      <TarjetaCuerpo className="space-y-4">
        {c.motivo && (
          <p className="text-sm text-texto">
            <span className="text-xs text-texto-suave">{c.tipo === 'OS' ? 'Qué se hace: ' : deRq ? 'Para qué: ' : 'Por qué sin requerimiento: '}</span>
            {c.motivo}
          </p>
        )}
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-texto-suave">Monto sin IGV</dt>
            <dd className="tabular text-lg font-semibold text-texto">{moneda(c.monto, divisa(c.moneda))}</dd>
            {enDolares && c.monto_pen !== null && <dd className="tabular text-xs text-texto-suave">≈ {moneda(c.monto_pen)}</dd>}
          </div>
          <div>
            <dt className="text-xs text-texto-suave">Pago</dt>
            <dd className="text-texto">{condicionDePago(c.condicion_pago, c.dias_credito)}</dd>
          </div>
          <div>
            <dt className="text-xs text-texto-suave">{c.tipo === 'OS' ? 'Entrega del servicio' : 'Entrega estimada'}</dt>
            <dd className="text-texto">{fecha(c.fecha_estimada)}</dd>
          </div>
          <div>
            <dt className="text-xs text-texto-suave">Para</dt>
            <dd className="text-texto">{destino(c)}</dd>
          </div>
        </dl>
        {c.detraccion && <LineaDetraccion detraccion={c.detraccion} />}

        {c.lineas.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-borde">
          <Tabla>
            <TablaCabecera>
              <tr>
                <TH>Insumo</TH>
                <TH className="hidden sm:table-cell">OT</TH>
                <TH className="text-right">Cantidad</TH>
                <TH className="text-right">P. unitario</TH>
                <TH className="text-right">Importe</TH>
              </tr>
            </TablaCabecera>
            <tbody>
              {c.lineas.map((l, i) => (
                <TR key={`${l.material_codigo}-${l.orden}-${i}`}>
                  <TD>
                    <p className="text-texto">{l.material}</p>
                    <p className="text-[11px] text-texto-suave">
                      {l.material_codigo}
                      <span className="sm:hidden"> · {l.orden ? `OT ${l.orden}` : deRq ? 'De RQ' : 'Almacén'}</span>
                    </p>
                  </TD>
                  <TD className="hidden text-texto-suave sm:table-cell">
                    {l.orden ?? (deRq ? '—' : 'Almacén')}
                    {l.area && <p className="text-[11px]">{NOMBRE_AREA[l.area] ?? l.area}</p>}
                  </TD>
                  <TD className="tabular text-right whitespace-nowrap">
                    {cantidad(l.cantidad)} {l.unidad}
                  </TD>
                  <TD className="tabular text-right whitespace-nowrap">
                    {l.precio_unitario === null ? 'Pendiente' : moneda(l.precio_unitario, divisa(c.moneda))}
                  </TD>
                  <TD className="tabular text-right whitespace-nowrap">
                    {l.precio_unitario === null ? '—' : moneda(Number(l.cantidad) * Number(l.precio_unitario), divisa(c.moneda))}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Tabla>
        </div>
        )}

        {aprueba ? (
          <DecisionCompra id={c.id} numero={c.numero} tipo={c.tipo} />
        ) : (
          <p className="text-xs text-texto-suave">La decide quien aprueba las compras; te avisa el sistema cuando lo haga.</p>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/** La detracción de la orden de servicio: lo que se deposita aparte de lo que se paga al proveedor. */
function LineaDetraccion({ detraccion }: { detraccion: NonNullable<CompraParaAprobar['detraccion']> }) {
  const r = resumenDetraccion(detraccion)
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm" data-detraccion>
      <Insignia tono={r.tono}>{r.texto}</Insignia>
      {r.detalle && <span className="text-xs text-texto-suave">{r.detalle}</span>}
    </p>
  )
}
