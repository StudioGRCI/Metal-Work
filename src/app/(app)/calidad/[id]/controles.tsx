'use client'

import { Ban, CheckCheck, RotateCcw, Wrench } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'

import {
  EstadoDelEnvio,
  SelectorFotos,
  type Desenlace,
  fotosParaEnviar,
  hayFallidas,
  haySubiendo,
  useFotosDelEnvio,
  type FotoLista,
} from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import { BUCKET_FOTOS_CALIDAD, MAXIMO_FOTOS_CALIDAD, MAXIMO_MB_FOTO_CALIDAD, type TipoPasoCalidad } from '@/lib/dominio/calidad'
import { refrescarSiEsDeLaPestana, useCursorAlRechazo, useEnvio, useIdDelEnvio, usePestanaDeLaVersionAnterior } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'

import { anularInspeccion, registrarPasoDeCalidad } from '../acciones'

/** Lo de cada paso: el botón, la ventana y lo que pide. */
const PASOS: Record<
  TipoPasoCalidad,
  {
    boton: string
    icono: typeof Wrench
    variante: 'primario' | 'secundario'
    titulo: string
    descripcion: string
    nota: string
    ayuda: string
    /** La nota es obligatoria (10 letras como mínimo). */
    notaObligatoria: boolean
    fotos: string
    enviar: string
  }
> = {
  CORREGIDA: {
    boton: 'Marcar corregido',
    icono: Wrench,
    variante: 'primario',
    titulo: 'Marcar corregido',
    descripcion: 'Cuenta qué se corrigió o pon una foto de cómo quedó. Le llega a Calidad para que lo revise.',
    nota: 'Qué se corrigió',
    ayuda: 'Con una foto basta; si no hay foto, cuéntalo aquí.',
    notaObligatoria: false,
    fotos: 'De cómo quedó.',
    enviar: 'Marcar corregido',
  },
  LEVANTADA: {
    boton: 'Levantar',
    icono: CheckCheck,
    variante: 'primario',
    titulo: 'Levantar la observación',
    descripcion: 'Das la corrección por buena: la observación se cierra y al área le llega el aviso.',
    nota: 'Nota (opcional)',
    ayuda: 'Si quieres dejar algo dicho al cerrarla.',
    notaObligatoria: false,
    fotos: 'Si quieres dejar cómo quedó.',
    enviar: 'Levantar',
  },
  OBSERVADA_DE_NUEVO: {
    boton: 'Volver a observar',
    icono: RotateCcw,
    variante: 'secundario',
    titulo: 'Volver a observar',
    descripcion: 'La corrección no basta: vuelve al área con lo que sigue mal.',
    nota: 'Qué sigue mal',
    ayuda: 'Es lo que el área va a leer.',
    notaObligatoria: true,
    fotos: 'De lo que sigue mal.',
    enviar: 'Volver a observar',
  },
}

/** El verde y el «sigue enviándose» de los pasos: van en el renglón de estado del encabezado de la ficha. */
const CLAVE = 'calidad:paso'
const ID_DEL_ESTADO = 'estado-del-paso-de-calidad'

export function EstadoDelPaso() {
  const [aviso] = useEstadoCompartido<string | null>(`${CLAVE}:aviso`, null)
  const [desenlace] = useEstadoCompartido<Desenlace | null>(`${CLAVE}:desenlace`, null)
  const [sigue] = useEstadoCompartido(`${CLAVE}:sigue`, false)
  return (
    <>
      {/* Montada siempre: el verde que nace con su texto no lo oye el lector. */}
      <p role="status" className={aviso ? 'text-sm text-exito' : 'sr-only'}>
        {aviso}
      </p>
      <EstadoDelEnvio id={ID_DEL_ESTADO} sigue={sigue} desenlace={desenlace} registro="Lo que enviaste" className="text-sm" />
    </>
  )
}

/**
 * Los botones de la ficha que mueven la observación: el área la marca
 * corregida; Calidad la levanta o la vuelve a observar. Cuáles salen lo dice la
 * base (`puede_corregir`, `puede_revisar`). Todos comparten un envío: mientras
 * uno sigue en camino, ninguno abre otra ventana.
 */
export function PasosDeLaObservacion({ inspeccionId, cuentaId, tipos }: { inspeccionId: string; cuentaId: string; tipos: TipoPasoCalidad[] }) {
  const [tipo, setTipo] = useState<TipoPasoCalidad | null>(null)
  const [vez, setVez] = useState(0)
  const [, setAviso] = useEstadoCompartido<string | null>(`${CLAVE}:aviso`, null)
  const router = useRouter()
  const id = useIdDelEnvio('paso_calidad', () => refrescarSiEsDeLaPestana(router), inspeccionId)
  const envio = useFotosDelEnvio(BUCKET_FOTOS_CALIDAD, CLAVE, ID_DEL_ESTADO)
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    envio.conFotos((previo: unknown, datos: FormData) => {
      id.salio()
      return registrarPasoDeCalidad(previo, datos)
    }),
    (r) => {
      id.otro()
      if (!envio.seCerroAlEnviar()) setTipo(null)
      setAviso(r.mensaje ?? 'Registrado.')
    },
    { alYaEntrar: id.otro },
  )
  function cerrar() {
    envio.cerrar()
    setTipo(null)
  }
  const { sigue, idDelEstado } = envio
  const ocupado = sigue || (enviando && tipo === null)
  if (tipos.length === 0) return null
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {tipos.map((t) => {
          const p = PASOS[t]
          const Icono = p.icono
          return (
            <Boton
              key={t}
              type="button"
              variante={p.variante}
              ocupado={ocupado}
              aria-describedby={sigue ? idDelEstado : undefined}
              data-paso-calidad={t}
              onClick={() => {
                limpiar()
                setAviso(null)
                envio.abrir()
                id.abrir()
                setVez((v) => v + 1)
                setTipo(t)
              }}
            >
              {!ocupado && <Icono aria-hidden className="size-4" />}
              {p.boton}
            </Boton>
          )
        })}
      </div>
      <Ventana
        abierta={tipo !== null}
        alCerrar={cerrar}
        titulo={tipo ? PASOS[tipo].titulo : ''}
        descripcion={tipo ? PASOS[tipo].descripcion : undefined}
        ancho="lg"
      >
        <EnvioAnterior texto={id.anterior} />
        {tipo && id.id && (
          <FormularioPaso
            key={`${vez}:${id.id}`}
            id={id.id}
            tipo={tipo}
            inspeccionId={inspeccionId}
            cuentaId={cuentaId}
            fotos={envio.fotos}
            setFotos={envio.setFotos}
            alCancelar={cerrar}
            alEnviar={alEnviar}
            enviando={enviando}
            error={error}
          />
        )}
      </Ventana>
    </>
  )
}

const DE_LA_NOTA = /qué se corrigió|qué sigue mal|nota pasa/i

function FormularioPaso({
  id,
  tipo,
  inspeccionId,
  cuentaId,
  fotos,
  setFotos,
  alCancelar,
  alEnviar,
  enviando,
  error,
}: {
  id: string
  tipo: TipoPasoCalidad
  inspeccionId: string
  cuentaId: string
  fotos: FotoLista[]
  setFotos: Dispatch<SetStateAction<FotoLista[]>>
  alCancelar: () => void
  alEnviar: (evento: FormEvent<HTMLFormElement>, preparar?: (datos: FormData) => void) => void
  enviando: boolean
  error: string | null
}) {
  const p = PASOS[tipo]
  const subiendo = haySubiendo(fotos)
  const fallidas = hayFallidas(fotos)
  const vieja = usePestanaDeLaVersionAnterior()
  const errorNota = error && DE_LA_NOTA.test(error) ? error : null
  useCursorAlRechazo(
    enviando,
    error,
    useCallback(() => document.getElementById(errorNota ? 'calidad-nota' : 'calidad-paso-error'), [errorNota]),
  )
  return (
    <form
      onSubmit={(e) => alEnviar(e, (datos) => datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos).map((f) => f.ruta_storage))))}
      className="space-y-4"
    >
      <input type="hidden" name="operacion_id" value={id} />
      <input type="hidden" name="inspeccion_id" value={inspeccionId} />
      <input type="hidden" name="tipo" value={tipo} />
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <Campo etiqueta={p.nota} htmlFor="calidad-nota" requerido={p.notaObligatoria} ayuda={p.ayuda} ayudaEnIcono={false} error={errorNota ?? undefined}>
          <AreaTexto
            id="calidad-nota"
            name="nota"
            required={p.notaObligatoria}
            minLength={p.notaObligatoria ? 10 : undefined}
            maxLength={1000}
            rows={3}
          />
        </Campo>
        <section aria-label="Fotos" className="space-y-1">
          <p className="text-xs font-medium text-texto-suave">Fotos{tipo === 'CORREGIDA' ? '' : ' (opcional)'}</p>
          <p className="text-xs text-texto-suave">
            {p.fotos} Hasta {MAXIMO_FOTOS_CALIDAD}.
          </p>
          <SelectorFotos
            fotos={fotos}
            alCambiar={setFotos}
            prefijoRuta={`${cuentaId}/${inspeccionId}`}
            maximo={MAXIMO_FOTOS_CALIDAD}
            bucket={BUCKET_FOTOS_CALIDAD}
            comprimir
            maximoMb={MAXIMO_MB_FOTO_CALIDAD}
            titulo={null}
          />
        </section>
        {!subiendo && fallidas && (
          <p className="text-sm text-peligro">
            {vieja ? 'Vuelve a cargar la pantalla para enviar.' : 'Quita o vuelve a subir las fotos que no entraron antes de enviar.'}
          </p>
        )}
      </fieldset>
      <PieDeVentana
        error={errorNota ? null : error}
        idError="calidad-paso-error"
        enviando={enviando}
        alCancelar={alCancelar}
        texto={subiendo ? 'Esperando las fotos…' : p.enviar}
        disabled={subiendo || fallidas}
      />
    </form>
  )
}

/** Calidad anula una inspección mal registrada, con su motivo. No se borra: queda con quién, cuándo y por qué. */
export function AnularInspeccion({ id, codigo }: { id: string; codigo: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(anularInspeccion, () => setAbierta(false))
  return (
    <>
      <Boton
        type="button"
        variante="contornoPeligro"
        data-anular-inspeccion
        onClick={() => {
          limpiar()
          setAbierta(true)
        }}
      >
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Anular la inspección de ${codigo}`}
        descripcion="Para una inspección repetida o registrada por error. No se borra: queda con su motivo, y si era no conforme, al área le llega que quedó sin efecto."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={enviando} className="min-w-0">
            <Campo etiqueta="Motivo" htmlFor={`anular-calidad-${id}`} requerido>
              <AreaTexto
                id={`anular-calidad-${id}`}
                name="motivo"
                required
                minLength={10}
                maxLength={500}
                placeholder="Por ejemplo: se registró en el código equivocado."
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Anular" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}
