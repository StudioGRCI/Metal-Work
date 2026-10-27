'use client'

import { Ban, LogOut, Wind } from 'lucide-react'
import { useState } from 'react'

import { fotosParaEnviar, hayFallidas, haySubiendo, quitarFotosSueltas, soltarMiniaturas, type FotoLista } from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { BUCKET_FOTOS_VEHICULO } from '@/lib/dominio/requerimientos'
import { useEnvio } from '@/lib/envio'

import { anularRegistroVehiculo, registrarSalidaVehiculo } from './acciones'
import { AvisoFotos, FotosDelMomento } from './formulario'

type Paso = 'SALIDA' | 'ARENADO' | 'ANULAR'

/**
 * Lo que se marca en un vehículo que está en planta: que salió, con sus fotos,
 * o que el ingreso se anotó mal. Si la ventana de la salida se cierra sin
 * registrar, las fotos que ya subieron se retiran de Storage.
 *
 * `bloqueoSalida` es lo que la base dice que le falta para salir (el 100 % del
 * avance de su código y la revisión de Tesorería): mientras haya algo, el botón
 * queda apagado. El porqué lo pinta la pantalla junto al avance, con el id
 * `veh-bloqueo-{id}`, y el botón lo nombra. La base lo vuelve a exigir al registrar.
 *
 * `alArenado`: el vehículo entró a trabajo con su código y puede salir al
 * arenado externo a medio trabajo, sin esperar nada (migración 20261020168000).
 */
export function ControlesVehiculo({
  id,
  nombre,
  cuentaId,
  bloqueoSalida = null,
  alArenado = false,
}: {
  id: string
  nombre: string
  cuentaId: string
  bloqueoSalida?: string | null
  alArenado?: boolean
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
  const sale = paso === 'SALIDA' || paso === 'ARENADO'
  const subiendo = haySubiendo(fotos)
  const fallidas = hayFallidas(fotos)
  const listas = fotosParaEnviar(fotos).length
  const bloqueado = sale && (subiendo || fallidas || listas === 0)

  function cerrar() {
    quitarFotosSueltas(BUCKET_FOTOS_VEHICULO, fotos)
    setFotos([])
    setPaso(null)
  }

  return (
    <div className="flex flex-col items-end gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
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
      {alArenado && (
        <Boton
          type="button"
          variante="contorno"
          tamano="sm"
          onClick={() => {
            setFotos([])
            setPaso('ARENADO')
          }}
        >
          <Wind aria-hidden className="size-4" />
          Sale al arenado
        </Boton>
      )}
      {/* Anular corrige un error, no es el paso del trabajo: va sin borde para
          no pesar como «Marcar salida» en cada fila (auditoría del 27/10/2026). */}
      <Boton type="button" variante="fantasma" tamano="sm" aria-label={`Anular el ingreso de ${nombre}`} onClick={() => setPaso('ANULAR')}>
        <Ban aria-hidden className="size-4 text-peligro" />
        Anular
      </Boton>
      <Ventana
        abierta={paso !== null}
        alCerrar={cerrar}
        titulo={
          paso === 'ANULAR' ? `Anular el ingreso de ${nombre}` : paso === 'ARENADO' ? `Salida al arenado de ${nombre}` : `Salida de ${nombre}`
        }
        descripcion={
          paso === 'ANULAR'
            ? 'Para un ingreso que se anotó mal. No se borra: queda con su motivo.'
            : paso === 'ARENADO'
              ? 'Sale a medio trabajo, sin esperar el 100 % ni a Tesorería, y vuelve con el motivo «Arenado». Con fotos de cómo sale.'
              : 'El vehículo deja la planta, con fotos de cómo sale. La salida ya marcada no se corrige.'
        }
        ancho={sale ? 'lg' : 'md'}
      >
        <form
          onSubmit={(e) =>
            envio.alEnviar(e, (datos) => {
              if (sale) datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos).map((f) => f.ruta_storage)))
              if (paso === 'ARENADO') datos.set('destino', 'ARENADO')
            })
          }
          className="space-y-4"
        >
          <input type="hidden" name="id" value={id} />
          {sale && (
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
              placeholder={
                paso === 'ANULAR'
                  ? 'Por ejemplo: se anotó la placa de otro vehículo.'
                  : paso === 'ARENADO'
                    ? 'Por ejemplo: va al arenado de la av. Argentina, vuelve el jueves.'
                    : 'Por ejemplo: lo recoge el conductor del cliente.'
              }
            />
          </Campo>
          {sale && (
            <FotosDelMomento titulo="Fotos al salir" fotos={fotos} setFotos={setFotos} prefijoRuta={`${cuentaId}/${id}/salida`} />
          )}
          {envio.error && (
            <p role="alert" className="text-sm text-peligro">
              {envio.error}
            </p>
          )}
          {sale && <AvisoFotos subiendo={subiendo} fallidas={fallidas} listas={listas} momento="salir" />}
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
              {paso === 'ANULAR' ? 'Anular' : subiendo ? 'Esperando las fotos…' : paso === 'ARENADO' ? 'Registrar salida al arenado' : 'Registrar salida'}
            </Boton>
          </div>
        </form>
      </Ventana>
    </div>
  )
}
