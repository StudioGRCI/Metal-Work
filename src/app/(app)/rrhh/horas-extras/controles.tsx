'use client'

import { Ban, Banknote, CalendarMinus, PiggyBank } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import { yaEntroLaPrimeraVez } from '@/lib/acciones'
import { useAccion, useEnvio, useIdDelEnvio } from '@/lib/envio'

import { anularDecisionHorasExtras, anularUsoSaldo, decidirHorasExtras, guardarReglaHorasExtras, usarSaldoHoras } from './acciones'

/**
 * Pagar o reservar las horas extras de una persona en un día, de un toque. El
 * id llega del servidor: un segundo toque manda el mismo y no decide dos veces.
 * Si el primero entró y se tocó el otro botón, la base dice que ya quedó y la
 * pantalla se pone al día sola: no es un rechazo, va sin rojo.
 */
export function DecidirExtras({ id, trabajadorId, fecha }: { id: string; trabajadorId: string; fecha: string }) {
  const { ejecutar, enviando, error } = useAccion(decidirHorasExtras)
  const [elegida, setElegida] = useState<'PAGAR' | 'RESERVAR' | null>(null)
  function decidir(decision: 'PAGAR' | 'RESERVAR') {
    setElegida(decision)
    const datos = new FormData()
    datos.set('id', id)
    datos.set('trabajador_id', trabajadorId)
    datos.set('fecha', fecha)
    datos.set('decision', decision)
    ejecutar(datos)
  }
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap justify-end gap-2">
        <Boton type="button" tamano="sm" cargando={enviando && elegida === 'PAGAR'} disabled={enviando} onClick={() => decidir('PAGAR')} data-decidir="PAGAR">
          <Banknote aria-hidden className="size-4" />
          Pagar
        </Boton>
        <Boton
          type="button"
          variante="secundario"
          tamano="sm"
          cargando={enviando && elegida === 'RESERVAR'}
          disabled={enviando}
          onClick={() => decidir('RESERVAR')}
          data-decidir="RESERVAR"
        >
          <PiggyBank aria-hidden className="size-4" />
          Reservar
        </Boton>
      </div>
      {error && (
        <p role="alert" className={yaEntroLaPrimeraVez(error) ? 'text-right text-xs text-texto' : 'text-right text-xs text-peligro'}>
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Usar horas del saldo de una persona en un descanso. Un permiso se justifica en
 * «Permisos», que también descuenta de aquí. El id vive aquí y no llega con la
 * página (`useIdDelEnvio`): tras «No llegó la respuesta», cerrar pone la
 * pantalla al día, y con el id de la página la ventana siguiente llevaba otro y
 * el mismo uso entraba dos veces. Ahora sigue el mismo hasta saber cómo terminó,
 * también tras recargar, y la base dice si aquel ya quedó.
 */
export function UsarSaldo({ trabajadorId, nombre, saldo, hoy }: { trabajadorId: string; nombre: string; saldo: number; hoy: string }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const envio = useIdDelEnvio(undefined, undefined, `usar-saldo:${trabajadorId}`)
  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        onClick={() => {
          envio.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
        data-usar-saldo={trabajadorId}
      >
        <CalendarMinus aria-hidden className="size-4" />
        Usar horas
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Usar horas del saldo de ${nombre}`}
        descripcion={`Tiene ${saldo.toLocaleString('es-PE', { maximumFractionDigits: 2 })} h reservadas. Lo que uses se descuenta de su saldo. Si es para un permiso, regístralo y justifícalo en «Permisos».`}
        ancho="md"
      >
        {envio.id && (
          <FormularioUsarSaldo key={vez} envio={envio} trabajadorId={trabajadorId} saldo={saldo} hoy={hoy} alTerminar={() => setAbierta(false)} />
        )}
      </Ventana>
    </>
  )
}

function FormularioUsarSaldo({
  envio,
  trabajadorId,
  saldo,
  hoy,
  alTerminar,
}: {
  envio: ReturnType<typeof useIdDelEnvio>
  trabajadorId: string
  saldo: number
  hoy: string
  alTerminar: () => void
}) {
  const id = envio.id ?? ''
  const { alEnviar, enviando, error } = useEnvio(
    (previo: unknown, datos: FormData) => {
      envio.salio()
      return usarSaldoHoras(previo, datos)
    },
    () => {
      envio.otro()
      alTerminar()
    },
    { alYaEntrar: envio.otro },
  )
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="trabajador_id" value={trabajadorId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Día" htmlFor={`saldo-fecha-${id}`} requerido>
          <Entrada id={`saldo-fecha-${id}`} name="fecha" type="date" required defaultValue={hoy} />
        </Campo>
        <Campo etiqueta="Horas" htmlFor={`saldo-horas-${id}`} requerido>
          <Entrada
            id={`saldo-horas-${id}`}
            name="horas"
            type="number"
            inputMode="decimal"
            min={0.25}
            max={Math.min(8, saldo)}
            step={0.25}
            required
            className="tabular"
          />
        </Campo>
      </div>
      <Campo etiqueta="Para qué las usa" htmlFor={`saldo-motivo-${id}`} requerido>
        <AreaTexto
          id={`saldo-motivo-${id}`}
          name="motivo"
          required
          minLength={10}
          maxLength={300}
          placeholder="Por ejemplo: descanso el sábado por las horas del lunes."
        />
      </Campo>
      <PieDeVentana error={error} enviando={enviando} alCancelar={alTerminar} texto="Usar del saldo" />
    </form>
  )
}

/** Anular una decisión de horas extras o un uso del saldo, con su motivo. */
export function AnularExtras({ tipo, id, detalle }: { tipo: 'decision' | 'uso'; id: string; detalle: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(tipo === 'decision' ? anularDecisionHorasExtras : anularUsoSaldo, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierta(true)} data-anular-extras={id}>
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={tipo === 'decision' ? 'Anular la decisión' : 'Anular el uso del saldo'}
        descripcion={detalle}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <Campo etiqueta="Motivo" htmlFor={`anular-extras-${id}`} requerido>
            <AreaTexto id={`anular-extras-${id}`} name="motivo" required minLength={10} maxLength={500} />
          </Campo>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={enviando}>
              Anular
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/** Cuántas horas extras de cada día van con el primer recargo y los dos recargos. La ley pone el piso. */
export function FormularioReglaExtras({ horasTramo1, recargoTramo1, recargoTramo2 }: { horasTramo1: number; recargoTramo1: number; recargoTramo2: number }) {
  const [aviso, setAviso] = useState<string | null>(null)
  const { alEnviar, enviando, error } = useEnvio(guardarReglaHorasExtras, (r) => setAviso(r.mensaje ?? 'Regla guardada.'))
  return (
    <form
      onSubmit={(e) => {
        setAviso(null)
        alEnviar(e)
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Horas con el primer recargo" htmlFor="regla-extras-horas" requerido ayuda="Las primeras de cada día. La ley dice 2, y no deja más.">
          <Entrada id="regla-extras-horas" name="horas_tramo1" type="number" min={0} max={2} step={0.25} required defaultValue={horasTramo1} className="tabular" />
        </Campo>
        <Campo etiqueta="Primer recargo (%)" htmlFor="regla-extras-r1" requerido ayuda="Mínimo de ley: 25 %.">
          <Entrada id="regla-extras-r1" name="recargo_tramo1" type="number" min={25} max={200} step={0.01} required defaultValue={recargoTramo1} className="tabular" />
        </Campo>
        <Campo etiqueta="Segundo recargo (%)" htmlFor="regla-extras-r2" requerido ayuda="Para las siguientes. Mínimo de ley: 35 %.">
          <Entrada id="regla-extras-r2" name="recargo_tramo2" type="number" min={35} max={200} step={0.01} required defaultValue={recargoTramo2} className="tabular" />
        </Campo>
      </div>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      {aviso && !error && (
        <p role="status" className="text-sm text-exito">
          {aviso}
        </p>
      )}
      <div className="flex justify-end">
        <Boton type="submit" variante="secundario" cargando={enviando}>
          Guardar la regla
        </Boton>
      </div>
    </form>
  )
}
