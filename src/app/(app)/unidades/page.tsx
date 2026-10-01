import Link from 'next/link'
import { AccionesCatalogo } from '@/app/(app)/catalogos/acciones-catalogo'
import { NuevaUnidad } from '@/app/(app)/clientes/nueva-unidad'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { numero } from '@/lib/format'
import { nombreDeUnidad, todaviaSinPlaca } from '@/lib/dominio/unidades'
import { listarUnidades } from '@/lib/datos/comercial'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Unidades' }

export default async function PaginaUnidades({ searchParams }: PageProps<'/unidades'>) {
  const perfil = await exigirPermiso(['clientes.ver', 'produccion.ver'])
  const params = await searchParams

  const busqueda = typeof params.q === 'string' ? params.q : undefined
  const incluirInactivas = params.estado === 'inactivas'
  const unidades = await listarUnidades({ busqueda, incluirInactivas })

  return (
    <>
      <EncabezadoPagina
        titulo="Unidades"
        descripcion="Vehículos de los clientes sobre los que trabaja el taller. Se registran desde la ficha de cada cliente."
      />

      <BuscadorSimple
        ruta="/unidades"
        etiqueta="Buscar unidades"
        marcador="Buscar por placa, código interno, FMI, marca, modelo o chasis"
      />
      <div className="mt-3 flex justify-end">
        <Link href={incluirInactivas ? '/unidades' : '/unidades?estado=inactivas'} className="text-sm text-acento hover:underline">
          {incluirInactivas ? 'Ver solo activas' : 'Ver también desactivadas'}
        </Link>
      </div>

      <Tarjeta className="mt-4 overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              {/* Se llamaba «Placa», pero la placa llega meses después de que
                  la unidad entra al taller: la columna nombra la unidad, con
                  la matrícula cuando la tiene. */}
              <TH>Unidad</TH>
              <TH>Cliente</TH>
              <TH>Vehículo</TH>
              {/* Siete columnas no entran en un teléfono. Las cuatro de detalle se
                  esconden aquí y su contenido baja a la celda del vehículo en letra
                  chica: se pierde la rejilla, no el dato. */}
              <TH className="hidden sm:table-cell">Tipo</TH>
              <TH className="hidden sm:table-cell">Carrocería</TH>
              <TH className="hidden text-right sm:table-cell">Capacidad</TH>
              <TH className="hidden sm:table-cell">N.º de chasis</TH>
              {puede(perfil, 'clientes.editar') && <TH>Acciones</TH>}
            </tr>
          </TablaCabecera>
          <tbody>
            {unidades.length === 0 ? (
              <SinDatos
                colSpan={puede(perfil, 'clientes.editar') ? 8 : 7}
                titulo={busqueda ? 'Ninguna unidad coincide' : 'Aún no hay unidades'}
                descripcion={
                  busqueda
                    ? `Nada con «${busqueda}». Prueba con la placa completa, la marca o el chasis.`
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
                const detalle = [u.tipo_vehiculo, carroceria?.nombre, capacidad]
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
                        className={todaviaSinPlaca(u) ? 'text-acento hover:underline' : 'tabular text-acento hover:underline'}
                      >
                        {nombre}
                      </Link>
                      {avisarFalta && (
                        <span className="block text-[11px] font-normal text-texto-tenue">
                          sin placa
                        </span>
                      )}
                    </TD>
                    <TD>
                      {cliente ? (
                        <Link
                          href={`/clientes/${cliente.id}`}
                          className="max-w-52 truncate text-acento hover:underline"
                        >
                          {cliente.razon_social}
                        </Link>
                      ) : u.cliente_id ? (
                        <span className="text-texto-tenue">—</span>
                      ) : (
                        <span className="text-texto-suave">Del taller</span>
                      )}
                    </TD>
                    <TD>
                      {[u.marca, u.modelo, u.anio].filter(Boolean).join(' ') || '—'}
                      {detalle && (
                        <span className="block text-[11px] text-texto-suave sm:hidden">
                          {detalle}
                        </span>
                      )}
                      {u.numero_chasis && (
                        <span className="block font-mono text-[10px] text-texto-tenue sm:hidden">
                          chasis {u.numero_chasis}
                        </span>
                      )}
                    </TD>
                    <TD className="hidden text-texto-suave sm:table-cell">{u.tipo_vehiculo}</TD>
                    <TD className="hidden text-texto-suave sm:table-cell">
                      {carroceria?.nombre ?? '—'}
                    </TD>
                    <TD className="tabular hidden text-right whitespace-nowrap sm:table-cell">
                      {capacidad || '—'}
                    </TD>
                    <TD className="hidden font-mono text-xs text-texto-suave sm:table-cell">
                      {u.numero_chasis ?? '—'}
                    </TD>
                    {puede(perfil, 'clientes.editar') && (
                      <TD>
                        <div className="space-y-2">
                          {/* Una unidad del taller todavía no tiene cliente: se edita
                              desde su orden, cuando Administración le pone uno. */}
                          {u.cliente_id && <NuevaUnidad clienteId={u.cliente_id} unidad={u} compacta />}
                          <AccionesCatalogo tipo="unidad" id={u.id} nombre={nombre} activo={u.activo} puedeEditar esAdmin={perfil.rol.codigo === 'ADMIN'} />
                        </div>
                      </TD>
                    )}
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
