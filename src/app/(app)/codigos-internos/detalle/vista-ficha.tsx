import Link from 'next/link'

import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import {
  accesoriosDeOrden,
  ordenDelCodigo,
  personalDelTaller,
  repuestosDeOrden,
  verificacionesDeOrden,
} from '@/lib/datos/ficha-ot'
import { obtenerOrden } from '@/lib/datos/ordenes'
import { puede, type PerfilSesion } from '@/lib/sesion'

import { ESTADOS_CERRADOS } from '../../ordenes/[id]/cabecera-orden'
import { FichaTaller } from '../../ordenes/[id]/ficha-taller'

/**
 * La ficha de taller de la unidad, desde su código interno. Desde el 2026-10-15
 * todo se sigue por código y la OT queda como documento de Diseño; DKS pidió
 * el 2026-10-26 que la ficha también se lleve por código. Se guarda en la OT
 * que nació de la cotización del código (`ordenDelCodigo`), con las mismas
 * acciones y permisos que la pestaña de la OT: la llena quien tiene
 * `ordenes.editar` (Administración). Aquí la ve quien abre Códigos internos
 * (`codigos_internos.ver`); Diseño la sigue viendo en la OT.
 */
export async function VistaFicha({ codigo, perfil }: { codigo: string; perfil: PerfilSesion }) {
  const deLaOrden = await ordenDelCodigo(codigo)
  if (!deLaOrden) {
    return (
      <Tarjeta>
        <SinDatos
          enTabla={false}
          titulo="Este código todavía no tiene su OT"
          descripcion="La ficha de taller se llena cuando Gerencia aprueba la cotización con su código y su OT."
        />
      </Tarjeta>
    )
  }

  const [orden, accesorios, repuestos, verificaciones, personal] = await Promise.all([
    obtenerOrden(deLaOrden.id),
    accesoriosDeOrden(deLaOrden.id),
    repuestosDeOrden(deLaOrden.id),
    verificacionesDeOrden(deLaOrden.id),
    personalDelTaller(),
  ])
  if (!orden) {
    return (
      <Tarjeta>
        <SinDatos
          enTabla={false}
          titulo={`No se pudo abrir la OT ${deLaOrden.numero} de este código`}
          descripcion="Vuelve a cargar la página o ábrela desde Órdenes de trabajo."
        />
      </Tarjeta>
    )
  }

  const escribe = puede(perfil, 'ordenes.editar') && !ESTADOS_CERRADOS.includes(orden.estado)

  return (
    <div className="space-y-3">
      <p className="text-sm text-texto-suave">
        La ficha de la unidad, de su OT{' '}
        {puede(perfil, 'ordenes.ver') ? (
          <Link href={`/ordenes/${orden.id}`} className="inline-flex min-h-11 items-center font-medium text-acento hover:underline sm:min-h-0">
            {orden.numero}
          </Link>
        ) : (
          orden.numero
        )}
        .
      </p>
      <FichaTaller
        ordenId={orden.id}
        ficha={{
          largo_m: orden.largo_m,
          ancho_m: orden.ancho_m,
          alto_m: orden.alto_m,
          capacidad_carga: orden.capacidad_carga,
          ruedas: orden.ruedas,
          tipo_llantas: orden.tipo_llantas,
          cantidad_ejes: orden.cantidad_ejes,
          tipo_suspension: orden.tipo_suspension,
          colores: orden.colores,
          caracteristicas_especiales: orden.caracteristicas_especiales,
          correo_contacto: orden.correo_contacto,
          encargado_produccion_id: orden.encargado_produccion_id,
        }}
        accesorios={accesorios}
        repuestos={repuestos}
        verificaciones={verificaciones}
        personal={personal}
        puedeEditar={escribe}
        puedeEscribirOrden={escribe}
        puedeArmar={escribe}
        rolVerificacion={null}
        puedeCrearVerificacion={escribe}
      />
    </div>
  )
}
