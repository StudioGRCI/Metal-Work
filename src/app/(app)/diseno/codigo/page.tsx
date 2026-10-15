import { notFound } from 'next/navigation'

import { ListaEtapas, resumenEtapas } from '@/components/codigo-interno/etapas'
import { TablaComparada, TablaListaDiseno, TablaLoPedido } from '@/components/codigo-interno/materiales'
import { ListaPlanos } from '@/components/codigo-interno/planos'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Indicador } from '@/components/ui/indicador'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  areasDePlanos,
  areasParaEtapas,
  codigosDeDiseno,
  etapasDeCodigo,
  historialDePlano,
  listaDeMateriales,
  loPedidoDelCodigo,
  materialesComparados,
  materialesParaElegir,
  planosDeCodigo,
} from '@/lib/datos/diseno-codigos'
import { normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { VISTAS_DISENO, vistaDisenoValida, type VistaDiseno } from '@/lib/dominio/diseno-codigos'
import { hoyLima } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

import {
  AnularPlano,
  CargarPlano,
  CorregirEtapa,
  CorregirMaterial,
  EtapasDeSiempre,
  FormularioEtapa,
  FormularioMaterial,
  MarcarEtapa,
  MoverEtapa,
  QuitarEtapa,
  QuitarMaterial,
  SubirRevision,
} from './formularios'

export const metadata = { title: 'Código interno · Diseño' }

/**
 * Un código interno visto por Diseño: sus planos, su lista de materiales y sus
 * etapas, cada uno en su pestaña. Lo que antes Diseño cargaba en la OT, ahora
 * va aquí, por el código de la unidad (migración 20261015200000).
 */
export default async function PaginaCodigoDeDiseno({ searchParams }: PageProps<'/diseno/codigo'>) {
  await exigirPermiso('diseno.codigos')
  const params = await searchParams
  const codigo = typeof params.codigo === 'string' ? normalizarCodigo(params.codigo) : ''
  if (codigo.length < 2 || codigo.length > 60) notFound()
  const vista = vistaDisenoValida(params.vista)
  const titulo = VISTAS_DISENO.find((v) => v.valor === vista)?.titulo ?? 'Planos'

  const resumen = (await codigosDeDiseno()).find((c) => c.codigo === codigo)

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
        <div className="space-y-5">
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
      )}
    </>
  )
}

/** Cada pestaña carga solo lo suyo. */
async function Vista({ vista, codigo }: { vista: VistaDiseno; codigo: string }) {
  if (vista === 'materiales') return <VistaMateriales codigo={codigo} />
  if (vista === 'etapas') return <VistaEtapas codigo={codigo} />
  return <VistaPlanos codigo={codigo} />
}

async function VistaPlanos({ codigo }: { codigo: string }) {
  const [planos, areas] = await Promise.all([planosDeCodigo(codigo), areasDePlanos()])
  const conHistoria = planos.filter((p) => p.revisiones > 1)
  const historial = new Map(await Promise.all(conHistoria.map(async (p) => [p.id, await historialDePlano(p.id)] as const)))
  return (
    <>
      <Tarjeta>
        <TarjetaCabecera
          titulo="Cargar un plano"
          descripcion="Cada plano va a un área de producción. Si el mismo número va a dos áreas, cárgalo una vez para cada una. Para corregir uno ya cargado, súbele una revisión."
        />
        <TarjetaCuerpo>
          <CargarPlano codigo={codigo} areas={areas} solicitud={{ plano: crypto.randomUUID(), revision: crypto.randomUUID() }} />
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera titulo="Planos del código" descripcion="La revisión vigente de cada plano, y si el supervisor del área ya la recibió." />
        <TarjetaCuerpo>
          {planos.length === 0 ? (
            <p className="text-sm text-texto-suave">Todavía no hay planos. Carga el primero con el formulario de arriba.</p>
          ) : (
            <ListaPlanos
              planos={planos}
              historial={historial}
              acciones={(p) =>
                p.anulado_en ? null : (
                  <>
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
          descripcion="El material del catálogo, cuánto lleva la unidad y, si sale de uno, el plano. Si un material no está en el catálogo, dalo de alta en Materiales."
        />
        <TarjetaCuerpo>
          <FormularioMaterial codigo={codigo} materiales={opciones} planos={planosVigentes} />
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera titulo="Lista de materiales" descripcion="Lo que lleva la unidad según Diseño. Es referencia: no genera requerimientos." />
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
          descripcion="Lo comprado son las OC con este código, menos las rechazadas. Lo salido, las salidas del almacén para el código menos lo devuelto."
        />
        <TablaComparada materiales={comparados} />
      </Tarjeta>

      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera titulo="Lo que pidieron las áreas" descripcion="Los requerimientos con este código, menos los anulados, con el insumo como lo escribió cada área." />
        <TablaLoPedido lineas={pedido} />
      </Tarjeta>
    </>
  )
}

async function VistaEtapas({ codigo }: { codigo: string }) {
  const [etapas, areas] = await Promise.all([etapasDeCodigo(codigo), areasParaEtapas()])
  const hoy = hoyLima()
  return (
    <>
      {etapas.length === 0 ? (
        <Tarjeta>
          <TarjetaCabecera
            titulo="Todavía no hay etapas"
            descripcion="Carga las de siempre —Diseño y planos, Habilitado (Maestranza), Armado (Producción), Arenado y pintura (Acabados), Trámites y Entrega— y ponles sus fechas, o agrégalas una por una."
          />
          <TarjetaCuerpo>
            <EtapasDeSiempre codigo={codigo} />
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <Tarjeta>
          <TarjetaCabecera
            titulo="Etapas de la unidad"
            descripcion={`${resumenEtapas(etapas, hoy)}. El supervisor de cada área marca cuándo empezó y terminó la suya; el avance sale de su reporte diario.`}
          />
          <TarjetaCuerpo>
            <ListaEtapas
              etapas={etapas}
              hoy={hoy}
              acciones={(e, i) => (
                <>
                  <MarcarEtapa etapa={e} hoy={hoy} />
                  <MoverEtapa id={e.id} nombre={e.nombre} primera={i === 0} ultima={i === etapas.length - 1} />
                  <CorregirEtapa codigo={codigo} areas={areas} etapa={e} />
                  <QuitarEtapa id={e.id} nombre={e.nombre} />
                </>
              )}
            />
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      <Tarjeta>
        <TarjetaCabecera titulo="Agregar una etapa" descripcion="Va al final; súbela con las flechas. La fecha comprometida es contra la que se mide si va a tiempo." />
        <TarjetaCuerpo>
          <FormularioEtapa codigo={codigo} areas={areas} />
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}
