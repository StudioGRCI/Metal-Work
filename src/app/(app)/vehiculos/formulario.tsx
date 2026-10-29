'use client'

import { LogIn } from 'lucide-react'
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
import type { CodigoParaIngreso } from '@/lib/datos/vehiculos'
import {
  BUCKET_FOTOS_VEHICULO,
  MAXIMO_FOTOS_VEHICULO,
  MAXIMO_MB_FOTO_VEHICULO,
  MOTIVO_VEHICULO,
  motivoExigeCodigo,
} from '@/lib/dominio/requerimientos'
import { useEnvio } from '@/lib/envio'

import { registrarIngresoVehiculo } from './acciones'

/**
 * El botón «Registrar ingreso» y su ventana. Las fotos y el envío viven aquí y
 * no en el formulario, que la ventana desmonta al cerrarse: si se cierra sin
 * registrar, las fotos que ya subieron se retiran de Storage; si se registra,
 * quedan con el ingreso. Si se cierra mientras se envía, se quedan con ese envío
 * y lo que conteste se dice junto al botón, que entretanto gira y no abre otra.
 * Antes se quitaban en el acto: la base rechazaba el ingreso («La foto 1 no
 * terminó de subir…»), el vehículo quedaba sin registro y nada lo decía
 * (vigesimosexta pasada).
 */
export function NuevoIngresoVehiculo({ cuentaId, codigos }: { cuentaId: string; codigos: CodigoParaIngreso[] }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  const envio = useFotosDelEnvio(BUCKET_FOTOS_VEHICULO)
  const { alEnviar, enviando, error, limpiar } = useEnvio(envio.conFotos(registrarIngresoVehiculo), (r) => {
    if (!envio.seCerroAlEnviar()) setAbierta(false)
    setAviso(r.mensaje ?? 'Ingreso registrado.')
  })
  function cerrar() {
    envio.cerrar()
    setAbierta(false)
  }
  // Cerrada mientras el ingreso va en camino: no se abre otra hasta que conteste.
  // Tampoco mientras la página se pone al día tras el ok: salía trabada y
  // girando (vigesimoctava pasada).
  const { sigue, idDelEstado } = envio
  const ocupado = sigue || (enviando && !abierta)
  return (
    <>
      <Boton
        type="button"
        ocupado={ocupado}
        aria-describedby={sigue ? idDelEstado : undefined}
        onClick={() => {
          limpiar()
          setAviso(null)
          envio.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        {!ocupado && <LogIn aria-hidden className="size-4" />}
        Registrar ingreso
      </Boton>
      {/* Montada siempre: el verde que nace con su texto no lo oye el lector, y
          tras cerrar en vuelo es lo único que dice que entró (vigesimonovena pasada). */}
      <p role="status" className={aviso ? 'basis-full text-sm text-exito' : 'sr-only'}>
        {aviso}
      </p>
      {/* Con la ventana cerrada mientras se enviaba, su aviso no lo vería nadie. */}
      <EstadoDelEnvio id={idDelEstado} sigue={sigue} desenlace={envio.desenlace} registro="El ingreso" className="basis-full text-sm" />
      <Ventana
        abierta={abierta}
        alCerrar={cerrar}
        titulo="Ingreso de vehículo"
        descripcion="Un vehículo entra a la planta, con fotos de cómo llega. La salida se marca después en la misma fila."
        ancho="lg"
      >
        <FormularioIngreso
          key={vez}
          cuentaId={cuentaId}
          codigos={codigos}
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

function FormularioIngreso({
  cuentaId,
  codigos,
  fotos,
  setFotos,
  alCancelar,
  alEnviar,
  enviando,
  error,
}: {
  cuentaId: string
  codigos: CodigoParaIngreso[]
  fotos: FotoLista[]
  setFotos: Dispatch<SetStateAction<FotoLista[]>>
  alCancelar: () => void
  alEnviar: (evento: FormEvent<HTMLFormElement>, preparar?: (datos: FormData) => void) => void
  enviando: boolean
  error: string | null
}) {
  // Decidido aquí: un reintento manda el mismo y la base no duplica el ingreso.
  // Las fotos suben a la carpeta de este ingreso antes de registrarlo. Si ya
  // había entrado la primera vez, las de este envío no las nombra nadie y se
  // quitan (`useFotosDelEnvio`); las de la primera, la base no las deja quitar.
  const [id] = useState(() => crypto.randomUUID())
  const [motivo, setMotivo] = useState('')
  const [codigo, setCodigo] = useState('')
  const subiendo = haySubiendo(fotos)
  const fallidas = hayFallidas(fotos)
  const listas = fotosParaEnviar(fotos).length
  // El trabajo del taller entra con el código de una unidad con OT, y de ahí
  // salen el cliente y el vehículo (migración 20261020166000).
  const conCodigo = motivoExigeCodigo(motivo)
  // Por garantía entra el código con su OT de garantía abierta, y esa es la OT
  // que se muestra y la que espera la salida (migración 20261021120000).
  const porGarantia = motivo === 'GARANTIA'
  const posibles = porGarantia ? codigos.filter((c) => c.garantia_numero) : codigos
  const otDe = (c: CodigoParaIngreso) => (porGarantia ? (c.garantia_numero ?? c.orden_numero) : c.orden_numero)
  const elegido = conCodigo ? posibles.find((c) => c.codigo_interno === codigo) : undefined
  const libres = posibles.filter((c) => !c.en_planta)
  const enPlanta = posibles.length - libres.length
  const faltaCodigo = conCodigo && !elegido
  // Sin código que elegir, no se piden fotos que no van a servir.
  const sinCodigos = conCodigo && libres.length === 0
  const pideDatos = Boolean(motivo) && !sinCodigos
  return (
    <form
      onSubmit={(e) => alEnviar(e, (datos) => datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos).map((f) => f.ruta_storage))))}
      className="space-y-4"
    >
      <input type="hidden" name="operacion_id" value={id} />
      {/* Trabado mientras se envía: una foto elegida o quitada entonces no iba
          con el ingreso (vigesimoséptima pasada). */}
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Motivo"
            htmlFor="veh-motivo"
            requerido
            ayuda={motivo ? MOTIVO_VEHICULO[motivo]?.descripcion : 'Primero el motivo: el trabajo del taller entra con su código interno.'}
          >
            <Seleccion id="veh-motivo" name="motivo" required value={motivo} onChange={(e) => setMotivo(e.target.value)}>
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

        {conCodigo ? (
          <>
            <Campo
              etiqueta="Código interno"
              htmlFor="veh-codigo"
              requerido
              ayuda={
                libres.length === 0
                  ? undefined
                  : `Solo los códigos con su OT${porGarantia ? ' de garantía' : ''}. El cliente y el vehículo se cargan solos.${
                      enPlanta > 0 ? ` ${enPlanta === 1 ? 'Uno ya está' : `${enPlanta} ya están`} en la planta y no se ofrece${enPlanta === 1 ? '' : 'n'}.` : ''
                    }`
              }
            >
              {libres.length === 0 ? (
                <p id="veh-codigo" className="text-sm text-texto">
                  No hay códigos con OT{porGarantia ? ' de garantía abierta' : ''} por ingresar{enPlanta > 0 ? `: ${enPlanta === 1 ? 'el único ya está' : `los ${enPlanta} ya están`} en la planta` : ''}.
                </p>
              ) : (
                <SeleccionBuscable
                  id="veh-codigo"
                  name="codigo_interno"
                  requerido
                  permiteVaciar={false}
                  marcador="Elige el código interno"
                  marcadorBusqueda="Código, OT o cliente…"
                  valor={codigo}
                  onChange={setCodigo}
                  opciones={libres.map((c) => ({
                    valor: c.codigo_interno,
                    etiqueta: `${c.codigo_interno} · OT ${otDe(c)}`,
                    detalle: [c.cliente, c.placa].filter(Boolean).join(' · '),
                  }))}
                />
              )}
            </Campo>
            {/* Si los códigos están en la planta, no falta ninguna OT: no se pide otra. */}
            {libres.length === 0 && enPlanta === 0 && (
              <p className="text-sm text-texto-suave">
                {porGarantia
                  ? 'Por garantía entra el código con su OT de garantía: Administración la registra en Órdenes de trabajo, sin cotización y de tipo Garantía.'
                  : 'Un vehículo entra a trabajo solo con su código interno y su OT, y el código nace cuando Gerencia aprueba la cotización con su OT.'}{' '}
                Si solo se guarda, elige «Cochera».
              </p>
            )}
            {elegido && (
              <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 p-3 text-sm" data-codigo-elegido={elegido.codigo_interno}>
                <p className="font-medium text-texto">{elegido.unidad}</p>
                <p className="text-texto-suave">
                  {elegido.cliente} · OT <span className="tabular">{otDe(elegido)}</span>
                </p>
              </div>
            )}
            {elegido && (
              // La llave es el código: al cambiarlo, la placa y el chasis vuelven a los de esa unidad.
              <div key={elegido.codigo_interno} className="grid gap-4 sm:grid-cols-2">
                <Campo etiqueta="Placa" htmlFor="veh-placa" ayuda={elegido.placa ? 'La de la unidad.' : 'Si ya tiene.'}>
                  <Entrada id="veh-placa" name="placa" maxLength={15} autoComplete="off" defaultValue={elegido.placa ?? ''} className="uppercase" />
                </Campo>
                <Campo etiqueta="N.º de chasis" htmlFor="veh-chasis" ayuda={elegido.chasis ? 'El de la unidad.' : 'Si es un chasis nuevo.'}>
                  <Entrada id="veh-chasis" name="chasis" maxLength={40} autoComplete="off" defaultValue={elegido.chasis ?? ''} className="uppercase" />
                </Campo>
              </div>
            )}
          </>
        ) : motivo ? (
          <>
            <p className="text-xs text-texto-suave">Anota al menos uno de los tres: placa, chasis o código interno.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo etiqueta="Placa" htmlFor="veh-placa">
                <Entrada id="veh-placa" name="placa" maxLength={15} autoComplete="off" placeholder="ABC-123" className="uppercase" />
              </Campo>
              <Campo etiqueta="N.º de chasis" htmlFor="veh-chasis" ayuda="Para un chasis nuevo que todavía no tiene placa.">
                <Entrada id="veh-chasis" name="chasis" maxLength={40} autoComplete="off" className="uppercase" />
              </Campo>
              <Campo etiqueta="Código interno" htmlFor="veh-codigo" ayuda="Si tiene uno.">
                <Entrada id="veh-codigo" name="codigo_interno" maxLength={60} autoComplete="off" />
              </Campo>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Vehículo" htmlFor="veh-unidad" requerido>
                <Entrada id="veh-unidad" name="unidad" required minLength={2} maxLength={120} placeholder="Camioneta Toyota Hilux" />
              </Campo>
              <Campo etiqueta="Empresa" htmlFor="veh-empresa" requerido ayuda="El cliente o dueño del vehículo.">
                <Entrada id="veh-empresa" name="empresa" required minLength={2} maxLength={160} />
              </Campo>
            </div>
          </>
        ) : null}

        {pideDatos && (
          <>
            <Campo etiqueta="Observación" htmlFor="veh-obs">
              <AreaTexto id="veh-obs" name="observacion" maxLength={500} rows={2} placeholder="Cómo llega: llanta baja, sin espejo derecho, con documentos…" />
            </Campo>
            <FotosDelMomento
              titulo="Fotos al entrar"
              fotos={fotos}
              setFotos={setFotos}
              prefijoRuta={`${cuentaId}/${id}/ingreso`}
            />
          </>
        )}
        {pideDatos && <AvisoFotos subiendo={subiendo} fallidas={fallidas} listas={listas} momento="entrar" />}
      </fieldset>
      {/* Si el ingreso ya había entrado la primera vez, las fotos nuevas, que no
          nombra nadie, las quita la respuesta misma (`useFotosDelEnvio`): «Cerrar»
          solo cierra. */}
      <PieDeVentana
        error={error}
        enviando={enviando}
        alCancelar={alCancelar}
        texto={subiendo ? 'Esperando las fotos…' : 'Registrar ingreso'}
        disabled={!pideDatos || faltaCodigo || subiendo || fallidas || listas === 0}
      />
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
