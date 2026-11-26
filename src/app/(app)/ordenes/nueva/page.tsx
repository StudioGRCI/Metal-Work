import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { reclamoParaAbrirSuOt } from '@/lib/datos/garantias'
import { catalogosOrden } from '@/lib/datos/ordenes'
import { exigirPermiso, puede } from '@/lib/sesion'

import { FormularioOrden } from './formulario-orden'

export const metadata = { title: 'Orden sin cotización' }

const FORMA_DE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaginaNuevaOrden({ searchParams }: PageProps<'/ordenes/nueva'>) {
  const perfil = await exigirPermiso('ordenes.crear')
  const params = await searchParams
  // Desde un reclamo de garantía (A.2): la OT nace con su cliente, su unidad y lo
  // que reclama, y al registrarse queda enlazada a él. Solo si quien la abre es
  // quien enlaza (`garantias.atender`) y el reclamo todavía espera su OT.
  const pedido = typeof params.reclamo === 'string' && FORMA_DE_ID.test(params.reclamo) ? params.reclamo : null
  const [catalogos, reclamo] = await Promise.all([
    catalogosOrden(),
    pedido && puede(perfil, 'garantias.atender') ? reclamoParaAbrirSuOt(pedido) : Promise.resolve(null),
  ])

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Órdenes de trabajo', ruta: '/ordenes' }, { titulo: 'Sin cotización' }]}
        titulo="Orden sin cotización"
        ayuda="Para una reparación, una garantía o un trabajo que no salió de una cotización. Va con el número y el PDF de su papel, como la de una cotización, que se emite desde «Cotizaciones». Nace en borrador y Gerencia la aprueba; recién ahí se generan sus etapas."
      />
      {pedido && !reclamo && (
        <p className="mb-4 max-w-4xl rounded-[var(--radius-base)] border border-borde bg-aviso-suave px-3 py-2 text-sm text-texto" data-reclamo-sin-efecto>
          Ese reclamo de garantía ya no espera su OT, o no lo puedes enlazar: esta orden nace sin él.{' '}
          <Link href={`/garantias/${pedido}`} className="font-medium text-acento underline underline-offset-2">
            Ver el reclamo
          </Link>
        </p>
      )}
      <FormularioOrden catalogos={catalogos} reclamo={reclamo} />
    </>
  )
}
