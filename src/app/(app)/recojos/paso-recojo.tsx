'use client'

import { CircleSlash, Package, PackageCheck, Truck } from 'lucide-react'
import { useState } from 'react'

import { EstadoDelEnvio, fotosParaEnviar, hayFallidas, haySubiendo, SelectorFotos, useFotosDelEnvio } from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import { BUCKET_FOTOS_RECOJO, MAXIMO_FOTOS_RECOJO, MAXIMO_MB_FOTO_RECOJO, MOTIVO_NO_LOGRADO } from '@/lib/dominio/logistica'
import { useAccion, useEnvio, useIdDelEnvio } from '@/lib/envio'

import { avisarQueNoSePudoRecoger, marcarRecogida, marcarRecojo } from './acciones'

type Paso = 'EN_RECOJO' | 'RECOGIDO' | 'DEJADO'

/**
 * Los botones grandes del conductor, uno por paso: «Salgo a recoger», «Ya la
 * recogí» y «La dejé en almacén». «Ya la recogí» abre una ventana para sumar,
 * si quiere, fotos de la guía firmada o del bulto. «La dejé en almacén» pide
 * confirmar: después Almacén recibe el ingreso y el paso no se deshace. Antes
 * de tenerla, «No se pudo recoger» la devuelve a Logística con su motivo.
 */
export function PasoRecojo({ id, nombre, paso, cuentaId }: { id: string; nombre: string; paso: Paso; cuentaId: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
      {paso === 'EN_RECOJO' ? (
        <SalgoARecoger id={id} />
      ) : paso === 'RECOGIDO' ? (
        <YaLaRecogi id={id} nombre={nombre} cuentaId={cuentaId} />
      ) : (
        <LaDejeEnAlmacen id={id} nombre={nombre} />
      )}
      {paso !== 'DEJADO' && <NoSePudoRecoger id={id} nombre={nombre} />}
    </div>
  )
}

function SalgoARecoger({ id }: { id: string }) {
  const accion = useAccion(marcarRecojo, undefined, { documento: id })
  return (
    <div className="space-y-2">
      <Boton
        type="button"
        tamano="lg"
        className="w-full justify-center sm:w-auto"
        cargando={accion.enviando}
        onClick={() => {
          const datos = new FormData()
          datos.set('id', id)
          datos.set('paso', 'EN_RECOJO')
          accion.ejecutar(datos)
        }}
      >
        <Truck aria-hidden className="size-4" />
        Salgo a recoger
      </Boton>
      {accion.error && (
        <p role="alert" className="text-sm text-peligro">
          {accion.error}
        </p>
      )}
    </div>
  )
}

/**
 * «Ya la recogí», con fotos opcionales. Las fotos suben al elegirlas; si la
 * ventana se cierra sin marcar, se quitan, y si se cierra mientras se envía, se
 * quedan con ese envío y lo que conteste se dice junto al botón
 * (`useFotosDelEnvio`, como la salida del vehículo).
 */
function YaLaRecogi({ id, nombre, cuentaId }: { id: string; nombre: string; cuentaId: string }) {
  const [abierta, setAbierta] = useState(false)
  const delEnvio = useFotosDelEnvio(BUCKET_FOTOS_RECOJO)
  const { fotos, setFotos } = delEnvio
  const envio = useEnvio(delEnvio.conFotos(marcarRecogida), () => {
    if (!delEnvio.seCerroAlEnviar()) setAbierta(false)
  })
  const subiendo = haySubiendo(fotos)
  const fallidas = hayFallidas(fotos)
  // Cerrada mientras se enviaba: el botón gira y no abre otra hasta que conteste.
  const ocupado = delEnvio.sigue || (envio.enviando && !abierta)

  function cerrar() {
    delEnvio.cerrar()
    setAbierta(false)
  }

  return (
    <div className="space-y-2">
      <Boton
        type="button"
        tamano="lg"
        className="w-full justify-center sm:w-auto"
        ocupado={ocupado}
        aria-describedby={delEnvio.sigue ? delEnvio.idDelEstado : undefined}
        onClick={() => {
          envio.limpiar()
          delEnvio.abrir()
          setAbierta(true)
        }}
      >
        {!ocupado && <Package aria-hidden className="size-4" />}
        Ya la recogí
      </Boton>
      <EstadoDelEnvio id={delEnvio.idDelEstado} sigue={delEnvio.sigue} desenlace={delEnvio.desenlace} registro="El recojo" />
      <Ventana
        abierta={abierta}
        alCerrar={cerrar}
        titulo={`¿Ya recogiste la ${nombre}?`}
        descripcion="Si quieres dejar constancia, toma una foto de la guía firmada o del bulto. Es opcional: puedes marcarla sin fotos."
        ancho="md"
      >
        <form
          onSubmit={(e) => envio.alEnviar(e, (datos) => datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos).map((f) => f.ruta_storage))))}
          className="space-y-4"
        >
          <input type="hidden" name="id" value={id} />
          {/* Trabado mientras se envía: una foto elegida o quitada entonces no iba con el recojo. */}
          <fieldset disabled={envio.enviando} className="min-w-0 space-y-1">
            <legend className="text-sm font-medium text-texto">Fotos del recojo (opcional)</legend>
            <p className="text-xs text-texto-suave">La guía firmada o el bulto. Hasta {MAXIMO_FOTOS_RECOJO} fotos.</p>
            <SelectorFotos
              fotos={fotos}
              alCambiar={setFotos}
              prefijoRuta={`${cuentaId}/${id}`}
              maximo={MAXIMO_FOTOS_RECOJO}
              bucket={BUCKET_FOTOS_RECOJO}
              comprimir
              maximoMb={MAXIMO_MB_FOTO_RECOJO}
              titulo={null}
            />
            {fallidas && !subiendo && (
              <p className="pt-2 text-sm text-peligro">Vuelve a subir las fotos que no entraron, o quítalas para marcarla sin ellas.</p>
            )}
          </fieldset>
          <PieDeVentana
            error={envio.error}
            enviando={envio.enviando}
            alCancelar={cerrar}
            texto={subiendo ? 'Esperando las fotos…' : 'Sí, ya la recogí'}
            disabled={subiendo || fallidas}
          />
        </form>
      </Ventana>
    </div>
  )
}

function LaDejeEnAlmacen({ id, nombre }: { id: string; nombre: string }) {
  const [confirmando, setConfirmando] = useState(false)
  const accion = useAccion(marcarRecojo, () => setConfirmando(false), { documento: id })

  function marcar() {
    const datos = new FormData()
    datos.set('id', id)
    datos.set('paso', 'DEJADO')
    accion.ejecutar(datos)
  }

  return (
    <div className="space-y-2">
      <Boton type="button" tamano="lg" className="w-full justify-center sm:w-auto" onClick={() => setConfirmando(true)}>
        <PackageCheck aria-hidden className="size-4" />
        La dejé en almacén
      </Boton>
      {accion.error && !confirmando && (
        <p role="alert" className="text-sm text-peligro">
          {accion.error}
        </p>
      )}
      <Ventana
        abierta={confirmando}
        alCerrar={() => setConfirmando(false)}
        titulo={`¿Dejaste ${nombre} en almacén?`}
        descripcion="Almacén recibe el ingreso para validarlo contra lo que entregaste. Esto no se deshace."
        ancho="sm"
      >
        <div className="space-y-4">
          {accion.error && (
            <p role="alert" className="text-sm text-peligro">
              {accion.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setConfirmando(false)}>
              Todavía no
            </Boton>
            <Boton type="button" cargando={accion.enviando} onClick={marcar}>
              Sí, la dejé
            </Boton>
          </div>
        </div>
      </Ventana>
    </div>
  )
}

/**
 * «No se pudo recoger», con su motivo: la compra vuelve a «Por programar» de
 * Logística, que recibe el aviso, y sale de la lista del conductor. El id del
 * envío vive aquí, fuera del formulario: tras «No llegó la respuesta», volver a
 * abrir lleva el mismo y la base dice si ya quedó (`useIdDelEnvio`).
 */
function NoSePudoRecoger({ id, nombre }: { id: string; nombre: string }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const envio = useIdDelEnvio(undefined, undefined, `no-se-pudo-recoger:${id}`)
  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="lg"
        className="w-full justify-center sm:w-auto"
        onClick={() => {
          envio.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <CircleSlash aria-hidden className="size-4" />
        No se pudo recoger
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`No se pudo recoger la ${nombre}`}
        descripcion="Vuelve a Logística con tu motivo y sale de tu lista. Logística la programa otra vez cuando se pueda recoger."
        ancho="md"
      >
        <EnvioAnterior texto={envio.anterior} />
        {envio.id && <FormularioNoSePudo key={vez} envio={envio} compra={id} alCancelar={() => setAbierta(false)} alTerminar={() => setAbierta(false)} />}
      </Ventana>
    </>
  )
}

function FormularioNoSePudo({
  envio,
  compra,
  alCancelar,
  alTerminar,
}: {
  envio: ReturnType<typeof useIdDelEnvio>
  compra: string
  alCancelar: () => void
  alTerminar: () => void
}) {
  const id = envio.id ?? ''
  const { alEnviar, enviando, error } = useEnvio(
    (previo: unknown, datos: FormData) => {
      envio.salio()
      return avisarQueNoSePudoRecoger(previo, datos)
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
      <input type="hidden" name="compra" value={compra} />
      <fieldset disabled={enviando} className="min-w-0">
        <Campo
          etiqueta="Por qué no se pudo"
          htmlFor={`no-se-pudo-${id}`}
          requerido
          ayuda="Lo lee Logística para volver a programarla: qué pasó y, si lo sabes, cuándo se puede."
        >
          <AreaTexto
            id={`no-se-pudo-${id}`}
            name="motivo"
            required
            minLength={MOTIVO_NO_LOGRADO.minimo}
            maxLength={MOTIVO_NO_LOGRADO.maximo}
            rows={3}
            placeholder="Por ejemplo: el almacén del proveedor estaba cerrado; dicen que abren el lunes a las 8."
          />
        </Campo>
      </fieldset>
      <PieDeVentana error={error} enviando={enviando} alCancelar={alCancelar} texto="Devolver a Logística" />
    </form>
  )
}
