import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { SinDatos, TH, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { catalogosDeServicio, listarOrdenesDeServicio, resumirServicios } from '@/lib/datos/servicios'
import { moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { FilaDeServicio, NuevaOrdenDeServicio } from './acciones-servicio'

export const metadata = { title: 'Servicios de terceros' }

const FILTROS = [
  { valor: 'abiertas', etiqueta: 'Abiertas' },
  { valor: 'EJECUTADO', etiqueta: 'Por conformar' },
  { valor: 'CONFORME', etiqueta: 'Por pagar' },
  { valor: 'PAGADO', etiqueta: 'Pagadas' },
  { valor: 'todas', etiqueta: 'Todas' },
]

export default async function PaginaServicios({ searchParams }: PageProps<'/servicios'>) {
  const perfil = await exigirPermiso(['compras.ver', 'costos.ver', 'calidad.ver'])
  const params = await searchParams

  const busqueda = typeof params.q === 'string' ? params.q : undefined
  const estado = typeof params.estado === 'string' ? params.estado : 'abiertas'

  const emite = puede(perfil, ['compras.crear', 'costos.editar'])

  const [servicios, catalogos] = await Promise.all([
    listarOrdenesDeServicio({ estado, busqueda }),
    emite ? catalogosDeServicio() : Promise.resolve(null),
  ])

  const resumen = resumirServicios(servicios)
  const conforma = puede(perfil, 'calidad.inspeccionar')
  const paga = puede(perfil, 'costos.editar')

  return (
    <>
      <EncabezadoPagina
        titulo="Servicios de terceros"
        descripcion="El trabajo que se manda a hacer afuera: arenado, corte láser, galvanizado, torno."
        acciones={emite && catalogos && <NuevaOrdenDeServicio catalogos={catalogos} />}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        <Resumen titulo="Órdenes listadas" valor={String(resumen.total)} />
        <Resumen
          titulo="Comprometido"
          valor={moneda(resumen.comprometido)}
          nota="Pedido y todavía afuera"
        />
        <Resumen
          titulo="Por conformar"
          valor={String(resumen.porConformar)}
          nota="Volvieron y esperan la aceptación"
          tono={resumen.porConformar > 0 ? 'aviso' : 'neutro'}
        />
        <Resumen
          titulo="Atrasadas"
          valor={String(resumen.atrasadas)}
          nota="Pasaron su fecha de entrega"
          tono={resumen.atrasadas > 0 ? 'peligro' : 'neutro'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-64 flex-1">
          <BuscadorSimple
            ruta="/servicios"
            etiqueta="Buscar órdenes de servicio"
            marcador="Buscar por número, proveedor, trabajo u OT"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTROS.map((f) => (
            <a
              key={f.valor}
              href={`/servicios?estado=${f.valor}${busqueda ? `&q=${encodeURIComponent(busqueda)}` : ''}`}
              aria-current={estado === f.valor ? 'page' : undefined}
              className={
                estado === f.valor
                  ? 'rounded-[var(--radius-base)] bg-acento-suave px-3 py-1.5 text-sm font-medium text-acento'
                  : 'rounded-[var(--radius-base)] px-3 py-1.5 text-sm text-texto-suave hover:bg-superficie-2'
              }
            >
              {f.etiqueta}
            </a>
          ))}
        </div>
      </div>

      <Tarjeta className="mt-4 overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Orden</TH>
              <TH>Proveedor</TH>
              <TH>Trabajo</TH>
              <TH>Estado</TH>
              <TH>Entrega</TH>
              <TH className="text-right">Monto</TH>
              <TH className="text-right">Acciones</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {servicios.length === 0 && (
              <SinDatos
                colSpan={7}
                titulo="No hay órdenes de servicio"
                descripcion="Aquí aparece cada trabajo que se manda a hacer afuera, con su plazo y su monto."
              />
            )}

            {servicios.map((servicio) => (
              <FilaDeServicio
                key={servicio.id}
                servicio={servicio}
                puedeMover={emite}
                puedeConformar={conforma}
                puedePagar={paga}
              />
            ))}
          </tbody>
        </Tabla>
      </Tarjeta>

      <p className="mt-3 text-xs text-texto-tenue">
        Mientras el trabajo está afuera el monto es un compromiso. Al dar la conformidad pasa a ser
        costo de la unidad, y recién ahí se puede registrar la factura y el pago.
      </p>
    </>
  )
}

function Resumen({
  titulo,
  valor,
  nota,
  tono = 'neutro',
}: {
  titulo: string
  valor: string
  nota?: string
  tono?: 'neutro' | 'aviso' | 'peligro'
}) {
  const color = { neutro: 'text-texto', aviso: 'text-aviso', peligro: 'text-peligro' }[tono]

  return (
    <Tarjeta>
      <TarjetaCuerpo>
        <p className="text-[11px] font-medium tracking-wide text-texto-suave uppercase">{titulo}</p>
        <p className={`tabular mt-1 text-lg font-semibold ${color}`}>{valor}</p>
        {nota && <p className="mt-0.5 text-xs text-texto-tenue">{nota}</p>}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
