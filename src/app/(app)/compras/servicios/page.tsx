import { Search } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Boton } from '@/components/ui/boton'
import { Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import {
  areasSolicitantes,
  cargarOrdenesServicio,
  cargarTiposDetraccion,
  otsParaLogistica,
  type OrdenServicioListada,
} from '@/lib/datos/logistica'
import { proveedoresParaCompra } from '@/lib/datos/proveedores'
import { llaveParecido } from '@/lib/dominio/codigos-internos'
import { resumenDetraccion, type TipoDetraccion } from '@/lib/dominio/detraccion'
import { ESTADO_SERVICIO } from '@/lib/dominio/logistica'
import { APROBACION_COMPRA, condicionDePago } from '@/lib/dominio/proveedores'
import { fecha, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AvanceServicio, CorregirServicio } from './controles'
import { NuevaOrdenServicio } from './formulario'

export const metadata = { title: 'Órdenes de servicio' }

export default async function PaginaOrdenesServicio({ searchParams }: { searchParams: Promise<{ codigo?: string }> }) {
  const perfil = await exigirPermiso(['compras.crear', 'compras.ver', 'compras.detraccion'])
  const emite = puede(perfil, 'compras.crear')
  const corrigeDetraccion = puede(perfil, ['compras.crear', 'compras.detraccion'])
  const { codigo = '' } = await searchParams
  const buscado = codigo.trim()
  const [servicios, tipos, proveedores, ordenes, areas] = await Promise.all([
    cargarOrdenesServicio(),
    cargarTiposDetraccion(),
    emite ? proveedoresParaCompra() : Promise.resolve([]),
    emite ? otsParaLogistica() : Promise.resolve([]),
    emite ? areasSolicitantes() : Promise.resolve([]),
  ])
  // El código se compara como en «Códigos internos»: sin mayúsculas, espacios ni signos, y O igual a 0.
  const llave = llaveParecido(buscado)
  const visibles = buscado ? servicios.filter((s) => s.codigo_interno && llaveParecido(s.codigo_interno).includes(llave)) : servicios

  return (
    <>
      <EncabezadoPagina
        titulo="Órdenes de servicio"
        descripcion="Los trabajos que hace un tercero —torno, pintura, doblez—, con su número OS-…-MW, el código interno de la unidad y su detracción. Gerencia las aprueba; Logística marca cuándo empiezan y cuándo vuelven conformes."
        migas={[{ titulo: emite ? 'Compras' : 'Contabilidad', ruta: emite ? '/compras' : undefined }, { titulo: 'Órdenes de servicio' }]}
        acciones={
          emite && (
            <NuevaOrdenServicio
              proveedores={proveedores}
              ordenes={ordenes}
              areas={areas}
              tipos={tipos}
              puedeRegistrarProveedor={puede(perfil, 'proveedores.editar')}
            />
          )
        }
      />

      <form className="flex max-w-md gap-2" role="search">
        <Entrada name="codigo" defaultValue={buscado} placeholder="Código interno, por ejemplo PLA_SR_O4_1_26/28" aria-label="Buscar por código interno" />
        <Boton type="submit" variante="secundario">
          <Search aria-hidden className="size-4" />
          Buscar
        </Boton>
      </form>

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Orden</TH>
              <TH className="hidden md:table-cell">Para</TH>
              <TH className="hidden text-right sm:table-cell">Monto sin IGV</TH>
              <TH className="hidden sm:table-cell">En qué va</TH>
              <TH className="text-right">
                <span className="sr-only">Acciones</span>
              </TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {visibles.length === 0 ? (
              <SinDatos
                titulo={buscado ? `Ninguna orden de servicio lleva el código ${buscado}` : 'Todavía no hay órdenes de servicio'}
                descripcion={
                  buscado
                    ? 'Revisa cómo está escrito o borra la búsqueda para ver todas.'
                    : emite
                      ? 'Emite la primera con «Nueva orden de servicio».'
                      : 'Logística las emite; aparecen aquí con su número.'
                }
              />
            ) : (
              visibles.map((s) => (
                <FilaServicio key={s.id} servicio={s} emite={emite} corrigeDetraccion={corrigeDetraccion} tipos={tipos} />
              ))
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}

function FilaServicio({
  servicio: s,
  emite,
  corrigeDetraccion,
  tipos,
}: {
  servicio: OrdenServicioListada
  emite: boolean
  corrigeDetraccion: boolean
  tipos: TipoDetraccion[]
}) {
  const para = [s.orden ? `OT ${s.orden}` : null, s.unidad, s.area].filter(Boolean).join(' · ')
  const abierta = s.estado === 'EMITIDA' || s.estado === 'EN_EJECUCION'
  const vigente = s.estado !== 'ANULADA' && s.aprobacion !== 'RECHAZADA'
  return (
    <TR data-servicio={s.numero}>
      <TD>
        <p className="tabular font-semibold text-texto">{s.numero}</p>
        <p className="text-xs text-texto">{s.proveedor}</p>
        <p className="mt-1 text-xs text-texto-suave">{s.descripcion}</p>
        <p className="text-[11px] text-texto-suave">
          {[
            s.referencia ? `Ref. ${s.referencia}` : null,
            condicionDePago(s.condicion_pago, s.dias_credito),
            s.fecha_inicio || s.fecha_fin ? `${fecha(s.fecha_inicio)} → ${fecha(s.fecha_fin)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {s.motivo_rechazo && <p className="mt-1 text-xs text-peligro">Rechazada: {s.motivo_rechazo}</p>}
        {s.motivo_anulacion && <p className="mt-1 text-xs text-peligro">Anulada: {s.motivo_anulacion}</p>}
        {s.observacion_conformidad && <p className="mt-1 text-xs text-texto-suave">Conformidad: {s.observacion_conformidad}</p>}
        <p className="mt-1 text-[11px] text-texto-suave md:hidden">
          <span className="tabular font-medium text-texto" data-codigo>
            {s.codigo_interno ?? 'Sin código interno'}
          </span>
          {para && ` · ${para}`}
        </p>
        {/* En el teléfono, el monto y en qué va van aquí: la tabla no cabe con sus columnas. */}
        <div className="mt-2 space-y-1 sm:hidden">
          <p className="tabular text-sm font-semibold text-texto">{moneda(s.monto, s.moneda === 'USD' ? 'USD' : 'PEN')} sin IGV</p>
          <EnQueVa servicio={s} />
        </div>
      </TD>
      <TD className="hidden md:table-cell">
        <p className={s.codigo_interno ? 'tabular font-medium text-texto' : 'text-aviso'}>{s.codigo_interno ?? 'Sin código interno'}</p>
        {para && <p className="text-xs text-texto-suave">{para}</p>}
      </TD>
      <TD className="tabular hidden text-right whitespace-nowrap sm:table-cell">{moneda(s.monto, s.moneda === 'USD' ? 'USD' : 'PEN')}</TD>
      <TD className="hidden sm:table-cell">
        <EnQueVa servicio={s} />
      </TD>
      <TD className="text-right">
        <div className="flex flex-col items-end gap-2">
          {emite && s.aprobacion !== 'RECHAZADA' && abierta && (
            <AvanceServicio
              id={s.id}
              numero={s.numero}
              iniciar={s.aprobacion === 'APROBADA' && s.estado === 'EMITIDA'}
              conformar={s.aprobacion === 'APROBADA'}
              anular
            />
          )}
          {corrigeDetraccion && vigente && (
            <CorregirServicio
              id={s.id}
              numero={s.numero}
              codigoInterno={s.codigo_interno}
              detraccion={s.detraccion}
              montoSinIgvPen={s.monto_pen}
              enDolares={s.moneda === 'USD'}
              tipos={tipos}
              cambiaCodigo={emite && abierta}
            />
          )}
        </div>
      </TD>
    </TR>
  )
}

/** En qué va la OS y su detracción. */
function EnQueVa({ servicio: s }: { servicio: OrdenServicioListada }) {
  // Mientras Gerencia no decide, manda la aprobación; después, el estado del trabajo.
  const decision = s.aprobacion === 'APROBADA' ? null : APROBACION_COMPRA[s.aprobacion]
  const estado = ESTADO_SERVICIO[s.estado]
  const mostrar = s.estado === 'ANULADA' ? estado : (decision ?? estado)
  const detraccion = resumenDetraccion(s.detraccion)
  return (
    <>
      <div className="flex flex-wrap gap-1">
        {mostrar && <Insignia tono={mostrar.tono}>{mostrar.etiqueta}</Insignia>}
        {s.atrasada && <Insignia tono="peligro">Atrasada</Insignia>}
      </div>
      <div className="mt-1" data-detraccion>
        <Insignia tono={detraccion.tono}>{detraccion.texto}</Insignia>
        {detraccion.detalle && <p className="mt-0.5 max-w-64 text-[11px] text-texto-suave">{detraccion.detalle}</p>}
      </div>
    </>
  )
}
