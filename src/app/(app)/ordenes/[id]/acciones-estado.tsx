'use client'

import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { useEnvio } from '@/lib/envio'

import { cambiarEstadoOrden, registrarEntrega } from '../acciones'

type Transicion = {
  estado: string
  etiqueta: string
  /** Basta con uno de estos, que es lo mismo que exige la base. */
  permisos: string[]
  /** Pide un motivo, que queda en la trazabilidad. */
  motivo?: boolean
  /** Pregunta antes, diciendo qué pasa: el cambio no se deshace con otro toque. */
  confirmar?: string
}

/**
 * Transiciones que la interfaz ofrece desde cada estado. Es un espejo de
 * ot_transicion_valida y de fn_ot_permiso_por_estado en la base: aquí solo
 * decide qué botones se ven, y la base sigue siendo la que garantiza que el
 * cambio es legítimo.
 */
const SIGUIENTES: Record<string, Transicion[]> = {
  BORRADOR: [
    {
      estado: 'APROBADA',
      etiqueta: 'Aprobar orden',
      permisos: ['ordenes.aprobar'],
      confirmar: 'Al aprobarla nacen sus etapas y sus plazos, y el taller ya puede trabajar en ella.',
    },
    { estado: 'ANULADA', etiqueta: 'Anular', permisos: ['ordenes.anular'], motivo: true },
  ],
  APROBADA: [
    { estado: 'PROGRAMADA', etiqueta: 'Programar', permisos: ['ordenes.cambiar_estado'] },
    { estado: 'EN_PROCESO', etiqueta: 'Iniciar trabajo', permisos: ['ordenes.cambiar_estado'] },
    { estado: 'ANULADA', etiqueta: 'Anular', permisos: ['ordenes.anular'], motivo: true },
  ],
  PROGRAMADA: [
    { estado: 'EN_PROCESO', etiqueta: 'Iniciar trabajo', permisos: ['ordenes.cambiar_estado'] },
    { estado: 'ANULADA', etiqueta: 'Anular', permisos: ['ordenes.anular'], motivo: true },
  ],
  EN_PROCESO: [
    { estado: 'PAUSADA', etiqueta: 'Pausar', permisos: ['ordenes.cambiar_estado'], motivo: true },
    {
      estado: 'TERMINADA',
      etiqueta: 'Terminar',
      permisos: ['ordenes.cambiar_estado'],
      confirmar: 'La orden queda terminada y deja de correr su plazo. Si después falta algo, se reabre como retrabajo.',
    },
  ],
  PAUSADA: [{ estado: 'EN_PROCESO', etiqueta: 'Reanudar', permisos: ['ordenes.cambiar_estado'] }],
  // CONTROL_CALIDAD sigue en el enum de la base pero ya no se llega a él:
  // el módulo de calidad se retiró. Si una orden vieja lo tuviera, se termina.
  CONTROL_CALIDAD: [
    {
      estado: 'TERMINADA',
      etiqueta: 'Terminar',
      permisos: ['ordenes.cambiar_estado'],
      confirmar: 'La orden queda terminada y deja de correr su plazo.',
    },
  ],
  TERMINADA: [{ estado: 'EN_PROCESO', etiqueta: 'Reabrir para retrabajo', permisos: ['ordenes.cambiar_estado'] }],
  // ENTREGADA no figura como transición a propósito: no se alcanza cambiando el
  // estado -la base rechaza ese UPDATE- sino registrando el acta de conformidad.
  // Facturada la marca la oficina (migración 110); el taller que ya cambiaba
  // estados sigue pudiendo.
  ENTREGADA: [
    {
      estado: 'FACTURADA',
      etiqueta: 'Marcar facturada',
      permisos: ['ordenes.editar', 'ordenes.cambiar_estado'],
      confirmar: 'Facturada es el último estado de la orden: no tiene vuelta atrás.',
    },
  ],
}

function Falla({ texto }: { texto: string | null }) {
  if (!texto) return null
  return (
    <p role="alert" className="w-full rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
      {texto}
    </p>
  )
}

export function AccionesEstado({
  orden,
  permisos,
  esAdmin,
}: {
  /** `abiertaEnTaller`: la abrió el taller; por revisar, la aprueba o rechaza el jefe de producción. */
  orden: { id: string; estado: string; abiertaEnTaller?: boolean | null }
  permisos: string[]
  esAdmin: boolean
}) {
  // Lo que pide motivo o confirmación se hace en una ventana. Cada apertura la
  // monta de nuevo (`vez`): así no arrastra el error ni el texto de la anterior.
  const [pendiente, setPendiente] = useState<Transicion | null>(null)
  const [entregando, setEntregando] = useState(false)
  const [vez, setVez] = useState(0)

  // Por revisar: el jefe de producción la aprueba o la rechaza con
  // `ordenes.revisar_taller`, el mismo atajo que tiene la base (migración 098).
  // Rechazarla es anularla con motivo, pero se dice como lo que es.
  const porRevisar = Boolean(orden.abiertaEnTaller) && orden.estado === 'BORRADOR'
  const revisa = porRevisar && permisos.includes('ordenes.revisar_taller')

  const disponibles = (SIGUIENTES[orden.estado] ?? [])
    .filter(
      (t) =>
        esAdmin ||
        t.permisos.some((p) => permisos.includes(p)) ||
        (revisa && (t.estado === 'APROBADA' || t.estado === 'ANULADA')),
    )
    .map((t) => (porRevisar && t.estado === 'ANULADA' ? { ...t, etiqueta: 'Rechazar' } : t))

  // La entrega solo tiene sentido con la orden terminada, y es la única acción
  // que no cambia el estado sino que registra un documento.
  const puedeEntregar = orden.estado === 'TERMINADA' && (esAdmin || permisos.includes('ordenes.entregar'))

  if (disponibles.length === 0 && !puedeEntregar) return null

  function abrir(t: Transicion) {
    setVez((v) => v + 1)
    setPendiente(t)
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {disponibles.map((t) =>
          t.motivo || t.confirmar ? (
            <Boton
              key={t.estado}
              tamano="sm"
              variante={t.estado === 'ANULADA' ? 'peligro' : t.estado === 'APROBADA' ? 'primario' : 'secundario'}
              onClick={() => abrir(t)}
            >
              {t.etiqueta}
            </Boton>
          ) : (
            <BotonDirecto key={t.estado} ordenId={orden.id} transicion={t} />
          ),
        )}

        {puedeEntregar && (
          <Boton
            variante="primario"
            tamano="sm"
            onClick={() => {
              setVez((v) => v + 1)
              setEntregando(true)
            }}
          >
            Registrar entrega
          </Boton>
        )}
      </div>

      <VentanaEntrega key={`entrega-${vez}`} ordenId={orden.id} abierta={entregando} alCerrar={() => setEntregando(false)} />

      <VentanaCambio
        key={`cambio-${vez}`}
        ordenId={orden.id}
        estadoActual={orden.estado}
        transicion={pendiente}
        alCerrar={() => setPendiente(null)}
      />
    </div>
  )
}

/** Un cambio de estado de un toque, con su propio «enviando» y su propio error. */
function BotonDirecto({ ordenId, transicion: t }: { ordenId: string; transicion: Transicion }) {
  const { alEnviar, enviando, error } = useEnvio(cambiarEstadoOrden)

  return (
    <form onSubmit={alEnviar} className="contents">
      <input type="hidden" name="orden_id" value={ordenId} />
      <input type="hidden" name="estado" value={t.estado} />
      <Boton type="submit" tamano="sm" cargando={enviando} variante={t.estado === 'EN_PROCESO' ? 'primario' : 'secundario'}>
        {t.etiqueta}
      </Boton>
      <Falla texto={error} />
    </form>
  )
}

/**
 * El cambio que pide motivo o confirmación. La ventana se cierra solo cuando la
 * base aceptó: si rechaza —una etapa sin terminar, un permiso que no alcanza—
 * el error sale acá, junto al motivo, y el motivo se queda escrito.
 */
function VentanaCambio({
  ordenId,
  estadoActual,
  transicion: t,
  alCerrar,
}: {
  ordenId: string
  estadoActual: string
  transicion: Transicion | null
  alCerrar: () => void
}) {
  const { alEnviar, enviando, error } = useEnvio(cambiarEstadoOrden, alCerrar)

  return (
    <Ventana
      abierta={t !== null}
      alCerrar={alCerrar}
      titulo={t ? `${t.etiqueta} · ${definir(ESTADO_OT, estadoActual).etiqueta}` : ''}
      descripcion={
        t?.motivo
          ? 'Este cambio queda registrado en la trazabilidad de la orden. Indica el motivo.'
          : (t?.confirmar ?? '')
      }
      ancho="sm"
    >
      <form onSubmit={alEnviar} className="space-y-3">
        <input type="hidden" name="orden_id" value={ordenId} />
        <input type="hidden" name="estado" value={t?.estado ?? ''} />

        {t?.motivo && (
          <Campo etiqueta="Motivo" htmlFor="motivo" requerido>
            <AreaTexto
              id="motivo"
              name="motivo"
              required
              minLength={3}
              autoFocus
              placeholder="Ej.: falta plancha de 6 mm, se espera ingreso el lunes"
            />
          </Campo>
        )}

        <Falla texto={error} />

        <div className="flex justify-end gap-2">
          <Boton type="button" variante="fantasma" tamano="sm" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton
            type="submit"
            tamano="sm"
            cargando={enviando}
            variante={t?.estado === 'ANULADA' ? 'peligro' : 'primario'}
          >
            {t?.motivo ? 'Confirmar' : (t?.etiqueta ?? 'Confirmar')}
          </Boton>
        </div>
      </form>
    </Ventana>
  )
}

/**
 * El acta de conformidad. Igual que arriba: la ventana se cierra cuando la base
 * aceptó el acta. Antes se cerraba al enviar, y si faltaba la liberación de
 * tesorería se perdían el nombre, el documento y las observaciones de quien
 * recibía, con el error lejos, en la cabecera.
 */
function VentanaEntrega({ ordenId, abierta, alCerrar }: { ordenId: string; abierta: boolean; alCerrar: () => void }) {
  const { alEnviar, enviando, error } = useEnvio(registrarEntrega, alCerrar)

  return (
    <Ventana
      abierta={abierta}
      alCerrar={alCerrar}
      titulo="Acta de conformidad"
      descripcion="Al registrar el acta la orden queda entregada. Si falta documentación obligatoria o firmas, el sistema lo avisa y no la cierra."
      ancho="sm"
    >
      <form onSubmit={alEnviar} className="space-y-3">
        <input type="hidden" name="orden_id" value={ordenId} />

        {/* `autoComplete="off"` en los tres: quien llena el acta es el
            del taller, y el navegador le ofrece su propio nombre y su
            propio DNI para el campo de quien retira la unidad. Ese dato
            mal puesto queda firmado en el acta de conformidad. */}
        <Campo etiqueta="Quién recibe" htmlFor="recibe_nombre" requerido>
          <Entrada
            id="recibe_nombre"
            name="recibe_nombre"
            required
            autoComplete="off"
            placeholder="Nombre completo de quien retira la unidad"
          />
        </Campo>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Documento" htmlFor="recibe_documento">
            <Entrada id="recibe_documento" name="recibe_documento" autoComplete="off" inputMode="numeric" placeholder="DNI" />
          </Campo>
          <Campo etiqueta="Cargo" htmlFor="recibe_cargo">
            <Entrada id="recibe_cargo" name="recibe_cargo" autoComplete="off" placeholder="Ej.: jefe de flota" />
          </Campo>
        </div>

        <Campo etiqueta="Garantía (meses)" htmlFor="garantia_meses">
          <Entrada id="garantia_meses" name="garantia_meses" type="number" inputMode="numeric" min={0} max={120} defaultValue={12} />
        </Campo>

        <Campo etiqueta="Observaciones" htmlFor="obs_entrega">
          <AreaTexto id="obs_entrega" name="observaciones" rows={2} placeholder="Novedades de la entrega, si las hubo" />
        </Campo>

        <Falla texto={error} />

        <div className="flex justify-end gap-2">
          <Boton type="button" variante="fantasma" tamano="sm" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" tamano="sm" variante="primario" cargando={enviando}>
            Registrar entrega
          </Boton>
        </div>
      </form>
    </Ventana>
  )
}
