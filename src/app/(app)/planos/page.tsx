import { ListaEtapas } from '@/components/codigo-interno/etapas'
import { ListaPlanos } from '@/components/codigo-interno/planos'
import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Paginacion } from '@/components/estructura/paginacion'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { etapasDeCodigo, planosDeCodigo, type EtapaDeCodigo, type PlanoDeCodigo } from '@/lib/datos/diseno-codigos'
import { enlaceSeguimientoCodigo } from '@/lib/dominio/diseno-codigos'
import { hoyLima } from '@/lib/format'
import { exigirPermiso, puede, puedeHojaDeArea } from '@/lib/sesion'

import { MarcarEtapa, RecibirPlano } from '../diseno/codigo/formularios'

export const metadata = { title: 'Planos y etapas' }

/**
 * Cuántos códigos se pintan por página. Cada tarjeta lleva sus botones, y con
 * mil códigos la página tardaba medio minuto en responder: un «Recibido»
 * tocado antes se perdía.
 */
const POR_PAGINA = 50

type DelCodigo = { planos: PlanoDeCodigo[]; etapas: EtapaDeCodigo[] }

const porRecibir = (c: DelCodigo) => c.planos.some((p) => !p.anulado_en && !p.recibido_en)
/** Le falta algo al área: un plano por recibir o una etapa sin terminar. */
const porHacer = (c: DelCodigo) => porRecibir(c) || c.etapas.some((e) => !e.fin_real)
/** Lo que ya corre: el plano por recibir, o la etapa empezada o con fecha puesta. */
const enMarcha = (c: DelCodigo) => porRecibir(c) || c.etapas.some((e) => !e.fin_real && (e.inicio_real || e.inicio_plan))
/** Cuándo terminó el área con el código: lo último que recibió o terminó. */
const terminadoEn = (c: DelCodigo) =>
  [...c.planos.map((p) => (p.anulado_en ? null : p.recibido_en)), ...c.etapas.map((e) => e.fin_real)].reduce<string>(
    (ultimo, f) => (f && f > ultimo ? f : ultimo),
    '',
  )

/**
 * Lo que Diseño le dejó al área, por código interno: los planos que van a su
 * área, para abrirlos y marcar que los recibió, y las etapas que hace su área,
 * para marcar cuándo empezó y cuándo terminó. Desde el 2026-10-15 el supervisor
 * ya no abre la OT: los materiales y lo pedido de cada código los ve en
 * «Materiales y pedidos». El supervisor ve solo lo de su
 * área (la base lo filtra); con `produccion.cualquier_area`, el de todas.
 *
 * De entrada salen solo los códigos con algo por hacer; los que ya tienen todo
 * recibido y terminado van aparte, en «Terminados» (pedido de DKS, 2026-10-20).
 */
export default async function PaginaPlanosDelArea({ searchParams }: PageProps<'/planos'>) {
  const perfil = await exigirPermiso('codigos_internos.area')
  const params = await searchParams
  const vista = params.ver === 'por-recibir' || params.ver === 'terminados' ? params.ver : null
  const q = typeof params.q === 'string' ? params.q.trim().toUpperCase() : ''
  const hoy = hoyLima()

  const [planos, todasLasEtapas] = await Promise.all([planosDeCodigo(null), etapasDeCodigo(null)])

  // Lo de cada código, juntado de una pasada: buscarlo en las listas enteras por
  // cada código se nota con cientos de códigos.
  const delCodigo = new Map<string, DelCodigo>()
  const de = (codigo: string) => {
    const hay = delCodigo.get(codigo)
    if (hay) return hay
    const nuevo: DelCodigo = { planos: [], etapas: [] }
    delCodigo.set(codigo, nuevo)
    return nuevo
  }
  for (const p of planos) de(p.codigo).planos.push(p)
  for (const e of todasLasEtapas) if (e.area_id !== null && puedeHojaDeArea(perfil, e.area_id)) de(e.codigo).etapas.push(e)

  // Un código con solo planos anulados no le deja nada al área.
  const codigos = [...delCodigo.entries()]
    .filter(([codigo, c]) => (c.etapas.length > 0 || c.planos.some((p) => !p.anulado_en)) && (!q || codigo.includes(q)))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  // Primero lo que ya corre; después lo que todavía no tiene fecha.
  const abiertos = [...codigos.filter(([, c]) => enMarcha(c)), ...codigos.filter(([, c]) => porHacer(c) && !enMarcha(c))]
  // Lo último que se terminó, arriba.
  const terminados = codigos
    .filter(([, c]) => !porHacer(c))
    .map(([codigo, c]) => [codigo, c, terminadoEn(c)] as const)
    .sort((a, b) => (a[2] < b[2] ? 1 : a[2] > b[2] ? -1 : 0))
    .map(([codigo, c]) => [codigo, c] as const)
  const conPorRecibir = abiertos.filter(([, c]) => porRecibir(c))

  const lista = vista === 'terminados' ? terminados : vista === 'por-recibir' ? conPorRecibir : abiertos
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA))
  const pagina = Math.min(Math.max(1, Math.trunc(Number(params.pagina)) || 1), paginas)
  const mostrar = lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  const todasLasAreas = puede(perfil, 'produccion.cualquier_area')

  const vacio = q
    ? { titulo: 'Ningún código con esta búsqueda', texto: 'Mira en las otras pestañas o borra la búsqueda con «Limpiar».' }
    : vista === 'por-recibir'
      ? { titulo: 'Nada por recibir', texto: 'Recibiste todos los planos vigentes. Vuelve a lo que falta hacer con «Por hacer».' }
      : vista === 'terminados'
        ? { titulo: 'Ningún código terminado todavía', texto: 'Aquí pasa el código con todos sus planos recibidos y sus etapas terminadas.' }
        : terminados.length > 0
          ? { titulo: 'Nada por hacer', texto: 'Recibiste todos los planos y terminaste todas las etapas. Los códigos están en «Terminados».' }
          : { titulo: 'Diseño todavía no te dejó planos ni etapas', texto: 'Cuando Diseño cargue un plano para tu área te llega el aviso, y aparece aquí.' }

  return (
    <>
      <EncabezadoPagina
        titulo="Planos y etapas"
        ayuda={`Los planos que Diseño cargó para ${todasLasAreas ? 'cada área' : 'tu área'} en cada código interno: ábrelos y marca «Recibido». Y las etapas que hace ${todasLasAreas ? 'cada área' : 'tu área'}: marca cuándo empezó y cuándo terminó. Cuando un código tiene todos sus planos recibidos y sus etapas terminadas, pasa a «Terminados».`}
        migas={[{ titulo: 'Supervisión' }, { titulo: 'Planos y etapas' }]}
      />

      <div className="mb-4 space-y-3">
        <BuscadorSimple ruta="/planos" etiqueta="Buscar código interno" marcador="Código interno" />
        <PastillaFiltro
          ruta="/planos"
          clave="ver"
          params={params}
          activo={vista}
          etiqueta="Qué códigos mostrar"
          opciones={[
            { valor: null, etiqueta: `Por hacer (${abiertos.length})` },
            { valor: 'por-recibir', etiqueta: `Con planos por recibir (${conPorRecibir.length})` },
            { valor: 'terminados', etiqueta: `Terminados (${terminados.length})` },
          ]}
        />
      </div>

      {mostrar.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">{vacio.titulo}</p>
            <p className="text-sm text-texto-suave">{vacio.texto}</p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-4">
          {mostrar.map(([codigo, { planos: deCodigo, etapas: susEtapas }]) => (
            <li key={codigo} data-codigo={codigo}>
              <Tarjeta>
                <TarjetaCabecera
                  titulo={<span className="font-mono break-all">{codigo}</span>}
                  acciones={
                    // Lo que Diseño puso en la lista y lo que las áreas pidieron por RQ para este código.
                    <EnlaceBoton href={enlaceSeguimientoCodigo(codigo, 'materiales')} variante="secundario" tamano="sm">
                      Materiales y pedidos
                    </EnlaceBoton>
                  }
                />
                <TarjetaCuerpo className="space-y-4">
                  {deCodigo.length > 0 && (
                    <ListaPlanos
                      planos={deCodigo}
                      acciones={(p) =>
                        !p.anulado_en && !p.recibido_en && p.revision_id ? <RecibirPlano revision={p.revision_id} numero={p.numero} /> : null
                      }
                    />
                  )}
                  {susEtapas.length > 0 && (
                    <section aria-label="Etapas de tu área">
                      <h3 className="mb-2 text-sm font-semibold text-texto">{susEtapas.length === 1 ? 'Etapa' : 'Etapas'}</h3>
                      <ListaEtapas
                        etapas={susEtapas}
                        hoy={hoy}
                        acciones={(e) => <MarcarEtapa etapa={e} hoy={hoy} />}
                        conPlanosConPeso={deCodigo.some((p) => !p.anulado_en && (p.peso ?? 0) > 0)}
                      />
                    </section>
                  )}
                </TarjetaCuerpo>
              </Tarjeta>
            </li>
          ))}
        </ul>
      )}

      <Paginacion ruta="/planos" pagina={pagina} paginas={paginas} total={lista.length} porPagina={POR_PAGINA} params={params} />
    </>
  )
}
