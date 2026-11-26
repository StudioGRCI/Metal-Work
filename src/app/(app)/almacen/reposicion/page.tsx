import Link from 'next/link'
import { PackageX, ShieldAlert, Truck } from 'lucide-react'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { reposicionDeStock, type MaterialParaReponer } from '@/lib/datos/reposicion'
import { ALMACENES, esAlmacen } from '@/lib/dominio/almacen'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { cantidad } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { StockDeSeguridad } from './stock-de-seguridad'

export const metadata = { title: 'Reposición de stock' }

const VISTAS = [
  { valor: 'reponer', titulo: 'Por reponer', descripcion: 'Lo que hay y lo que ya viene no llega al mínimo' },
  { valor: 'sin-minimo', titulo: 'Sin mínimo', descripcion: 'Salió en los últimos 90 días y no tiene stock mínimo' },
  { valor: 'todos', titulo: 'Todos', descripcion: 'Con mínimo, con compra por mayor o con salidas en 90 días' },
] as const
type Vista = (typeof VISTAS)[number]['valor']

const bajoMinimo = (m: MaterialParaReponer) => m.stock_minimo !== null && m.existencia < m.stock_minimo

/**
 * El stock de seguridad de lo que más rota (Almacén, 20/11/2026: mantener un
 * mínimo de los consumibles y comprar por mayor los discos). De cada material:
 * lo que hay, lo que ya viene en otra OC —para no comprarlo dos veces—, cuánto
 * salió en 90 días y cuánto comprar. Almacén fija el mínimo y la compra por
 * mayor; Logística compra mirando esta lista. Sin precios.
 */
export default async function PaginaReposicion({ searchParams }: PageProps<'/almacen/reposicion'>) {
  const perfil = await exigirPermiso(['almacen.ver', 'almacen.stock'])
  const fija = puede(perfil, 'almacen.recibir')
  const compra = puede(perfil, 'compras.crear')
  const params = await searchParams
  const vista: Vista = VISTAS.some((v) => v.valor === params.vista) ? (params.vista as Vista) : 'reponer'
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 80) : ''
  const palabras = palabrasDeBusqueda(q)

  // El buscador filtra todo, también las cifras: buscar «disco» dice cuántos discos faltan.
  const todos = (await reposicionDeStock()).filter((m) => palabras.length === 0 || coincide(palabras, [m.codigo, m.descripcion, m.categoria]))
  const porReponer = todos.filter((m) => m.comprar > 0)
  const sinMinimo = todos.filter((m) => m.stock_minimo === null && m.salio_90_dias > 0)
  const mostrados = vista === 'reponer' ? porReponer : vista === 'sin-minimo' ? sinMinimo : todos
  const enCamino = todos.filter((m) => m.stock_minimo !== null && m.en_camino + m.por_aprobar > 0).length
  const conQ = (href: string) => (q ? `${href}${href.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}` : href)
  const vacio = q
    ? {
        titulo: 'Ningún material coincide',
        descripcion:
          vista === 'todos'
            ? `Nada coincide con «${q}». Prueba con otra palabra o con el código, o borra la búsqueda.`
            : `Nada de esta vista coincide con «${q}». Míralo en «Todos» o borra la búsqueda.`,
      }
    : {
    reponer: {
      titulo: 'Nada por reponer',
      descripcion: 'Todo lo que tiene mínimo está por encima, contando lo que ya viene en camino.',
    },
    'sin-minimo': { titulo: 'Todo lo que se mueve tiene su mínimo', descripcion: 'Nada salió en 90 días sin stock mínimo.' },
    todos: {
      titulo: 'Todavía no hay materiales con stock de seguridad',
      descripcion: fija ? 'Fija el mínimo de lo que más rota desde «Sin mínimo».' : 'Almacén fija el mínimo de lo que más rota.',
    },
  }[vista]

  return (
    <>
      <EncabezadoPagina
        titulo="Reposición de stock"
        descripcion="Lo que está bajo su stock de seguridad y cuánto comprar, contando lo que ya viene en otra orden de compra."
        ayuda="«Hay» es la existencia del kardex; «libre», lo que no está separado para un requerimiento o una unidad. «En camino» es lo que una OC aprobada (o que no necesita aprobación) pidió y todavía no entró al kardex; debajo, lo que piden otras OC que todavía esperan a Gerencia. Las dos cuentan para no comprar dos veces. «Comprar» es la compra por mayor, o lo que falta para el mínimo si es más; con la compra por mayor vacía, lo que falta para el mínimo. Almacén fija el mínimo y la compra por mayor; cuando lo que hay baja del mínimo, el sistema avisa a Almacén y a Logística."
        migas={[{ titulo: 'Almacén' }, { titulo: 'Reposición de stock' }]}
      />

      {/* En el teléfono las cifras ya van en las pastillas de abajo: las tarjetas ocupaban media pantalla. */}
      {/* 20 px entre bloques, como dice la escala de la skill diseno (iban a 12 y 16). */}
      <div className="space-y-5">
      <div className="hidden gap-3 sm:grid sm:grid-cols-3" data-resumen-reposicion>
        <Indicador
          titulo="Por reponer"
          valor={porReponer.length}
          icono={ShieldAlert}
          tono={porReponer.length > 0 ? 'peligro' : 'neutro'}
          pie={porReponer.length === 1 ? 'material no llega al mínimo' : 'materiales no llegan al mínimo'}
          href={vista === 'reponer' ? undefined : conQ('/almacen/reposicion')}
        />
        <Indicador
          titulo="Ya en camino"
          valor={enCamino}
          icono={Truck}
          tono={enCamino > 0 ? 'acento' : 'neutro'}
          pie={enCamino === 1 ? 'material con mínimo viene en una OC, aprobada o por aprobar' : 'materiales con mínimo vienen en una OC, aprobada o por aprobar'}
        />
        <Indicador
          titulo="Sin mínimo"
          valor={sinMinimo.length}
          icono={PackageX}
          tono={sinMinimo.length > 0 ? 'aviso' : 'neutro'}
          pie="salieron en 90 días y no avisan si se acaban"
          href={vista === 'sin-minimo' ? undefined : conQ('/almacen/reposicion?vista=sin-minimo')}
        />
      </div>

      <Vistas
        etiqueta="Vista"
        vistas={VISTAS.map((v) => ({
          clave: v.valor,
          titulo: v.titulo,
          href: conQ(v.valor === 'reponer' ? '/almacen/reposicion' : `/almacen/reposicion?vista=${v.valor}`),
          activa: vista === v.valor,
          descripcion: v.descripcion,
          cuenta: v.valor === 'reponer' ? porReponer.length : v.valor === 'sin-minimo' ? sinMinimo.length : todos.length,
        }))}
      />

      <div className="max-w-md">
        <BuscadorSimple ruta="/almacen/reposicion" etiqueta="Buscar material" marcador="Código o descripción, por ejemplo disco" />
      </div>

      {compra && porReponer.length > 0 && (
        <p className="text-sm text-texto-suave">
          Lo que se repone se compra con una OC directa, para el almacén:{' '}
          <Link href="/compras/ordenes" className="font-medium text-acento hover:underline">
            Órdenes de compra
          </Link>
          .
        </p>
      )}

      {/* En el teléfono cada material es una ficha (la lista común, `apilada`,
          entrega 4 del plan de orden y diseño). Sus cifras van con el nombre a
          la izquierda y el número a la derecha, no con el rótulo encima: así se
          comparan de un vistazo y la ficha no dobla su alto. */}
      <Tarjeta className="overflow-hidden">
        <Tabla apilada>
          <TablaCabecera>
            <tr>
              <TH>Material</TH>
              <TH className="text-right">Hay</TH>
              <TH className="text-right">En camino</TH>
              <TH className="text-right">Mínimo</TH>
              {/* Desde 1280 px: a 768 y 1024 la tabla se salía de costado y cortaba
                  «Cambiar». Hasta ahí, la cifra baja a la celda del material. */}
              <TH className="hidden text-right xl:table-cell">Salió en 90 días</TH>
              <TH className="text-right">Comprar</TH>
              {fija && (
                <TH className="text-right">
                  <span className="sr-only">Stock de seguridad</span>
                </TH>
              )}
            </tr>
          </TablaCabecera>
          <tbody>
            {mostrados.length === 0 ? (
              <SinDatos titulo={vacio.titulo} descripcion={vacio.descripcion} />
            ) : (
              mostrados.map((m) => <Fila key={m.material_id} m={m} fija={fija} />)
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
      </div>
    </>
  )
}

/** Una cifra con su nombre en el teléfono, donde la fila va apilada y no hay cabecera. */
function Cifra({ nombre, children, className, desdeXl = false }: { nombre: string; children: React.ReactNode; className?: string; desdeXl?: boolean }) {
  return (
    <TD className={`flex items-baseline justify-between gap-3 ${desdeXl ? 'md:hidden xl:table-cell xl:text-right' : 'md:table-cell md:text-right'} ${className ?? ''}`}>
      <span className="text-xs text-texto-suave md:hidden">{nombre}</span>
      <span className="tabular text-right">{children}</span>
    </TD>
  )
}

function Fila({ m, fija }: { m: MaterialParaReponer; fija: boolean }) {
  const u = m.unidad ?? ''
  const almacen = m.almacen && esAlmacen(m.almacen) ? ALMACENES[m.almacen].etiqueta : 'Por clasificar'
  return (
    <TR data-material={m.codigo}>
      <TD>
        <p className="break-words text-texto">{m.descripcion}</p>
        <p className="text-xs text-texto-suave">
          <span className="font-mono">{m.codigo}</span> · {almacen}
          {m.categoria && m.categoria !== almacen ? ` · ${m.categoria}` : ''}
        </p>
        {bajoMinimo(m) && (
          <Insignia tono={m.comprar > 0 ? 'peligro' : 'aviso'} className="mt-1">
            {m.comprar > 0 ? 'Bajo el mínimo' : m.en_camino > 0 ? 'Bajo el mínimo, ya viene' : 'Bajo el mínimo, en una OC por aprobar'}
          </Insignia>
        )}
        {/* La columna «Salió en 90 días» no se ve de 768 a 1279 px. */}
        <p className="hidden text-xs text-texto-suave md:block xl:hidden">
          Salió en 90 días: <span className="tabular">{cantidad(m.salio_90_dias)} {u}</span>
        </p>
      </TD>
      <Cifra nombre="Hay">
        {cantidad(m.existencia)} {u}
        {m.libre < m.existencia && <span className="block text-xs text-texto-suave">libre {cantidad(m.libre)}</span>}
      </Cifra>
      <Cifra nombre="En camino">
        {m.en_camino > 0 || m.por_aprobar > 0 ? (
          <>
            {m.en_camino > 0 ? (
              <>
                {cantidad(m.en_camino)} {u}
                {m.en_camino_ocs && <span className="block text-xs break-words whitespace-normal text-texto-suave">{m.en_camino_ocs}</span>}
              </>
            ) : (
              <span className="text-texto-tenue">—</span>
            )}
            {m.por_aprobar > 0 && (
              <span className="block text-xs break-words whitespace-normal text-aviso" data-por-aprobar>
                y {cantidad(m.por_aprobar)} {u} por aprobar{m.por_aprobar_ocs ? ` en ${m.por_aprobar_ocs}` : ''}
              </span>
            )}
          </>
        ) : (
          <span className="text-texto-tenue">—</span>
        )}
      </Cifra>
      <Cifra nombre="Mínimo">
        {m.stock_minimo === null ? (
          <span className="text-texto-tenue">Sin mínimo</span>
        ) : (
          <>
            {cantidad(m.stock_minimo)} {u}
          </>
        )}
        {m.compra_por_mayor !== null && (
          <span className="block text-xs text-texto-suave">
            por mayor {cantidad(m.compra_por_mayor)} {u}
          </span>
        )}
      </Cifra>
      <Cifra nombre="Salió en 90 días" desdeXl>
        {cantidad(m.salio_90_dias)} {u}
      </Cifra>
      <Cifra nombre="Comprar" className="font-semibold">
        {m.comprar > 0 ? (
          <span className="text-peligro">
            {cantidad(m.comprar)} {u}
          </span>
        ) : (
          <span className="font-normal text-texto-tenue">—</span>
        )}
      </Cifra>
      {fija && (
        <TD className="md:text-right" data-rotulo="Stock de seguridad">
          <StockDeSeguridad
            materialId={m.material_id}
            descripcion={m.descripcion}
            unidad={m.unidad}
            minimo={m.stock_minimo}
            porMayor={m.compra_por_mayor}
            salio={m.salio_90_dias}
          />
        </TD>
      )}
    </TR>
  )
}
