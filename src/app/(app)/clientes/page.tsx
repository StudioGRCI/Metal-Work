import Link from 'next/link'
import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Paginacion } from '@/components/estructura/paginacion'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { CLIENTES_POR_PAGINA, listarClientes } from '@/lib/datos/comercial'
import { exigirPermiso, puede } from '@/lib/sesion'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'

export const metadata = { title: 'Clientes' }

export default async function PaginaClientes({ searchParams }: PageProps<'/clientes'>) {
  const perfil = await exigirPermiso('clientes.ver')
  const params = await searchParams

  const busqueda = typeof params.q === 'string' ? params.q : undefined
  const { clientes, total, pagina, paginas } = await listarClientes({
    busqueda,
    pagina: Number(params.pagina) || 1,
  })

  const crea = puede(perfil, 'clientes.crear')

  // «No hay ninguno» y «no hay ninguno que coincida» se resuelven distinto: en el
  // primer caso el siguiente paso es dar de alta, en el segundo es soltar la
  // búsqueda. El botón del estado vacío es el que da ese paso.
  let accionSinDatos: ReactNode = null
  if (busqueda) {
    accionSinDatos = (
      <EnlaceBoton href="/clientes" variante="contorno">
        Ver todos los clientes
      </EnlaceBoton>
    )
  } else if (crea) {
    accionSinDatos = (
      <EnlaceBoton href="/clientes/nuevo">
        <Plus aria-hidden className="size-4" />
        Nuevo cliente
      </EnlaceBoton>
    )
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Clientes"
        descripcion={total === 1 ? '1 cliente registrado' : `${total} clientes registrados`}
        acciones={
          crea && (
            <EnlaceBoton href="/clientes/nuevo">
              <Plus aria-hidden className="size-4" />
              Nuevo cliente
            </EnlaceBoton>
          )
        }
      />

      <BuscadorSimple
        ruta="/clientes"
        etiqueta="Buscar clientes"
        marcador="Buscar por razón social, nombre comercial o RUC"
      />

      <Tarjeta className="mt-4 overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Cliente</TH>
              <TH>Documento</TH>
              {/* En el teléfono no caben seis columnas: contacto y ubicación se
                  esconden aquí y bajan a la celda del nombre en letra chica, que
                  es donde el dedo ya está mirando. */}
              <TH className="hidden sm:table-cell">Contacto</TH>
              <TH className="hidden sm:table-cell">Ubicación</TH>
              <TH className="text-right">Unidades</TH>
              <TH className="text-right">Órdenes</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {clientes.length === 0 ? (
              <SinDatos
                colSpan={6}
                titulo={busqueda ? 'Ningún cliente coincide' : 'Aún no hay clientes'}
                descripcion={
                  busqueda
                    ? `Nada con «${busqueda}». Prueba con el RUC o con el nombre comercial.`
                    : 'Registra el primer cliente para poder abrir órdenes de trabajo.'
                }
                accion={accionSinDatos}
              />
            ) : (
              clientes.map((c) => {
                const unidades = (c.unidades as unknown as { count: number }[])?.[0]?.count ?? 0
                const ordenes = (c.ordenes_trabajo as unknown as { count: number }[])?.[0]?.count ?? 0
                const ubicacion = [c.distrito, c.provincia].filter(Boolean).join(', ')
                // Lo que en el teléfono se pierde al esconder dos columnas vuelve
                // aquí en una sola línea; sin esto el listado móvil no diría ni el
                // teléfono del cliente ni de dónde es.
                const enElTelefono = [c.telefono, ubicacion].filter(Boolean).join(' · ')

                return (
                  <TR key={c.id}>
                    <TD>
                      <Link
                        href={`/clientes/${c.id}`}
                        className="font-medium text-acento hover:underline"
                      >
                        {c.razon_social}
                      </Link>
                      {c.nombre_comercial && (
                        <p className="text-[11px] text-texto-suave">{c.nombre_comercial}</p>
                      )}
                      {enElTelefono && (
                        <p className="text-[11px] text-texto-suave sm:hidden">{enElTelefono}</p>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap">
                      <span className="text-texto-suave">{c.tipo_documento}</span>{' '}
                      <span className="tabular">{c.numero_documento}</span>
                    </TD>
                    <TD className="hidden text-texto-suave sm:table-cell">
                      {c.telefono ?? '—'}
                      {c.correo && <p className="text-[11px]">{c.correo}</p>}
                    </TD>
                    <TD className="hidden text-texto-suave sm:table-cell">{ubicacion || '—'}</TD>
                    <TD className="tabular text-right">{unidades}</TD>
                    <TD className="tabular text-right">{ordenes}</TD>
                  </TR>
                )
              })
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      <Paginacion
        ruta="/clientes"
        pagina={pagina}
        paginas={paginas}
        total={total}
        porPagina={CLIENTES_POR_PAGINA}
        params={params}
      />
    </>
  )
}
