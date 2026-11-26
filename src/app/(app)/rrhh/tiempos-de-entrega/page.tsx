import { Users } from 'lucide-react'
import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Paginacion } from '@/components/estructura/paginacion'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { codigosConTiempos, ultimaRevisionDeAvisos, type CodigoConTiempos } from '@/lib/datos/tiempos-entrega'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { llaveParecido } from '@/lib/dominio/codigos-internos'
import { FILTROS_DE_TIEMPOS, RUTA_TIEMPOS, SEMAFORO_DE_CODIGO, enlaceDeTiempos, plazoEnPalabras } from '@/lib/dominio/tiempos-entrega'
import { fecha, fechaHora, hoyLima, sumarDias } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

export const metadata = { title: 'Tiempos de entrega' }

const POR_PAGINA = 50

const AYUDA =
  'Cada código interno que todavía no se entrega, con la fecha de entrega al cliente de su OT, la etapa en que va y su semáforo: rojo si una etapa o la entrega ya venció, ámbar si vence hoy o en 3 días hábiles o menos, verde si va a tiempo. Las fechas de cada etapa las pone Diseño y las marca el supervisor del área; aquí se consultan. Cada día laborable a las 7:00 a. m. el sistema avisa en la campana a Recursos Humanos y al supervisor del área cuando una etapa pasa a ámbar y cuando vence, y la recuerda cada 2 días hábiles mientras siga vencida; a Gerencia, cuando vence y con un resumen los lunes. La fecha de entrega al cliente avisa igual a Recursos Humanos, y a Gerencia cuando vence. El código cuya única OT se anuló sale del tablero.'

/**
 * El tablero de tiempos de entrega que lleva Recursos Humanos (DKS,
 * 2026-11-25): un renglón por código sin entregar, lo vencido primero. Solo
 * lectura; el semáforo lo decide la base con días hábiles.
 */
export default async function PaginaTiemposDeEntrega({ searchParams }: PageProps<'/rrhh/tiempos-de-entrega'>) {
  await exigirPermiso('rrhh.tiempos_entrega')
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim() : ''
  const filtro = FILTROS_DE_TIEMPOS.find((f) => f.valor === params.ver) ?? null
  const areaPedida = typeof params.area === 'string' ? params.area : ''

  const [todos, revision] = await Promise.all([codigosConTiempos(), ultimaRevisionDeAvisos()])
  const hoy = hoyLima()
  // Corre y se anota todos los días a las 7:00 a. m., también el feriado (que no
  // avisa): si ayer no corrió, se cayó. Antes de las 7:00 la última es la de ayer.
  const revisionAtrasada = !revision || sumarDias(revision.fecha, 1) < hoy

  const llave = llaveParecido(q)
  const palabras = palabrasDeBusqueda(q)
  const buscados = q
    ? todos.filter(
        (c) =>
          c.codigo.includes(q.toUpperCase()) ||
          (llave && llaveParecido(c.codigo).includes(llave)) ||
          coincide(palabras, [c.codigo, c.unidad, c.ot_numero, c.cliente]),
      )
    : todos
  // Las áreas que tienen algo en curso: solo esas se ofrecen como filtro.
  const areas = [...new Set(buscados.map((c) => c.area_en_curso).filter((a): a is string => Boolean(a)))].sort((a, b) => a.localeCompare(b))
  const area = areas.includes(areaPedida) ? areaPedida : ''
  const delArea = area ? buscados.filter((c) => c.area_en_curso === area) : buscados
  const codigos = filtro ? delArea.filter((c) => c.semaforo === filtro.semaforo) : delArea
  const cuantos = (semaforo: string) => delArea.filter((c) => c.semaforo === semaforo).length
  const paginas = Math.max(1, Math.ceil(codigos.length / POR_PAGINA))
  const pagina = Math.min(Math.max(1, Math.trunc(Number(params.pagina)) || 1), paginas)
  const enPagina = codigos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  const sinEtapas = todos.filter((c) => c.etapas === 0).length
  // Los indicadores filtran sin soltar la búsqueda ni el área puestas.
  const ver = (valor: string) => {
    const query = new URLSearchParams({ ...(q ? { q } : {}), ...(area ? { area } : {}), ver: valor })
    return `${RUTA_TIEMPOS}?${query}`
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Tiempos de entrega"
        descripcion={
          todos.length > 0
            ? `${todos.length} ${todos.length === 1 ? 'código sin entregar' : 'códigos sin entregar'}${sinEtapas > 0 ? ` · ${sinEtapas} sin etapas cargadas` : ''}`
            : undefined
        }
        ayuda={AYUDA}
        migas={[{ titulo: 'Recursos Humanos' }, { titulo: 'Tiempos de entrega' }]}
        acciones={
          <EnlaceBoton href={`${RUTA_TIEMPOS}/personas`} variante="secundario">
            <Users aria-hidden className="size-4" />
            Por persona
          </EnlaceBoton>
        }
      />

      <p className={`mb-3 text-sm ${revisionAtrasada ? 'text-peligro' : 'text-texto-suave'}`} data-revision-avisos={revision?.fecha ?? ''}>
        {revision
          ? // La hora ya termina en «a. m.» o «p. m.»: sin otro punto.
            `Avisos automáticos: la última revisión fue el ${fechaHora(revision.hora)}${revisionAtrasada ? ' No corre desde entonces: los avisos no están saliendo.' : ''}`
          : 'Avisos automáticos: la revisión diaria todavía no corrió. Los avisos salen desde su primera corrida, a las 7:00 a. m.'}
      </p>

      {todos.length > 0 && (
        // En el teléfono no van: repiten el filtro de abajo y dejaban la lista fuera de la vista.
        <div className="mb-4 hidden grid-cols-2 gap-3 sm:grid lg:grid-cols-4">
          <Indicador
            titulo="Vencidos"
            valor={String(cuantos('ROJO'))}
            tono={cuantos('ROJO') > 0 ? 'peligro' : 'neutro'}
            pie="Una etapa o la entrega ya pasó"
            href={ver('vencidos')}
          />
          <Indicador
            titulo="Por vencer"
            valor={String(cuantos('AMBAR'))}
            tono={cuantos('AMBAR') > 0 ? 'aviso' : 'neutro'}
            pie="Hoy o en 3 días hábiles"
            href={ver('por-vencer')}
          />
          <Indicador titulo="A tiempo" valor={String(cuantos('VERDE'))} tono={cuantos('VERDE') > 0 ? 'exito' : 'neutro'} pie="Más de 3 días hábiles" href={ver('a-tiempo')} />
          <Indicador titulo="Sin fechas" valor={String(cuantos('SIN_FECHA'))} pie="Falta la de la OT o las de Diseño" href={ver('sin-fechas')} />
        </div>
      )}

      <div className="mb-3 space-y-3">
        <BuscadorSimple ruta={RUTA_TIEMPOS} etiqueta="Buscar código interno" marcador="Código, OT, cliente o placa" />
        <PastillaFiltro
          ruta={RUTA_TIEMPOS}
          clave="ver"
          params={params}
          activo={filtro?.valor ?? null}
          etiqueta="Qué códigos mostrar según su semáforo"
          opciones={[
            { valor: null, etiqueta: `Todos (${delArea.length})` },
            ...FILTROS_DE_TIEMPOS.map((f) => ({ valor: f.valor, etiqueta: `${f.etiqueta} (${cuantos(f.semaforo)})` })),
          ]}
        />
        {areas.length > 1 && (
          <PastillaFiltro
            ruta={RUTA_TIEMPOS}
            clave="area"
            params={params}
            activo={area || null}
            etiqueta="Área de la etapa en curso"
            opciones={[{ valor: null, etiqueta: 'Todas las áreas' }, ...areas.map((a) => ({ valor: a, etiqueta: a }))]}
          />
        )}
      </div>

      {codigos.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">
              {todos.length === 0 ? 'No hay códigos por entregar' : 'Ningún código con esta búsqueda o filtro'}
            </p>
            <p className="text-sm text-texto-suave">
              {todos.length === 0
                ? 'Aparecen aquí cuando Administración carga la OT de una unidad con su código interno, o cuando Diseño arma sus etapas en «Control de etapas».'
                : 'Borra la búsqueda o quita el filtro con «Todos».'}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-2" aria-label="Códigos internos sin entregar">
          {enPagina.map((c) => (
            <li key={c.codigo}>
              <Link
                href={enlaceDeTiempos(c.codigo)}
                className="block rounded-[var(--radius-base)] border border-borde bg-superficie p-3 hover:border-acento"
                data-codigo={c.codigo}
                data-semaforo={c.semaforo}
              >
                <Fila c={c} hoy={hoy} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Paginacion ruta={RUTA_TIEMPOS} pagina={pagina} paginas={paginas} total={codigos.length} porPagina={POR_PAGINA} params={params} />
    </>
  )
}

/** Lo que dice el semáforo del código en una línea: lo que venció o lo que viene. */
function motivo(c: CodigoConTiempos, hoy: string): string {
  const partes: string[] = []
  // La entrega al cliente va primero cuando es ella la que venció o está por vencer.
  const entregaUrgente = c.fecha_entrega !== null && (c.semaforo_entrega === 'ROJO' || c.semaforo_entrega === 'AMBAR')
  if (entregaUrgente) partes.push(`La entrega ${plazoDeEntrega(c, hoy)}`)
  if (c.etapas_vencidas > 0) partes.push(`${c.etapas_vencidas} ${c.etapas_vencidas === 1 ? 'etapa vencida' : 'etapas vencidas'}`)
  if (c.etapas_por_vencer > 0) partes.push(`${c.etapas_por_vencer} por vencer`)
  if (partes.length === 0 && c.proxima_fecha) partes.push(`Próxima fecha: ${fecha(c.proxima_fecha)}`)
  if (partes.length === 0 && c.fecha_entrega) partes.push(`La entrega ${plazoDeEntrega(c, hoy)}`)
  return partes.join(' · ')
}

/** «vence hoy», «venció hace 2 días hábiles», «es en 12 días hábiles». */
function plazoDeEntrega(c: CodigoConTiempos, hoy: string): string {
  return plazoEnPalabras(c.semaforo_entrega, c.dias_habiles_entrega, { fechaPlan: c.fecha_entrega, hoy })
    .replace(/^Vencida hace/, 'venció hace')
    .replace(/^Vencida$/, 'ya venció')
    .replace(/^Vence/, 'vence')
    .replace(/^Faltan (.+)$/, 'es en $1')
    .replace(/^A tiempo$/, 'va a tiempo')
}

/** « y 1 OT más»: el código tiene otra OT abierta además de la que se nombra. */
function otrasOt(c: CodigoConTiempos): string {
  return c.ots_abiertas > 1 ? ` y ${c.ots_abiertas - 1} OT más` : ''
}

function Fila({ c, hoy }: { c: CodigoConTiempos; hoy: string }) {
  const semaforo = SEMAFORO_DE_CODIGO[c.semaforo]
  const detalle = motivo(c, hoy)
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="font-mono text-sm font-semibold break-all text-texto">{c.codigo}</p>
        <p className="text-xs text-texto-suave">
          {[c.ot_numero ? `OT ${c.ot_numero}${otrasOt(c)}` : 'Sin OT abierta', c.cliente, c.unidad].filter(Boolean).join(' · ')}
        </p>
        <p className="text-xs text-texto">
          {c.etapas === 0 ? (
            <span className="text-texto-suave">Sin etapas cargadas</span>
          ) : (
            <>
              <span className="tabular">
                {c.etapas_terminadas} de {c.etapas}
              </span>{' '}
              {c.etapas === 1 ? 'etapa terminada' : 'etapas terminadas'}
              {c.etapa_en_curso && (
                <span className="text-texto-suave">
                  {' '}
                  · Ahora: {c.etapa_en_curso}
                  {c.area_en_curso && ` (${c.area_en_curso})`}
                </span>
              )}
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1 text-xs sm:items-end sm:text-right">
        <span className="flex flex-wrap items-center gap-2">
          <Insignia tono={semaforo.tono}>{semaforo.etiqueta}</Insignia>
          {detalle && <span className="text-texto">{detalle}</span>}
        </span>
        <span className="text-texto-suave">
          {c.fecha_entrega ? (
            <>
              Entrega al cliente:{' '}
              <span
                className={`tabular ${c.semaforo_entrega === 'ROJO' ? 'font-medium text-peligro' : c.semaforo_entrega === 'AMBAR' ? 'font-medium text-aviso' : 'text-texto'}`}
              >
                {fecha(c.fecha_entrega)}
              </span>
            </>
          ) : (
            'Sin fecha de entrega al cliente'
          )}
        </span>
      </div>
    </div>
  )
}
