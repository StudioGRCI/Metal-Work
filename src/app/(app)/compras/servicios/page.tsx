import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { areasSolicitantes, cargarOrdenesServicio, otsParaLogistica, type OrdenServicioListada } from '@/lib/datos/logistica'
import { proveedoresParaCompra } from '@/lib/datos/proveedores'
import { ESTADO_SERVICIO } from '@/lib/dominio/logistica'
import { APROBACION_COMPRA, condicionDePago } from '@/lib/dominio/proveedores'
import { fecha, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AvanceServicio } from './controles'
import { NuevaOrdenServicio } from './formulario'

export const metadata = { title: 'Órdenes de servicio' }

export default async function PaginaOrdenesServicio() {
  const perfil = await exigirPermiso(['compras.crear', 'compras.ver'])
  const emite = puede(perfil, 'compras.crear')
  const [servicios, proveedores, ordenes, areas] = await Promise.all([
    cargarOrdenesServicio(),
    emite ? proveedoresParaCompra() : Promise.resolve([]),
    emite ? otsParaLogistica() : Promise.resolve([]),
    emite ? areasSolicitantes() : Promise.resolve([]),
  ])

  return (
    <>
      <EncabezadoPagina
        titulo="Órdenes de servicio"
        descripcion="Los trabajos que hace un tercero —torno, pintura, doblez—, con su número OS-…-MW. Gerencia las aprueba; Logística marca cuándo empiezan y cuándo vuelven conformes."
        migas={[{ titulo: 'Compras', ruta: emite ? '/compras' : undefined }, { titulo: 'Órdenes de servicio' }]}
        acciones={
          emite && (
            <NuevaOrdenServicio
              proveedores={proveedores}
              ordenes={ordenes}
              areas={areas}
              puedeRegistrarProveedor={puede(perfil, 'proveedores.editar')}
            />
          )
        }
      />

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Orden</TH>
              <TH className="hidden md:table-cell">Para</TH>
              <TH className="text-right">Monto sin IGV</TH>
              <TH>En qué va</TH>
              <TH className="text-right">
                <span className="sr-only">Acciones</span>
              </TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {servicios.length === 0 ? (
              <SinDatos
                titulo="Todavía no hay órdenes de servicio"
                descripcion={emite ? 'Emite la primera con «Nueva orden de servicio».' : 'Logística las emite; aparecen aquí con su número.'}
              />
            ) : (
              servicios.map((s) => <FilaServicio key={s.id} servicio={s} emite={emite} />)
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}

function FilaServicio({ servicio: s, emite }: { servicio: OrdenServicioListada; emite: boolean }) {
  // Mientras Gerencia no decide, manda la aprobación; después, el estado del trabajo.
  const decision = s.aprobacion === 'APROBADA' ? null : APROBACION_COMPRA[s.aprobacion]
  const estado = ESTADO_SERVICIO[s.estado]
  const mostrar = s.estado === 'ANULADA' ? estado : (decision ?? estado)
  const para = [s.orden ? `OT ${s.orden}` : null, s.unidad, s.area].filter(Boolean).join(' · ')
  const abierta = s.estado === 'EMITIDA' || s.estado === 'EN_EJECUCION'
  return (
    <TR>
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
        <p className="text-[11px] text-texto-suave md:hidden">Para {para || '—'}</p>
      </TD>
      <TD className="hidden text-texto-suave md:table-cell">{para || '—'}</TD>
      <TD className="tabular text-right whitespace-nowrap">{moneda(s.monto, s.moneda === 'USD' ? 'USD' : 'PEN')}</TD>
      <TD>
        <div className="flex flex-wrap gap-1">
          {mostrar && <Insignia tono={mostrar.tono}>{mostrar.etiqueta}</Insignia>}
          {s.atrasada && <Insignia tono="peligro">Atrasada</Insignia>}
        </div>
      </TD>
      <TD className="text-right">
        {emite && s.aprobacion !== 'RECHAZADA' && abierta && (
          <AvanceServicio
            id={s.id}
            numero={s.numero}
            iniciar={s.aprobacion === 'APROBADA' && s.estado === 'EMITIDA'}
            conformar={s.aprobacion === 'APROBADA'}
            anular
          />
        )}
      </TD>
    </TR>
  )
}
