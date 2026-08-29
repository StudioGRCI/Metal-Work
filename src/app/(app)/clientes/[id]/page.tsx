import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { Pencil, Plus } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { nombreDeUnidad, todaviaSinPlaca } from '@/lib/dominio/unidades'
import { fecha } from '@/lib/format'
import type { UnidadNombrable } from '@/lib/dominio/unidades'
import {
  contactosDeCliente,
  listarUnidades,
  obtenerCliente,
  ordenesDeCliente,
} from '@/lib/datos/comercial'
import { catalogosOrden } from '@/lib/datos/ordenes'
import { exigirPermiso, puede } from '@/lib/sesion'

import { NuevaUnidad } from '../nueva-unidad'

export async function generateMetadata({ params }: PageProps<'/clientes/[id]'>): Promise<Metadata> {
  const { id } = await params
  const cliente = await obtenerCliente(id)
  return { title: cliente?.razon_social ?? 'Cliente no encontrado' }
}

export default async function PaginaCliente({ params }: PageProps<'/clientes/[id]'>) {
  const perfil = await exigirPermiso('clientes.ver')
  const { id } = await params

  const cliente = await obtenerCliente(id)
  if (!cliente) notFound()

  const [unidades, contactos, ordenes, catalogos] = await Promise.all([
    listarUnidades({ clienteId: id }),
    contactosDeCliente(id),
    ordenesDeCliente(id),
    puede(perfil, 'clientes.crear') ? catalogosOrden() : Promise.resolve(null),
  ])

  const vendedor = cliente.vendedor as unknown as { nombres: string; apellidos: string } | null

  // El estado vacío de las órdenes solo ofrece abrir una a quien puede abrirla.
  const abreOrdenes = puede(perfil, 'ordenes.crear')

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Clientes', ruta: '/clientes' }, { titulo: cliente.razon_social }]}
        titulo={cliente.razon_social}
        descripcion={`${cliente.tipo_documento} ${cliente.numero_documento}${
          cliente.nombre_comercial ? ` · ${cliente.nombre_comercial}` : ''
        }`}
        acciones={
          puede(perfil, 'clientes.editar') && (
            <EnlaceBoton href={`/clientes/${id}/editar`} variante="contorno">
              <Pencil aria-hidden className="size-4" />
              Editar
            </EnlaceBoton>
          )
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
              valor={vendedor ? `${vendedor.nombres} ${vendedor.apellidos}` : null}
            />
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta className="lg:col-span-2">
          <TarjetaCabecera
            titulo="Unidades"
            descripcion={`${unidades.length} ${unidades.length === 1 ? 'vehículo' : 'vehículos'} registrados`}
            acciones={
              catalogos && (
                <NuevaUnidad clienteId={id} tiposCarroceria={catalogos.tiposCarroceria} />
              )
            }
          />
          <TarjetaCuerpo className="p-0">
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
                {catalogos && (
                  <div className="mt-4 flex justify-center">
                    <NuevaUnidad clienteId={id} tiposCarroceria={catalogos.tiposCarroceria} />
                  </div>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-[var(--borde)]">
                {unidades.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <NombreUnidad unidad={u} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-texto">
                        {[u.marca, u.modelo, u.anio].filter(Boolean).join(' ') || 'Sin datos'}
                      </p>
                      <p className="text-[11px] text-texto-suave">
                        {u.tipo_vehiculo}
                        {u.numero_chasis ? ` · chasis ${u.numero_chasis}` : ''}
                        {u.capacidad_m3 ? ` · ${u.capacidad_m3} m³` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        {contactos.length > 0 && (
          <Tarjeta>
            <TarjetaCabecera titulo="Contactos" />
            <TarjetaCuerpo className="space-y-3">
              {contactos.map((c) => (
                <div key={c.id}>
                  <p className="flex items-center gap-2 text-sm font-medium text-texto">
                    {c.nombre}
                    {c.es_principal && <Insignia tono="acento">principal</Insignia>}
                  </p>
                  <p className="text-xs text-texto-suave">
                    {[c.cargo, c.telefono, c.correo].filter(Boolean).join(' · ')}
                  </p>
                </div>
              ))}
            </TarjetaCuerpo>
          </Tarjeta>
        )}

        <Tarjeta className={contactos.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <TarjetaCabecera
            titulo="Órdenes de trabajo"
            descripcion={`${ordenes.length} órdenes de este cliente`}
          />
          <TarjetaCuerpo className="p-0">
            {ordenes.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-texto-suave">
                  Todavía no se ha abierto ninguna orden para este cliente.
                </p>
                {abreOrdenes && (
                  <div className="mt-4 flex justify-center">
                    <EnlaceBoton href="/ordenes/nueva" variante="contorno">
                      <Plus aria-hidden className="size-4" />
                      Nueva orden de trabajo
                    </EnlaceBoton>
                  </div>
                )}
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
                          <p className="text-[11px] text-texto-suave">
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
        <span className="ml-1 text-[11px] font-normal text-texto-tenue">sin placa</span>
      )}
    </span>
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
