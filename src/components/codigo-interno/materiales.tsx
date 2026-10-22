import type { ReactNode } from 'react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import type { LineaDeMaterial, LineaPedida, MaterialComparado } from '@/lib/datos/diseno-codigos'
import { comparacionMaterial } from '@/lib/dominio/diseno-codigos'
import { definir } from '@/lib/dominio/estados'
import { ESTADO_REQUERIMIENTO_DEL_CODIGO } from '@/lib/dominio/requerimientos'
import { cantidad, fecha } from '@/lib/format'

/**
 * Material por material: lo que puso Diseño, lo comprado por OC y lo salido del
 * almacén para el código (salidas menos devoluciones). Lo comprado o salido
 * que Diseño no puso en su lista también sale, marcado.
 */
export function TablaComparada({ materiales }: { materiales: MaterialComparado[] }) {
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Material</TH>
          <TH className="text-right">Diseño</TH>
          <TH className="text-right">Comprado</TH>
          <TH className="text-right">Salió</TH>
          <TH className="hidden sm:table-cell">Cómo va</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {materiales.length === 0 ? (
          <SinDatos titulo="Nada que comparar todavía" descripcion="Sale apenas Diseño arme la lista, Logística compre o Almacén entregue algo para este código." />
        ) : (
          materiales.map((m) => {
            const como = comparacionMaterial(m)
            return (
              <TR key={m.material_id} data-material={m.material_codigo}>
                <TD className="align-top">
                  <p className="text-texto">{m.material}</p>
                  <p className="text-xs text-texto-suave">
                    {m.material_codigo}
                    {m.unidad && ` · ${m.unidad}`}
                  </p>
                  <p className="sm:hidden">
                    <Insignia tono={como.tono}>{como.etiqueta}</Insignia>
                  </p>
                </TD>
                <TD className="tabular text-right align-top">{m.disenado === null ? '—' : cantidad(m.disenado)}</TD>
                <TD className="tabular text-right align-top">{cantidad(m.comprado)}</TD>
                <TD className="tabular text-right align-top">{cantidad(m.salido)}</TD>
                <TD className="hidden align-top sm:table-cell">
                  <Insignia tono={como.tono}>{como.etiqueta}</Insignia>
                </TD>
              </TR>
            )
          })
        )}
      </tbody>
    </Tabla>
  )
}

/** La lista de Diseño, línea por línea, con el plano del que sale cada una. */
export function TablaListaDiseno({ lineas, acciones }: { lineas: LineaDeMaterial[]; acciones?: (l: LineaDeMaterial) => ReactNode }) {
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Material</TH>
          <TH className="text-right">Cantidad</TH>
          <TH className="hidden md:table-cell">Sale del plano</TH>
          {acciones && (
            <TH>
              <span className="sr-only">Acciones</span>
            </TH>
          )}
        </tr>
      </TablaCabecera>
      <tbody>
        {lineas.length === 0 ? (
          <SinDatos titulo="Diseño todavía no armó la lista" descripcion="Es lo que lleva la unidad según sus planos: contra ella se mira lo comprado y lo salido del almacén." />
        ) : (
          lineas.map((l) => (
            <TR key={l.id} data-linea={l.material_codigo}>
              <TD className="align-top">
                <p className="text-texto">{l.material}</p>
                <p className="text-xs text-texto-suave">
                  {l.material_codigo}
                  {l.observacion && ` · ${l.observacion}`}
                </p>
                <p className="text-xs text-texto-suave md:hidden">{l.plano ?? 'De la unidad entera'}</p>
              </TD>
              <TD className="tabular text-right align-top whitespace-nowrap">
                {cantidad(l.cantidad)} {l.unidad}
              </TD>
              <TD className="hidden align-top text-xs md:table-cell">
                {l.plano ? <span className={l.plano_anulado ? 'text-aviso' : 'text-texto'}>{l.plano}{l.plano_anulado && ' · anulado'}</span> : <span className="text-texto-suave">De la unidad entera</span>}
              </TD>
              {acciones && <TD className="align-top whitespace-nowrap">{acciones(l)}</TD>}
            </TR>
          ))
        )}
      </tbody>
    </Tabla>
  )
}

/** Lo pedido por requerimiento para el código, como lo escribió cada área. */
export function TablaLoPedido({ lineas }: { lineas: LineaPedida[] }) {
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>RQ</TH>
          <TH>Insumo</TH>
          <TH className="text-right">Cantidad</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {lineas.length === 0 ? (
          <SinDatos titulo="Ningún requerimiento para este código" descripcion="Los piden Maestranza, Producción, Acabados y Almacén con el código de la unidad." />
        ) : (
          lineas.map((l) => {
            const estado = definir(ESTADO_REQUERIMIENTO_DEL_CODIGO, l.estado)
            return (
              <TR key={`${l.requerimiento_id}-${l.item}`}>
                <TD className="align-top whitespace-nowrap">
                  <p className="font-medium text-texto">{l.numero}</p>
                  <p className="text-xs text-texto-suave">
                    {l.area ?? 'Sin área'} · {fecha(l.fecha)}
                  </p>
                  <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                </TD>
                <TD className="align-top text-texto">{l.descripcion}</TD>
                <TD className="tabular text-right align-top whitespace-nowrap">
                  {cantidad(l.cantidad)} {l.unidad}
                </TD>
              </TR>
            )
          })
        )}
      </tbody>
    </Tabla>
  )
}
