import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { personalParaReporte, reporteDiario } from '@/lib/datos/reportes-diarios'
import { codigosInternos } from '@/lib/datos/rrhh'
import { AREA_QUE_VALIDA, DIAS_PARA_EL_REPORTE, estadoDeReporte } from '@/lib/dominio/reporte-diario'
import { hoyLima, sumarDias } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

import { FormularioReporteDiario, type OpcionPersona, type ReporteACorregir } from './formulario'

export const metadata = { title: 'Nuevo reporte diario' }

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaginaNuevoReporte({ searchParams }: PageProps<'/reportes-diarios/nuevo'>) {
  const perfil = await exigirPermiso('reporte_diario.registrar')
  const hoy = hoyLima()
  const { corrige: idCorrige } = await searchParams
  const [personal, codigos, observado] = await Promise.all([
    personalParaReporte(),
    codigosInternos(),
    typeof idCorrige === 'string' && GUID.test(idCorrige) ? reporteDiario(idCorrige, false) : Promise.resolve(null),
  ])

  // Se corrige solo un reporte propio que Gerencia o RR. HH. observaron y que
  // nadie anuló todavía: lo mismo que exige `registrar_reporte_corregido`.
  const pidioCorregir = typeof idCorrige === 'string'
  const sePuede = observado && observado.registrado_por === perfil.id && estadoDeReporte(observado) === 'OBSERVADO'
  if (pidioCorregir && !sePuede) {
    return (
      <>
        <EncabezadoPagina titulo="Corregir el reporte" migas={[{ titulo: 'Reporte diario', ruta: '/reportes-diarios' }, { titulo: 'Corregir' }]} />
        <Tarjeta className="max-w-3xl">
          <TarjetaCuerpo className="space-y-3">
            <p className="text-sm text-texto">
              {observado && observado.corregido_por
                ? 'Ese reporte ya lo corregiste y subiste de nuevo.'
                : 'Ese reporte no se puede corregir: solo se corrigen los tuyos que Gerencia o Recursos Humanos observaron.'}
            </p>
            <EnlaceBoton href={observado?.corregido_por ? `/reportes-diarios/${observado.corregido_por}` : '/reportes-diarios'} variante="contorno" tamano="sm">
              {observado?.corregido_por ? 'Ver el reporte corregido' : 'Volver a los reportes'}
            </EnlaceBoton>
          </TarjetaCuerpo>
        </Tarjeta>
      </>
    )
  }

  const corrige: ReporteACorregir | null = sePuede
    ? {
        reemplaza: observado.id,
        fecha: observado.fecha,
        codigo_interno: observado.codigo_interno,
        asunto: observado.asunto,
        descripcion: observado.descripcion,
        general: observado.personal_general,
        trabajos: observado.trabajos.map((t) => ({
          descripcion: t.descripcion,
          avance: t.avance,
          personal: observado.personal.filter((p) => p.trabajo_id === t.id).map((p) => ({ trabajador_id: p.trabajador_id, horas: p.horas })),
        })),
        personal_general: observado.personal
          .filter((p) => p.trabajo_id === null)
          .map((p) => ({ trabajador_id: p.trabajador_id, horas: p.horas })),
        fotos: observado.fotos.map((f) => ({ ruta: f.ruta, enlace: f.enlace })),
      }
    : null
  // El corregido conserva su día aunque ya pasaran los 7: la base lo deja.
  const minimo = sumarDias(hoy, -DIAS_PARA_EL_REPORTE)

  // La gente del área del supervisor primero: es la que casi siempre pone.
  const opciones: OpcionPersona[] = [...personal]
    .sort((a, b) => Number(b.area_id === perfil.area_id) - Number(a.area_id === perfil.area_id))
    .map((p) => ({
      valor: p.id,
      etiqueta: `${p.apellidos}, ${p.nombres}`,
      detalle: [p.cargo, p.area].filter(Boolean).join(' · ') || null,
    }))

  return (
    <>
      <EncabezadoPagina
        titulo={corrige ? 'Corregir el reporte' : 'Nuevo reporte diario'}
        ayuda={
          corrige
            ? 'Se abre con lo que ya subiste y sus fotos. Corrige lo observado y súbelo: el observado queda anulado con la observación como motivo, y Gerencia y Recursos Humanos validan este.'
            : 'Un reporte por código interno: qué se hizo, cuánto avanzó, quién trabajó y cuántas horas. Las horas pasan solas al costeo de Recursos Humanos.'
        }
        migas={[{ titulo: 'Reporte diario', ruta: '/reportes-diarios' }, { titulo: corrige ? 'Corregir' : 'Nuevo' }]}
      />
      {corrige && observado?.observacion && (
        <p className="mb-4 max-w-3xl rounded-lg border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-observacion>
          <span className="font-medium">Lo que observó {AREA_QUE_VALIDA[observado.observacion_area ?? 'RRHH']}:</span> {observado.observacion}
        </p>
      )}
      <Tarjeta className="max-w-3xl">
        <TarjetaCuerpo>
          <FormularioReporteDiario
            id={crypto.randomUUID()}
            cuentaId={perfil.id}
            hoy={hoy}
            minimo={corrige && corrige.fecha < minimo ? corrige.fecha : minimo}
            personal={opciones}
            codigos={codigos}
            corrige={corrige}
          />
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}
