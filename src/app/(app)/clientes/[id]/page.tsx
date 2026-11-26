import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { Pencil } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos } from '@/components/ui/tabla'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_COTIZACION, ESTADO_DE_LA_UNIDAD, ESTADO_OT, definir } from '@/lib/dominio/estados'
import { nombreDeUnidad, tipoDeVehiculo, todaviaSinPlaca } from '@/lib/dominio/unidades'
import { fecha, puesto } from '@/lib/format'
import type { UnidadNombrable } from '@/lib/dominio/unidades'
import type { EntregaDeUnidad } from '@/lib/datos/comercial'
import {
  contactosDeCliente,
  cotizacionesDelCliente,
  entregasDeUnidadesDelCliente,
  listarUnidades,
  obtenerCliente,
  ordenesDeCliente,
} from '@/lib/datos/comercial'
import { recorridoDeCotizaciones } from '@/lib/datos/recorrido'
import { exigirPermiso, puede } from '@/lib/sesion'
import { NuevoContacto } from '@/components/comercial/nuevo-contacto'
import { AccionesCatalogo } from '@/app/(app)/catalogos/acciones-catalogo'

import { NuevaUnidad } from '../nueva-unidad'
import { esUuid } from '@/lib/utils'

export async function generateMetadata({ params }: PageProps<'/clientes/[id]'>): Promise<Metadata> {
  const { id } = await params
  if (!esUuid(id)) notFound()
  const cliente = await obtenerCliente(id)
  return { title: cliente?.razon_social ?? 'Cliente no encontrado' }
}

export default async function PaginaCliente({ params }: PageProps<'/clientes/[id]'>) {
  const perfil = await exigirPermiso('clientes.ver')
  const { id } = await params
  if (!esUuid(id)) notFound()

  const cliente = await obtenerCliente(id)
  if (!cliente) notFound()

  // Las cotizaciones del cliente, para quien ve Cotización (Ventas, Gerencia,
  // Administración): cómo va cada una sin abrir esa pantalla (Plan 9.2).
  const veCotizaciones = puede(perfil, 'cotizaciones.ver_pdf_comercial')

  // Quién tiene cada cotización y hace cuántos días: el paso que espera de su
  // recorrido. Se pide apenas llegan las cotizaciones, sin esperar al resto.
  // Si no se pueden leer, la ficha sigue con lo que ya tenía y lo dice en la tarjeta.
  const cotizacionesConRecorrido = async () => {
    const delCliente = await cotizacionesDelCliente(id).catch((e: unknown) => {
      console.error('Ficha del cliente: no se pudieron leer sus cotizaciones.', e)
      return null
    })
    if (!delCliente) return { delCliente: null, recorridos: null, fallo: true }
    const ids = delCliente.cotizaciones.flatMap((c) => (c.id ? [c.id] : []))
    const recorridos = ids.length === 0 ? null : await recorridoDeCotizaciones(ids).catch((e: unknown) => {
      console.error('Ficha del cliente: no se pudo leer el recorrido de sus cotizaciones.', e)
      return null
    })
    return { delCliente, recorridos, fallo: false }
  }
  const [unidades, contactos, { ordenes, total: totalOrdenes }, entregas, cotizaciones] = await Promise.all([
    listarUnidades({ clienteId: id }),
    contactosDeCliente(id),
    ordenesDeCliente(id),
    // Cómo va cada unidad y para cuándo se prometió. Sin ella, la ficha sigue con todo lo demás y lo dice.
    entregasDeUnidadesDelCliente(id).catch((e: unknown) => {
      console.error('Ficha del cliente: no se pudo leer cómo va cada unidad.', e)
      return null
    }),
    veCotizaciones ? cotizacionesConRecorrido() : Promise.resolve(null),
  ])
  const delCliente = cotizaciones?.delCliente ?? null
  const recorridos = cotizaciones?.recorridos ?? null

  const vendedor = cliente.vendedor as unknown as { puesto: string | null } | null

  // Antes se traían cuatro catálogos (clientes, sedes, carrocerías, usuarios)
  // solo para usarlos como «sí/no» de este botón. El permiso basta.
  const registraUnidades = puede(perfil, 'clientes.crear')
  // La persona del cliente se da de alta desde acá: antes solo desde la
  // cotización nueva, y la ficha ni siquiera mostraba la tarjeta sin contactos.
  const registraContactos = puede(perfil, ['clientes.crear', 'clientes.editar'])

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Clientes', ruta: '/clientes' }, { titulo: cliente.razon_social }]}
        titulo={cliente.razon_social}
        descripcion={`${cliente.tipo_documento} ${cliente.numero_documento}${
          cliente.nombre_comercial ? ` · ${cliente.nombre_comercial}` : ''
        }`}
        acciones={
          <div className="flex flex-wrap items-center gap-2">
            {puede(perfil, 'clientes.editar') && (
              <EnlaceBoton href={`/clientes/${id}/editar`} variante="contorno">
                <Pencil aria-hidden className="size-4" />
                Editar
              </EnlaceBoton>
            )}
            <AccionesCatalogo tipo="cliente" id={id} nombre={cliente.razon_social} activo={cliente.activo} puedeEditar={puede(perfil, 'clientes.editar')} esAdmin={perfil.rol.codigo === 'ADMIN'} />
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Tarjeta>
          <TarjetaCabecera titulo="Datos" />
          <TarjetaCuerpo className="space-y-0">
            <Dato etiqueta="Dirección" valor={cliente.direccion_fiscal} />
            <Dato
              etiqueta="Ubicación"
              valor={[cliente.distrito, cliente.provincia, cliente.departamento]
                .filter(Boolean)
                .join(', ')}
            />
            <Dato etiqueta="Teléfono" valor={cliente.telefono} />
            <Dato etiqueta="Correo" valor={cliente.correo} />
            <Dato
              etiqueta="Condición de pago"
              valor={
                cliente.condicion_pago_dias === 0
                  ? 'Contado'
                  : `${cliente.condicion_pago_dias} días`
              }
            />
            <Dato
              etiqueta="Vendedor"
              valor={vendedor ? puesto(vendedor) : null}
            />
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta className="lg:col-span-2">
          <TarjetaCabecera
            titulo="Unidades"
            ayuda={AYUDA_DE_UNIDADES}
            descripcion={`${unidades.length} ${unidades.length === 1 ? 'vehículo registrado' : 'vehículos registrados'}`}
            acciones={registraUnidades && <NuevaUnidad clienteId={id} />}
          />
          <TarjetaCuerpo className="p-0">
            {entregas === null && unidades.length > 0 && (
              <p role="status" className="border-b border-borde px-4 py-2 text-xs text-aviso">
                No se pudo leer en qué va cada unidad. Recarga la página; si continúa, avisa al administrador.
              </p>
            )}
            {unidades.length === 0 ? (
              // El estado vacío trae el mismo botón de la cabecera: en el teléfono
              // la cabecera de la tarjeta queda arriba, fuera del pulgar, y sin
              // esto no hay nada que tocar donde se está mirando.
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-texto-suave">
                  Este cliente aún no tiene unidades registradas.
                </p>
                <p className="mt-1 text-xs text-texto-tenue">
                  Sin unidad no se le puede abrir una orden de trabajo.
                </p>
                {registraUnidades && (
                  <div className="mt-4 flex justify-center">
                    <NuevaUnidad clienteId={id} />
                  </div>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-[var(--borde)]">
                {unidades.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <NombreUnidad unidad={u} />
                    {/* Con ancho propio: en el teléfono los botones bajan a otro renglón y la
                        fecha comprometida no se parte palabra por palabra. */}
                    <div className="min-w-48 flex-1">
                      <p className="text-sm text-texto">
                        {[u.marca, u.modelo, u.anio].filter(Boolean).join(' ') || 'Sin datos'}
                      </p>
                      <p className="text-xs text-texto-suave">
                        {tipoDeVehiculo(u.tipo_vehiculo)}
                        {u.numero_chasis ? ` · chasis ${u.numero_chasis}` : ''}
                        {u.capacidad_m3 ? ` · ${u.capacidad_m3} m³` : ''}
                      </p>
                      <EntregaDeLaUnidad entrega={entregas?.get(u.id)} />
                    </div>
                    {puede(perfil, 'clientes.editar') && (
                      <div className="flex flex-wrap gap-2">
                        <NuevaUnidad clienteId={id} unidad={u} compacta />
                        <AccionesCatalogo tipo="unidad" id={u.id} nombre={nombreDeUnidad(u)} activo={u.activo} puedeEditar esAdmin={perfil.rol.codigo === 'ADMIN'} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        {cotizaciones?.fallo && (
          <Tarjeta className="lg:col-span-3">
            <TarjetaCabecera titulo="Cotizaciones" />
            <TarjetaCuerpo>
              <p role="status" className="text-sm text-aviso">
                No se pudieron leer las cotizaciones de este cliente. Recarga la página; si continúa, avisa al administrador.
              </p>
            </TarjetaCuerpo>
          </Tarjeta>
        )}
        {delCliente && (
          <Tarjeta className="lg:col-span-3">
            <TarjetaCabecera
              titulo="Cotizaciones"
              ayuda="Cómo va cada cotización de este cliente: quién la tiene ahora y desde hace cuántos días. Ábrela para ver su recorrido completo."
              descripcion={[
                delCliente.total > delCliente.cotizaciones.length
                  ? `Las ${delCliente.cotizaciones.length} más recientes de ${delCliente.total} vigentes`
                  : `${delCliente.total} ${delCliente.total === 1 ? 'vigente' : 'vigentes'}`,
                delCliente.anuladas > 0
                  ? `y ${delCliente.anuladas} ${delCliente.anuladas === 1 ? 'anulada' : 'anuladas'}, en Cotización`
                  : null,
              ].filter(Boolean).join(' ')}
              acciones={
                // Cotización busca por la razón social entre sus 200 más recientes, también las anuladas.
                <EnlaceBoton href={`/cotizaciones/pdf?q=${encodeURIComponent(cliente.razon_social)}`} variante="contorno">
                  Buscar en Cotización
                </EnlaceBoton>
              }
            />
            <TarjetaCuerpo className="p-0">
              {delCliente.cotizaciones.length === 0 ? (
                <div className="px-4 py-4">
                  <SinDatos
                    compacto
                    titulo={delCliente.anuladas > 0 ? 'Este cliente no tiene cotizaciones vigentes.' : 'Este cliente todavía no tiene cotizaciones.'}
                    descripcion={delCliente.anuladas > 0 ? 'Sus anuladas están en Cotización, con el filtro «Anuladas».' : 'Se suben en Cotización, con «Subir cotización».'}
                  />
                </div>
              ) : (
                <>
                  {recorridos === null && (
                    <p role="status" className="border-b border-borde px-4 py-2 text-xs text-aviso">
                      No se pudo leer quién tiene cada cotización. Recarga la página; si continúa, avisa al administrador.
                    </p>
                  )}
                  <ul className="divide-y divide-[var(--borde)]" data-cotizaciones-del-cliente>
                    {delCliente.cotizaciones.map((c) => {
                      const estado = definir(ESTADO_COTIZACION, c.estado)
                      const ahora = (c.id && recorridos?.get(c.id)?.find((p) => p.situacion === 'AHORA')) || null
                      // La tarjeta de esa cotización; `IrALaTarjetaDelAviso` la trae a la vista y la marca.
                      const enlace = `/cotizaciones/pdf#${c.id}`
                      return (
                        <li key={c.id}>
                          <Link href={enlace} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-superficie-2">
                            <span className="text-sm font-medium text-acento">{c.numero}</span>
                            <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                            <div className="min-w-40 flex-1">
                              <p className="truncate text-sm text-texto">
                                {c.carroceria ?? 'Sin carrocería'}
                                {(c.cantidad_unidades ?? 1) > 1 ? (
                                  // Una OT por unidad (migración 20261126700000): cada código está en su tarjeta.
                                  <span className="text-texto-suave">
                                    {' '}· {c.cantidad_unidades} unidades · {c.ordenes_vigentes ?? 0} con su OT
                                  </span>
                                ) : (
                                  <>
                                    {c.codigo_interno ? <span className="text-texto-suave"> · {c.codigo_interno}</span> : null}
                                    {c.orden_numero ? <span className="text-texto-suave"> · OT {c.orden_numero}</span> : null}
                                  </>
                                )}
                              </p>
                              <p className="text-xs text-texto-suave">Subida el {fecha(c.creado_en)}</p>
                            </div>
                            {ahora && (
                              <span data-cotizacion-ahora>
                                <DiasEnEspera dias={ahora.dias} desde={ahora.en} quien={ahora.puesto ?? 'alguien'} verQuien />
                              </span>
                            )}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </TarjetaCuerpo>
          </Tarjeta>
        )}

        <Tarjeta>
          <TarjetaCabecera
            titulo="Contactos"
            ayuda="A quién se le dirige la cotización: su nombre, teléfono y correo salen en el papel."
            acciones={registraContactos && <NuevoContacto clienteId={id} refrescar />}
          />
          <TarjetaCuerpo className="space-y-3">
            {contactos.length === 0 ? (
              <p className="py-2 text-sm text-texto-suave">
                Todavía no hay contactos.
                {registraContactos && ' Agrega a quien recibe la cotización, para que el papel salga con su nombre.'}
              </p>
            ) : (
              contactos.map((c) => (
                <div key={c.id}>
                  <p className="flex items-center gap-2 text-sm font-medium text-texto">
                    {c.nombre}
                    {c.es_principal && <Insignia tono="acento">principal</Insignia>}
                  </p>
                  <p className="text-xs text-texto-suave">
                    {[c.cargo, c.telefono, c.correo].filter(Boolean).join(' · ')}
                  </p>
                </div>
              ))
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta className="lg:col-span-2">
          <TarjetaCabecera
            titulo="Órdenes de trabajo"
            descripcion={
              totalOrdenes > ordenes.length
                ? `Las ${ordenes.length} más recientes de ${totalOrdenes} órdenes de este cliente`
                : `${totalOrdenes} ${totalOrdenes === 1 ? 'orden' : 'órdenes'} de este cliente`
            }
          />
          <TarjetaCuerpo className="p-0">
            {ordenes.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-texto-suave">
                  Todavía no se ha abierto ninguna orden para este cliente. La OT llega cuando Gerencia aprueba su cotización con el código interno.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--borde)]">
                {ordenes.map((o) => {
                  const estado = definir(ESTADO_OT, o.estado)
                  return (
                    <li key={o.id}>
                      <Link
                        href={`/ordenes/${o.id}`}
                        className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-superficie-2"
                      >
                        <span className="text-sm font-medium text-acento">{o.numero}</span>
                        <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                        <div className="min-w-40 flex-1">
                          <p className="truncate text-sm text-texto">{o.descripcion}</p>
                          <p className="text-xs text-texto-suave">
                            {nombreDeUnidad({ placa: o.placa })} · {fecha(o.fecha_registro)}
                          </p>
                        </div>
                        <div className="w-28">
                          <Progreso valor={o.avance_porcentaje} alto="sm" mostrarValor />
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </TarjetaCuerpo>
        </Tarjeta>
      </div>
    </>
  )
}

/**
 * Qué quiere decir cada palabra del estado de la unidad, y por qué puede no ser
 * la del estado de la OT en «Órdenes de trabajo»: la unidad mira también el
 * avance de su código interno (la OT de una cotización se queda «Aprobada»
 * mientras el taller avanza) y el acta de entrega.
 */
const AYUDA_DE_UNIDADES = (
  // Va dentro del párrafo de la «i»: solo piezas en línea, cada una en su renglón.
  <>
    <span className="block">De cada unidad con OT: en qué va, en una palabra, y la fecha de entrega que se le prometió al cliente.</span>
    {Object.values(ESTADO_DE_LA_UNIDAD).map((e) => (
      <span key={e.etiqueta} className="mt-1 block">
        <span className="font-medium">{e.etiqueta}.</span> {e.descripcion}.
      </span>
    ))}
    <span className="mt-2 block">
      Puede no coincidir con el estado de la OT en «Órdenes de trabajo»: aquí cuenta también el avance del taller en
      su código interno, el acta de entrega y la salida que anotó Portería.
    </span>
  </>
)

/**
 * El recuadro donde se busca la matrícula con la vista. Mientras la placa no
 * llega —y en esta empresa llega meses después—, la unidad se nombra con lo que
 * la identifique y se dice que le falta, para que nadie lea un código interno
 * como si fuera una matrícula. El aviso se calla cuando el nombre ya lo trae.
 */
function NombreUnidad({ unidad }: { unidad: UnidadNombrable }) {
  const nombre = nombreDeUnidad(unidad)
  const falta = todaviaSinPlaca(unidad)

  return (
    <span
      className={`rounded-[var(--radius-base)] bg-superficie-2 px-2 py-1 text-sm font-medium ${
        falta ? 'text-texto-suave' : 'tabular'
      }`}
    >
      {nombre}
      {falta && !nombre.includes('sin placa') && (
        <span className="ml-1 text-xs font-normal text-texto-tenue">sin placa</span>
      )}
    </span>
  )
}

/**
 * En qué va la unidad, en una palabra, su OT y la fecha de entrega que se le
 * prometió al cliente (Plan 9.2). La unidad sin OT vigente no lleva nada.
 */
function EntregaDeLaUnidad({ entrega }: { entrega: EntregaDeUnidad | undefined }) {
  if (!entrega) return null
  const estado = definir(ESTADO_DE_LA_UNIDAD, entrega.estado)
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-texto-suave" data-entrega-unidad>
      <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
      {entrega.ot && <span className="tabular">OT {entrega.ot}</span>}
      {entrega.fecha ? (
        <span>
          {entrega.estado === 'ENTREGADA' ? 'Se prometió para el ' : 'Entrega comprometida: '}
          <span className="tabular font-medium text-texto">{fecha(entrega.fecha)}</span>
        </span>
      ) : (
        <span>Sin fecha prometida</span>
      )}
    </p>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor?: string | number | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-borde py-2 text-sm last:border-0">
      <span className="text-texto-suave">{etiqueta}</span>
      <span className="text-right font-medium text-texto">{valor || '—'}</span>
    </div>
  )
}
