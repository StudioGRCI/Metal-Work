'use client'

import { Ban, CheckCheck, FileUp, Pencil, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { subirArchivoSubcontrato } from '@/lib/archivos-subcontratos'
import {
  AYUDA_RETENCION,
  MAXIMO_MB_SUBCONTRATOS,
  RETENCION_PORCENTAJE,
  UMBRAL_RETENCION_PEN,
  retencionYNeto,
} from '@/lib/dominio/subcontratos'
import type { CodigoParaElegir } from '@/lib/dominio/codigos-internos'
import { useAccion, useEnvio, useIdDelEnvio } from '@/lib/envio'
import { moneda as formatoMoneda } from '@/lib/format'

import { anularRecibo, anularSubcontrato, cambiarEstadoSubcontrato, corregirSubcontrato, registrarRecibo } from '../acciones'
import { CampoAreaSubcontrato, CampoCodigoInterno } from '../formularios'

const ACEPTA = 'application/pdf,image/jpeg,image/png,image/webp'

/** El archivo del campo, o `null` si no eligieron ninguno. Se saca del FormData: a la acción viaja solo su ruta. */
function sacarArchivo(datos: FormData): File | null {
  const archivo = datos.get('archivo')
  datos.delete('archivo')
  // Uno vacío también cuenta como elegido: lo rechaza la subida diciendo que está vacío.
  return archivo instanceof File && archivo.name !== '' ? archivo : null
}

/**
 * Administración sube un recibo por honorarios: su número, la fecha, el monto
 * bruto, si lleva retención y el archivo. El archivo sube primero a Storage y,
 * si el recibo no entra, se retira. El id vive en el botón y no en el
 * formulario, que se rehace al abrir (`useIdDelEnvio`): tras «No llegó la
 * respuesta», cancelar y volver a abrir lleva el mismo, y si aquel entró, la
 * ventana lo dice y el siguiente lleva otro.
 */
export function SubirRecibo({ subcontratoId, hoy, moneda }: { subcontratoId: string; hoy: string; moneda: 'PEN' | 'USD' }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const recibo = useIdDelEnvio('recibo_honorarios')
  return (
    <>
      <Boton
        type="button"
        onClick={() => {
          recibo.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
        data-subir-recibo
      >
        <FileUp aria-hidden className="size-4" />
        Subir recibo por honorarios
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Subir un recibo por honorarios"
        descripcion="Copia los datos del recibo y adjúntalo. Tesorería recibe el aviso y lo paga a la cuenta del subcontratista."
        ancho="md"
      >
        <EnvioAnterior texto={recibo.anterior} />
        {recibo.id && (
          <FormularioRecibo
            key={vez}
            id={recibo.id}
            subcontratoId={subcontratoId}
            hoy={hoy}
            moneda={moneda}
            alSalir={recibo.salio}
            alYaEntrar={recibo.otro}
            alTerminar={() => {
              setAbierta(false)
              recibo.otro()
            }}
          />
        )}
      </Ventana>
    </>
  )
}

function FormularioRecibo({
  id,
  subcontratoId,
  hoy,
  moneda,
  alSalir,
  alYaEntrar,
  alTerminar,
}: {
  /** Un reintento manda el mismo y la base no registra otro. */
  id: string
  subcontratoId: string
  hoy: string
  moneda: 'PEN' | 'USD'
  alSalir: () => void
  alYaEntrar: () => void
  alTerminar: () => void
}) {
  const [bruto, setBruto] = useState('')
  // Mientras no la toquen, la casilla sigue al monto: pasa de S/ 1,500, lleva retención.
  const [retencionElegida, setRetencionElegida] = useState<boolean | null>(null)
  const monto = Number(bruto) || 0
  const retencion = retencionElegida ?? (moneda === 'PEN' && monto > UMBRAL_RETENCION_PEN)
  const cuentas = retencionYNeto(monto, retencion)

  async function subir(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = sacarArchivo(datos)
    if (!archivo) return { ok: false, error: 'Adjunta el recibo por honorarios.' }
    datos.set('retencion', retencion ? 'si' : 'no')
    alSalir()
    return subirArchivoSubcontrato(subcontratoId, archivo, (ruta) => {
      datos.set('ruta', ruta)
      return registrarRecibo(null, datos)
    })
  }
  const { alEnviar, enviando, error } = useEnvio(subir, alTerminar, { alYaEntrar })
  const prefijo = `rxh-${id.slice(0, 8)}`

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="subcontrato_id" value={subcontratoId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="N.º del recibo" htmlFor={`${prefijo}-numero`} requerido ayuda="La serie, un guion y el número, por ejemplo E001-25.">
          <Entrada
            id={`${prefijo}-numero`}
            name="numero"
            required
            maxLength={14}
            pattern="[A-Za-z0-9]{1,4}-[0-9]{1,8}"
            placeholder="E001-25"
            autoComplete="off"
            autoCapitalize="characters"
            className="tabular uppercase"
          />
        </Campo>
        <Campo etiqueta="Fecha de emisión" htmlFor={`${prefijo}-fecha`} requerido>
          <Entrada id={`${prefijo}-fecha`} name="fecha_emision" type="date" required defaultValue={hoy} max={hoy} />
        </Campo>
      </div>
      <Campo etiqueta="Concepto" htmlFor={`${prefijo}-concepto`} ayuda="Lo que dice el recibo, si ayuda a reconocerlo: un avance, el saldo.">
        <Entrada id={`${prefijo}-concepto`} name="concepto" maxLength={300} autoComplete="off" />
      </Campo>
      <Campo etiqueta="Total de honorarios (bruto)" htmlFor={`${prefijo}-bruto`} requerido ayuda={`En ${moneda === 'USD' ? 'dólares' : 'soles'}, como el subcontrato: antes de la retención.`}>
        <Entrada
          id={`${prefijo}-bruto`}
          name="monto_bruto"
          type="number"
          inputMode="decimal"
          min={0.01}
          step="0.01"
          required
          value={bruto}
          onChange={(e) => setBruto(e.target.value)}
          className="tabular"
        />
      </Campo>
      <div className="space-y-2 rounded-lg border border-borde p-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={retencion}
            onChange={(e) => setRetencionElegida(e.target.checked)}
            className="size-5 accent-[var(--acento)]"
            aria-describedby={`${prefijo}-retencion-ayuda`}
          />
          <span className="text-sm text-texto">Lleva retención del {RETENCION_PORCENTAJE} %</span>
        </label>
        <p id={`${prefijo}-retencion-ayuda`} className="text-xs text-texto-suave">
          {AYUDA_RETENCION}
        </p>
        <dl className="grid grid-cols-3 gap-2 pt-1 text-sm">
          <div>
            <dt className="text-xs text-texto-suave">Bruto</dt>
            <dd className="tabular text-texto">{formatoMoneda(monto, moneda)}</dd>
          </div>
          <div>
            <dt className="text-xs text-texto-suave">Retención</dt>
            <dd className="tabular text-texto">{formatoMoneda(cuentas.retencion, moneda)}</dd>
          </div>
          <div>
            <dt className="text-xs text-texto-suave">Tesorería paga</dt>
            <dd className="tabular font-semibold text-texto">{formatoMoneda(cuentas.neto, moneda)}</dd>
          </div>
        </dl>
      </div>
      <Campo etiqueta="Recibo por honorarios" htmlFor={`${prefijo}-archivo`} requerido ayuda="El PDF que emite SUNAT, o una foto.">
        <ElegirArchivo id={`${prefijo}-archivo`} name="archivo" accept={ACEPTA} hastaMb={MAXIMO_MB_SUBCONTRATOS} required />
      </Campo>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Boton type="button" variante="contorno" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviando}>
          Registrar recibo
        </Boton>
      </div>
    </form>
  )
}

/** Corregir el código interno, el trabajo, lo pactado o las fechas mientras el subcontrato está vigente. */
export function CorregirSubcontrato({
  subcontrato: s,
  codigos,
}: {
  subcontrato: {
    id: string
    numero: string
    codigo_interno: string
    area_codigo: string | null
    descripcion: string
    monto: number
    moneda: 'PEN' | 'USD'
    fecha_inicio: string | null
    fecha_fin: string | null
  }
  codigos: CodigoParaElegir[] | null
}) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(corregirSubcontrato, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="contorno" onClick={() => setAbierta(true)} data-corregir-subcontrato>
        <Pencil aria-hidden className="size-4" />
        Corregir
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Corregir el subcontrato ${s.numero}`}
        descripcion="El subcontratista y la moneda no se cambian: si están mal, anula este y registra otro."
        ancho="lg"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={s.id} />
          <Campo etiqueta="Qué trabajo se le encarga" htmlFor="corregir-descripcion" requerido>
            <AreaTexto id="corregir-descripcion" name="descripcion" required minLength={10} maxLength={1000} rows={3} defaultValue={s.descripcion} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Uno de antes sin área se puede dejar así; a uno que ya la tiene no se le quita. */}
            <CampoAreaSubcontrato id="corregir-area" valor={s.area_codigo} opcional={!s.area_codigo} />
            <CampoCodigoInterno id="corregir-codigo" codigos={codigos} valor={s.codigo_interno} />
            <Campo etiqueta={`Lo pactado (${s.moneda === 'USD' ? 'dólares' : 'soles'})`} htmlFor="corregir-monto" requerido>
              <Entrada
                id="corregir-monto"
                name="monto"
                type="number"
                inputMode="decimal"
                min={0.01}
                step="0.01"
                required
                defaultValue={s.monto}
                className="tabular"
              />
            </Campo>
            <Campo etiqueta="Inicio" htmlFor="corregir-inicio">
              <Entrada id="corregir-inicio" name="fecha_inicio" type="date" defaultValue={s.fecha_inicio ?? ''} />
            </Campo>
            <Campo etiqueta="Término previsto" htmlFor="corregir-fin">
              <Entrada id="corregir-fin" name="fecha_fin" type="date" defaultValue={s.fecha_fin ?? ''} />
            </Campo>
          </div>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Guardar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/** Darlo por terminado (ya no recibe recibos; los que tiene se siguen pagando) o reabrirlo. */
export function CambiarEstado({ id, terminar }: { id: string; terminar: boolean }) {
  const { ejecutar, enviando, error } = useAccion(cambiarEstadoSubcontrato)
  return (
    <div>
      <Boton
        type="button"
        variante="secundario"
        cargando={enviando}
        onClick={() => {
          const datos = new FormData()
          datos.set('id', id)
          datos.set('estado', terminar ? 'TERMINADO' : 'VIGENTE')
          ejecutar(datos)
        }}
        data-cambiar-estado={terminar ? 'terminar' : 'reabrir'}
      >
        {terminar ? <CheckCheck aria-hidden className="size-4" /> : <RotateCcw aria-hidden className="size-4" />}
        {terminar ? 'Dar por terminado' : 'Reabrir'}
      </Boton>
      {error && (
        <p role="alert" className="mt-1 text-xs text-peligro">
          {error}
        </p>
      )}
    </div>
  )
}

/** Anular con su motivo: el subcontrato (sin recibos vigentes) o un recibo (sin pago). */
export function AnularConMotivo({
  tipo,
  id,
  subcontratoId,
  titulo,
  descripcion,
}: {
  tipo: 'subcontrato' | 'recibo'
  id: string
  subcontratoId: string
  titulo: string
  descripcion: string
}) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(tipo === 'subcontrato' ? anularSubcontrato : anularRecibo, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="contornoPeligro" tamano={tipo === 'recibo' ? 'sm' : 'md'} onClick={() => setAbierta(true)} data-anular={tipo}>
        <Ban aria-hidden className="size-4" />
        {tipo === 'subcontrato' ? 'Anular' : 'Anular recibo'}
      </Boton>
      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo={titulo} descripcion={descripcion} ancho="md">
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="subcontrato_id" value={subcontratoId} />
          <Campo etiqueta="Motivo" htmlFor={`anular-${tipo}-${id}`} requerido>
            <AreaTexto id={`anular-${tipo}-${id}`} name="motivo" required minLength={10} maxLength={500} />
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
