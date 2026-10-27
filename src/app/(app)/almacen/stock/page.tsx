import { SeparadoPara } from '@/components/almacen/separado-para'
import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { stockEnAlmacen, type MaterialEnStock } from '@/lib/datos/stock-almacen'
import { ALMACENES, ORDEN_ALMACENES, type Almacen, esAlmacen } from '@/lib/dominio/almacen'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { cantidad, parteDe, porcentaje } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Stock en almacén' }

/** «Por clasificar» va en la URL como un almacén más, aunque no lo sea. */
const POR_CLASIFICAR = 'POR_CLASIFICAR'

/**
 * Cuánto hay de cada material en los cuatro almacenes, cuánto de eso está libre
 * y cuánto ya es de cada código interno, en solo lectura y sin precios
 * (migraciones 20261016950000 y 20261020195000). La pidió Maestranza para saber
 * qué hay antes de pedirlo, y la ven todos los supervisores de área; desde el
 * 2026-10-20 también Requerimientos y Administración, que piden, y Almacén la
 * tiene en su menú para compartirla (DKS). Lo que ya es de un código —lo que
 * Almacén separó para un RQ abierto y no entregó, lo que llegó de su compra y
 * los accesorios que entraron para una unidad— sigue en el almacén, pero no
 * está libre: por eso el número grande es lo libre.
 *
 * Era «Stock de Almacén» hasta el 2026-10-01, cuando el kardex la reemplazó para
 * Almacén; desde el 2026-10-15 vuelve como la vista de Supervisión.
 */
export default async function PaginaStockEnAlmacen({ searchParams }: PageProps<'/almacen/stock'>) {
  const perfil = await exigirPermiso(['almacen.stock', 'almacen.ver'])
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 80) : ''
  const pedido = typeof params.almacen === 'string' ? params.almacen.toUpperCase() : ''
  const almacen: Almacen | typeof POR_CLASIFICAR | null = esAlmacen(pedido) || pedido === POR_CLASIFICAR ? pedido : null
  const abreKardex = puede(perfil, 'almacen.ver')
  const pide = puede(perfil, ['requerimientos.emitir', 'requerimientos.administracion'])

  const todos = await stockEnAlmacen()
  // Lo que busca: el nombre, el código del material, la familia, el código
  // interno al que ya es algo, o el RQ que lo separó.
  const palabras = palabrasDeBusqueda(q)
  const buscados = todos.filter((m) =>
    coincide(palabras, [m.descripcion, m.codigo, m.categoria, ...m.por_codigo.flatMap((c) => [c.codigo, ...c.requerimientos])]),
  )
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
        ayuda="Cuánto hay de cada material en los cuatro almacenes, tal como lo reporta Almacén en su kardex. «Libre» es lo que se puede usar para un pedido nuevo. Lo demás sigue en el almacén pero está separado para un código interno (o PLANTA): lo que Almacén separó para un requerimiento abierto y todavía no entregó, lo que llegó de su compra, y los accesorios que entraron para una unidad. Lo ven Almacén, Supervisión, Requerimientos y Administración, sin precios."
        // Quien pide vuelve a sus requerimientos desde las migas; las demás no
        // llevan enlace y no se muestran.
        migas={[
          abreKardex ? { titulo: 'Almacén' } : pide ? { titulo: 'Requerimientos', ruta: '/requerimientos' } : { titulo: 'Supervisión' },
          { titulo: 'Stock en almacén' },
        ]}
        acciones={
          abreKardex && (
            <EnlaceBoton href="/almacen/kardex" variante="secundario">
              Abrir el kardex
            </EnlaceBoton>
          )
        }
      />

      <div className="mb-4 space-y-3">
        <BuscadorSimple ruta="/almacen/stock" etiqueta="Buscar en el stock" marcador="Material, código interno o RQ" />
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
                ? `Prueba con otra palabra, con el código del material o con el código interno.${pide ? ' Si Almacén no lo tiene, pídelo con un requerimiento.' : ''}`
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
              <TablaDeStock materiales={g.materiales} />
            </Tarjeta>
          ))}
        </div>
      )}
    </>
  )
}

/** Primero lo que tiene algo libre; después lo que ya es todo de algún código; al final lo que se acabó, que también se quiere saber. */
function TablaDeStock({ materiales }: { materiales: MaterialEnStock[] }) {
  const orden = [
    ...materiales.filter((m) => m.libre > 0),
    ...materiales.filter((m) => m.libre <= 0 && m.existencia > 0),
    ...materiales.filter((m) => m.libre <= 0 && m.existencia <= 0),
  ]
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Material</TH>
          <TH className="text-right">Libre</TH>
          {/* En el teléfono, lo separado va debajo del material: tres columnas no caben. */}
          <TH className="hidden sm:table-cell">Separado para</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {orden.length === 0 ? (
          <SinDatos titulo="Nada en este almacén" />
        ) : (
          orden.map((m) => <FilaDeStock key={m.material_id} material={m} />)
        )}
      </tbody>
    </Tabla>
  )
}

function FilaDeStock({ material: m }: { material: MaterialEnStock }) {
  const bajoMinimo = m.stock_minimo !== null && m.existencia < m.stock_minimo
  const ocupado = m.separado > 0 || m.reservado_ot > 0
  return (
    <TR data-material={m.codigo}>
      <TD className="align-top">
        <p className="font-medium text-texto">{m.descripcion}</p>
        <p className="text-xs text-texto-suave">
          <span className="tabular">{m.codigo}</span>
          {m.categoria && ` · ${m.categoria}`}
        </p>
        {ocupado && <SeparadoPara material={m} className="mt-1.5 sm:hidden" />}
      </TD>
      <TD className="text-right align-top whitespace-nowrap" data-libre={m.libre}>
        {m.existencia <= 0 ? (
          <Insignia tono="peligro">Sin stock</Insignia>
        ) : m.libre > 0 ? (
          <p className="tabular font-semibold text-texto">
            {cantidad(m.libre)} <span className="font-normal text-texto-suave">{m.unidad}</span>
          </p>
        ) : (
          // Un accesorio que entró para su unidad no tiene nada libre, y es lo normal.
          <Insignia tono="neutro">Nada libre</Insignia>
        )}
        {m.existencia > 0 && ocupado && (
          <p className="tabular mt-0.5 text-xs text-texto-suave">
            de {cantidad(m.existencia)} {m.unidad} en almacén · {porcentaje(parteDe(m.separado + m.reservado_ot, m.existencia))} separado
          </p>
        )}
        {bajoMinimo && m.existencia > 0 && (
          <div className="mt-1">
            <Insignia tono="aviso">Bajo el mínimo de {cantidad(m.stock_minimo)}</Insignia>
          </div>
        )}
      </TD>
      <TD className="hidden align-top text-xs sm:table-cell">
        {ocupado ? <SeparadoPara material={m} /> : <span className="text-texto-suave">—</span>}
      </TD>
    </TR>
  )
}
