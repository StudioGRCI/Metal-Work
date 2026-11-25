'use client'

import { ShieldAlert } from 'lucide-react'
import Link from 'next/link'
import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'

import {
  EstadoDelEnvio,
  SelectorFotos,
  fotosParaEnviar,
  hayFallidas,
  haySubiendo,
  useFotosDelEnvio,
  type FotoLista,
} from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { AreaParaReportar, PersonaParaReportar } from '@/lib/datos/ssoma'
import {
  BUCKET_FOTOS_SSOMA,
  MAXIMO_FOTOS_SSOMA,
  MAXIMO_MB_FOTO_SSOMA,
  TIPO_REPORTE_SSOMA,
  TIPOS_REPORTE_SSOMA,
} from '@/lib/dominio/ssoma'
import { useEnvio, usePestanaDeLaVersionAnterior } from '@/lib/envio'

import { reportarIncidente } from './acciones'

/**
 * El botón «Reportar incidente» y su ventana: lo usa cualquier puesto, desde el
 * teléfono. Las fotos y el envío viven aquí y no en el formulario, que la
 * ventana desmonta al cerrarse (el mismo patrón del ingreso de vehículos): si se
 * cierra sin reportar, las fotos ya subidas se retiran de Storage; si se cierra
 * mientras se envía, lo que conteste se dice junto al botón.
 */
export function ReportarIncidente({
  cuentaId,
  areaDeLaCuenta,
  areas,
  personal,
}: {
  cuentaId: string
  /** El área de quien reporta, para proponerla: casi siempre pasó ahí. */
  areaDeLaCuenta: string | null
  areas: AreaParaReportar[]
  /** La lista de RR. HH., solo para quien puede reportar a nombre de otra persona; si no, vacía. */
  personal: PersonaParaReportar[]
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [entro, setEntro] = useState<{ mensaje: string; id: string | null } | null>(null)
  const envio = useFotosDelEnvio(BUCKET_FOTOS_SSOMA)
  const { alEnviar, enviando, error, limpiar } = useEnvio(envio.conFotos(reportarIncidente), (r) => {
    if (!envio.seCerroAlEnviar()) setAbierta(false)
    setEntro({ mensaje: r.mensaje ?? 'Reporte registrado.', id: r.datos?.id ?? null })
  })
  function cerrar() {
    envio.cerrar()
    setAbierta(false)
  }
  // Cerrada mientras el reporte va en camino: no se abre otra hasta que conteste,
  // ni mientras la página se pone al día tras el ok.
  const { sigue, idDelEstado } = envio
  const ocupado = sigue || (enviando && !abierta)
  return (
    <>
      <Boton
        type="button"
        ocupado={ocupado}
        aria-describedby={sigue ? idDelEstado : undefined}
        data-reportar-incidente
        onClick={() => {
          limpiar()
          setEntro(null)
          envio.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        {!ocupado && <ShieldAlert aria-hidden className="size-4" />}
        Reportar incidente
      </Boton>
      {/* Montada siempre: el verde que nace con su texto no lo oye el lector, y
          tras cerrar en vuelo es lo único que dice que entró. */}
      <p role="status" className={entro ? 'basis-full text-sm text-exito' : 'sr-only'}>
        {entro?.mensaje}
        {entro?.id && (
          <>
            {' '}
            <Link href={`/ssoma/${entro.id}`} className="font-medium underline underline-offset-2">
              Ver cómo va
            </Link>
          </>
        )}
      </p>
      {/* Con la ventana cerrada mientras se enviaba, su aviso no lo vería nadie. */}
      <EstadoDelEnvio id={idDelEstado} sigue={sigue} desenlace={envio.desenlace} registro="El reporte" className="basis-full text-sm" />
      <Ventana
        abierta={abierta}
        alCerrar={cerrar}
        titulo="Reportar a SSOMA"
        descripcion="Un accidente, un incidente o algo inseguro que viste. Le llega a SSOMA en el momento y tú ves cómo va."
        ancho="lg"
      >
        <FormularioReporte
          key={vez}
          cuentaId={cuentaId}
          areaDeLaCuenta={areaDeLaCuenta}
          areas={areas}
          personal={personal}
          fotos={envio.fotos}
          setFotos={envio.setFotos}
          alCancelar={cerrar}
          alEnviar={alEnviar}
          enviando={enviando}
          error={error}
        />
      </Ventana>
    </>
  )
}

const OPCION =
  'flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm text-texto has-[:checked]:border-acento has-[:checked]:bg-acento-suave'
const RADIO = 'mt-0.5 size-4 shrink-0 accent-[var(--acento)]'

function FormularioReporte({
  cuentaId,
  areaDeLaCuenta,
  areas,
  personal,
  fotos,
  setFotos,
  alCancelar,
  alEnviar,
  enviando,
  error,
}: {
  cuentaId: string
  areaDeLaCuenta: string | null
  areas: AreaParaReportar[]
  personal: PersonaParaReportar[]
  fotos: FotoLista[]
  setFotos: Dispatch<SetStateAction<FotoLista[]>>
  alCancelar: () => void
  alEnviar: (evento: FormEvent<HTMLFormElement>, preparar?: (datos: FormData) => void) => void
  enviando: boolean
  error: string | null
}) {
  // Decidido aquí: un reintento manda el mismo y la base no duplica el reporte.
  // Las fotos suben a la carpeta de este reporte antes de registrarlo.
  const [id] = useState(() => crypto.randomUUID())
  const [tipo, setTipo] = useState('')
  const [trabajador, setTrabajador] = useState('')
  const subiendo = haySubiendo(fotos)
  const fallidas = hayFallidas(fotos)
  // Con la pestaña vieja ni quitarlas ni subirlas otra vez sirve: no va a entrar.
  const vieja = usePestanaDeLaVersionAnterior()
  const esAccidente = tipo === 'ACCIDENTE'
  return (
    <form
      onSubmit={(e) => alEnviar(e, (datos) => datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos).map((f) => f.ruta_storage))))}
      className="space-y-4"
    >
      <input type="hidden" name="operacion_id" value={id} />
      {/* Trabado mientras se envía: una foto elegida o quitada entonces no iría con el reporte. */}
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-medium text-texto-suave">
            ¿Qué reportas?<span className="ml-0.5 text-peligro">*</span>
          </legend>
          {TIPOS_REPORTE_SSOMA.map((valor) => (
            <label key={valor} className={OPCION}>
              <input type="radio" name="tipo" value={valor} required checked={tipo === valor} onChange={() => setTipo(valor)} className={RADIO} />
              <span>
                <span className="font-medium">{TIPO_REPORTE_SSOMA[valor].etiqueta}</span>
                <span className="block text-xs text-texto-suave">{TIPO_REPORTE_SSOMA[valor].descripcion}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Área donde pasó" htmlFor="ssoma-area" requerido>
            <Seleccion id="ssoma-area" name="area_id" required defaultValue={areas.some((a) => a.id === areaDeLaCuenta) ? (areaDeLaCuenta ?? '') : ''}>
              <option value="" disabled>
                Elige el área
              </option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>
          <Campo etiqueta="Lugar exacto" htmlFor="ssoma-lugar" requerido ayuda="La nave, la máquina o la zona.">
            <Entrada id="ssoma-lugar" name="lugar" required minLength={3} maxLength={120} placeholder="Nave 2, junto a la plegadora" />
          </Campo>
        </div>

        <Campo
          etiqueta={esAccidente || tipo === 'INCIDENTE' ? 'Qué pasó' : 'Qué viste'}
          htmlFor="ssoma-descripcion"
          requerido
          ayuda="Con tus palabras: qué pasó, con qué y qué se hizo en el momento."
        >
          <AreaTexto
            id="ssoma-descripcion"
            name="descripcion"
            required
            minLength={10}
            maxLength={2000}
            rows={4}
            placeholder="Por ejemplo: se soltó la manguera del compresor y golpeó la mesa de trabajo; no había nadie al lado."
          />
        </Campo>

        <Campo etiqueta="Fecha y hora del hecho" htmlFor="ssoma-cuando" ayuda="Déjalo vacío si acaba de pasar.">
          <Entrada id="ssoma-cuando" name="ocurrido_en" type="datetime-local" className="sm:max-w-xs" />
        </Campo>

        {esAccidente && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-texto-suave">
              ¿Hubo atención médica?<span className="ml-0.5 text-peligro">*</span>
            </legend>
            <p className="text-xs text-texto-suave">Solo sí o no. No escribas diagnósticos ni datos médicos en el reporte.</p>
            <div className="grid grid-cols-2 gap-2 sm:max-w-xs">
              {(['SI', 'NO'] as const).map((v) => (
                <label key={v} className={OPCION}>
                  <input type="radio" name="hubo_atencion" value={v} required className={RADIO} />
                  <span>{v === 'SI' ? 'Sí' : 'No'}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {personal.length > 0 && (
          <Campo
            etiqueta="A nombre de un trabajador sin cuenta"
            htmlFor="ssoma-trabajador"
            ayuda="Solo si reportas por alguien de tu equipo que no tiene cuenta. Si lo reportas tú, déjalo vacío."
          >
            <SeleccionBuscable
              id="ssoma-trabajador"
              name="trabajador_id"
              marcador="Lo reporto yo"
              marcadorBusqueda="Nombre, cargo o área…"
              valor={trabajador}
              onChange={setTrabajador}
              opciones={personal.map((p) => ({
                valor: p.id,
                etiqueta: p.nombre,
                detalle: [p.cargo, p.area].filter(Boolean).join(' · '),
              }))}
            />
          </Campo>
        )}

        <section aria-label="Fotos" className="space-y-1">
          <p className="text-xs font-medium text-texto-suave">Fotos (opcional)</p>
          <p className="text-xs text-texto-suave">
            Del lugar o de lo que está mal: ayudan a SSOMA a entender sin ir hasta allá. Hasta {MAXIMO_FOTOS_SSOMA}. No fotografíes
            lesiones.
          </p>
          <SelectorFotos
            fotos={fotos}
            alCambiar={setFotos}
            prefijoRuta={`${cuentaId}/${id}`}
            maximo={MAXIMO_FOTOS_SSOMA}
            bucket={BUCKET_FOTOS_SSOMA}
            comprimir
            maximoMb={MAXIMO_MB_FOTO_SSOMA}
            titulo={null}
          />
        </section>
        {!subiendo && fallidas && (
          <p className="text-sm text-peligro">
            {vieja ? 'Vuelve a cargar la pantalla para reportar.' : 'Quita o vuelve a subir las fotos que no entraron antes de reportar.'}
          </p>
        )}
      </fieldset>
      <PieDeVentana
        error={error}
        enviando={enviando}
        alCancelar={alCancelar}
        texto={subiendo ? 'Esperando las fotos…' : 'Enviar el reporte'}
        disabled={subiendo || fallidas}
      />
    </form>
  )
}
