import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { nombresDelEquipoDeDiseno } from '@/lib/datos/evaluaciones-diseno'
import { hoyLima } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'
import { FormularioEvaluacion } from '../formulario'

export const metadata = { title: 'Nueva evaluación · Diseño e Ingeniería' }

export default async function PaginaNuevaEvaluacion() {
  const perfil = await exigirPermiso('diseno.evaluar')
  const nombres = await nombresDelEquipoDeDiseno()
  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Evaluación de desempeño', ruta: '/diseno/evaluaciones' }, { titulo: 'Nueva' }]}
        titulo="Nueva evaluación de desempeño"
        descripcion="Se guarda como borrador: la revisas en su ficha y desde ahí la envías a Administración."
      />
      <Tarjeta>
        <TarjetaCuerpo>
          <FormularioEvaluacion hoy={hoyLima()} cargo={perfil.cargo ?? ''} nombres={nombres} />
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}
