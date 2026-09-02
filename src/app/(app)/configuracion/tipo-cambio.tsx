'use client'

import { CircleDollarSign, Download } from 'lucide-react'
import { useActionState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { TipoCambio } from '@/lib/datos/configuracion'
import { fecha as formatearFecha, numero } from '@/lib/format'
import { cn } from '@/lib/utils'

import { registrarTipoCambio, traerTipoCambioDeSunat } from './acciones'

function Aviso({ resultado }: { resultado: { ok?: boolean; error?: string; mensaje?: string } | null }) {
  if (!resultado?.mensaje && resultado?.ok !== false) return null
  const malo = resultado.ok === false
  return (
    <p
      role={malo ? 'alert' : 'status'}
      className={cn(
        'rounded-[var(--radius-base)] px-3 py-2 text-xs',
        malo ? 'bg-peligro-suave text-peligro' : 'bg-exito-suave text-exito',
      )}
    >
      {malo ? resultado.error : resultado.mensaje}
    </p>
  )
}

/**
 * El tipo de cambio del día, y los últimos que se cargaron.
 *
 * La casa cotiza en dólares y costea en soles, y el puente entre las dos cosas
 * es esta tabla. Mientras esté vacía, la base responde 1 a cada pregunta por el
 * tipo de cambio —no porque el dólar valga un sol, sino porque no tiene nada
 * que responder— y cada cotización en dólares se congela con esa cifra.
 *
 * Cada documento guarda el suyo al emitirse, así que cargar el de hoy arregla
 * lo que venga, nunca lo que ya salió.
 */
export function TipoDeCambio({
  hoy,
  cambios,
  puedeEditar,
}: {
  /** La fecha de hoy en el taller, resuelta en el servidor para no discrepar al hidratar. */
  hoy: string
  cambios: TipoCambio[]
  puedeEditar: boolean
}) {
  const [resultado, accion, guardando] = useActionState(registrarTipoCambio, null)
  const [resultadoSunat, accionSunat, trayendo] = useActionState(traerTipoCambioDeSunat, null)

  // La lista viene del más reciente al más antiguo: el primero es justo el que
  // `tipo_cambio_vigente()` está aplicando a todo lo que se emite hoy.
  const vigente = cambios[0] ?? null

  // Se cuenta contra el hoy que resolvió el servidor, no contra el reloj del
  // navegador: si el que mira tiene el reloj corrido, el aviso mentiría.
  const diasDeAtraso = vigente
    ? Math.round(
        (Date.parse(hoy + 'T00:00:00Z') - Date.parse(vigente.fecha + 'T00:00:00Z')) / 86400000,
      )
    : 0

  // Cualquier fecha anterior a hoy ya es atraso: el cron de Vercel escribe el
  // del día a media mañana, así que si el vigente sigue siendo el de ayer es
  // que no llegó. Y cuando no llega no se queja nadie —la ruta contesta 401 en
  // silencio si le falta CRON_SECRET—, así que esta pantalla es el único sitio
  // donde eso se ve. Se compara como texto, que una fecha AAAA-MM-DD ordena
  // sola y pasarla por Date la corre un día.
  const atrasado = vigente !== null && vigente.fecha < hoy

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Tipo de cambio"
        descripcion="Soles por dólar. Con él se pasa a soles lo que se cotiza en dólares: el presupuesto de la orden y los informes."
      />
      <TarjetaCuerpo className="space-y-3">
        {vigente ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[var(--radius-base)] bg-superficie-2 px-3 py-2.5">
              <span className="text-[11px] font-medium tracking-wide text-texto-suave uppercase">
                Vigente
              </span>
              <span className="tabular text-xl leading-tight font-semibold text-acento">
                S/ {numero(vigente.venta, 3)}
              </span>
              <span className="text-xs text-texto-suave">
                venta · compra <span className="tabular">S/ {numero(vigente.compra, 3)}</span> · del{' '}
                {formatearFecha(vigente.fecha)} · {vigente.fuente}
              </span>
            </div>

            {/* El modo silencioso de equivocarse: la base no se queda sin dato,
                se queda con el de la última vez que alguien se acordó, y sigue
                costeando con él sin decir nada. Un dólar de hace tres semanas
                no avisa, solo desvía el presupuesto de a poquito. */}
            {atrasado && (
              <p
                role="status"
                className="rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2 text-xs text-aviso"
              >
                El cambio de hoy no llegó solo: se está costeando con el del{' '}
                {formatearFecha(vigente.fecha)}
                {diasDeAtraso > 1 ? `, de hace ${diasDeAtraso} días` : ''}. Todo lo que se cotice
                hoy en dólares sale con ese número.
                {puedeEditar
                  ? ' Revisa CRON_SECRET en Vercel, o cárgalo acá abajo con el botón.'
                  : ' Avísale a administración para que lo cargue.'}
              </p>
            )}
          </div>
        ) : (
          // No es una lista vacía cualquiera: es la que hace que todo lo
          // cotizado en dólares se costee a un sol por dólar sin avisar.
          <div
            role="alert"
            className="rounded-[var(--radius-base)] border border-peligro bg-peligro-suave px-3 py-2.5 text-sm text-peligro"
          >
            <p className="font-medium">No hay ningún tipo de cambio cargado.</p>
            <p className="mt-1">
              Mientras siga así, la base toma el dólar a S/ 1.00: una cotización de US$ 40,000
              arrastra a la orden un presupuesto de S/ 40,000 en vez de los S/ 146,000 que de
              verdad hay que gastar, y el margen sale bien hasta que se compra el material.
              {puedeEditar
                ? ' Carga acá abajo el de hoy y queda resuelto para lo que se emita en adelante.'
                : ' Lo carga administración desde esta misma pantalla.'}
            </p>
          </div>
        )}

        {puedeEditar && (
          // Traerlo es un formulario aparte del de escribirlo: comparten la
          // tarjeta pero no el estado, así que el aviso de uno no borra el del
          // otro y se ve cuál de los dos contestó.
          <form action={accionSunat} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="fecha" value={hoy} />
            <Boton type="submit" variante="secundario" tamano="sm" cargando={trayendo}>
              <Download aria-hidden className="size-3.5" />
              Traerlo de SUNAT
            </Boton>
            <span className="text-xs text-texto-tenue">
              Se trae solo una vez al día. Si el día ya está cargado, no lo pisa.
            </span>
            <div className="w-full">
              <Aviso resultado={resultadoSunat} />
            </div>
          </form>
        )}

        {puedeEditar && (
          <form action={accion} className="flex flex-wrap items-end gap-2 rounded-[var(--radius-base)] bg-superficie-2 p-3">
            <Campo etiqueta="Fecha" htmlFor="fecha-cambio" requerido className="min-w-36 flex-1 sm:flex-initial">
              {/* El día que rige, no el día que se carga: un cambio atrasado se
                  registra con su propia fecha y la base lo ordena solo. */}
              <Entrada id="fecha-cambio" name="fecha" type="date" defaultValue={hoy} required />
            </Campo>
            {/* `step` de milésima porque así lo publica el banco (3.652), e
                `inputMode="decimal"` para que el teléfono saque el teclado con
                el punto y no el de letras. */}
            <Campo etiqueta="Compra" htmlFor="compra-cambio" requerido className="w-28">
              <Entrada
                id="compra-cambio"
                name="compra"
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                placeholder="3.620"
                autoComplete="off"
                required
              />
            </Campo>
            <Campo
              etiqueta="Venta"
              htmlFor="venta-cambio"
              requerido
              ayuda="La venta es la que congelan los documentos."
              className="w-28"
            >
              <Entrada
                id="venta-cambio"
                name="venta"
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                placeholder="3.650"
                autoComplete="off"
                required
              />
            </Campo>
            <Boton type="submit" tamano="sm" cargando={guardando}>
              <CircleDollarSign aria-hidden className="size-3.5" />
              Guardar el cambio
            </Boton>
            <div className="w-full">
              <Aviso resultado={resultado} />
            </div>
          </form>
        )}

        {cambios.length > 0 && (
          <ul className="divide-y divide-borde">
            {cambios.map((c) => (
              <li key={c.fecha} className="flex flex-wrap items-center gap-x-3 py-1.5 text-sm">
                <span className="tabular w-28 shrink-0 whitespace-nowrap text-texto-suave">
                  {formatearFecha(c.fecha)}
                </span>
                <span className="tabular flex-1 text-texto">
                  compra <span className="font-medium">{numero(c.compra, 3)}</span>
                </span>
                <span className="tabular flex-1 text-texto">
                  venta <span className="font-medium">{numero(c.venta, 3)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Cargar dos veces el mismo día corrige el registro, no lo duplica: la
            fecha es la clave. Se dice acá porque el botón no lo deja ver. */}
        {puedeEditar && cambios.length > 0 && (
          <p className="text-xs text-texto-tenue">
            Si un día quedó mal cargado, vuelve a guardarlo con la misma fecha: se corrige. Los
            documentos ya emitidos conservan el tipo de cambio con el que salieron.
          </p>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
