import Link from 'next/link'

import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
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
 * `ordenes.editar` (Administración), y la ven Diseño y el taller.
 */
export async function VistaFicha({ codigo, perfil }: { codigo: string; perfil: PerfilSesion }) {
  const deLaOrden = await ordenDelCodigo(codigo)
  if (!deLaOrden) {
    return (
      <Tarjeta>
        <TarjetaCuerpo>
          <p className="text-sm text-texto-suave">
            Este código todavía no tiene su OT: la ficha de taller se llena cuando Gerencia aprueba la cotización con su código y su OT.
          </p>
        </TarjetaCuerpo>
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
        <TarjetaCuerpo>
          <p className="text-sm text-texto-suave">No se pudo abrir la OT {deLaOrden.numero} de este código.</p>
        </TarjetaCuerpo>
      </Tarjeta>
    )
  }

  const escribe = puede(perfil, 'ordenes.editar') && !ESTADOS_CERRADOS.includes(orden.estado)

  return (
    <div className="space-y-3">
      <p className="text-sm text-texto-suave">
        La ficha de la unidad, de su OT{' '}
        {puede(perfil, 'ordenes.ver') ? (
          <Link href={`/ordenes/${orden.id}`} className="font-medium text-acento hover:underline">
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
