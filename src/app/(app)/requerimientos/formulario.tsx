'use client'

import { PackagePlus, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { AreaParaRequerimiento, MaterialParaRequerimiento, OpcionCatalogo } from '@/lib/datos/requerimientos'
import { TIPO_REQUERIMIENTO, type TipoRequerimiento } from '@/lib/dominio/requerimientos'
import { useEnvio } from '@/lib/envio'
import { hoyLima } from '@/lib/format'

import { emitirRequerimiento } from './acciones'

type Catalogos = {
  areas: AreaParaRequerimiento[]
  unidades: OpcionCatalogo[]
  categorias: OpcionCatalogo[]
  /** El catálogo de Almacén: cada insumo se pide con uno de estos nombres. */
  materiales: MaterialParaRequerimiento[]
  /** Los requerimientos que esta persona registra: el de operación, el de Administración o los dos. */
  tipos: TipoRequerimiento[]
}

/** El botón «Nuevo requerimiento» y su ventana. */
export function NuevoRequerimiento(catalogos: Catalogos) {
  const soloAdministracion = catalogos.tipos.length === 1 && catalogos.tipos[0] === 'ADMINISTRACION'
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  return (
    <>
      <Boton
        type="button"
        onClick={() => {
          setAviso(null)
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <Plus aria-hidden className="size-4" />
        {soloAdministracion ? 'Nuevo requerimiento de Administración' : 'Nuevo requerimiento'}
      </Boton>
      {aviso && (
        <p role="status" className="basis-full text-sm text-exito">
          {aviso}
        </p>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={soloAdministracion ? 'Nuevo requerimiento de Administración' : 'Nuevo requerimiento'}
        descripcion={`Lo que un área necesita. El número lo pone el sistema y le llega primero a Almacén: lo que tiene lo separa y lo que falta lo compra ${
          soloAdministracion ? 'la administradora' : 'Logística'
        }.`}
        ancho="xl"
      >
        <FormularioRequerimiento
          key={vez}
          {...catalogos}
          alTerminar={(mensaje) => {
            setAbierta(false)
            setAviso(mensaje)
          }}
        />
      </Ventana>
    </>
  )
}

/** Un insumo mientras se llena: del catálogo, o un material nuevo con su nombre. */
type Insumo = {
  clave: string
  material_id: string
  nuevo: boolean
  descripcion: string
  cantidad: string
  unidad_medida_id: string
  categoria_id: string
}

function insumoVacio(): Insumo {
  return { clave: crypto.randomUUID(), material_id: '', nuevo: false, descripcion: '', cantidad: '', unidad_medida_id: '', categoria_id: '' }
}

function FormularioRequerimiento({
  areas,
  unidades,
  categorias,
  materiales,
  tipos,
  alTerminar,
}: Catalogos & { alTerminar: (mensaje: string) => void }) {
  // Cada área pide en un solo requerimiento: al cambiar el tipo cambia la lista.
  const [tipo, setTipo] = useState<TipoRequerimiento>(tipos[0] ?? 'OPERACION')
  const [areaId, setAreaId] = useState('')
  const delTipo = areas.filter((a) => a.requerimiento === tipo)
  // Decidido aquí: un reintento manda el mismo y la base no duplica el RQ.
  const [id] = useState(() => crypto.randomUUID())
  // Cada fila tiene su llave para que quitar una del medio no mezcle lo escrito.
  const [insumos, setInsumos] = useState<Insumo[]>(() => [insumoVacio()])
  const { alEnviar, enviando, error } = useEnvio(emitirRequerimiento, (r) => alTerminar(r.mensaje ?? 'Requerimiento registrado.'))
  const und = unidades.find((u) => u.codigo === 'UND')?.id ?? ''

  const porId = useMemo(() => new Map(materiales.map((m) => [m.id, m])), [materiales])
  const opciones = useMemo(
    () =>
      materiales.map((m) => ({
        valor: m.id,
        etiqueta: m.descripcion,
        detalle: [m.codigo, m.unidad_pendiente ? 'unidad por confirmar' : m.unidad, m.categoria].filter(Boolean).join(' · '),
      })),
    [materiales],
  )

  function cambiar(clave: string, cambios: Partial<Insumo>) {
    setInsumos((lista) => lista.map((x) => (x.clave === clave ? { ...x, ...cambios } : x)))
  }

  const completos = insumos.every((x) =>
    Number(x.cantidad) > 0 && (x.nuevo ? x.descripcion.trim().length >= 3 && x.unidad_medida_id && x.categoria_id : x.material_id),
  )

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="operacion_id" value={id} />
      <input
        type="hidden"
        name="lineas"
        value={JSON.stringify(
          insumos.map((x) =>
            x.nuevo
              ? { nuevo: true, descripcion: x.descripcion, cantidad: x.cantidad, unidad_medida_id: x.unidad_medida_id, categoria_id: x.categoria_id }
              : { material_id: x.material_id, cantidad: x.cantidad, unidad_medida_id: x.unidad_medida_id || null },
          ),
        )}
      />
      {tipos.length === 1 && <input type="hidden" name="tipo" value={tipo} />}
      <div className="grid gap-4 sm:grid-cols-2">
        {tipos.length > 1 && (
          <Campo etiqueta="Requerimiento" htmlFor="rq-tipo" requerido ayuda={TIPO_REQUERIMIENTO[tipo]?.descripcion}>
            <Seleccion
              id="rq-tipo"
              name="tipo"
              required
              value={tipo}
              onChange={(e) => {
                setTipo(e.target.value as TipoRequerimiento)
                setAreaId('')
              }}
            >
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {TIPO_REQUERIMIENTO[t]?.etiqueta ?? t}
                </option>
              ))}
            </Seleccion>
          </Campo>
        )}
        <Campo etiqueta="Área que lo necesita" htmlFor="rq-area" requerido>
          <Seleccion id="rq-area" name="area_id" required value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="" disabled>
              Elige el área
            </option>
            {delTipo.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo
          etiqueta="Código interno"
          htmlFor="rq-codigo"
          requerido
          ayuda={
            tipo === 'ADMINISTRACION'
              ? 'El de la unidad, si es para una. Si es para la oficina, escribe OFICINA.'
              : 'El de la unidad, por ejemplo PLA_SR_O4_1_26/28. Si no es para una unidad, escribe PLANTA.'
          }
        >
          <Entrada id="rq-codigo" name="codigo_interno" required minLength={2} maxLength={60} autoComplete="off" />
        </Campo>
        <Campo etiqueta="Se necesita para el" htmlFor="rq-fecha" ayuda="Opcional: el día en que el área lo necesita.">
          <Entrada id="rq-fecha" name="fecha_requerida" type="date" min={hoyLima()} />
        </Campo>
      </div>
      <Campo etiqueta="Justificación" htmlFor="rq-justificacion" requerido>
        <AreaTexto
          id="rq-justificacion"
          name="justificacion"
          required
          minLength={10}
          maxLength={1000}
          rows={2}
          placeholder="Para qué se necesita: por ejemplo, armado del chasis de la plataforma; el stock de planchas se acabó."
        />
      </Campo>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-texto">Insumos</legend>
        <p className="text-xs text-texto-suave">
          Elige cada insumo del catálogo de Almacén, con el nombre que usa Almacén. Si no está, pídelo como material nuevo: Almacén lo da de alta al revisarlo.
        </p>
        {insumos.map((x, i) => {
          const material = porId.get(x.material_id)
          // Solo se elige la unidad de un material nuevo o de uno con la unidad provisional.
          const eligeUnidad = x.nuevo || Boolean(material?.unidad_pendiente)
          return (
            <div key={x.clave} className="space-y-2 rounded-lg border border-borde p-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_7rem_7rem_auto] sm:items-end">
                {x.nuevo ? (
                  <Campo etiqueta={`Insumo ${i + 1} · material nuevo`} htmlFor={`rq-desc-${x.clave}`} requerido>
                    <Entrada
                      id={`rq-desc-${x.clave}`}
                      required
                      minLength={3}
                      maxLength={300}
                      placeholder="Nombre del material, como lo pediría a un proveedor"
                      autoComplete="off"
                      value={x.descripcion}
                      onChange={(e) => cambiar(x.clave, { descripcion: e.target.value })}
                    />
                  </Campo>
                ) : (
                  <Campo etiqueta={`Insumo ${i + 1}`} htmlFor={`rq-mat-${x.clave}`} requerido>
                    <SeleccionBuscable
                      id={`rq-mat-${x.clave}`}
                      requerido
                      valor={x.material_id}
                      onChange={(v) => cambiar(x.clave, { material_id: v, unidad_medida_id: porId.get(v)?.unidad_id ?? '' })}
                      marcador="Elige del catálogo de Almacén…"
                      marcadorBusqueda="Nombre o código del material…"
                      opciones={opciones.filter((o) => o.valor === x.material_id || !insumos.some((y) => y.material_id === o.valor))}
                    />
                  </Campo>
                )}
                <Campo etiqueta="Cantidad" htmlFor={`rq-cant-${x.clave}`} requerido>
                  <Entrada
                    id={`rq-cant-${x.clave}`}
                    type="number"
                    inputMode="decimal"
                    min={0.001}
                    step="0.001"
                    required
                    value={x.cantidad}
                    onChange={(e) => cambiar(x.clave, { cantidad: e.target.value })}
                  />
                </Campo>
                <Campo etiqueta="Unidad" htmlFor={`rq-und-${x.clave}`} requerido={eligeUnidad}>
                  {eligeUnidad ? (
                    <Seleccion
                      id={`rq-und-${x.clave}`}
                      required
                      value={x.unidad_medida_id}
                      onChange={(e) => cambiar(x.clave, { unidad_medida_id: e.target.value })}
                    >
                      <option value="" disabled>
                        —
                      </option>
                      {unidades.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.codigo}
                        </option>
                      ))}
                    </Seleccion>
                  ) : (
                    <p id={`rq-und-${x.clave}`} className="tabular flex min-h-10 items-center text-sm text-texto">
                      {material?.unidad || '—'}
                    </p>
                  )}
                </Campo>
                <Boton
                  type="button"
                  variante="fantasma"
                  tamano="icono"
                  aria-label={`Quitar el insumo ${i + 1}`}
                  disabled={insumos.length === 1}
                  onClick={() => setInsumos((lista) => lista.filter((y) => y.clave !== x.clave))}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Boton>
              </div>
              {x.nuevo ? (
                <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_auto] sm:items-end">
                  <Campo etiqueta="Categoría" htmlFor={`rq-cat-${x.clave}`} requerido>
                    <Seleccion
                      id={`rq-cat-${x.clave}`}
                      required
                      value={x.categoria_id}
                      onChange={(e) => cambiar(x.clave, { categoria_id: e.target.value })}
                    >
                      <option value="" disabled>
                        Elige la categoría
                      </option>
                      {categorias.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre}
                        </option>
                      ))}
                    </Seleccion>
                  </Campo>
                  <Boton
                    type="button"
                    variante="contorno"
                    tamano="sm"
                    onClick={() => cambiar(x.clave, { nuevo: false, descripcion: '', categoria_id: '', unidad_medida_id: '' })}
                  >
                    Buscar en el catálogo
                  </Boton>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-texto-suave">
                  <span>
                    {material
                      ? [material.codigo, material.categoria, material.unidad_pendiente ? 'unidad por confirmar: elige en cuál lo necesitas' : null]
                          .filter(Boolean)
                          .join(' · ')
                      : '¿No está en el catálogo?'}
                  </span>
                  <Boton
                    type="button"
                    variante="fantasma"
                    tamano="sm"
                    onClick={() => cambiar(x.clave, { nuevo: true, material_id: '', unidad_medida_id: und })}
                  >
                    <PackagePlus aria-hidden className="size-4" />
                    Pedirlo como material nuevo
                  </Boton>
                </div>
              )}
            </div>
          )
        })}
        <Boton
          type="button"
          variante="contorno"
          tamano="sm"
          disabled={insumos.length >= 100}
          onClick={() => setInsumos((lista) => [...lista, insumoVacio()])}
        >
          <Plus aria-hidden className="size-4" />
          Agregar insumo
        </Boton>
        {materiales.length === 0 && (
          <p className="text-sm text-texto-suave">El catálogo de Almacén está vacío: pide cada insumo como material nuevo.</p>
        )}
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Boton type="submit" cargando={enviando} disabled={!completos}>
          Registrar y mandar a Almacén
        </Boton>
      </div>
    </form>
  )
}
