import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { numero } from '@/lib/format'
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
              <TH>Placa</TH>
              <TH>Cliente</TH>
              <TH>Vehículo</TH>
              <TH>Tipo</TH>
              <TH>Carrocería</TH>
              <TH className="text-right">Capacidad</TH>
              <TH>N.º de chasis</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {unidades.length === 0 ? (
              <SinDatos
                colSpan={7}
                titulo={busqueda ? 'Sin resultados' : 'Aún no hay unidades'}
                descripcion={
                  busqueda
                    ? 'Prueba con otra placa o marca.'
                    : 'Las unidades se registran desde la ficha del cliente.'
                }
              />
            ) : (
              unidades.map((u) => {
                const cliente = u.cliente as unknown as { id: string; razon_social: string }
                const carroceria = u.tipo_carroceria as unknown as { nombre: string } | null

                return (
                  <TR key={u.id}>
                    <TD className="tabular font-medium whitespace-nowrap">{u.placa}</TD>
                    <TD>
                      <Link
                        href={`/clientes/${cliente.id}`}
                        className="max-w-52 truncate text-acento hover:underline"
                      >
                        {cliente.razon_social}
                      </Link>
                    </TD>
                    <TD>{[u.marca, u.modelo, u.anio].filter(Boolean).join(' ') || '—'}</TD>
                    <TD className="text-texto-suave">{u.tipo_vehiculo}</TD>
                    <TD className="text-texto-suave">{carroceria?.nombre ?? '—'}</TD>
                    <TD className="tabular text-right whitespace-nowrap">
                      {u.capacidad_m3 ? `${numero(u.capacidad_m3, 1)} m³` : ''}
                      {u.capacidad_m3 && u.capacidad_toneladas ? ' · ' : ''}
                      {u.capacidad_toneladas ? `${numero(u.capacidad_toneladas, 1)} t` : ''}
                      {!u.capacidad_m3 && !u.capacidad_toneladas ? '—' : ''}
                    </TD>
                    <TD className="font-mono text-xs text-texto-suave">
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
