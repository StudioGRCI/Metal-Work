'use client'

import { useState } from 'react'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'
import { crearPlanilla, agregarPersona, distribuirPersona, cerrarPlanilla, repartirEnPartesIguales } from './acciones'

type Orden={id:string;numero:string;unidad:string}

export function NuevaPlanilla() {
  const {alEnviar,enviando,error,resultado}=useEnvio(crearPlanilla)
  return <form onSubmit={alEnviar} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
    <Campo etiqueta="Tipo" htmlFor="pl-tipo"><Seleccion id="pl-tipo" name="tipo"><option value="TALLER">Taller</option><option value="ADMINISTRATIVA">Administrativa</option><option value="SUBCONTRATOS">Subcontratos</option></Seleccion></Campo>
    <Campo etiqueta="Primer día del mes" htmlFor="pl-periodo" requerido><Entrada id="pl-periodo" name="periodo" type="date" required /></Campo>
    <Campo etiqueta="Moneda" htmlFor="pl-moneda"><Seleccion id="pl-moneda" name="moneda"><option value="PEN">Soles</option><option value="USD">Dólares</option></Seleccion></Campo>
    <input type="hidden" name="observacion" value="" /><Boton type="submit" cargando={enviando}>Crear planilla</Boton>
    {error&&<p role="alert" className="text-xs text-peligro sm:col-span-4">{error}</p>}{resultado?.ok&&<p role="status" className="text-xs text-exito sm:col-span-4">{resultado.mensaje}</p>}
  </form>
}

export function AgregarPersona({planillaId,tipo}:{planillaId:string;tipo:string}) {
  const {alEnviar,enviando,error,resultado}=useEnvio(agregarPersona)
  return <form onSubmit={alEnviar} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
    <input type="hidden" name="planilla_id" value={planillaId} />
    <Campo etiqueta={tipo==='SUBCONTRATOS'?'Proveedor o subcontrato':'Nombre completo'} htmlFor={`pl-nom-${planillaId}`} requerido><Entrada id={`pl-nom-${planillaId}`} name="nombre" minLength={3} maxLength={160} required /></Campo>
    <Campo etiqueta="Documento" htmlFor={`pl-doc-${planillaId}`}><Entrada id={`pl-doc-${planillaId}`} name="documento" maxLength={20} /></Campo>
    <Campo etiqueta="Importe del mes" htmlFor={`pl-monto-${planillaId}`} requerido><Entrada id={`pl-monto-${planillaId}`} name="monto" type="number" min={0} step="0.01" inputMode="decimal" required /></Campo>
    <Boton type="submit" tamano="sm" cargando={enviando}>Agregar</Boton>
    {error&&<p role="alert" className="text-xs text-peligro sm:col-span-4">{error}</p>}{resultado?.ok&&<p role="status" className="text-xs text-exito sm:col-span-4">{resultado.mensaje}</p>}
  </form>
}

export function Distribuir({personaId,ordenes}:{personaId:string;ordenes:Orden[]}) {
  const {alEnviar,enviando,error,resultado}=useEnvio(distribuirPersona)
  return <form onSubmit={alEnviar} className="mt-2 grid gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
    <input type="hidden" name="persona_id" value={personaId} />
    <Campo etiqueta="Unidad / OT" htmlFor={`dist-ot-${personaId}`} requerido><Seleccion id={`dist-ot-${personaId}`} name="orden_id" defaultValue="" required><option value="" disabled>Elige una unidad</option>{ordenes.map(o=><option key={o.id} value={o.id}>{o.numero} · {o.unidad}</option>)}</Seleccion></Campo>
    <Campo etiqueta="Porcentaje" htmlFor={`dist-pct-${personaId}`} requerido><Entrada id={`dist-pct-${personaId}`} name="porcentaje" type="number" min="0.01" max={100} step="0.01" inputMode="decimal" required /></Campo>
    <Boton type="submit" tamano="sm" variante="secundario" cargando={enviando}>Guardar %</Boton>
    {error&&<p role="alert" className="text-xs text-peligro sm:col-span-3">{error}</p>}{resultado?.ok&&<p role="status" className="text-xs text-exito sm:col-span-3">{resultado.mensaje}</p>}
  </form>
}

export function CerrarPlanilla({id}:{id:string}) {
  const {alEnviar,enviando,error,resultado}=useEnvio(cerrarPlanilla)
  return <form onSubmit={alEnviar} className="space-y-2"><input type="hidden" name="planilla_id" value={id} />
    <Boton type="submit" tamano="sm" cargando={enviando}>Cerrar planilla</Boton>
    {error&&<p role="alert" className="text-xs text-peligro">{error}</p>}{resultado?.ok&&<p role="status" className="text-xs text-exito">{resultado.mensaje}</p>}
  </form>
}

/**
 * Repartir en partes iguales: se marcan las personas (de entrada, las que
 * todavía no suman 100 %) y las OT, y cada persona queda con el mismo % en
 * cada OT. Reemplaza el reparto que esas personas tuvieran.
 */
export function RepartirPartesIguales({ planillaId, personas, ordenes }: {
  planillaId: string
  personas: { id: string; nombre: string; asignado: number }[]
  ordenes: Orden[]
}) {
  const [filtro, setFiltro] = useState('')
  const [marcadas, setMarcadas] = useState<string[]>([])
  const { alEnviar, enviando, error, resultado } = useEnvio(repartirEnPartesIguales, () => setMarcadas([]))
  const buscar = filtro.trim().toLowerCase()
  const visibles = ordenes.filter((o) => !buscar || `${o.numero} ${o.unidad}`.toLowerCase().includes(buscar))
  const parte = marcadas.length ? Math.floor(10000 / marcadas.length) / 100 : 0
  return <form onSubmit={alEnviar} className="space-y-4">
    <input type="hidden" name="planilla_id" value={planillaId} />
    <fieldset>
      <legend className="text-xs font-medium text-texto-suave">Personas</legend>
      <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
        {personas.map((p) => (
          <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-base)] px-2 text-sm text-texto hover:bg-superficie-2">
            <input type="checkbox" name="persona_id" value={p.id} defaultChecked={p.asignado !== 100} className="size-4 accent-[var(--acento)]" />
            <span className="min-w-0 flex-1 truncate">{p.nombre}</span>
            <span className="tabular text-xs text-texto-suave">{p.asignado.toFixed(2)} %</span>
          </label>
        ))}
      </div>
    </fieldset>
    <fieldset>
      <legend className="text-xs font-medium text-texto-suave">OT entre las que se reparte</legend>
      <Entrada aria-label="Buscar OT por número o unidad" placeholder="Buscar por número o unidad" value={filtro}
        onChange={(e) => setFiltro(e.target.value)} className="mt-1.5" />
      <div className="mt-2 max-h-64 overflow-y-auto rounded-[var(--radius-base)] border border-borde">
        {ordenes.map((o) => (
          <label key={o.id} className={`flex min-h-11 cursor-pointer items-center gap-2 border-b border-borde px-3 text-sm text-texto last:border-0 hover:bg-superficie-2 ${visibles.includes(o) ? '' : 'hidden'}`}>
            <input type="checkbox" name="orden_id" value={o.id} checked={marcadas.includes(o.id)}
              onChange={(e) => setMarcadas((antes) => e.target.checked ? [...antes, o.id] : antes.filter((x) => x !== o.id))}
              className="size-4 accent-[var(--acento)]" />
            <span className="tabular font-medium">{o.numero}</span><span className="text-texto-suave">{o.unidad}</span>
          </label>
        ))}
      </div>
    </fieldset>
    <p className="text-sm text-texto-suave" aria-live="polite">
      {marcadas.length === 0 ? 'Marca las OT.' : marcadas.length === 1 ? 'Cada persona marcada queda con el 100 % en esa OT.' : `Cada persona marcada queda con ${parte} % en cada una de las ${marcadas.length} OT (la última se lleva el redondeo).`}
    </p>
    {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
    {resultado?.ok && <p role="status" className="text-sm text-exito">{resultado.mensaje}</p>}
    <Boton type="submit" tamano="sm" cargando={enviando} disabled={!marcadas.length}>Repartir en partes iguales</Boton>
  </form>
}
