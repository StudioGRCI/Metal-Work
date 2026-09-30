import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { TableroMateriales } from '@/app/(app)/materiales/atencion/tablero'
import { cargarAtencionMateriales } from '@/lib/datos/atencion-materiales'
import { puede, type PerfilSesion } from '@/lib/sesion'

export async function AtencionMaterialesDeOrden({ ordenId, perfil }: { ordenId: string; perfil: PerfilSesion }) {
  const permisos = {
    verRequerimientos: puede(perfil, ['requerimientos.ver', 'diseno.planos', 'compras.ver', 'almacen.ver']),
    aprobarDiseno: puede(perfil, 'diseno.planos'),
    verExistencias: puede(perfil, 'almacen.ver'),
    verCompras: puede(perfil, 'compras.ver'),
    crearCompra: puede(perfil, 'compras.crear'),
    recibir: puede(perfil, 'almacen.recibir'),
    despachar: puede(perfil, 'almacen.despachar'),
  }
  if (!permisos.verRequerimientos) return null

  const datos = await cargarAtencionMateriales(permisos, ordenId)
  const clavesCompra = Object.fromEntries(
    [...new Set(datos.lineas.map((linea) => linea.requerimiento_id).filter((id): id is string => Boolean(id)))]
      .map((id) => [id, crypto.randomUUID()]),
  )
  const clavesRecepcion = Object.fromEntries(datos.compras.map((compra) => [compra.id ?? '', crypto.randomUUID()]))
  const clavesDespacho = Object.fromEntries(datos.lineas.map((linea) => [linea.detalle_id ?? '', crypto.randomUUID()]))
  const clavesDocumento = Object.fromEntries(
    [...new Set(datos.compras.map((compra) => compra.orden_compra_id).filter((id): id is string => Boolean(id)))]
      .map((id) => [id, crypto.randomUUID()]),
  )

  return <section aria-labelledby="atencion-materiales-titulo" className="space-y-4">
    <Tarjeta>
      <TarjetaCabecera titulo="Atención de materiales de esta OT"
        descripcion="Diseño revisa propuestas, Almacén comprueba stock y despacha, y Logística compra solo cuando falta saldo." />
      <TarjetaCuerpo>
        <h2 id="atencion-materiales-titulo" className="sr-only">Atención de materiales de esta OT</h2>
        {datos.lineas.length === 0 && <p className="text-sm text-texto-suave">
          Esta orden aún no tiene solicitudes. El área que utilizará el insumo lo solicita en esta OT; aquí aparecerá su atención.
        </p>}
      </TarjetaCuerpo>
    </Tarjeta>
    {datos.lineas.length > 0 && <TableroMateriales
      lineas={datos.lineas}
      existencias={datos.existencias}
      compras={datos.compras}
      areas={datos.areas}
      responsables={datos.responsables}
      puedeCrearCompra={permisos.crearCompra}
      puedeAprobarDiseno={permisos.aprobarDiseno}
      puedeRevisarStock={permisos.verExistencias}
      puedeAdjuntarDocumentos={permisos.crearCompra}
      puedeVerCompras={permisos.verCompras}
      puedeRecibir={permisos.recibir}
      puedeDespachar={permisos.despachar}
      clavesCompra={clavesCompra}
      clavesRecepcion={clavesRecepcion}
      clavesDespacho={clavesDespacho}
      clavesDocumento={clavesDocumento}
    />}
  </section>
}
