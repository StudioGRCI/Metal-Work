import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'
import { AgregarPersona, CerrarPlanilla, Distribuir, NuevaPlanilla } from './formularios'

export const metadata={title:'Planillas de Recursos Humanos'}

export default async function PaginaRRHH() {
  await exigirPermiso('rrhh.ver_planillas')
  const db=await createClient()
  const [planillas,personas,distribuciones,ordenes]=await Promise.all([
    db.from('planillas').select('id,tipo,periodo,moneda,estado').order('periodo',{ascending:false}).limit(50),
    db.from('planilla_personas').select('id,planilla_id,nombre,documento,monto').order('creado_en').limit(500),
    db.from('planilla_distribuciones').select('id,persona_id,orden_id,porcentaje').limit(1000),
    db.from('ordenes_trabajo').select('id,numero,unidad_id').neq('estado','ANULADA').order('creado_en',{ascending:false}).limit(200),
  ])
  for(const r of [planillas,personas,distribuciones,ordenes]) if(r.error) throw new Error(`No se pudieron cargar las planillas: ${r.error.message}`)
  const ids=(ordenes.data??[]).map(o=>o.unidad_id).filter((id):id is string=>Boolean(id))
  const unidades=ids.length ? await db.from('unidades').select('id,codigo_interno,placa,numero_fmi').in('id',ids) : {data:[],error:null}
  if(unidades.error) throw new Error(`No se pudieron cargar unidades: ${unidades.error.message}`)
  const mapa=new Map((unidades.data??[]).map(u=>[u.id,u.codigo_interno||u.placa||u.numero_fmi||'Unidad sin código']))
  const opciones=(ordenes.data??[]).map(o=>({id:o.id,numero:o.numero,unidad:mapa.get(o.unidad_id??'')??'Sin unidad'}))
  return <><EncabezadoPagina titulo="Recursos Humanos" descripcion="Tres planillas separadas. Distribuye el 100 % de cada persona o subcontrato entre las OT antes de cerrar el mes." />
    <Tarjeta className="mb-5"><TarjetaCabecera titulo="Nueva planilla" descripcion="Taller, administrativa o subcontratos, una por mes." /><TarjetaCuerpo><NuevaPlanilla /></TarjetaCuerpo></Tarjeta>
    <div className="space-y-5">{(planillas.data??[]).length===0&&<p className="text-sm text-texto-suave">Crea la primera planilla para comenzar.</p>}
      {(planillas.data??[]).map(p=><Tarjeta key={p.id}><TarjetaCabecera titulo={`${p.tipo} · ${p.periodo.slice(0,7)}`} descripcion={`${p.estado} · ${p.moneda}`} /><TarjetaCuerpo className="space-y-4">
        {(personas.data??[]).filter(x=>x.planilla_id===p.id).map(x=>{
          const partes=(distribuciones.data??[]).filter(d=>d.persona_id===x.id)
          const suma=partes.reduce((n,d)=>n+Number(d.porcentaje),0)
          return <div key={x.id} className="rounded-lg border border-borde p-3"><p className="font-medium text-texto">{x.nombre} · {p.moneda} {Number(x.monto).toFixed(2)}</p>
            <p className="text-xs text-texto-suave">Asignado {suma.toFixed(2)} % de 100 % {partes.map(d=>`· OT ${opciones.find(o=>o.id===d.orden_id)?.numero??'—'} ${d.porcentaje} %`).join(' ')}</p>
            {p.estado==='BORRADOR'&&<Distribuir personaId={x.id} ordenes={opciones} />}
          </div>
        })}
        {p.estado==='BORRADOR'&&<><AgregarPersona planillaId={p.id} tipo={p.tipo} /><CerrarPlanilla id={p.id} /></>}
      </TarjetaCuerpo></Tarjeta>)}
    </div>
  </>
}
