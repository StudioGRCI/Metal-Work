'use client'
import {useState} from 'react'
import {Boton} from '@/components/ui/boton'
import {Campo,Entrada,Seleccion} from '@/components/ui/campos'
import {Ventana} from '@/components/ui/ventana'
import {useEnvio} from '@/lib/envio'
import type {MaterialParaConteo} from '@/lib/datos/atencion-materiales'
import {registrarIngresoGeneral} from '../../materiales/atencion/acciones'

const etiquetaDe=(m:MaterialParaConteo)=>`${m.codigo} · ${m.descripcion}${m.unidad?` (${m.unidad})`:''}`

/**
 * Ingreso a Almacén. El material se escribe: si coincide con uno del catálogo
 * se usa ese, y si no, entra como material nuevo con la unidad que se elija.
 * Obligar a elegirlo de la lista dejaba fuera lo que el catálogo no tiene.
 */
export function NuevoIngreso({materiales,unidades,despachos}:{materiales:MaterialParaConteo[];unidades:{id:string;codigo:string;nombre:string}[];despachos:{id:string;etiqueta:string}[]}) {
 const [abierta,setAbierta]=useState(false)
 const [id,setId]=useState(()=>crypto.randomUUID())
 const [materialNuevo,setMaterialNuevo]=useState(()=>crypto.randomUUID())
 const [texto,setTexto]=useState('')
 const [origen,setOrigen]=useState('INGRESO_GENERAL')
 const envio=useEnvio(registrarIngresoGeneral,()=>{setId(crypto.randomUUID());setMaterialNuevo(crypto.randomUUID());setTexto('');setAbierta(false)})
 const escrito=texto.trim().toUpperCase()
 const elegido=escrito?materiales.find(m=>etiquetaDe(m).toUpperCase()===escrito||m.codigo.toUpperCase()===escrito):undefined
 const libre=Boolean(escrito)&&!elegido
 const parecidos=escrito.length>=2&&!elegido?materiales.filter(m=>(m.descripcion+' '+m.codigo).toUpperCase().includes(escrito)).slice(0,100):materiales.slice(0,100)
 return <><Boton onClick={()=>setAbierta(true)}>Registrar ingreso</Boton>
 <Ventana abierta={abierta} alCerrar={()=>setAbierta(false)} titulo="Ingreso a Almacén" descripcion="Registra lo que entró físicamente. Las compras de una OT se reciben desde Materiales de esa OT." ancho="lg">
 <form key={id} onSubmit={envio.alEnviar} className="space-y-5">
 <input type="hidden" name="operacion_id" value={id}/>
 {elegido?<input type="hidden" name="material_id" value={elegido.id}/>:<input type="hidden" name="material_nuevo_id" value={materialNuevo}/>}
 <Campo etiqueta="Material" htmlFor="ing-material" requerido ayuda="Escríbelo como lo conoces. Si aparece en la lista, elígelo; si no, entra como material nuevo.">
 <Entrada id="ing-material" name="descripcion" list="ing-catalogo" value={texto} onChange={e=>setTexto(e.target.value)} required minLength={3} maxLength={200} autoComplete="off" placeholder="Ej.: Disco de corte 7 pulgadas"/>
 <datalist id="ing-catalogo">{parecidos.map(m=><option key={m.id} value={etiquetaDe(m)}/>)}</datalist>
 </Campo>
 {elegido&&<p className="-mt-3 text-xs text-exito">Del catálogo: {elegido.descripcion}{elegido.unidad?`, en ${elegido.unidad}`:''}.</p>}
 {libre&&<p className="-mt-3 text-xs text-texto-suave">No está en el catálogo: se dará de alta como material nuevo, por clasificar.</p>}
 <div className="grid gap-4 sm:grid-cols-2">
 {libre&&<Campo etiqueta="Unidad" htmlFor="ing-unidad" requerido><Seleccion id="ing-unidad" name="unidad_id" required defaultValue={unidades.find(u=>u.codigo==='UND')?.id??''}><option value="">Elige la unidad</option>{unidades.map(u=><option key={u.id} value={u.id}>{u.nombre} ({u.codigo})</option>)}</Seleccion></Campo>}
 <Campo etiqueta="Tipo de ingreso" htmlFor="ing-origen"><Seleccion id="ing-origen" name="origen" value={origen} onChange={e=>setOrigen(e.target.value)}><option value="INGRESO_GENERAL">Ingreso general</option><option value="SALDO_INICIAL">Saldo inicial</option>{!libre&&<option value="DEVOLUCION">Devolución de una entrega</option>}</Seleccion></Campo>
 <Campo etiqueta="Cantidad" htmlFor="ing-cantidad" requerido><Entrada id="ing-cantidad" name="cantidad" type="number" step="0.001" min="0.001" required inputMode="decimal"/></Campo>
 <Campo etiqueta="Guía, acta o documento" htmlFor="ing-doc" requerido><Entrada id="ing-doc" name="documento" required minLength={2} maxLength={100}/></Campo>
 <Campo etiqueta="Moneda" htmlFor="ing-moneda"><Seleccion id="ing-moneda" name="moneda"><option value="PEN">Soles</option><option value="USD">Dólares</option></Seleccion></Campo>
 <Campo etiqueta="Precio unitario" htmlFor="ing-precio" ayuda="Sin IGV. Si no se conoce, quedará pendiente de valorización."><Entrada id="ing-precio" name="precio" type="number" min={0} step="0.01" inputMode="decimal"/></Campo>
 </div>
 {origen==='DEVOLUCION'&&!libre&&<Campo etiqueta="Entrega o salida que se devuelve" htmlFor="ing-devolucion" requerido><Seleccion id="ing-devolucion" name="devolucion" required defaultValue=""><option value="">Elige la entrega original</option>{despachos.map(d=><option key={d.id} value={d.id}>{d.etiqueta}</option>)}</Seleccion></Campo>}
 {envio.error&&<p role="alert" className="text-sm text-peligro">{envio.error}</p>}
 <Boton type="submit" cargando={envio.enviando}>Confirmar ingreso</Boton>
 </form></Ventana>{envio.resultado?.ok&&<p role="status" className="mt-2 text-sm text-exito">{envio.resultado.mensaje}</p>}</>
}
