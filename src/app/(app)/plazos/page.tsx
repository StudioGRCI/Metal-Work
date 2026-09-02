import Link from 'next/link'
import { AlertTriangle, CalendarClock, CircleCheck } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Indicador } from '@/components/ui/indicador'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { ESTADO_PLAZO } from '@/lib/dominio/estados'
import { fecha, moneda } from '@/lib/format'
import { plazosPorArea, resumenDePlazos } from '@/lib/datos/plazos'
import { exigirPermiso, puede } from '@/lib/sesion'

import { Reporte } from './reporte'

export const metadata = { title: 'Control de plazos' }


/**
 * El control de plazos por área.
 *
 * Es el `CONTROL DE PLAZOS - MWP - 2026.xlsx` de la empresa —siete hojas, una
 * por área— convertido en una sola pantalla con el área como filtro. La
 * pregunta que se hace Gerencia, «¿qué está vencido?», cruza las siete hojas: en
 * el Excel hay que abrirlas una por una y sumar a ojo.
 *
 * La responsabilidad es del área y no de una persona —un área es siempre un
 * equipo— así que acá no se nombra a nadie: se agrupa por área. Y la ve
 * cualquiera que pueda ver órdenes o producción: que Maestranza vea que Diseño
 * la tiene trabada es justamente el punto.
 */
export default async function PaginaPlazos({ searchParams }: PageProps<'/plazos'>) {
  const perfil = await exigirPermiso(['ordenes.ver', 'produccion.ver'])
  const params = await searchParams

  const area = typeof params.area === 'string' ? params.area : undefined
  const plazo = typeof params.plazo === 'string' ? params.plazo : undefined

  const [filas, resumen] = await Promise.all([
    plazosPorArea({ area, plazo }),
    resumenDePlazos(),
  ])

  const puedeReportar = puede(perfil, 'produccion.registrar')
  const puedeVerificar = puede(perfil, 'ordenes.editar')

  // Las cuentas salen del resumen y no de `filas`: si contaran lo filtrado,
  // encender «Vencido» dejaría las demás pastillas en cero y parecería que no
  // hay nada en ellas.
  const vencidas = resumen.porPlazo.VENCIDO ?? 0
  const porVencer = resumen.porPlazo.POR_VENCER ?? 0
  const vigentes = resumen.porPlazo.VIGENTE ?? 0

  const filtrosArea = [
    { valor: null, etiqueta: resumen.total > 0 ? `Todas (${resumen.total})` : 'Todas' },
    ...resumen.areas.map((a) => ({
      valor: a.codigo,
      // La cuenta de vencidas va delante del total porque es lo que decide a
      // cuál entrar: «Maestranza 15/15» se lee de un vistazo.
      etiqueta: a.vencidas > 0 ? `${a.nombre} ${a.vencidas}/${a.total}` : `${a.nombre} (${a.total})`,
    })),
  ]

  const filtrosPlazo = [
    { valor: null, etiqueta: 'Todo', clave: 'plazo' },
    ...(vencidas > 0 ? [{ valor: 'VENCIDO', etiqueta: `Vencido (${vencidas})`, clave: 'plazo' }] : []),
    ...(porVencer > 0
      ? [{ valor: 'POR_VENCER', etiqueta: `Por vencer (${porVencer})`, clave: 'plazo' }]
      : []),
    ...(vigentes > 0 ? [{ valor: 'VIGENTE', etiqueta: `Vigente (${vigentes})`, clave: 'plazo' }] : []),
  ]

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Control de plazos' }]}
        titulo="Control de plazos"
        descripcion="En qué va cada área y qué la trabó. El plazo se cuenta contra la fecha de culminación de la etapa: vigente si faltan siete días o más, por vencer entre uno y seis, vencido si ya pasó."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador
          titulo="Vencidas"
          valor={vencidas}
          icono={AlertTriangle}
          tono={vencidas > 0 ? 'peligro' : 'neutro'}
          pie="La fecha ya pasó"
          href="/plazos?plazo=VENCIDO"
        />
        <Indicador
          titulo="Por vencer"
          valor={porVencer}
          icono={CalendarClock}
          tono={porVencer > 0 ? 'aviso' : 'neutro'}
          pie="Menos de una semana"
          href="/plazos?plazo=POR_VENCER"
        />
        <Indicador
          titulo="Vigentes"
          valor={vigentes}
          icono={CircleCheck}
          tono="neutro"
          pie="Con siete días o más"
          href="/plazos?plazo=VIGENTE"
        />
      </div>

      <PastillaFiltro
        ruta="/plazos"
        clave="area"
        opciones={filtrosArea}
        params={params}
        activo={area ?? null}
        etiqueta="Filtrar por área"
        className="mt-4"
      />

      <PastillaFiltro
        ruta="/plazos"
        clave="plazo"
        opciones={filtrosPlazo}
        params={params}
        activo={plazo ?? null}
        etiqueta="Filtrar por plazo"
        className="mt-2 mb-4"
      />

      <Tarjeta className="overflow-hidden">
        <div className="overflow-x-auto">
          <Tabla>
            <TablaCabecera>
              <TR>
                <TH>Unidad</TH>
                <TH className="hidden lg:table-cell">Área</TH>
                <TH>Etapa</TH>
                <TH className="hidden sm:table-cell">Programado</TH>
                <TH className="text-right">Días</TH>
                <TH>Plazo</TH>
                <TH className="w-72">Lo que reporta el área</TH>
              </TR>
            </TablaCabecera>
            <tbody>
              {filas.length === 0 ? (
                <SinDatos
                  colSpan={7}
                  titulo={
                    resumen.total === 0
                      ? 'Todavía no hay etapas que controlar'
                      : 'Nada con ese filtro'
                  }
                  descripcion={
                    resumen.total === 0
                      ? 'Cuando se apruebe una orden de trabajo, sus catorce etapas aparecen acá con la fecha que salió del tiempo por área de la cotización.'
                      : 'Prueba con otra área o con otro plazo.'
                  }
                />
              ) : (
                filas.map((f) => {
                  const semaforo = f.plazo ? ESTADO_PLAZO[f.plazo] : null
                  const dias = f.dias
                  const cerrada = f.plazo === 'CUMPLIDO' || f.plazo === 'CUMPLIDO_TARDE'

                  return (
                    <TR key={f.etapa_id}>
                      <TD>
                        <Link
                          href={`/ordenes/${f.orden_id}`}
                          className="font-medium text-acento hover:underline"
                        >
                          {f.orden_numero}
                        </Link>
                        <p className="max-w-64 truncate text-[11px] text-texto-suave">
                          {f.unidad}
                        </p>
                        {/* El código interno es como la empresa nombra la unidad
                            en todas sus hojas; la placa muchas veces todavía no
                            existe. */}
                        <p className="text-[11px] text-texto-tenue">
                          {f.codigo_interno ?? f.placa ?? f.cliente}
                        </p>
                      </TD>

                      <TD className="hidden lg:table-cell">
                        <span className="text-sm text-texto">{f.area_nombre ?? '—'}</span>
                        {f.area_encargado && (
                          <p className="text-[11px] text-texto-tenue">{f.area_encargado}</p>
                        )}
                      </TD>

                      {/* Bajo el nombre del área, lo que le toca de esta unidad.
                          Es lo que convierte «Maestranza va tarde» en «Maestranza
                          va tarde y tiene doce cosas por habilitar»: sin la cifra,
                          el semáforo dice que hay un problema pero no su tamaño. */}
                      <TD className="max-w-44">
                        <p className="text-sm text-texto-suave">{f.etapa_nombre}</p>
                        {(f.material_lineas ?? 0) > 0 && (
                          <p className="text-[11px] text-texto-tenue">
                            {f.material_lineas}
                            {f.material_lineas === 1 ? ' línea · ' : ' líneas · '}
                            {moneda(Number(f.material_monto ?? 0), 'PEN')}
                          </p>
                        )}
                      </TD>

                      <TD className="hidden text-xs whitespace-nowrap text-texto-suave sm:table-cell">
                        {fecha(f.fecha_inicio_programada) ?? '—'}
                        {' → '}
                        {fecha(f.fecha_fin_programada) ?? '—'}
                      </TD>

                      <TD className="tabular text-right whitespace-nowrap">
                        {cerrada || dias === null ? (
                          <span className="text-texto-tenue">—</span>
                        ) : (
                          <span
                            className={
                              dias < 0 ? 'font-medium text-peligro' : dias < 7 ? 'text-aviso' : ''
                            }
                          >
                            {dias < 0 ? `${dias}` : `+${dias}`}
                          </span>
                        )}
                      </TD>

                      <TD>
                        {semaforo ? (
                          <Insignia tono={semaforo.tono}>{semaforo.etiqueta}</Insignia>
                        ) : (
                          <span className="text-[11px] text-texto-tenue">Sin fecha</span>
                        )}
                      </TD>

                      <TD>
                        <Reporte
                          etapaId={f.etapa_id as string}
                          ordenId={f.orden_id as string}
                          ultimo={f.ultimo_reporte}
                          reportadoEn={f.ultimo_reporte_en}
                          verificadoEn={f.ultimo_reporte_verificado_en}
                          reporteId={f.ultimo_reporte_id}
                          puedeReportar={puedeReportar}
                          puedeVerificar={puedeVerificar}
                        />
                      </TD>
                    </TR>
                  )
                })
              )}
            </tbody>
          </Tabla>
        </div>
      </Tarjeta>
    </>
  )
}
