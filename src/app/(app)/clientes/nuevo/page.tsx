import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { exigirPermiso } from '@/lib/sesion'

import { FormularioCliente } from '../formulario-cliente'

export const metadata = { title: 'Nuevo cliente' }

export default async function PaginaNuevoCliente() {
  await exigirPermiso('clientes.crear')

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Clientes', ruta: '/clientes' }, { titulo: 'Nuevo' }]}
        titulo="Nuevo cliente"
        descripcion="Registra la empresa o persona a la que se le factura el trabajo."
      />
      <FormularioCliente />
    </>
  )
}
