'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { AREAS_QUE_RECIBEN, CLAVES_AREA, ESTADOS_ENTREGA, TAREAS_DISENO } from '@/lib/dominio/informe-diseno'
import { useAccion, useEnvio } from '@/lib/envio'
import type { Tablas } from '@/types/database'
import { guardarInformeDiseno, quitarRegistroInforme, registrarEntregaPlanos, registrarTareaDiseno, transitarInforme } from './acciones'

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

export function FormularioTareaDiseno({ ordenes, personas, hoy }: { ordenes: OrdenElegible[]; personas: Persona[]; hoy: string }) {
  const [ordenId, setOrdenId] = useState('')
  const [clave, setClave] = useState(() => crypto.randomUUID())
  const envio = useEnvio(registrarTareaDiseno, () => setClave(crypto.randomUUID()))
  return <form key={clave} onSubmit={envio.alEnviar} className="grid gap-3 sm:grid-cols-2">
    <input type="hidden" name="id" value={clave} />
    <OtYPersona prefijo="tarea" ordenes={ordenes} personas={personas} ordenId={ordenId} setOrdenId={setOrdenId} />
    <Campo etiqueta="Tarea a ejecutar" htmlFor="tarea-tipo" requerido>
      <Seleccion id="tarea-tipo" name="tipo" required defaultValue="">
        <option value="">Elige la tarea</option>
        {Object.entries(TAREAS_DISENO).map(([valor, nombre]) => <option key={valor} value={valor}>{nombre}</option>)}
      </Seleccion>
    </Campo>
    <Campo etiqueta="Componente" htmlFor="tarea-componente" requerido>
      <Entrada id="tarea-componente" name="componente" minLength={2} maxLength={200} required placeholder="Ej.: Brida para junta cardánica" />
    </Campo>
    <Campo etiqueta="Fecha de inicio" htmlFor="tarea-inicio" requerido>
      <Entrada id="tarea-inicio" name="fecha_inicio" type="date" defaultValue={hoy} required />
    </Campo>
    <Campo etiqueta="Fecha de entrega" htmlFor="tarea-fin" requerido>
      <Entrada id="tarea-fin" name="fecha_entrega" type="date" defaultValue={hoy} required />
    </Campo>
    <Campo etiqueta="Observación" htmlFor="tarea-observacion" className="sm:col-span-2">
      <AreaTexto id="tarea-observacion" name="observacion" maxLength={1500} rows={2} />
    </Campo>
    {envio.error && <p role="alert" className="text-sm text-peligro sm:col-span-2">{envio.error}</p>}
    {envio.resultado?.ok && <p role="status" className="text-sm text-exito sm:col-span-2">{envio.resultado.mensaje}</p>}
    <div className="sm:col-span-2"><Boton type="submit" cargando={envio.enviando}>Registrar tarea</Boton></div>
  </form>
}

export function FormularioEntregaPlanos({ ordenes, personas, inicio, fin }: {
  ordenes: OrdenElegible[]
  personas: Persona[]
  inicio: string
  fin: string
}) {
  const [ordenId, setOrdenId] = useState('')
  const [estado, setEstado] = useState<keyof typeof ESTADOS_ENTREGA>('CULMINADO')
  const [clave, setClave] = useState(() => crypto.randomUUID())
  const envio = useEnvio(registrarEntregaPlanos, () => { setClave(crypto.randomUUID()); setEstado('CULMINADO') })
  return <form key={clave} onSubmit={envio.alEnviar} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <input type="hidden" name="id" value={clave} />
    <input type="hidden" name="semana_inicio" value={inicio} />
    <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-4">
      <OtYPersona prefijo="entrega" ordenes={ordenes} personas={personas} ordenId={ordenId} setOrdenId={setOrdenId} />
    </div>
    <Campo etiqueta="Tipo de plano" htmlFor="entrega-tipo" requerido className="sm:col-span-2 lg:col-span-4"
      ayuda="Qué se entregó, como en el formato: «HAB/ARM envolturas y tapas», «Plano para corte DXF», «Plano de ensamble».">
      <Entrada id="entrega-tipo" name="tipo_plano" minLength={2} maxLength={200} required />
    </Campo>
    <Campo etiqueta="N.º de planos" htmlFor="entrega-planos" requerido>
      <Entrada id="entrega-planos" name="n_planos" type="number" inputMode="numeric" min={1} max={999} step={1} required />
    </Campo>
    <Campo etiqueta="N.º de piezas" htmlFor="entrega-piezas" requerido>
      <Entrada id="entrega-piezas" name="n_piezas" type="number" inputMode="numeric" min={0} max={9999} step={1} defaultValue={0} required />
    </Campo>
    <Campo etiqueta="Fecha de entrega" htmlFor="entrega-fecha">
      <Entrada id="entrega-fecha" name="fecha_entrega" type="date" min={inicio} max={fin} />
    </Campo>
    <Campo etiqueta="Estado" htmlFor="entrega-estado" requerido>
      <Seleccion id="entrega-estado" name="estado" value={estado} onChange={(e) => setEstado(e.target.value as keyof typeof ESTADOS_ENTREGA)} required>
        {Object.entries(ESTADOS_ENTREGA).map(([valor, nombre]) => <option key={valor} value={valor}>{nombre}</option>)}
      </Seleccion>
    </Campo>
    <fieldset className="sm:col-span-2 lg:col-span-4">
      <legend className="text-xs font-medium text-texto-suave">
        Entregado a{estado === 'CULMINADO' && <span className="ml-0.5 text-peligro">*</span>}
      </legend>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {CLAVES_AREA.map((area) => (
          <label key={area} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-base)] border border-borde px-3 text-sm text-texto has-[:checked]:border-acento has-[:checked]:bg-acento-suave">
            <input type="checkbox" name="entregado_a" value={area} defaultChecked={area !== 'ACB'} className="size-4 accent-[var(--acento)]" />
            {AREAS_QUE_RECIBEN[area]}
          </label>
        ))}
      </div>
    </fieldset>
    {envio.error && <p role="alert" className="text-sm text-peligro sm:col-span-2 lg:col-span-4">{envio.error}</p>}
    {envio.resultado?.ok && <p role="status" className="text-sm text-exito sm:col-span-2 lg:col-span-4">{envio.resultado.mensaje}</p>}
    <div className="sm:col-span-2 lg:col-span-4"><Boton type="submit" cargando={envio.enviando}>Registrar entrega</Boton></div>
  </form>
}

/** Quitar una fila propia mientras la semana está abierta. */
export function QuitarRegistro({ id, tabla, descripcion }: { id: string; tabla: 'tarea' | 'entrega'; descripcion: string }) {
  const accion = useAccion(quitarRegistroInforme)
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

export function DecisionInforme({ id, estado }: { id: string; estado: 'EN_REVISION' | 'APROBADO' | 'OBSERVADO' | 'RECIBIDO' }) {
  const envio = useEnvio(transitarInforme)
  return <form onSubmit={envio.alEnviar} className="space-y-3">
    <input type="hidden" name="informe_id" value={id} /><input type="hidden" name="estado" value={estado} />
    {estado === 'OBSERVADO'
      ? <Campo etiqueta="Qué debe corregir el colaborador" htmlFor="revision-inf" requerido><AreaTexto id="revision-inf" name="observacion" minLength={10} maxLength={2000} required /></Campo>
      : <input type="hidden" name="observacion" value="" />}
    <Boton type="submit" cargando={envio.enviando} variante={estado === 'OBSERVADO' ? 'secundario' : 'primario'}>
      {estado === 'EN_REVISION' ? 'Enviar a Diseño' : estado === 'APROBADO' ? 'Aprobar y enviar a Administración' : estado === 'OBSERVADO' ? 'Devolver con observaciones' : 'Confirmar recepción'}
    </Boton>
    {envio.error && <p role="alert" className="text-sm text-peligro">{envio.error}</p>}
    {envio.resultado?.ok && <p role="status" className="text-sm text-exito">{envio.resultado.mensaje}</p>}
  </form>
}
