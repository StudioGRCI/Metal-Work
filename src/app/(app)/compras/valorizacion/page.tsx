import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { materialesParaValorizar, precioDeCosteo } from '@/lib/datos/valorizacion'
import { cantidad, fecha, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { FijarPrecio } from './fijar-precio'

export const metadata = { title: 'Valorización del almacén' }

const VER = [
  { valor: null, etiqueta: 'Todo' },
  { valor: 'sin-precio', etiqueta: 'Sin precio' },
  { valor: 'logistica', etiqueta: 'Con precio de Logística' },
]

function texto(valor: string | string[] | undefined) {
  return typeof valor === 'string' ? valor.trim() : ''
}

const monedaValida = (m: string | null) => (m === 'PEN' || m === 'USD' ? m : null)

/**
 * Logística pone precio a lo que hay en almacén y nunca se compró por el
 * sistema —consumibles, saldos iniciales—. Sin ese precio el material sale
 * del almacén, se carga a la OT y su costo queda en blanco.
 *
 * La lectura es la misma que pide `materiales_para_valorizar`: Logística
 * (`almacen.valorizar`), Almacén (`almacen.ver`) y Costos (`costos.ver`).
 */
export default async function PaginaValorizacion({ searchParams }: PageProps<'/compras/valorizacion'>) {
  const perfil = await exigirPermiso(['almacen.valorizar', 'almacen.ver', 'costos.ver'])
  const params = await searchParams
  const ver = texto(params.ver)
  const busqueda = texto(params.q).slice(0, 60).toLocaleLowerCase('es')
  const puedeValorizar = puede(perfil, 'almacen.valorizar')

  const todos = await materialesParaValorizar()
  const conCosteo = todos.map((m) => ({ ...m, costeo: precioDeCosteo(m) }))

  const enAlmacen = conCosteo.filter((m) => Number(m.existencia ?? 0) > 0)
  const sinPrecio = enAlmacen.filter((m) => m.costeo === null)
  const valor = { PEN: 0, USD: 0 }
  for (const m of enAlmacen) {
    if (m.costeo) valor[m.costeo.moneda] += Number(m.existencia ?? 0) * m.costeo.precio
  }

  const filas = conCosteo.filter((m) => {
    if (ver === 'sin-precio' && m.costeo !== null) return false
    if (ver === 'logistica' && m.precio === null) return false
    if (!busqueda) return true
    return `${m.codigo ?? ''} ${m.descripcion ?? ''}`.toLocaleLowerCase('es').includes(busqueda)
  })
  const hayFiltros = Boolean(busqueda || ver)

  return (
    <>
      <EncabezadoPagina
        titulo="Valorización del almacén"
        descripcion="El precio unitario de lo que hay en almacén. Lo comprado por el sistema ya trae el de su orden de compra; Logística fija el de los consumibles y saldos que nunca pasaron por una compra."
        migas={[{ titulo: 'Compras', ruta: puede(perfil, 'compras.crear') ? '/compras' : undefined }, { titulo: 'Valorización' }]}
      />

      <dl className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra etiqueta="Materiales con saldo" valor={cantidad(enAlmacen.length)} />
        <Cifra etiqueta="Con saldo y sin precio" valor={cantidad(sinPrecio.length)} aviso={sinPrecio.length > 0} />
        <Cifra etiqueta="Valor en almacén (soles)" valor={moneda(valor.PEN, 'PEN')} />
        <Cifra etiqueta="Valor en almacén (dólares)" valor={moneda(valor.USD, 'USD')} />
      </dl>

      <Tarjeta className="mb-4">
        <TarjetaCuerpo>
          <form method="get" className="flex flex-wrap items-end gap-3">
            {ver && <input type="hidden" name="ver" value={ver} />}
            <label className="min-w-0 flex-1 basis-64">
              <span className="mb-1 block text-xs font-medium text-texto-suave">Buscar material</span>
              <Entrada name="q" type="search" defaultValue={texto(params.q)} placeholder="Código o descripción" autoComplete="off" />
            </label>
            <button type="submit" className="inline-flex min-h-11 items-center rounded-[var(--radius-base)] bg-acento px-4 text-sm font-medium text-acento-texto hover:opacity-90 sm:min-h-9">
              Buscar
            </button>
            {hayFiltros && <Link href="/compras/valorizacion" className="self-center text-sm text-acento hover:underline">Limpiar</Link>}
          </form>
          <PastillaFiltro ruta="/compras/valorizacion" clave="ver" opciones={VER} params={params}
            activo={ver || null} etiqueta="Qué materiales mostrar" className="mt-3" />
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera
          titulo="Materiales del almacén"
          descripcion="El costeo de la OT usa el precio congelado en la salida; si no lo hay, la última compra; y si el material nunca se compró, el precio que fija Logística."
        />
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Material</TH>
              <TH className="text-right">Saldo</TH>
              <TH className="hidden text-right md:table-cell">Última compra</TH>
              <TH className="text-right">Precio de Logística</TH>
              <TH>Para el costeo</TH>
              <TH className="hidden text-right lg:table-cell">Valor del saldo</TH>
              {puedeValorizar && <TH><span className="sr-only">Acción</span></TH>}
            </tr>
          </TablaCabecera>
          <tbody>
            {filas.length === 0 ? (
              <SinDatos
                colSpan={puedeValorizar ? 7 : 6}
                titulo={hayFiltros ? 'Ningún material con ese filtro' : 'El almacén todavía no tiene materiales'}
                descripcion={hayFiltros
                  ? 'Borra la búsqueda o elige «Todo».'
                  : 'Aparecen aquí en cuanto Almacén registra su saldo inicial o su primer ingreso en el kardex.'}
              />
            ) : filas.map((m) => {
              const monedaCompra = monedaValida(m.moneda_compra)
              const monedaLogistica = monedaValida(m.moneda)
              return (
                <TR key={m.material_id}>
                  <TD className="max-w-72">
                    <span className="line-clamp-2 text-sm">{m.descripcion}</span>
                    <span className="block font-mono text-[10px] text-texto-tenue">{m.codigo}</span>
                  </TD>
                  <TD className="tabular text-right">
                    {cantidad(m.existencia)}
                    {m.unidad && <span className="ml-1 text-[10px] text-texto-tenue">{m.unidad}</span>}
                  </TD>
                  <TD className="tabular hidden text-right md:table-cell">
                    {m.ultima_compra !== null && monedaCompra ? moneda(m.ultima_compra, monedaCompra) : <span className="text-texto-tenue">—</span>}
                  </TD>
                  <TD className="tabular text-right">
                    {m.precio !== null && monedaLogistica ? (
                      <>
                        {moneda(m.precio, monedaLogistica)}
                        <span className="block text-[10px] text-texto-tenue">desde {fecha(m.valorizado_en)}</span>
                      </>
                    ) : <span className="text-texto-tenue">—</span>}
                  </TD>
                  <TD>
                    {m.costeo === null
                      ? <Insignia tono="aviso">Sin precio</Insignia>
                      : <Insignia tono={m.costeo.origen === 'COMPRA' ? 'neutro' : 'info'}>{m.costeo.origen === 'COMPRA' ? 'Compra' : 'Logística'}</Insignia>}
                  </TD>
                  <TD className="tabular hidden text-right lg:table-cell">
                    {m.costeo ? moneda(Number(m.existencia ?? 0) * m.costeo.precio, m.costeo.moneda) : <span className="text-texto-tenue">—</span>}
                  </TD>
                  {puedeValorizar && (
                    <TD className="text-right">
                      {m.material_id && (
                        <FijarPrecio material={{
                          id: m.material_id,
                          codigo: m.codigo ?? '',
                          descripcion: m.descripcion ?? 'Material',
                          unidad: m.unidad,
                          precio: m.precio === null ? null : Number(m.precio),
                          moneda: monedaLogistica,
                          ultimaCompra: m.ultima_compra === null ? null : Number(m.ultima_compra),
                          monedaCompra,
                        }} />
                      )}
                    </TD>
                  )}
                </TR>
              )
            })}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}

function Cifra({ etiqueta, valor, aviso }: { etiqueta: string; valor: string; aviso?: boolean }) {
  return (
    <div className="rounded-[var(--radius-base)] border border-borde bg-superficie px-3 py-2">
      <dt className="text-[11px] text-texto-suave">{etiqueta}</dt>
      <dd className={`tabular mt-1 text-lg font-semibold ${aviso ? 'text-aviso' : 'text-texto'}`}>{valor}</dd>
    </div>
  )
}
