import { ListaEtapas } from '@/components/codigo-interno/etapas'
import { ListaPlanos } from '@/components/codigo-interno/planos'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { etapasDeCodigo, planosDeCodigo } from '@/lib/datos/diseno-codigos'
import { enlaceSeguimientoCodigo } from '@/lib/dominio/diseno-codigos'
import { hoyLima } from '@/lib/format'
import { exigirPermiso, puede, puedeHojaDeArea } from '@/lib/sesion'

import { MarcarEtapa, RecibirPlano } from '../diseno/codigo/formularios'

export const metadata = { title: 'Planos y etapas' }

/**
 * Lo que Diseño le dejó al área, por código interno: los planos que van a su
 * área, para abrirlos y marcar que los recibió, y las etapas que hace su área,
 * para marcar cuándo empezó y cuándo terminó. Desde el 2026-10-15 el supervisor
 * ya no abre la OT: los materiales y lo pedido de cada código los ve en
 * «Materiales y pedidos». El supervisor ve solo lo de su
 * área (la base lo filtra); con `produccion.cualquier_area`, el de todas.
 */
export default async function PaginaPlanosDelArea({ searchParams }: PageProps<'/planos'>) {
  const perfil = await exigirPermiso('codigos_internos.area')
  const params = await searchParams
  const soloPorRecibir = params.ver === 'por-recibir'
  const hoy = hoyLima()

  const [planos, todasLasEtapas] = await Promise.all([planosDeCodigo(null), etapasDeCodigo(null)])
  const etapas = todasLasEtapas.filter((e) => e.area_id !== null && puedeHojaDeArea(perfil, e.area_id))
  const vigentes = planos.filter((p) => !p.anulado_en)
  const porRecibir = vigentes.filter((p) => !p.recibido_en)

  // Primero los códigos con algo por recibir o una etapa abierta; después los demás.
  const codigos = [...new Set([...vigentes.map((p) => p.codigo), ...etapas.map((e) => e.codigo)])]
  const pendiente = (c: string) =>
    porRecibir.some((p) => p.codigo === c) || etapas.some((e) => e.codigo === c && !e.fin_real && (e.inicio_real || e.inicio_plan))
  const orden = [...codigos.filter(pendiente), ...codigos.filter((c) => !pendiente(c))]
  const mostrar = soloPorRecibir ? orden.filter((c) => porRecibir.some((p) => p.codigo === c)) : orden
  const todasLasAreas = puede(perfil, 'produccion.cualquier_area')

  return (
    <>
      <EncabezadoPagina
        titulo="Planos y etapas"
        ayuda={`Los planos que Diseño cargó para ${todasLasAreas ? 'cada área' : 'tu área'} en cada código interno: ábrelos y marca «Recibido». Y las etapas que hace ${todasLasAreas ? 'cada área' : 'tu área'}: marca cuándo empezó y cuándo terminó.`}
        migas={[{ titulo: 'Supervisión' }, { titulo: 'Planos y etapas' }]}
      />

      <PastillaFiltro
        ruta="/planos"
        clave="ver"
        params={params}
        activo={soloPorRecibir ? 'por-recibir' : null}
        etiqueta="Qué códigos mostrar"
        opciones={[
          { valor: null, etiqueta: `Todos (${codigos.length})` },
          { valor: 'por-recibir', etiqueta: `Con planos por recibir (${new Set(porRecibir.map((p) => p.codigo)).size})` },
        ]}
        className="mb-4"
      />

      {mostrar.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">{soloPorRecibir ? 'Nada por recibir' : 'Diseño todavía no te dejó planos ni etapas'}</p>
            <p className="text-sm text-texto-suave">
              {soloPorRecibir
                ? 'Recibiste todos los planos vigentes. Quita el filtro con «Todos» para verlos.'
                : 'Cuando Diseño cargue un plano para tu área te llega el aviso, y aparece aquí.'}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-4">
          {mostrar.map((codigo) => {
            const deCodigo = planos.filter((p) => p.codigo === codigo)
            const susEtapas = etapas.filter((e) => e.codigo === codigo)
            return (
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
            )
          })}
        </ul>
      )}
    </>
  )
}
