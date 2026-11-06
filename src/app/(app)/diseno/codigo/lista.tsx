import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { codigosDeDiseno, dxfDeCodigo, otPorCodigo, type CodigoDeDiseno, type OtDeCodigo } from '@/lib/datos/diseno-codigos'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { llaveParecido } from '@/lib/dominio/codigos-internos'
import { VISTAS_DISENO, VISTAS_SEGUIMIENTO, enlaceDisenoCodigo, enlaceSeguimientoCodigo, type VistaDiseno } from '@/lib/dominio/diseno-codigos'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { nombreDeUnidadOCodigo, nombreVaTenue } from '@/lib/dominio/unidades'
import { fecha, parteDe, porcentaje } from '@/lib/format'

import { AbrirCodigo } from './formularios'

/** El código con su OT y cuántos DXF tiene: lo que cada fila muestra. */
type Fila = CodigoDeDiseno & { ot: OtDeCodigo | null; dxf: number }

type Filtro = { valor: string; etiqueta: string; cumple: (c: Fila) => boolean }

/** Los filtros de cada lista: primero lo que espera por Diseño. */
const FILTROS: Record<VistaDiseno, Filtro[]> = {
  planos: [
    { valor: 'por-recibir', etiqueta: 'Planos sin recibir', cumple: (c) => c.planos_por_recibir > 0 },
    { valor: 'con', etiqueta: 'Con planos', cumple: (c) => c.planos > 0 },
    { valor: 'sin', etiqueta: 'Sin planos', cumple: (c) => c.planos === 0 },
  ],
  materiales: [
    { valor: 'con', etiqueta: 'Con lista', cumple: (c) => c.materiales > 0 },
    { valor: 'sin', etiqueta: 'Sin lista', cumple: (c) => c.materiales === 0 },
  ],
  etapas: [
    { valor: 'vencidas', etiqueta: 'Con etapas vencidas', cumple: (c) => c.etapas_vencidas > 0 },
    { valor: 'en-curso', etiqueta: 'En curso', cumple: (c) => c.etapas > 0 && c.etapas_terminadas < c.etapas },
    { valor: 'sin', etiqueta: 'Sin etapas', cumple: (c) => c.etapas === 0 },
  ],
  dxf: [
    { valor: 'con', etiqueta: 'Con DXF', cumple: (c) => c.dxf > 0 },
    { valor: 'sin', etiqueta: 'Sin DXF', cumple: (c) => c.dxf === 0 },
  ],
}

const DESCRIPCION: Record<VistaDiseno, string> = {
  planos:
    'Los planos de cada unidad por su código interno, con su OT y su cliente, en el orden en que entraron las OT. Los sube el encargado de Diseño cuando ya están revisados; el supervisor del área los ve, los abre y marca que los recibió.',
  materiales:
    'Lo que lleva cada unidad según Diseño, por código interno: contra esa lista se mira lo que Logística compró y lo que salió del almacén. No genera requerimientos: los sigue pidiendo cada área.',
  etapas:
    'Por cada juego de planos, Diseño pone dos etapas: Habilitado para Maestranza y Ensamblaje para Producción, con su fecha comprometida. Cada supervisor les agrega sus subetapas, y Acabados y las demás áreas agregan las suyas.',
  dxf: 'Los DXF de cada unidad, comprimidos en .zip, .rar o .7z. Los sube Diseño y los descarga Maestranza para cortar; nadie más los ve.',
}

const DESCRIPCION_SEGUIMIENTO =
  'Lo que Diseño lleva en cada unidad por su código interno: las etapas con su avance, la lista de materiales contra lo pedido, lo comprado y lo salido del almacén, y los planos de cada área. Para consultar: lo cargan Diseño y el supervisor de cada área.'

/**
 * La lista de códigos de Diseño, la misma para Planos, Gestión de materiales y
 * Control de etapas: cambia qué cuenta cada fila y adónde lleva. Con
 * `seguimiento` es la de Supervisión general y Almacén: una sola pantalla con
 * las tres secciones, sin abrir códigos nuevos, y cada fila lleva a la ficha de
 * solo lectura.
 */
export async function ListaDeCodigosDeDiseno({
  vista,
  params,
  seguimiento = false,
}: {
  vista: VistaDiseno
  params: Record<string, string | string[] | undefined>
  seguimiento?: boolean
}) {
  // Almacén entra por «Materiales por código» del menú: el título dice lo mismo que el menú.
  const titulo = seguimiento
    ? vista === 'materiales' ? 'Materiales por código' : 'Seguimiento por código'
    : (VISTAS_DISENO.find((v) => v.valor === vista)?.titulo ?? 'Códigos internos')
  const ruta = seguimiento ? '/seguimiento' : `/diseno/${vista}`
  const enlace = seguimiento ? enlaceSeguimientoCodigo : enlaceDisenoCodigo
  const q = typeof params.q === 'string' ? params.q.trim() : ''
  const filtros = FILTROS[vista]
  const filtro = filtros.find((f) => f.valor === params.ver) ?? null

  // Almacén y Supervisión (seguimiento) no leen la OT: no se pregunta, para no
  // decirles «Sin OT todavía» de una unidad que sí la tiene.
  const veOt = !seguimiento
  const [codigosSueltos, ots, dxf] = await Promise.all([
    codigosDeDiseno(),
    veOt ? otPorCodigo() : Promise.resolve(new Map<string, OtDeCodigo>()),
    vista === 'dxf' && !seguimiento ? dxfDeCodigo(null, { conEnlace: false }) : Promise.resolve([]),
  ])
  const dxfPorCodigo = new Map<string, number>()
  for (const d of dxf) dxfPorCodigo.set(d.codigo, (dxfPorCodigo.get(d.codigo) ?? 0) + 1)
  const todos = ordenarPorIngresoDeOt(codigosSueltos.map((c) => ({ ...c, ot: ots.get(c.codigo) ?? null, dxf: dxfPorCodigo.get(c.codigo) ?? 0 })))
  const llave = llaveParecido(q)
  const palabras = palabrasDeBusqueda(q)
  // Por código, con su llave de parecidos (SR-04, SR 4…), o por lo que la fila
  // muestra —la OT, el cliente, la placa y el vehículo—: quien busca «v2g841» la está viendo ahí.
  const buscados = q
    ? todos.filter(
        (c) =>
          c.codigo.includes(q.toUpperCase()) ||
          (llave && llaveParecido(c.codigo).includes(llave)) ||
          coincide(palabras, [c.codigo, c.unidad, c.ot?.numero, c.ot?.cliente]),
      )
    : todos
  const codigos = filtro ? buscados.filter(filtro.cumple) : buscados

  return (
    <>
      <EncabezadoPagina
        titulo={titulo}
        ayuda={seguimiento ? DESCRIPCION_SEGUIMIENTO : DESCRIPCION[vista]}
        migas={seguimiento ? [{ titulo }] : [{ titulo: 'Diseño e Ingeniería' }, { titulo }]}
      />

      {seguimiento ? (
        <PastillaFiltro
          ruta={ruta}
          clave="vista"
          params={params}
          activo={vista === 'etapas' ? null : vista}
          etiqueta="Qué mirar de cada código"
          opciones={VISTAS_SEGUIMIENTO.map((v) => ({ valor: v.valor === 'etapas' ? null : v.valor, etiqueta: v.etiqueta }))}
          className="mb-4"
        />
      ) : (
        <Tarjeta className="mb-4">
          <TarjetaCabecera titulo="Abrir un código" ayuda="Para una unidad nueva, escribe su código interno tal cual: aparece en la lista apenas cargues algo." />
          <TarjetaCuerpo>
            <AbrirCodigo codigos={todos.map((c) => c.codigo)} vista={vista} />
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      <div className="mb-3 space-y-3">
        <BuscadorSimple ruta={ruta} etiqueta="Buscar código interno" marcador={veOt ? 'Código, OT, cliente o placa' : 'Código, placa o vehículo'} />
        <PastillaFiltro
          ruta={ruta}
          clave="ver"
          params={params}
          activo={filtro?.valor ?? null}
          etiqueta="Qué códigos mostrar"
          opciones={[
            { valor: null, etiqueta: `Todos (${buscados.length})` },
            ...filtros.map((f) => ({ valor: f.valor, etiqueta: `${f.etiqueta} (${buscados.filter(f.cumple).length})` })),
          ]}
        />
      </div>

      {codigos.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">{todos.length === 0 ? 'Todavía no hay códigos internos' : 'Ningún código con esta búsqueda o filtro'}</p>
            <p className="text-sm text-texto-suave">
              {todos.length === 0
                ? seguimiento
                  ? 'Aparecen aquí apenas Diseño cargue algo para una unidad o un área pida con su código.'
                  : 'Escribe el código de la unidad arriba y ábrelo para empezar.'
                : seguimiento
                  ? 'Borra la búsqueda o quita el filtro con «Todos».'
                  : 'Borra la búsqueda o quita el filtro con «Todos». Si es una unidad nueva, ábrela con su código arriba.'}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-2">
          {codigos.map((c) => (
            <li key={c.codigo}>
              <Link
                href={enlace(c.codigo, vista)}
                className="block rounded-[var(--radius-base)] border border-borde bg-superficie p-3 hover:border-acento"
                data-codigo={c.codigo}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Nombre c={c} veOt={veOt} />
                  <Resumen c={c} vista={vista} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * Primero las OT abiertas, en el orden en que entraron; después los códigos
 * cuya OT ya cerró, la más nueva primero; al final los que no tienen OT, con
 * lo que Diseño movió hace poco arriba (como venían).
 */
function ordenarPorIngresoDeOt(filas: Fila[]): Fila[] {
  const grupo = (f: Fila) => (f.ot === null ? 2 : f.ot.abierta ? 0 : 1)
  const ingreso = (f: Fila) => f.ot?.fecha_registro ?? ''
  return filas
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const g = grupo(a.f) - grupo(b.f)
      if (g !== 0) return g
      if (grupo(a.f) === 0) return ingreso(a.f).localeCompare(ingreso(b.f)) || (a.f.ot?.numero ?? '').localeCompare(b.f.ot?.numero ?? '')
      if (grupo(a.f) === 1) return ingreso(b.f).localeCompare(ingreso(a.f))
      return a.i - b.i
    })
    .map(({ f }) => f)
}

/**
 * La fila se nombra como en «Unidades en taller»: la OT con su estado, y debajo
 * la unidad y el cliente. El código va al lado, que es por donde se busca.
 */
function Nombre({ c, veOt }: { c: Fila; veOt: boolean }) {
  if (!c.ot) {
    return (
      <div className="min-w-0">
        <p className="font-mono font-semibold break-all text-texto">{c.codigo}</p>
        <p className="text-xs text-texto-suave">
          {c.unidad && veOt ? `${c.unidad} · ` : c.unidad}
          {veOt && <span className="text-texto-tenue">Sin OT todavía</span>}
        </p>
      </div>
    )
  }
  const estado = definir(ESTADO_OT, c.ot.estado)
  // Sin placa ni nombre, la unidad se llama por su código, que ya va arriba.
  const unidad = c.ot.unidad ? nombreDeUnidadOCodigo(c.ot.unidad, c.codigo) : null
  const conUnidad = unidad !== null && unidad !== c.codigo
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold tabular text-texto">OT {c.ot.numero}</span>
        <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
        <span className="font-mono text-xs break-all text-texto-suave">{c.codigo}</span>
      </p>
      <p className="line-clamp-2 text-xs text-texto-suave sm:line-clamp-1">
        {conUnidad && (
          <span className={nombreVaTenue(c.ot.unidad, c.codigo) ? 'text-texto-tenue' : 'text-texto'}>
            {unidad}
            {(c.ot.cliente || c.ot.cliente_id === null) && ' · '}
          </span>
        )}
        {c.ot.cliente ?? (c.ot.cliente_id === null ? <span className="text-aviso">Sin cliente todavía</span> : null)}
      </p>
    </div>
  )
}

function Resumen({ c, vista }: { c: Fila; vista: VistaDiseno }) {
  if (vista === 'dxf') {
    return c.dxf === 0 ? (
      <span className="text-xs text-texto-suave">Sin DXF</span>
    ) : (
      <span className="text-xs text-texto">
        {c.dxf} {c.dxf === 1 ? 'archivo DXF' : 'archivos DXF'}
      </span>
    )
  }
  if (vista === 'planos') {
    if (c.planos === 0) return <span className="text-xs text-texto-suave">Sin planos</span>
    return (
      <span className="flex flex-wrap items-center gap-2 text-xs text-texto">
        {c.planos} {c.planos === 1 ? 'plano' : 'planos'}
        {c.planos_por_recibir > 0 ? <Insignia tono="aviso">{c.planos_por_recibir} por recibir</Insignia> : <Insignia tono="exito">Todos recibidos</Insignia>}
      </span>
    )
  }
  if (vista === 'materiales') {
    return (
      <span className="text-xs text-texto">
        {c.materiales === 0 ? <span className="text-texto-suave">Sin lista</span> : `${c.materiales} ${c.materiales === 1 ? 'material' : 'materiales'} en la lista`}
      </span>
    )
  }
  if (c.etapas === 0) return <span className="text-xs text-texto-suave">Sin etapas</span>
  return (
    <span className="flex flex-col items-end gap-1 text-xs text-texto">
      <span>
        {c.etapas_terminadas} de {c.etapas} {c.etapas === 1 ? 'terminada' : 'terminadas'}{' '}
        <span className="tabular text-texto-suave">({porcentaje(parteDe(c.etapas_terminadas, c.etapas))})</span>
        {c.etapas_vencidas > 0 && (
          <>
            {' '}
            <Insignia tono="peligro">
              {c.etapas_vencidas} {c.etapas_vencidas === 1 ? 'vencida' : 'vencidas'}
            </Insignia>
          </>
        )}
      </span>
      {c.etapa_actual && (
        <span className="text-texto-suave">
          Ahora: {c.etapa_actual}
          {c.etapa_actual_area && ` (${c.etapa_actual_area})`}
          {c.etapa_actual_fin && ` · hasta el ${fecha(c.etapa_actual_fin)}`}
        </span>
      )}
    </span>
  )
}
