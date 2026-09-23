import { Boxes } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarAtencionMateriales } from '@/lib/datos/atencion-materiales'
import { exigirPermiso, puede } from '@/lib/sesion'

import { TableroMateriales } from './tablero'

export const metadata = { title: 'Atención de materiales' }

export default async function PaginaAtencionMateriales() {
  const perfil = await exigirPermiso([
    'requerimientos.ver', 'compras.ver', 'almacen.ver', 'almacen.recibir', 'almacen.despachar',
  ])
  const permisos = {
    verRequerimientos: puede(perfil, 'requerimientos.ver'),
    verExistencias: puede(perfil, 'almacen.ver'),
    crearCompra: puede(perfil, 'compras.crear'),
    verCompras: puede(perfil, 'compras.ver'),
    recibir: puede(perfil, 'almacen.recibir'),
    despachar: puede(perfil, 'almacen.despachar'),
  }
  const datos = await cargarAtencionMateriales(permisos)
  const clavesCompra = Object.fromEntries(
    [...new Set(datos.lineas.map((linea) => linea.requerimiento_id).filter((id): id is string => Boolean(id)))]
      .map((id) => [id, crypto.randomUUID()]),
  )
  const clavesRecepcion = Object.fromEntries(datos.compras.map((compra) => [compra.id ?? '', crypto.randomUUID()]))
  const clavesDespacho = Object.fromEntries(datos.lineas.map((linea) => [linea.detalle_id ?? '', crypto.randomUUID()]))

  return (
    <>
      <EncabezadoPagina
        titulo="Atención de materiales"
        descripcion="Sigue cada material desde que Diseño lo solicita hasta que Almacén lo entrega a la persona del área."
      />
      {datos.lineas.length === 0 && !permisos.verExistencias ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <EstadoVacio
              titulo="Todavía no hay requerimientos"
              descripcion="Cuando Diseño o tu supervisor solicite materiales para una OT, aparecerán aquí con su área y avance."
            />
          </TarjetaCuerpo>
        </Tarjeta>
      ) : datos.lineas.length === 0 && datos.existencias.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <EstadoVacio
              titulo="El circuito aún no tiene movimientos"
              descripcion="Los materiales solicitados aparecerán aquí. La primera recepción desde una compra registrada crea el saldo de Almacén."
            />
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <TableroMateriales
          lineas={datos.lineas}
          existencias={datos.existencias}
          compras={datos.compras}
          areas={datos.areas}
          responsables={datos.responsables}
          puedeCrearCompra={permisos.crearCompra}
          puedeVerCompras={permisos.verCompras}
          puedeRecibir={permisos.recibir}
          puedeDespachar={permisos.despachar}
          clavesCompra={clavesCompra}
          clavesRecepcion={clavesRecepcion}
          clavesDespacho={clavesDespacho}
        />
      )}
    </>
  )
}

function EstadoVacio({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <span className="rounded-full bg-acento-suave p-3 text-acento"><Boxes aria-hidden className="size-5" /></span>
      <p className="mt-3 text-sm font-semibold text-texto">{titulo}</p>
      <p className="mt-1 max-w-lg text-sm text-texto-suave">{descripcion}</p>
    </div>
  )
}
