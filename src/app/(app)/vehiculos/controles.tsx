'use client'

import { Ban, LogOut } from 'lucide-react'
import { useState } from 'react'

import { fotosParaEnviar, hayFallidas, haySubiendo, quitarFotosSueltas, soltarMiniaturas, type FotoLista } from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { BUCKET_FOTOS_VEHICULO } from '@/lib/dominio/requerimientos'
import { useEnvio } from '@/lib/envio'

import { anularRegistroVehiculo, registrarSalidaVehiculo } from './acciones'
import { AvisoFotos, FotosDelMomento } from './formulario'

type Paso = 'SALIDA' | 'ANULAR'

/**
 * Lo que se marca en un vehículo que está en planta: que salió, con sus fotos,
 * o que el ingreso se anotó mal. Si la ventana de la salida se cierra sin
 * registrar, las fotos que ya subieron se retiran de Storage.
 *
 * `bloqueoSalida` es lo que la base dice que le falta para salir (el 100 % del
 * avance de su código y la revisión de Tesorería): mientras haya algo, el botón
 * queda apagado y dice por qué. La base lo vuelve a exigir al registrar.
 */
export function ControlesVehiculo({
  id,
  nombre,
  cuentaId,
  bloqueoSalida = null,
}: {
  id: string
  nombre: string
  cuentaId: string
  bloqueoSalida?: string | null
}) {
  const [paso, setPaso] = useState<Paso | null>(null)
  const [fotos, setFotos] = useState<FotoLista[]>([])
  const salida = useEnvio(registrarSalidaVehiculo, () => {
    // Ya son parte de la salida: solo se sueltan las miniaturas.
    soltarMiniaturas(fotos)
    setFotos([])
    setPaso(null)
  })
  const anular = useEnvio(anularRegistroVehiculo, () => setPaso(null))
  const envio = paso === 'ANULAR' ? anular : salida
  const subiendo = haySubiendo(fotos)
  const fallidas = hayFallidas(fotos)
  const listas = fotosParaEnviar(fotos).length
  const bloqueado = paso === 'SALIDA' && (subiendo || fallidas || listas === 0)

  function cerrar() {
    quitarFotosSueltas(BUCKET_FOTOS_VEHICULO, fotos)
    setFotos([])
    setPaso(null)
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {bloqueoSalida && (
        <p id={`veh-bloqueo-${id}`} className="basis-full text-right text-[11px] text-texto-suave sm:max-w-xs sm:basis-auto" data-bloqueo-salida>
          {bloqueoSalida}
        </p>
      )}
      <Boton
        type="button"
        variante="secundario"
        tamano="sm"
        disabled={Boolean(bloqueoSalida)}
        aria-describedby={bloqueoSalida ? `veh-bloqueo-${id}` : undefined}
        onClick={() => {
          setFotos([])
          setPaso('SALIDA')
        }}
      >
        <LogOut aria-hidden className="size-4" />
        Marcar salida
      </Boton>
      <Boton type="button" variante="contornoPeligro" tamano="sm" aria-label={`Anular el ingreso de ${nombre}`} onClick={() => setPaso('ANULAR')}>
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={paso !== null}
        alCerrar={cerrar}
        titulo={paso === 'ANULAR' ? `Anular el ingreso de ${nombre}` : `Salida de ${nombre}`}
        descripcion={
          paso === 'ANULAR'
            ? 'Para un ingreso que se anotó mal. No se borra: queda con su motivo.'
            : 'El vehículo deja la planta, con fotos de cómo sale. La salida ya marcada no se corrige.'
        }
        ancho={paso === 'SALIDA' ? 'lg' : 'md'}
      >
        <form
          onSubmit={(e) =>
            envio.alEnviar(e, (datos) => {
              if (paso === 'SALIDA') datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos).map((f) => f.ruta_storage)))
            })
          }
          className="space-y-4"
        >
          <input type="hidden" name="id" value={id} />
          {paso === 'SALIDA' && (
            <Campo etiqueta="Fecha y hora de salida" htmlFor={`veh-salida-${id}`} ayuda="Déjalo vacío si sale ahora.">
              <Entrada id={`veh-salida-${id}`} name="salida_en" type="datetime-local" />
            </Campo>
          )}
          <Campo
            etiqueta={paso === 'ANULAR' ? 'Motivo' : 'Observación (opcional)'}
            htmlFor={`veh-nota-${id}`}
            requerido={paso === 'ANULAR'}
          >
            <AreaTexto
              id={`veh-nota-${id}`}
              name={paso === 'ANULAR' ? 'motivo' : 'observacion'}
              required={paso === 'ANULAR'}
              minLength={paso === 'ANULAR' ? 10 : undefined}
              maxLength={500}
              placeholder={paso === 'ANULAR' ? 'Por ejemplo: se anotó la placa de otro vehículo.' : 'Por ejemplo: sale al arenado externo.'}
            />
          </Campo>
          {paso === 'SALIDA' && (
            <FotosDelMomento titulo="Fotos al salir" fotos={fotos} setFotos={setFotos} prefijoRuta={`${cuentaId}/${id}/salida`} />
          )}
          {envio.error && (
            <p role="alert" className="text-sm text-peligro">
              {envio.error}
            </p>
          )}
          {paso === 'SALIDA' && <AvisoFotos subiendo={subiendo} fallidas={fallidas} listas={listas} momento="salir" />}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={cerrar}>
              Cancelar
            </Boton>
            <Boton
              type="submit"
              variante={paso === 'ANULAR' ? 'peligro' : 'primario'}
              cargando={envio.enviando}
              disabled={bloqueado}
            >
              {paso === 'ANULAR' ? 'Anular' : subiendo ? 'Esperando las fotos…' : 'Registrar salida'}
            </Boton>
          </div>
        </form>
      </Ventana>
    </div>
  )
}
