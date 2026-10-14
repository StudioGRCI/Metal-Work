'use client'

import { Plus, Trash2, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { SelectorFotos, fotosParaEnviar, hayFallidas, haySubiendo, type FotoLista } from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { SeleccionBuscable, type OpcionBuscable } from '@/components/ui/seleccion-buscable'
import {
  BUCKET_FOTOS_REPORTE,
  MAXIMO_FOTOS_REPORTE,
  MAXIMO_MB_FOTO_REPORTE,
  MAXIMO_TRABAJOS_REPORTE,
} from '@/lib/dominio/reporte-diario'
import { horasCortas } from '@/lib/dominio/rrhh'
import { useEnvio } from '@/lib/envio'
import { cn } from '@/lib/utils'

import { registrarReporteDiario } from '../acciones'

export type OpcionPersona = OpcionBuscable

type FilaPersona = { clave: string; trabajadorId: string; horas: string }
type FilaTrabajo = { clave: string; descripcion: string; avance: string; personal: FilaPersona[] }

// Las filas que se agregan tocando llevan una clave al azar; las primeras, una
// fija, porque el servidor y el navegador tienen que pintar los mismos `id`.
const nuevaPersona = (clave: string = crypto.randomUUID()): FilaPersona => ({ clave, trabajadorId: '', horas: '' })
const nuevoTrabajo = (clave: string = crypto.randomUUID()): FilaTrabajo => ({
  clave,
  descripcion: '',
  avance: '',
  personal: [nuevaPersona(`${clave}-1`)],
})

/** «4,5» o «4.5» → 4.5; vacío → NaN. */
function horasDe(texto: string) {
  return texto.trim() === '' ? Number.NaN : Number(texto.replace(',', '.'))
}

/** Lo que se manda de una lista de personas: las filas vacías se ignoran, las a medias van y la base las rechaza con su motivo. */
function paraEnviar(filas: FilaPersona[]) {
  return filas
    .filter((p) => p.trabajadorId || p.horas.trim())
    .map((p) => ({ trabajador_id: p.trabajadorId, horas: horasDe(p.horas) }))
}

/**
 * El reporte diario del supervisor, pensado para el teléfono: arriba lo que
 * cuenta el reporte y su código interno, después cada trabajo con su avance y
 * su gente, y al final las fotos. El personal sale de la lista de RR. HH.; con
 * «Personal general» se pone una sola vez para todo el reporte.
 *
 * El id del reporte llega del servidor con la página: las fotos viajan a
 * `{cuenta}/{reporte}/…` antes de que el reporte exista, y un reintento manda
 * el mismo y no duplica. Sacarlo con `crypto.randomUUID()` en el navegador daba
 * uno distinto al que pintó el servidor, y el campo oculto se quedaba con el
 * del servidor mientras las fotos subían con el otro.
 */
export function FormularioReporteDiario({
  id,
  cuentaId,
  hoy,
  minimo,
  personal,
  codigos,
}: {
  id: string
  cuentaId: string
  hoy: string
  minimo: string
  personal: OpcionPersona[]
  codigos: string[]
}) {
  const router = useRouter()
  const [trabajos, setTrabajos] = useState<FilaTrabajo[]>(() => [nuevoTrabajo('trabajo-1')])
  const [general, setGeneral] = useState(false)
  const [personalGeneral, setPersonalGeneral] = useState<FilaPersona[]>(() => [nuevaPersona('general-1')])
  const [fotos, setFotos] = useState<FotoLista[]>([])
  const { alEnviar, enviando, error } = useEnvio(
    registrarReporteDiario,
    (r) => router.push(`/reportes-diarios/${r.datos?.id ?? id}?subido=1`),
    { refrescar: false },
  )

  const nombres = new Map(personal.map((p) => [p.valor, p.etiqueta]))
  // Lo que cada persona suma en todo el reporte: el tope del día es 16 horas.
  const lineas = general ? personalGeneral : trabajos.flatMap((t) => t.personal)
  const porPersona = new Map<string, number>()
  for (const l of lineas) {
    const h = horasDe(l.horas)
    if (l.trabajadorId && Number.isFinite(h)) porPersona.set(l.trabajadorId, (porPersona.get(l.trabajadorId) ?? 0) + h)
  }
  const totalHoras = [...porPersona.values()].reduce((n, h) => n + h, 0)
  const sinPersonal = personal.length === 0
  const subiendo = haySubiendo(fotos)
  const fallidas = hayFallidas(fotos)

  function cambiarTrabajo(clave: string, cambio: Partial<FilaTrabajo>) {
    setTrabajos((ts) => ts.map((t) => (t.clave === clave ? { ...t, ...cambio } : t)))
  }

  return (
    <form
      onSubmit={(e) =>
        alEnviar(e, (datos) => {
          datos.set(
            'trabajos',
            JSON.stringify(
              trabajos.map((t) => ({
                descripcion: t.descripcion,
                avance: t.avance.trim() === '' ? null : Number(t.avance),
                personal: general ? [] : paraEnviar(t.personal),
              })),
            ),
          )
          datos.set('personal', JSON.stringify(general ? paraEnviar(personalGeneral) : []))
          datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos).map((f) => f.ruta_storage)))
        })
      }
      className="space-y-6"
    >
      <input type="hidden" name="id" value={id} />

      <section aria-labelledby="rd-cabecera" className="space-y-4">
        <h2 id="rd-cabecera" className="text-sm font-semibold text-texto">
          El reporte
        </h2>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Campo etiqueta="Día" htmlFor="rd-fecha" requerido>
            <Entrada id="rd-fecha" name="fecha" type="date" required defaultValue={hoy} min={minimo} max={hoy} />
          </Campo>
          <Campo
            etiqueta="Código interno"
            htmlFor="rd-codigo"
            requerido
            ayuda="El de la unidad, por ejemplo PLA_SR_O4_1_26/28; PLANTA si no es para una unidad. Si trabajaste en dos códigos, sube dos reportes."
          >
            <Entrada
              id="rd-codigo"
              name="codigo_interno"
              required
              minLength={2}
              maxLength={60}
              list="rd-codigos"
              autoComplete="off"
              autoCapitalize="characters"
              className="font-mono uppercase"
            />
            <datalist id="rd-codigos">
              {codigos.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Campo>
        </div>
        <Campo etiqueta="Asunto" htmlFor="rd-asunto" requerido>
          <Entrada
            id="rd-asunto"
            name="asunto"
            required
            minLength={3}
            maxLength={120}
            placeholder="Por ejemplo: armado de la tolva"
            autoComplete="off"
          />
        </Campo>
        <Campo etiqueta="Breve descripción" htmlFor="rd-descripcion" requerido>
          <AreaTexto
            id="rd-descripcion"
            name="descripcion"
            required
            minLength={3}
            maxLength={1000}
            rows={2}
            placeholder="Lo que pasó hoy en este código: qué se avanzó, qué falta, si algo trabó el trabajo."
          />
        </Campo>
      </section>

      <section aria-labelledby="rd-trabajos" className="space-y-3">
        <h2 id="rd-trabajos" className="text-sm font-semibold text-texto">
          Trabajos realizados
        </h2>
        {trabajos.map((t, i) => (
          <fieldset key={t.clave} className="min-w-0 space-y-3 rounded-lg border border-borde p-3" data-trabajo={i + 1}>
            <legend className="sr-only">Trabajo {i + 1}</legend>
            <div className="flex items-center justify-between gap-2">
              <p aria-hidden className="text-sm font-medium text-texto">
                Trabajo {i + 1}
              </p>
              <Boton
                type="button"
                variante="fantasma"
                tamano="icono"
                aria-label={`Quitar el trabajo ${i + 1}`}
                disabled={trabajos.length === 1}
                onClick={() => setTrabajos((ts) => ts.filter((x) => x.clave !== t.clave))}
              >
                <Trash2 aria-hidden className="size-4" />
              </Boton>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
              <Campo etiqueta="Descripción del trabajo" htmlFor={`rd-trabajo-${t.clave}`} requerido>
                <AreaTexto
                  id={`rd-trabajo-${t.clave}`}
                  required
                  minLength={3}
                  maxLength={500}
                  rows={2}
                  value={t.descripcion}
                  onChange={(e) => cambiarTrabajo(t.clave, { descripcion: e.target.value })}
                  placeholder="Descripción del trabajo: por ejemplo, soldadura de la tolva lado izquierdo"
                />
              </Campo>
              <Campo etiqueta="Avance %" htmlFor={`rd-avance-${t.clave}`} requerido className="max-w-32 sm:max-w-none">
                <Entrada
                  id={`rd-avance-${t.clave}`}
                  type="number"
                  inputMode="numeric"
                  required
                  min={0}
                  max={100}
                  step={1}
                  value={t.avance}
                  onChange={(e) => cambiarTrabajo(t.clave, { avance: e.target.value })}
                  className="tabular"
                />
              </Campo>
            </div>
            {!general && (
              <ListaPersonal
                titulo={`Personal del trabajo ${i + 1}`}
                filas={t.personal}
                alCambiar={(personal) => cambiarTrabajo(t.clave, { personal })}
                opciones={personal}
                deshabilitado={sinPersonal}
              />
            )}
          </fieldset>
        ))}
        <Boton
          type="button"
          variante="contorno"
          tamano="sm"
          disabled={trabajos.length >= MAXIMO_TRABAJOS_REPORTE}
          onClick={() => setTrabajos((ts) => [...ts, nuevoTrabajo()])}
        >
          <Plus aria-hidden className="size-4" />
          Agregar trabajo
        </Boton>
      </section>

      <section aria-labelledby="rd-personal" className="space-y-3">
        <h2 id="rd-personal" className="text-sm font-semibold text-texto">
          Personal
        </h2>
        {sinPersonal ? (
          <p role="alert" className="rounded-lg border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto">
            Recursos Humanos todavía no registró al personal. Sin esa lista no se pueden cargar las horas: pídele que registre a tu
            gente en Personal.
          </p>
        ) : (
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-borde px-3 py-2.5">
            <input
              type="checkbox"
              name="personal_general"
              value="si"
              checked={general}
              onChange={(e) => setGeneral(e.target.checked)}
              className="mt-0.5 size-5 accent-[var(--acento)]"
            />
            <span>
              <span className="block text-sm font-medium text-texto">Personal general para todo el reporte</span>
              <span className="block text-xs text-texto-suave">
                Márcalo si la misma gente trabajó en todo lo del reporte: la pones una sola vez, con sus horas, en lugar de en cada
                trabajo.
              </span>
            </span>
          </label>
        )}
        {general && (
          <ListaPersonal
            titulo="Personal general del reporte"
            filas={personalGeneral}
            alCambiar={setPersonalGeneral}
            opciones={personal}
            deshabilitado={sinPersonal}
          />
        )}
        {porPersona.size > 0 && (
          <div className="rounded-lg bg-superficie-2 px-3 py-2 text-xs text-texto-suave" aria-live="polite">
            <p className="font-medium text-texto">
              <Users aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
              {porPersona.size} {porPersona.size === 1 ? 'persona' : 'personas'} · <span className="tabular">{horasCortas(totalHoras)}</span> en
              total
            </p>
            <ul className="mt-1 space-y-0.5">
              {[...porPersona.entries()].map(([persona, horas]) => (
                <li key={persona} className={cn(horas > 16 && 'font-medium text-peligro')}>
                  {nombres.get(persona) ?? 'Persona'}: <span className="tabular">{horasCortas(horas)}</span>
                  {horas > 16 && ' — pasa de 16 horas en el día'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="rd-fotos" className="space-y-2">
        <h2 id="rd-fotos" className="text-sm font-semibold text-texto">
          Fotos del trabajo
        </h2>
        <SelectorFotos
          fotos={fotos}
          alCambiar={setFotos}
          prefijoRuta={`${cuentaId}/${id}`}
          maximo={MAXIMO_FOTOS_REPORTE}
          bucket={BUCKET_FOTOS_REPORTE}
          comprimir
          maximoMb={MAXIMO_MB_FOTO_REPORTE}
          titulo={null}
        />
      </section>

      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      {fallidas && !subiendo && (
        <p className="text-sm text-peligro">Quita o vuelve a subir las fotos que no entraron antes de subir el reporte.</p>
      )}
      <div className="flex justify-end">
        <Boton type="submit" cargando={enviando} disabled={sinPersonal || subiendo || fallidas} className="w-full sm:w-auto">
          {subiendo ? 'Esperando las fotos…' : 'Subir reporte'}
        </Boton>
      </div>
    </form>
  )
}

/** Las personas de un trabajo (o del reporte entero), cada una con sus horas. */
function ListaPersonal({
  titulo,
  filas,
  alCambiar,
  opciones,
  deshabilitado,
}: {
  titulo: string
  filas: FilaPersona[]
  alCambiar: (filas: FilaPersona[]) => void
  opciones: OpcionPersona[]
  deshabilitado: boolean
}) {
  function cambiar(clave: string, cambio: Partial<FilaPersona>) {
    alCambiar(filas.map((p) => (p.clave === clave ? { ...p, ...cambio } : p)))
  }

  return (
    <div className="space-y-2" role="group" aria-label={titulo}>
      <p className="text-xs font-medium text-texto-suave">{titulo}</p>
      {filas.map((p, i) => {
        // Quien ya está en otra fila de esta lista no se ofrece de nuevo.
        const elegidas = new Set(filas.filter((x) => x.clave !== p.clave).map((x) => x.trabajadorId))
        return (
          // En el teléfono el nombre va a lo ancho y las horas debajo: al lado, el nombre se cortaba en «Prue…».
          <div key={p.clave} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <SeleccionBuscable
              className="basis-full sm:basis-0 sm:flex-1"
              opciones={opciones.filter((o) => !elegidas.has(o.valor))}
              valor={p.trabajadorId}
              onChange={(valor) => cambiar(p.clave, { trabajadorId: valor })}
              marcador="Elige a la persona"
              marcadorBusqueda="Nombre o cargo…"
              etiquetaAccesible={`${titulo}: persona ${i + 1}`}
              deshabilitado={deshabilitado}
            />
            <Entrada
              type="number"
              inputMode="decimal"
              min={0.25}
              max={16}
              step={0.25}
              placeholder="Horas"
              aria-label={`${titulo}: horas de la persona ${i + 1}`}
              value={p.horas}
              onChange={(e) => cambiar(p.clave, { horas: e.target.value })}
              required={Boolean(p.trabajadorId)}
              disabled={deshabilitado}
              className="tabular w-24 flex-none"
            />
            <span aria-hidden className="-ml-1 text-sm text-texto-suave">
              h
            </span>
            <Boton
              type="button"
              variante="fantasma"
              tamano="icono"
              aria-label={`Quitar a la persona ${i + 1}`}
              disabled={filas.length === 1}
              onClick={() => alCambiar(filas.filter((x) => x.clave !== p.clave))}
            >
              <Trash2 aria-hidden className="size-4" />
            </Boton>
          </div>
        )
      })}
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        disabled={deshabilitado || filas.length >= 60}
        onClick={() => alCambiar([...filas, nuevaPersona()])}
      >
        <Plus aria-hidden className="size-4" />
        Agregar persona
      </Boton>
    </div>
  )
}
