'use client'

import { Pencil, UserPlus, UserRoundCheck, UserRoundX } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import type { Trabajador } from '@/lib/datos/rrhh'
import { BANCOS, HORAS_DEL_MES, TIPO_CUENTA, horaCorta } from '@/lib/dominio/rrhh'
import { useEnvio } from '@/lib/envio'
import { sumarDias } from '@/lib/format'

import { cambiarEstadoTrabajador, darDeAltaTrabajador, darDeBajaTrabajador, guardarTrabajador } from './acciones'

type Area = { id: string; codigo: string; nombre: string }

/** El botón «Registrar persona» y su ventana. */
export function NuevoTrabajador({ areas }: { areas: Area[] }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  return (
    <>
      <Boton
        type="button"
        onClick={() => {
          setAviso(null)
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <UserPlus aria-hidden className="size-4" />
        Registrar persona
      </Boton>
      {aviso && (
        <p role="status" className="basis-full text-sm text-exito">
          {aviso}
        </p>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Nueva persona en el personal"
        descripcion="Su ficha, su cuenta para el pago y su horario. Con el horario el portero sabe si llega tarde."
        ancho="lg"
      >
        <FormularioTrabajador
          key={vez}
          areas={areas}
          alTerminar={(mensaje) => {
            setAbierta(false)
            setAviso(mensaje)
          }}
        />
      </Ventana>
    </>
  )
}

/** Lo que se hace sobre una persona ya registrada: corregir la ficha, dar de baja o volver a dar de alta. */
export function ControlesTrabajador({ trabajador, areas, hoy }: { trabajador: Trabajador; areas: Area[]; hoy: string }) {
  const [editando, setEditando] = useState(false)
  const [bajando, setBajando] = useState(false)
  const [volviendo, setVolviendo] = useState(false)
  const [vez, setVez] = useState(0)
  const estado = useEnvio(cambiarEstadoTrabajador, () => setVolviendo(false))
  const alta = useEnvio(darDeAltaTrabajador, () => setVolviendo(false))
  const baja = useEnvio(darDeBajaTrabajador, () => setBajando(false))
  const nombre = `${trabajador.nombres} ${trabajador.apellidos}`
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Boton
        type="button"
        variante="secundario"
        tamano="sm"
        aria-label={`Corregir la ficha de ${nombre}`}
        onClick={() => {
          setVez((v) => v + 1)
          setEditando(true)
        }}
      >
        <Pencil aria-hidden className="size-4" />
        Corregir
      </Boton>
      {trabajador.activo ? (
        <Boton type="button" variante="contornoPeligro" tamano="sm" aria-label={`Dar de baja a ${nombre}`} onClick={() => setBajando(true)}>
          <UserRoundX aria-hidden className="size-4" />
          Dar de baja
        </Boton>
      ) : (
        <Boton type="button" variante="contorno" tamano="sm" aria-label={`Dar de alta a ${nombre}`} onClick={() => setVolviendo(true)}>
          <UserRoundCheck aria-hidden className="size-4" />
          Dar de alta
        </Boton>
      )}
      <Ventana
        abierta={volviendo}
        alCerrar={() => setVolviendo(false)}
        titulo={`Dar de alta a ${nombre}`}
        descripcion="Con el día en que vuelve a trabajar. Lo que trabajó antes queda anotado con su ingreso y su baja."
        ancho="sm"
      >
        <form onSubmit={alta.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={trabajador.id} />
          <Campo etiqueta="Vuelve a trabajar desde" htmlFor={`tr-alta-${trabajador.id}`} requerido>
            <Entrada
              id={`tr-alta-${trabajador.id}`}
              name="fecha_reingreso"
              type="date"
              required
              min={trabajador.fecha_baja ? sumarDias(trabajador.fecha_baja, 1) : undefined}
              defaultValue={hoy}
            />
          </Campo>
          {alta.error && (
            <p role="alert" className="text-sm text-peligro">
              {alta.error}
            </p>
          )}
          <div className="flex justify-end">
            <Boton type="submit" cargando={alta.enviando}>
              Dar de alta
            </Boton>
          </div>
        </form>
        <form onSubmit={estado.alEnviar} className="mt-4 space-y-2 border-t border-borde pt-4">
          <input type="hidden" name="id" value={trabajador.id} />
          <p className="text-xs text-texto-suave">¿La baja fue un error? Quítala y la ficha vuelve como estaba, con su ingreso de antes.</p>
          {estado.error && (
            <p role="alert" className="text-sm text-peligro">
              {estado.error}
            </p>
          )}
          <Boton type="submit" variante="contorno" tamano="sm" cargando={estado.enviando}>
            Quitar la baja
          </Boton>
        </form>
      </Ventana>
      <Ventana
        abierta={bajando}
        alCerrar={() => setBajando(false)}
        titulo={`Dar de baja a ${nombre}`}
        descripcion="Con el último día que trabajó. El portero deja de marcarle y la ficha se queda con su historial."
        ancho="sm"
      >
        <form onSubmit={baja.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={trabajador.id} />
          <Campo etiqueta="Último día que trabajó" htmlFor={`tr-baja-${trabajador.id}`} requerido>
            <Entrada
              id={`tr-baja-${trabajador.id}`}
              name="fecha_baja"
              type="date"
              required
              max={hoy}
              min={trabajador.fecha_ingreso ?? undefined}
              defaultValue={hoy}
            />
          </Campo>
          {baja.error && (
            <p role="alert" className="text-sm text-peligro">
              {baja.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setBajando(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={baja.enviando}>
              Dar de baja
            </Boton>
          </div>
        </form>
      </Ventana>
      <Ventana abierta={editando} alCerrar={() => setEditando(false)} titulo={`Ficha de ${nombre}`} ancho="lg">
        <FormularioTrabajador key={vez} areas={areas} trabajador={trabajador} alTerminar={() => setEditando(false)} />
      </Ventana>
    </div>
  )
}

function FormularioTrabajador({
  areas,
  trabajador,
  alTerminar,
}: {
  areas: Area[]
  trabajador?: Trabajador
  alTerminar: (mensaje: string) => void
}) {
  // Decidido aquí: un reintento manda el mismo id y la base corrige en vez de duplicar.
  const [id] = useState(() => trabajador?.id ?? crypto.randomUUID())
  const { alEnviar, enviando, error } = useEnvio(guardarTrabajador, (r) => alTerminar(r.mensaje ?? 'Ficha guardada.'))
  const t = trabajador
  return (
    <form onSubmit={alEnviar} className="space-y-5">
      <input type="hidden" name="id" value={id} />
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-texto">La persona</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Nombres" htmlFor={`tr-nombres-${id}`} requerido>
            <Entrada id={`tr-nombres-${id}`} name="nombres" required minLength={2} maxLength={80} defaultValue={t?.nombres} autoComplete="off" />
          </Campo>
          <Campo etiqueta="Apellidos" htmlFor={`tr-apellidos-${id}`} requerido>
            <Entrada id={`tr-apellidos-${id}`} name="apellidos" required minLength={2} maxLength={80} defaultValue={t?.apellidos} autoComplete="off" />
          </Campo>
          <Campo etiqueta="DNI" htmlFor={`tr-dni-${id}`} requerido>
            <Entrada id={`tr-dni-${id}`} name="dni" required inputMode="numeric" pattern="[0-9]{8}" maxLength={8} defaultValue={t?.dni} autoComplete="off" className="tabular" />
          </Campo>
          <Campo etiqueta="Cargo" htmlFor={`tr-cargo-${id}`}>
            <Entrada id={`tr-cargo-${id}`} name="cargo" maxLength={80} defaultValue={t?.cargo ?? ''} placeholder="Soldador, pintor, asistente…" />
          </Campo>
          <Campo
            etiqueta="Fecha de ingreso"
            htmlFor={`tr-ingreso-${id}`}
            requerido
            ayuda="El primer día que trabajó. En la oficina, ningún pago puede empezar antes. Si no se sabe, pon la del pago o la planilla más antigua que tengas."
          >
            <Entrada id={`tr-ingreso-${id}`} name="fecha_ingreso" type="date" required defaultValue={t?.fecha_ingreso ?? ''} />
          </Campo>
          <Campo etiqueta="Área" htmlFor={`tr-area-${id}`}>
            <Seleccion id={`tr-area-${id}`} name="area_id" defaultValue={t?.area_id ?? ''}>
              <option value="">Sin área</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-texto">Su horario</legend>
        <p className="text-xs text-texto-suave">Si el portero marca el ingreso después de la hora de entrada, cuenta como tardanza.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Hora de entrada" htmlFor={`tr-entrada-${id}`} requerido>
            <Entrada id={`tr-entrada-${id}`} name="hora_entrada" type="time" required defaultValue={t ? horaCorta(t.hora_entrada) : '08:00'} />
          </Campo>
          <Campo etiqueta="Hora de salida" htmlFor={`tr-salida-${id}`} requerido>
            <Entrada id={`tr-salida-${id}`} name="hora_salida" type="time" required defaultValue={t ? horaCorta(t.hora_salida) : '18:00'} />
          </Campo>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-texto">Dónde se le paga</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Banco" htmlFor={`tr-banco-${id}`} requerido>
            <Entrada
              id={`tr-banco-${id}`}
              name="banco"
              required
              minLength={2}
              maxLength={60}
              list={`tr-bancos-${id}`}
              defaultValue={t?.cuenta?.banco ?? ''}
              autoComplete="off"
            />
            <datalist id={`tr-bancos-${id}`}>
              {BANCOS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Campo>
          <Campo etiqueta="Tipo de cuenta" htmlFor={`tr-tipo-${id}`} requerido>
            <Seleccion id={`tr-tipo-${id}`} name="tipo_cuenta" required defaultValue={t?.cuenta?.tipo_cuenta ?? 'AHORROS'}>
              {Object.entries(TIPO_CUENTA).map(([valor, d]) => (
                <option key={valor} value={valor}>
                  {d.etiqueta}
                </option>
              ))}
            </Seleccion>
          </Campo>
          <Campo etiqueta="Número de cuenta" htmlFor={`tr-cuenta-${id}`} requerido>
            <Entrada id={`tr-cuenta-${id}`} name="numero_cuenta" required inputMode="numeric" pattern="[0-9\-]{6,30}" maxLength={30} defaultValue={t?.cuenta?.numero_cuenta ?? ''} autoComplete="off" className="tabular" />
          </Campo>
          <Campo etiqueta="CCI" htmlFor={`tr-cci-${id}`} ayuda="Los 20 dígitos, si el pago va a otro banco.">
            <Entrada id={`tr-cci-${id}`} name="cci" inputMode="numeric" pattern="[0-9]{20}" maxLength={20} defaultValue={t?.cuenta?.cci ?? ''} autoComplete="off" className="tabular" />
          </Campo>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-texto">Lo que gana y lo que cuesta a la empresa</legend>
        <p className="text-xs text-texto-suave">
          Con la remuneración se le paga en la planilla diaria; con el costo se costean sus horas en cada código interno. En los dos,
          la hora vale el monto mensual entre {HORAS_DEL_MES}.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Remuneración mensual (S/)"
            htmlFor={`tr-remuneracion-${id}`}
            ayuda="Sueldo, asignación y bonos, sin los aportes de la empresa: lo que se le paga."
          >
            <Entrada
              id={`tr-remuneracion-${id}`}
              name="remuneracion_mensual"
              type="number"
              min={0.01}
              max={100000}
              step={0.01}
              inputMode="decimal"
              defaultValue={t?.remuneracion_mensual ?? ''}
              className="tabular"
            />
          </Campo>
          <Campo etiqueta="Costo mensual (S/)" htmlFor={`tr-costo-${id}`} ayuda="Sueldo, asignación y bonos, más los aportes de la empresa.">
            <Entrada
              id={`tr-costo-${id}`}
              name="costo_mensual"
              type="number"
              min={0.01}
              max={100000}
              step={0.01}
              inputMode="decimal"
              defaultValue={t?.costo_mensual ?? ''}
              className="tabular"
            />
          </Campo>
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Boton type="submit" cargando={enviando}>
          {t ? 'Guardar la ficha' : 'Registrar'}
        </Boton>
      </div>
    </form>
  )
}
