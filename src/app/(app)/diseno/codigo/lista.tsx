import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { codigosDeDiseno, type CodigoDeDiseno } from '@/lib/datos/diseno-codigos'
import { llaveParecido } from '@/lib/dominio/codigos-internos'
import { VISTAS_DISENO, enlaceDisenoCodigo, type VistaDiseno } from '@/lib/dominio/diseno-codigos'
import { fecha } from '@/lib/format'

import { AbrirCodigo } from './formularios'

type Filtro = { valor: string; etiqueta: string; cumple: (c: CodigoDeDiseno) => boolean }

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
}

const DESCRIPCION: Record<VistaDiseno, string> = {
  planos:
    'Los planos de cada unidad por su código interno, con el área de producción a la que va cada uno. El supervisor del área los ve, los abre y marca que los recibió.',
  materiales:
    'Lo que lleva cada unidad según Diseño, por código interno: contra esa lista se mira lo que Logística compró y lo que salió del almacén. No genera requerimientos: los sigue pidiendo cada área.',
  etapas:
    'Las etapas de cada unidad por código interno —diseño, habilitado, armado, arenado y pintura, trámites y entrega— con su fecha comprometida. El supervisor del área marca cuándo empezó y cuándo terminó la suya.',
}

/**
 * La lista de códigos de Diseño, la misma para Planos, Gestión de materiales y
 * Control de etapas: cambia qué cuenta cada fila y adónde lleva.
 */
export async function ListaDeCodigosDeDiseno({ vista, params }: { vista: VistaDiseno; params: Record<string, string | string[] | undefined> }) {
  const titulo = VISTAS_DISENO.find((v) => v.valor === vista)?.titulo ?? 'Códigos internos'
  const ruta = `/diseno/${vista}`
  const q = typeof params.q === 'string' ? params.q.trim() : ''
  const filtros = FILTROS[vista]
  const filtro = filtros.find((f) => f.valor === params.ver) ?? null

  const todos = await codigosDeDiseno()
  const llave = llaveParecido(q)
  const buscados = q ? todos.filter((c) => c.codigo.includes(q.toUpperCase()) || (llave && llaveParecido(c.codigo).includes(llave))) : todos
  const codigos = filtro ? buscados.filter(filtro.cumple) : buscados

  return (
    <>
      <EncabezadoPagina titulo={titulo} descripcion={DESCRIPCION[vista]} migas={[{ titulo: 'Diseño e Ingeniería' }, { titulo }]} />

      <Tarjeta className="mb-4">
        <TarjetaCabecera titulo="Abrir un código" descripcion="Para una unidad nueva, escribe su código interno tal cual: aparece en la lista apenas cargues algo." />
        <TarjetaCuerpo>
          <AbrirCodigo codigos={todos.map((c) => c.codigo)} vista={vista} />
        </TarjetaCuerpo>
      </Tarjeta>

      <div className="mb-3 space-y-3">
        <BuscadorSimple ruta={ruta} etiqueta="Buscar código interno" marcador="Busca por código, por ejemplo SR_04" />
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
                ? 'Escribe el código de la unidad arriba y ábrelo para empezar.'
                : 'Borra la búsqueda o quita el filtro con «Todos». Si es una unidad nueva, ábrela con su código arriba.'}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-2">
          {codigos.map((c) => (
            <li key={c.codigo}>
              <Link
                href={enlaceDisenoCodigo(c.codigo, vista)}
                className="block rounded-[var(--radius-base)] border border-borde bg-superficie p-3 hover:border-acento"
                data-codigo={c.codigo}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono font-semibold break-all text-texto">{c.codigo}</p>
                    {c.unidad && <p className="text-xs text-texto-suave">{c.unidad}</p>}
                  </div>
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

function Resumen({ c, vista }: { c: CodigoDeDiseno; vista: VistaDiseno }) {
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
        {c.etapas_terminadas} de {c.etapas} {c.etapas === 1 ? 'terminada' : 'terminadas'}
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
