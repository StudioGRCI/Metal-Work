'use client'

import { useActionState, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { cambiarEstadoOrden, registrarEntrega } from '../acciones'

/**
 * Transiciones que la interfaz ofrece desde cada estado. Es un espejo de
 * ot_transicion_valida en la base: aquí solo decide qué botones se ven, y la
 * base sigue siendo la que garantiza que el cambio es legítimo.
 */
const SIGUIENTES: Record<string, { estado: string; etiqueta: string; permiso: string; motivo?: boolean }[]> = {
  BORRADOR: [
    { estado: 'APROBADA', etiqueta: 'Aprobar orden', permiso: 'ordenes.aprobar' },
    { estado: 'ANULADA', etiqueta: 'Anular', permiso: 'ordenes.anular', motivo: true },
  ],
  APROBADA: [
    { estado: 'PROGRAMADA', etiqueta: 'Programar', permiso: 'ordenes.cambiar_estado' },
    { estado: 'EN_PROCESO', etiqueta: 'Iniciar trabajo', permiso: 'ordenes.cambiar_estado' },
    { estado: 'ANULADA', etiqueta: 'Anular', permiso: 'ordenes.anular', motivo: true },
  ],
  PROGRAMADA: [
    { estado: 'EN_PROCESO', etiqueta: 'Iniciar trabajo', permiso: 'ordenes.cambiar_estado' },
    { estado: 'ANULADA', etiqueta: 'Anular', permiso: 'ordenes.anular', motivo: true },
  ],
  EN_PROCESO: [
    { estado: 'PAUSADA', etiqueta: 'Pausar', permiso: 'ordenes.cambiar_estado', motivo: true },
    { estado: 'CONTROL_CALIDAD', etiqueta: 'Enviar a calidad', permiso: 'ordenes.cambiar_estado' },
    { estado: 'TERMINADA', etiqueta: 'Terminar', permiso: 'ordenes.cambiar_estado' },
  ],
  PAUSADA: [{ estado: 'EN_PROCESO', etiqueta: 'Reanudar', permiso: 'ordenes.cambiar_estado' }],
  CONTROL_CALIDAD: [
    { estado: 'EN_PROCESO', etiqueta: 'Devolver a taller', permiso: 'ordenes.cambiar_estado' },
    { estado: 'TERMINADA', etiqueta: 'Terminar', permiso: 'ordenes.cambiar_estado' },
  ],
  TERMINADA: [{ estado: 'EN_PROCESO', etiqueta: 'Reabrir para retrabajo', permiso: 'ordenes.cambiar_estado' }],
  // ENTREGADA no figura como transición a propósito: no se alcanza cambiando el
  // estado -la base rechaza ese UPDATE- sino registrando el acta de conformidad.
  ENTREGADA: [{ estado: 'FACTURADA', etiqueta: 'Marcar facturada', permiso: 'ordenes.cambiar_estado' }],
}

export function AccionesEstado({
  orden,
  permisos,
  esAdmin,
}: {
  orden: { id: string; estado: string }
  permisos: string[]
  esAdmin: boolean
}) {
  const [resultado, ejecutar, pendiente] = useActionState(cambiarEstadoOrden, null)
  const [entrega, registrar, entregando] = useActionState(registrarEntrega, null)
  const [pidiendoMotivo, setPidiendoMotivo] = useState<{ estado: string; etiqueta: string } | null>(null)
  const [entregando_, setEntregando] = useState(false)

  const disponibles = (SIGUIENTES[orden.estado] ?? []).filter(
    (t) => esAdmin || permisos.includes(t.permiso),
  )

  // La entrega solo tiene sentido con la orden terminada, y es la única acción
  // que no cambia el estado sino que registra un documento.
  const puedeEntregar =
    orden.estado === 'TERMINADA' && (esAdmin || permisos.includes('ordenes.entregar'))

  if (disponibles.length === 0 && !puedeEntregar && !resultado && !entrega) return null

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {disponibles.map((t) =>
          t.motivo ? (
            <Boton
              key={t.estado}
              variante={t.estado === 'ANULADA' ? 'peligro' : 'secundario'}
              tamano="sm"
              onClick={() => setPidiendoMotivo({ estado: t.estado, etiqueta: t.etiqueta })}
            >
              {t.etiqueta}
            </Boton>
          ) : (
            <form key={t.estado} action={ejecutar}>
              <input type="hidden" name="orden_id" value={orden.id} />
              <input type="hidden" name="estado" value={t.estado} />
              <Boton
                type="submit"
                tamano="sm"
                cargando={pendiente}
                variante={t.estado === 'APROBADA' || t.estado === 'EN_PROCESO' ? 'primario' : 'secundario'}
              >
                {t.etiqueta}
              </Boton>
            </form>
          ),
        )}

        {puedeEntregar && (
          <Boton variante="primario" tamano="sm" onClick={() => setEntregando(true)}>
            Registrar entrega
          </Boton>
        )}
      </div>

      {entrega && !entrega.ok && (
        <p role="alert" className="max-w-md rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
          {entrega.error}
        </p>
      )}

      {resultado && !resultado.ok && (
        <p role="alert" className="max-w-md rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
          {resultado.error}
        </p>
      )}

      <Ventana
        abierta={entregando_}
        alCerrar={() => setEntregando(false)}
        titulo="Acta de conformidad"
        descripcion="Al registrar el acta la orden queda entregada. Si falta documentación obligatoria o firmas, el sistema lo avisa y no la cierra."
        ancho="sm"
      >
        <form
          action={(datos) => {
            registrar(datos)
            setEntregando(false)
          }}
          className="space-y-3"
        >
          <input type="hidden" name="orden_id" value={orden.id} />

          {/* `autoComplete="off"` en los tres: quien llena el acta es el
              del taller, y el navegador le ofrece su propio nombre y su
              propio DNI para el campo de quien retira la unidad. Ese dato
              mal puesto queda firmado en el acta de conformidad. */}
          <Campo etiqueta="Quién recibe" htmlFor="recibe_nombre" requerido>
            <Entrada id="recibe_nombre" name="recibe_nombre" required
                     autoComplete="off"
                     placeholder="Nombre completo de quien retira la unidad" />
          </Campo>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Documento" htmlFor="recibe_documento">
              <Entrada id="recibe_documento" name="recibe_documento" autoComplete="off"
                       inputMode="numeric" placeholder="DNI" />
            </Campo>
            <Campo etiqueta="Cargo" htmlFor="recibe_cargo">
              <Entrada id="recibe_cargo" name="recibe_cargo" autoComplete="off"
                       placeholder="Ej.: jefe de flota" />
            </Campo>
          </div>

          <Campo etiqueta="Garantía (meses)" htmlFor="garantia_meses">
            <Entrada id="garantia_meses" name="garantia_meses" type="number"
                     inputMode="numeric" min={0} max={120} defaultValue={12} />
          </Campo>

          <Campo etiqueta="Observaciones" htmlFor="obs_entrega">
            <AreaTexto id="obs_entrega" name="observaciones" rows={2}
                       placeholder="Novedades de la entrega, si las hubo" />
          </Campo>

          <div className="flex justify-end gap-2">
            <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setEntregando(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="sm" variante="primario" cargando={entregando}>
              Registrar entrega
            </Boton>
          </div>
        </form>
      </Ventana>

      {/* La ventana no pinta nada cuando está cerrada, así que se le pasa
          siempre y el estado solo decide si se abre. Con `pidiendoMotivo` en
          nulo los valores de adentro no llegan a verse. */}
      <Ventana
        abierta={pidiendoMotivo !== null}
        alCerrar={() => setPidiendoMotivo(null)}
        titulo={
          pidiendoMotivo
            ? `${pidiendoMotivo.etiqueta} · ${definir(ESTADO_OT, orden.estado).etiqueta}`
            : ''
        }
        descripcion="Este cambio queda registrado en la trazabilidad de la orden. Indica el motivo."
        ancho="sm"
      >
        <form
          action={(datos) => {
            ejecutar(datos)
            setPidiendoMotivo(null)
          }}
          className="space-y-3"
        >
          <input type="hidden" name="orden_id" value={orden.id} />
          <input type="hidden" name="estado" value={pidiendoMotivo?.estado ?? ''} />

          <Campo etiqueta="Motivo" htmlFor="motivo" requerido>
            <AreaTexto
              id="motivo"
              name="motivo"
              required
              placeholder="Ej.: falta plancha de 6 mm, se espera ingreso el lunes"
            />
          </Campo>

          <div className="flex justify-end gap-2">
            <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setPidiendoMotivo(null)}>
              Cancelar
            </Boton>
            <Boton
              type="submit"
              tamano="sm"
              variante={pidiendoMotivo?.estado === 'ANULADA' ? 'peligro' : 'primario'}
            >
              Confirmar
            </Boton>
          </div>
        </form>
      </Ventana>
    </div>
  )
}
