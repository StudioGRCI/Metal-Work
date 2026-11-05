import { FileText, MapPin, Scale } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarRecojos, type CompraParaRecojo } from '@/lib/datos/logistica'
import { RECOJO_COMPRA } from '@/lib/dominio/logistica'
import { cantidad, fecha, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { MoverEnLista, ProgramarRecojo, QuitarDeLaLista } from './controles'

export const metadata = { title: 'Gestión de compras' }

type Quien = { programa: boolean }

/**
 * Las compras que recoge el conductor, en tres tiempos: las aprobadas que
 * Logística todavía no programa, la lista del conductor en su orden y las que
 * ya salió a recoger. Logística pone el peso y el lugar; Contabilidad, con ese
 * peso, carga la guía de remisión desde Adquisiciones; el conductor ve las dos
 * cosas en «Recojos» (migración 20261015140000).
 *
 * Desde la migración 20261020171000 la gestión es de Logística
 * (`compras.programar_recojo`) y del conductor (`compras.recojo`, que la ve sin
 * programar nada): ni Contabilidad ni quien solo emite compras la abren.
 */
export default async function PaginaGestionCompras() {
  const perfil = await exigirPermiso(['compras.programar_recojo', 'compras.recojo'])
  const quien: Quien = { programa: puede(perfil, 'compras.programar_recojo') }
  const compras = await cargarRecojos()
  const porProgramar = compras.filter((c) => c.recojo === 'POR_RECOGER' && !c.en_lista)
  const enLista = compras.filter((c) => c.recojo === 'POR_RECOGER' && c.en_lista).sort((a, b) => (a.lugar ?? 0) - (b.lugar ?? 0))
  const enCamino = compras.filter((c) => c.recojo === 'EN_RECOJO' || c.recojo === 'RECOGIDO')
  const dejadas = compras.filter((c) => c.recojo === 'DEJADO')
  const sinGuia = [...enLista, ...enCamino].filter((c) => !c.guia).length

  return (
    <>
      <EncabezadoPagina
        titulo="Gestión de compras"
        migas={[{ titulo: 'Logística' }, { titulo: 'Gestión de compras' }]}
        ayuda={
          quien.programa
            ? 'Decide qué órdenes de compra recoge el conductor y en qué orden, con el peso de cada una. Con ese peso Contabilidad emite la guía de remisión y la carga en Adquisiciones, y el conductor la ve en su lista antes de salir.'
            : 'Las órdenes de compra que recoges, en el orden que fijó Logística y con su peso. Para salir y marcar cada paso, usa tu lista de Recojos.'
        }
      />

      <p className="mb-4 text-sm text-texto-suave">
        <span className="tabular font-semibold text-texto">{enLista.length}</span> en la lista del conductor ·{' '}
        <span className="tabular font-semibold text-texto">{enCamino.length}</span> en camino ·{' '}
        <span className={sinGuia > 0 ? 'tabular font-semibold text-aviso' : 'tabular font-semibold text-texto'}>{sinGuia}</span> sin guía de
        remisión · <span className="tabular font-semibold text-texto">{porProgramar.length}</span> por programar
      </p>

      <div className="space-y-8">
        <section className="space-y-3" aria-labelledby="titulo-por-programar">
          <h2 id="titulo-por-programar" className="text-base font-semibold text-texto">
            Por programar <span className="tabular text-texto-suave">({porProgramar.length})</span>
          </h2>
          {porProgramar.length === 0 ? (
            <Tarjeta>
              <SinDatos
                enTabla={false}
                titulo="Nada por programar"
                descripcion="Cuando Gerencia apruebe una orden de compra que va con el conductor, aparece aquí para ponerle su peso y su lugar en la lista."
              />
            </Tarjeta>
          ) : (
            porProgramar.map((c) => <TarjetaGestion key={c.id} compra={c} quien={quien} cuantas={enLista.length + 1} />)
          )}
        </section>

        <section className="space-y-3" aria-labelledby="titulo-lista">
          <h2 id="titulo-lista" className="text-base font-semibold text-texto">
            Lista del conductor <span className="tabular text-texto-suave">({enLista.length})</span>
          </h2>
          <p className="text-sm text-texto-suave">En este orden las recoge. Sale a recoger solo las que están aquí.</p>
          {enLista.length === 0 ? (
            <Tarjeta>
              <SinDatos
                enTabla={false}
                titulo="El conductor no tiene nada programado"
                descripcion={
                  quien.programa
                    ? 'Ponle su peso a una orden de «Por programar» y elige su lugar: le llega el aviso al conductor y a Contabilidad.'
                    : 'Cuando Logística programe una orden con su peso, aparece aquí en su lugar.'
                }
              />
            </Tarjeta>
          ) : (
            enLista.map((c) => <TarjetaGestion key={c.id} compra={c} quien={quien} cuantas={enLista.length} />)
          )}
        </section>

        {enCamino.length > 0 && (
          <section className="space-y-3" aria-labelledby="titulo-en-camino">
            <h2 id="titulo-en-camino" className="text-base font-semibold text-texto">
              En camino <span className="tabular text-texto-suave">({enCamino.length})</span>
            </h2>
            {enCamino.map((c) => (
              <TarjetaGestion key={c.id} compra={c} quien={quien} cuantas={0} />
            ))}
          </section>
        )}

        {dejadas.length > 0 && (
          <section className="space-y-3" aria-labelledby="titulo-dejadas">
            <h2 id="titulo-dejadas" className="text-base font-semibold text-texto">
              Dejadas en almacén esta semana <span className="tabular text-texto-suave">({dejadas.length})</span>
            </h2>
            {dejadas.map((c) => (
              <TarjetaGestion key={c.id} compra={c} quien={quien} cuantas={0} />
            ))}
          </section>
        )}
      </div>
    </>
  )
}

function TarjetaGestion({ compra: c, quien, cuantas }: { compra: CompraParaRecojo; quien: Quien; cuantas: number }) {
  const estado = RECOJO_COMPRA[c.recojo]
  const pendiente = c.recojo === 'POR_RECOGER'
  // La OC de antes de la serie no tiene número: «OC sin número», y su referencia abajo.
  const titulo = `${c.lugar ? `${c.lugar}.º · ` : ''}${c.numero ?? 'OC sin número'} · ${c.proveedor}`
  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo={titulo}
        descripcion={[
          c.numero ? null : `Ref. del proveedor: ${c.referencia}`,
          c.proveedor_documento ? `RUC ${c.proveedor_documento}` : null,
          c.codigo_interno ? `Para ${c.codigo_interno}` : c.codigos.length ? `Para ${c.codigos.join(', ')}` : null,
          c.requerimientos.length ? c.requerimientos.join(', ') : c.ordenes.length ? 'Solicitud de antes de los RQ' : null,
          c.pedido_en ? `Aprobada ${fecha(c.pedido_en)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        acciones={
          <>
            {estado && <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>}
            {c.recojo !== 'DEJADO' &&
              (c.guia ? <Insignia tono="exito">Con guía</Insignia> : c.peso_kg !== null ? <Insignia tono="aviso">Sin guía</Insignia> : null)}
          </>
        }
      />
      <TarjetaCuerpo className="space-y-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ul className="space-y-1.5 text-sm text-texto">
            <li className="flex items-start gap-2">
              <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-texto-suave" />
              <span>
                <span className="text-texto-suave">Recoge en </span>
                {c.proveedor_direccion ?? <span className="text-aviso">el proveedor no tiene dirección en el padrón</span>}
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Scale aria-hidden className="size-4 shrink-0 text-texto-suave" />
              {c.peso_kg !== null ? (
                <span>
                  <span className="text-texto-suave">Peso </span>
                  <span className="tabular font-semibold">{cantidad(c.peso_kg)} kg</span>
                  {!c.en_lista && pendiente && <span className="text-texto-suave"> (fuera de la lista)</span>}
                </span>
              ) : (
                <span className="text-texto-suave">Sin peso todavía: lo pone Logística al programarla.</span>
              )}
            </li>
            <li className="flex items-start gap-2">
              <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-texto-suave" />
              {c.guia ? (
                <span>
                  <Link className="font-medium text-acento hover:underline" href={`/compras/guia/${c.guia.id}`} target="_blank" prefetch={false}>
                    Guía de remisión {c.guia.numero}
                  </Link>
                  <span className="text-texto-suave"> · emitida {fecha(c.guia.fecha)}, cargada {fechaHora(c.guia.cargada_en)}</span>
                </span>
              ) : (
                <span className="text-texto-suave">
                  {c.peso_kg === null ? 'Sin guía de remisión: se emite cuando Logística ponga el peso.' : 'Sin guía de remisión todavía.'}
                </span>
              )}
              {c.guias_anuladas > 0 && (
                <span className="text-xs text-texto-tenue">
                  ({c.guias_anuladas} {c.guias_anuladas === 1 ? 'anulada' : 'anuladas'})
                </span>
              )}
            </li>
          </ul>

          <ul className="divide-y divide-borde rounded-md border border-borde text-sm">
            {c.lineas.length === 0 ? (
              <li className="px-3 py-2 text-texto-suave">Sin líneas.</li>
            ) : (
              c.lineas.map((l, i) => (
                <li key={`${l.material_codigo}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate text-texto">{l.material ?? 'Material sin nombre'}</span>
                  <span className="tabular shrink-0 font-medium text-texto">
                    {cantidad(l.cantidad)} {l.unidad}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>

        {quien.programa && pendiente && (
          <div className="space-y-3 border-t border-borde pt-3">
            <ProgramarRecojo id={c.id} peso={c.peso_kg} lugar={c.en_lista ? c.lugar : null} cuantas={cuantas} pesoFijo={c.guia !== null} />
            {c.en_lista && c.lugar !== null && c.peso_kg !== null && (
              <div className="flex flex-wrap items-center gap-2">
                <MoverEnLista id={c.id} peso={c.peso_kg} lugar={c.lugar} cuantas={cuantas} nombre={c.nombre} />
                <QuitarDeLaLista id={c.id} nombre={c.nombre} />
              </div>
            )}
          </div>
        )}

        {(c.en_recojo_en || c.recogido_en || c.dejado_en) && (
          <p className="text-xs text-texto-suave">
            {[
              c.en_recojo_en && `salió a recogerla ${fechaHora(c.en_recojo_en)}`,
              c.recogido_en && `recogida ${fechaHora(c.recogido_en)}`,
              c.dejado_en && `dejada en almacén ${fechaHora(c.dejado_en)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
