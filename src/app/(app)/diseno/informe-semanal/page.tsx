import Link from 'next/link'
import { Download } from 'lucide-react'

import { DelDocumento } from '@/components/estructura/del-documento'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { BASE_BOTON, Boton, TAMANOS, VARIANTES } from '@/components/ui/boton'
import { Insignia, type Tono } from '@/components/ui/etiqueta-estado'
import { Recorrido } from '@/components/ui/recorrido'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { datosInformeDiseno, semanasPropiasDiseno } from '@/lib/datos/informe-diseno'
import { recorridoDeInformesDiseno } from '@/lib/datos/recorrido'
import {
  AREAS_QUE_RECIBEN, ESTADOS_ENTREGA, FORMATO_INFORME_DISENO, codigoInternoOt, fechaDelInforme, nombreTarea,
  numeroInforme, planosPorArea, siglaCarroceria,
} from '@/lib/dominio/informe-diseno'
import { describirRecorridoDelInformeDiseno } from '@/lib/dominio/recorrido'
import { inicioSemanaDiseno } from '@/lib/dominio/semana-diseno'
import { fecha, fechaHora, hoyLima } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import {
  DecisionInforme, FormularioInformeDiseno, FormularioTareaDiseno, QuitarRegistro, type OrdenElegible,
} from './formularios'

export const metadata = { title: 'Informe semanal · Diseño e Ingeniería' }
const ESTADOS: Record<string, string> = {
  BORRADOR: 'Borrador del colaborador', EN_REVISION: 'Pendiente de revisión de Diseño', OBSERVADO: 'Devuelto para corregir',
  // RECIBIDO quedó del circuito anterior, cuando el informe iba a Administración.
  APROBADO: 'Aprobado por Diseño', RECIBIDO: 'Recibido por Administración',
}
// La insignia de cada semana en «Tus semanas»: corta, con el tono de lo que pide.
const INSIGNIA_ESTADO: Record<string, { etiqueta: string; tono: Tono }> = {
  BORRADOR: { etiqueta: 'Borrador', tono: 'neutro' },
  EN_REVISION: { etiqueta: 'Enviado a Diseño', tono: 'info' },
  OBSERVADO: { etiqueta: 'Devuelto', tono: 'aviso' },
  APROBADO: { etiqueta: 'Aprobado', tono: 'exito' },
  RECIBIDO: { etiqueta: 'Recibido', tono: 'exito' },
}

export default async function PaginaInformeSemanalDiseno({ searchParams }: {
  searchParams: Promise<{ semana?: string }>
}) {
  const perfil = await exigirPermiso(['diseno.planos', 'diseno.subir_pdf', 'supervision.general'])
  const parametros = await searchParams
  let inicio = inicioSemanaDiseno(hoyLima())
  if (parametros.semana) {
    try { inicio = inicioSemanaDiseno(parametros.semana) } catch { /* Mostrar la semana actual si la URL no es válida. */ }
  }
  const puedeEscribir = puede(perfil, 'diseno.preparar_informe')
  const db = await createClient()
  const [datos, equipo, pendientes, semanas] = await Promise.all([
    datosInformeDiseno(inicio),
    puedeEscribir
      ? db.from('ot_equipo_diseno').select('id,orden_id,nombre,funcion').eq('funcion', 'COLABORADOR').order('nombre').limit(1000)
      : Promise.resolve({ data: [], error: null }),
    puede(perfil, 'diseno.revisar_informe')
      ? db.from('diseno_informes').select('id,numero,semana_inicio,estado')
        .eq('estado', 'EN_REVISION')
        .order('semana_inicio').limit(100)
      : Promise.resolve({ data: [], error: null }),
    // Las semanas del colaborador, para abrirlas en lectura. Si no se leen, la
    // pantalla sigue con la semana elegida y lo dice en su lugar.
    puedeEscribir
      ? semanasPropiasDiseno().catch((e: unknown) => {
          console.error('Informe semanal: no se pudieron leer las semanas propias.', e)
          return null
        })
      : Promise.resolve([]),
  ])
  if (equipo.error || pendientes.error) throw new Error('No se pudieron cargar el equipo o los informes pendientes de Diseño.')

  const informe = datos.informe
  // El recorrido de la semana: por dónde pasó, quién lo tiene y hace cuántos
  // días. Sale a la par con las OT del equipo. Sin él, la tarjeta sigue con
  // todo lo demás y lo dice en su lugar.
  const leyendoRecorrido = informe
    ? recorridoDeInformesDiseno([informe.id])
        .then((r) => describirRecorridoDelInformeDiseno(r.get(informe.id) ?? []))
        .catch((e: unknown) => {
          console.error('Informe semanal: no se pudo leer el recorrido.', e)
          return null
        })
    : Promise.resolve([])

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

  const recorrido = await leyendoRecorrido
  // La última devolución: quién y cuándo, para el aviso de arriba.
  const devolucion = informe?.estado === 'OBSERVADO' ? recorrido?.filter((p) => p.paso === 'DEVOLUCION').at(-1) : undefined
  // Lo que espera al colaborador en otras semanas: las devueltas y los
  // borradores de semanas que ya pasaron. La que está viendo ya lo dice arriba.
  const semanaDeHoy = inicioSemanaDiseno(hoyLima())
  const porTerminar = (semanas ?? []).filter((s) => s.semana_inicio !== inicio
    && (s.estado === 'OBSERVADO' || (s.estado === 'BORRADOR' && (s.semana_inicio ?? '') < semanaDeHoy)))
  // «Te devolvió» solo a quien hizo el informe (lo empezó o anotó en su
  // semana); otro colaborador que abre la semana por su dirección lo lee neutro.
  const esMio = puedeEscribir && (semanas === null || semanas.some((s) => s.id === informe?.id))
  const abierta = !datos.enviado
  const escribe = puedeEscribir && abierta
  const disenadores = [...new Set([...datos.tareas.map((t) => t.responsable), ...datos.entregas.map((e) => e.responsable)])].sort()
  const porArea = planosPorArea(datos.entregas)
  const totalPlanos = datos.entregas.reduce((s, e) => s + e.n_planos, 0)
  const totalPiezas = datos.entregas.reduce((s, e) => s + e.n_piezas, 0)

  return <>
    <EncabezadoPagina titulo="Informe semanal de Diseño e Ingeniería"
      ayuda={`Formato ${FORMATO_INFORME_DISENO.codigo}. Lo llena el colaborador y lo aprueba Diseño.`}
      acciones={informe && <a href={`/diseno/informe-semanal/descargar?semana=${inicio}`} download
        className={cn(BASE_BOTON, VARIANTES.secundario, TAMANOS.md)}>
        <Download aria-hidden className="size-4" /> Descargar Word
      </a>} />
    {/* La semana la elige la búsqueda: con otra, los formularios se montan de
        nuevo y dicen de cuál son (X1 y H1, cuadragésima quinta pasada). */}
    <DelDocumento documento={`semana:${inicio}`}>
    <div className="space-y-5">
      {/* Devuelto: el motivo va arriba de todo, que es lo que hay que corregir. */}
      {informe?.estado === 'OBSERVADO' && <div role="note" data-motivo-devolucion
        className="rounded-[var(--radius-base)] border border-aviso/40 bg-aviso-suave p-4 text-sm">
        <p className="font-semibold text-aviso">
          {esMio ? 'Diseño te devolvió este informe para corregir'
            : puedeEscribir ? 'Diseño devolvió este informe para corregir' : 'Devuelto al colaborador para corregir'}
        </p>
        <p className="mt-1 max-w-prose whitespace-pre-wrap break-words text-texto">
          {informe.observacion_revision?.trim() || 'Diseño no dejó escrito el motivo.'}
        </p>
        <p className="tabular mt-2 text-xs text-texto-suave">
          {devolucion?.puesto ?? 'Diseño'}{(devolucion?.en ?? informe.revisado_en) ? ` · ${fechaHora((devolucion?.en ?? informe.revisado_en)!)}` : ''}
        </p>
        {puedeEscribir && <p className="mt-2 max-w-prose text-texto">
          Corrige lo que pide en <a href="#actividades-diarias" className="font-medium text-acento underline-offset-2 hover:underline">Actividades diarias</a> o
          en <a href="#contenido-del-informe" className="font-medium text-acento underline-offset-2 hover:underline">Contenido del informe</a>,
          guárdalo con «Guardar informe» y vuelve a enviarlo con «Enviar a Diseño».
        </p>}
      </div>}

      {porTerminar.length > 0 && <Tarjeta data-por-terminar>
        <TarjetaCabecera titulo="Tus informes por terminar"
          descripcion={`${porTerminar.length} ${porTerminar.length === 1 ? 'semana' : 'semanas'}`}
          ayuda="Los que Diseño te devolvió para corregir y los borradores de semanas que ya pasaron sin enviarse." />
        <TarjetaCuerpo className="flex flex-wrap gap-3">{porTerminar.map((s) =>
          <Link key={s.id} href={`/diseno/informe-semanal?semana=${s.semana_inicio}`}
            className="inline-flex min-h-11 flex-wrap items-center gap-2 rounded-[var(--radius-base)] border border-borde px-4 py-3 text-sm font-medium text-acento hover:bg-acento-suave">
            <span className="tabular">Informe N.º {numeroInforme(s.numero)} · semana del {fecha(s.semana_inicio)}</span>
            <Insignia tono={INSIGNIA_ESTADO[s.estado ?? '']?.tono ?? 'neutro'}>{INSIGNIA_ESTADO[s.estado ?? '']?.etiqueta ?? s.estado}</Insignia>
          </Link>)}</TarjetaCuerpo>
      </Tarjeta>}

      {(pendientes.data ?? []).length > 0 && <Tarjeta>
        <TarjetaCabecera titulo={puede(perfil, 'diseno.revisar_informe') ? 'Informes por revisar' : 'Informes aprobados por recibir'} ayuda="Abre la semana correspondiente para completar tu revisión." />
        <TarjetaCuerpo className="flex flex-wrap gap-3">{(pendientes.data ?? []).map((p) =>
          <Link key={p.id} href={`/diseno/informe-semanal?semana=${p.semana_inicio}`}
            className="min-h-11 rounded-[var(--radius-base)] border border-borde px-4 py-3 text-sm font-medium text-acento hover:bg-acento-suave">
            Informe N.º {numeroInforme(p.numero)} · semana del {fecha(p.semana_inicio)}
          </Link>)}</TarjetaCuerpo>
      </Tarjeta>}

      <Tarjeta>
        <TarjetaCabecera titulo="Semana del informe" ayuda="Elige cualquier día de la semana que quieres ver." />
        <TarjetaCuerpo>
          <form action="/diseno/informe-semanal" className="flex flex-wrap items-end gap-3">
            <label htmlFor="semana-diseno" className="grid gap-1 text-sm font-medium text-texto">
              Día de la semana
              <input id="semana-diseno" name="semana" type="date" defaultValue={inicio}
                className="rounded-[var(--radius-base)] border border-borde-fuerte bg-superficie px-3 py-2 text-texto" />
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
            {/* El motivo de la devolución va en el aviso de arriba; aquí, el camino entero. */}
            <Recorrido pasos={recorrido} relleno="px-3"
              className="rounded-[var(--radius-base)] border border-borde bg-superficie" />
            {puedeEscribir && ['BORRADOR', 'OBSERVADO'].includes(informe.estado) && <DecisionInforme id={informe.id} estado="EN_REVISION" />}
            {puede(perfil, 'diseno.revisar_informe') && informe.estado === 'EN_REVISION' && <div className="space-y-4">
              <DecisionInforme id={informe.id} estado="APROBADO" />
              <Pliegue titulo="Devolver con observaciones"><DecisionInforme id={informe.id} estado="OBSERVADO" /></Pliegue>
            </div>}
          </div>}
          {!abierta && puedeEscribir && <p className="mt-3 text-sm text-texto-suave">El informe ya se envió: las tablas muestran lo que se envió y no se pueden cambiar salvo que Diseño lo devuelva.</p>}
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta id="actividades-diarias" className="scroll-mt-20">
        <TarjetaCabecera titulo="Actividades diarias"
          ayuda="Lo que se hizo cada día, según el requerimiento del día y la urgencia: sin planificar y sin atarlo a los planos. Todas las unidades tienen código interno; las de garantía o mantenimiento, su OT." />
        <TarjetaCuerpo className="space-y-4">
          <p className="text-sm text-texto"><span className="font-medium">Diseñadores:</span> {disenadores.length ? disenadores.join(', ') : 'Todavía nadie registró trabajo esta semana.'}</p>
          {/* El vacío va fuera de la tabla, y en el teléfono la tabla deja sus
              columnas esenciales: con ocho se deslizaba de costado y el aviso
              se cortaba en «Aún no hay pla» (auditoría del 27/10/2026). */}
          {datos.tareas.length === 0 ? (
            <SinDatos enTabla={false} titulo="Aún no hay actividades esta semana" descripcion={escribe ? 'Anota la de hoy con el formulario de abajo.' : undefined} />
          ) : (
          <Tabla>
            <TablaCabecera><tr>
              <TH className="hidden w-10 sm:table-cell">Ítem</TH><TH>Código interno / OT</TH><TH className="hidden sm:table-cell">Tipo</TH><TH>Actividad</TH><TH className="hidden md:table-cell">Componente</TH>
              <TH className="hidden md:table-cell">Día</TH><TH className="hidden md:table-cell">Responsable</TH>{escribe && <TH className="w-12" aria-label="Quitar" />}
            </tr></TablaCabecera>
            <tbody>
              {datos.tareas.map((t, i) => <TR key={t.id}>
                <TD className="tabular hidden text-texto-suave sm:table-cell">{i + 1}</TD>
                <TD className="font-medium break-all sm:break-normal sm:whitespace-nowrap">{codigoInternoOt(t.codigo_interno, t.ot)}</TD>
                <TD className="hidden sm:table-cell">{siglaCarroceria(t.tipo_unidad)}</TD>
                <TD className="sm:whitespace-nowrap">
                  {nombreTarea(t.tipo)}
                  {/* En el teléfono el día va debajo, para que no se esconda. */}
                  <span className="tabular block text-xs text-texto md:hidden">{t.fecha_inicio === t.fecha_entrega ? fecha(t.fecha_inicio) : `${fecha(t.fecha_inicio)} al ${fecha(t.fecha_entrega)}`}</span>
                  {/* Lo que en el monitor tiene columna propia. */}
                  <span className="block text-xs text-texto-suave md:hidden">{t.componente} · {t.responsable}</span>
                  {t.observacion && <span className="block text-xs text-texto-suave md:hidden">{t.observacion}</span>}
                </TD>
                <TD className="hidden min-w-48 md:table-cell">{t.componente}{t.observacion && <span className="block text-xs text-texto-suave">{t.observacion}</span>}</TD>
                {/* Las de antes, planificadas, dicen las dos fechas. */}
                <TD className="tabular hidden whitespace-nowrap md:table-cell">{t.fecha_inicio === t.fecha_entrega ? fecha(t.fecha_inicio) : `${fecha(t.fecha_inicio)} al ${fecha(t.fecha_entrega)}`}</TD>
                <TD className="hidden whitespace-nowrap md:table-cell">{t.responsable}</TD>
                {escribe && <TD>{t.creado_por === perfil.id && <QuitarRegistro id={t.id} tabla="tarea" descripcion={`la actividad ${t.componente}`} />}</TD>}
              </TR>)}
            </tbody>
          </Tabla>
          )}
          {escribe && (elegibles.length
            ? <div className="rounded-[var(--radius-base)] border border-borde p-4"><h3 className="mb-3 text-sm font-semibold text-texto">Anotar una actividad</h3>
                <FormularioTareaDiseno ordenes={elegibles} personas={equipo.data ?? []} hoy={hoyLima()} /></div>
            : <p className="text-sm text-texto-suave">No hay OT con colaboradores de Diseño en su equipo. Diseño los agrega en la pestaña Planos de cada OT, en «Personas que elaboran los planos».</p>)}
        </TarjetaCuerpo>
      </Tarjeta>

      {/* El avance de planos ya no lo lleva el colaborador: los planos los sube el
          encargado cuando están revisados. Queda a la vista en las semanas de antes. */}
      {datos.entregas.length > 0 && <Tarjeta>
        <TarjetaCabecera titulo="Avance de planos o culminación"
          ayuda="Lo que se registró antes de que los planos los subiera solo el encargado de Diseño. Ya no se anota aquí." />
        <TarjetaCuerpo className="space-y-4">
          <Tabla>
            <TablaCabecera><tr>
              <TH className="hidden w-10 sm:table-cell">Ítem</TH><TH>Código interno / OT</TH><TH className="hidden sm:table-cell">Tipo</TH><TH className="text-right">N.º planos</TH>
              <TH className="hidden text-right sm:table-cell">N.º piezas</TH><TH className="hidden md:table-cell">Tipo de plano</TH><TH className="hidden md:table-cell">Entrega</TH><TH>Estado</TH><TH className="hidden md:table-cell">Responsable</TH><TH className="hidden md:table-cell">Entregado a</TH>
              {escribe && <TH className="w-12" aria-label="Quitar" />}
            </tr></TablaCabecera>
            <tbody>
              {datos.entregas.map((e, i) => <TR key={e.id}>
                <TD className="tabular hidden text-texto-suave sm:table-cell">{i + 1}</TD>
                <TD className="font-medium sm:whitespace-nowrap">
                  {codigoInternoOt(e.codigo_interno, e.ot)}
                  <span className="block text-xs font-normal text-texto-suave md:hidden">{e.tipo_plano} · {e.responsable}{e.fecha_entrega ? ` · ${fecha(e.fecha_entrega)}` : ''}</span>
                  {e.entregado_a.length > 0 && (
                    <span className="block text-xs font-normal text-texto-suave md:hidden">
                      Entregado a {e.entregado_a.map((a) => AREAS_QUE_RECIBEN[a as keyof typeof AREAS_QUE_RECIBEN] ?? a).join(', ')}
                    </span>
                  )}
                </TD>
                <TD className="hidden sm:table-cell">{siglaCarroceria(e.tipo_unidad)}</TD>
                <TD className="tabular text-right">{e.n_planos}</TD>
                <TD className="tabular hidden text-right sm:table-cell">{e.n_piezas}</TD>
                <TD className="hidden min-w-48 md:table-cell">{e.tipo_plano}</TD>
                <TD className="tabular hidden whitespace-nowrap md:table-cell">{e.fecha_entrega ? fecha(e.fecha_entrega) : '—'}</TD>
                <TD><Insignia tono={e.estado === 'CULMINADO' ? 'exito' : 'aviso'}>{ESTADOS_ENTREGA[e.estado as keyof typeof ESTADOS_ENTREGA] ?? e.estado}</Insignia></TD>
                <TD className="hidden whitespace-nowrap md:table-cell">{e.responsable}</TD>
                <TD className="hidden text-xs text-texto-suave md:table-cell">{e.entregado_a.map((a) => AREAS_QUE_RECIBEN[a as keyof typeof AREAS_QUE_RECIBEN] ?? a).join(', ') || '—'}</TD>
                {escribe && <TD>{e.creado_por === perfil.id && <QuitarRegistro id={e.id} tabla="entrega" descripcion={`la entrega ${e.tipo_plano}`} />}</TD>}
              </TR>)}
              <tr className="border-t-2 border-borde-fuerte font-semibold">
                {/* El total cuenta las columnas que se ven en cada ancho. */}
                <TD colSpan={3} className="hidden text-right sm:table-cell">Total</TD>
                <TD className="text-right sm:hidden">Total</TD>
                <TD className="tabular text-right">{totalPlanos}</TD>
                <TD className="tabular hidden text-right sm:table-cell">{totalPiezas}</TD>
                <TD colSpan={escribe ? 6 : 5} />
              </tr>
            </tbody>
          </Tabla>
          {porArea.length > 0 && <div>
            <h3 className="text-sm font-semibold text-texto">Conclusión</h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-texto">
              {porArea.map((a) => <li key={a.area}><span className="tabular font-medium">{a.planos}</span> planos entregados a {a.nombre}.</li>)}
            </ul>
          </div>}
        </TarjetaCuerpo>
      </Tarjeta>}

      <Tarjeta id="contenido-del-informe" className="scroll-mt-20">
        <TarjetaCabecera titulo="Contenido del informe" ayuda="Las secciones del formato, en su orden. Las tablas de arriba entran solas al Word." />
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

      {/* Para consultar, al final: las semanas del colaborador, cada una como quedó. */}
      {puedeEscribir && <Tarjeta data-tus-semanas>
        <TarjetaCabecera titulo="Tus semanas"
          ayuda="Las semanas con informe guardado que empezaste o en las que anotaste una actividad, de la más reciente a la más antigua. Las enviadas y las aprobadas se abren solo para leer; las devueltas y los borradores, para seguir con ellos." />
        <TarjetaCuerpo>
          {semanas === null
            ? <p role="status" className="text-sm text-aviso">No se pudieron leer tus semanas. Recarga la página; si continúa, avisa al administrador.</p>
            : semanas.length === 0
              ? <SinDatos compacto titulo="Todavía no tienes semanas"
                  descripcion="Cuando guardes tu primer informe con «Guardar informe», su semana aparecerá aquí." />
              : <ul className="-mx-2 divide-y divide-borde">{semanas.map((s) => {
                  const actual = s.semana_inicio === inicio
                  const insignia = INSIGNIA_ESTADO[s.estado ?? ''] ?? { etiqueta: s.estado ?? 'Sin estado', tono: 'neutro' as const }
                  return <li key={s.id}>
                    <Link href={`/diseno/informe-semanal?semana=${s.semana_inicio}`} aria-current={actual ? 'page' : undefined}
                      className={cn('flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[var(--radius-base)] px-2 py-2 text-sm hover:bg-superficie-2 focus-visible:outline-2 focus-visible:outline-acento',
                        actual && 'bg-acento-suave hover:bg-acento-suave')}>
                      <span className="min-w-0">
                        <span className="tabular font-semibold text-acento">N.º {numeroInforme(s.numero)}</span>
                        <span className="tabular text-texto"> · semana del {fecha(s.semana_inicio)}</span>
                        {actual && <span className="block text-xs text-texto-suave sm:inline"><span className="hidden sm:inline"> · </span>la que estás viendo</span>}
                      </span>
                      <Insignia tono={insignia.tono}>{insignia.etiqueta}</Insignia>
                    </Link>
                  </li>
                })}</ul>}
        </TarjetaCuerpo>
      </Tarjeta>}
    </div>
    </DelDocumento>
  </>
}
