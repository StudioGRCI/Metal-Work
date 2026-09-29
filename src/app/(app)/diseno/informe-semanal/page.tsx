import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { datosInformeDiseno } from '@/lib/datos/informe-diseno'
import { inicioSemanaDiseno } from '@/lib/dominio/semana-diseno'
import { fecha, hoyLima } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'
import { FormularioInformeDiseno, FormularioTareaDiseno } from './formularios'

export const metadata = { title: 'Informe semanal · Diseño e Ingeniería' }

export default async function PaginaInformeSemanalDiseno({ searchParams }: {
  searchParams: Promise<{ semana?: string }>
}) {
  const perfil = await exigirPermiso(['diseno.planos', 'diseno.subir_pdf', 'supervision.general'])
  const parametros = await searchParams
  let inicio = inicioSemanaDiseno(hoyLima())
  if (parametros.semana) {
    try { inicio = inicioSemanaDiseno(parametros.semana) } catch { /* Mostrar la semana actual si la URL no es válida. */ }
  }
  const puedeEscribir = puede(perfil, ['diseno.planos', 'diseno.subir_pdf'])
  const db = await createClient()
  const [datos, ordenes, personas] = await Promise.all([
    datosInformeDiseno(inicio),
    puedeEscribir ? db.from('ordenes_trabajo').select('id,numero').neq('estado', 'ANULADA').order('creado_en', { ascending: false }).limit(200) : Promise.resolve({ data: [], error: null }),
    puedeEscribir ? db.from('ot_equipo_diseno').select('id,orden_id,nombre,funcion').order('nombre').limit(1000) : Promise.resolve({ data: [], error: null }),
  ])
  if (ordenes.error || personas.error) throw new Error('No se pudieron cargar las OT o el equipo de Diseño.')
  const ordenesConPersonas = (ordenes.data ?? []).filter(o => (personas.data ?? []).some(p => p.orden_id === o.id))

  return <>
    <EncabezadoPagina titulo="Informe semanal de Diseño e Ingeniería"
      descripcion="Registra el trabajo de los colaboradores y descarga el informe de Metal Work con tareas y planos aprobados." />
    <div className="space-y-5">
      <Tarjeta>
        <TarjetaCabecera titulo="Semana del informe" descripcion="Elige cualquier día de la semana que quieres revisar." />
        <TarjetaCuerpo>
          <form action="/diseno/informe-semanal" className="flex flex-wrap items-end gap-3">
            <label htmlFor="semana-diseno" className="grid gap-1 text-sm font-medium text-texto">
              Día de la semana
              <input id="semana-diseno" name="semana" type="date" defaultValue={inicio}
                className="rounded-[var(--radius-base)] border border-borde bg-superficie px-3 py-2 text-texto" />
            </label>
            <button className="rounded-[var(--radius-base)] bg-acento px-4 py-2 font-medium text-white" type="submit">Ver semana</button>
          </form>
          <p className="mt-3 text-sm text-texto-suave">Del {fecha(inicio)} al {fecha(datos.fin)} · {datos.informe ? `Informe N.º ${datos.informe.numero}` : 'Informe aún no guardado'}</p>
        </TarjetaCuerpo>
      </Tarjeta>

      {puedeEscribir && <Tarjeta>
        <TarjetaCabecera titulo="Tarea de un colaborador" descripcion="Elige una OT y una persona registrada en su equipo de Diseño. La tarea aparecerá en la semana de sus fechas." />
        <TarjetaCuerpo>
          {ordenesConPersonas.length ? <FormularioTareaDiseno ordenes={ordenesConPersonas} personas={personas.data ?? []}
            puedeJefatura={puede(perfil, 'diseno.planos')} hoy={hoyLima()} />
            : <p className="text-sm text-texto-suave">No hay OT con integrantes de Diseño registrados. Agrégalos en la pestaña Planos de una OT.</p>}
        </TarjetaCuerpo>
      </Tarjeta>}

      <Tarjeta>
        <TarjetaCabecera titulo="Trabajo y planos de la semana" descripcion="Los planos se toman de sus versiones aprobadas por Diseño durante esta semana." />
        <TarjetaCuerpo className="space-y-4">
          <div>
            <h2 className="font-semibold text-texto">Tareas registradas ({datos.tareas.length})</h2>
            {datos.tareas.length === 0 && <p className="mt-1 text-sm text-texto-suave">Aún no hay tareas en esta semana.</p>}
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {datos.tareas.map(t => <div key={t.id} className="rounded-[var(--radius-base)] border border-borde p-3 text-sm">
                <p className="font-medium text-texto">OT {t.ot} · {t.componente}</p>
                <p className="text-texto-suave">{t.responsable} · {t.tipo} · {fecha(t.fecha_inicio)} a {fecha(t.fecha_entrega)}</p>
                {t.observacion && <p className="mt-1 whitespace-pre-wrap text-texto-suave">{t.observacion}</p>}
              </div>)}
            </div>
          </div>
          <div>
            <h2 className="font-semibold text-texto">Planos aprobados ({datos.planos.length})</h2>
            {datos.planos.length === 0 && <p className="mt-1 text-sm text-texto-suave">No hay versiones aprobadas por Diseño esta semana.</p>}
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {datos.planos.map(p => <div key={p.id} className="rounded-[var(--radius-base)] border border-borde p-3 text-sm">
                <p className="font-medium text-texto">OT {p.ot} · Plano {p.numero} · {p.nombre}</p>
                <p className="text-texto-suave">{p.responsable} · {p.area} · {fecha(p.entregado_en)}</p>
              </div>)}
            </div>
          </div>
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera titulo="Contenido del informe" descripcion="El responsable resume las incidencias y acuerdos. Las tablas de tareas y planos se incorporan automáticamente al Word." />
        <TarjetaCuerpo className="space-y-4">
          {puedeEscribir ? <FormularioInformeDiseno inicio={inicio} informe={datos.informe} />
            : <p className="text-sm text-texto-suave">Solo Diseño prepara y modifica el informe.</p>}
          {datos.informe && <Link href={`/diseno/informe-semanal/descargar?semana=${inicio}`}
            className="inline-flex rounded-[var(--radius-base)] border border-borde px-4 py-2 font-medium text-acento hover:bg-superficie-2">
            Descargar Word · Informe N.º {datos.informe.numero}
          </Link>}
        </TarjetaCuerpo>
      </Tarjeta>
    </div>
  </>
}
