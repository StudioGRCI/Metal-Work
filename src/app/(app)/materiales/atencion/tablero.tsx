'use client'

import { ArrowDownToLine, ArrowUpFromLine, Boxes, Check, PackageCheck, ShoppingCart } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cantidad, fecha as formatearFecha } from '@/lib/format'
import { useEnvio } from '@/lib/envio'
import type {
  AreaMaterial,
  CompraMaterialPendiente,
  ExistenciaMaterial,
  LineaAtencionMaterial,
  ResponsableMaterial,
} from '@/lib/datos/atencion-materiales'

import { crearOrdenCompra, despacharMaterial, registrarRecepcion } from './acciones'

const NOMBRE_AREA: Record<string, string> = {
  MTZ: 'Maestranza',
  PRD: 'Producción',
  ACB: 'Acabados',
}

const NOMBRE_ESTADO: Record<string, string> = {
  SOLICITADO: 'Por comprar',
  EN_COMPRA: 'En compra',
  EN_ALMACEN: 'En almacén',
  ATENDIDO: 'Entregado',
}

const TONO_ESTADO: Record<string, 'aviso' | 'info' | 'exito' | 'neutro'> = {
  SOLICITADO: 'aviso',
  EN_COMPRA: 'info',
  EN_ALMACEN: 'aviso',
  ATENDIDO: 'exito',
}

type Filtro = 'TODOS' | 'SOLICITADO' | 'EN_COMPRA' | 'EN_ALMACEN' | 'ATENDIDO'

export function TableroMateriales({
  lineas,
  existencias,
  compras,
  areas,
  responsables,
  puedeCrearCompra,
  puedeVerCompras,
  puedeRecibir,
  puedeDespachar,
  clavesCompra,
  clavesRecepcion,
  clavesDespacho,
}: {
  lineas: LineaAtencionMaterial[]
  existencias: ExistenciaMaterial[]
  compras: CompraMaterialPendiente[]
  areas: AreaMaterial[]
  responsables: ResponsableMaterial[]
  puedeCrearCompra: boolean
  puedeVerCompras: boolean
  puedeRecibir: boolean
  puedeDespachar: boolean
  clavesCompra: Record<string, string>
  clavesRecepcion: Record<string, string>
  clavesDespacho: Record<string, string>
}) {
  const [filtro, setFiltro] = useState<Filtro>('TODOS')
  const agrupados = useMemo(() => {
    const grupos = new Map<string, LineaAtencionMaterial[]>()
    for (const linea of lineas) {
      if (filtro !== 'TODOS' && linea.estado !== filtro) continue
      const grupo = grupos.get(linea.requerimiento_id ?? '') ?? []
      grupo.push(linea)
      grupos.set(linea.requerimiento_id ?? '', grupo)
    }
    return [...grupos.entries()]
  }, [filtro, lineas])

  const completos = lineas.filter((linea) => linea.estado === 'ATENDIDO').length
  const porComprar = lineas.filter((linea) => linea.estado === 'SOLICITADO').length
  const enAlmacen = lineas.filter((linea) => linea.estado === 'EN_ALMACEN').length
  const avanceLineas = lineas.length > 0 ? Math.round((completos / lineas.length) * 100) : 0

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador icono={ShoppingCart} titulo="Líneas solicitadas" valor={lineas.length} detalle="Desde planos y materiales de la OT" />
        <Indicador icono={Boxes} titulo="Por atender en compra" valor={porComprar} detalle="Aún no cubiertas por una orden" />
        <Indicador icono={PackageCheck} titulo="Con saldo en almacén" valor={enAlmacen} detalle="Recibidas y pendientes de despacho" />
        <Indicador icono={Check} titulo="Líneas entregadas" valor={completos} detalle="Despacho registrado con responsable" />
      </div>

      {lineas.length > 0 && (
        <Tarjeta>
          <TarjetaCuerpo className="flex flex-wrap items-center gap-4">
            <div className="min-w-48 flex-1">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-texto">Atención completa de requerimientos</p>
                <p className="tabular text-sm font-semibold text-acento">{avanceLineas}%</p>
              </div>
              <Progreso valor={avanceLineas} etiqueta="Líneas de materiales entregadas por completo" />
              <p className="mt-1 text-xs text-texto-suave">
                {completos} de {lineas.length} líneas entregadas por completo. Este porcentaje mide materiales, separado del avance de fabricación.
              </p>
            </div>
            <div className="flex flex-wrap gap-1" aria-label="Filtrar materiales por estado">
              {([
                ['TODOS', 'Todos'],
                ['SOLICITADO', 'Por comprar'],
                ['EN_COMPRA', 'En compra'],
                ['EN_ALMACEN', 'En almacén'],
                ['ATENDIDO', 'Entregados'],
              ] as const).map(([valor, etiqueta]) => (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={filtro === valor}
                  onClick={() => setFiltro(valor)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento ${filtro === valor ? 'border-acento bg-acento-suave text-acento' : 'border-borde text-texto-suave hover:bg-superficie-2'}`}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      {agrupados.length > 0 && agrupados.map(([id, grupo]) => {
        const cabecera = grupo[0]
        const porComprarReq = grupo.filter((linea) =>
          Number(linea.cantidad_solicitada ?? 0) > Number(linea.cantidad_comprada ?? 0),
        )
        const comprasReq = compras.filter((compra) => compra.requerimiento_id === cabecera.requerimiento_id)

        return (
          <Tarjeta key={id}>
            <TarjetaCabecera
              titulo={`OT ${cabecera.numero_ot ?? '—'} · ${NOMBRE_AREA[cabecera.area_destino ?? ''] ?? cabecera.area_destino ?? 'Área'}`}
              descripcion={`${grupo.length} ${grupo.length === 1 ? 'línea solicitada' : 'líneas solicitadas'} · ${formatearFecha(cabecera.creado_en)}`}
              acciones={<Insignia tono={TONO_ESTADO[estadoGrupo(grupo)]}>{NOMBRE_ESTADO[estadoGrupo(grupo)]}</Insignia>}
            />
            <TarjetaCuerpo className="space-y-3">
              {grupo.map((linea) => (
                <LineaMaterial
                  key={linea.detalle_id}
                  linea={linea}
                  responsables={responsables}
                  areas={areas}
                  compras={comprasReq.filter((compra) => compra.requerimiento_detalle_id === linea.detalle_id)}
                  puedeVerCompras={puedeVerCompras}
                  puedeRecibir={puedeRecibir}
                  puedeDespachar={puedeDespachar}
                  claveDespacho={clavesDespacho[linea.detalle_id ?? '']}
                />
              ))}
              {puedeCrearCompra && porComprarReq.length > 0 && (
                <FormularioCompra
                  requerimientoId={cabecera.requerimiento_id ?? ''}
                  lineas={porComprarReq}
                  clave={clavesCompra[cabecera.requerimiento_id ?? '']}
                />
              )}
              {comprasReq.length > 0 && (puedeVerCompras || puedeRecibir) && (
                <div className="border-t border-borde pt-3">
                  <p className="mb-2 text-xs font-semibold text-texto">Llegadas pendientes</p>
                  <div className="grid gap-2 lg:grid-cols-2">
                    {comprasReq.map((compra) => (
                      <FormularioRecepcion key={compra.id} compra={compra} clave={clavesRecepcion[compra.id ?? '']} />
                    ))}
                  </div>
                </div>
              )}
            </TarjetaCuerpo>
          </Tarjeta>
        )
      })}

      {lineas.length > 0 && agrupados.length === 0 && (
        <Tarjeta><TarjetaCuerpo><p className="text-sm text-texto-suave">No hay materiales con este estado.</p></TarjetaCuerpo></Tarjeta>
      )}

      {existencias.length > 0 && (
        <Tarjeta>
          <TarjetaCabecera titulo="Existencias de almacén" descripcion="Saldo recibido menos los despachos ya registrados." />
          <TarjetaCuerpo className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {existencias.map((material) => (
              <div key={material.material_id} className="flex items-center justify-between gap-3 rounded-[var(--radius-base)] border border-borde p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-texto">{material.descripcion}</p>
                  <p className="text-xs text-texto-suave">{material.codigo}</p>
                </div>
                <p className="tabular whitespace-nowrap text-sm font-semibold text-texto">{cantidad(Number(material.existencia ?? 0))} {material.unidad}</p>
              </div>
            ))}
          </TarjetaCuerpo>
        </Tarjeta>
      )}
    </div>
  )
}

function Indicador({
  icono: Icono,
  titulo,
  valor,
  detalle,
}: {
  icono: typeof Boxes
  titulo: string
  valor: number
  detalle: string
}) {
  return (
    <Tarjeta>
      <TarjetaCuerpo className="flex items-start gap-3">
        <span className="rounded-[var(--radius-base)] bg-acento-suave p-2 text-acento"><Icono aria-hidden className="size-4" /></span>
        <div>
          <p className="text-xs text-texto-suave">{titulo}</p>
          <p className="tabular text-2xl font-semibold text-texto">{valor}</p>
          <p className="text-[11px] text-texto-suave">{detalle}</p>
        </div>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function LineaMaterial({
  linea,
  responsables,
  areas,
  compras,
  puedeVerCompras,
  puedeRecibir,
  puedeDespachar,
  claveDespacho,
}: {
  linea: LineaAtencionMaterial
  responsables: ResponsableMaterial[]
  areas: AreaMaterial[]
  compras: CompraMaterialPendiente[]
  puedeVerCompras: boolean
  puedeRecibir: boolean
  puedeDespachar: boolean
  claveDespacho: string | undefined
}) {
  const solicitado = Number(linea.cantidad_solicitada ?? 0)
  const comprado = Number(linea.cantidad_comprada ?? 0)
  const recibido = Number(linea.cantidad_recibida ?? 0)
  const despachado = Number(linea.cantidad_despachada ?? 0)
  const disponible = Math.max(0, Math.min(recibido - despachado, solicitado - despachado))
  const porcentaje = solicitado > 0 ? Math.min(100, Math.round((despachado / solicitado) * 100)) : 0
  const areaId = areas.find((area) => area.codigo === linea.area_destino)?.id
  const candidatos = responsables.filter((persona) => persona.area_id === areaId)

  return (
    <div className="rounded-[var(--radius-base)] border border-borde bg-superficie p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-texto">{linea.material ?? 'Material'}</p>
            <Insignia tono={TONO_ESTADO[linea.estado ?? ''] ?? 'neutro'}>{NOMBRE_ESTADO[linea.estado ?? ''] ?? 'Solicitado'}</Insignia>
          </div>
          <p className="mt-1 text-xs text-texto-suave">
            {linea.material_codigo ?? ''}{linea.numero_plano ? ` · Plano ${linea.numero_plano}` : ''}{linea.plano ? ` · ${linea.plano}` : ''}
          </p>
        </div>
        <div className="min-w-52 flex-1 sm:max-w-72">
          <div className="mb-1 flex justify-between gap-2 text-[11px] text-texto-suave">
            <span>Entregado al área</span><span className="tabular font-medium text-texto">{porcentaje}%</span>
          </div>
          <Progreso valor={porcentaje} etiqueta={`Material entregado: ${linea.material ?? 'material'}`} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <CantidadMini nombre="Solicitado" valor={solicitado} unidad={linea.unidad} />
        <CantidadMini nombre="Comprado" valor={comprado} unidad={linea.unidad} />
        <CantidadMini nombre="Recibido" valor={recibido} unidad={linea.unidad} />
        <CantidadMini nombre="Entregado" valor={despachado} unidad={linea.unidad} />
      </div>

      {linea.responsables && (
        <p className="mt-3 border-t border-borde pt-2 text-xs text-texto-suave">
          Recibió: <span className="font-medium text-texto">{linea.responsables}</span>
        </p>
      )}

      {puedeDespachar && disponible > 0 && (
        <FormularioDespacho
          linea={linea}
          candidatos={candidatos}
          disponible={disponible}
          clave={claveDespacho}
        />
      )}

      {puedeRecibir && compras.length > 0 && !puedeVerCompras && <p className="mt-3 text-xs text-texto-suave">Hay compras esperando ingreso en almacén.</p>}
    </div>
  )
}

function CantidadMini({ nombre, valor, unidad }: { nombre: string; valor: number; unidad: string | null }) {
  return <div className="rounded-md bg-superficie-2 px-2 py-1.5"><p className="text-texto-suave">{nombre}</p><p className="tabular mt-0.5 font-semibold text-texto">{cantidad(valor)} {unidad}</p></div>
}

function FormularioCompra({
  requerimientoId,
  lineas,
  clave,
}: {
  requerimientoId: string
  lineas: LineaAtencionMaterial[]
  clave: string | undefined
}) {
  const { alEnviar, enviando, error } = useEnvio(crearOrdenCompra)
  return (
    <form onSubmit={alEnviar} className="grid gap-3 rounded-[var(--radius-base)] border border-acento/30 bg-acento-suave/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="operacion_id" value={clave ?? ''} />
      <input type="hidden" name="requerimiento_id" value={requerimientoId} />
      <Campo etiqueta="Proveedor" htmlFor={`proveedor-${requerimientoId}`} requerido>
        <Entrada id={`proveedor-${requerimientoId}`} name="proveedor" required maxLength={160} placeholder="Nombre del proveedor" />
      </Campo>
      <Campo etiqueta="Referencia de compra" htmlFor={`referencia-${requerimientoId}`} requerido ayuda="OC o número del proveedor">
        <Entrada id={`referencia-${requerimientoId}`} name="referencia" required maxLength={100} placeholder="OC-0001" />
      </Campo>
      <Campo etiqueta="Entrega estimada" htmlFor={`fecha-${requerimientoId}`}>
        <Entrada id={`fecha-${requerimientoId}`} name="fecha_estimada" type="date" />
      </Campo>
      <div className="flex items-end"><Boton type="submit" cargando={enviando} className="w-full"><ShoppingCart aria-hidden className="size-4" />Registrar compra</Boton></div>
      {lineas.map((linea) => {
        const faltante = Number(linea.cantidad_solicitada ?? 0) - Number(linea.cantidad_comprada ?? 0)
        return (
          <div key={linea.detalle_id} className="flex items-center gap-2 rounded-md border border-borde bg-superficie px-3 py-2 sm:col-span-2 lg:col-span-4">
            <input type="hidden" name="detalle_id" value={linea.detalle_id ?? ''} />
            <span className="min-w-0 flex-1 truncate text-xs text-texto">{linea.material}</span>
            <span className="whitespace-nowrap text-[11px] text-texto-suave">Falta {cantidad(faltante)} {linea.unidad}</span>
            <Entrada aria-label={`Cantidad a comprar de ${linea.material}`} name={`cantidad_${linea.detalle_id}`} type="number" inputMode="decimal" min={0.001} max={faltante} step="0.001" defaultValue={faltante} required className="tabular w-28 text-right" />
          </div>
        )
      })}
      {error && <p role="alert" className="text-xs text-peligro sm:col-span-2 lg:col-span-4">{error}</p>}
    </form>
  )
}

function FormularioRecepcion({ compra, clave }: { compra: CompraMaterialPendiente; clave: string | undefined }) {
  const { alEnviar, enviando, error } = useEnvio(registrarRecepcion)
  const restante = Number(compra.cantidad_pendiente ?? 0)
  return (
    <form onSubmit={alEnviar} className="grid gap-2 rounded-md border border-borde p-3 sm:grid-cols-2">
      <input type="hidden" name="operacion_id" value={clave ?? ''} />
      <input type="hidden" name="compra_detalle_id" value={compra.id ?? ''} />
      <div className="sm:col-span-2">
        <p className="text-xs font-medium text-texto">{compra.proveedor} · {compra.referencia}</p>
        <p className="mt-0.5 text-[11px] text-texto-suave">Pendiente {cantidad(restante)} · estimado {formatearFecha(compra.fecha_estimada)}</p>
      </div>
      <Campo etiqueta="Cantidad que llegó" htmlFor={`rec-cant-${compra.id}`} requerido>
        <Entrada id={`rec-cant-${compra.id}`} name="cantidad" type="number" inputMode="decimal" min={0.001} max={restante} step="0.001" defaultValue={restante} required />
      </Campo>
      <Campo etiqueta="Guía o documento" htmlFor={`rec-doc-${compra.id}`} requerido>
        <Entrada id={`rec-doc-${compra.id}`} name="documento_referencia" required maxLength={100} placeholder="Guía de remisión" />
      </Campo>
      {error && <p role="alert" className="text-xs text-peligro sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2"><Boton type="submit" variante="secundario" tamano="sm" cargando={enviando} className="w-full"><ArrowDownToLine aria-hidden className="size-4" />Registrar llegada a almacén</Boton></div>
    </form>
  )
}

function FormularioDespacho({
  linea,
  candidatos,
  disponible,
  clave,
}: {
  linea: LineaAtencionMaterial
  candidatos: ResponsableMaterial[]
  disponible: number
  clave: string | undefined
}) {
  const { alEnviar, enviando, error } = useEnvio(despacharMaterial)
  return (
    <form onSubmit={alEnviar} className="mt-3 grid gap-2 border-t border-borde pt-3 sm:grid-cols-[1fr_1fr_auto]">
      <input type="hidden" name="operacion_id" value={clave ?? ''} />
      <input type="hidden" name="requerimiento_detalle_id" value={linea.detalle_id ?? ''} />
      <Campo etiqueta="Cantidad a entregar" htmlFor={`sal-cant-${linea.detalle_id}`} requerido>
        <Entrada id={`sal-cant-${linea.detalle_id}`} name="cantidad" type="number" inputMode="decimal" min={0.001} max={disponible} step="0.001" defaultValue={disponible} required />
        <p className="mt-1 text-[11px] text-texto-suave">Disponible para este requerimiento: {cantidad(disponible)}</p>
      </Campo>
      <Campo etiqueta="Entregar a" htmlFor={`sal-persona-${linea.detalle_id}`} requerido>
        <Seleccion id={`sal-persona-${linea.detalle_id}`} name="responsable_id" required defaultValue="">
          <option value="" disabled>Elige a quien recibe</option>
          {candidatos.map((persona) => <option key={persona.id} value={persona.id}>{persona.nombres} {persona.apellidos}</option>)}
        </Seleccion>
        {candidatos.length === 0 && <p className="mt-1 text-[11px] text-aviso">No hay personas activas registradas para {NOMBRE_AREA[linea.area_destino ?? ''] ?? 'esta área'}.</p>}
      </Campo>
      <div className="flex items-end"><Boton type="submit" tamano="sm" cargando={enviando} disabled={candidatos.length === 0} className="w-full"><ArrowUpFromLine aria-hidden className="size-4" />Despachar</Boton></div>
      {error && <p role="alert" className="text-xs text-peligro sm:col-span-3">{error}</p>}
    </form>
  )
}

function estadoGrupo(lineas: LineaAtencionMaterial[]): string {
  const prioridades: Record<string, number> = { SOLICITADO: 0, EN_COMPRA: 1, EN_ALMACEN: 2, ATENDIDO: 3 }
  return lineas.reduce((actual, linea) =>
    (prioridades[linea.estado ?? 'SOLICITADO'] ?? 0) < (prioridades[actual] ?? 0)
      ? linea.estado ?? 'SOLICITADO'
      : actual,
  'ATENDIDO')
}
