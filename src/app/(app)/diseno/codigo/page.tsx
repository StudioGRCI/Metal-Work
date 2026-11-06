import { FileText, Truck } from 'lucide-react'
import { notFound } from 'next/navigation'

import { ListaEtapas, resumenEtapas } from '@/components/codigo-interno/etapas'
import { TablaComparada, TablaListaDiseno, TablaLoPedido } from '@/components/codigo-interno/materiales'
import { ListaDxf } from '@/components/codigo-interno/dxf'
import { ListaPlanos } from '@/components/codigo-interno/planos'
import { DelDocumento } from '@/components/estructura/del-documento'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  areasDePlanos,
  areasParaEtapas,
  codigosDeDiseno,
  dxfDeCodigo,
  etapasDeCodigo,
  historialDePlano,
  listaDeMateriales,
  loPedidoDelCodigo,
  materialesComparados,
  materialesParaElegir,
  ordenesDelCodigo,
  planosDeCodigo,
  type OrdenDelCodigo,
} from '@/lib/datos/diseno-codigos'
import { normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { AREAS_DE_ETAPA_DE_DISENO, VISTAS_DISENO, vistaDisenoValida, type VistaDiseno } from '@/lib/dominio/diseno-codigos'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { cantidad, fecha, fechaHora, hoyLima } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

import {
  AnularPlano,
  CambiarPeso,
  CargarDxf,
  CargarPlano,
  CorregirEtapa,
  CorregirMaterial,
  FormularioEtapa,
  FormularioMaterial,
  MarcarEtapa,
  MoverEtapa,
  ParDeEtapas,
  QuitarDxf,
  QuitarEtapa,
  QuitarFicha,
  QuitarMaterial,
  SubirFicha,
  SubirRevision,
} from './formularios'

export const metadata = { title: 'Código interno · Diseño' }

/**
 * Un código interno visto por Diseño: su OT arriba —la que Administración cargó
 * con el código, sobre la cotización aprobada (migración 20261027200000)— y
 * debajo sus planos, su
 * lista de materiales y sus etapas, cada uno en su pestaña. Lo que antes Diseño
 * cargaba en la OT, ahora va aquí, por el código de la unidad (migración
 * 20261015200000).
 */
export default async function PaginaCodigoDeDiseno({ searchParams }: PageProps<'/diseno/codigo'>) {
  const perfil = await exigirPermiso('diseno.codigos')
  const params = await searchParams
  const codigo = typeof params.codigo === 'string' ? normalizarCodigo(params.codigo) : ''
  if (codigo.length < 2 || codigo.length > 60) notFound()
  const vista = vistaDisenoValida(params.vista)
  const titulo = VISTAS_DISENO.find((v) => v.valor === vista)?.titulo ?? 'Planos'

  const [codigos, ordenes] = await Promise.all([codigosDeDiseno(), codigo === 'PLANTA' ? Promise.resolve([]) : ordenesDelCodigo(codigo)])
  const resumen = codigos.find((c) => c.codigo === codigo)

  return (
    <>
      <EncabezadoPagina
        titulo={<span className="font-mono break-all">{codigo}</span>}
        descripcion={resumen?.unidad ?? (resumen ? undefined : 'Código nuevo: todavía no aparece en ningún documento. Aparece en las listas apenas cargues algo.')}
        migas={[{ titulo, ruta: `/diseno/${vista}` }, { titulo: codigo }]}
      />

      {codigo === 'PLANTA' ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm text-texto">PLANTA no es una unidad: los planos, los materiales y las etapas van con el código interno de cada unidad.</p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        // El código lo elige la búsqueda: con otro, todo se monta de nuevo (X1).
        <DelDocumento documento={`codigo:${codigo}`}>
          <div className="space-y-5">
            <OrdenesDelCodigo ordenes={ordenes} yo={perfil.id} />

            <div className="grid grid-cols-3 gap-3">
              <Indicador
                titulo="Planos"
                valor={String(resumen?.planos ?? 0)}
                tono={(resumen?.planos_por_recibir ?? 0) > 0 ? 'aviso' : 'neutro'}
                pie={(resumen?.planos_por_recibir ?? 0) > 0 ? `${resumen?.planos_por_recibir} por recibir` : 'Vigentes'}
              />
              <Indicador titulo="Materiales" valor={String(resumen?.materiales ?? 0)} pie="Líneas en la lista" />
              <Indicador
                titulo="Etapas"
                valor={`${resumen?.etapas_terminadas ?? 0} de ${resumen?.etapas ?? 0}`}
                tono={(resumen?.etapas_vencidas ?? 0) > 0 ? 'peligro' : 'neutro'}
                pie={(resumen?.etapas_vencidas ?? 0) > 0 ? `${resumen?.etapas_vencidas} ${resumen?.etapas_vencidas === 1 ? 'vencida' : 'vencidas'}` : 'Terminadas'}
              />
            </div>

            <PastillaFiltro
              ruta="/diseno/codigo"
              clave="vista"
              params={params}
              activo={vista === 'planos' ? null : vista}
              etiqueta="Secciones del código"
              opciones={VISTAS_DISENO.map((v) => ({ valor: v.valor === 'planos' ? null : v.valor, etiqueta: v.etiqueta }))}
            />

            <Vista vista={vista} codigo={codigo} />
          </div>
        </DelDocumento>
      )}
    </>
  )
}

/**
 * La OT del código: con qué se trabaja y para cuándo. Un código puede tener más
 * de una (otro trabajo para la misma unidad): van todas, la más nueva primero.
 * Junto a cada una, la ficha técnica del camión o tracto que Diseño adjunta.
 */
function OrdenesDelCodigo({ ordenes, yo }: { ordenes: OrdenDelCodigo[]; yo: string }) {
  if (ordenes.length === 0) {
    return (
      <p className="rounded-[var(--radius-base)] bg-superficie-2 px-3 py-2 text-sm text-texto-suave">
        Este código todavía no tiene OT: llega cuando Administración la carga, sobre la cotización que aprobó Gerencia. Ahí también se le adjunta la
        ficha técnica del vehículo.
      </p>
    )
  }
  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo={ordenes.length === 1 ? 'Orden de trabajo' : 'Órdenes de trabajo'}
        ayuda="La que Administración cargó al darle su código interno. Es la guía para los planos, los materiales y las etapas. Junto a ella va la ficha técnica del camión o tracto."
      />
      <TarjetaCuerpo>
        <ul className="divide-y divide-borde">
          {ordenes.map((o) => (
            <li key={o.id} className="space-y-2 py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold tabular text-texto">OT {o.numero}</span>
                    <Insignia tono={definir(ESTADO_OT, o.estado).tono}>{definir(ESTADO_OT, o.estado).etiqueta}</Insignia>
                  </p>
                  <p className="text-sm text-texto-suave">
                    {[o.descripcion, o.cliente].filter(Boolean).join(' · ')}
                    {o.fecha_entrega ? ` · entrega prometida ${fecha(o.fecha_entrega)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
                  {o.url ? (
                    <a href={o.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-acento hover:underline sm:min-h-0">
                      <FileText aria-hidden className="size-4 shrink-0" />
                      Abrir el PDF de la OT
                    </a>
                  ) : (
                    <span className="text-xs text-texto-tenue">{o.pdf_nombre ? 'No se pudo abrir el PDF: recarga la página.' : 'Sin PDF'}</span>
                  )}
                  <SubirFicha ordenId={o.id} numero={o.numero} />
                </div>
              </div>
              {o.fichas.length > 0 && (
                <ul aria-label={`Fichas técnicas de la OT ${o.numero}`} className="space-y-1">
                  {o.fichas.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 text-sm" data-ficha={f.nombre}>
                      <Truck aria-hidden className="size-4 shrink-0 text-texto-suave" />
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-acento hover:underline">
                          {f.nombre}
                        </a>
                      ) : (
                        <span className="min-w-0 truncate text-texto">{f.nombre}</span>
                      )}
                      <span className="shrink-0 text-xs text-texto-suave">Ficha técnica · {fechaHora(f.subido_en)}</span>
                      {f.subido_por === yo && <QuitarFicha id={f.id} ordenId={o.id} nombre={f.nombre} />}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/** Cada pestaña carga solo lo suyo. */
async function Vista({ vista, codigo }: { vista: VistaDiseno; codigo: string }) {
  if (vista === 'materiales') return <VistaMateriales codigo={codigo} />
  if (vista === 'etapas') return <VistaEtapas codigo={codigo} />
  if (vista === 'dxf') return <VistaDxf codigo={codigo} />
  return <VistaPlanos codigo={codigo} />
}

async function VistaPlanos({ codigo }: { codigo: string }) {
  const [planos, areas, etapas] = await Promise.all([planosDeCodigo(codigo), areasDePlanos(), etapasDeCodigo(codigo)])
  const conHistoria = planos.filter((p) => p.revisiones > 1)
  const repartido = planos.filter((p) => !p.anulado_en).reduce((suma, p) => suma + (p.peso ?? 0), 0)
  const libre = Math.max(0, Math.round((100 - repartido) * 100) / 100)
  const sinPeso = planos.filter((p) => !p.anulado_en && p.peso === null).length
  const historial = new Map(await Promise.all(conHistoria.map(async (p) => [p.id, await historialDePlano(p.id)] as const)))
  return (
    <>
      <Tarjeta>
        <TarjetaCabecera
          titulo="Cargar un plano"
          ayuda="Cada plano va a un área de producción. Si el mismo número va a dos áreas, cárgalo una vez para cada una. Para corregir uno ya cargado, súbele una revisión."
        />
        <TarjetaCuerpo>
          <CargarPlano codigo={codigo} areas={areas} repartido={repartido} solicitud={{ plano: crypto.randomUUID(), revision: crypto.randomUUID() }} />
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera
          titulo="Planos del código"
          descripcion={
            planos.length === 0
              ? undefined
              : `Repartido entre los planos: ${cantidad(repartido)} % de la unidad${libre > 0 ? ` · el ${cantidad(libre)} % restante se mide por ${etapas.length > 0 ? 'las etapas' : 'las actividades del reporte diario'}` : ''}${
                  sinPeso > 0 ? ` · ${sinPeso} sin porcentaje` : ''
                }`
          }
          ayuda="La revisión vigente de cada plano, si el supervisor del área ya la recibió, y el porcentaje de la unidad que representa. El avance de la unidad suma lo que avanzó cada plano por su porcentaje; lo que no se repartió en planos se mide por las etapas."
        />
        <TarjetaCuerpo>
          {planos.length === 0 ? (
            <p className="text-sm text-texto-suave">Todavía no hay planos. Carga el primero con el formulario de arriba.</p>
          ) : (
            <ListaPlanos
              planos={planos}
              avisarSinPeso
              historial={historial}
              acciones={(p) =>
                p.anulado_en ? null : (
                  <>
                    <CambiarPeso plano={p.id} numero={p.numero} peso={p.peso} libre={libre} />
                    <SubirRevision plano={p.id} numero={p.numero} solicitudId={crypto.randomUUID()} />
                    <AnularPlano plano={p.id} numero={p.numero} />
                  </>
                )
              }
            />
          )}
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}

async function VistaMateriales({ codigo }: { codigo: string }) {
  const [lineas, comparados, pedido, catalogo, planos] = await Promise.all([
    listaDeMateriales(codigo),
    materialesComparados(codigo),
    loPedidoDelCodigo(codigo),
    materialesParaElegir(),
    planosDeCodigo(codigo),
  ])
  const opciones = catalogo.map((m) => ({ valor: m.id, etiqueta: m.descripcion, detalle: [m.codigo, m.unidad].filter(Boolean).join(' · ') }))
  const planosVigentes = planos.filter((p) => !p.anulado_en).map((p) => ({ id: p.id, etiqueta: `${p.numero} · ${p.nombre} (${p.area})` }))
  return (
    <>
      <Tarjeta>
        <TarjetaCabecera
          titulo="Agregar a la lista"
          ayuda="El material del catálogo, cuánto lleva la unidad y, si sale de uno, el plano. Si un material no está en el catálogo, dalo de alta en Materiales."
        />
        <TarjetaCuerpo>
          <FormularioMaterial codigo={codigo} materiales={opciones} planos={planosVigentes} />
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera titulo="Lista de materiales" ayuda="Lo que lleva la unidad según Diseño. Es referencia: no genera requerimientos." />
        <TablaListaDiseno
          lineas={lineas}
          acciones={(l) => (
            <span className="inline-flex">
              <CorregirMaterial codigo={codigo} materiales={opciones} planos={planosVigentes} linea={l} nombre={l.material} />
              <QuitarMaterial id={l.id} nombre={l.material} />
            </span>
          )}
        />
      </Tarjeta>

      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera
          titulo="La lista contra lo comprado y lo salido"
          ayuda="Lo comprado son las OC con este código, menos las rechazadas. Lo salido, las salidas del almacén para el código menos lo devuelto."
        />
        <TablaComparada materiales={comparados} />
      </Tarjeta>

      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera titulo="Lo que pidieron las áreas" ayuda="Los requerimientos con este código, menos los anulados, con el insumo como lo escribió cada área." />
        <TablaLoPedido lineas={pedido} />
      </Tarjeta>
    </>
  )
}

async function VistaEtapas({ codigo }: { codigo: string }) {
  const [etapas, todasLasAreas, planos] = await Promise.all([etapasDeCodigo(codigo), areasParaEtapas(), planosDeCodigo(codigo)])
  // Diseño solo pone etapas de Maestranza (habilitado) y de Producción (ensamblaje).
  const areas = todasLasAreas.filter((a) => (AREAS_DE_ETAPA_DE_DISENO as readonly string[]).includes(a.codigo))
  const hoy = hoyLima()
  const deDiseno = etapas.filter((e) => !e.padre_id && !e.de_area)
  return (
    <>
      <Tarjeta>
        <TarjetaCabecera
          titulo={deDiseno.length === 0 ? 'Las etapas del juego de planos' : 'Otro juego de planos'}
          ayuda="Por cada juego de planos, Diseño pone dos etapas: Habilitado para Maestranza y Ensamblaje para Producción. Cada supervisor les agrega sus subetapas; Acabados y las demás áreas agregan las suyas."
        />
        <TarjetaCuerpo>
          <ParDeEtapas codigo={codigo} primero={deDiseno.length === 0} />
        </TarjetaCuerpo>
      </Tarjeta>

      {etapas.length > 0 && (
        <Tarjeta>
          <TarjetaCabecera
            titulo="Etapas de la unidad"
            descripcion={`${resumenEtapas(etapas, hoy)}.`}
            ayuda="Debajo de cada etapa, las subetapas que puso su área. Las etapas y subetapas que agregó un área las corrige y las quita su supervisor; el avance sale de su reporte diario."
          />
          <TarjetaCuerpo>
            <ListaEtapas
              etapas={etapas}
              hoy={hoy}
              conPlanosConPeso={planos.some((p) => !p.anulado_en && (p.peso ?? 0) > 0)}
              acciones={(e, lugar) =>
                e.de_area || e.padre_id ? (
                  <MarcarEtapa etapa={e} hoy={hoy} />
                ) : (
                  <>
                    <MarcarEtapa etapa={e} hoy={hoy} />
                    <MoverEtapa id={e.id} nombre={e.nombre} primera={lugar.primera} ultima={lugar.ultima} />
                    <CorregirEtapa codigo={codigo} areas={areas} etapa={e} />
                    {lugar.subetapas.length === 0 && <QuitarEtapa id={e.id} nombre={e.nombre} />}
                  </>
                )
              }
            />
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      <Tarjeta>
        <TarjetaCabecera
          titulo="Agregar una etapa"
          ayuda="Solo de Maestranza o de Producción: las de las demás áreas las agrega su supervisor. Va al final; súbela con las flechas. La fecha comprometida es contra la que se mide si va a tiempo."
        />
        <TarjetaCuerpo>
          <FormularioEtapa codigo={codigo} areas={areas} />
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}

/** Los DXF comprimidos del código: Diseño los sube y Maestranza los descarga. */
async function VistaDxf({ codigo }: { codigo: string }) {
  const archivos = await dxfDeCodigo(codigo)
  return (
    <>
      <Tarjeta>
        <TarjetaCabecera
          titulo="Cargar DXF"
          ayuda={`Los DXF que generaste, en un .zip, .rar o .7z de hasta 50 MB. Solo los ven Diseño y Maestranza; al supervisor de Maestranza le llega el aviso.`}
        />
        <TarjetaCuerpo>
          <CargarDxf codigo={codigo} />
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera titulo="DXF del código" ayuda="Lo que Maestranza descarga para cortar. Si uno se subió por error, quítalo: queda en el historial." />
        <TarjetaCuerpo>
          {archivos.length === 0 ? (
            <p className="text-sm text-texto-suave">Todavía no hay DXF. Carga el primero con el formulario de arriba.</p>
          ) : (
            <ListaDxf archivos={archivos} acciones={(d) => <QuitarDxf id={d.id} nombre={d.nombre_archivo} />} />
          )}
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}
