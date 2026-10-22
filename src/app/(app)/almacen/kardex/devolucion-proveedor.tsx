'use client'

import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import type { DevolucionPorReponer, IngresoParaDevolver } from '@/lib/datos/kardex'
import { useEnvio } from '@/lib/envio'
import { redondearCantidad } from '@/lib/dominio/almacen'
import { cantidad, fechaHora } from '@/lib/format'

import { dejarDeEsperarReposicion, devolverAlProveedor, recibirReposicion } from './acciones'

/**
 * Lo que llegó malo de una compra vuelve al proveedor (decisión de DKS del
 * 22/10, migración 20261022185000). Sale del kardex como un egreso; si el
 * proveedor lo repone, la OC lo vuelve a esperar, y si no, lo que falte vuelve
 * a la lista de Logística y Contabilidad espera la nota de crédito.
 */
export function DevolverAlProveedor({ ingresos }: { ingresos: IngresoParaDevolver[] }) {
  const [abierta, setAbierta] = useState(false)
  const [id, setId] = useState(() => crypto.randomUUID())
  const [elegido, setElegido] = useState('')
  const [repone, setRepone] = useState('')
  const envio = useEnvio(devolverAlProveedor, () => {
    setId(crypto.randomUUID())
    setElegido('')
    setRepone('')
    setAbierta(false)
  })
  const ingreso = ingresos.find((i) => i.ingreso_id === elegido)
  return (
    <>
      <Boton variante="secundario" onClick={() => setAbierta(true)}>
        Devolver al proveedor
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Devolver al proveedor"
        descripcion="Lo que llegó malo de una compra sale del kardex. No vuelve atrás."
        ancho="lg"
      >
        {ingresos.length === 0 ? (
          <p className="text-sm text-texto-suave">
            No hay ingresos de compra con material en el almacén. Lo que ya salió al taller vuelve primero como devolución del taller.
          </p>
        ) : (
          <form key={id} onSubmit={envio.alEnviar} className="space-y-4">
            <input type="hidden" name="id" value={id} />
            <Campo etiqueta="Qué llegó de la compra" htmlFor="dev-ingreso" requerido>
              <Seleccion id="dev-ingreso" name="ingreso" required value={elegido} onChange={(e) => setElegido(e.target.value)}>
                <option value="">Elige el ingreso</option>
                {ingresos.map((i) => (
                  <option key={i.ingreso_id} value={i.ingreso_id ?? ''}>
                    {`${i.compra} · ${i.material} · ${cantidad(i.se_puede)} ${i.unidad ?? ''} · ${i.documento ?? ''} · ${fechaHora(i.fecha)}`}
                  </option>
                ))}
              </Seleccion>
            </Campo>
            {ingreso && (
              <p className="-mt-2 text-xs text-texto-suave">
                Proveedor: {ingreso.proveedor} · entraron {cantidad(ingreso.ingresado)} {ingreso.unidad ?? ''} con {ingreso.documento} · se
                pueden devolver {cantidad(ingreso.se_puede)} {ingreso.unidad ?? ''}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta={`Cantidad${ingreso?.unidad ? ` (${ingreso.unidad})` : ''}`} htmlFor="dev-cantidad" requerido>
                <Entrada id="dev-cantidad" name="cantidad" type="number" step="0.001" min="0.001" max={ingreso?.se_puede ?? undefined}
                  required inputMode="decimal" className="tabular" />
              </Campo>
              <Campo etiqueta="Guía o documento con que sale" htmlFor="dev-documento" requerido>
                <Entrada id="dev-documento" name="documento" required minLength={2} maxLength={100} />
              </Campo>
            </div>
            <Campo etiqueta="Por qué se devuelve" htmlFor="dev-motivo" requerido ayuda="Le llega a Logística con la devolución.">
              <AreaTexto id="dev-motivo" name="motivo" required minLength={10} maxLength={500} rows={2}
                placeholder="Llegaron con el disco partido" />
            </Campo>
            <Campo
              etiqueta="¿El proveedor lo repone?"
              htmlFor="dev-repone"
              requerido
              ayudaEnIcono={false}
              ayuda={repone === 'no'
                ? 'Lo que falte vuelve a la lista de Logística para comprarlo en otra OC, y Contabilidad espera la nota de crédito.'
                : repone === 'si' ? 'La OC lo vuelve a esperar. Si después no lo repone, dilo en «Esperan reposición».'
                : 'Si no lo repone, lo que falte vuelve a Logística para otra OC. No vuelve atrás.'}
            >
              <Seleccion id="dev-repone" name="se_repone" required value={repone} onChange={(e) => setRepone(e.target.value)}>
                <option value="">Elige</option>
                <option value="si">Sí, lo repone</option>
                <option value="no">No lo repone</option>
              </Seleccion>
            </Campo>
            {envio.error && (
              <p role="alert" className="text-sm text-peligro">
                {envio.error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Boton type="submit" cargando={envio.enviando}>
                Devolver
              </Boton>
              <Boton type="button" variante="secundario" onClick={() => setAbierta(false)} disabled={envio.enviando}>
                Cancelar
              </Boton>
            </div>
          </form>
        )}
      </Ventana>
      {envio.resultado?.ok && (
        <p role="status" className="basis-full text-sm text-exito">
          {envio.resultado.mensaje}
        </p>
      )}
    </>
  )
}

/** Lo devuelto que espera su reposición: Almacén la recibe, o Almacén o Logística dicen que el proveedor no lo repone. */
export function EsperanReposicion({
  devoluciones,
  puedeRecibir,
  puedeDejar,
}: {
  devoluciones: DevolucionPorReponer[]
  puedeRecibir: boolean
  puedeDejar: boolean
}) {
  const [aviso, setAviso] = useState<string | null>(null)
  return (
    <>
      {aviso && (
        <p role="status" className="mb-2 text-sm text-exito">
          {aviso}
        </p>
      )}
      <ul className="divide-y divide-borde">
        {devoluciones.map((d) => (
          <Devolucion key={d.devolucion_id} devolucion={d} puedeRecibir={puedeRecibir} puedeDejar={puedeDejar} alTerminar={setAviso} />
        ))}
      </ul>
    </>
  )
}

function Devolucion({
  devolucion: d,
  puedeRecibir,
  puedeDejar,
  alTerminar,
}: {
  devolucion: DevolucionPorReponer
  puedeRecibir: boolean
  puedeDejar: boolean
  alTerminar: (mensaje: string) => void
}) {
  const [abierta, setAbierta] = useState<'llego' | 'ya-no' | null>(null)
  // En metros, 5.3 − 2.1 da 3.1999999999999997 en el navegador, y la base no lo acepta.
  const falta = redondearCantidad(Number(d.devuelto) - Number(d.repuesto))
  const unidad = d.unidad ?? ''
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2">
      <div className="min-w-0 text-sm">
        <p className="font-medium">{d.material}</p>
        <p className="text-xs text-texto-suave">
          {d.compra} · {d.proveedor} · devuelto el {fechaHora(d.fecha)} con {d.documento}
        </p>
        <p className="text-xs">
          <span className="tabular text-sm font-semibold">
            Faltan {cantidad(falta)} {unidad}
          </span>
          {Number(d.repuesto) > 0 && (
            <span className="text-texto-suave">
              {' '}
              de {cantidad(d.devuelto)} (ya llegaron {cantidad(d.repuesto)})
            </span>
          )}
          <span className="text-texto-suave"> · {d.motivo}</span>
        </p>
      </div>
      {(puedeRecibir || puedeDejar) && (
        <div className="flex flex-wrap gap-2">
          {puedeRecibir && (
            <Boton type="button" variante="secundario" tamano="sm" onClick={() => setAbierta('llego')}>
              Llegó la reposición
            </Boton>
          )}
          {puedeDejar && (
            <Boton type="button" variante="secundario" tamano="sm" onClick={() => setAbierta('ya-no')}>
              No lo repone
            </Boton>
          )}
        </div>
      )}
      <Ventana
        abierta={abierta !== null}
        alCerrar={() => setAbierta(null)}
        titulo={abierta === 'llego' ? `Llegó la reposición de ${d.material}` : `El proveedor no repone ${d.material}`}
        descripcion={abierta === 'llego'
          ? `Faltan ${cantidad(falta)} ${unidad} de lo devuelto de la ${d.compra}. Entra al kardex.`
          : `Los ${cantidad(falta)} ${unidad} que faltan vuelven a la lista de Logística para comprarlos en otra OC, y Contabilidad espera la nota de crédito. No vuelve atrás.`}
      >
        {abierta === 'llego' && (
          <Reposicion devolucion={d} falta={falta} alCancelar={() => setAbierta(null)}
            alTerminar={(m) => { setAbierta(null); alTerminar(m) }} />
        )}
        {abierta === 'ya-no' && (
          <YaNoRepone devolucion={d} alCancelar={() => setAbierta(null)}
            alTerminar={(m) => { setAbierta(null); alTerminar(m) }} />
        )}
      </Ventana>
    </li>
  )
}

function Reposicion({ devolucion: d, falta, alCancelar, alTerminar }: {
  devolucion: DevolucionPorReponer
  falta: number
  alCancelar: () => void
  alTerminar: (mensaje: string) => void
}) {
  const [id] = useState(() => crypto.randomUUID())
  const { alEnviar, enviando, error } = useEnvio(recibirReposicion, (r) => alTerminar(r.mensaje ?? 'Recibido.'))
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="devolucion" value={d.devolucion_id ?? ''} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta={`Llegó${d.unidad ? ` (${d.unidad})` : ''}`} htmlFor="rep-cantidad" requerido>
          <Entrada id="rep-cantidad" name="cantidad" type="number" step="0.001" min="0.001" max={falta} defaultValue={falta}
            required inputMode="decimal" className="tabular" />
        </Campo>
        <Campo etiqueta="Guía o documento" htmlFor="rep-documento" requerido>
          <Entrada id="rep-documento" name="documento" required minLength={2} maxLength={100} />
        </Campo>
      </div>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Boton type="submit" cargando={enviando}>
          Recibir
        </Boton>
        <Boton type="button" variante="secundario" onClick={alCancelar} disabled={enviando}>
          Cancelar
        </Boton>
      </div>
    </form>
  )
}

function YaNoRepone({ devolucion: d, alCancelar, alTerminar }: {
  devolucion: DevolucionPorReponer
  alCancelar: () => void
  alTerminar: (mensaje: string) => void
}) {
  const { alEnviar, enviando, error } = useEnvio(dejarDeEsperarReposicion, (r) => alTerminar(r.mensaje ?? 'Anotado.'))
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="devolucion" value={d.devolucion_id ?? ''} />
      <Campo etiqueta="Cómo lo sabes" htmlFor="yano-motivo" requerido ayuda="Queda anotado con la devolución. Al menos 10 caracteres.">
        <AreaTexto id="yano-motivo" name="motivo" required minLength={10} maxLength={500} rows={2}
          placeholder="El proveedor ya no tiene ese material y emite nota de crédito" />
      </Campo>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Boton type="submit" cargando={enviando}>
          No lo repone
        </Boton>
        <Boton type="button" variante="secundario" onClick={alCancelar} disabled={enviando}>
          Cancelar
        </Boton>
      </div>
    </form>
  )
}
