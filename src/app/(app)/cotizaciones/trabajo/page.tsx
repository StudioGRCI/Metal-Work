import Link from 'next/link'
import { ClipboardList, RotateCcw, Send } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Indicador } from '@/components/ui/indicador'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { ESTADO_COTIZACION, definir } from '@/lib/dominio/estados'
import { nombreDeUnidad, todaviaSinPlaca } from '@/lib/dominio/unidades'
import { diasHasta, fecha, moneda } from '@/lib/format'
import { listarCotizacionesDeTrabajo } from '@/lib/datos/comercial'
import { exigirPermiso } from '@/lib/sesion'
import type { CodigoMoneda } from '@/lib/format'
import type { UnidadNombrable } from '@/lib/dominio/unidades'

export const metadata = { title: 'Cotización de trabajo' }

/** Los tres estados en los que el papel pasa por esta mesa. */
const FILTROS = [
  { valor: null, etiqueta: 'Lo que me toca' },
  { valor: 'EN_COSTEO', etiqueta: 'Por costear' },
  { valor: 'OBSERVADA', etiqueta: 'Devueltas' },
  { valor: 'EN_REVISION', etiqueta: 'Con Gerencia' },
]

/** Desde cuándo espera: en costeo, desde que Ventas la mandó; con Gerencia,
 *  desde que se subió. Devuelta no tiene sello propio y se deja en raya antes
 *  que inventar un número que después alguien usa para ir a reclamar. */
function esperandoDesde(c: {
  estado: string
  costeo_pedido_en: string | null
  costeo_listo_en: string | null
}) {
  if (c.estado === 'EN_COSTEO') return c.costeo_pedido_en
  if (c.estado === 'EN_REVISION') return c.costeo_listo_en
  return null
}

function espera(desde: string | null) {
  const restantes = diasHasta(desde)
  if (restantes === null) return null

  const dias = Math.max(0, -restantes)
  return {
    texto: dias === 0 ? 'hoy' : `${dias} ${dias === 1 ? 'día' : 'días'}`,
    // Dos días es el trámite normal; de tres para arriba es una cotización
    // olvidada, y a la semana el cliente ya se cansó de esperar.
    clase: dias >= 7 ? 'text-peligro' : dias >= 3 ? 'text-aviso' : 'text-texto-suave',
  }
}

export default async function PaginaCotizacionDeTrabajo({
  searchParams,
}: PageProps<'/cotizaciones/trabajo'>) {
  // Es la mesa de Administración: quien no costea, no entra.
  await exigirPermiso('cotizaciones.costear')
  const params = await searchParams

  const estado = typeof params.estado === 'string' ? params.estado : undefined
  const cotizaciones = await listarCotizacionesDeTrabajo({ estado })

  const porCostear = cotizaciones.filter((c) => c.estado === 'EN_COSTEO').length
  const devueltas = cotizaciones.filter((c) => c.estado === 'OBSERVADA').length
  const conGerencia = cotizaciones.filter((c) => c.estado === 'EN_REVISION').length

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Cotización de trabajo' }]}
        titulo="Cotización de trabajo"
        descripcion="Lo que Ventas ya cotizó y espera su detalle: las partidas, la ficha técnica y los accesorios. Con esto se compra el material y se programa el taller; no sale impreso en el papel del cliente."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador
          titulo="Por costear"
          valor={porCostear}
          icono={ClipboardList}
          tono={porCostear > 0 ? 'acento' : 'neutro'}
          pie="Ventas ya las mandó"
          href="/cotizaciones/trabajo?estado=EN_COSTEO"
        />
        <Indicador
          titulo="Devueltas"
          valor={devueltas}
          icono={RotateCcw}
          tono={devueltas > 0 ? 'peligro' : 'neutro'}
          pie="Gerencia pidió corregirlas"
          href="/cotizaciones/trabajo?estado=OBSERVADA"
        />
        <Indicador
          titulo="Con Gerencia"
          valor={conGerencia}
          icono={Send}
          tono="neutro"
          pie="Esperando el visto"
          href="/cotizaciones/trabajo?estado=EN_REVISION"
        />
      </div>

      <PastillaFiltro
        ruta="/cotizaciones/trabajo"
        clave="estado"
        opciones={FILTROS}
        params={params}
        activo={estado ?? null}
        etiqueta="Filtrar por etapa"
        className="mt-4"
      />

      <Tarjeta className="mt-4 overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Cotización</TH>
              <TH>Cliente / unidad</TH>
              <TH className="hidden sm:table-cell">Carrocería</TH>
              <TH className="text-right">Precio ofrecido</TH>
              <TH className="text-right">Costo cargado</TH>
              <TH>Etapa</TH>
              <TH className="text-right">Esperando</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {cotizaciones.length === 0 ? (
              <SinDatos
                colSpan={7}
                titulo={estado ? 'Nada en esta etapa' : 'No hay nada esperando costeo'}
                descripcion={
                  estado
                    ? 'Prueba con otra etapa: puede que la cotización ya haya seguido su camino.'
                    : 'Cuando Ventas mande una cotización a costear, aparece acá con el nombre del cliente y lo que se le ofreció.'
                }
              />
            ) : (
              cotizaciones.map((c) => {
                const etapa = definir(ESTADO_COTIZACION, c.estado)
                const mon = (c.moneda ?? 'PEN') as CodigoMoneda
                const cliente = c.cliente as unknown as { razon_social: string } | null
                const unidad = c.unidad as unknown as UnidadNombrable | null
                const carroceria = c.tipo_carroceria as unknown as { nombre: string } | null
                const aguarda = espera(esperandoDesde(c))

                // Lo que de verdad se pregunta el de Administración al abrirla:
                // si el trabajo cabe en el precio que Ventas prometió.
                const precio = Number(c.precio_venta ?? 0)
                const costo = Number(c.costo_estimado ?? 0)
                const seAprieta = costo > 0 && precio > 0 && costo > precio

                return (
                  <TR key={c.id}>
                    <TD className="whitespace-nowrap">
                      <Link
                        href={`/cotizaciones/${c.id}`}
                        className="font-medium text-acento hover:underline"
                      >
                        {c.numero}
                      </Link>
                      <p className="text-[11px] text-texto-suave">{fecha(c.fecha_emision)}</p>
                    </TD>

                    <TD>
                      <p className="max-w-52 truncate text-texto">{cliente?.razon_social ?? '—'}</p>
                      <p className="text-[11px] text-texto-suave">
                        {/* Mientras la placa no llega, la unidad se nombra con lo
                            que la identifique; en letra más tenue para que no se
                            confunda con una matrícula. */}
                        <span className={todaviaSinPlaca(unidad) ? 'text-texto-tenue' : undefined}>
                          {nombreDeUnidad(unidad)}
                        </span>
                        <span className="sm:hidden">
                          {carroceria?.nombre ? ` · ${carroceria.nombre}` : ''}
                        </span>
                      </p>
                    </TD>

                    <TD className="hidden max-w-40 truncate text-texto-suave sm:table-cell">
                      {carroceria?.nombre ?? '—'}
                    </TD>

                    <TD className="tabular text-right whitespace-nowrap">{moneda(precio, mon)}</TD>

                    <TD className="tabular text-right whitespace-nowrap">
                      {costo > 0 ? (
                        <span className={seAprieta ? 'font-medium text-aviso' : 'text-texto'}>
                          {moneda(costo, mon)}
                        </span>
                      ) : (
                        <span className="text-texto-tenue">sin partidas</span>
                      )}
                      {seAprieta && (
                        <p className="text-[11px] text-aviso">se pasa del precio</p>
                      )}
                    </TD>

                    <TD>
                      <Insignia tono={etapa.tono}>{etapa.etiqueta}</Insignia>
                      {c.estado === 'OBSERVADA' && c.motivo_observacion && (
                        <p className="mt-0.5 max-w-56 truncate text-[11px] text-peligro">
                          {c.motivo_observacion}
                        </p>
                      )}
                    </TD>

                    <TD className="text-right whitespace-nowrap">
                      {aguarda ? (
                        <span className={`text-xs ${aguarda.clase}`}>{aguarda.texto}</span>
                      ) : (
                        <span className="text-texto-tenue">—</span>
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
