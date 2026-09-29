'use client'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'
import { crearPlanilla, agregarPersona, distribuirPersona, cerrarPlanilla } from './acciones'

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
