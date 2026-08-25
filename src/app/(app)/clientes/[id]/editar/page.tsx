import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { obtenerCliente } from '@/lib/datos/comercial'
import { exigirPermiso } from '@/lib/sesion'

import { FormularioCliente } from '../../formulario-cliente'

export const metadata = { title: 'Editar cliente' }

export default async function PaginaEditarCliente({ params }: PageProps<'/clientes/[id]/editar'>) {
  await exigirPermiso('clientes.editar')
  const { id } = await params

  const cliente = await obtenerCliente(id)
  if (!cliente) notFound()

  return (
    <>
      <EncabezadoPagina
        migas={[
          { titulo: 'Clientes', ruta: '/clientes' },
          { titulo: cliente.razon_social, ruta: `/clientes/${id}` },
          { titulo: 'Editar' },
        ]}
        titulo="Editar cliente"
      />
      <FormularioCliente cliente={cliente} />
    </>
  )
}
