'use client'

import { Camera } from 'lucide-react'
import { useState } from 'react'

import { SelectorFotos, fotosParaEnviar, haySubiendo, type FotoLista } from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import { hoyLima } from '@/lib/format'

import { registrarAvance } from './acciones'

export type EtapaElegible = { id: string; nombre: string; estado: string; avance: number }

/**
 * El parte visual del día. La foto viaja del navegador a Storage sin pasar por
 * el servidor de la aplicación, igual que los documentos; acá solo se guarda su
 * ubicación cuando el avance se registra.
 */
export function RegistrarAvance({
  ordenId,
  etapas,
  compacto = false,
}: {
  ordenId: string
  etapas: EtapaElegible[]
  compacto?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [fotos, setFotos] = useState<FotoLista[]>([])
  const [etapaId, setEtapaId] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  // Al guardar, la ventana se cierra y la línea nueva aparece arriba del
  // diario; el aviso queda al lado del botón para que nadie dude de si entró.
  // Antes la ventana quedaba abierta con «Registrar» activo, y un segundo toque
  // era un segundo avance.
  const { alEnviar, enviando, error, limpiar } = useEnvio(registrarAvance, (r) => {
    setAbierto(false)
    setAviso(r.mensaje ?? 'Avance registrado.')
  })

  // La fecha del taller, no la del reloj universal: pasadas las siete de la
  // noche en Lima el reloj universal ya está en el día siguiente.
  const hoy = hoyLima()
  const enCurso = etapas.filter((e) => !['TERMINADA', 'OMITIDA'].includes(e.estado))

  // Cada vez que se abre empieza limpia: sin el error ni las fotos de la vez
  // anterior. Es un evento, no un efecto.
  function abrir() {
    limpiar()
    setAviso(null)
    setFotos([])
    setEtapaId('')
    setAbierto(true)
  }

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-2">
        <Boton tamano={compacto ? 'sm' : undefined} variante={compacto ? 'secundario' : undefined} onClick={abrir}>
          <Camera aria-hidden className={compacto ? 'size-3.5' : 'size-4'} />
          Registrar avance
        </Boton>
        {aviso && (
          <span role="status" className="text-xs font-medium text-exito">
            {aviso}
          </span>
        )}
      </span>

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Avance del día"
        descripcion="Qué se hizo hoy en esta unidad. Con la foto, el cliente y la gerencia ven cómo va sin tener que bajar al taller."
        ancho="lg"
      >
        <form
          onSubmit={(e) => alEnviar(e, (datos) => datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos))))}
          className="space-y-3"
        >
          <input type="hidden" name="orden_id" value={ordenId} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Fecha" htmlFor="fecha" requerido>
              <Entrada id="fecha" name="fecha" type="date" required defaultValue={hoy} max={hoy} />
            </Campo>
            <Campo etiqueta="Etapa" htmlFor="etapa_id" ayuda="En qué está la unidad ahora">
              <Seleccion
                id="etapa_id"
                name="etapa_id"
                value={etapaId}
                onChange={(e) => setEtapaId(e.target.value)}
              >
                <option value="">Sin etapa en particular</option>
                {enCurso.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre} · {e.avance}%
                  </option>
                ))}
              </Seleccion>
            </Campo>
          </div>

          <Campo etiqueta="Qué se hizo" htmlFor="descripcion" requerido>
            <AreaTexto
              id="descripcion"
              name="descripcion"
              rows={3}
              required
              placeholder="Se soldaron los travesaños del piso y se dejó lista la compuerta para pintura."
            />
          </Campo>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              etiqueta="Avance de la etapa"
              htmlFor="avance_porcentaje"
              ayuda={
                etapaId ? 'A cuánto quedó, de 0 a 100' : 'Elige primero la etapa'
              }
            >
              <Entrada
                id="avance_porcentaje"
                name="avance_porcentaje"
                type="number"
                inputMode="numeric"
                min="0"
                max="100"
                step="1"
                disabled={!etapaId}
                placeholder="60"
              />
            </Campo>
            <Campo
              etiqueta="¿Algo la traba?"
              htmlFor="impedimento"
              ayuda="Material que falta, plano pendiente, pieza en el proveedor"
            >
              <Entrada id="impedimento" name="impedimento" autoComplete="off" placeholder="Nada" />
            </Campo>
          </div>

          {/* La ruta empieza por ot/{orden_id}: las políticas de Storage se
              apoyan en esa convención para decidir quién puede ver la foto. */}
          <SelectorFotos fotos={fotos} alCambiar={setFotos} prefijoRuta={`ot/${ordenId}/avance`} />

          {error && (
            <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando} disabled={haySubiendo(fotos)}>
              Registrar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
