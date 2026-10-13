import { FileDown } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { catalogoDeAlmacen } from '@/lib/datos/atencion-materiales'
import { cargarOrdenesCompra, type OrdenCompraListada } from '@/lib/datos/logistica'
import { proveedoresParaCompra } from '@/lib/datos/proveedores'
import { ORIGEN_COMPRA, puedeIrARecojo, situacionCompra } from '@/lib/dominio/logistica'
import { comprobantePedido, compraDetenida, condicionDePago } from '@/lib/dominio/proveedores'
import { fecha, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AccionesCompra } from './acciones-compra'
import { NuevaCompraDirecta } from './formulario-directa'

export const metadata = { title: 'Órdenes de compra' }

function divisa(codigo: string) {
  return codigo === 'USD' ? 'USD' : 'PEN'
}

export default async function PaginaOrdenesCompra() {
  const perfil = await exigirPermiso(['compras.crear', 'compras.ver'])
  const emite = puede(perfil, 'compras.crear')
  const [compras, proveedores, materiales] = await Promise.all([
    cargarOrdenesCompra(),
    emite ? proveedoresParaCompra() : Promise.resolve([]),
    emite ? catalogoDeAlmacen() : Promise.resolve([]),
  ])
  const sinComprobante = compras.filter((c) => !c.tiene_factura && c.aprobacion !== 'RECHAZADA').length

  return (
    <>
      <EncabezadoPagina
        titulo="Órdenes de compra"
        descripcion="Todas las órdenes, con su número OC-…-MW: las que nacen de un requerimiento de OT y las directas para el almacén. Aquí se ve si esperan a Gerencia, si el conductor ya las recogió y si falta el comprobante."
        migas={[{ titulo: 'Compras', ruta: emite ? '/compras' : undefined }, { titulo: 'Órdenes de compra' }]}
        acciones={
          emite && (
            <NuevaCompraDirecta
              proveedores={proveedores}
              materiales={materiales}
              puedeRegistrarProveedor={puede(perfil, 'proveedores.editar')}
            />
          )
        }
      />

      {sinComprobante > 0 && (
        <p className="mb-3 text-sm text-texto-suave">
          <span className="tabular font-semibold text-texto">{sinComprobante}</span>{' '}
          {sinComprobante === 1
            ? 'orden sigue sin su comprobante adjunto (factura, o boleta si es sin factura).'
            : 'órdenes siguen sin su comprobante adjunto (factura, o boleta si es sin factura).'}
        </p>
      )}

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Orden</TH>
              <TH className="hidden md:table-cell">Para</TH>
              <TH className="text-right">Monto sin IGV</TH>
              <TH>En qué va</TH>
              <TH className="hidden sm:table-cell">Comprobante</TH>
              <TH className="text-right">
                <span className="sr-only">Acciones</span>
              </TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {compras.length === 0 ? (
              <SinDatos
                titulo="Todavía no hay órdenes de compra"
                descripcion={
                  emite
                    ? 'Emite una directa con «Nueva OC directa», o desde Compras para atender un requerimiento.'
                    : 'Logística las emite; aparecen aquí con su número.'
                }
              />
            ) : (
              compras.map((c) => <FilaCompra key={c.id} compra={c} emite={emite} />)
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}

function FilaCompra({ compra: c, emite }: { compra: OrdenCompraListada; emite: boolean }) {
  const origen = ORIGEN_COMPRA[c.origen]
  const situacion = situacionCompra(c)
  const para = [
    c.codigo_interno,
    ...(c.origen === 'DIRECTA' ? ['Almacén'] : [c.ordenes.length ? `OT ${c.ordenes.join(', ')}` : null, ...c.unidades]),
    // Qué requerimiento (RQ-0001-2026…) atiende esta compra, si nació de uno.
    c.requerimientos.length ? c.requerimientos.join(', ') : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const comprobante = comprobantePedido(c.con_factura)
  return (
    <TR>
      <TD>
        <div className="flex flex-wrap items-center gap-2">
          <span className="tabular font-semibold text-texto">{c.numero}</span>
          {origen && <Insignia tono={origen.tono}>{origen.etiqueta}</Insignia>}
        </div>
        <p className="text-xs text-texto">{c.proveedor}</p>
        <p className="text-[11px] text-texto-suave">
          {[
            c.referencia && c.referencia !== c.numero ? `Ref. ${c.referencia}` : null,
            condicionDePago(c.condicion_pago, c.dias_credito),
            `${c.lineas} ${c.lineas === 1 ? 'línea' : 'líneas'}`,
            fecha(c.creado_en),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {c.motivo && <p className="mt-1 text-xs text-texto-suave">Motivo: {c.motivo}</p>}
        {c.motivo_rechazo && <p className="mt-1 text-xs text-peligro">Rechazada: {c.motivo_rechazo}</p>}
        <p className="text-[11px] text-texto-suave md:hidden">Para {para || '—'}</p>
      </TD>
      <TD className="hidden text-texto-suave md:table-cell">{para || '—'}</TD>
      <TD className="tabular text-right whitespace-nowrap">{moneda(c.monto, divisa(c.moneda))}</TD>
      <TD>
        <Insignia tono={situacion.tono}>{situacion.etiqueta}</Insignia>
      </TD>
      <TD className="hidden sm:table-cell">
        {c.tiene_factura ? (
          <Insignia tono="exito">Adjunto</Insignia>
        ) : (
          <span className="text-xs text-texto-suave">{c.con_factura ? 'Factura pendiente' : 'Comprobante pendiente'}</span>
        )}
        <p className="text-[11px] text-texto-suave">{comprobante.etiqueta}</p>
      </TD>
      <TD className="text-right">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!compraDetenida(c.aprobacion) && (
            <a
              href={`/compras/${c.id}/pdf`}
              download
              className="inline-flex items-center gap-1 text-xs text-acento hover:underline"
              aria-label={`Descargar el PDF de la orden ${c.numero}`}
            >
              <FileDown aria-hidden className="size-4" />
              PDF
            </a>
          )}
          {emite && (
            <AccionesCompra
              id={c.id}
              numero={c.numero}
              recojo={puedeIrARecojo(c)}
              adjuntar={c.aprobacion !== 'RECHAZADA'}
              conFactura={c.con_factura}
              codigoInterno={c.codigo_interno}
              tieneComprobante={c.tiene_factura}
            />
          )}
        </div>
      </TD>
    </TR>
  )
}
