'use client'
import {useState} from 'react'
import {Boton} from '@/components/ui/boton'
import {Campo,Entrada,Seleccion} from '@/components/ui/campos'
import {Ventana} from '@/components/ui/ventana'
import {useEnvio} from '@/lib/envio'
import type {MaterialParaConteo} from '@/lib/datos/atencion-materiales'
import {registrarIngresoGeneral} from '../../materiales/atencion/acciones'

export function NuevoIngreso({materiales,despachos}:{materiales:MaterialParaConteo[];despachos:{id:string;etiqueta:string}[]}) {
 const [abierta,setAbierta]=useState(false)
 const [id,setId]=useState(()=>crypto.randomUUID())
 const [busqueda,setBusqueda]=useState('')
 const [origen,setOrigen]=useState('INGRESO_GENERAL')
 const envio=useEnvio(registrarIngresoGeneral,()=>{setId(crypto.randomUUID());setAbierta(false)})
 const filtrados=materiales.filter(m=>(m.descripcion+' '+m.codigo).toLowerCase().includes(busqueda.toLowerCase()))
 return <><Boton onClick={()=>setAbierta(true)}>Registrar ingreso</Boton>
 <Ventana abierta={abierta} alCerrar={()=>setAbierta(false)} titulo="Ingreso a Almacén" descripcion="Registra lo que entró físicamente. Las compras de una OT se reciben desde Materiales de esa OT." ancho="lg">
 <form key={id} onSubmit={envio.alEnviar} className="space-y-5">
 <input type="hidden" name="operacion_id" value={id}/>
 <Campo etiqueta="Buscar material" htmlFor="ing-buscar"><Entrada id="ing-buscar" value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Código o descripción"/></Campo>
 <Campo etiqueta="Material" htmlFor="ing-material" requerido ayuda={filtrados.length>100?`${filtrados.length} coincidencias. Escribe el código o nombre para precisar; se muestran las primeras 100.`:undefined}><Seleccion id="ing-material" name="material_id" required defaultValue=""><option value="">Elige el material</option>{filtrados.slice(0,100).map(m=><option key={m.id} value={m.id}>{m.codigo} · {m.descripcion} ({m.unidad})</option>)}</Seleccion></Campo>
 <div className="grid gap-4 sm:grid-cols-2">
 <Campo etiqueta="Tipo de ingreso" htmlFor="ing-origen"><Seleccion id="ing-origen" name="origen" value={origen} onChange={e=>setOrigen(e.target.value)}><option value="INGRESO_GENERAL">Ingreso general</option><option value="SALDO_INICIAL">Saldo inicial</option><option value="DEVOLUCION">Devolución de una entrega</option></Seleccion></Campo>
 <Campo etiqueta="Cantidad" htmlFor="ing-cantidad" requerido><Entrada id="ing-cantidad" name="cantidad" type="number" step="0.001" min="0.001" required inputMode="decimal"/></Campo>
 <Campo etiqueta="Guía, acta o documento" htmlFor="ing-doc" requerido><Entrada id="ing-doc" name="documento" required minLength={2} maxLength={100}/></Campo>
 <Campo etiqueta="Moneda" htmlFor="ing-moneda"><Seleccion id="ing-moneda" name="moneda"><option value="PEN">Soles</option><option value="USD">Dólares</option></Seleccion></Campo>
 <Campo etiqueta="Precio unitario" htmlFor="ing-precio" ayuda="Sin IGV. Si no se conoce, quedará pendiente de valorización."><Entrada id="ing-precio" name="precio" type="number" min={0} step="0.01" inputMode="decimal"/></Campo>
 </div>
 {origen==='DEVOLUCION'&&<Campo etiqueta="Entrega o salida que se devuelve" htmlFor="ing-devolucion" requerido><Seleccion id="ing-devolucion" name="devolucion" required defaultValue=""><option value="">Elige la entrega original</option>{despachos.map(d=><option key={d.id} value={d.id}>{d.etiqueta}</option>)}</Seleccion></Campo>}
 {envio.error&&<p role="alert" className="text-sm text-peligro">{envio.error}</p>}
 <Boton type="submit" cargando={envio.enviando}>Confirmar ingreso</Boton>
 </form></Ventana>{envio.resultado?.ok&&<p role="status" className="mt-2 text-sm text-exito">{envio.resultado.mensaje}</p>}</>
}
