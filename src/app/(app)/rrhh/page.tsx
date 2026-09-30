import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { exigirPermiso, puede } from '@/lib/sesion'
import { moneda, porcentaje } from '@/lib/format'
import { detallePlanilla } from '@/lib/dominio/planilla-mwp'
import { ImportarPlanilla } from './importar'
import { createClient } from '@/lib/supabase/server'
import { AgregarPersona, CerrarPlanilla, Distribuir, NuevaPlanilla } from './formularios'

export const metadata={title:'Planillas de Recursos Humanos'}

export default async function PaginaRRHH() {
  const perfil = await exigirPermiso('rrhh.ver_planillas')
  const gestiona = puede(perfil, 'rrhh.gestionar_planillas')
  const db=await createClient()
  const [planillas,personas,distribuciones,ordenes]=await Promise.all([
    db.from('planillas').select('id,tipo,periodo,moneda,estado').order('periodo',{ascending:false}).limit(50),
    db.from('planilla_personas').select('id,planilla_id,nombre,documento,monto,detalle,origen_hoja').order('creado_en').limit(500),
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
    {gestiona&&<details className="mb-5 rounded-[var(--radius-base)] border border-borde bg-superficie p-4"><summary className="cursor-pointer font-semibold text-acento">Crear planilla del mes</summary><div className="pt-4"><NuevaPlanilla /></div></details>}
    <div className="space-y-5">{(planillas.data??[]).length===0&&<p className="text-sm text-texto-suave">Crea la primera planilla para comenzar.</p>}
      {(planillas.data??[]).map(p=><Tarjeta key={p.id}><TarjetaCabecera titulo={`${({TALLER:'Planilla de taller',ADMINISTRATIVA:'Planilla administrativa',SUBCONTRATOS:'Subcontratos'})[p.tipo]} · ${p.periodo.slice(0,7)}`} descripcion={`${p.estado==='BORRADOR'?'En preparación':'Cerrada'} · ${(personas.data??[]).filter(x=>x.planilla_id===p.id).length} personas · Costo ${moneda((personas.data??[]).filter(x=>x.planilla_id===p.id).reduce((n,x)=>n+x.monto,0),p.moneda==='USD'?'USD':'PEN')}`} acciones={gestiona&&p.estado==='BORRADOR'&&p.moneda==='PEN'?<ImportarPlanilla planillaId={p.id} periodo={p.periodo}/>:undefined}/><TarjetaCuerpo className="space-y-4">
        {(personas.data??[]).filter(x=>x.planilla_id===p.id).map(x=>{
          const partes=(distribuciones.data??[]).filter(d=>d.persona_id===x.id)
          const suma=partes.reduce((n,d)=>n+Number(d.porcentaje),0)
          const detalle=detallePlanilla.safeParse(x.detalle)
          return <details key={x.id} className="group rounded-lg border border-borde"><summary className="cursor-pointer px-4 py-3 text-texto"><span className="inline-flex w-[calc(100%-1.5rem)] flex-wrap items-start justify-between gap-2 align-top"><span><strong className="block text-sm">{x.nombre}</strong><span className="text-xs text-texto-suave">{detalle.success?detalle.data.puesto:'Registro manual'} · Asignado {porcentaje(suma,2)}</span></span><strong className="tabular text-sm">{moneda(x.monto,p.moneda==='USD'?'USD':'PEN')}</strong></span></summary><div className="space-y-4 border-t border-borde p-4">
            {detalle.success&&<><dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">{([['Remuneración bruta',detalle.data.ingresos],['Descuentos',detalle.data.descuentos],['Neto a pagar',detalle.data.neto],['Aporte del empleador',detalle.data.aporte_empleador]] as const).map(([etiqueta,valor])=><div key={etiqueta}><dt className="text-xs text-texto-suave">{etiqueta}</dt><dd className="mt-1 tabular font-semibold text-texto">{moneda(valor,p.moneda==='USD'?'USD':'PEN')}</dd></div>)}</dl><p className="text-xs text-texto-suave">{detalle.data.dias} días · {detalle.data.horas} horas · {detalle.data.horas_extras} horas extra</p><details><summary className="cursor-pointer text-sm text-acento">Ver conceptos del Excel</summary><dl className="mt-2 divide-y divide-borde">{detalle.data.conceptos.map((c,i)=><div key={i} className="flex justify-between gap-4 py-2 text-sm"><dt className="text-texto-suave">{c.nombre} · {c.tipo==='INGRESO'?'Ingreso':'Descuento'}</dt><dd className="tabular text-texto">{moneda(c.importe,p.moneda==='USD'?'USD':'PEN')}</dd></div>)}</dl></details></>}
            <p className="text-xs text-texto-suave">Distribución: {partes.length?partes.map(d=>`OT ${opciones.find(o=>o.id===d.orden_id)?.numero??'—'}: ${porcentaje(d.porcentaje,2)}`).join(' · '):'Pendiente de asignar a las OT.'}</p>
            {gestiona&&p.estado==='BORRADOR'&&<Distribuir personaId={x.id} ordenes={opciones} />}
          </div></details>
        })}
        {gestiona&&p.estado==='BORRADOR'&&<><details><summary className="cursor-pointer py-2 text-sm text-acento">Agregar persona o subcontrato manualmente</summary><AgregarPersona planillaId={p.id} tipo={p.tipo} /></details><CerrarPlanilla id={p.id} /></>}
      </TarjetaCuerpo></Tarjeta>)}
    </div>
  </>
}
