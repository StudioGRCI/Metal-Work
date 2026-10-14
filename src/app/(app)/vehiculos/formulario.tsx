'use client'

import { LogIn } from 'lucide-react'
import { useState, type Dispatch, type SetStateAction } from 'react'

import {
  SelectorFotos,
  fotosParaEnviar,
  hayFallidas,
  haySubiendo,
  quitarFotosSueltas,
  soltarMiniaturas,
  type FotoLista,
} from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { BUCKET_FOTOS_VEHICULO, MAXIMO_FOTOS_VEHICULO, MAXIMO_MB_FOTO_VEHICULO, MOTIVO_VEHICULO } from '@/lib/dominio/requerimientos'
import { useEnvio } from '@/lib/envio'

import { registrarIngresoVehiculo } from './acciones'

/**
 * El botón «Registrar ingreso» y su ventana. Las fotos viven aquí y no en el
 * formulario: si la ventana se cierra sin registrar, las que ya subieron se
 * retiran de Storage; si se registra, quedan con el ingreso.
 */
export function NuevoIngresoVehiculo({ cuentaId }: { cuentaId: string }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  const [fotos, setFotos] = useState<FotoLista[]>([])
  return (
    <>
      <Boton
        type="button"
        onClick={() => {
          setAviso(null)
          setFotos([])
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <LogIn aria-hidden className="size-4" />
        Registrar ingreso
      </Boton>
      {aviso && (
        <p role="status" className="basis-full text-sm text-exito">
          {aviso}
        </p>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => {
          quitarFotosSueltas(BUCKET_FOTOS_VEHICULO, fotos)
          setFotos([])
          setAbierta(false)
        }}
        titulo="Ingreso de vehículo"
        descripcion="Un vehículo entra a la planta, con fotos de cómo llega. La salida se marca después en la misma fila."
        ancho="lg"
      >
        <FormularioIngreso
          key={vez}
          cuentaId={cuentaId}
          fotos={fotos}
          setFotos={setFotos}
          alTerminar={(mensaje) => {
            // Ya son parte del ingreso: solo se sueltan las miniaturas.
            soltarMiniaturas(fotos)
            setFotos([])
            setAbierta(false)
            setAviso(mensaje)
          }}
        />
      </Ventana>
    </>
  )
}

function FormularioIngreso({
  cuentaId,
  fotos,
  setFotos,
  alTerminar,
}: {
  cuentaId: string
  fotos: FotoLista[]
  setFotos: Dispatch<SetStateAction<FotoLista[]>>
  alTerminar: (mensaje: string) => void
}) {
  // Decidido aquí: un reintento manda el mismo y la base no duplica el ingreso.
  // Las fotos suben a la carpeta de este ingreso antes de registrarlo.
  const [id] = useState(() => crypto.randomUUID())
  const { alEnviar, enviando, error } = useEnvio(registrarIngresoVehiculo, (r) => alTerminar(r.mensaje ?? 'Ingreso registrado.'))
  const subiendo = haySubiendo(fotos)
  const fallidas = hayFallidas(fotos)
  const listas = fotosParaEnviar(fotos).length
  return (
    <form
      onSubmit={(e) => alEnviar(e, (datos) => datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos).map((f) => f.ruta_storage))))}
      className="space-y-4"
    >
      <input type="hidden" name="operacion_id" value={id} />
      <p className="text-xs text-texto-suave">Anota al menos uno de los tres: placa, chasis o código interno.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Placa" htmlFor="veh-placa">
          <Entrada id="veh-placa" name="placa" maxLength={15} autoComplete="off" placeholder="ABC-123" className="uppercase" />
        </Campo>
        <Campo etiqueta="N.º de chasis" htmlFor="veh-chasis" ayuda="Para un chasis nuevo que todavía no tiene placa.">
          <Entrada id="veh-chasis" name="chasis" maxLength={40} autoComplete="off" className="uppercase" />
        </Campo>
        <Campo etiqueta="Código interno" htmlFor="veh-codigo" ayuda="El de la unidad, si ya lo tiene.">
          <Entrada id="veh-codigo" name="codigo_interno" maxLength={60} autoComplete="off" placeholder="PLA_SR_O4_1_26/28" />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Vehículo" htmlFor="veh-unidad" requerido>
          <Entrada id="veh-unidad" name="unidad" required minLength={2} maxLength={120} placeholder="Tolva 18 m³ Volvo FMX" />
        </Campo>
        <Campo etiqueta="Empresa" htmlFor="veh-empresa" requerido ayuda="El cliente o dueño del vehículo.">
          <Entrada id="veh-empresa" name="empresa" required minLength={2} maxLength={160} />
        </Campo>
        <Campo etiqueta="Motivo" htmlFor="veh-motivo" requerido>
          <Seleccion id="veh-motivo" name="motivo" required defaultValue="">
            <option value="" disabled>
              Elige el motivo
            </option>
            {Object.entries(MOTIVO_VEHICULO).map(([valor, m]) => (
              <option key={valor} value={valor}>
                {m.etiqueta}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Fecha y hora de ingreso" htmlFor="veh-ingreso" ayuda="Déjalo vacío si entra ahora.">
          <Entrada id="veh-ingreso" name="ingreso_en" type="datetime-local" />
        </Campo>
      </div>
      <Campo etiqueta="Observación" htmlFor="veh-obs">
        <AreaTexto id="veh-obs" name="observacion" maxLength={500} rows={2} placeholder="Cómo llega: llanta baja, sin espejo derecho, con documentos…" />
      </Campo>
      <FotosDelMomento
        titulo="Fotos al entrar"
        fotos={fotos}
        setFotos={setFotos}
        prefijoRuta={`${cuentaId}/${id}/ingreso`}
      />
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <AvisoFotos subiendo={subiendo} fallidas={fallidas} listas={listas} momento="entrar" />
      <div className="flex justify-end">
        <Boton type="submit" cargando={enviando} disabled={subiendo || fallidas || listas === 0} className="w-full sm:w-auto">
          {subiendo ? 'Esperando las fotos…' : 'Registrar ingreso'}
        </Boton>
      </div>
    </form>
  )
}

/** Las fotos de la entrada o de la salida: se toman con la cámara o salen de la galería, y se achican en el teléfono. */
export function FotosDelMomento({
  titulo,
  fotos,
  setFotos,
  prefijoRuta,
}: {
  titulo: string
  fotos: FotoLista[]
  setFotos: Dispatch<SetStateAction<FotoLista[]>>
  prefijoRuta: string
}) {
  return (
    <section aria-label={titulo} className="space-y-1">
      <p className="text-sm font-medium text-texto">
        {titulo} <span className="text-peligro">*</span>
      </p>
      <p className="text-xs text-texto-suave">
        Cada lado, el frente, la parte de atrás y lo que esté golpeado o falte: es la evidencia de cómo estaba. De 1 a{' '}
        {MAXIMO_FOTOS_VEHICULO} fotos.
      </p>
      <SelectorFotos
        fotos={fotos}
        alCambiar={setFotos}
        prefijoRuta={prefijoRuta}
        maximo={MAXIMO_FOTOS_VEHICULO}
        bucket={BUCKET_FOTOS_VEHICULO}
        comprimir
        maximoMb={MAXIMO_MB_FOTO_VEHICULO}
        titulo={null}
      />
    </section>
  )
}

/** Por qué el botón todavía no se deja tocar. */
export function AvisoFotos({
  subiendo,
  fallidas,
  listas,
  momento,
}: {
  subiendo: boolean
  fallidas: boolean
  listas: number
  momento: 'entrar' | 'salir'
}) {
  if (subiendo) return null
  if (fallidas) return <p className="text-sm text-peligro">Quita o vuelve a subir las fotos que no entraron antes de registrar.</p>
  if (listas === 0) return <p className="text-sm text-texto-suave">Toma al menos una foto del vehículo al {momento}.</p>
  return null
}
