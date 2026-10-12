import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { cargarRequerimientos, catalogosDelRequerimiento, type RequerimientoListado } from '@/lib/datos/requerimientos'
import { ESTADO_REQUERIMIENTO } from '@/lib/dominio/requerimientos'
import { cantidad, fecha, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AnularRequerimiento } from './controles'
import { NuevoRequerimiento } from './formulario'

export const metadata = { title: 'Requerimientos' }

export default async function PaginaRequerimientos() {
  const perfil = await exigirPermiso(['requerimientos.emitir', 'requerimientos.ver', 'compras.crear'])
  const emite = puede(perfil, 'requerimientos.emitir')
  const [requerimientos, catalogos] = await Promise.all([
    cargarRequerimientos(),
    emite ? catalogosDelRequerimiento() : Promise.resolve(null),
  ])
  const porAtender = requerimientos.filter((r) => r.estado === 'POR_ATENDER').length

  return (
    <>
      <EncabezadoPagina
        titulo="Requerimientos"
        descripcion={
          emite
            ? 'Lo que cada área necesita comprar, con el código interno de la unidad y su justificación. Al registrarlo le llega a Logística, que lo atiende con la orden de compra.'
            : 'Los requerimientos que registra el área de Requerimientos. Logística los atiende con la orden de compra.'
        }
        migas={[{ titulo: 'Requerimientos' }]}
        acciones={catalogos && <NuevoRequerimiento {...catalogos} />}
      />

      {requerimientos.length > 0 && (
        <p className="mb-3 text-sm text-texto-suave">
          {porAtender === 0 ? 'Ninguno espera a Logística.' : `${porAtender} ${porAtender === 1 ? 'espera' : 'esperan'} a Logística.`}
        </p>
      )}

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Requerimiento</TH>
              <TH>Insumos</TH>
              <TH>En qué va</TH>
              <TH className="text-right">
                <span className="sr-only">Acciones</span>
              </TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {requerimientos.length === 0 ? (
              <SinDatos
                titulo="Todavía no hay requerimientos"
                descripcion={emite ? 'Registra el primero con «Nuevo requerimiento».' : 'El área de Requerimientos los registra; aparecen aquí con su número.'}
              />
            ) : (
              requerimientos.map((r) => <FilaRequerimiento key={r.id} rq={r} emite={emite} />)
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}

function FilaRequerimiento({ rq, emite }: { rq: RequerimientoListado; emite: boolean }) {
  const estado = ESTADO_REQUERIMIENTO[rq.estado]
  return (
    <TR>
      <TD className="align-top">
        <p className="tabular font-semibold text-texto">{rq.numero}</p>
        <p className="text-xs text-texto">
          {rq.area} · <span className="tabular">{rq.codigo_interno}</span>
        </p>
        <p className="mt-1 max-w-sm text-xs text-texto-suave">{rq.justificacion}</p>
        <p className="text-[11px] text-texto-suave">
          {[`Registrado ${fechaHora(rq.creado_en)}`, rq.fecha_requerida ? `se necesita el ${fecha(rq.fecha_requerida)}` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {rq.motivo_anulacion && <p className="mt-1 text-xs text-peligro">Anulado: {rq.motivo_anulacion}</p>}
      </TD>
      <TD className="align-top">
        <ul className="space-y-1 text-xs">
          {rq.lineas.map((l) => (
            <li key={l.item}>
              <span className="tabular font-medium text-texto">
                {cantidad(l.cantidad)} {l.unidad}
              </span>{' '}
              <span className="text-texto">{l.descripcion}</span>
              <span className="block text-[11px] text-texto-suave">{l.categoria}</span>
            </li>
          ))}
        </ul>
      </TD>
      <TD className="align-top">{estado ? <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia> : rq.estado}</TD>
      <TD className="text-right align-top">
        {emite && rq.estado === 'POR_ATENDER' && <AnularRequerimiento id={rq.id} numero={rq.numero} />}
      </TD>
    </TR>
  )
}
