import {z} from 'zod'

const dinero=z.number().finite().min(0).max(999999999)
export const detallePlanilla=z.object({puesto:z.string().max(160),dias:z.number().min(0).max(31),horas:z.number().min(0).max(744),horas_extras:z.number().min(0).max(744),
 ingresos:dinero,descuentos:dinero,aporte_empleador:dinero,neto:dinero,conceptos:z.array(z.object({tipo:z.enum(['INGRESO','DESCUENTO']),nombre:z.string().max(160),importe:dinero})).max(50)})
export const lineaPlanilla=z.object({nombre:z.string().trim().min(3).max(160),fila:z.number().int().positive(),detalle:detallePlanilla})
export type LineaPlanilla=z.infer<typeof lineaPlanilla>
export function centimos(valor:number){return Math.round((valor+Number.EPSILON)*100)/100}
const normalizar=(v:unknown)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim()
const numero=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:0

/** El formato MWP contiene una boleta por bloque. Nunca lee las otras empresas. */
export function leerPlanillaMwp(filas:unknown[][]):LineaPlanilla[] {
 const bloques:number[]=[]
 filas.forEach((fila,i)=>{if(normalizar(fila[1])==='NOMBRES Y APELLIDOS')bloques.push(i)})
 if(!bloques.length)throw new Error('No se encontraron las boletas del resumen MWP.')
 return bloques.map((inicio,indice)=>{
   const fin=bloques[indice+1]??filas.length
   const bloque=filas.slice(inicio,fin)
   const totales=bloque.find(f=>normalizar(f[1])==='TOTAL'&&normalizar(f[3])==='TOTAL')
   const neto=bloque.find(f=>normalizar(f[1])==='NETO A RECIBIR')
   const aporte=bloque.find(f=>normalizar(f[1])==='ESSALUD')
   if(!totales||!neto||typeof totales[2]!=='number'||typeof totales[4]!=='number'||typeof neto[3]!=='number'||!aporte||typeof aporte[4]!=='number')throw new Error(`La boleta de la fila ${inicio+1} no tiene totales completos. Revisa el Excel.`)
   const conceptos:z.infer<typeof detallePlanilla>['conceptos']=[]
   for(const fila of bloque){
     const ingreso=normalizar(fila[1]),descuento=normalizar(fila[3])
     if(typeof fila[2]==='number'&&ingreso&&['SUELDO','HORAS EXTRAS','FERIADOS'].includes(ingreso)||typeof fila[2]==='number'&&ingreso.startsWith('BONO'))conceptos.push({tipo:'INGRESO',nombre:String(fila[1]).trim(),importe:centimos(numero(fila[2]))})
     if(typeof fila[4]==='number'&&typeof fila[3]==='string'&&!['TOTAL','PUESTO DE TRABAJO:'].includes(descuento)&&descuento&&!descuento.startsWith('NETO'))conceptos.push({tipo:'DESCUENTO',nombre:String(fila[3]).trim(),importe:centimos(numero(fila[4]))})
   }
   const datos=bloque[3]??[]
   const linea=lineaPlanilla.parse({nombre:String(filas[inicio][2]??'').trim(),fila:inicio+1,detalle:{puesto:String(bloque[1]?.[2]??'').trim(),dias:numero(datos[1]),horas:numero(datos[2]),horas_extras:numero(datos[4]),ingresos:centimos(totales[2]),descuentos:centimos(totales[4]),aporte_empleador:centimos(aporte[4]),neto:centimos(neto[3]),conceptos}})
   if(Math.abs(centimos(linea.detalle.ingresos-linea.detalle.descuentos)-linea.detalle.neto)>0.02)throw new Error(`El neto de la fila ${inicio+1} no cuadra con ingresos menos descuentos.`)
   return linea
 })
}
