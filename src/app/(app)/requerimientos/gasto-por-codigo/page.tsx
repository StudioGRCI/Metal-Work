import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { listarGastoPorCodigo, type GastoDeCodigo } from '@/lib/datos/gasto-por-codigo'
import { enlaceGastoCodigo, faltaElPrecio, llaveParecido, parecidos } from '@/lib/dominio/codigos-internos'
import { fecha, moneda, parteDe, porcentaje } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

export const metadata = { title: 'Gasto por código interno' }

const conGasto = (c: GastoDeCodigo) => c.salidas > 0 || c.compras > 0
const sinPrecio = (c: GastoDeCodigo) => c.materiales_sin_precio > 0 || c.compras_sin_precio > 0

/** Los filtros de la lista. «Parecidos» es lo que conviene revisar: el mismo código escrito de dos maneras. */
const FILTROS: Record<string, (c: GastoDeCodigo, parecido: boolean) => boolean> = {
  gasto: (c) => conGasto(c),
  'sin-precio': (c) => sinPrecio(c),
  parecidos: (_, parecido) => parecido,
}

/**
 * Lo que se lleva gastado en cada código interno, para el área que pide los
 * insumos: lo que salió del almacén a su precio y, aparte, lo que se compró.
 * Sin la mano de obra, que es de RR. HH. y Gerencia.
 */
export default async function PaginaGastoPorCodigo({ searchParams }: PageProps<'/requerimientos/gasto-por-codigo'>) {
  await exigirPermiso('codigos_internos.gasto')
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim() : ''
  const filtro = typeof params.ver === 'string' && params.ver in FILTROS ? params.ver : null

  const todos = await listarGastoPorCodigo()
  // Los parecidos se buscan entre todos, no solo entre los que deja la búsqueda.
  const parecidosDe = parecidos(todos.map((c) => c.codigo))
  const llave = llaveParecido(q)
  const buscados = q ? todos.filter((c) => c.codigo.includes(q.toUpperCase()) || (llave && llaveParecido(c.codigo).includes(llave))) : todos
  const cuantos = (clave: string) => buscados.filter((c) => FILTROS[clave](c, parecidosDe.has(c.codigo))).length
  const codigos = filtro ? buscados.filter((c) => FILTROS[filtro](c, parecidosDe.has(c.codigo))) : buscados

  const materiales = codigos.reduce((n, c) => n + c.materiales_pen, 0)
  const dolares = codigos.reduce((n, c) => n + c.materiales_usd, 0)
  const compras = codigos.reduce((n, c) => n + c.compras_pen, 0)

  return (
    <>
      <EncabezadoPagina
        titulo="Gasto por código interno"
        ayuda="Lo que salió del almacén para cada código interno, a su precio, y lo que se compró con ese código. Las compras se muestran aparte y no se suman: lo comprado entra al almacén y se cuenta cuando sale para el código. La mano de obra no está aquí: la llevan RR. HH. y Gerencia."
        migas={[{ titulo: 'Requerimientos', ruta: '/requerimientos' }, { titulo: 'Gasto por código' }]}
      />

      <div className="mb-3 space-y-3">
        <BuscadorSimple ruta="/requerimientos/gasto-por-codigo" etiqueta="Buscar código interno" marcador="Código interno, por ejemplo SR_04" />
        <PastillaFiltro
          ruta="/requerimientos/gasto-por-codigo"
          clave="ver"
          params={params}
          activo={filtro}
          etiqueta="Qué códigos mostrar"
          opciones={[
            { valor: null, etiqueta: `Todos (${buscados.length})` },
            { valor: 'gasto', etiqueta: `Con gasto (${cuantos('gasto')})` },
            { valor: 'sin-precio', etiqueta: `Con algo sin precio (${cuantos('sin-precio')})` },
            { valor: 'parecidos', etiqueta: `Parecidos a otro (${cuantos('parecidos')})` },
          ]}
        />
        <p className="text-xs text-texto-suave">
          <span className="tabular">{codigos.length}</span> {codigos.length === 1 ? 'código' : 'códigos'} ·{' '}
          <span className="tabular">{moneda(materiales)}</span>
          {dolares > 0 && (
            <>
              {' '}
              + <span className="tabular">{moneda(dolares, 'USD')}</span>
            </>
          )}{' '}
          en materiales · <span className="tabular">{moneda(compras)}</span> en compras sin IGV, aparte
        </p>
      </div>

      {codigos.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">
              {todos.length === 0 ? 'Todavía no hay códigos internos con gasto' : 'Ningún código con esta búsqueda o filtro'}
            </p>
            <p className="text-sm text-texto-suave">
              {todos.length === 0
                ? 'Aparecen aquí apenas un requerimiento, una salida del almacén o una orden de compra lleva uno.'
                : 'Borra la búsqueda con «Limpiar» o quita el filtro con «Todos».'}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-3">
          {codigos.map((c) => (
            <li key={c.codigo}>
              <FilaGasto codigo={c} parecidos={parecidosDe.get(c.codigo) ?? []} total={materiales} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

function FilaGasto({ codigo: c, parecidos, total }: { codigo: GastoDeCodigo; parecidos: string[]; total: number }) {
  // Qué parte del total de materiales en soles es este código (DKS, 27/10/2026: porcentaje y costo).
  const parte = c.materiales_pen > 0 ? parteDe(c.materiales_pen, total) : null
  const donde = [
    c.requerimientos > 0 && plural(c.requerimientos, 'RQ', 'RQ'),
    c.salidas > 0 && plural(c.salidas, 'salida del almacén', 'salidas del almacén'),
    c.compras > 0 && plural(c.compras, 'OC', 'OC'),
  ].filter(Boolean)
  return (
    <Link
      href={enlaceGastoCodigo(c.codigo)}
      className="block rounded-[var(--radius-base)] border border-borde bg-superficie p-4 hover:border-acento"
      data-codigo={c.codigo}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono font-semibold break-all text-texto">{c.codigo}</p>
          <p className="text-xs text-texto-suave">
            {donde.length > 0 ? donde.join(' · ') : 'Solo en requerimientos anulados'}
            {c.ultima_actividad && ` · último movimiento el ${fecha(c.ultima_actividad)}`}
          </p>
        </div>
        <div className="text-right">
          <p className="tabular font-semibold text-texto">
            {faltaElPrecio(c.materiales_pen + c.materiales_usd, c.materiales_sin_precio) ?? moneda(c.materiales_pen)}
          </p>
          {c.materiales_usd > 0 && <p className="tabular text-xs text-texto">+ {moneda(c.materiales_usd, 'USD')}</p>}
          <p className="text-xs text-texto-suave">en materiales{parte !== null ? ` · ${porcentaje(parte)} del total` : ''}</p>
        </div>
      </div>

      {parecidos.length > 0 && (
        <p className="mt-1 text-xs text-aviso">
          Se escribe casi igual que <span className="font-mono">{parecidos.join(', ')}</span>: ¿es el mismo código?
        </p>
      )}

      {(c.compras > 0 || c.materiales_sin_precio > 0 || c.compras_sin_precio > 0) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-texto-suave">
          {c.compras > 0 && (
            <span>
              Compras <span className="tabular text-texto">{moneda(c.compras_pen)}</span>
              {c.compras_usd > 0 && <span className="tabular text-texto"> + {moneda(c.compras_usd, 'USD')}</span>} sin IGV, aparte
            </span>
          )}
          {c.materiales_sin_precio > 0 && (
            <Insignia tono="aviso">
              {c.materiales_sin_precio} {c.materiales_sin_precio === 1 ? 'salida sin precio' : 'salidas sin precio'}
            </Insignia>
          )}
          {c.compras_sin_precio > 0 && (
            <Insignia tono="aviso">
              {c.compras_sin_precio} {c.compras_sin_precio === 1 ? 'línea de OC sin precio' : 'líneas de OC sin precio'}
            </Insignia>
          )}
        </p>
      )}
    </Link>
  )
}
