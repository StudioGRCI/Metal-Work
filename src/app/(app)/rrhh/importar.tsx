'use client'
import { useMemo, useState } from 'react'
import { AlertTriangle, FileSpreadsheet } from 'lucide-react'
import { Ventana } from '@/components/ui/ventana'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'
import { moneda } from '@/lib/format'
import { claveNombre, type LineaPlanilla } from '@/lib/dominio/planilla-excel'
import { leerExcelPlanilla, confirmarImportacion, type LecturaPlanilla } from './importacion-acciones'

const id = (l: LineaPlanilla) => `${l.hoja}#${l.fila}`
const costo = (l: LineaPlanilla) => l.detalle.ingresos + l.detalle.aporte_empleador

/**
 * Importar la planilla desde el Excel de Recursos Humanos: se lee el libro
 * entero, se ven las personas por empresa —como en la hoja PAGOS— con lo que
 * no cuadra, y se eligen las que van a esta planilla.
 */
export function ImportarPlanilla({ planillaId }: { planillaId: string }) {
  const [abierta, setAbierta] = useState(false)
  const [lectura, setLectura] = useState<LecturaPlanilla | null>(null)
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [importacion, setImportacion] = useState(() => crypto.randomUUID())
  const leer = useEnvio(leerExcelPlanilla, (r) => { if (r.datos) { setLectura(r.datos); setSeleccion([]) } }, { refrescar: false })
  const confirmar = useEnvio(confirmarImportacion, () => { setAbierta(false); setLectura(null); setImportacion(crypto.randomUUID()) })

  const todas = useMemo(() => lectura?.empresas.flatMap((g) => g.lineas) ?? [], [lectura])
  const elegidas = todas.filter((l) => seleccion.includes(id(l)))
  const yaEsta = (l: LineaPlanilla) => lectura?.yaEn[claveNombre(l.nombre)]
  const alternar = (claves: string[], marcar: boolean) =>
    setSeleccion((antes) => marcar ? [...new Set([...antes, ...claves])] : antes.filter((c) => !claves.includes(c)))

  return <>
    <Boton variante="secundario" onClick={() => setAbierta(true)}>
      <FileSpreadsheet aria-hidden className="size-4" /> Importar del Excel
    </Boton>
    {confirmar.resultado?.ok && <p role="status" className="text-sm text-exito">{confirmar.resultado.mensaje}</p>}
    <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} ancho="xl" titulo="Importar la planilla del Excel"
      descripcion="Se lee el libro entero: las hojas RESUMEN del mes y la hoja PAGOS, que dice la empresa de cada persona. Elige quiénes van a esta planilla.">
      {!lectura ? (
        <form onSubmit={leer.alEnviar} className="space-y-4">
          <input type="hidden" name="planilla_id" value={planillaId} />
          <Campo etiqueta="Excel de la planilla del mes" htmlFor="pl-excel" requerido ayuda="El mismo libro que arma Recursos Humanos, con sus hojas RESUMEN y PAGOS.">
            <Entrada id="pl-excel" name="archivo" type="file" accept=".xlsx" required />
          </Campo>
          {leer.error && <p role="alert" className="text-sm text-peligro">{leer.error}</p>}
          <Boton type="submit" cargando={leer.enviando}>Leer y comprobar</Boton>
        </form>
      ) : (
        <form onSubmit={(e) => confirmar.alEnviar(e)} className="space-y-4">
          <input type="hidden" name="planilla_id" value={planillaId} />
          <input type="hidden" name="importacion_id" value={importacion} />
          <input type="hidden" name="lineas" value={JSON.stringify(elegidas)} />
          <p className="text-sm text-texto-suave">
            Hojas leídas: {lectura.hojas.join(' · ')}.
            {lectura.omitidas.length > 0 && <> No se leyeron por no ser de este mes y año: {lectura.omitidas.join(' · ')}.</>}
            {!lectura.conPagos && <> El libro no tiene hoja PAGOS: no se sabe la empresa de cada persona.</>}
          </p>
          {lectura.errores.length > 0 && (
            <div role="alert" className="rounded-[var(--radius-base)] border border-peligro/40 bg-peligro-suave p-3 text-sm">
              <p className="font-medium text-peligro">No se pueden importar ({lectura.errores.length})</p>
              <ul className="mt-1 list-disc pl-5 text-texto">
                {lectura.errores.map((e) => <li key={`${e.hoja}#${e.fila}`}>{e.nombre} ({e.hoja}, fila {e.fila}): {e.error}</li>)}
              </ul>
            </div>
          )}
          {lectura.empresas.map((g) => {
            const disponibles = g.lineas.filter((l) => !yaEsta(l))
            const claves = disponibles.map(id)
            const todasMarcadas = claves.length > 0 && claves.every((c) => seleccion.includes(c))
            return (
              <section key={g.empresa ?? 'sin-empresa'} className="rounded-[var(--radius-base)] border border-borde">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-borde bg-superficie-2 px-3 py-2">
                  <div>
                    <h3 className="text-sm font-semibold text-texto">{g.empresa ?? 'Sin empresa en la hoja PAGOS'}</h3>
                    <p className="text-xs text-texto-suave">
                      {g.lineas.length} {g.lineas.length === 1 ? 'persona' : 'personas'} · costo {moneda(g.lineas.reduce((s, l) => s + costo(l), 0))}
                    </p>
                  </div>
                  {claves.length > 0 && (
                    <Boton type="button" tamano="sm" variante="secundario" onClick={() => alternar(claves, !todasMarcadas)}>
                      {todasMarcadas ? 'Quitar a todas' : `Elegir las ${claves.length}`}
                    </Boton>
                  )}
                </header>
                <ul className="divide-y divide-borde">
                  {g.lineas.map((l) => {
                    const ya = yaEsta(l)
                    const avisos = l.detalle.avisos ?? []
                    return (
                      <li key={id(l)}>
                        <label className={`flex items-start gap-3 px-3 py-3 text-sm ${ya ? 'opacity-60' : 'cursor-pointer'}`}>
                          <input type="checkbox" disabled={Boolean(ya)} checked={seleccion.includes(id(l))}
                            onChange={(e) => alternar([id(l)], e.target.checked)} className="mt-1 size-5 accent-[var(--acento)]" />
                          <span className="min-w-0 flex-1">
                            <strong className="text-texto">{l.nombre}</strong>
                            <span className="block text-xs text-texto-suave">
                              {l.detalle.puesto || 'Sin puesto'} · {l.hoja}, fila {l.fila}{ya && <> · ya está en la {ya.toLowerCase()} de este mes</>}
                            </span>
                            <span className="block text-xs text-texto-suave">
                              Bruto {moneda(l.detalle.ingresos)} · descuentos {moneda(l.detalle.descuentos)} · neto {moneda(l.detalle.neto)} · EsSalud {moneda(l.detalle.aporte_empleador)}
                            </span>
                            {avisos.map((a, i) => (
                              <span key={i} className="mt-1 flex items-start gap-1 text-xs text-aviso">
                                <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />{a}
                              </span>
                            ))}
                          </span>
                          <strong className="tabular text-right text-texto">
                            {moneda(costo(l))}<span className="block text-xs font-normal text-texto-suave">costo empresa</span>
                          </strong>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borde pt-3">
            <p className="text-sm text-texto">
              {elegidas.length} {elegidas.length === 1 ? 'persona elegida' : 'personas elegidas'} ·
              <span className="tabular font-semibold"> {moneda(elegidas.reduce((s, l) => s + costo(l), 0))}</span> para repartir entre las OT
            </p>
            <div className="flex gap-2">
              <Boton type="button" variante="secundario" onClick={() => setLectura(null)}>Otro Excel</Boton>
              <Boton type="submit" cargando={confirmar.enviando} disabled={!elegidas.length}>Importar {elegidas.length || ''}</Boton>
            </div>
          </div>
          <p className="text-xs text-texto-suave">El costo empresa es el bruto más EsSalud. No incluye provisiones (vacaciones, gratificaciones, CTS) que no figuran en el Excel.</p>
          {confirmar.error && <p role="alert" className="text-sm text-peligro">{confirmar.error}</p>}
        </form>
      )}
    </Ventana>
  </>
}
