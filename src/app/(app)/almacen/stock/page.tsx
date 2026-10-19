import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { stockEnAlmacen, type MaterialEnStock } from '@/lib/datos/stock-almacen'
import { ALMACENES, ORDEN_ALMACENES, type Almacen, esAlmacen } from '@/lib/dominio/almacen'
import { cantidad } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Stock en almacén' }

/** Sin tildes ni mayúsculas, para que «tubo» encuentre «TUBO» y «lamina» encuentre «Lámina». */
const plano = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** «Por clasificar» va en la URL como un almacén más, aunque no lo sea. */
const POR_CLASIFICAR = 'POR_CLASIFICAR'

/**
 * Cuánto hay de cada material en los cuatro almacenes, tal como lo reporta
 * Almacén en su kardex, en solo lectura y sin precios (migración
 * 20261016950000). La pidió Maestranza para saber qué hay antes de pedirlo, y
 * la ven todos los supervisores de área. Los accesorios dicen de qué código
 * interno es cada uno: entraron para esa unidad y solo salen para ella, así que
 * el buscador también encuentra por código interno.
 *
 * Era «Stock de Almacén» hasta el 2026-10-01, cuando el kardex la reemplazó para
 * Almacén; desde el 2026-10-15 vuelve como la vista de Supervisión. Almacén la
 * puede abrir, pero lo suyo es el kardex.
 */
export default async function PaginaStockEnAlmacen({ searchParams }: PageProps<'/almacen/stock'>) {
  const perfil = await exigirPermiso(['almacen.stock', 'almacen.ver'])
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 80) : ''
  const pedido = typeof params.almacen === 'string' ? params.almacen.toUpperCase() : ''
  const almacen: Almacen | typeof POR_CLASIFICAR | null = esAlmacen(pedido) || pedido === POR_CLASIFICAR ? pedido : null
  const abreKardex = puede(perfil, 'almacen.ver')

  const todos = await stockEnAlmacen()
  // Lo que busca: el nombre, el código del material, la familia o el código
  // interno de la unidad para la que entró un accesorio.
  const buscados = q
    ? todos.filter((m) =>
        [m.descripcion, m.codigo, m.categoria, ...m.por_codigo.map((c) => c.codigo)].some((t) => plano(t).includes(plano(q))),
      )
    : todos
  const deAlmacen = (a: Almacen | typeof POR_CLASIFICAR) =>
    buscados.filter((m) => (a === POR_CLASIFICAR ? m.almacen === null : m.almacen === a))
  const conStock = (lista: MaterialEnStock[]) => lista.filter((m) => m.existencia > 0).length
  const grupos = [...ORDEN_ALMACENES, POR_CLASIFICAR as typeof POR_CLASIFICAR]
    .filter((a) => almacen === null || a === almacen)
    .map((a) => ({ almacen: a, materiales: deAlmacen(a) }))
    .filter((g) => g.materiales.length > 0)

  return (
    <>
      <EncabezadoPagina
        titulo="Stock en almacén"
        ayuda="Cuánto hay de cada material en los cuatro almacenes, tal como lo reporta Almacén en su kardex. Los accesorios dicen de qué código interno es cada uno: solo salen para esa unidad."
        migas={[{ titulo: abreKardex ? 'Almacén' : 'Supervisión' }, { titulo: 'Stock en almacén' }]}
        acciones={
          abreKardex && (
            <EnlaceBoton href="/almacen/kardex" variante="secundario">
              Abrir el kardex
            </EnlaceBoton>
          )
        }
      />

      <div className="mb-4 space-y-3">
        <BuscadorSimple ruta="/almacen/stock" etiqueta="Buscar en el stock" marcador="Material o código interno" />
        <PastillaFiltro
          ruta="/almacen/stock"
          clave="almacen"
          params={params}
          activo={almacen}
          etiqueta="Qué almacén mostrar"
          opciones={[
            { valor: null, etiqueta: `Todos (${conStock(buscados)})` },
            ...ORDEN_ALMACENES.map((a) => ({ valor: a, etiqueta: `${ALMACENES[a].etiqueta} (${conStock(deAlmacen(a))})` })),
            ...(deAlmacen(POR_CLASIFICAR).length > 0 ? [{ valor: POR_CLASIFICAR, etiqueta: `Por clasificar (${conStock(deAlmacen(POR_CLASIFICAR))})` }] : []),
          ]}
        />
        <p className="text-xs text-texto-suave">Entre paréntesis, cuántos materiales tienen stock.</p>
      </div>

      {grupos.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">{q ? `Nada con «${q}»` : 'Almacén todavía no tiene materiales en su kardex'}</p>
            <p className="text-sm text-texto-suave">
              {q
                ? 'Prueba con otra palabra, con el código del material o con el código interno de la unidad.'
                : 'Aparecen aquí apenas Almacén registra su primer ingreso o su conteo.'}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <div className="space-y-5">
          {grupos.map((g) => (
            <Tarjeta key={g.almacen} className="overflow-hidden" data-almacen={g.almacen}>
              <TarjetaCabecera
                titulo={g.almacen === POR_CLASIFICAR ? 'Por clasificar' : ALMACENES[g.almacen].etiqueta}
                ayuda={
                  g.almacen === POR_CLASIFICAR
                    ? 'Entraron sin familia de almacén: Almacén todavía no los ordena en uno de los cuatro.'
                    : ALMACENES[g.almacen].descripcion
                }
              />
              <TablaDeStock materiales={g.materiales} porCodigo={g.almacen === 'ACCESORIOS'} />
            </Tarjeta>
          ))}
        </div>
      )}
    </>
  )
}

/** Solo los accesorios llevan la columna del código interno: lo demás sale para cualquier unidad. */
function TablaDeStock({ materiales, porCodigo }: { materiales: MaterialEnStock[]; porCodigo: boolean }) {
  // Primero lo que hay; al final lo que se acabó, que también se quiere saber.
  const orden = [...materiales.filter((m) => m.existencia > 0), ...materiales.filter((m) => m.existencia <= 0)]
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Material</TH>
          <TH className="text-right">En almacén</TH>
          {porCodigo && <TH>De qué código interno</TH>}
        </tr>
      </TablaCabecera>
      <tbody>
        {orden.length === 0 ? (
          <SinDatos titulo="Nada en este almacén" />
        ) : (
          orden.map((m) => <FilaDeStock key={m.material_id} material={m} porCodigo={porCodigo} />)
        )}
      </tbody>
    </Tabla>
  )
}

function FilaDeStock({ material: m, porCodigo }: { material: MaterialEnStock; porCodigo: boolean }) {
  const bajoMinimo = m.stock_minimo !== null && m.existencia < m.stock_minimo
  const deCodigos = m.por_codigo.reduce((s, c) => s + c.cantidad, 0)
  const libre = Math.max(m.existencia - deCodigos, 0)
  return (
    <TR data-material={m.codigo}>
      <TD className="align-top">
        <p className="font-medium text-texto">{m.descripcion}</p>
        <p className="text-xs text-texto-suave">
          <span className="tabular">{m.codigo}</span>
          {m.categoria && ` · ${m.categoria}`}
        </p>
      </TD>
      <TD className="text-right align-top whitespace-nowrap">
        {m.existencia > 0 ? (
          <p className="tabular font-semibold text-texto">
            {cantidad(m.existencia)} <span className="font-normal text-texto-suave">{m.unidad}</span>
          </p>
        ) : (
          <Insignia tono="peligro">Sin stock</Insignia>
        )}
        {bajoMinimo && m.existencia > 0 && (
          <div className="mt-1">
            <Insignia tono="aviso">Bajo el mínimo de {cantidad(m.stock_minimo)}</Insignia>
          </div>
        )}
      </TD>
      {porCodigo && (
        <TD className="align-top text-xs">
          {m.por_codigo.length === 0 ? (
            <span className="text-texto-suave">Libre: no entró para ninguna unidad</span>
          ) : (
            <ul className="space-y-0.5">
              {m.por_codigo.map((c) => (
                <li key={c.codigo}>
                  <span className="font-mono text-texto">{c.codigo}</span>{' '}
                  <span className="tabular text-texto-suave">
                    {cantidad(c.cantidad)} {m.unidad}
                  </span>
                </li>
              ))}
              {libre > 0 && (
                <li className="text-texto-suave">
                  Libre: <span className="tabular">{cantidad(libre)} {m.unidad}</span>
                </li>
              )}
            </ul>
          )}
        </TD>
      )}
    </TR>
  )
}
