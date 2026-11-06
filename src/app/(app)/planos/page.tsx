import { ListaDxf } from '@/components/codigo-interno/dxf'
import { ListaEtapas } from '@/components/codigo-interno/etapas'
import { ListaPlanos } from '@/components/codigo-interno/planos'
import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Paginacion } from '@/components/estructura/paginacion'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { codigosParaElegir } from '@/lib/datos/codigos-para-elegir'
import {
  areasParaEtapas,
  conEnlaceDeDescarga,
  dxfDeCodigo,
  etapasDeCodigo,
  otPorCodigo,
  planosDeCodigo,
  type DxfDeCodigo,
  type EtapaDeCodigo,
  type OtDeCodigo,
  type PlanoDeCodigo,
} from '@/lib/datos/diseno-codigos'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { llaveParecido } from '@/lib/dominio/codigos-internos'
import { enlaceSeguimientoCodigo } from '@/lib/dominio/diseno-codigos'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { nombreDeUnidadOCodigo } from '@/lib/dominio/unidades'
import { cantidad, hoyLima } from '@/lib/format'
import { exigirPermiso, puede, puedeHojaDeArea } from '@/lib/sesion'

import { FormularioEtapaDeArea, MarcarEtapa, MoverEtapa, QuitarEtapa, RecibirPlano, VentanaEtapaDeArea } from '../diseno/codigo/formularios'

export const metadata = { title: 'Planos y etapas' }

/**
 * Cuántos códigos se pintan por página. Cada tarjeta lleva sus botones, y con
 * mil códigos la página tardaba medio minuto en responder: un «Recibido»
 * tocado antes se perdía.
 */
const POR_PAGINA = 50

type DelCodigo = { planos: PlanoDeCodigo[]; etapas: EtapaDeCodigo[]; dxf: DxfDeCodigo[] }

const porRecibir = (c: DelCodigo) => c.planos.some((p) => !p.anulado_en && !p.recibido_en)
/** Diseño solo dejó los DXF, todavía sin planos ni etapas: es para empezar a cortar. */
const soloDxf = (c: DelCodigo) => c.dxf.length > 0 && c.etapas.length === 0 && !c.planos.some((p) => !p.anulado_en)
/** Le falta algo al área: un plano por recibir, una etapa sin terminar o los DXF para cortar. */
const porHacer = (c: DelCodigo) => porRecibir(c) || c.etapas.some((e) => !e.fin_real) || soloDxf(c)
/** Lo que ya corre: el plano por recibir, la etapa empezada o con fecha puesta, o los DXF. */
const enMarcha = (c: DelCodigo) => porRecibir(c) || soloDxf(c) || c.etapas.some((e) => !e.fin_real && (e.inicio_real || e.inicio_plan))

/** «OT 2898 · placa · cliente»: la unidad como en «Unidades en taller». */
function deQueOt(codigo: string, ot: OtDeCodigo | undefined): string | undefined {
  if (!ot) return undefined
  return [`OT ${ot.numero} (${definir(ESTADO_OT, ot.estado).etiqueta.toLowerCase()})`, ot.unidad ? nombreDeUnidadOCodigo(ot.unidad, codigo) : null, ot.cliente]
    .filter(Boolean)
    .join(' · ')
}
/** Cuándo terminó el área con el código: lo último que recibió o terminó. */
const terminadoEn = (c: DelCodigo) =>
  [...c.planos.map((p) => (p.anulado_en ? null : p.recibido_en)), ...c.etapas.map((e) => e.fin_real)].reduce<string>(
    (ultimo, f) => (f && f > ultimo ? f : ultimo),
    '',
  )

/**
 * Lo que Diseño le dejó al área, por código interno: los planos que van a su
 * área, para abrirlos y marcar que los recibió, las etapas que hace su área,
 * para marcar cuándo empezó y cuándo terminó y agregarles sus subetapas, y a
 * Maestranza los DXF para cortar. Cada área agrega también sus propias etapas
 * (observaciones de Diseño, 2026-11-06). Desde el 2026-10-15 el supervisor
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
  const q = typeof params.q === 'string' ? params.q.trim() : ''
  // Como en Códigos internos: sin tildes ni orden de palabras, y «0» por «O».
  const palabras = palabrasDeBusqueda(q)
  const llave = llaveParecido(q)
  const buscado = (codigo: string) => !q || coincide(palabras, [codigo]) || (llave !== '' && llaveParecido(codigo).includes(llave))
  // También por la OT y el cliente, que la tarjeta muestra.
  const buscadoPorOt = (codigo: string) => {
    const ot = ots.get(codigo)
    return Boolean(q && ot && coincide(palabras, [ot.numero, ot.cliente]))
  }
  const hoy = hoyLima()

  const [planos, todasLasEtapas, dxf, ots, codigosConocidos, todasLasAreas] = await Promise.all([
    planosDeCodigo(null),
    etapasDeCodigo(null),
    // La base solo se los da a Maestranza (`puede_ver_dxf`): para las demás áreas sale vacío.
    dxfDeCodigo(null, { conEnlace: false }),
    otPorCodigo(),
    codigosParaElegir(),
    areasParaEtapas(),
  ])
  const misAreas = todasLasAreas.filter((a) => puedeHojaDeArea(perfil, a.id))

  // Lo de cada código, juntado de una pasada: buscarlo en las listas enteras por
  // cada código se nota con cientos de códigos.
  const delCodigo = new Map<string, DelCodigo>()
  const de = (codigo: string) => {
    const hay = delCodigo.get(codigo)
    if (hay) return hay
    const nuevo: DelCodigo = { planos: [], etapas: [], dxf: [] }
    delCodigo.set(codigo, nuevo)
    return nuevo
  }
  for (const p of planos) de(p.codigo).planos.push(p)
  for (const e of todasLasEtapas) if (e.area_id !== null && puedeHojaDeArea(perfil, e.area_id)) de(e.codigo).etapas.push(e)
  for (const d of dxf) de(d.codigo).dxf.push(d)

  // Un código con solo planos anulados no le deja nada al área.
  const codigos = [...delCodigo.entries()]
    .filter(([codigo, c]) => (c.etapas.length > 0 || c.dxf.length > 0 || c.planos.some((p) => !p.anulado_en)) && (buscado(codigo) || buscadoPorOt(codigo)))
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
  const enPagina = lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  // El enlace de descarga solo de los DXF que se van a ver.
  const firmados = new Map((await conEnlaceDeDescarga(enPagina.flatMap(([, c]) => c.dxf))).map((d) => [d.id, d]))
  const mostrar = enPagina.map(([codigo, c]) => [codigo, { ...c, dxf: c.dxf.map((d) => firmados.get(d.id) ?? d) }] as const)
  const cualquierArea = puede(perfil, 'produccion.cualquier_area')
  // Para la etapa propia: las unidades que el sistema conoce, con su OT y su placa.
  const opcionesDeCodigo = (codigosConocidos ?? [])
    .filter((c) => !c.cerrado)
    .map((c) => ({ valor: c.codigo, etiqueta: c.codigo, detalle: deQueOt(c.codigo, ots.get(c.codigo)) ?? c.unidad ?? undefined }))

  const vacio = q
    ? { titulo: 'Ningún código con esta búsqueda', texto: 'Mira en las otras pestañas o borra la búsqueda con «Limpiar».' }
    : vista === 'por-recibir'
      ? { titulo: 'Nada por recibir', texto: 'Recibiste todos los planos vigentes. Vuelve a lo que falta hacer con «Por hacer».' }
      : vista === 'terminados'
        ? { titulo: 'Ningún código terminado todavía', texto: 'Aquí pasa el código con todos sus planos recibidos y sus etapas terminadas.' }
        : terminados.length > 0
          ? { titulo: 'Nada por hacer', texto: 'Recibiste todos los planos y terminaste todas las etapas. Los códigos están en «Terminados».' }
          : { titulo: 'Diseño todavía no te dejó planos ni etapas', texto: 'Cuando Diseño cargue un plano o una etapa para tu área te llega el aviso, y aparece aquí.' }

  return (
    <>
      <EncabezadoPagina
        titulo="Planos y etapas"
        ayuda={`Los planos que Diseño cargó para ${cualquierArea ? 'cada área' : 'tu área'} en cada código interno: ábrelos y marca «Recibido». Y las etapas que hace ${cualquierArea ? 'cada área' : 'tu área'}: agrégales sus subetapas y marca cuándo empezó y cuándo terminó cada una. Maestranza descarga aquí los DXF. Cuando un código tiene todos sus planos recibidos y sus etapas terminadas, pasa a «Terminados».`}
        migas={[{ titulo: 'Supervisión' }, { titulo: 'Planos y etapas' }]}
      />

      <div className="mb-4 space-y-3">
        <BuscadorSimple ruta="/planos" etiqueta="Buscar código interno" marcador="Código, OT o cliente" />
        <PastillaFiltro
          ruta="/planos"
          clave="ver"
          params={params}
          activo={vista}
          etiqueta="Qué códigos mostrar"
          opciones={[
            { valor: null, etiqueta: `Por hacer (${cantidad(abiertos.length)})` },
            { valor: 'por-recibir', etiqueta: `Con planos por recibir (${cantidad(conPorRecibir.length)})` },
            { valor: 'terminados', etiqueta: `Terminados (${cantidad(terminados.length)})` },
          ]}
        />
      </div>

      {misAreas.length > 0 && (
        <details className="mb-4 rounded-[var(--radius-base)] border border-borde bg-superficie">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-texto">Agregar una etapa de {misAreas.length === 1 ? misAreas[0].nombre : 'un área'}</summary>
          <div className="space-y-2 border-t border-borde p-4">
            <p className="text-sm text-texto-suave">
              Una etapa de tu área para una unidad, después o en paralelo a las que puso Diseño. Para dividir la etapa de Diseño, usa «Subetapa» en ella.
            </p>
            <FormularioEtapaDeArea codigos={opcionesDeCodigo} areas={misAreas} />
          </div>
        </details>
      )}

      {mostrar.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">{vacio.titulo}</p>
            <p className="text-sm text-texto-suave">{vacio.texto}</p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-4">
          {mostrar.map(([codigo, { planos: deCodigo, etapas: susEtapas, dxf: susDxf }]) => (
            <li key={codigo} data-codigo={codigo}>
              <Tarjeta>
                <TarjetaCabecera
                  titulo={<span className="font-mono break-all">{codigo}</span>}
                  descripcion={deQueOt(codigo, ots.get(codigo))}
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
                        acciones={(e, lugar) => (
                          <>
                            <MarcarEtapa etapa={e} hoy={hoy} />
                            {/* Debajo de cualquier etapa de arriba de su área, el supervisor pone sus subetapas. */}
                            {!e.padre_id && <VentanaEtapaDeArea padre={{ id: e.id, nombre: e.nombre }} />}
                            {/* Lo que agregó el área lo corrige, lo mueve y lo quita su supervisor; lo de Diseño, Diseño. */}
                            {(e.de_area || e.padre_id) && (
                              <>
                                <MoverEtapa id={e.id} nombre={e.nombre} primera={lugar.primera} ultima={lugar.ultima} />
                                <VentanaEtapaDeArea etapa={e} />
                                {lugar.subetapas.length === 0 && <QuitarEtapa id={e.id} nombre={e.nombre} />}
                              </>
                            )}
                          </>
                        )}
                        conPlanosConPeso={deCodigo.some((p) => !p.anulado_en && (p.peso ?? 0) > 0)}
                      />
                    </section>
                  )}
                  {susDxf.length > 0 && (
                    <section aria-label="DXF para cortar">
                      <h3 className="mb-2 text-sm font-semibold text-texto">DXF para cortar</h3>
                      <ListaDxf archivos={susDxf} />
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
