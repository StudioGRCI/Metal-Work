import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia, type Tono } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { costoDeOrdenes } from '@/lib/datos/costos-ot'
import { historiaDeUnidad, obtenerUnidad, type HistoriaDeUnidad } from '@/lib/datos/unidades'
import { TIPO_TRABAJO, definir, estadoDeOrden } from '@/lib/dominio/estados'
import { dias, diasEntre } from '@/lib/dominio/expediente'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import { fecha, hoyLima, moneda, numero, porcentaje } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { cn } from '@/lib/utils'

export async function generateMetadata({ params }: PageProps<'/unidades/[id]'>): Promise<Metadata> {
  const { id } = await params
  const unidad = await obtenerUnidad(id)
  return { title: unidad ? nombreDeUnidad(unidad) : 'Unidad no encontrada' }
}

/**
 * La ficha de una unidad: el vehículo, su garantía y todo lo que pasó con él en
 * el taller —la fabricación de la carrocería, las garantías, las reparaciones—,
 * con lo que costó cada trabajo para quien ve el costo. Es la pregunta de
 * Gerencia sobre una carrocería ya entregada: «¿qué le hicimos y cuánto nos
 * costó, garantías incluidas?».
 */
export default async function PaginaUnidad({ params }: PageProps<'/unidades/[id]'>) {
  const perfil = await exigirPermiso(['clientes.ver', 'produccion.ver'])
  const { id } = await params

  const unidad = await obtenerUnidad(id)
  if (!unidad) notFound()

  const verOrdenes = puede(perfil, 'ordenes.ver')
  const verCosto = puede(perfil, 'costos.ver')
  const verMargen = verCosto && puede(perfil, 'cotizaciones.ver_pdf_comercial')

  const historia = await historiaDeUnidad(unidad)
  const costos =
    verCosto && historia.ordenes.length > 0
      ? await costoDeOrdenes(
          historia.ordenes.map((o) => o.id),
          { conMargen: verMargen },
        )
      : null

  const hoy = hoyLima()
  const nombre = nombreDeUnidad(unidad)
  const cliente = unidad.cliente as unknown as { id: string; razon_social: string } | null
  const carroceria = unidad.tipo_carroceria as unknown as { nombre: string } | null
  const vehiculo = [unidad.marca, unidad.modelo, unidad.anio].filter(Boolean).join(' ')
  const capacidad = [
    unidad.capacidad_m3 ? `${numero(unidad.capacidad_m3, 1)} m³` : null,
    unidad.capacidad_toneladas ? `${numero(unidad.capacidad_toneladas, 1)} t` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  // Lo que costó la unidad en el taller, y cuánto de eso fueron garantías.
  let costoTotal = 0
  let costoGarantias = 0
  let sinCosto = 0
  for (const o of historia.ordenes) {
    const c = costos?.get(o.id)
    if (!c) {
      sinCosto += 1
      continue
    }
    costoTotal += c.pen
    if (o.tipo_trabajo === 'GARANTIA') costoGarantias += c.pen
  }
  const garantias = historia.ordenes.filter((o) => o.tipo_trabajo === 'GARANTIA').length

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Unidades', ruta: '/unidades' }, { titulo: nombre }]}
        titulo={nombre}
        descripcion={[vehiculo || null, carroceria?.nombre ?? null, unidad.activo ? null : 'Desactivada']
          .filter(Boolean)
          .join(' · ')}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Tarjeta>
          <TarjetaCabecera titulo="El vehículo" />
          <TarjetaCuerpo>
            <Dato etiqueta="Cliente" valor={cliente?.razon_social ?? (unidad.cliente_id ? null : 'Del taller, sin cliente')} enlace={cliente ? `/clientes/${cliente.id}` : undefined} />
            <Dato etiqueta="Placa" valor={unidad.placa} />
            <Dato etiqueta="Código interno" valor={unidad.codigo_interno} />
            <Dato etiqueta="FMI" valor={unidad.numero_fmi} />
            <Dato etiqueta="N.º de chasis" valor={unidad.numero_chasis} />
            <Dato etiqueta="N.º de motor" valor={unidad.numero_motor} />
            <Dato etiqueta="Vehículo" valor={vehiculo} />
            <Dato etiqueta="Tipo" valor={unidad.tipo_vehiculo} />
            <Dato etiqueta="Carrocería" valor={carroceria?.nombre} />
            <Dato etiqueta="Capacidad" valor={capacidad} />
            <Dato etiqueta="Color" valor={unidad.color} />
          </TarjetaCuerpo>
        </Tarjeta>

        <div className="min-w-0 space-y-4 lg:col-span-2">
          {verOrdenes && <Garantia historia={historia} hoy={hoy} />}

          {verCosto && historia.ordenes.length > 0 && (
            <section aria-label="Costo en el taller" className={cn('grid grid-cols-2 gap-3', sinCosto > 0 && 'sm:grid-cols-3')}>
              <Cifra etiqueta="Costo en el taller" valor={moneda(costoTotal)} pie={`${historia.ordenes.length} ${historia.ordenes.length === 1 ? 'orden' : 'órdenes'}, en soles`} />
              <Cifra
                etiqueta="En garantías"
                valor={moneda(costoGarantias)}
                pie={garantias === 0 ? 'Ninguna garantía' : `${garantias} ${garantias === 1 ? 'garantía' : 'garantías'}`}
                tono={costoGarantias > 0 ? 'aviso' : undefined}
              />
              {sinCosto > 0 && (
                <Cifra etiqueta="Sin cifra" valor={String(sinCosto)} pie="Órdenes cuyo costo no se pudo calcular" tono="aviso" />
              )}
            </section>
          )}

          <Tarjeta className="overflow-hidden">
            <TarjetaCabecera
              titulo="Historia en el taller"
              descripcion={
                verOrdenes
                  ? 'Cada trabajo que se le hizo, del más reciente al primero.'
                  : 'Las órdenes de trabajo las ve quien tiene acceso a órdenes.'
              }
            />
            {verOrdenes && (
              <Tabla>
                <TablaCabecera>
                  <tr>
                    <TH>OT</TH>
                    <TH>Trabajo</TH>
                    <TH className="hidden sm:table-cell">Entrega</TH>
                    <TH className="text-right">Avance</TH>
                    {verCosto && <TH className="text-right">Costo</TH>}
                  </tr>
                </TablaCabecera>
                <tbody>
                  {historia.ordenes.length === 0 ? (
                    <SinDatos
                      colSpan={verCosto ? 5 : 4}
                      titulo="Todavía sin órdenes"
                      descripcion="Cuando se le abra una orden de trabajo, aparece aquí con su avance y su entrega."
                    />
                  ) : (
                    historia.ordenes.map((o) => {
                      const estado = estadoDeOrden(o.estado, o.abierta_en_taller)
                      const trabajo = definir(TIPO_TRABAJO, o.tipo_trabajo)
                      const costo = costos?.get(o.id) ?? null
                      return (
                        <TR key={o.id}>
                          <TD className="whitespace-nowrap">
                            <Link href={`/ordenes/${o.id}`} className="font-medium text-acento hover:underline">
                              {o.numero}
                            </Link>
                            <span className="tabular block text-[11px] text-texto-tenue">Registro {fecha(o.fecha_registro)}</span>
                          </TD>
                          <TD className="max-w-64">
                            <span className="flex flex-wrap gap-1">
                              <Insignia tono={trabajo.tono}>{trabajo.etiqueta}</Insignia>
                              <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                            </span>
                            {o.descripcion && <span className="mt-1 line-clamp-2 text-xs text-texto-suave">{o.descripcion}</span>}
                          </TD>
                          <TD className="tabular hidden whitespace-nowrap sm:table-cell">
                            {o.acta ? (
                              <>
                                {fecha(o.acta.fecha_entrega)}
                                <span className="block text-[11px] text-texto-tenue">Acta {o.acta.numero}</span>
                              </>
                            ) : o.fecha_entrega_comprometida ? (
                              <span className="text-texto-suave">Prometida {fecha(o.fecha_entrega_comprometida)}</span>
                            ) : (
                              <span className="text-texto-tenue">—</span>
                            )}
                          </TD>
                          <TD className="tabular text-right whitespace-nowrap">{porcentaje(o.avance_porcentaje ?? 0, 0)}</TD>
                          {verCosto && (
                            <TD className="tabular whitespace-nowrap text-right">
                              {costo ? (
                                <>
                                  <span className={costo.pen > 0 ? 'text-texto' : 'text-texto-tenue'}>{moneda(costo.pen)}</span>
                                  {costo.margenPct !== null && (
                                    <span className={cn('block text-[11px]', costo.margenPct < 0 ? 'text-peligro' : 'text-texto-suave')}>
                                      Margen {porcentaje(costo.margenPct, 1)}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-texto-tenue" title="No se pudo calcular el costo de esta orden">
                                  —
                                </span>
                              )}
                            </TD>
                          )}
                        </TR>
                      )
                    })
                  )}
                </tbody>
              </Tabla>
            )}
          </Tarjeta>

          {historia.gemelas.length > 0 && (
            <Tarjeta>
              <TarjetaCabecera
                titulo="Otras fichas del mismo vehículo"
                descripcion="Tienen el mismo chasis, placa, código interno o FMI: el vehículo cambió de dueño o se registró dos veces."
              />
              <TarjetaCuerpo className="p-0">
                <ul className="divide-y divide-[var(--borde)]">
                  {historia.gemelas.map((g) => {
                    const dueno = g.cliente as unknown as { razon_social: string } | null
                    return (
                      <li key={g.id}>
                        <Link href={`/unidades/${g.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-superficie-2">
                          <span className="text-sm font-medium text-acento">{nombreDeUnidad(g)}</span>
                          <span className="text-xs text-texto-suave">
                            {dueno?.razon_social ?? (g.cliente_id ? 'Cliente reservado' : 'Del taller, sin cliente')}
                          </span>
                          {!g.activo && <Insignia tono="neutro">Desactivada</Insignia>}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </TarjetaCuerpo>
            </Tarjeta>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * La garantía vigente de la unidad: la del acta que vence más tarde. Sin acta,
 * la garantía todavía no empieza; con acta de cero meses, se entregó sin ella.
 */
function Garantia({ historia, hoy }: { historia: HistoriaDeUnidad; hoy: string }) {
  const actas = historia.ordenes.filter((o) => o.acta)
  const conVencimiento = actas
    .filter((o) => o.acta?.garantia_vence)
    .sort((a, b) => (b.acta!.garantia_vence! > a.acta!.garantia_vence! ? 1 : -1))
  const ultima = conVencimiento[0] ?? null

  let tono: Tono = 'neutro'
  let titulo = 'Sin acta de entrega'
  let detalle = 'La garantía empieza el día que se entrega la unidad con su acta.'
  if (ultima?.acta?.garantia_vence) {
    const restan = diasEntre(hoy, ultima.acta.garantia_vence)
    if (restan >= 0) {
      tono = 'exito'
      titulo = `En garantía hasta el ${fecha(ultima.acta.garantia_vence)}`
      detalle = `Quedan ${dias(restan)}. ${ultima.acta.garantia_meses} meses desde la entrega del ${fecha(ultima.acta.fecha_entrega)} (OT ${ultima.numero}).`
    } else {
      tono = 'aviso'
      titulo = `Garantía vencida el ${fecha(ultima.acta.garantia_vence)}`
      detalle = `Venció hace ${dias(-restan)}: un trabajo nuevo ya no es garantía de la OT ${ultima.numero}.`
    }
  } else if (actas.length > 0) {
    titulo = 'Entregada sin garantía'
    detalle = 'El acta de entrega se registró con cero meses de garantía.'
  }

  return (
    <section aria-label="Garantía" className="flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-base)] border border-borde bg-superficie p-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-texto">Garantía</h2>
        <p className="mt-1 text-sm text-texto-suave">{detalle}</p>
      </div>
      <Insignia tono={tono}>{titulo}</Insignia>
    </section>
  )
}

function Cifra({ etiqueta, valor, pie, tono }: { etiqueta: string; valor: string; pie: string; tono?: 'aviso' }) {
  return (
    <div className="rounded-[var(--radius-base)] border border-borde bg-superficie p-4">
      <p className="text-xs text-texto-suave">{etiqueta}</p>
      <p className={cn('tabular mt-1 text-lg font-semibold', tono === 'aviso' ? 'text-aviso' : 'text-texto')}>{valor}</p>
      <p className="text-xs text-texto-tenue">{pie}</p>
    </div>
  )
}

function Dato({ etiqueta, valor, enlace }: { etiqueta: string; valor?: string | number | null; enlace?: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-borde py-2 text-sm last:border-0">
      <span className="text-texto-suave">{etiqueta}</span>
      {enlace && valor ? (
        <Link href={enlace} className="text-right font-medium text-acento hover:underline">
          {valor}
        </Link>
      ) : (
        <span className="text-right font-medium text-texto">{valor || '—'}</span>
      )}
    </div>
  )
}
