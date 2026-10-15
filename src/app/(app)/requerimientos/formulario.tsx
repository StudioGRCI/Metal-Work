'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import type { AreaParaRequerimiento, OpcionCatalogo } from '@/lib/datos/requerimientos'
import { TIPO_REQUERIMIENTO, type TipoRequerimiento } from '@/lib/dominio/requerimientos'
import { useEnvio } from '@/lib/envio'
import { hoyLima } from '@/lib/format'

import { emitirRequerimiento } from './acciones'

type Catalogos = {
  areas: AreaParaRequerimiento[]
  unidades: OpcionCatalogo[]
  categorias: OpcionCatalogo[]
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

function FormularioRequerimiento({
  areas,
  unidades,
  categorias,
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
  const [filas, setFilas] = useState<string[]>(() => [crypto.randomUUID()])
  const { alEnviar, enviando, error } = useEnvio(emitirRequerimiento, (r) => alTerminar(r.mensaje ?? 'Requerimiento registrado.'))
  const und = unidades.find((u) => u.codigo === 'UND')?.id ?? ''

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="operacion_id" value={id} />
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
        {filas.map((clave, i) => (
          <div key={clave} className="grid gap-2 rounded-lg border border-borde p-3 sm:grid-cols-[2fr_7rem_7rem_1.5fr_auto] sm:items-end">
            <Campo etiqueta={`Insumo ${i + 1}`} htmlFor={`rq-desc-${clave}`} requerido>
              <Entrada
                id={`rq-desc-${clave}`}
                name="descripcion"
                required
                minLength={3}
                maxLength={300}
                placeholder="Plancha LAF 2 mm 4x8"
                autoComplete="off"
              />
            </Campo>
            <Campo etiqueta="Cantidad" htmlFor={`rq-cant-${clave}`} requerido>
              <Entrada id={`rq-cant-${clave}`} name="cantidad" type="number" inputMode="decimal" min={0.001} step="0.001" required />
            </Campo>
            <Campo etiqueta="Unidad" htmlFor={`rq-und-${clave}`} requerido>
              <Seleccion id={`rq-und-${clave}`} name="unidad_medida_id" required defaultValue={und}>
                <option value="" disabled>
                  —
                </option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.codigo}
                  </option>
                ))}
              </Seleccion>
            </Campo>
            <Campo etiqueta="Categoría" htmlFor={`rq-cat-${clave}`} requerido>
              <Seleccion id={`rq-cat-${clave}`} name="categoria_id" required defaultValue="">
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
              variante="fantasma"
              tamano="icono"
              aria-label={`Quitar el insumo ${i + 1}`}
              disabled={filas.length === 1}
              onClick={() => setFilas((f) => f.filter((x) => x !== clave))}
            >
              <Trash2 aria-hidden className="size-4" />
            </Boton>
          </div>
        ))}
        <Boton
          type="button"
          variante="contorno"
          tamano="sm"
          disabled={filas.length >= 100}
          onClick={() => setFilas((f) => [...f, crypto.randomUUID()])}
        >
          <Plus aria-hidden className="size-4" />
          Agregar insumo
        </Boton>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Boton type="submit" cargando={enviando}>
          Registrar y mandar a Almacén
        </Boton>
      </div>
    </form>
  )
}
