'use client'

import { ArrowUpRight, PackagePlus, Pencil, Plus, ShoppingCart, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { Ventana } from '@/components/ui/ventana'
import type { CatalogoMateriales, MaterialDeOrden } from '@/lib/datos/materiales-orden'
import { cantidad as fmtCantidad } from '@/lib/format'
import { useEnvio } from '@/lib/envio'

import {
  agregarMaterial,
  proponerMaterial,
  proponerMaterialNuevo,
  cambiarCantidadMaterial,
  crearRequerimiento,
  quitarMaterial,
} from './acciones-materiales'



function Error_({ texto }: { texto: string | null }) {
  if (!texto) return null
  return (
    <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
      {texto}
    </p>
  )
}

/**
 * La lista de materiales de la orden.
 *
 * «La OT no presupuesta materiales: quien ve cuánto material y qué cosas se van
 * a utilizar es Diseño al realizar el diseño del vehículo». Esta es esa hoja:
 * qué lleva la unidad y cuánto, por plano o por etapa. No lleva importes ni
 * stock: es el desglose, no el almacén.
 */
export function MaterialesDeOrden({
  ordenId,
  materiales,
  catalogo,
  puedeDisenar,
  puedeSolicitar,
  areaPropia,
  ordenViva,
  motivoInactiva,
}: {
  ordenId: string
  materiales: MaterialDeOrden[]
  catalogo: CatalogoMateriales
  /** `diseno.planos`: quien dibuja la unidad escribe qué lleva. */
  puedeDisenar: boolean
  puedeSolicitar: boolean
  areaPropia: string | null
  ordenViva: boolean
  /** Por qué no se toca la lista: en borrador falta la aprobación, cerrada ya no hay qué pedir. */
  motivoInactiva?: string | null
}) {
  const porPlano = new Set(materiales.filter((m) => m.plano_id).map((m) => m.plano_id)).size

  return (
    <div className="space-y-4">
      <Tarjeta>
        <TarjetaCabecera
          titulo="Materiales de la orden"
          descripcion="Diseño asigna materiales a planos. El área puede proponer otros insumos, Diseño los aprueba y Almacén comprueba el stock antes de derivar a Logística."
        />
        <TarjetaCuerpo className="grid gap-3 sm:grid-cols-3">
          <Dato titulo="Líneas" valor={String(materiales.length)} pie="materiales distintos" />
          <Dato titulo="Planos con material" valor={String(porPlano)} pie="de los que hay en la hoja" />
          <Dato
            titulo="Sin plano (histórico)"
            valor={String(materiales.filter((m) => !m.plano_id).length)}
            pie="por vincular a un plano"
          />
        </TarjetaCuerpo>
      </Tarjeta>

      {puedeDisenar && (
        <Link href="/materiales/atencion" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-acento hover:underline">
          Revisar propuestas de materiales de las áreas <ArrowUpRight aria-hidden className="size-4" />
        </Link>
      )}

      {puedeDisenar && ordenViva && (
        <NuevoMaterial ordenId={ordenId} catalogo={catalogo} yaEnLista={materiales} />
      )}
      {!puedeDisenar && puedeSolicitar && ordenViva && (areaPropia === 'MTZ' || areaPropia === 'PRD' || areaPropia === 'ACB') && (
        <div className="space-y-3">
          <NuevoMaterial ordenId={ordenId} catalogo={catalogo} yaEnLista={materiales} propuesta />
          <MaterialFueraDeCatalogo ordenId={ordenId} catalogo={catalogo} />
        </div>
      )}

      {puedeSolicitar && !puedeDisenar && ordenViva && materiales.length > 0 && (
        <SolicitudesPorArea
          ordenId={ordenId}
          materiales={materiales}
          areaPropia={areaPropia}
        />
      )}

      {materiales.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">La lista todavía está vacía</p>
            <p className="mt-1 text-sm text-texto-suave">
              {!ordenViva
                ? `${motivoInactiva ?? 'La orden no está en curso'}: mientras, la lista no se toca.`
                : catalogo.planos.length === 0
                  ? puedeDisenar ? 'Crea primero un plano para esta orden.' : 'Diseño debe liberar un plano a tu área antes de solicitar materiales.'
                : puedeDisenar
                  ? 'Agrega el primer material con el botón de arriba: qué lleva la unidad y cuánto.'
                  : puedeSolicitar
                    ? 'Puedes proponer el material que necesita tu área, aunque no esté en el catálogo. Diseño lo revisará.'
                    : 'Todavía no hay materiales vinculados a esta orden.'}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <Tarjeta>
          <TarjetaCuerpo className="p-0">
            <Tabla>
              <TablaCabecera>
                <TR>
                  <TH>Plano</TH>
                  <TH>Material</TH>
                  <TH>Área destino</TH>
                  <TH className="text-right">Lleva</TH>
                  {puedeDisenar && ordenViva && <TH className="w-20" />}
                </TR>
              </TablaCabecera>
              <tbody>
                {materiales.map((m) => (
                  <TR key={m.id}>
                    <TD className="whitespace-nowrap text-xs text-texto-suave">
                      {m.numero_plano ? `${m.numero_plano} · ${m.plano_nombre}` : '—'}
                    </TD>
                    <TD>
                      <p className="text-sm font-medium text-texto">{m.material}</p>
                      <p className="text-[11px] text-texto-suave">
                        {m.material_codigo}
                        {m.observacion ? ` · ${m.observacion}` : ''}
                      </p>
                    </TD>
                    <TD className="text-xs text-texto-suave">
                      <span className="font-medium text-texto">{AREAS[m.area_destino]}</span>
                      {m.etapa && <p className="mt-0.5 text-[11px] text-texto-suave">Etapa: {m.etapa}</p>}
                    </TD>
                    <TD className="text-right tabular text-sm">
                      {fmtCantidad(m.cantidad)} {m.unidad}
                    </TD>
                    {puedeDisenar && ordenViva && (
                      <TD>
                        {m.requerimiento_estado ? (
                          <Insignia tono={m.requerimiento_estado === 'ATENDIDO' ? 'exito' : 'aviso'}>
                            {ETIQUETAS_ESTADO[m.requerimiento_estado] ?? 'Solicitado'}
                          </Insignia>
                        ) : <AccionesLinea material={m} ordenId={ordenId} catalogo={catalogo} />}
                      </TD>
                    )}
                  </TR>
                ))}
              </tbody>
            </Tabla>
          </TarjetaCuerpo>
        </Tarjeta>
      )}
    </div>
  )
}

function MaterialFueraDeCatalogo({ ordenId, catalogo }: { ordenId: string; catalogo: CatalogoMateriales }) {
  const [abierto, setAbierto] = useState(false)
  const [clave, setClave] = useState(() => crypto.randomUUID())
  const [guardados, setGuardados] = useState(0)
  const { alEnviar, enviando, error } = useEnvio(proponerMaterialNuevo, () => {
    setClave(crypto.randomUUID())
    setGuardados((n) => n + 1)
  })
  if (catalogo.planos.length === 0) return null
  if (!abierto) return <div className="flex justify-end">
    <Boton type="button" variante="secundario" tamano="sm" onClick={() => setAbierto(true)}>
      <PackagePlus aria-hidden className="size-4" />Material que no está en catálogo
    </Boton>
  </div>
  return <Tarjeta className="border-acento">
    <TarjetaCabecera titulo="Solicitar un material nuevo"
      descripcion="Indica qué necesita tu área y para qué plano. Se guarda en la OT; Diseño lo revisa antes de enviarlo a Almacén." />
    <TarjetaCuerpo>
      <form key={clave} onSubmit={alEnviar} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="orden_id" value={ordenId} />
        <input type="hidden" name="solicitud_id" value={clave} />
        <Campo etiqueta="Nombre del material" htmlFor="nuevo-material-nombre" requerido className="sm:col-span-2">
          <Entrada id="nuevo-material-nombre" name="descripcion" minLength={3} maxLength={200} required placeholder="Ej.: Perfil de acero de 6 m" />
        </Campo>
        <Campo etiqueta="Categoría" htmlFor="nuevo-material-categoria" requerido>
          <Seleccion id="nuevo-material-categoria" name="categoria_id" required defaultValue="">
            <option value="" disabled>Elige la categoría</option>
            {catalogo.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Unidad" htmlFor="nuevo-material-unidad" requerido>
          <Seleccion id="nuevo-material-unidad" name="unidad_id" required defaultValue="">
            <option value="" disabled>Elige la unidad</option>
            {catalogo.unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Plano que necesita el material" htmlFor="nuevo-material-plano" requerido>
          <Seleccion id="nuevo-material-plano" name="plano_id" required defaultValue="">
            <option value="" disabled>Elige el plano</option>
            {catalogo.planos.map((p) => <option key={p.id} value={p.id}>{p.numero_plano} · {p.nombre}</option>)}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Cantidad" htmlFor="nuevo-material-cantidad" requerido>
          <Entrada id="nuevo-material-cantidad" name="cantidad" type="number" inputMode="decimal" min={0.001} step="0.001" required />
        </Campo>
        <Campo etiqueta="Especificación" htmlFor="nuevo-material-especificacion" className="sm:col-span-2"
          ayuda="Medidas, calidad o características que Diseño debe comprobar.">
          <Entrada id="nuevo-material-especificacion" name="especificacion" maxLength={300} placeholder="Opcional" />
        </Campo>
        {error && <div className="sm:col-span-2"><Error_ texto={error} /></div>}
        {guardados > 0 && <p role="status" className="text-xs text-exito sm:col-span-2">{guardados} {guardados === 1 ? 'material guardado' : 'materiales guardados'} y pendiente de Diseño.</p>}
        <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
          <Boton type="button" variante="fantasma" disabled={enviando} onClick={() => setAbierto(false)}>Cerrar</Boton>
          <Boton type="submit" cargando={enviando}>Guardar y enviar a Diseño</Boton>
        </div>
      </form>
    </TarjetaCuerpo>
  </Tarjeta>
}

const AREAS: Record<'MTZ' | 'PRD' | 'ACB', string> = {
  MTZ: 'Maestranza',
  PRD: 'Producción',
  ACB: 'Acabados',
}

const ETIQUETAS_ESTADO: Record<string, string> = {
  SOLICITADO: 'Solicitado',
  EN_COMPRA: 'En compra',
  EN_ALMACEN: 'En almacén',
  ATENDIDO: 'Entregado',
}

function SolicitudesPorArea({
  ordenId,
  materiales,
  areaPropia,
}: {
  ordenId: string
  materiales: MaterialDeOrden[]
  areaPropia: string | null
}) {
  const grupos = (Object.keys(AREAS) as (keyof typeof AREAS)[])
    .filter((area) => areaPropia === null || areaPropia === area)
    .map((area) => ({
      area,
      lineas: materiales.filter((m) => m.area_destino === area && !m.requerimiento_estado),
    }))
    .filter((grupo) => grupo.lineas.length > 0)

  if (grupos.length === 0) return null

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {grupos.map(({ area, lineas }) => (
        <SolicitarGrupo key={area} ordenId={ordenId} area={area} lineas={lineas} />
      ))}
    </div>
  )
}

function SolicitarGrupo({
  ordenId,
  area,
  lineas,
}: {
  ordenId: string
  area: keyof typeof AREAS
  lineas: MaterialDeOrden[]
}) {
  const { alEnviar, enviando, error } = useEnvio(crearRequerimiento)
  return (
    <Tarjeta>
      <TarjetaCuerpo className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-texto">{AREAS[area]}</p>
            <p className="mt-1 text-xs text-texto-suave">
              {lineas.length} {lineas.length === 1 ? 'material listo' : 'materiales listos'} para solicitar
            </p>
          </div>
          <span className="rounded-full bg-acento-suave p-2 text-acento">
            <ShoppingCart aria-hidden className="size-4" />
          </span>
        </div>
        <form onSubmit={alEnviar} className="space-y-2">
          <input type="hidden" name="orden_id" value={ordenId} />
          <input type="hidden" name="area_destino" value={area} />
          {lineas.map((linea) => <input key={linea.id} type="hidden" name="material_id" value={linea.id} />)}
          {error && <Error_ texto={error} />}
          <Boton type="submit" tamano="sm" cargando={enviando} className="w-full">
            <ArrowUpRight aria-hidden className="size-4" />
            Solicitar a Almacén
          </Boton>
        </form>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function Dato({ titulo, valor, pie }: { titulo: string; valor: string; pie: string }) {
  return (
    <div>
      <p className="text-xs text-texto-suave">{titulo}</p>
      <p className="text-2xl font-semibold tabular text-texto">{valor}</p>
      <p className="text-[11px] text-texto-suave">{pie}</p>
    </div>
  )
}

function AccionesLinea({ material, ordenId, catalogo }: { material: MaterialDeOrden; ordenId: string; catalogo: CatalogoMateriales }) {
  const [editando, setEditando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [areaDestino, setAreaDestino] = useState(material.area_destino)
  const { alEnviar, enviando, error } = useEnvio(cambiarCantidadMaterial, () => setEditando(false))
  const quitar = useEnvio(quitarMaterial, () => setConfirmando(false))

  // Quitar pregunta antes: el icono va pegado al lápiz y con guante se toca sin
  // querer, y una línea borrada hay que volver a buscarla en el catálogo.
  if (confirmando) {
    return (
      <form
        onSubmit={quitar.alEnviar}
        className="flex flex-wrap items-center gap-2 rounded-[var(--radius-base)] bg-peligro-suave px-2 py-1"
      >
        <input type="hidden" name="id" value={material.id} />
        <input type="hidden" name="orden_id" value={ordenId} />
        <span className="text-xs text-peligro">¿Quitar «{material.material}»?</span>
        <Boton type="submit" variante="peligro" tamano="sm" cargando={quitar.enviando}>
          Sí, quitar
        </Boton>
        <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setConfirmando(false)}>
          No
        </Boton>
        {quitar.error && <Error_ texto={quitar.error} />}
      </form>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Boton
        type="button"
        variante="fantasma"
        tamano="sm"
        aria-label={`Corregir la cantidad de ${material.material}`}
        onClick={() => setEditando(true)}
      >
        <Pencil aria-hidden className="size-4" />
      </Boton>
      <Ventana abierta={editando} alCerrar={() => { if (!enviando) setEditando(false) }}
        titulo={`Editar material · ${material.material}`}
        descripcion={`Plano ${material.numero_plano ?? 'sin número'} · ${material.plano_nombre ?? 'sin nombre'}`}>
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={material.id} />
          <input type="hidden" name="orden_id" value={ordenId} />
          <Campo etiqueta={`Cantidad (${material.unidad})`} htmlFor={`cantidad-${material.id}`} requerido>
            <Entrada id={`cantidad-${material.id}`} name="cantidad" type="number" inputMode="decimal"
              min={0.001} step="0.001" defaultValue={material.cantidad} required
              className="tabular text-right" />
          </Campo>
          <Campo etiqueta="Área que utilizará el material" htmlFor={`area-${material.id}`} requerido>
            <Seleccion id={`area-${material.id}`} name="area_destino" value={areaDestino} onChange={(e) => {
              const area = e.target.value
              if (area === 'PRD' || area === 'MTZ' || area === 'ACB') setAreaDestino(area)
            }}>
              {Object.entries(AREAS).map(([valor, etiqueta]) =>
                <option key={valor} value={valor}>{etiqueta}</option>)}
            </Seleccion>
          </Campo>
          <Campo etiqueta="Etapa vinculada" htmlFor={`etapa-${material.id}`}
            ayuda="Elige una etapa de la misma área, si ya está definida.">
            <Seleccion key={areaDestino} id={`etapa-${material.id}`} name="etapa_id"
              defaultValue={areaDestino === material.area_destino ? material.etapa_id ?? '' : ''}>
              <option value="">Sin etapa específica</option>
              {catalogo.etapas.filter((etapa) => etapa.areaCodigo === areaDestino).map((etapa) =>
                <option key={etapa.id} value={etapa.id}>{etapa.nombre}</option>)}
            </Seleccion>
          </Campo>
          {error && <Error_ texto={error} />}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="secundario" disabled={enviando} onClick={() => setEditando(false)}>Cancelar</Boton>
            <Boton type="submit" cargando={enviando}>Guardar material</Boton>
          </div>
        </form>
      </Ventana>
      <Boton
        type="button"
        variante="fantasma"
        tamano="sm"
        aria-label={`Quitar ${material.material} de la lista`}
        onClick={() => {
          quitar.limpiar()
          setConfirmando(true)
        }}
      >
        <Trash2 aria-hidden className="size-4 text-peligro" />
      </Boton>
    </div>
  )
}

function NuevoMaterial({
  ordenId,
  catalogo,
  yaEnLista,
  propuesta = false,
}: {
  ordenId: string
  catalogo: CatalogoMateriales
  yaEnLista: MaterialDeOrden[]
  propuesta?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [materialId, setMaterialId] = useState('')
  const [areaDestino, setAreaDestino] = useState<'PRD' | 'MTZ' | 'ACB'>('PRD')
  // Se queda abierto después de guardar: la lista de materiales de una unidad
  // son veinte líneas, y abrirlo cada vez eran veinte toques de más.
  const [guardados, setGuardados] = useState(0)
  const { alEnviar, enviando, error } = useEnvio(propuesta ? proponerMaterial : agregarMaterial, () => {
    setMaterialId('')
    setGuardados((g) => g + 1)
  })

  if (!abierto) {
    if (catalogo.planos.length === 0) return <p className="text-sm text-texto-suave">
      {propuesta ? 'Diseño debe aprobar y liberar un plano a tu área para solicitar materiales.' : 'Primero, Diseño debe crear un plano.'} Consulta <Link href={`/ordenes/${ordenId}?vista=planos`} className="font-medium text-acento underline">Planos</Link>.
    </p>
    return (
      <div className="flex justify-end">
        <Boton variante="secundario" tamano="sm" onClick={() => setAbierto(true)}>
          <Plus aria-hidden className="size-4" />
          {propuesta ? 'Proponer material a Diseño' : 'Agregar material'}
        </Boton>
      </div>
    )
  }

  const elegido = catalogo.materiales.find((m) => m.id === materialId)
  const repetido = yaEnLista.some((m) => m.material_id === materialId && !m.plano_id)

  return (
    <Tarjeta className="border-acento">
      <TarjetaCabecera
        titulo={propuesta ? 'Proponer material a Diseño' : 'Agregar material a la lista'}
        descripcion={propuesta ? 'Elige el plano y la cantidad que necesita tu área. Diseño revisará la propuesta antes de enviarla a Almacén.' : 'Qué necesita cada plano y cuánto. Si el material no está en el catálogo, se agrega en «Materiales» del menú.'}
      />
      <TarjetaCuerpo>
        <form key={guardados} onSubmit={alEnviar} className="grid gap-3 sm:grid-cols-6">
          <input type="hidden" name="orden_id" value={ordenId} />

          <Campo etiqueta="Material" htmlFor="nm-material" requerido className="sm:col-span-3">
            <SeleccionBuscable
              id="nm-material"
              name="material_id"
              requerido
              permiteVaciar={false}
              valor={materialId}
              onChange={setMaterialId}
              marcador="Busca el material"
              marcadorBusqueda="Código o descripción"
              opciones={catalogo.materiales.map((m) => ({
                valor: m.id,
                etiqueta: m.descripcion,
                detalle: [m.codigo, m.unidad].filter(Boolean).join(' · '),
              }))}
            />
          </Campo>

          <Campo
            etiqueta="Cantidad"
            htmlFor="nm-cantidad"
            requerido
            ayuda={elegido?.unidad ? `En ${elegido.unidad}` : 'Según su unidad'}
          >
            <Entrada
              id="nm-cantidad"
              name="cantidad"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.001"
              required
              className="tabular"
            />
          </Campo>

          <Campo etiqueta="Plano" htmlFor="nm-plano" requerido>
            <Seleccion id="nm-plano" name="plano_id" defaultValue="" required>
              <option value="" disabled>Elige el plano</option>
              {catalogo.planos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.numero_plano} · {p.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>

          {!propuesta && <Campo etiqueta="Etapa que usará el material" htmlFor="nm-etapa" ayuda="Opcional; solo se muestran etapas del área que lo recibirá.">
              <Seleccion key={areaDestino} id="nm-etapa" name="etapa_id" defaultValue="">
              <option value="">Sin etapa específica</option>
              {catalogo.etapas.filter((e) => e.areaCodigo === areaDestino).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                  {e.area ? ` · ${e.area}` : ''}
                </option>
              ))}
            </Seleccion>
          </Campo>}

          {!propuesta && <Campo etiqueta="Área que recibirá el material" htmlFor="nm-area" requerido className="sm:col-span-2">
            <Seleccion id="nm-area" name="area_destino" value={areaDestino} onChange={(e) => {
              const area = e.target.value
              if (area === 'PRD' || area === 'MTZ' || area === 'ACB') setAreaDestino(area)
            }} required>
              {Object.entries(AREAS).map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}
            </Seleccion>
          </Campo>}

          <Campo etiqueta="Observación" htmlFor="nm-obs" className="sm:col-span-6">
            <Entrada id="nm-obs" name="observacion" placeholder="Opcional: medida, corte, marca pedida" />
          </Campo>

          {repetido && (
            <p className="text-xs text-aviso sm:col-span-6">
              Ese material ya está en la lista como material de la unidad. Si es para un plano
              distinto, elige el plano; si no, corrige la cantidad en la tabla.
            </p>
          )}

          {error && (
            <div className="sm:col-span-6">
              <Error_ texto={error} />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-6">
            {guardados > 0 && (
              <span role="status" className="mr-auto text-xs font-medium text-exito">
                {guardados === 1 ? 'Agregado 1 material.' : `Agregados ${guardados} materiales.`} Sigue con el próximo o cierra.
              </span>
            )}
            <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierto(false)}>
              {guardados > 0 ? 'Listo' : 'Cancelar'}
            </Boton>
            <Boton type="submit" tamano="sm" cargando={enviando}>
              <PackagePlus aria-hidden className="size-4" />
              Agregar a la lista
            </Boton>
          </div>
        </form>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
