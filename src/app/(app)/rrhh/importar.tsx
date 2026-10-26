'use client'
import { useMemo, useState } from 'react'
import { AlertTriangle, FileSpreadsheet } from 'lucide-react'
import { Ventana } from '@/components/ui/ventana'
import { Boton } from '@/components/ui/boton'
import { Campo } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { useEnvio } from '@/lib/envio'
import { moneda } from '@/lib/format'
import { claveNombre, type LineaPlanilla } from '@/lib/dominio/planilla-excel'
import { leerExcelPlanilla, confirmarImportacion, type LecturaPlanilla } from './importacion-acciones'

const id = (l: LineaPlanilla) => `${l.hoja}#${l.fila}`
// Las palabras que distinguen un nombre: sin «DE», «LA», «DEL», «LOS»…, que
// comparten muchos apellidos peruanos que no tienen nada que ver.
const PARTICULAS = new Set(['DEL', 'LAS', 'LOS'])
const palabras = (nombre: string) => claveNombre(nombre).split(' ').filter((p) => p.length > 2 && !PARTICULAS.has(p))
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
  // Quien ya entró a esta planilla y no figura en el libro: si es que se le
  // corrigió el nombre, la versión corregida sale para elegir y entraría dos veces.
  const faltan = useMemo(() => {
    const enElLibro = new Set([...todas, ...(lectura?.errores ?? [])].map((l) => claveNombre(l.nombre)))
    return (lectura?.importadas ?? []).filter((n) => !enElLibro.has(claveNombre(n)))
  }, [lectura, todas])
  // La persona del libro que comparte dos palabras del nombre con una de las que
  // faltan es, casi seguro, la misma con el nombre corregido: se marca en su fila
  // y «Elegir las N» no la mete; se puede elegir a mano si de verdad es otra.
  const pareceA = (l: LineaPlanilla) => {
    const propias = new Set(palabras(l.nombre))
    return faltan.find((n) => palabras(n).filter((p) => propias.has(p)).length >= 2)
  }
  // Al cerrar se olvida el error de la vez anterior: volvía a salir con la
  // ventana vacía, sin ningún archivo elegido.
  const cerrar = () => { setAbierta(false); leer.limpiar(); confirmar.limpiar() }
  const alternar = (claves: string[], marcar: boolean) =>
    setSeleccion((antes) => marcar ? [...new Set([...antes, ...claves])] : antes.filter((c) => !claves.includes(c)))

  return <>
    <Boton variante="secundario" onClick={() => setAbierta(true)}>
      <FileSpreadsheet aria-hidden className="size-4" /> Importar del Excel
    </Boton>
    {confirmar.resultado?.ok && <p role="status" className="text-sm text-exito">{confirmar.resultado.mensaje}</p>}
    <Ventana abierta={abierta} alCerrar={cerrar} ancho="xl" titulo="Importar la planilla del Excel"
      descripcion="Se lee el libro entero: las hojas RESUMEN del mes y la hoja PAGOS, que dice la empresa de cada persona. Elige quiénes van a esta planilla.">
      {!lectura ? (
        <form onSubmit={leer.alEnviar} className="space-y-4">
          <input type="hidden" name="planilla_id" value={planillaId} />
          <Campo etiqueta="Excel de la planilla del mes" htmlFor="pl-excel" requerido ayuda="El mismo libro que arma Recursos Humanos, con sus hojas RESUMEN y PAGOS.">
            <ElegirArchivo id="pl-excel" name="archivo" accept=".xlsx" texto="Elegir el Excel de la planilla" hastaMb={5} required aria-invalid={Boolean(leer.error)} onChange={() => leer.limpiar()} />
          </Campo>
          {leer.error && <p role="alert" className="text-sm text-peligro">{leer.error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Boton type="button" variante="secundario" onClick={cerrar}>Cancelar</Boton>
            <Boton type="submit" cargando={leer.enviando}>Leer y comprobar</Boton>
          </div>
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
          {faltan.length > 0 && (
            <div role="note" className="flex items-start gap-2 rounded-[var(--radius-base)] border border-aviso/40 bg-aviso-suave p-3 text-sm text-texto">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-aviso" />
              <p>
                {faltan.length === 1
                  ? <>Ya está en esta planilla y no figura en este Excel: {faltan[0]}. Si en el Excel le corregiste el nombre, quítala primero de la planilla y después elige la versión corregida; si no, entraría dos veces.</>
                  : <>Ya están en esta planilla y no figuran en este Excel: {faltan.join(' · ')}. Si en el Excel les corregiste el nombre, quítalas primero de la planilla y después elige las versiones corregidas; si no, entrarían dos veces.</>}
              </p>
            </div>
          )}
          {lectura.errores.length > 0 && (
            <div role="alert" className="rounded-[var(--radius-base)] border border-peligro/40 bg-peligro-suave p-3 text-sm">
              <p className="font-medium text-peligro">No se pueden importar ({lectura.errores.length})</p>
              <ul className="mt-1 list-disc pl-5 text-texto">
                {lectura.errores.map((e) => <li key={`${e.hoja}#${e.fila}`}>{e.nombre} ({e.hoja}, fila {e.fila}): {e.error}</li>)}
              </ul>
            </div>
          )}
          {lectura.empresas.map((g) => {
            const disponibles = g.lineas.filter((l) => !yaEsta(l) && !pareceA(l))
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
                    const parecida = !ya && pareceA(l)
                    const avisos = [
                      ...(parecida ? [`¿Es ${parecida} con el nombre corregido? Ya está en esta planilla: si es la misma, no la elijas.`] : []),
                      ...(l.detalle.avisos ?? []),
                    ]
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
              <span className="tabular font-semibold"> {moneda(elegidas.reduce((s, l) => s + costo(l), 0))}</span> de costo del mes
            </p>
            <div className="flex flex-wrap gap-2">
              <Boton type="button" variante="fantasma" onClick={cerrar}>Cancelar</Boton>
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
