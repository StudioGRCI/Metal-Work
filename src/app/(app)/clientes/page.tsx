import Link from 'next/link'
import { Plus } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { listarClientes } from '@/lib/datos/comercial'
import { exigirPermiso, puede } from '@/lib/sesion'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'

export const metadata = { title: 'Clientes' }

export default async function PaginaClientes({ searchParams }: PageProps<'/clientes'>) {
  const perfil = await exigirPermiso('clientes.ver')
  const params = await searchParams

  const busqueda = typeof params.q === 'string' ? params.q : undefined
  const { clientes, total } = await listarClientes({
    busqueda,
    pagina: Number(params.pagina) || 1,
  })

  return (
    <>
      <EncabezadoPagina
        titulo="Clientes"
        descripcion={total === 1 ? '1 cliente registrado' : `${total} clientes registrados`}
        acciones={
          puede(perfil, 'clientes.crear') && (
            <Link
              href="/clientes/nuevo"
              className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-base)] bg-acento px-4 text-sm font-medium text-acento-texto hover:bg-acento-fuerte"
            >
              <Plus aria-hidden className="size-4" />
              Nuevo cliente
            </Link>
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
              <TH>Contacto</TH>
              <TH>Ubicación</TH>
              <TH className="text-right">Unidades</TH>
              <TH className="text-right">Órdenes</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {clientes.length === 0 ? (
              <SinDatos
                colSpan={6}
                titulo={busqueda ? 'Sin resultados' : 'Aún no hay clientes'}
                descripcion={
                  busqueda
                    ? 'Prueba con otro término de búsqueda.'
                    : 'Registra el primer cliente para poder abrir órdenes de trabajo.'
                }
              />
            ) : (
              clientes.map((c) => {
                const unidades = (c.unidades as unknown as { count: number }[])?.[0]?.count ?? 0
                const ordenes = (c.ordenes_trabajo as unknown as { count: number }[])?.[0]?.count ?? 0

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
                    </TD>
                    <TD className="whitespace-nowrap">
                      <span className="text-texto-suave">{c.tipo_documento}</span>{' '}
                      <span className="tabular">{c.numero_documento}</span>
                    </TD>
                    <TD className="text-texto-suave">
                      {c.telefono ?? '—'}
                      {c.correo && <p className="text-[11px]">{c.correo}</p>}
                    </TD>
                    <TD className="text-texto-suave">
                      {[c.distrito, c.provincia].filter(Boolean).join(', ') || '—'}
                    </TD>
                    <TD className="tabular text-right">{unidades}</TD>
                    <TD className="tabular text-right">{ordenes}</TD>
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
