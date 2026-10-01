import Link from 'next/link'
import { Download } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { BASE_BOTON, Boton, TAMANOS, VARIANTES } from '@/components/ui/boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { datosInformeDiseno } from '@/lib/datos/informe-diseno'
import {
  AREAS_QUE_RECIBEN, ESTADOS_ENTREGA, FORMATO_INFORME_DISENO, codigoInternoOt, fechaDelInforme, nombreTarea,
  numeroInforme, planosPorArea, siglaCarroceria,
} from '@/lib/dominio/informe-diseno'
import { inicioSemanaDiseno } from '@/lib/dominio/semana-diseno'
import { fecha, hoyLima } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import {
  DecisionInforme, FormularioEntregaPlanos, FormularioInformeDiseno, FormularioTareaDiseno, QuitarRegistro, type OrdenElegible,
} from './formularios'

export const metadata = { title: 'Informe semanal · Diseño e Ingeniería' }
const ESTADOS: Record<string, string> = {
  BORRADOR: 'Borrador del colaborador', EN_REVISION: 'Pendiente de revisión de Diseño', OBSERVADO: 'Devuelto para corregir',
  APROBADO: 'Aprobado · pendiente de Administración', RECIBIDO: 'Recibido por Administración',
}

export default async function PaginaInformeSemanalDiseno({ searchParams }: {
  searchParams: Promise<{ semana?: string }>
}) {
  const perfil = await exigirPermiso(['diseno.planos', 'diseno.subir_pdf', 'supervision.general', 'administracion.recibir_informe'])
  const parametros = await searchParams
  let inicio = inicioSemanaDiseno(hoyLima())
  if (parametros.semana) {
    try { inicio = inicioSemanaDiseno(parametros.semana) } catch { /* Mostrar la semana actual si la URL no es válida. */ }
  }
  const puedeEscribir = puede(perfil, 'diseno.preparar_informe')
  const db = await createClient()
  const [datos, equipo, pendientes] = await Promise.all([
    datosInformeDiseno(inicio),
    puedeEscribir
      ? db.from('ot_equipo_diseno').select('id,orden_id,nombre,funcion').eq('funcion', 'COLABORADOR').order('nombre').limit(1000)
      : Promise.resolve({ data: [], error: null }),
    puede(perfil, ['diseno.revisar_informe', 'administracion.recibir_informe'])
      ? db.from('diseno_informes').select('id,numero,semana_inicio,estado')
        .eq('estado', puede(perfil, 'diseno.revisar_informe') ? 'EN_REVISION' : 'APROBADO')
        .order('semana_inicio').limit(100)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (equipo.error || pendientes.error) throw new Error('No se pudieron cargar el equipo o los informes pendientes de Diseño.')

  // Las OT que el colaborador puede elegir: las que tienen colaboradores de
  // Diseño en su equipo, nombradas como en el formato («código/OT · CM»).
  const idsConEquipo = [...new Set((equipo.data ?? []).map((p) => p.orden_id))]
  const [ordenes, identificacion] = idsConEquipo.length
    ? await Promise.all([
        db.from('ordenes_trabajo').select('id,numero,estado').in('id', idsConEquipo).neq('estado', 'ANULADA')
          .order('creado_en', { ascending: false }).limit(200),
        db.rpc('identificacion_ot_diseno', { p_ordenes: idsConEquipo }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]
  if (ordenes.error || identificacion.error) throw new Error('No se pudieron cargar las OT del equipo de Diseño.')
  const idPorOt = new Map((identificacion.data ?? []).map((o) => [o.orden_id, o]))
  const elegibles: OrdenElegible[] = (ordenes.data ?? []).map((o) => {
    const i = idPorOt.get(o.id)
    return { id: o.id, etiqueta: `${codigoInternoOt(i?.codigo_interno, o.numero)} · ${siglaCarroceria(i?.tipo_unidad)}` }
  })

  const informe = datos.informe
  const abierta = !datos.enviado
  const escribe = puedeEscribir && abierta
  const disenadores = [...new Set([...datos.tareas.map((t) => t.responsable), ...datos.entregas.map((e) => e.responsable)])].sort()
  const porArea = planosPorArea(datos.entregas)
  const totalPlanos = datos.entregas.reduce((s, e) => s + e.n_planos, 0)
  const totalPiezas = datos.entregas.reduce((s, e) => s + e.n_piezas, 0)

  return <>
    <EncabezadoPagina titulo="Informe semanal de Diseño e Ingeniería"
      descripcion={`Formato ${FORMATO_INFORME_DISENO.codigo}. Lo llena el colaborador; Diseño lo revisa y Administración recibe la versión aprobada.`}
      acciones={informe && <a href={`/diseno/informe-semanal/descargar?semana=${inicio}`} download
        className={cn(BASE_BOTON, VARIANTES.secundario, TAMANOS.md)}>
        <Download aria-hidden className="size-4" /> Descargar Word
      </a>} />
    <div className="space-y-5">
      {(pendientes.data ?? []).length > 0 && <Tarjeta>
        <TarjetaCabecera titulo={puede(perfil, 'diseno.revisar_informe') ? 'Informes por revisar' : 'Informes aprobados por recibir'} descripcion="Abre la semana correspondiente para completar tu revisión." />
        <TarjetaCuerpo className="flex flex-wrap gap-3">{(pendientes.data ?? []).map((p) =>
          <Link key={p.id} href={`/diseno/informe-semanal?semana=${p.semana_inicio}`}
            className="min-h-11 rounded-[var(--radius-base)] border border-borde px-4 py-3 text-sm font-medium text-acento hover:bg-acento-suave">
            Informe N.º {numeroInforme(p.numero)} · semana del {fecha(p.semana_inicio)}
          </Link>)}</TarjetaCuerpo>
      </Tarjeta>}

      <Tarjeta>
        <TarjetaCabecera titulo="Semana del informe" descripcion="Elige cualquier día de la semana que quieres ver." />
        <TarjetaCuerpo>
          <form action="/diseno/informe-semanal" className="flex flex-wrap items-end gap-3">
            <label htmlFor="semana-diseno" className="grid gap-1 text-sm font-medium text-texto">
              Día de la semana
              <input id="semana-diseno" name="semana" type="date" defaultValue={inicio}
                className="rounded-[var(--radius-base)] border border-borde bg-superficie px-3 py-2 text-texto" />
            </label>
            <Boton type="submit">Ver semana</Boton>
          </form>
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-texto-suave">N.º de informe</dt><dd className="tabular font-semibold text-texto">{informe ? numeroInforme(informe.numero) : 'Aún no guardado'}</dd></div>
            <div><dt className="text-xs text-texto-suave">Semana</dt><dd className="text-texto">{fecha(inicio)} al {fecha(datos.fin)}</dd></div>
            <div><dt className="text-xs text-texto-suave">Fecha del informe</dt><dd className="text-texto">{fecha(fechaDelInforme(inicio))}</dd></div>
            <div><dt className="text-xs text-texto-suave">Área</dt><dd className="text-texto">{FORMATO_INFORME_DISENO.area} · {FORMATO_INFORME_DISENO.planta}</dd></div>
          </dl>
          {informe && <div className="mt-4 space-y-3 rounded-[var(--radius-base)] bg-superficie-2 p-4">
            <p className="font-semibold text-texto">{ESTADOS[informe.estado] ?? informe.estado}</p>
            {informe.observacion_revision && <p className="text-sm text-aviso">{informe.observacion_revision}</p>}
            {puedeEscribir && ['BORRADOR', 'OBSERVADO'].includes(informe.estado) && <DecisionInforme id={informe.id} estado="EN_REVISION" />}
            {puede(perfil, 'diseno.revisar_informe') && informe.estado === 'EN_REVISION' && <div className="space-y-4">
              <DecisionInforme id={informe.id} estado="APROBADO" />
              <details><summary className="cursor-pointer py-2 text-sm font-medium text-acento">Devolver con observaciones</summary><DecisionInforme id={informe.id} estado="OBSERVADO" /></details>
            </div>}
            {puede(perfil, 'administracion.recibir_informe') && informe.estado === 'APROBADO' && <DecisionInforme id={informe.id} estado="RECIBIDO" />}
          </div>}
          {!abierta && puedeEscribir && <p className="mt-3 text-sm text-texto-suave">El informe ya se envió: las tablas muestran lo que se envió y no se pueden cambiar salvo que Diseño lo devuelva.</p>}
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera titulo="Planificación de modelado"
          descripcion="Todas las unidades tienen código interno para la fabricación; las de garantía o mantenimiento, su OT. Cada tarea sale en la semana de sus fechas." />
        <TarjetaCuerpo className="space-y-4">
          <p className="text-sm text-texto"><span className="font-medium">Diseñadores:</span> {disenadores.length ? disenadores.join(', ') : 'Todavía nadie registró trabajo esta semana.'}</p>
          <Tabla>
            <TablaCabecera><tr>
              <TH className="w-10">Ítem</TH><TH>Código interno / OT</TH><TH>Tipo</TH><TH>Tarea a ejecutar</TH><TH>Componente</TH>
              <TH>Inicio</TH><TH>Entrega</TH><TH>Responsable</TH>{escribe && <TH className="w-12" aria-label="Quitar" />}
            </tr></TablaCabecera>
            <tbody>
              {datos.tareas.length === 0 && <SinDatos titulo="Aún no hay tareas esta semana" descripcion={escribe ? 'Registra la primera con el formulario de abajo.' : undefined} />}
              {datos.tareas.map((t, i) => <TR key={t.id}>
                <TD className="tabular text-texto-suave">{i + 1}</TD>
                <TD className="font-medium whitespace-nowrap">{codigoInternoOt(t.codigo_interno, t.ot)}</TD>
                <TD>{siglaCarroceria(t.tipo_unidad)}</TD>
                <TD className="whitespace-nowrap">{nombreTarea(t.tipo)}</TD>
                <TD className="min-w-48">{t.componente}{t.observacion && <span className="block text-xs text-texto-suave">{t.observacion}</span>}</TD>
                <TD className="tabular whitespace-nowrap">{fecha(t.fecha_inicio)}</TD>
                <TD className="tabular whitespace-nowrap">{fecha(t.fecha_entrega)}</TD>
                <TD className="whitespace-nowrap">{t.responsable}</TD>
                {escribe && <TD>{t.creado_por === perfil.id && <QuitarRegistro id={t.id} tabla="tarea" descripcion={`la tarea ${t.componente}`} />}</TD>}
              </TR>)}
            </tbody>
          </Tabla>
          {escribe && (elegibles.length
            ? <div className="rounded-[var(--radius-base)] border border-borde p-4"><h3 className="mb-3 text-sm font-semibold text-texto">Registrar una tarea</h3>
                <FormularioTareaDiseno ordenes={elegibles} personas={equipo.data ?? []} hoy={hoyLima()} /></div>
            : <p className="text-sm text-texto-suave">No hay OT con colaboradores de Diseño en su equipo. Diseño los agrega en la pestaña Planos de cada OT.</p>)}
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera titulo="Avance de planos o culminación"
          descripcion="Cada entregable con su número de planos y de piezas. La conclusión suma los planos entregados a cada área." />
        <TarjetaCuerpo className="space-y-4">
          <Tabla>
            <TablaCabecera><tr>
              <TH className="w-10">Ítem</TH><TH>Código interno / OT</TH><TH>Tipo</TH><TH className="text-right">N.º planos</TH>
              <TH className="text-right">N.º piezas</TH><TH>Tipo de plano</TH><TH>Entrega</TH><TH>Estado</TH><TH>Responsable</TH><TH>Entregado a</TH>
              {escribe && <TH className="w-12" aria-label="Quitar" />}
            </tr></TablaCabecera>
            <tbody>
              {datos.entregas.length === 0 && <SinDatos titulo="Aún no hay planos registrados esta semana" descripcion={escribe ? 'Registra cada entregable con el formulario de abajo.' : undefined} />}
              {datos.entregas.map((e, i) => <TR key={e.id}>
                <TD className="tabular text-texto-suave">{i + 1}</TD>
                <TD className="font-medium whitespace-nowrap">{codigoInternoOt(e.codigo_interno, e.ot)}</TD>
                <TD>{siglaCarroceria(e.tipo_unidad)}</TD>
                <TD className="tabular text-right">{e.n_planos}</TD>
                <TD className="tabular text-right">{e.n_piezas}</TD>
                <TD className="min-w-48">{e.tipo_plano}</TD>
                <TD className="tabular whitespace-nowrap">{e.fecha_entrega ? fecha(e.fecha_entrega) : '—'}</TD>
                <TD><Insignia tono={e.estado === 'CULMINADO' ? 'exito' : 'aviso'}>{ESTADOS_ENTREGA[e.estado as keyof typeof ESTADOS_ENTREGA] ?? e.estado}</Insignia></TD>
                <TD className="whitespace-nowrap">{e.responsable}</TD>
                <TD className="text-xs text-texto-suave">{e.entregado_a.map((a) => AREAS_QUE_RECIBEN[a as keyof typeof AREAS_QUE_RECIBEN] ?? a).join(', ') || '—'}</TD>
                {escribe && <TD>{e.creado_por === perfil.id && <QuitarRegistro id={e.id} tabla="entrega" descripcion={`la entrega ${e.tipo_plano}`} />}</TD>}
              </TR>)}
              {datos.entregas.length > 0 && <tr className="border-t-2 border-borde-fuerte font-semibold">
                <TD colSpan={3} className="text-right">Total</TD>
                <TD className="tabular text-right">{totalPlanos}</TD>
                <TD className="tabular text-right">{totalPiezas}</TD>
                <TD colSpan={escribe ? 6 : 5} />
              </tr>}
            </tbody>
          </Tabla>
          {porArea.length > 0 && <div>
            <h3 className="text-sm font-semibold text-texto">Conclusión</h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-texto">
              {porArea.map((a) => <li key={a.area}><span className="tabular font-medium">{a.planos}</span> planos entregados a {a.nombre}.</li>)}
            </ul>
          </div>}
          {escribe && elegibles.length > 0 && <div className="rounded-[var(--radius-base)] border border-borde p-4">
            <h3 className="mb-3 text-sm font-semibold text-texto">Registrar una entrega de planos</h3>
            <FormularioEntregaPlanos ordenes={elegibles} personas={equipo.data ?? []} inicio={inicio} fin={datos.fin} />
          </div>}
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera titulo="Contenido del informe" descripcion="Las secciones del formato, en su orden. Las tablas de arriba entran solas al Word." />
        <TarjetaCuerpo className="space-y-4">
          {escribe && (!informe || ['BORRADOR', 'OBSERVADO'].includes(informe.estado))
            ? <FormularioInformeDiseno inicio={inicio} informe={informe} responsable={`${perfil.nombres} ${perfil.apellidos}`.trim()} />
            : informe
              ? <dl className="grid gap-5 sm:grid-cols-2">{([
                  ['resumen', 'Resumen'], ['incidencias', 'Problemas / incidencias'], ['acciones', 'Acciones correctivas'],
                  ['no_conformidades', 'Control de cambios y no conformidades'], ['indicadores', 'Indicadores de gestión'],
                  ['plan_siguiente', 'Plan de trabajo – semana siguiente'], ['conclusiones', 'Conclusiones y recomendaciones'],
                ] as const).map(([campo, titulo]) => <div key={campo}>
                  <dt className="text-sm font-semibold text-texto">{titulo}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-texto-suave">{informe[campo] || 'Sin observaciones'}</dd>
                </div>)}</dl>
              : <p className="text-sm text-texto-suave">El colaborador todavía no guardó el informe de esta semana.</p>}
        </TarjetaCuerpo>
      </Tarjeta>
    </div>
  </>
}
