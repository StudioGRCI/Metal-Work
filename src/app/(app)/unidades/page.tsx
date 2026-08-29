import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { numero } from '@/lib/format'
import { nombreDeUnidad, todaviaSinPlaca } from '@/lib/dominio/unidades'
import { listarUnidades } from '@/lib/datos/comercial'
import { exigirPermiso } from '@/lib/sesion'

export const metadata = { title: 'Unidades' }

export default async function PaginaUnidades({ searchParams }: PageProps<'/unidades'>) {
  await exigirPermiso('clientes.ver')
  const params = await searchParams

  const busqueda = typeof params.q === 'string' ? params.q : undefined
  const unidades = await listarUnidades({ busqueda })

  return (
    <>
      <EncabezadoPagina
        titulo="Unidades"
        descripcion="Vehículos de los clientes sobre los que trabaja el taller. Se registran desde la ficha de cada cliente."
      />

      <BuscadorSimple
        ruta="/unidades"
        etiqueta="Buscar unidades"
        marcador="Buscar por placa, marca, modelo o número de chasis"
      />

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
            </tr>
          </TablaCabecera>
          <tbody>
            {unidades.length === 0 ? (
              <SinDatos
                colSpan={7}
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
                const cliente = u.cliente as unknown as { id: string; razon_social: string }
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
                      <span className={todaviaSinPlaca(u) ? 'text-texto-suave' : 'tabular'}>
                        {nombre}
                      </span>
                      {avisarFalta && (
                        <span className="block text-[11px] font-normal text-texto-tenue">
                          sin placa
                        </span>
                      )}
                    </TD>
                    <TD>
                      <Link
                        href={`/clientes/${cliente.id}`}
                        className="max-w-52 truncate text-acento hover:underline"
                      >
                        {cliente.razon_social}
                      </Link>
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
