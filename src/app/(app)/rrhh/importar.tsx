'use client'
import {useState} from 'react'
import {Ventana} from '@/components/ui/ventana'
import {Boton} from '@/components/ui/boton'
import {Campo,Entrada} from '@/components/ui/campos'
import {useEnvio} from '@/lib/envio'
import {moneda} from '@/lib/format'
import type {LineaPlanilla} from '@/lib/dominio/planilla-mwp'
import {leerExcelPlanilla,confirmarImportacion} from './importacion-acciones'

export function ImportarPlanilla({planillaId,periodo}:{planillaId:string;periodo:string}) {
 const mes=['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'][Number(periodo.slice(5,7))-1]
 const [abierta,setAbierta]=useState(false),[lineas,setLineas]=useState<LineaPlanilla[]>([]),[hoja,setHoja]=useState(''),[seleccion,setSeleccion]=useState<number[]>([]),[id,setId]=useState(()=>crypto.randomUUID())
 const lectura=useEnvio(leerExcelPlanilla,r=>{if(r.datos){setLineas(r.datos.lineas);setHoja(r.datos.hoja);setSeleccion([])}})
 const confirmacion=useEnvio(confirmarImportacion,()=>{setAbierta(false);setLineas([]);setId(crypto.randomUUID())})
 const elegidas=lineas.filter(l=>seleccion.includes(l.fila))
 return <><Boton variante="secundario" onClick={()=>setAbierta(true)}>Importar detalle de Metal Work</Boton>
 <Ventana abierta={abierta} alCerrar={()=>setAbierta(false)} titulo="Detalle de la planilla" descripcion="Solo se lee el resumen MWP. Selecciona las personas que pertenecen a esta planilla; el resto puede importarse en la planilla correspondiente." ancho="xl">
 {!lineas.length?<form onSubmit={lectura.alEnviar} className="space-y-4"><input type="hidden" name="planilla_id" value={planillaId}/>
 <Campo etiqueta="Archivo Excel" htmlFor="pl-excel" requerido><Entrada id="pl-excel" name="archivo" type="file" accept=".xlsx" required/></Campo>
 <Campo etiqueta="Hoja de Metal Work" htmlFor="pl-hoja" requerido><Entrada id="pl-hoja" name="hoja" defaultValue={`RESUMEN ${mes} MWP - ${periodo.slice(0,4)}`} required maxLength={80}/></Campo>
 {lectura.error&&<p role="alert" className="text-sm text-peligro">{lectura.error}</p>}<Boton type="submit" cargando={lectura.enviando}>Leer y comprobar</Boton></form>
 :<form onSubmit={confirmacion.alEnviar} className="space-y-4"><input type="hidden" name="planilla_id" value={planillaId}/><input type="hidden" name="importacion_id" value={id}/><input type="hidden" name="hoja" value={hoja}/><input type="hidden" name="lineas" value={JSON.stringify(elegidas)}/>
 <p className="text-sm text-texto-suave">{hoja} · {lineas.length} personas encontradas · {seleccion.length} seleccionadas</p>
 <div className="divide-y divide-borde">{lineas.map(l=><label key={l.fila} className="flex items-start gap-3 py-4 text-sm text-texto"><input type="checkbox" checked={seleccion.includes(l.fila)} onChange={e=>setSeleccion(e.target.checked?[...seleccion,l.fila]:seleccion.filter(f=>f!==l.fila))} className="mt-1 size-5 accent-acento"/><span className="min-w-0 flex-1"><strong>{l.nombre}</strong><span className="block text-texto-suave">{l.detalle.puesto} · Bruto {moneda(l.detalle.ingresos)} · Descuentos {moneda(l.detalle.descuentos)} · Neto {moneda(l.detalle.neto)}</span></span><strong className="tabular text-right">{moneda(l.detalle.ingresos+l.detalle.aporte_empleador)}<span className="block text-xs font-normal text-texto-suave">Costo empresa</span></strong></label>)}</div>
 <p className="flex justify-between text-sm font-semibold text-texto"><span>Total que se distribuirá a las OT</span><span className="tabular">{moneda(elegidas.reduce((n,l)=>n+l.detalle.ingresos+l.detalle.aporte_empleador,0))}</span></p>
 <p className="text-xs text-texto-suave">El costo incluye remuneración bruta y aporte del empleador. No incluye provisiones que no figuran en este archivo.</p>
 {confirmacion.error&&<p role="alert" className="text-sm text-peligro">{confirmacion.error}</p>}<Boton type="submit" cargando={confirmacion.enviando} disabled={!elegidas.length}>Importar {elegidas.length} personas</Boton>
 </form>}</Ventana>{confirmacion.resultado?.ok&&<p role="status" className="text-sm text-exito">{confirmacion.resultado.mensaje}</p>}</>
}
