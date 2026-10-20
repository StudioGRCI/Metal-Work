import { Camera } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { cargarVehiculos, codigosParaIngreso, estadosDeSalida, type EstadoDeSalida, type RegistroVehiculo } from '@/lib/datos/vehiculos'
import { MOTIVO_VEHICULO } from '@/lib/dominio/requerimientos'
import { fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { ControlesVehiculo } from './controles'
import { NuevoIngresoVehiculo } from './formulario'

export const metadata = { title: 'Ingreso y salida de vehículos' }

const VISTAS = [
  { valor: 'en_planta', titulo: 'En planta' },
  { valor: 'historial', titulo: 'Historial' },
] as const

export default async function PaginaVehiculos({ searchParams }: PageProps<'/vehiculos'>) {
  const perfil = await exigirPermiso(['vehiculos.registrar', 'vehiculos.ver'])
  const registra = puede(perfil, 'vehiculos.registrar')
  const params = await searchParams
  const vista = params.vista === 'historial' ? 'historial' : 'en_planta'
  const registros = await cargarVehiculos(vista)
  // Lo que le falta a cada vehículo de trabajo para salir, y los códigos con OT
  // que puede elegir quien registra el ingreso.
  const enPlanta = registros.filter((r) => !r.salida_en && !r.anulado_en).map((r) => r.id)
  const [estados, codigos] = await Promise.all([estadosDeSalida(enPlanta), registra ? codigosParaIngreso() : Promise.resolve([])])

  return (
    <>
      <EncabezadoPagina
        titulo="Ingreso y salida de vehículos"
        ayuda="Cada vez que un vehículo entra a la planta —para fabricación, mantenimiento, garantía o de vuelta del arenado— y cuándo sale, con fotos de cómo entró y cómo salió. Reemplaza el seguimiento de portería en Excel."
        migas={[{ titulo: 'Vehículos' }]}
        acciones={registra && <NuevoIngresoVehiculo cuentaId={perfil.id} codigos={codigos} />}
      />

      <Vistas
        etiqueta="Vista"
        className="mb-3"
        vistas={VISTAS.map((v) => ({
          clave: v.valor,
          titulo: v.titulo,
          href: v.valor === 'en_planta' ? '/vehiculos' : `/vehiculos?vista=${v.valor}`,
          activa: vista === v.valor,
          cuenta: vista === v.valor ? registros.length : undefined,
        }))}
      />

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Vehículo</TH>
              <TH className="hidden md:table-cell">Motivo</TH>
              <TH className="hidden sm:table-cell">Ingreso</TH>
              <TH className="hidden sm:table-cell">Salida</TH>
              <TH className="text-right">
                <span className="sr-only">Acciones</span>
              </TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {registros.length === 0 ? (
              <SinDatos
                titulo={vista === 'en_planta' ? 'No hay vehículos en la planta' : 'Todavía no hay ingresos registrados'}
                descripcion={registra ? 'Cuando entre uno, anótalo con «Registrar ingreso».' : 'El área de Requerimientos registra cada ingreso.'}
              />
            ) : (
              registros.map((r) => (
                <FilaVehiculo key={r.id} registro={r} registra={registra} cuentaId={perfil.id} estado={estados.get(r.id)} />
              ))
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}

function FilaVehiculo({
  registro: r,
  registra,
  cuentaId,
  estado,
}: {
  registro: RegistroVehiculo
  registra: boolean
  cuentaId: string
  estado: EstadoDeSalida | undefined
}) {
  const motivo = MOTIVO_VEHICULO[r.motivo]
  const nombre = r.placa ?? r.chasis ?? r.codigo_interno ?? 'vehículo'
  const anulado = r.anulado_en !== null
  return (
    <TR className={anulado ? 'opacity-60' : undefined}>
      <TD className="align-top">
        <Link href={`/vehiculos/${r.id}`} className="tabular font-semibold text-acento hover:underline">
          {r.placa ?? (r.chasis ? `Chasis ${r.chasis}` : r.codigo_interno)}
        </Link>
        {r.placa && r.chasis && <p className="tabular text-[11px] text-texto-suave">Chasis {r.chasis}</p>}
        {r.codigo_interno && (r.placa || r.chasis) && <p className="tabular text-[11px] text-texto-suave">{r.codigo_interno}</p>}
        <p className="text-xs text-texto">
          {r.unidad} · {r.empresa}
        </p>
        <p className="text-[11px] text-texto-suave md:hidden">{motivo?.etiqueta ?? r.motivo}</p>
        {(r.fotos_ingreso > 0 || r.fotos_salida > 0) && (
          <Link href={`/vehiculos/${r.id}`} className="mt-1 inline-flex items-center gap-1 text-[11px] text-texto-suave hover:text-texto">
            <Camera aria-hidden className="size-3.5" />
            {[
              r.fotos_ingreso > 0 && `${r.fotos_ingreso} al entrar`,
              r.fotos_salida > 0 && `${r.fotos_salida} al salir`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Link>
        )}
        {r.motivo_anulacion && <p className="mt-1 text-xs text-peligro">Anulado: {r.motivo_anulacion}</p>}
        {/* En el teléfono, el ingreso y la salida van aquí: la tabla no se desliza de costado. */}
        <div className="mt-1 space-y-1 sm:hidden">
          <p className="tabular text-xs text-texto-suave">Entró {fechaHora(r.ingreso_en)}</p>
          <Situacion registro={r} estado={estado} />
        </div>
        {estado?.falta_para_salir && (
          <p id={`veh-bloqueo-${r.id}`} className="mt-1 max-w-sm text-xs text-texto-suave" data-bloqueo-salida>
            {estado.falta_para_salir}
          </p>
        )}
      </TD>
      <TD className="hidden align-top md:table-cell">
        {motivo ? <Insignia tono={motivo.tono}>{motivo.etiqueta}</Insignia> : r.motivo}
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <p className="tabular text-xs text-texto whitespace-nowrap">{fechaHora(r.ingreso_en)}</p>
        {r.observacion_ingreso && <p className="mt-1 max-w-xs text-[11px] text-texto-suave">{r.observacion_ingreso}</p>}
      </TD>
      <TD className="hidden align-top sm:table-cell">
        {r.salida_en ? (
          <>
            <p className="tabular text-xs text-texto whitespace-nowrap">{fechaHora(r.salida_en)}</p>
            {r.observacion_salida && <p className="mt-1 max-w-xs text-[11px] text-texto-suave">{r.observacion_salida}</p>}
          </>
        ) : (
          <Situacion registro={r} estado={estado} />
        )}
      </TD>
      <TD className="text-right align-top">
        {registra && !r.salida_en && !anulado && (
          <ControlesVehiculo id={r.id} nombre={nombre} cuentaId={cuentaId} bloqueoSalida={estado?.falta_para_salir ?? null} />
        )}
      </TD>
    </TR>
  )
}

/** En planta, salió o anulado; y del que espera para salir, el avance de su código. */
function Situacion({ registro: r, estado }: { registro: RegistroVehiculo; estado: EstadoDeSalida | undefined }) {
  if (r.anulado_en) return <Insignia tono="peligro">Anulado</Insignia>
  if (r.salida_en) return <Insignia tono="neutro">Salió {fechaHora(r.salida_en)}</Insignia>
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Insignia tono="aviso">En planta</Insignia>
      {estado?.exige && (
        <span className="tabular text-xs text-texto-suave" data-avance-salida={estado.avance ?? 0}>
          Avance {estado.avance ?? 0} %{estado.avance === 100 && estado.falta_para_salir ? ' · falta Tesorería' : ''}
        </span>
      )}
    </div>
  )
}
