import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { SeccionesDelDocumento } from '@/components/estructura/secciones-del-documento'
import { Indicador } from '@/components/ui/indicador'
import { codigosDeDiseno } from '@/lib/datos/diseno-codigos'
import { normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { VISTAS_SEGUIMIENTO, vistaSeguimientoValida } from '@/lib/dominio/diseno-codigos'
import { exigirPermiso, puede } from '@/lib/sesion'

import { VistaEtapas, VistaMateriales, VistaPlanos } from '../../codigos-internos/detalle/vistas-diseno'

export const metadata = { title: 'Código interno · Seguimiento' }

/**
 * Un código interno a la vista de Supervisión general y Almacén, sin la OT
 * (migración 20261016110000): las etapas con su avance, la lista de materiales
 * contra lo pedido, lo comprado y lo salido, y los planos de cada área. Lo abre
 * también el supervisor de un área desde «Planos y etapas», para ver los
 * materiales y lo pedido del código; a él la base le muestra solo los planos de
 * su área. Solo lectura: lo escriben Diseño y el supervisor del área.
 */
export default async function PaginaSeguimientoDeCodigo({ searchParams }: PageProps<'/seguimiento/codigo'>) {
  const perfil = await exigirPermiso(['codigos_internos.seguimiento', 'codigos_internos.area'])
  const params = await searchParams
  const codigo = typeof params.codigo === 'string' ? normalizarCodigo(params.codigo) : ''
  if (codigo.length < 2 || codigo.length > 60 || codigo === 'PLANTA') notFound()
  const vista = vistaSeguimientoValida(params.vista)
  const sigue = puede(perfil, 'codigos_internos.seguimiento')

  // La lista de códigos es de quien sigue todos; el supervisor llega desde lo de su área.
  const resumen = sigue ? (await codigosDeDiseno()).find((c) => c.codigo === codigo) : undefined
  const volver = sigue
    ? { titulo: 'Seguimiento por código', ruta: vista === 'etapas' ? '/seguimiento' : `/seguimiento?vista=${vista}` }
    : { titulo: 'Planos y etapas', ruta: '/planos' }

  return (
    <>
      <EncabezadoPagina
        titulo={<span className="font-mono break-all">{codigo}</span>}
        descripcion={resumen?.unidad ?? undefined}
        migas={[volver, { titulo: codigo }]}
      />

      <div className="space-y-5">
        {/* La misma fila que el código interno y la OT (entrega 2 del plan de
            orden y diseño): arriba de las cifras, pegada bajo la barra al
            deslizar, y cada sección baja a donde empieza. Antes, pastillas. */}
        <SeccionesDelDocumento
          etiqueta={`Secciones del código ${codigo}`}
          activa={vista}
          className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 bg-fondo py-2"
          secciones={VISTAS_SEGUIMIENTO.map((v) => ({
            clave: v.valor,
            titulo: v.etiqueta,
            href: `/seguimiento/codigo?${new URLSearchParams({ codigo, ...(v.valor === 'etapas' ? {} : { vista: v.valor }) })}#seccion-elegida`,
          }))}
        />

        {resumen && (
          <div className="grid grid-cols-3 gap-3">
            <Indicador
              titulo="Etapas"
              valor={`${resumen.etapas_terminadas} de ${resumen.etapas}`}
              tono={resumen.etapas_vencidas > 0 ? 'peligro' : 'neutro'}
              pie={
                resumen.etapas_vencidas > 0
                  ? `${resumen.etapas_vencidas} ${resumen.etapas_vencidas === 1 ? 'vencida' : 'vencidas'}`
                  : resumen.etapa_actual
                    ? `Ahora: ${resumen.etapa_actual}`
                    : 'Terminadas'
              }
            />
            <Indicador titulo="Materiales" valor={String(resumen.materiales)} pie="Líneas en la lista de Diseño" />
            <Indicador
              titulo="Planos"
              valor={String(resumen.planos)}
              tono={resumen.planos_por_recibir > 0 ? 'aviso' : 'neutro'}
              pie={resumen.planos_por_recibir > 0 ? `${resumen.planos_por_recibir} por recibir` : 'Vigentes'}
            />
          </div>
        )}

        <div id="seccion-elegida" className="scroll-mt-32 space-y-5">
          {vista === 'materiales' ? (
            <VistaMateriales codigo={codigo} />
          ) : vista === 'planos' ? (
            <VistaPlanos codigo={codigo} />
          ) : (
            <VistaEtapas codigo={codigo} />
          )}
        </div>
      </div>
    </>
  )
}
