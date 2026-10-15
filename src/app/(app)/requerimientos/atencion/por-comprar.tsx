'use client'

import { useMemo, useState } from 'react'

import { GenerarCompraDeInsumos, type InsumoParaCompra } from '@/app/(app)/compras/ordenes/formulario-directa'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import type { MaterialParaConteo } from '@/lib/datos/atencion-materiales'
import type { ProveedorParaCompra } from '@/lib/datos/proveedores'
import { cantidad, fecha } from '@/lib/format'

/** Un insumo por comprar, con el material como lo nombra el catálogo para agruparlo. */
export type InsumoPorComprar = InsumoParaCompra & { material: string; codigo_material: string | null; fecha_requerida: string | null }

/** Los insumos de un tipo de RQ: una orden no junta los de operación con los de Administración. */
export type GrupoPorComprar = { tipo: string; titulo: string; descripcion: string; insumos: InsumoPorComprar[] }

/**
 * «Por comprar»: lo que falta de cada RQ, insumo por insumo y agrupado por
 * material, para marcar lo de varios RQ y emitir una sola orden para un
 * proveedor. Cada insumo sigue con su RQ y su código interno.
 */
export function PorComprar({
  grupos,
  preseleccion,
  proveedores,
  materiales,
  puedeRegistrarProveedor,
}: {
  grupos: GrupoPorComprar[]
  /** El RQ desde el que se llegó: sus insumos vienen marcados. */
  preseleccion: string | null
  proveedores: ProveedorParaCompra[]
  materiales: MaterialParaConteo[]
  puedeRegistrarProveedor: boolean
}) {
  const [aviso, setAviso] = useState<string | null>(null)
  return (
    <div className="space-y-4">
      {aviso && (
        <p role="status" className="text-sm text-exito">
          {aviso}
        </p>
      )}
      {grupos.map((g) => (
        <GrupoDeInsumos
          key={g.tipo}
          grupo={g}
          preseleccion={preseleccion}
          proveedores={proveedores}
          materiales={materiales}
          puedeRegistrarProveedor={puedeRegistrarProveedor}
          alEmitir={setAviso}
        />
      ))}
    </div>
  )
}

function GrupoDeInsumos({
  grupo,
  preseleccion,
  proveedores,
  materiales,
  puedeRegistrarProveedor,
  alEmitir,
}: {
  grupo: GrupoPorComprar
  preseleccion: string | null
  proveedores: ProveedorParaCompra[]
  materiales: MaterialParaConteo[]
  puedeRegistrarProveedor: boolean
  alEmitir: (mensaje: string) => void
}) {
  const [marcados, setMarcados] = useState<Set<string>>(
    () => new Set(grupo.insumos.filter((i) => i.requerimiento_id === preseleccion).map((i) => i.id)),
  )
  // Lo que ya entró en una orden desaparece de la lista al volver de la base:
  // solo cuenta lo marcado que sigue en ella.
  const elegidos = grupo.insumos.filter((i) => marcados.has(i.id))
  const porMaterial = useMemo(() => {
    const grupos = new Map<string, InsumoPorComprar[]>()
    for (const i of grupo.insumos) {
      const clave = i.material_id ?? `sin-material-${i.id}`
      grupos.set(clave, [...(grupos.get(clave) ?? []), i])
    }
    return [...grupos.entries()].sort(([, a], [, b]) => a[0].material.localeCompare(b[0].material, 'es'))
  }, [grupo.insumos])

  function alternar(ids: string[], marcar: boolean) {
    setMarcados((previo) => {
      const nuevo = new Set(previo)
      for (const id of ids) {
        if (marcar) nuevo.add(id)
        else nuevo.delete(id)
      }
      return nuevo
    })
  }

  return (
    <Tarjeta className="overflow-hidden">
      <TarjetaCabecera
        titulo={grupo.titulo}
        descripcion={grupo.descripcion}
        acciones={
          <GenerarCompraDeInsumos
            insumos={elegidos}
            proveedores={proveedores}
            materiales={materiales}
            puedeRegistrarProveedor={puedeRegistrarProveedor}
            alEmitir={(mensaje) => {
              setMarcados(new Set())
              alEmitir(mensaje)
            }}
          />
        }
      />
      <Tabla>
        <TablaCabecera>
          <tr>
            <TH className="w-10">
              <span className="sr-only">Marcar</span>
            </TH>
            <TH>Insumo</TH>
            <TH>Requerimiento</TH>
            <TH>Código interno</TH>
            <TH className="text-right">Falta</TH>
          </tr>
        </TablaCabecera>
        <tbody>
          {grupo.insumos.length === 0 ? (
            <SinDatos
              titulo="Nada por comprar"
              descripcion="Cuando Almacén revise un requerimiento y le falte algo, el insumo aparece aquí para que lo juntes en una orden."
            />
          ) : (
            porMaterial.map(([clave, insumos]) => {
              const ids = insumos.map((i) => i.id)
              const todos = ids.every((id) => marcados.has(id))
              const total = insumos.reduce((suma, i) => suma + i.falta, 0)
              const unidades = new Set(insumos.map((i) => i.unidad))
              return (
                <MaterialPorComprar
                  key={clave}
                  insumos={insumos}
                  todos={todos}
                  algunos={!todos && ids.some((id) => marcados.has(id))}
                  total={unidades.size === 1 ? `${cantidad(total)} ${insumos[0].unidad}` : null}
                  marcados={marcados}
                  alternar={alternar}
                />
              )
            })
          )}
        </tbody>
      </Tabla>
    </Tarjeta>
  )
}

function MaterialPorComprar({
  insumos,
  todos,
  algunos,
  total,
  marcados,
  alternar,
}: {
  insumos: InsumoPorComprar[]
  todos: boolean
  algunos: boolean
  total: string | null
  marcados: Set<string>
  alternar: (ids: string[], marcar: boolean) => void
}) {
  const primero = insumos[0]
  const rqs = new Set(insumos.map((i) => i.requerimiento_id)).size
  return (
    <>
      <TR className="bg-superficie-2">
        <TD>
          <input
            type="checkbox"
            aria-label={`Marcar todo lo que falta de ${primero.material}`}
            checked={todos}
            ref={(el) => {
              if (el) el.indeterminate = algunos
            }}
            onChange={(e) => alternar(insumos.map((i) => i.id), e.target.checked)}
          />
        </TD>
        <TD colSpan={3}>
          <span className="font-semibold text-texto">{primero.material}</span>
          {primero.codigo_material && <span className="ml-2 tabular text-xs text-texto-suave">{primero.codigo_material}</span>}
          {!primero.material_id && <span className="ml-2 text-xs text-aviso">Sin material del catálogo: lo eliges en la orden</span>}
          <span className="ml-2 text-xs text-texto-suave">
            · {insumos.length} {insumos.length === 1 ? 'insumo' : 'insumos'}
            {rqs > 1 ? ` de ${rqs} RQ` : ''}
          </span>
        </TD>
        <TD className="text-right tabular font-semibold text-texto">{total ?? '—'}</TD>
      </TR>
      {insumos.map((i) => (
        <TR key={i.id}>
          <TD>
            <input
              type="checkbox"
              aria-label={`Marcar ${i.descripcion} del ${i.requerimiento}`}
              checked={marcados.has(i.id)}
              onChange={(e) => alternar([i.id], e.target.checked)}
            />
          </TD>
          <TD className="text-sm text-texto">{i.descripcion}</TD>
          <TD className="text-sm">
            <span className="tabular font-medium text-texto">{i.requerimiento}</span>
            <span className="block text-xs text-texto-suave">
              {i.area}
              {i.fecha_requerida && ` · para el ${fecha(i.fecha_requerida)}`}
            </span>
          </TD>
          <TD className="tabular text-sm text-texto">{i.codigo_interno}</TD>
          <TD className="text-right tabular text-sm text-texto">
            {cantidad(i.falta)} {i.unidad}
          </TD>
        </TR>
      ))}
    </>
  )
}
