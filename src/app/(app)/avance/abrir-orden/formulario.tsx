'use client'

import { useRouter } from 'next/navigation'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { useEnvio } from '@/lib/envio'

import { abrirOrdenDelTaller } from './acciones'

const TIPOS_VEHICULO = [
  ['VOLQUETE', 'Volquete'],
  ['TRACTO', 'Tracto'],
  ['SEMIRREMOLQUE', 'Semirremolque'],
  ['CAMION', 'Camión'],
  ['REMOLQUE', 'Remolque'],
  ['FURGON', 'Furgón'],
  ['OTRO', 'Otro'],
] as const

const TIPOS_TRABAJO = [
  ['REPARACION', 'Reparación'],
  ['MANTENIMIENTO', 'Mantenimiento'],
  ['REPOTENCIACION', 'Repotenciación'],
  ['FABRICACION', 'Fabricación'],
  ['GARANTIA', 'Garantía'],
] as const

const PRIORIDADES = [
  ['NORMAL', 'Normal'],
  ['ALTA', 'Alta'],
  ['URGENTE', 'Urgente'],
  ['BAJA', 'Baja'],
] as const

/**
 * Lo mínimo para que la orden exista: qué unidad y qué hay que hacer. Sin
 * cliente: el taller no lo ve ni lo maneja (migración 100). Si la placa ya
 * está registrada, la orden se cuelga de esa unidad —y de su cliente, si lo
 * tiene— y la marca y el modelo no hacen falta; si no, la unidad se registra
 * con ellos y la oficina le pone el cliente después.
 *
 * Al abrirla la pantalla se va a la orden, a la pestaña de actividades: lo
 * siguiente es armar la lista del área, mientras el jefe la revisa.
 */
export function FormularioOrdenTaller() {
  const router = useRouter()
  const { alEnviar, enviando, resultado, error } = useEnvio(
    abrirOrdenDelTaller,
    (r) => {
      if (r.datos) router.push(`/ordenes/${r.datos.id}?vista=actividades&abierta=1`)
    },
    { refrescar: false },
  )
  const sinAbrir = resultado?.ok && !resultado.datos

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Placa" htmlFor="ot-placa" ayuda="Como está en la tarjeta. Si ya está registrada, se usa esa unidad.">
          <Entrada
            id="ot-placa"
            name="placa"
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="ABC-123"
            maxLength={20}
          />
        </Campo>
        <Campo etiqueta="Tipo de vehículo" htmlFor="ot-tipo-vehiculo">
          <Seleccion id="ot-tipo-vehiculo" name="tipo_vehiculo" defaultValue="VOLQUETE">
            {TIPOS_VEHICULO.map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </Seleccion>
        </Campo>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Marca" htmlFor="ot-marca" ayuda="Si todavía no tiene placa, marca y modelo le dan nombre">
          <Entrada id="ot-marca" name="marca" autoComplete="off" placeholder="Volvo" maxLength={80} />
        </Campo>
        <Campo etiqueta="Modelo" htmlFor="ot-modelo">
          <Entrada id="ot-modelo" name="modelo" autoComplete="off" placeholder="FMX 8x4" maxLength={80} />
        </Campo>
      </div>

      <Campo etiqueta="Qué hay que hacer" htmlFor="ot-trabajo" requerido>
        <AreaTexto
          id="ot-trabajo"
          name="trabajo"
          rows={3}
          required
          placeholder="Cambio de planchas del piso de la tolva y soldadura de la compuerta posterior."
        />
      </Campo>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Tipo de trabajo" htmlFor="ot-tipo-trabajo">
          <Seleccion id="ot-tipo-trabajo" name="tipo_trabajo" defaultValue="REPARACION">
            {TIPOS_TRABAJO.map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Prioridad" htmlFor="ot-prioridad">
          <Seleccion id="ot-prioridad" name="prioridad" defaultValue="NORMAL">
            {PRIORIDADES.map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </Seleccion>
        </Campo>
      </div>

      {(error || sinAbrir) && (
        <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
          {error ?? 'La orden se abrió pero no se pudo mostrar: búscala en Órdenes de trabajo.'}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <EnlaceBoton href="/avance" variante="contorno">
          Cancelar
        </EnlaceBoton>
        <Boton type="submit" tamano="lg" cargando={enviando} className="w-full sm:w-auto">
          Abrir la orden
        </Boton>
      </div>
    </form>
  )
}
