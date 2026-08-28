import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { listarGarantias, listarReclamos } from '@/lib/datos/garantias'
import { fecha } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { NuevoReclamo, TarjetaReclamo } from './reclamos'

export const metadata = { title: 'Garantías' }

export default async function PaginaGarantias() {
  const perfil = await exigirPermiso('garantias.ver')
  const [garantias, reclamos] = await Promise.all([listarGarantias(), listarReclamos()])

  const gestiona = puede(perfil, 'garantias.gestionar')
  const abiertos = reclamos.filter((r) => !['NO_PROCEDE', 'ATENDIDO'].includes(r.estado))
  const cerrados = reclamos.filter((r) => ['NO_PROCEDE', 'ATENDIDO'].includes(r.estado))

  return (
    <>
      <EncabezadoPagina
        titulo="Garantías"
        descripcion="La garantía nace con la entrega, con los meses que la cotización prometió. Acá viven sus reclamos."
      />

      <div className="space-y-4">
        <Tarjeta>
          <TarjetaCabecera
            titulo="Reclamos abiertos"
            descripcion={
              abiertos.length
                ? `${abiertos.length} por resolver. El que llega fuera de plazo queda marcado, pero se registra igual.`
                : 'Nada pendiente. Los reclamos nuevos se registran desde la unidad, abajo.'
            }
          />
          <TarjetaCuerpo className="space-y-3">
            {abiertos.length === 0 ? (
              /* El vacío dice el siguiente paso, y no es el mismo para todos:
                 quien no gestiona garantías no tiene ningún botón que pulsar y
                 mandarlo a buscarlo sería hacerle perder el viaje. */
              <div className="py-6 text-center">
                <p className="text-sm font-medium text-texto">Ningún reclamo abierto</p>
                <p className="mt-1 text-xs text-texto-suave">
                  {gestiona
                    ? 'Cuando entre uno, se registra desde su unidad en la tabla de abajo, con el botón «Reclamo».'
                    : 'Los reclamos los registra el área de garantías; acá los vas a ver apenas entren.'}
                </p>
              </div>
            ) : (
              abiertos.map((r) => <TarjetaReclamo key={r.id} reclamo={r} puedeGestionar={gestiona} />)
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera
            titulo="Unidades con garantía"
            descripcion="Las que salieron del taller con un plazo prometido, las que vencen primero arriba."
          />
          <Tabla>
            <TablaCabecera>
              <tr>
                <TH>Unidad</TH>
                {/* En el teléfono sobran tres columnas: el cliente y la fecha de
                    entrega bajan a la celda de la unidad en letra chica, y el
                    estado lo dice ahí mismo su insignia. Nada se pierde, deja de
                    haber que arrastrar la tabla de lado para leer una fila. */}
                <TH className="hidden sm:table-cell">Cliente</TH>
                <TH className="hidden sm:table-cell">Entregada</TH>
                <TH>Vence</TH>
                <TH className="hidden text-center sm:table-cell">Estado</TH>
                <TH className="text-right">Reclamos</TH>
                {gestiona && <TH className="text-right">Acción</TH>}
              </tr>
            </TablaCabecera>
            <tbody>
              {garantias.length === 0 ? (
                <SinDatos
                  colSpan={gestiona ? 7 : 6}
                  titulo="Sin garantías registradas"
                  descripcion="Aparecen solas cuando se entrega una unidad con meses de garantía."
                  accion={
                    <EnlaceBoton href="/ordenes" variante="secundario">
                      Ver las órdenes de trabajo
                    </EnlaceBoton>
                  }
                />
              ) : (
                garantias.map((g) => (
                  <TR key={g.entrega_id}>
                    <TD className="font-medium">
                      <Link href={`/ordenes/${g.orden_id}`} className="hover:underline">
                        {g.placa ?? g.orden}
                      </Link>
                      <p className="text-[11px] font-normal text-texto-suave">
                        {g.carroceria ?? g.orden}
                      </p>
                      <p className="text-[11px] font-normal text-texto-suave sm:hidden">
                        {g.cliente} · entregada {fecha(g.fecha_entrega)}
                      </p>
                      <span className="mt-1 inline-flex sm:hidden">
                        <Insignia tono={g.vigente ? 'exito' : 'neutro'}>
                          {g.vigente ? 'Vigente' : 'Vencida'}
                        </Insignia>
                      </span>
                    </TD>
                    <TD className="hidden text-texto-suave sm:table-cell">{g.cliente}</TD>
                    <TD className="hidden whitespace-nowrap sm:table-cell">
                      {fecha(g.fecha_entrega)}
                    </TD>
                    <TD className="whitespace-nowrap">
                      {fecha(g.garantia_vence)}
                      {g.vigente && (
                        <p className="text-[11px] text-texto-suave">
                          {g.dias_restantes} días restantes
                        </p>
                      )}
                    </TD>
                    <TD className="hidden text-center sm:table-cell">
                      <Insignia tono={g.vigente ? 'exito' : 'neutro'}>
                        {g.vigente ? 'Vigente' : 'Vencida'}
                      </Insignia>
                    </TD>
                    <TD className="tabular text-right">
                      {g.reclamos}
                      {g.reclamos_abiertos > 0 && (
                        <span className="ml-1 text-[11px] text-aviso">({g.reclamos_abiertos} abiertos)</span>
                      )}
                    </TD>
                    {gestiona && (
                      <TD className="text-right">
                        <NuevoReclamo entregaId={g.entrega_id} unidad={g.placa ?? g.orden} />
                      </TD>
                    )}
                  </TR>
                ))
              )}
            </tbody>
          </Tabla>
        </Tarjeta>

        {cerrados.length > 0 && (
          <Tarjeta>
            <TarjetaCabecera titulo="Reclamos cerrados" descripcion="La historia: cómo se resolvió cada uno." />
            <TarjetaCuerpo className="space-y-3">
              {cerrados.slice(0, 20).map((r) => (
                <TarjetaReclamo key={r.id} reclamo={r} puedeGestionar={false} />
              ))}
            </TarjetaCuerpo>
          </Tarjeta>
        )}
      </div>
    </>
  )
}
