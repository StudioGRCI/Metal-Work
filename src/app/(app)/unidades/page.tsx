import Link from 'next/link'
import { AccionesCatalogo } from '@/app/(app)/catalogos/acciones-catalogo'
import { NuevaUnidad } from '@/app/(app)/clientes/nueva-unidad'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { AccionesDeFila, SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { numero } from '@/lib/format'
import { palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { nombreDeUnidad, tipoDeVehiculo, todaviaSinPlaca } from '@/lib/dominio/unidades'
import { listarUnidades } from '@/lib/datos/comercial'
import { exigirPermiso, puede } from '@/lib/sesion'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Unidades' }

export default async function PaginaUnidades({ searchParams }: PageProps<'/unidades'>) {
  const perfil = await exigirPermiso(['clientes.ver', 'produccion.ver'])
  const params = await searchParams
  // Corrigen unidades Ventas y Diseño e Ingeniería (migración 20261001213000).
  const puedeEditar = puede(perfil, ['clientes.editar', 'diseno.unidades'])

  const busqueda = typeof params.q === 'string' && palabrasDeBusqueda(params.q).length > 0 ? params.q : undefined
  const incluirInactivas = params.estado === 'inactivas'
  // El otro listado, con el mismo término.
  const verOtras = new URLSearchParams({
    ...(typeof params.q === 'string' && params.q ? { q: params.q } : {}),
    ...(incluirInactivas ? {} : { estado: 'inactivas' }),
  }).toString()
  const unidades = await listarUnidades({ busqueda, incluirInactivas })

  return (
    <>
      <EncabezadoPagina
        titulo="Unidades"
        // Hasta 300 en la lista: pasado eso se dice «300 o más».
        descripcion={
          busqueda
            ? unidades.length === 0
              ? `Ninguna unidad con «${busqueda}»`
              : `${unidades.length === 1 ? '1 unidad' : `${unidades.length >= 300 ? '300 o más' : unidades.length} unidades`} con «${busqueda}»`
            : `${unidades.length >= 300 ? '300 o más' : unidades.length} ${unidades.length === 1 ? 'unidad' : 'unidades'}`
        }
        ayuda="Vehículos de los clientes sobre los que trabaja el taller. Se registran desde la ficha de cada cliente."
      />

      {/* 20 px entre el buscador y la lista (la escala de la skill diseno). */}
      <div className="space-y-5">
      <div className="space-y-3">
        <BuscadorSimple
          ruta="/unidades"
          etiqueta="Buscar unidades"
          marcador="Placa, código, marca, modelo o chasis"
        />
        <div className="flex justify-end">
          <Link
            href={`/unidades${verOtras ? `?${verOtras}` : ''}`}
            // Se lleva lo que se está escribiendo, como una pastilla.
            data-filtro=""
            className="inline-flex min-h-11 items-center text-sm text-acento hover:underline sm:min-h-0"
          >
            {incluirInactivas ? 'Ver solo activas' : 'Ver también desactivadas'}
          </Link>
        </div>
      </div>

      {/* En el teléfono cada unidad es una ficha con «Editar» y «Desactivar» en
          un renglón (entrega 5 del plan de orden y diseño): en la tabla apretada
          iban uno debajo del otro, también en el monitor. */}
      <Tarjeta className="overflow-hidden">
        <Tabla apilada>
          <TablaCabecera>
            <tr>
              {/* Se llamaba «Placa», pero la placa llega meses después de que
                  la unidad entra al taller: la columna nombra la unidad, con
                  la matrícula cuando la tiene. */}
              <TH>Unidad</TH>
              <TH className="hidden md:table-cell">Cliente</TH>
              <TH className="hidden md:table-cell">Vehículo</TH>
              {/* Las columnas de detalle esperan a que haya ancho (1280 px y el
                  chasis 1400): hasta ahí su contenido va bajo la unidad, en
                  letra chica. Se pierde la rejilla, no el dato. */}
              <TH className="hidden xl:table-cell">Tipo</TH>
              <TH className="hidden xl:table-cell">Carrocería</TH>
              <TH className="hidden text-right xl:table-cell">Capacidad</TH>
              <TH className="hidden min-[1400px]:table-cell">N.º de chasis</TH>
              {/* El ancho, para que «Editar» y «Desactivar» quepan en un renglón. */}
              {puedeEditar && <TH className="text-right md:w-56">Acciones</TH>}
            </tr>
          </TablaCabecera>
          <tbody>
            {unidades.length === 0 ? (
              <SinDatos
                colSpan={puedeEditar ? 8 : 7}
                titulo={busqueda ? 'Ninguna unidad coincide' : 'Aún no hay unidades'}
                descripcion={
                  busqueda
                    ? 'Prueba con menos palabras, con la placa completa, la marca o el chasis.'
                    : 'Cada unidad se registra desde la ficha de su cliente, con el botón «Agregar unidad».'
                }
                accion={
                  busqueda ? (
                    <EnlaceBoton href="/unidades" variante="contorno">
                      Ver todas las unidades
                    </EnlaceBoton>
                  ) : (
                    <EnlaceBoton href="/clientes" variante="contorno">
                      Ir a clientes
                    </EnlaceBoton>
                  )
                }
              />
            ) : (
              unidades.map((u) => {
                const cliente = u.cliente as unknown as { id: string; razon_social: string } | null
                const carroceria = u.tipo_carroceria as unknown as { nombre: string } | null

                const capacidad = [
                  u.capacidad_m3 ? `${numero(u.capacidad_m3, 1)} m³` : null,
                  u.capacidad_toneladas ? `${numero(u.capacidad_toneladas, 1)} t` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')

                // Lo que en el monitor son cuatro columnas, en el teléfono es esta
                // línea: sin ella el listado móvil solo diría placa y dueño.
                const detalle = [tipoDeVehiculo(u.tipo_vehiculo), carroceria?.nombre, capacidad]
                  .filter(Boolean)
                  .join(' · ')

                // El aviso de que falta la placa solo se agrega cuando el nombre
                // no lo dice ya por sí mismo: «Volvo FH, sin placa» no necesita
                // repetirlo debajo.
                const nombre = nombreDeUnidad(u)
                const avisarFalta = todaviaSinPlaca(u) && !nombre.includes('sin placa')

                return (
                  <TR key={u.id}>
                    <TD className="font-medium whitespace-nowrap">
                      {/* Aquí es donde se busca la unidad con la vista. Sin
                          placa se nombra con lo que la identifique —código
                          interno, chasis, marca— y se dice que le falta, para
                          que nadie lea eso como si fuera una matrícula. */}
                      <Link
                        href={`/unidades/${u.id}`}
                        className={cn('inline-flex min-h-11 items-center text-acento hover:underline sm:min-h-0', !todaviaSinPlaca(u) && 'tabular')}
                      >
                        {nombre}
                      </Link>
                      {/* Con los botones en `AccionesDeFila`, el estado va junto al nombre. */}
                      {!u.activo && <Insignia className="ml-2 font-normal">Inactiva</Insignia>}
                      {avisarFalta && (
                        <span className="block text-xs font-normal text-texto-tenue">
                          sin placa
                        </span>
                      )}
                      {/* En la ficha del teléfono el dueño y el vehículo van aquí;
                          el tipo, la carrocería, la capacidad y el chasis, hasta
                          que cabe su columna. Entre 640 y 1199 px no se veían. */}
                      <span className="block font-normal whitespace-normal">
                        <span className="line-clamp-2 text-xs text-texto-suave md:hidden">
                          {/* De 640 a 767 px antes era la columna, con su enlace a la ficha del cliente. */}
                          {cliente ? (
                            <>
                              <span className="sm:hidden">{cliente.razon_social}</span>
                              <Link href={`/clientes/${cliente.id}`} className="hidden text-acento hover:underline sm:inline">
                                {cliente.razon_social}
                              </Link>
                            </>
                          ) : u.cliente_id ? null : (
                            'Del taller'
                          )}
                        </span>
                        <span className="block text-xs text-texto md:hidden">{[u.marca, u.modelo, u.anio].filter(Boolean).join(' ')}</span>
                        {detalle && <span className="block text-xs text-texto-suave xl:hidden" data-detalle-unidad>{detalle}</span>}
                        {u.numero_chasis && <span className="block font-mono text-xs break-all text-texto-tenue min-[1400px]:hidden">chasis {u.numero_chasis}</span>}
                      </span>
                    </TD>
                    <TD className="hidden md:table-cell">
                      {cliente ? (
                        <Link
                          href={`/clientes/${cliente.id}`}
                          title={cliente.razon_social}
                          // En un enlace en línea el ancho máximo no corta nada
                          // y la razón social empujaba la tabla.
                          className="line-clamp-2 max-w-56 text-acento hover:underline"
                        >
                          {cliente.razon_social}
                        </Link>
                      ) : u.cliente_id ? (
                        <span className="text-texto-tenue">—</span>
                      ) : (
                        <span className="text-texto-suave">Del taller</span>
                      )}
                    </TD>
                    <TD className="hidden md:table-cell">{[u.marca, u.modelo, u.anio].filter(Boolean).join(' ') || '—'}</TD>
                    <TD className="hidden text-texto-suave xl:table-cell">{tipoDeVehiculo(u.tipo_vehiculo)}</TD>
                    <TD className="hidden text-texto-suave xl:table-cell">
                      {carroceria?.nombre ?? '—'}
                    </TD>
                    <TD className="tabular hidden text-right whitespace-nowrap xl:table-cell">
                      {capacidad || '—'}
                    </TD>
                    <TD className="hidden font-mono text-xs text-texto-suave min-[1400px]:table-cell">
                      {u.numero_chasis ?? '—'}
                    </TD>
                    {puedeEditar && (
                      <TD>
                        {/* Un renglón: «Editar» con borde y «Desactivar» al final, sin
                            borde (decisión 6). Caben porque el tipo, la carrocería
                            y la capacidad ya no piden columna hasta 1280 px. */}
                        <AccionesDeFila>
                          {/* Una unidad del taller todavía no tiene cliente: se edita
                              desde su orden, cuando Administración le pone uno. */}
                          {u.cliente_id && <NuevaUnidad clienteId={u.cliente_id} unidad={u} compacta />}
                          <AccionesCatalogo tipo="unidad" id={u.id} nombre={nombre} activo={u.activo} puedeEditar esAdmin={perfil.rol.codigo === 'ADMIN'} enFila />
                        </AccionesDeFila>
                      </TD>
                    )}
                  </TR>
                )
              })
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
      </div>
    </>
  )
}
