import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { personalParaReporte } from '@/lib/datos/reportes-diarios'
import { codigosInternos } from '@/lib/datos/rrhh'
import { DIAS_PARA_EL_REPORTE } from '@/lib/dominio/reporte-diario'
import { hoyLima, sumarDias } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

import { FormularioReporteDiario, type OpcionPersona } from './formulario'

export const metadata = { title: 'Nuevo reporte diario' }

export default async function PaginaNuevoReporte() {
  const perfil = await exigirPermiso('reporte_diario.registrar')
  const hoy = hoyLima()
  const [personal, codigos] = await Promise.all([personalParaReporte(), codigosInternos()])

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
        titulo="Nuevo reporte diario"
        descripcion="Un reporte por código interno: qué se hizo, cuánto avanzó, quién trabajó y cuántas horas. Las horas pasan solas al costeo de Recursos Humanos."
        migas={[{ titulo: 'Reporte diario', ruta: '/reportes-diarios' }, { titulo: 'Nuevo' }]}
      />
      <Tarjeta className="max-w-3xl">
        <TarjetaCuerpo>
          <FormularioReporteDiario
            cuentaId={perfil.id}
            hoy={hoy}
            minimo={sumarDias(hoy, -DIAS_PARA_EL_REPORTE)}
            personal={opciones}
            codigos={codigos}
          />
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}
