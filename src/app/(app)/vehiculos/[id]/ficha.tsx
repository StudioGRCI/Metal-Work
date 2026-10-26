'use client'

import { FileDown, FileUp, Send } from 'lucide-react'
import { useState } from 'react'

import { BASE_BOTON, Boton, TAMANOS, VARIANTES } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { Insignia } from '@/components/ui/etiqueta-estado'
import type { FichaDeVehiculo, PuntoDeFicha } from '@/lib/datos/vehiculos'
import {
  BUCKET_FICHAS_VEHICULO,
  CATEGORIAS_FICHA,
  ESTADOS_PUNTO,
  MAXIMO_MB_FICHA,
  estadoDePunto,
  puntosSinMarcar,
  rutaFichaVehiculo,
} from '@/lib/dominio/ficha-vehiculo'
import { fechaHora } from '@/lib/format'
import { useEnvio } from '@/lib/envio'
import { subirArchivoPrivado } from '@/lib/subida-privada'
import { cn } from '@/lib/utils'

import { adjuntarFichaFirmada, guardarFichaVehiculo, pedirRevisionSalida } from '../acciones-ficha'

function Alerta({ error, mensaje }: { error: string | null; mensaje?: string | null }) {
  if (error) return <p role="alert" className="text-sm text-peligro">{error}</p>
  if (mensaje) return <p role="status" className="text-sm text-exito">{mensaje}</p>
  return null
}

/**
 * La ficha única de ingreso y salida (SIG-FCLIV-001), la misma que se llenaba
 * en la OT: los datos del conductor y los puntos de inspección al entrar y al
 * salir. Se guarda de a poco; cerrar el ingreso lo deja fijo y cerrar la salida
 * deja solo adjuntar el escaneo firmado.
 */
export function FichaDelVehiculo({
  registro,
  ficha,
  puntos,
  editable,
  salio = false,
}: {
  registro: string
  ficha: FichaDeVehiculo | null
  puntos: PuntoDeFicha[]
  editable: boolean
  /** El vehículo ya dejó la planta: la ficha queda como estaba (la base tampoco la deja cambiar). */
  salio?: boolean
}) {
  const ingresoCerrado = Boolean(ficha?.ingreso_cerrado_en)
  const salidaCerrada = Boolean(ficha?.salida_cerrada_en)
  const codigos = puntos.map((p) => p.codigo)
  const faltanIngreso = puntosSinMarcar(ficha?.items, codigos, 'ingreso')
  const faltanSalida = puntosSinMarcar(ficha?.items, codigos, 'salida')
  const { alEnviar, enviando, error, resultado } = useEnvio(guardarFichaVehiculo)

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    const boton = (evento.nativeEvent as SubmitEvent).submitter
    const accion = boton instanceof HTMLButtonElement ? boton.value : 'GUARDAR'
    if (
      accion !== 'GUARDAR' &&
      !window.confirm(
        accion === 'CERRAR_INGRESO'
          ? '¿Cerrar el ingreso? El conductor, la fecha y los puntos de ingreso quedan fijos.'
          : '¿Cerrar la salida? Después solo podrás adjuntar el escaneo firmado.',
      )
    ) {
      evento.preventDefault()
      return
    }
    alEnviar(evento, (d) => d.set('accion', accion))
  }

  const bloqueado = !editable || salidaCerrada || enviando
  return (
    <form onSubmit={enviar} className="space-y-5">
      <input type="hidden" name="registro" value={registro} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Insignia tono={ingresoCerrado ? 'exito' : salio ? 'neutro' : 'aviso'}>
          Ingreso {ingresoCerrado ? `cerrado el ${fechaHora(ficha?.ingreso_cerrado_en ?? '')}` : salio ? 'sin cerrar' : 'por cerrar'}
        </Insignia>
        <Insignia tono={salidaCerrada ? 'exito' : 'neutro'}>
          Salida {salidaCerrada ? `cerrada el ${fechaHora(ficha?.salida_cerrada_en ?? '')}` : salio ? 'sin cerrar' : 'por cerrar'}
        </Insignia>
      </div>

      {/* Arriba, junto a las insignias: que no parezca que todavía falta cerrarla. */}
      {salio && !salidaCerrada && (
        <p className="text-sm text-texto-suave">El vehículo ya salió de la planta: la ficha queda como estaba.</p>
      )}
      <fieldset disabled={bloqueado} className="space-y-4">
        <legend className="sr-only">Datos de la ficha</legend>
        <section aria-label="Al entrar" className="space-y-3">
          <h3 className="text-sm font-semibold text-texto">Al entrar</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etiqueta="Marca" htmlFor="fv-marca">
              <Entrada id="fv-marca" name="marca" maxLength={80} defaultValue={ficha?.marca ?? ''} readOnly={ingresoCerrado} />
            </Campo>
            <Campo etiqueta="Conductor" htmlFor="fv-ci" requerido>
              <Entrada id="fv-ci" name="conductor_ingreso" maxLength={120} defaultValue={ficha?.conductor_ingreso ?? ''} readOnly={ingresoCerrado} />
            </Campo>
            <Campo etiqueta="DNI del conductor" htmlFor="fv-di">
              <Entrada id="fv-di" name="dni_ingreso" maxLength={20} inputMode="numeric" defaultValue={ficha?.dni_ingreso ?? ''} readOnly={ingresoCerrado} />
            </Campo>
            <Campo etiqueta="Fecha" htmlFor="fv-fi" requerido>
              <Entrada id="fv-fi" name="fecha_ingreso" type="date" defaultValue={ficha?.fecha_ingreso ?? ''} readOnly={ingresoCerrado} />
            </Campo>
            <Campo etiqueta="Combustible" htmlFor="fv-combi" ayuda="Como marca el tablero: 1/4, 1/2…">
              <Entrada id="fv-combi" name="combustible_ingreso" maxLength={40} defaultValue={ficha?.combustible_ingreso ?? ''} readOnly={ingresoCerrado} />
            </Campo>
            <Campo etiqueta="Observación al entrar" htmlFor="fv-oi" className="sm:col-span-2 lg:col-span-3">
              <AreaTexto id="fv-oi" name="observacion_ingreso" rows={2} maxLength={2000} defaultValue={ficha?.observacion_ingreso ?? ''} readOnly={ingresoCerrado} />
            </Campo>
          </div>
        </section>

        <section aria-label="Al salir" className="space-y-3">
          <h3 className="text-sm font-semibold text-texto">Al salir</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etiqueta="Conductor" htmlFor="fv-cs">
              <Entrada id="fv-cs" name="conductor_salida" maxLength={120} defaultValue={ficha?.conductor_salida ?? ''} />
            </Campo>
            <Campo etiqueta="DNI del conductor" htmlFor="fv-ds">
              <Entrada id="fv-ds" name="dni_salida" maxLength={20} inputMode="numeric" defaultValue={ficha?.dni_salida ?? ''} />
            </Campo>
            <Campo etiqueta="Fecha" htmlFor="fv-fs">
              <Entrada id="fv-fs" name="fecha_salida" type="date" defaultValue={ficha?.fecha_salida ?? ''} />
            </Campo>
            <Campo etiqueta="Combustible" htmlFor="fv-combs">
              <Entrada id="fv-combs" name="combustible_salida" maxLength={40} defaultValue={ficha?.combustible_salida ?? ''} />
            </Campo>
            <Campo etiqueta="Trabajos realizados" htmlFor="fv-tr" className="sm:col-span-2">
              <AreaTexto id="fv-tr" name="trabajos" rows={2} maxLength={2000} defaultValue={ficha?.trabajos ?? ''} />
            </Campo>
            <Campo etiqueta="Accesorios adicionales" htmlFor="fv-ad" className="sm:col-span-2">
              <AreaTexto id="fv-ad" name="adicionales" rows={2} maxLength={2000} defaultValue={ficha?.adicionales ?? ''} />
            </Campo>
            <Campo etiqueta="Observación al salir" htmlFor="fv-os" className="sm:col-span-2 lg:col-span-4">
              <AreaTexto id="fv-os" name="observacion_salida" rows={2} maxLength={2000} defaultValue={ficha?.observacion_salida ?? ''} />
            </Campo>
          </div>
        </section>

        <section aria-label="Puntos de inspección" className="space-y-2">
          <h3 className="text-sm font-semibold text-texto">
            Puntos de inspección
            <span className="ml-2 text-xs font-normal text-texto-suave">
              {ingresoCerrado
                ? faltanSalida > 0
                  ? `faltan ${faltanSalida} de la salida`
                  : 'todos marcados'
                : faltanIngreso > 0
                  ? `faltan ${faltanIngreso} del ingreso`
                  : 'ingreso completo'}
            </span>
          </h3>
          {CATEGORIAS_FICHA.map((categoria) => {
            const deCategoria = puntos.filter((p) => p.categoria === categoria.valor)
            if (deCategoria.length === 0) return null
            return (
              <details key={categoria.valor} className="rounded-[var(--radius-base)] border border-borde p-3" data-categoria={categoria.valor}>
                <summary className="cursor-pointer text-sm font-medium text-texto">
                  {categoria.etiqueta} <span className="text-xs font-normal text-texto-suave">({deCategoria.length})</span>
                </summary>
                <ul className="mt-3 divide-y divide-borde">
                  {deCategoria.map((p) => (
                    <li key={p.codigo} className="grid gap-2 py-2 sm:grid-cols-[1fr_10rem_10rem] sm:items-center">
                      <span className="text-sm text-texto">{p.nombre}</span>
                      {(['ingreso', 'salida'] as const).map((fase) => (
                        <label key={fase} className="text-xs text-texto-suave">
                          {fase === 'ingreso' ? 'Al entrar' : 'Al salir'}
                          <Seleccion
                            aria-label={`${p.nombre} al ${fase === 'ingreso' ? 'entrar' : 'salir'}`}
                            name={`${fase}_${p.codigo}`}
                            defaultValue={estadoDePunto(ficha?.items, p.codigo, fase) ?? ''}
                            disabled={fase === 'ingreso' && ingresoCerrado}
                          >
                            <option value="">Sin marcar</option>
                            {ESTADOS_PUNTO.map((e) => (
                              <option key={e.valor} value={e.valor}>
                                {e.etiqueta}
                              </option>
                            ))}
                          </Seleccion>
                        </label>
                      ))}
                    </li>
                  ))}
                </ul>
              </details>
            )
          })}
        </section>
      </fieldset>

      <Alerta error={error} mensaje={resultado?.ok ? resultado.mensaje : null} />
      {editable && !salidaCerrada && (
        <div className="flex flex-wrap gap-2">
          <Boton type="submit" value="GUARDAR" variante="secundario" cargando={enviando}>
            Guardar avance
          </Boton>
          {!ingresoCerrado ? (
            <Boton type="submit" value="CERRAR_INGRESO" cargando={enviando}>
              Cerrar ingreso
            </Boton>
          ) : (
            <Boton type="submit" value="CERRAR_SALIDA" cargando={enviando}>
              Cerrar salida
            </Boton>
          )}
        </div>
      )}
    </form>
  )
}

/** El escaneo firmado: sube al almacenamiento y después se anota en la ficha. */
export function AdjuntarEscaneo({ registro }: { registro: string }) {
  const [archivoId, setArchivoId] = useState(() => crypto.randomUUID())
  const { alEnviar, enviando, error, resultado } = useEnvio(
    async (_previo, datos) => {
      const archivo = datos.get('pdf')
      if (
        !(archivo instanceof File) ||
        archivo.size < 1 ||
        archivo.size > MAXIMO_MB_FICHA * 1024 * 1024 ||
        (await archivo.slice(0, 5).text()) !== '%PDF-'
      ) {
        return { ok: false as const, error: `Elige el escaneo firmado en PDF, de hasta ${MAXIMO_MB_FICHA} MB.` }
      }
      datos.delete('pdf')
      datos.set('nombre_archivo', archivo.name.trim().slice(0, 200) || 'ficha-firmada.pdf')
      return subirArchivoPrivado({
        bucket: BUCKET_FICHAS_VEHICULO,
        ruta: rutaFichaVehiculo(registro, archivoId),
        archivo,
        contentType: 'application/pdf',
        registrar: () => adjuntarFichaFirmada(null, datos),
      })
    },
    () => setArchivoId(crypto.randomUUID()),
  )
  return (
    <form onSubmit={alEnviar} className="grid gap-3 rounded-[var(--radius-base)] border border-borde p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <input type="hidden" name="registro" value={registro} />
      <input type="hidden" name="archivo" value={archivoId} />
      <Campo etiqueta="Escaneo firmado en PDF" htmlFor="fv-escaneo" requerido ayuda="La ficha impresa, firmada por el conductor y por Metal Work.">
        <ElegirArchivo id="fv-escaneo" name="pdf" accept="application/pdf,.pdf" hastaMb={MAXIMO_MB_FICHA} required disabled={enviando} />
      </Campo>
      <Boton type="submit" cargando={enviando}>
        <FileUp aria-hidden className="size-4" />
        Adjuntar escaneo
      </Boton>
      <div className="sm:col-span-2">
        <Alerta error={error} mensaje={resultado?.ok ? resultado.mensaje : null} />
      </div>
    </form>
  )
}

/** Descargar la ficha para imprimirla y firmarla: es la misma que se llenó. */
export function DescargarFicha({ registro }: { registro: string }) {
  return (
    // Un enlace de verdad con `download`: el PDF lo arma una ruta del mismo dominio.
    <a href={`/vehiculos/${registro}/ficha/pdf`} download className={cn(BASE_BOTON, VARIANTES.secundario, TAMANOS.sm)}>
      <FileDown aria-hidden className="size-4" />
      Descargar ficha PDF
    </a>
  )
}

/** El pedido a Tesorería: qué tiene que revisar antes de que el vehículo salga. */
export function PedirRevision({ registro, solicitud }: { registro: string; solicitud: string }) {
  const [id, setId] = useState(solicitud)
  const { alEnviar, enviando, error, resultado } = useEnvio(pedirRevisionSalida, () => setId(crypto.randomUUID()))
  return (
    <form onSubmit={alEnviar} className="grid gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="registro" value={registro} />
      <Campo etiqueta="Qué tiene que revisar Tesorería" htmlFor="fv-concepto" requerido ayuda="Por ejemplo: si el cliente pagó el saldo de la factura antes de entregarle la unidad.">
        <AreaTexto id="fv-concepto" name="concepto" rows={2} minLength={3} maxLength={2000} required disabled={enviando} />
      </Campo>
      <Alerta error={error} mensaje={resultado?.ok ? resultado.mensaje : null} />
      <div>
        <Boton type="submit" cargando={enviando}>
          <Send aria-hidden className="size-4" />
          Pedir revisión a Tesorería
        </Boton>
      </div>
    </form>
  )
}
