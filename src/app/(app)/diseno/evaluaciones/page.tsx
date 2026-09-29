import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { puntajeDiseno } from '@/lib/dominio/evaluacion-diseno'
import { fecha, hoyLima } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'
import { FormularioEvaluacion } from './formulario'

export const metadata = { title: 'Evaluaciones · Diseño e Ingeniería' }

export default async function PaginaEvaluacionesDiseno() {
  const perfil = await exigirPermiso(['diseno.planos', 'rrhh.ver_planillas', 'supervision.general'])
  const db = await createClient()
  const { data, error } = await db.from('diseno_evaluaciones')
    .select('id,evaluado_nombre,puesto,fecha_evaluacion,respuestas,comentarios')
    .order('fecha_evaluacion', { ascending: false }).limit(100)
  if (error) throw new Error('No se pudieron cargar las evaluaciones de Diseño e Ingeniería.')
  return <>
    <EncabezadoPagina titulo="Evaluación de Diseño e Ingeniería"
      descripcion="Evaluación general del personal del área. No depende de una orden de trabajo ni de la planilla." />
    <div className="space-y-5">
      {puede(perfil, 'diseno.planos') && <Tarjeta>
        <TarjetaCabecera titulo="Nueva evaluación" descripcion="Jefatura de Diseño registra los veinte criterios del formato de Metal Work." />
        <TarjetaCuerpo><FormularioEvaluacion hoy={hoyLima()} /></TarjetaCuerpo>
      </Tarjeta>}
      <Tarjeta>
        <TarjetaCabecera titulo="Evaluaciones registradas" descripcion="Solo Diseño, Recursos Humanos y Supervisión General pueden consultarlas." />
        <TarjetaCuerpo className="space-y-3">
          {(data ?? []).length === 0 && <p className="text-sm text-texto-suave">Aún no hay evaluaciones registradas. La primera se crea en el formulario de arriba.</p>}
          {(data ?? []).map(e => <div key={e.id} className="rounded-[var(--radius-base)] border border-borde p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-texto">{e.evaluado_nombre} · {e.puesto}</p>
              <p className="tabular text-sm font-semibold text-acento">{puntajeDiseno(e.respuestas)} / 100</p>
            </div>
            <p className="text-xs text-texto-suave">{fecha(e.fecha_evaluacion)}</p>
            {e.comentarios && <p className="mt-2 whitespace-pre-wrap text-sm text-texto">{e.comentarios}</p>}
          </div>)}
        </TarjetaCuerpo>
      </Tarjeta>
    </div>
  </>
}
