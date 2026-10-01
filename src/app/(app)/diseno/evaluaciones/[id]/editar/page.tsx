import { notFound, redirect } from 'next/navigation'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { nombresDelEquipoDeDiseno, obtenerEvaluacionDiseno } from '@/lib/datos/evaluaciones-diseno'
import { hoyLima } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'
import { FormularioEvaluacion } from '../../formulario'

export const metadata = { title: 'Corregir evaluación · Diseño e Ingeniería' }

export default async function PaginaCorregirEvaluacion({ params }: PageProps<'/diseno/evaluaciones/[id]/editar'>) {
  const perfil = await exigirPermiso('diseno.evaluar')
  const { id } = await params
  const [e, nombres] = await Promise.all([obtenerEvaluacionDiseno(id), nombresDelEquipoDeDiseno()])
  if (!e) notFound()
  // Enviada o recibida ya no se corrige; la base lo rechazaría igual.
  if (e.evaluador_id !== perfil.id || (e.estado !== 'BORRADOR' && e.estado !== 'OBSERVADA')) {
    redirect(`/diseno/evaluaciones/${id}`)
  }
  return (
    <>
      <EncabezadoPagina
        migas={[
          { titulo: 'Evaluación de desempeño', ruta: '/diseno/evaluaciones' },
          { titulo: e.evaluado_nombre, ruta: `/diseno/evaluaciones/${id}` },
          { titulo: 'Corregir' },
        ]}
        titulo={`Corregir la evaluación de ${e.evaluado_nombre}`}
        descripcion={e.estado === 'OBSERVADA' && e.observacion
          ? `Administración pidió: «${e.observacion}». Después de guardar, reenvíala desde su ficha.`
          : 'Sigue en borrador: después de guardar, envíala desde su ficha.'}
      />
      <Tarjeta>
        <TarjetaCuerpo>
          <FormularioEvaluacion
            hoy={hoyLima()}
            cargo={perfil.cargo ?? ''}
            nombres={nombres}
            inicial={{
              id: e.id,
              evaluado_nombre: e.evaluado_nombre,
              puesto: e.puesto,
              area_servicio: e.area_servicio,
              evaluador_cargo: e.evaluador_cargo,
              fecha_ingreso: e.fecha_ingreso,
              fecha_evaluacion: e.fecha_evaluacion,
              respuestas: e.respuestas,
              comentarios: e.comentarios,
            }}
          />
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}
