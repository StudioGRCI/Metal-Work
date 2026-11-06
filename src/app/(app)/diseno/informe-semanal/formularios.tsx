'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { TAREAS_DISENO } from '@/lib/dominio/informe-diseno'
import { useAccion, useEnvio } from '@/lib/envio'
import type { Tablas } from '@/types/database'
import { guardarInformeDiseno, quitarRegistroInforme, registrarTareaDiseno, transitarInforme } from './acciones'

/** Una OT elegible: la que tiene colaboradores de Diseño en su equipo, con su código como lo escribe el formato. */
export type OrdenElegible = { id: string; etiqueta: string }
type Persona = Pick<Tablas<'ot_equipo_diseno'>, 'id' | 'orden_id' | 'nombre' | 'funcion'>
type Informe = Pick<Tablas<'diseno_informes'>,
  'responsable' | 'resumen' | 'incidencias' | 'acciones' | 'no_conformidades' | 'indicadores' | 'plan_siguiente' | 'conclusiones'> | null

/** La OT y la persona que hizo el trabajo: solo los colaboradores del equipo de esa OT. */
function OtYPersona({ prefijo, ordenes, personas, ordenId, setOrdenId }: {
  prefijo: string
  ordenes: OrdenElegible[]
  personas: Persona[]
  ordenId: string
  setOrdenId: (id: string) => void
}) {
  const disponibles = personas.filter((p) => p.orden_id === ordenId && p.funcion === 'COLABORADOR')
  return <>
    <Campo etiqueta="Código interno / OT" htmlFor={`${prefijo}-ot`} requerido>
      <Seleccion id={`${prefijo}-ot`} name="orden_id" value={ordenId} onChange={(e) => setOrdenId(e.target.value)} required>
        <option value="">Elige la OT</option>
        {ordenes.map((o) => <option key={o.id} value={o.id}>{o.etiqueta}</option>)}
      </Seleccion>
    </Campo>
    <Campo etiqueta="Responsable" htmlFor={`${prefijo}-persona`} requerido>
      <Seleccion key={ordenId} id={`${prefijo}-persona`} name="integrante_id" defaultValue="" required disabled={!ordenId || disponibles.length === 0}>
        <option value="">Elige al colaborador de esta OT</option>
        {disponibles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </Seleccion>
    </Campo>
    {ordenId && disponibles.length === 0 && <p className="text-sm text-aviso sm:col-span-2">
      Esta OT no tiene colaboradores de Diseño en su equipo. Diseño los agrega en la pestaña Planos de la OT.
    </p>}
  </>
}

/** Una actividad del día: qué se hizo, en qué unidad, quién y qué día. Sin planificar. */
export function FormularioTareaDiseno({ ordenes, personas, hoy }: { ordenes: OrdenElegible[]; personas: Persona[]; hoy: string }) {
  const [ordenId, setOrdenId] = useState('')
  const [clave, setClave] = useState(() => crypto.randomUUID())
  const envio = useEnvio(registrarTareaDiseno, () => setClave(crypto.randomUUID()))
  return <form key={clave} onSubmit={envio.alEnviar} className="grid gap-3 sm:grid-cols-2">
    <input type="hidden" name="id" value={clave} />
    <OtYPersona prefijo="tarea" ordenes={ordenes} personas={personas} ordenId={ordenId} setOrdenId={setOrdenId} />
    <Campo etiqueta="Actividad" htmlFor="tarea-tipo" requerido>
      <Seleccion id="tarea-tipo" name="tipo" required defaultValue="">
        <option value="">Elige la actividad</option>
        {Object.entries(TAREAS_DISENO).map(([valor, nombre]) => <option key={valor} value={valor}>{nombre}</option>)}
      </Seleccion>
    </Campo>
    <Campo etiqueta="Componente" htmlFor="tarea-componente" requerido>
      <Entrada id="tarea-componente" name="componente" minLength={2} maxLength={200} required placeholder="Ej.: Brida para junta cardánica" />
    </Campo>
    <Campo etiqueta="Día" htmlFor="tarea-fecha" requerido ayuda="El día que la hiciste: hoy o uno anterior.">
      <Entrada id="tarea-fecha" name="fecha" type="date" defaultValue={hoy} max={hoy} required />
    </Campo>
    <Campo etiqueta="Observación" htmlFor="tarea-observacion">
      <AreaTexto id="tarea-observacion" name="observacion" maxLength={1500} rows={2} />
    </Campo>
    {envio.error && <p role="alert" className="text-sm text-peligro sm:col-span-2">{envio.error}</p>}
    {envio.resultado?.ok && <p role="status" className="text-sm text-exito sm:col-span-2">{envio.resultado.mensaje}</p>}
    <div className="sm:col-span-2"><Boton type="submit" cargando={envio.enviando}>Anotar actividad</Boton></div>
  </form>
}

export function QuitarRegistro({ id, tabla, descripcion }: { id: string; tabla: 'tarea' | 'entrega'; descripcion: string }) {
  const accion = useAccion(quitarRegistroInforme, undefined, { documento: `${tabla}:${id}` })
  return <span className="inline-flex items-center gap-2">
    <button type="button" aria-label={`Quitar ${descripcion}`} title="Quitar" disabled={accion.enviando}
      onClick={() => { const d = new FormData(); d.set('id', id); d.set('tabla', tabla); accion.ejecutar(d) }}
      className="inline-flex size-9 items-center justify-center rounded-[var(--radius-base)] text-texto-suave hover:bg-peligro-suave hover:text-peligro disabled:opacity-50">
      <X aria-hidden className="size-4" />
    </button>
    {accion.error && <span role="alert" className="text-xs text-peligro">{accion.error}</span>}
  </span>
}

const SECCIONES = [
  { campo: 'resumen', titulo: 'Resumen', ayuda: 'El avance de los proyectos de diseño, el cumplimiento de cronogramas, la elaboración de planos y el soporte técnico a la fabricación.' },
  { campo: 'incidencias', titulo: 'Problemas / incidencias', ayuda: 'Lo que dificultó el trabajo de la semana.' },
  { campo: 'acciones', titulo: 'Acciones correctivas', ayuda: 'Cómo se resolvió o se va a resolver.' },
  { campo: 'no_conformidades', titulo: 'Control de cambios y no conformidades', ayuda: 'Cambios de diseño y observaciones. Si no hubo, dilo.' },
  { campo: 'indicadores', titulo: 'Indicadores de gestión', ayuda: 'Solo cifras comprobadas, como el % de diseños programados cumplidos.' },
  { campo: 'plan_siguiente', titulo: 'Plan de trabajo – semana siguiente', ayuda: 'Lo previsto para la próxima semana.' },
  { campo: 'conclusiones', titulo: 'Conclusiones y recomendaciones', ayuda: 'Acuerdos y mejoras para el equipo.' },
] as const

export function FormularioInformeDiseno({ inicio, informe, responsable }: { inicio: string; informe: Informe; responsable: string }) {
  const envio = useEnvio(guardarInformeDiseno)
  return <form key={inicio} onSubmit={envio.alEnviar} className="space-y-4">
    <input type="hidden" name="semana_inicio" value={inicio} />
    <Campo etiqueta="Responsable del informe" htmlFor="inf-responsable" requerido>
      <Entrada id="inf-responsable" name="responsable" defaultValue={informe?.responsable ?? responsable} maxLength={120} required
        placeholder="Nombre completo" />
    </Campo>
    <p className="text-sm text-texto-suave">Una idea por línea: en el Word cada línea sale como una viñeta.</p>
    <div className="grid gap-3 lg:grid-cols-2">
      {SECCIONES.map((seccion) => <Campo key={seccion.campo} etiqueta={seccion.titulo}
        ayuda={seccion.ayuda} htmlFor={`inf-${seccion.campo}`} className={seccion.campo === 'resumen' ? 'lg:col-span-2' : undefined}>
        <AreaTexto id={`inf-${seccion.campo}`} name={seccion.campo} rows={seccion.campo === 'resumen' ? 4 : 3}
          defaultValue={informe?.[seccion.campo] ?? ''} maxLength={4000} />
      </Campo>)}
    </div>
    {envio.error && <p role="alert" className="text-sm text-peligro">{envio.error}</p>}
    {envio.resultado?.ok && <p role="status" className="text-sm text-exito">{envio.resultado.mensaje}</p>}
    <Boton type="submit" cargando={envio.enviando}>Guardar informe</Boton>
  </form>
}

export function DecisionInforme({ id, estado }: { id: string; estado: 'EN_REVISION' | 'APROBADO' | 'OBSERVADO' }) {
  const envio = useEnvio(transitarInforme)
  return <form onSubmit={envio.alEnviar} className="space-y-3">
    <input type="hidden" name="informe_id" value={id} /><input type="hidden" name="estado" value={estado} />
    {estado === 'OBSERVADO'
      ? <Campo etiqueta="Qué debe corregir el colaborador" htmlFor="revision-inf" requerido><AreaTexto id="revision-inf" name="observacion" minLength={10} maxLength={2000} required /></Campo>
      : <input type="hidden" name="observacion" value="" />}
    <Boton type="submit" cargando={envio.enviando} variante={estado === 'OBSERVADO' ? 'secundario' : 'primario'}>
      {estado === 'EN_REVISION' ? 'Enviar a Diseño' : estado === 'APROBADO' ? 'Aprobar informe' : 'Devolver con observaciones'}
    </Boton>
    {envio.error && <p role="alert" className="text-sm text-peligro">{envio.error}</p>}
    {envio.resultado?.ok && <p role="status" className="text-sm text-exito">{envio.resultado.mensaje}</p>}
  </form>
}
