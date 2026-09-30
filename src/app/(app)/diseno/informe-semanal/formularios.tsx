'use client'

import { useState } from 'react'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'
import type { Tablas } from '@/types/database'
import { guardarInformeDiseno, registrarTareaDiseno,transitarInforme } from './acciones'

type Orden = Pick<Tablas<'ordenes_trabajo'>, 'id' | 'numero'>
type Persona = Pick<Tablas<'ot_equipo_diseno'>, 'id' | 'orden_id' | 'nombre' | 'funcion'>
type Informe = Pick<Tablas<'diseno_informes'>,
  'responsable' | 'resumen' | 'incidencias' | 'acciones' | 'no_conformidades' | 'indicadores' | 'plan_siguiente' | 'conclusiones'> | null

export function FormularioTareaDiseno({ ordenes, personas, puedeJefatura, hoy }: {
  ordenes: Orden[]
  personas: Persona[]
  puedeJefatura: boolean
  hoy: string
}) {
  const [ordenId, setOrdenId] = useState('')
  const [clave, setClave] = useState(() => crypto.randomUUID())
  const envio = useEnvio(registrarTareaDiseno, () => setClave(crypto.randomUUID()))
  const disponibles = personas.filter(p => p.orden_id === ordenId && (puedeJefatura || p.funcion === 'COLABORADOR'))
  return <form key={clave} onSubmit={envio.alEnviar} className="grid gap-3 sm:grid-cols-2">
    <input type="hidden" name="id" value={clave} />
    <Campo etiqueta="Orden de trabajo" htmlFor="tarea-ot" requerido>
      <Seleccion id="tarea-ot" name="orden_id" value={ordenId} onChange={e => setOrdenId(e.target.value)} required>
        <option value="">Elige la OT</option>
        {ordenes.map(o => <option key={o.id} value={o.id}>{o.numero}</option>)}
      </Seleccion>
    </Campo>
    <Campo etiqueta="Persona que hizo la tarea" htmlFor="tarea-persona" requerido>
      <Seleccion key={ordenId} id="tarea-persona" name="integrante_id" defaultValue="" required disabled={!ordenId || disponibles.length === 0}>
        <option value="">Elige la persona asignada a esta OT</option>
        {disponibles.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </Seleccion>
    </Campo>
    <Campo etiqueta="Tipo de tarea" htmlFor="tarea-tipo" requerido>
      <Seleccion id="tarea-tipo" name="tipo" required defaultValue="">
        <option value="">Elige el trabajo</option>
        <option value="MODELADO">Modelado</option>
        <option value="PLOTEO">Ploteo</option>
        <option value="CREACION_PLANO">Creación de plano</option>
        <option value="REVISION">Revisión o modificación</option>
        <option value="SOPORTE">Soporte técnico</option>
        <option value="OTRA">Otra tarea</option>
      </Seleccion>
    </Campo>
    <Campo etiqueta="Componente o trabajo" htmlFor="tarea-componente" requerido>
      <Entrada id="tarea-componente" name="componente" minLength={2} maxLength={200} required />
    </Campo>
    <Campo etiqueta="Inicio" htmlFor="tarea-inicio" requerido>
      <Entrada id="tarea-inicio" name="fecha_inicio" type="date" defaultValue={hoy} required />
    </Campo>
    <Campo etiqueta="Entrega" htmlFor="tarea-fin" requerido>
      <Entrada id="tarea-fin" name="fecha_entrega" type="date" defaultValue={hoy} required />
    </Campo>
    <Campo etiqueta="Observación" htmlFor="tarea-observacion" className="sm:col-span-2">
      <AreaTexto id="tarea-observacion" name="observacion" maxLength={1500} />
    </Campo>
    {ordenId && disponibles.length === 0 && <p className="text-sm text-aviso sm:col-span-2">
      Diseño debe registrar y asignar primero a una persona a esta OT en la pestaña Planos.
    </p>}
    {envio.error && <p role="alert" className="text-sm text-peligro sm:col-span-2">{envio.error}</p>}
    {envio.resultado?.ok && <p role="status" className="text-sm text-exito sm:col-span-2">{envio.resultado.mensaje}</p>}
    <div className="sm:col-span-2"><Boton type="submit" cargando={envio.enviando} disabled={disponibles.length === 0}>Registrar tarea</Boton></div>
  </form>
}

const SECCIONES = [
  { campo: 'resumen', titulo: 'Resumen', ayuda: 'Avance de proyectos, cronograma y soporte técnico.' },
  { campo: 'incidencias', titulo: 'Problemas e incidencias', ayuda: 'Describe dificultades de la semana.' },
  { campo: 'acciones', titulo: 'Acciones correctivas', ayuda: 'Indica cómo se resolvieron o resolverán.' },
  { campo: 'no_conformidades', titulo: 'Cambios y no conformidades', ayuda: 'Anota revisiones y observaciones.' },
  { campo: 'indicadores', titulo: 'Indicadores de gestión', ayuda: 'Usa cifras comprobadas; no inventes porcentajes.' },
  { campo: 'plan_siguiente', titulo: 'Plan de la semana siguiente', ayuda: 'Tareas previstas.' },
  { campo: 'conclusiones', titulo: 'Conclusiones y recomendaciones', ayuda: 'Cierra con los acuerdos del equipo.' },
] as const

export function FormularioInformeDiseno({ inicio, informe }: { inicio: string; informe: Informe }) {
  const envio = useEnvio(guardarInformeDiseno)
  return <form key={inicio} onSubmit={envio.alEnviar} className="space-y-4">
    <input type="hidden" name="semana_inicio" value={inicio} />
    <Campo etiqueta="Responsable del informe" htmlFor="inf-responsable" requerido>
      <Entrada id="inf-responsable" name="responsable" defaultValue={informe?.responsable ?? ''} maxLength={120} required
        placeholder="Nombre completo" />
    </Campo>
    <div className="grid gap-3 lg:grid-cols-2">
      {SECCIONES.map(seccion => <Campo key={seccion.campo} etiqueta={seccion.titulo}
        ayuda={seccion.ayuda} htmlFor={`inf-${seccion.campo}`}>
        <AreaTexto id={`inf-${seccion.campo}`} name={seccion.campo}
          defaultValue={informe?.[seccion.campo] ?? ''} maxLength={4000} />
      </Campo>)}
    </div>
    {envio.error && <p role="alert" className="text-sm text-peligro">{envio.error}</p>}
    {envio.resultado?.ok && <p role="status" className="text-sm text-exito">{envio.resultado.mensaje}</p>}
    <Boton type="submit" cargando={envio.enviando}>Guardar informe</Boton>
  </form>
}

export function DecisionInforme({id,estado}:{id:string;estado:'EN_REVISION'|'APROBADO'|'OBSERVADO'|'RECIBIDO'}) {
 const envio=useEnvio(transitarInforme)
 return <form onSubmit={envio.alEnviar} className="space-y-3">
 <input type="hidden" name="informe_id" value={id}/><input type="hidden" name="estado" value={estado}/>
 {estado==='OBSERVADO'?<Campo etiqueta="Qué debe corregir el colaborador" htmlFor="revision-inf" requerido><AreaTexto id="revision-inf" name="observacion" minLength={10} maxLength={2000} required/></Campo>:<input type="hidden" name="observacion" value=""/>}
 <Boton type="submit" cargando={envio.enviando} variante={estado==='OBSERVADO'?'secundario':'primario'}>{estado==='EN_REVISION'?'Enviar a Diseño':estado==='APROBADO'?'Aprobar y enviar a Administración':estado==='OBSERVADO'?'Devolver con observaciones':'Confirmar recepción'}</Boton>
 {envio.error&&<p role="alert" className="text-sm text-peligro">{envio.error}</p>}{envio.resultado?.ok&&<p role="status" className="text-sm text-exito">{envio.resultado.mensaje}</p>}
 </form>
}
