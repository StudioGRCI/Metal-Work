'use client'

import { Check, Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { ResultadoAccion } from '@/lib/acciones'
import type {
  PiezaCumplimiento,
  PlanoCumplimiento,
  ResumenCumplimiento,
} from '@/lib/datos/cumplimiento'
import { cantidad as fmtCantidad, fecha, hoyLima, numero } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  agregarPiezas,
  agregarPlano,
  editarPieza,
  editarPlano,
  entregarPlano,
  quitarPieza,
  quitarPlano,
  reportarMaestranza,
  reportarProduccion,
} from './acciones-cumplimiento'

type Accion = (previo: unknown, datos: FormData) => Promise<ResultadoAccion>

/**
 * Manejador propio en lugar de useActionState: el formulario se cierra solo
 * cuando el guardado fue correcto, y el error se queda a la vista si no.
 */
function useEnvio(accion: Accion, alTerminar?: () => void) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function enviar(datos: FormData) {
    if (enviando) return
    setError(null)
    setEnviando(true)
    const resultado = await accion(null, datos)
    setEnviando(false)

    if (resultado.ok) {
      alTerminar?.()
      iniciarTransicion(() => router.refresh())
      return
    }
    setError(resultado.error)
  }

  return { enviar, enviando, error }
}

function Error_({ texto }: { texto: string | null }) {
  if (!texto) return null
  return (
    <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
      {texto}
    </p>
  )
}

/** Un visto de la hoja: ✓ verde o un guion tenue. Con nombre para el lector de pantalla. */
function Visto({ si, etiqueta }: { si: boolean | null | undefined; etiqueta: string }) {
  return si ? (
    <Check role="img" aria-label={etiqueta} className="mx-auto size-4 text-exito" />
  ) : (
    <Minus role="img" aria-label={`Sin ${etiqueta.toLowerCase()}`} className="mx-auto size-4 text-texto-tenue" />
  )
}

function Fecha({ valor }: { valor: string | null | undefined }) {
  return <span className={cn('tabular whitespace-nowrap', !valor && 'text-texto-tenue')}>{valor ? fecha(valor) : '—'}</span>
}

/**
 * La hoja MW-FOR-ING-8 «Cumplimiento de tiempos – áreas» de una orden.
 *
 * Diseño arma la lista —un plano por grupo de piezas, con su peso—; Maestranza
 * y Producción marcan fechas y vistos pieza por pieza; el porcentaje lo calcula
 * la base y acá solo se pinta. Cada mano ve únicamente los botones de lo que
 * puede escribir, porque la base va a exigirle exactamente ese permiso.
 */
export function Cumplimiento({
  ordenId,
  resumen,
  planos,
  puedeDisenar,
  puedeReportar,
  ordenViva,
}: {
  ordenId: string
  resumen: ResumenCumplimiento | null
  planos: PlanoCumplimiento[]
  /** `diseno.planos`: arma planos y piezas, y entrega el plano. */
  puedeDisenar: boolean
  /** `produccion.registrar`: Maestranza y Producción marcan lo suyo. */
  puedeReportar: boolean
  /** La orden acepta planos: aprobada y no entregada ni anulada. */
  ordenViva: boolean
}) {
  const pesoTotal = Number(resumen?.peso_total ?? 0)
  const faltaPeso = Math.round((100 - pesoTotal) * 100) / 100

  return (
    <div className="space-y-4">
      <Tarjeta>
        <TarjetaCabecera
          titulo="Cumplimiento de tiempos por área"
          descripcion="Diseño reparte los planos con su peso; Maestranza reporta el habilitado y Producción el armado. El porcentaje sale de los vistos, no se escribe."
        />
        <TarjetaCuerpo>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Cifra titulo="Avance de la unidad">
              <Progreso valor={resumen?.avance_pct} mostrarValor />
              <span className="text-[11px] text-texto-suave">Ponderado por el peso de cada plano</span>
            </Cifra>
            <Cifra titulo="Planos entregados">
              <span className="tabular text-lg font-semibold text-texto">
                {resumen?.planos_entregados ?? 0}
                <span className="text-sm font-normal text-texto-suave"> / {resumen?.planos ?? 0}</span>
              </span>
              <span className="text-[11px] text-texto-suave">
                {resumen?.ultimo_plano ? `Último el ${fecha(resumen.ultimo_plano)}` : 'Diseño todavía no entregó ninguno'}
              </span>
            </Cifra>
            <Cifra titulo="Piezas armadas">
              <span className="tabular text-lg font-semibold text-texto">
                {resumen?.piezas_armadas ?? 0}
                <span className="text-sm font-normal text-texto-suave"> / {resumen?.piezas ?? 0}</span>
              </span>
              <span className="text-[11px] text-texto-suave">
                {resumen?.piezas_entregadas ?? 0} entregadas por Maestranza
              </span>
            </Cifra>
            <Cifra titulo="Peso repartido">
              <span className={cn('tabular text-lg font-semibold', pesoTotal === 100 ? 'text-texto' : 'text-aviso')}>
                {numero(pesoTotal, 0)}%
              </span>
              <span className="text-[11px] text-texto-suave">
                {pesoTotal === 100
                  ? 'Los planos suman 100'
                  : pesoTotal > 100
                    ? 'Los planos pasan de 100'
                    : planos.length === 0
                      ? 'Sin planos todavía'
                      : `Faltan ${numero(faltaPeso, 0)} puntos por repartir`}
              </span>
            </Cifra>
          </div>
        </TarjetaCuerpo>
      </Tarjeta>

      {!ordenViva && (
        <p className="rounded-[var(--radius-base)] bg-superficie-2 px-3 py-2 text-xs text-texto-suave">
          La orden no está en curso: la hoja se consulta pero ya no se reparten planos.
        </p>
      )}

      {puedeDisenar && ordenViva && <NuevoPlano ordenId={ordenId} pesoLibre={Math.max(0, faltaPeso)} />}

      {planos.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <div className="py-8 text-center">
              <p className="text-sm font-medium text-texto">Esta orden todavía no tiene planos</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-texto-suave">
                Diseño arma la lista como en su hoja: un plano por grupo de piezas, con el peso que
                tiene en la unidad. Recién entonces Maestranza y Producción pueden reportar.
              </p>
            </div>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        planos.map((plano) => (
          <TarjetaPlano
            key={plano.plano_id}
            ordenId={ordenId}
            plano={plano}
            puedeDisenar={puedeDisenar && ordenViva}
            puedeReportar={puedeReportar}
          />
        ))
      )}

      <p className="text-[11px] text-texto-suave">
        Cómo avanza una pieza: habilitada 25 % · entregada por Maestranza 50 % · recibida por
        Producción 75 % · armada 100 %. Un ensamble: empezado 50 % · armado 100 %.
      </p>
    </div>
  )
}

function Cifra({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold tracking-wide text-texto-suave uppercase">{titulo}</span>
      {children}
    </div>
  )
}

// ================================================================= los planos
function NuevoPlano({ ordenId, pesoLibre }: { ordenId: string; pesoLibre: number }) {
  const [abierto, setAbierto] = useState(false)
  const { enviar, enviando, error } = useEnvio(agregarPlano, () => setAbierto(false))

  if (!abierto) {
    return (
      <div className="flex justify-end">
        <Boton variante="secundario" tamano="sm" onClick={() => setAbierto(true)}>
          <Plus aria-hidden className="size-4" />
          Nuevo plano
        </Boton>
      </div>
    )
  }

  return (
    <Tarjeta className="border-acento">
      <TarjetaCabecera
        titulo="Nuevo plano"
        descripcion="Como la fila de cabecera de su hoja: el número del plano, qué agrupa y cuánto pesa."
      />
      <TarjetaCuerpo>
        <form action={enviar} className="grid gap-3 sm:grid-cols-6">
          <input type="hidden" name="orden_id" value={ordenId} />
          <Campo etiqueta="N.º plano" htmlFor="np-numero">
            <Entrada id="np-numero" name="numero_plano" required autoFocus placeholder="1" />
          </Campo>
          <Campo etiqueta="Nombre" htmlFor="np-nombre" className="sm:col-span-2">
            <Entrada id="np-nombre" name="nombre" required placeholder="HABILITADO · ESTRUCTURA CAJÓN" />
          </Campo>
          <Campo etiqueta="Peso %" htmlFor="np-peso" ayuda={`Quedan ${numero(pesoLibre, 0)} por repartir`}>
            <Entrada
              id="np-peso"
              name="peso_pct"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.5"
              defaultValue={pesoLibre > 0 ? Math.min(pesoLibre, 100) : 0}
              className="tabular"
            />
          </Campo>
          <Campo etiqueta="Entregado el" htmlFor="np-fecha" ayuda="Vacío si todavía no se entrega">
            <Entrada id="np-fecha" name="fecha_entrega" type="date" />
          </Campo>
          <Campo etiqueta="Observación" htmlFor="np-obs" className="sm:col-span-6">
            <Entrada id="np-obs" name="observacion" placeholder="Opcional" />
          </Campo>
          {error && (
            <div className="sm:col-span-6">
              <Error_ texto={error} />
            </div>
          )}
          <div className="flex justify-end gap-2 sm:col-span-6">
            <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="sm" cargando={enviando}>
              Agregar el plano
            </Boton>
          </div>
        </form>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function TarjetaPlano({
  ordenId,
  plano,
  puedeDisenar,
  puedeReportar,
}: {
  ordenId: string
  plano: PlanoCumplimiento
  puedeDisenar: boolean
  puedeReportar: boolean
}) {
  const [modo, setModo] = useState<'ver' | 'editar' | 'entregar' | 'quitar' | 'piezas'>('ver')
  const entregado = Boolean(plano.fecha_entrega)
  const planoId = plano.plano_id ?? ''

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-superficie-2 px-1.5 text-xs font-semibold text-texto-suave">
              Plano {plano.numero_plano}
            </span>
            {plano.nombre}
            <Insignia tono="neutro">{numero(plano.peso_pct, 0)} %</Insignia>
            {entregado ? (
              <span className="text-xs text-exito">Entregado el {fecha(plano.fecha_entrega)}</span>
            ) : (
              <span className="text-xs text-aviso">Diseño no lo ha entregado</span>
            )}
          </span>
        }
        descripcion={
          <span className="flex flex-wrap items-center gap-x-3">
            <span>
              {plano.piezas ?? 0} pieza{plano.piezas === 1 ? '' : 's'} · {plano.piezas_entregadas ?? 0} entregadas ·{' '}
              {plano.piezas_armadas ?? 0} armadas
            </span>
            {plano.observacion && <span className="text-texto-suave">{plano.observacion}</span>}
          </span>
        }
        acciones={
          <div className="flex items-center gap-2">
            <div className="w-32">
              <Progreso valor={plano.avance_pct} mostrarValor alto="sm" />
            </div>
            {puedeDisenar && (
              <>
                {!entregado && (
                  <Boton variante="secundario" tamano="sm" onClick={() => setModo(modo === 'entregar' ? 'ver' : 'entregar')}>
                    Entregar
                  </Boton>
                )}
                <Boton
                  variante="fantasma"
                  tamano="icono"
                  aria-label="Editar el plano"
                  onClick={() => setModo(modo === 'editar' ? 'ver' : 'editar')}
                >
                  <Pencil aria-hidden className="size-4" />
                </Boton>
                <Boton
                  variante="fantasma"
                  tamano="icono"
                  aria-label="Quitar el plano"
                  onClick={() => setModo(modo === 'quitar' ? 'ver' : 'quitar')}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Boton>
              </>
            )}
          </div>
        }
      />

      {modo === 'entregar' && (
        <FormularioEntrega ordenId={ordenId} planoId={planoId} alTerminar={() => setModo('ver')} />
      )}
      {modo === 'editar' && (
        <FormularioPlano ordenId={ordenId} plano={plano} alTerminar={() => setModo('ver')} />
      )}
      {modo === 'quitar' && (
        <ConfirmarQuitar
          accion={quitarPlano}
          id={planoId}
          ordenId={ordenId}
          texto={`¿Quitar el plano ${plano.numero_plano} con sus ${plano.piezas ?? 0} piezas? Si el taller ya reportó algo, la base no lo dejará.`}
          alTerminar={() => setModo('ver')}
        />
      )}

      <TarjetaCuerpo className="p-0">
        <TablaPiezas
          ordenId={ordenId}
          piezas={plano.lista}
          planoEntregado={entregado}
          puedeDisenar={puedeDisenar}
          puedeReportar={puedeReportar}
        />
        {puedeDisenar && (
          <div className="border-t border-borde p-3">
            {modo === 'piezas' ? (
              <FormularioPiezas ordenId={ordenId} planoId={planoId} alTerminar={() => setModo('ver')} />
            ) : (
              <button
                type="button"
                onClick={() => setModo('piezas')}
                className="inline-flex items-center gap-1 text-xs text-acento hover:underline"
              >
                <Plus aria-hidden className="size-3.5" />
                Agregar piezas a este plano
              </button>
            )}
          </div>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function FormularioEntrega({
  ordenId,
  planoId,
  alTerminar,
}: {
  ordenId: string
  planoId: string
  alTerminar: () => void
}) {
  const { enviar, enviando, error } = useEnvio(entregarPlano, alTerminar)

  return (
    <form action={enviar} className="flex flex-wrap items-end gap-3 border-t border-borde bg-superficie-2 px-4 py-3">
      <input type="hidden" name="orden_id" value={ordenId} />
      <input type="hidden" name="plano_id" value={planoId} />
      <Campo etiqueta="Entregado el" htmlFor={`entrega-${planoId}`} ayuda="Desde ese día Maestranza puede empezar a habilitar">
        <Entrada id={`entrega-${planoId}`} name="fecha_entrega" type="date" required defaultValue={hoyLima()} />
      </Campo>
      <Boton type="submit" tamano="sm" cargando={enviando}>
        Dar por entregado
      </Boton>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={alTerminar}>
        Cancelar
      </Boton>
      {error && (
        <div className="basis-full">
          <Error_ texto={error} />
        </div>
      )}
    </form>
  )
}

function FormularioPlano({
  ordenId,
  plano,
  alTerminar,
}: {
  ordenId: string
  plano: PlanoCumplimiento
  alTerminar: () => void
}) {
  const { enviar, enviando, error } = useEnvio(editarPlano, alTerminar)
  const id = plano.plano_id ?? ''

  return (
    <form action={enviar} className="grid gap-3 border-t border-borde bg-superficie-2 px-4 py-3 sm:grid-cols-6">
      <input type="hidden" name="orden_id" value={ordenId} />
      <input type="hidden" name="plano_id" value={id} />
      <Campo etiqueta="N.º plano" htmlFor={`ep-numero-${id}`}>
        <Entrada id={`ep-numero-${id}`} name="numero_plano" required defaultValue={plano.numero_plano ?? ''} />
      </Campo>
      <Campo etiqueta="Nombre" htmlFor={`ep-nombre-${id}`} className="sm:col-span-2">
        <Entrada id={`ep-nombre-${id}`} name="nombre" required defaultValue={plano.nombre ?? ''} />
      </Campo>
      <Campo etiqueta="Peso %" htmlFor={`ep-peso-${id}`}>
        <Entrada
          id={`ep-peso-${id}`}
          name="peso_pct"
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step="0.5"
          defaultValue={Number(plano.peso_pct ?? 0)}
          className="tabular"
        />
      </Campo>
      <Campo etiqueta="Entregado el" htmlFor={`ep-fecha-${id}`}>
        <Entrada id={`ep-fecha-${id}`} name="fecha_entrega" type="date" defaultValue={plano.fecha_entrega ?? ''} />
      </Campo>
      <Campo etiqueta="Observación" htmlFor={`ep-obs-${id}`} className="sm:col-span-6">
        <Entrada id={`ep-obs-${id}`} name="observacion" defaultValue={plano.observacion ?? ''} />
      </Campo>
      {error && (
        <div className="sm:col-span-6">
          <Error_ texto={error} />
        </div>
      )}
      <div className="flex justify-end gap-2 sm:col-span-6">
        <Boton type="button" variante="fantasma" tamano="sm" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" tamano="sm" cargando={enviando}>
          Guardar el plano
        </Boton>
      </div>
    </form>
  )
}

function ConfirmarQuitar({
  accion,
  id,
  ordenId,
  texto,
  alTerminar,
}: {
  accion: Accion
  id: string
  ordenId: string
  texto: string
  alTerminar: () => void
}) {
  const { enviar, enviando, error } = useEnvio(accion, alTerminar)

  return (
    <form action={enviar} className="flex flex-wrap items-center gap-3 border-t border-borde bg-peligro-suave px-4 py-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="orden_id" value={ordenId} />
      <p className="flex-1 text-xs text-peligro">{texto}</p>
      <Boton type="submit" variante="peligro" tamano="sm" cargando={enviando}>
        Sí, quitar
      </Boton>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={alTerminar}>
        No
      </Boton>
      {error && (
        <div className="basis-full">
          <Error_ texto={error} />
        </div>
      )}
    </form>
  )
}

function FormularioPiezas({
  ordenId,
  planoId,
  alTerminar,
}: {
  ordenId: string
  planoId: string
  alTerminar: () => void
}) {
  const { enviar, enviando, error } = useEnvio(agregarPiezas, alTerminar)

  return (
    <form action={enviar} className="space-y-2">
      <input type="hidden" name="orden_id" value={ordenId} />
      <input type="hidden" name="plano_id" value={planoId} />
      <Campo
        etiqueta="Piezas, una por línea"
        htmlFor={`piezas-${planoId}`}
        ayuda="número | nombre | cantidad — como en la hoja. «ENS» como número marca un ensamble."
      >
        <AreaTexto
          id={`piezas-${planoId}`}
          name="lista"
          rows={5}
          required
          autoFocus
          placeholder={'1 | Durmiente lateral | 2\n2-5 | Postes | 4\nENS | Ensamble de estructura | 1'}
          className="font-mono text-xs"
        />
      </Campo>
      <Error_ texto={error} />
      <div className="flex justify-end gap-2">
        <Boton type="button" variante="fantasma" tamano="sm" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" tamano="sm" cargando={enviando}>
          Agregar las piezas
        </Boton>
      </div>
    </form>
  )
}

// ================================================================= las piezas
const COLUMNAS = 13

function TablaPiezas({
  ordenId,
  piezas,
  planoEntregado,
  puedeDisenar,
  puedeReportar,
}: {
  ordenId: string
  piezas: PiezaCumplimiento[]
  planoEntregado: boolean
  puedeDisenar: boolean
  puedeReportar: boolean
}) {
  const [abierta, setAbierta] = useState<{ id: string; bloque: 'mtz' | 'prd' | 'editar' | 'quitar' } | null>(null)

  return (
    <Tabla className="text-xs">
      <TablaCabecera>
        <tr className="border-b border-borde">
          <th colSpan={3} className="px-3 py-1 text-left text-[10px] font-semibold tracking-wide text-texto-suave uppercase">
            Diseño
          </th>
          <th colSpan={4} className="border-l border-borde px-3 py-1 text-center text-[10px] font-semibold tracking-wide text-texto-suave uppercase">
            Maestranza
          </th>
          <th colSpan={4} className="border-l border-borde px-3 py-1 text-center text-[10px] font-semibold tracking-wide text-texto-suave uppercase">
            Producción
          </th>
          <th colSpan={2} className="border-l border-borde" />
        </tr>
        <tr>
          <TH className="w-14">#</TH>
          <TH>Pieza</TH>
          <TH className="text-right">Cant.</TH>
          <TH className="border-l border-borde">Inicio</TH>
          <TH className="text-center">Habilit.</TH>
          <TH>Culminó</TH>
          <TH className="text-center">Entreg.</TH>
          <TH className="border-l border-borde">Recepción</TH>
          <TH className="text-center">Recib.</TH>
          <TH>Inicio</TH>
          <TH className="text-center">Armado</TH>
          <TH className="border-l border-borde text-right">%</TH>
          <TH />
        </tr>
      </TablaCabecera>
      <tbody>
        {piezas.length === 0 ? (
          <tr>
            <td colSpan={COLUMNAS} className="px-3 py-6 text-center text-xs text-texto-suave">
              Este plano todavía no tiene piezas.
            </td>
          </tr>
        ) : (
          piezas.map((pieza) => {
            const id = pieza.id ?? ''
            const abiertaAqui = abierta?.id === id ? abierta.bloque : null
            const cerrar = () => setAbierta(null)
            const alternar = (bloque: 'mtz' | 'prd' | 'editar' | 'quitar') =>
              setAbierta(abiertaAqui === bloque ? null : { id, bloque })

            return (
              <FilaPieza
                key={id}
                ordenId={ordenId}
                pieza={pieza}
                abierta={abiertaAqui}
                alternar={alternar}
                cerrar={cerrar}
                planoEntregado={planoEntregado}
                puedeDisenar={puedeDisenar}
                puedeReportar={puedeReportar}
              />
            )
          })
        )}
      </tbody>
    </Tabla>
  )
}

function FilaPieza({
  ordenId,
  pieza,
  abierta,
  alternar,
  cerrar,
  planoEntregado,
  puedeDisenar,
  puedeReportar,
}: {
  ordenId: string
  pieza: PiezaCumplimiento
  abierta: 'mtz' | 'prd' | 'editar' | 'quitar' | null
  alternar: (bloque: 'mtz' | 'prd' | 'editar' | 'quitar') => void
  cerrar: () => void
  planoEntregado: boolean
  puedeDisenar: boolean
  puedeReportar: boolean
}) {
  const id = pieza.id ?? ''
  const ensamble = Boolean(pieza.es_ensamble)
  const enlace = 'text-[11px] text-acento hover:underline disabled:cursor-not-allowed disabled:text-texto-tenue disabled:no-underline'

  return (
    <>
      <TR className={cn(abierta && 'bg-superficie-2')}>
        <TD className="tabular text-texto-suave">{pieza.numero_pieza}</TD>
        <TD>
          <span className="font-medium">{pieza.nombre}</span>
          {ensamble && <Insignia tono="info" className="ml-1.5">Ensamble</Insignia>}
          {pieza.observacion && <span className="block text-[11px] text-texto-suave">{pieza.observacion}</span>}
        </TD>
        <TD className="tabular text-right">{fmtCantidad(pieza.cantidad)}</TD>

        {ensamble ? (
          <TD colSpan={4} className="border-l border-borde text-center text-[11px] text-texto-tenue">
            no pasa por Maestranza
          </TD>
        ) : (
          <>
            <TD className="border-l border-borde"><Fecha valor={pieza.mtz_inicio} /></TD>
            <TD><Visto si={pieza.mtz_habilitado} etiqueta="Habilitado" /></TD>
            <TD><Fecha valor={pieza.mtz_culminacion} /></TD>
            <TD><Visto si={pieza.mtz_entregado} etiqueta="Entregado" /></TD>
          </>
        )}

        {ensamble ? (
          <>
            <TD colSpan={2} className="border-l border-borde text-center text-[11px] text-texto-tenue">—</TD>
            <TD><Fecha valor={pieza.prd_inicio} /></TD>
            <TD><Visto si={pieza.prd_armado} etiqueta="Armado" /></TD>
          </>
        ) : (
          <>
            <TD className="border-l border-borde"><Fecha valor={pieza.prd_recepcion} /></TD>
            <TD><Visto si={pieza.prd_recibido} etiqueta="Recibido" /></TD>
            <TD><Fecha valor={pieza.prd_inicio} /></TD>
            <TD><Visto si={pieza.prd_armado} etiqueta="Armado" /></TD>
          </>
        )}

        <TD className="tabular border-l border-borde text-right font-medium">{numero(pieza.avance_pct, 0)}</TD>
        <TD className="whitespace-nowrap">
          <div className="flex items-center justify-end gap-2">
            {puedeReportar && !ensamble && (
              <button
                type="button"
                className={enlace}
                disabled={!planoEntregado}
                title={planoEntregado ? undefined : 'Diseño todavía no entregó el plano'}
                onClick={() => alternar('mtz')}
              >
                Maestranza
              </button>
            )}
            {puedeReportar && (
              <button type="button" className={enlace} onClick={() => alternar('prd')}>
                Producción
              </button>
            )}
            {puedeDisenar && (
              <>
                <button type="button" aria-label="Editar la pieza" className={enlace} onClick={() => alternar('editar')}>
                  <Pencil aria-hidden className="size-3.5" />
                </button>
                <button type="button" aria-label="Quitar la pieza" className={enlace} onClick={() => alternar('quitar')}>
                  <Trash2 aria-hidden className="size-3.5" />
                </button>
              </>
            )}
          </div>
        </TD>
      </TR>

      {abierta && (
        <tr className="border-b border-borde bg-superficie-2">
          <td colSpan={COLUMNAS} className="px-3 py-3">
            {abierta === 'mtz' && <FormularioMaestranza ordenId={ordenId} pieza={pieza} alTerminar={cerrar} />}
            {abierta === 'prd' && <FormularioProduccion ordenId={ordenId} pieza={pieza} alTerminar={cerrar} />}
            {abierta === 'editar' && <FormularioPieza ordenId={ordenId} pieza={pieza} alTerminar={cerrar} />}
            {abierta === 'quitar' && (
              <ConfirmarQuitar
                accion={quitarPieza}
                id={id}
                ordenId={ordenId}
                texto={`¿Quitar la pieza «${pieza.nombre}»? Se pierde lo que el taller haya reportado de ella.`}
                alTerminar={cerrar}
              />
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function Marca({ id, name, etiqueta, defaultChecked }: { id: string; name: string; etiqueta: string; defaultChecked: boolean }) {
  return (
    <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm text-texto sm:min-h-0">
      <input id={id} name={name} type="checkbox" defaultChecked={defaultChecked} className="size-4 accent-[var(--acento)]" />
      {etiqueta}
    </label>
  )
}

function FormularioMaestranza({
  ordenId,
  pieza,
  alTerminar,
}: {
  ordenId: string
  pieza: PiezaCumplimiento
  alTerminar: () => void
}) {
  const { enviar, enviando, error } = useEnvio(reportarMaestranza, alTerminar)
  const id = pieza.id ?? ''

  return (
    <form action={enviar} className="grid gap-3 sm:grid-cols-5">
      <input type="hidden" name="orden_id" value={ordenId} />
      <input type="hidden" name="pieza_id" value={id} />
      <p className="text-xs font-semibold text-texto sm:col-span-5">Maestranza reporta «{pieza.nombre}»</p>
      <Campo etiqueta="Inicio del habilitado" htmlFor={`mi-${id}`}>
        <Entrada id={`mi-${id}`} name="mtz_inicio" type="date" defaultValue={pieza.mtz_inicio ?? ''} />
      </Campo>
      <Marca id={`mh-${id}`} name="mtz_habilitado" etiqueta="Habilitado" defaultChecked={Boolean(pieza.mtz_habilitado)} />
      <Campo etiqueta="Culminación" htmlFor={`mc-${id}`}>
        <Entrada id={`mc-${id}`} name="mtz_culminacion" type="date" defaultValue={pieza.mtz_culminacion ?? ''} />
      </Campo>
      <Marca id={`me-${id}`} name="mtz_entregado" etiqueta="Entregado a Producción" defaultChecked={Boolean(pieza.mtz_entregado)} />
      <Campo etiqueta="Observación" htmlFor={`mo-${id}`}>
        <Entrada id={`mo-${id}`} name="mtz_observacion" defaultValue={pieza.mtz_observacion ?? ''} placeholder="Qué la trabó" />
      </Campo>
      {error && (
        <div className="sm:col-span-5">
          <Error_ texto={error} />
        </div>
      )}
      <div className="flex justify-end gap-2 sm:col-span-5">
        <Boton type="button" variante="fantasma" tamano="sm" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" tamano="sm" cargando={enviando}>
          Guardar el reporte
        </Boton>
      </div>
    </form>
  )
}

function FormularioProduccion({
  ordenId,
  pieza,
  alTerminar,
}: {
  ordenId: string
  pieza: PiezaCumplimiento
  alTerminar: () => void
}) {
  const { enviar, enviando, error } = useEnvio(reportarProduccion, alTerminar)
  const id = pieza.id ?? ''
  const ensamble = Boolean(pieza.es_ensamble)

  return (
    <form action={enviar} className="grid gap-3 sm:grid-cols-5">
      <input type="hidden" name="orden_id" value={ordenId} />
      <input type="hidden" name="pieza_id" value={id} />
      <p className="text-xs font-semibold text-texto sm:col-span-5">Producción reporta «{pieza.nombre}»</p>
      {!ensamble && (
        <>
          <Campo etiqueta="Recepción" htmlFor={`pr-${id}`}>
            <Entrada id={`pr-${id}`} name="prd_recepcion" type="date" defaultValue={pieza.prd_recepcion ?? ''} />
          </Campo>
          <Marca id={`pc-${id}`} name="prd_recibido" etiqueta="Recibido" defaultChecked={Boolean(pieza.prd_recibido)} />
        </>
      )}
      <Campo etiqueta={ensamble ? 'Inicio del ensamble' : 'Inicio del armado'} htmlFor={`pi-${id}`}>
        <Entrada id={`pi-${id}`} name="prd_inicio" type="date" defaultValue={pieza.prd_inicio ?? ''} />
      </Campo>
      <Marca id={`pa-${id}`} name="prd_armado" etiqueta="Armado" defaultChecked={Boolean(pieza.prd_armado)} />
      <Campo etiqueta="Observación" htmlFor={`po-${id}`}>
        <Entrada id={`po-${id}`} name="prd_observacion" defaultValue={pieza.prd_observacion ?? ''} placeholder="Qué la trabó" />
      </Campo>
      {error && (
        <div className="sm:col-span-5">
          <Error_ texto={error} />
        </div>
      )}
      <div className="flex justify-end gap-2 sm:col-span-5">
        <Boton type="button" variante="fantasma" tamano="sm" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" tamano="sm" cargando={enviando}>
          Guardar el reporte
        </Boton>
      </div>
    </form>
  )
}

function FormularioPieza({
  ordenId,
  pieza,
  alTerminar,
}: {
  ordenId: string
  pieza: PiezaCumplimiento
  alTerminar: () => void
}) {
  const { enviar, enviando, error } = useEnvio(editarPieza, alTerminar)
  const id = pieza.id ?? ''

  return (
    <form action={enviar} className="grid gap-3 sm:grid-cols-5">
      <input type="hidden" name="orden_id" value={ordenId} />
      <input type="hidden" name="pieza_id" value={id} />
      <Campo etiqueta="N.º" htmlFor={`en-${id}`}>
        <Entrada id={`en-${id}`} name="numero_pieza" required defaultValue={pieza.numero_pieza ?? ''} />
      </Campo>
      <Campo etiqueta="Nombre" htmlFor={`enm-${id}`} className="sm:col-span-2">
        <Entrada id={`enm-${id}`} name="nombre" required defaultValue={pieza.nombre ?? ''} />
      </Campo>
      <Campo etiqueta="Cantidad" htmlFor={`ec-${id}`}>
        <Entrada id={`ec-${id}`} name="cantidad" type="number" inputMode="decimal" min={0.01} step="any" defaultValue={Number(pieza.cantidad ?? 1)} className="tabular" />
      </Campo>
      <Marca id={`ee-${id}`} name="es_ensamble" etiqueta="Es un ensamble" defaultChecked={Boolean(pieza.es_ensamble)} />
      <Campo etiqueta="Observación" htmlFor={`eo-${id}`} className="sm:col-span-5">
        <Entrada id={`eo-${id}`} name="observacion" defaultValue={pieza.observacion ?? ''} />
      </Campo>
      {error && (
        <div className="sm:col-span-5">
          <Error_ texto={error} />
        </div>
      )}
      <div className="flex justify-end gap-2 sm:col-span-5">
        <Boton type="button" variante="fantasma" tamano="sm" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" tamano="sm" cargando={enviando}>
          Guardar la pieza
        </Boton>
      </div>
    </form>
  )
}
