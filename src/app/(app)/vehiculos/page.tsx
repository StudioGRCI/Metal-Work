import { Camera, Clock } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { diasEnEspera } from '@/lib/datos/dias-en-espera'
import {
  cargarVehiculos,
  codigosParaIngreso,
  estadosDeSalida,
  otsParaIngreso,
  type EstadoDeSalida,
  type RegistroVehiculo,
} from '@/lib/datos/vehiculos'
import { diasEntre, textoEnPlanta, textoEstuvo } from '@/lib/dominio/dias-en-planta'
import { conQueVuelveDelArenado, MOTIVO_VEHICULO } from '@/lib/dominio/requerimientos'
import { diaLima, fechaHora } from '@/lib/format'
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
  // Los códigos y las OT que puede elegir quien registra el ingreso no dependen
  // de la lista: se piden a la vez.
  const pidiendoCodigos = registra ? codigosParaIngreso() : Promise.resolve([])
  const pidiendoOts = registra ? otsParaIngreso() : Promise.resolve([])
  const registros = await cargarVehiculos(vista)
  // Lo que le falta a cada vehículo de trabajo para salir.
  const enPlanta = registros.filter((r) => !r.salida_en && !r.anulado_en).map((r) => r.id)
  const [estados, codigos, ots, dias] = await Promise.all([
    estadosDeSalida(enPlanta),
    pidiendoCodigos,
    pidiendoOts,
    // Los días en planta de cada uno, contados por la base con la fecha de Lima (plan 3,
    // entrega 3.2). Sin ellos la lista sigue con todo lo demás: solo no dice los días.
    diasEnEspera(registros.map((r) => (!r.salida_en && !r.anulado_en ? r.ingreso_en : null))).catch((e: unknown) => {
      console.error('Vehículos: no se pudieron contar los días en planta.', e)
      return null
    }),
  ])

  return (
    <>
      <EncabezadoPagina
        titulo="Ingreso y salida de vehículos"
        ayuda="Cada vez que un vehículo entra a la planta —para fabricación, mantenimiento, garantía o de vuelta del arenado— y cuándo sale, con fotos de cómo entró y cómo salió. La fabricación entra con su código interno; el mantenimiento y la garantía, con el N.º de su OT. En planta va primero el que lleva más días, y cada uno dice cuántos lleva, qué puesto registró su ingreso y su salida, y qué le falta para salir según las reglas de la base. Reemplaza el seguimiento de portería en Excel."
        migas={[{ titulo: 'Vehículos' }]}
        acciones={registra && <NuevoIngresoVehiculo cuentaId={perfil.id} codigos={codigos} ots={ots} />}
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

      {dias === null && vista === 'en_planta' && enPlanta.length > 0 && (
        <p className="mb-3 rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-texto" role="status" data-dias-sin-leer>
          No se pudieron contar los días que lleva cada vehículo en la planta. Siguen del que entró primero al último; vuelve a cargar la
          pantalla en un momento para ver los días.
        </p>
      )}

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
              registros.map((r, i) => (
                <FilaVehiculo key={r.id} registro={r} registra={registra} cuentaId={perfil.id} estado={estados.get(r.id)} dias={dias?.[i] ?? null} />
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
  dias,
}: {
  registro: RegistroVehiculo
  registra: boolean
  cuentaId: string
  estado: EstadoDeSalida | undefined
  /** Los días que lleva en planta, si sigue adentro; `null` si salió o no se pudieron contar. */
  dias: number | null
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
        {r.placa && r.chasis && <p className="tabular text-xs text-texto-suave">Chasis {r.chasis}</p>}
        {r.codigo_interno && (r.placa || r.chasis) && <p className="tabular text-xs text-texto-suave">{/^OT /.test(r.codigo_interno) ? r.codigo_interno : `Código ${r.codigo_interno}`}</p>}
        <p className="text-xs text-texto">
          {r.unidad} · {r.empresa}
        </p>
        <p className="text-xs text-texto-suave md:hidden">{motivo?.etiqueta ?? r.motivo}</p>
        {(r.fotos_ingreso > 0 || r.fotos_salida > 0) && (
          <Link href={`/vehiculos/${r.id}`} className="mt-1 inline-flex items-center gap-1 text-xs text-texto-suave hover:text-texto">
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
          <p className="tabular text-xs text-texto-suave">
            Entró {fechaHora(r.ingreso_en)}
            {r.ingreso_puesto && ` · lo registró ${r.ingreso_puesto}`}
          </p>
          <Situacion registro={r} estado={estado} dias={dias} />
          {r.salida_en && r.salida_puesto && <p className="text-xs text-texto-suave">Su salida la registró {r.salida_puesto}</p>}
          {estado?.falta_para_salir && (
            <p className="max-w-sm text-xs text-texto-suave" data-bloqueo-salida>
              {estado.falta_para_salir}
            </p>
          )}
        </div>
      </TD>
      <TD className="hidden align-top md:table-cell">
        {motivo ? <Insignia tono={motivo.tono}>{motivo.etiqueta}</Insignia> : r.motivo}
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <p className="tabular text-xs text-texto whitespace-nowrap">{fechaHora(r.ingreso_en)}</p>
        {r.ingreso_puesto && <p className="text-xs whitespace-nowrap text-texto-suave" data-registro-ingreso>Lo registró {r.ingreso_puesto}</p>}
        {r.observacion_ingreso && <p className="mt-1 max-w-xs text-xs text-texto-suave">{r.observacion_ingreso}</p>}
      </TD>
      <TD className="hidden align-top sm:table-cell">
        {r.salida_en ? (
          <>
            <p className="tabular text-xs text-texto whitespace-nowrap">{fechaHora(r.salida_en)}</p>
            {r.salida_puesto && <p className="text-xs whitespace-nowrap text-texto-suave" data-registro-salida>La registró {r.salida_puesto}</p>}
            <p className="text-xs text-texto-suave">{textoEstuvo(diasEntre(diaLima(r.ingreso_en), diaLima(r.salida_en)))}</p>
            {r.observacion_salida && <p className="mt-1 max-w-xs text-xs text-texto-suave">{r.observacion_salida}</p>}
          </>
        ) : (
          <>
            <Situacion registro={r} estado={estado} dias={dias} />
            {/* Lo que le falta va junto a su estado; el «Marcar salida» apagado lo cita por su id. */}
            {estado?.falta_para_salir && (
              <p id={`veh-bloqueo-${r.id}`} className="mt-1 max-w-sm text-xs text-texto-suave" data-bloqueo-salida>
                {estado.falta_para_salir}
              </p>
            )}
          </>
        )}
      </TD>
      <TD className="text-right align-top">
        {registra && !r.salida_en && !anulado && (
          <ControlesVehiculo
            id={r.id}
            nombre={nombre}
            cuentaId={cuentaId}
            bloqueoSalida={estado?.falta_para_salir ?? null}
            // Al arenado sale solo el de una unidad del padrón: la base lo exige (20261020168000).
            alArenado={Boolean(estado?.exige) && r.unidad_id !== null}
            vuelveDelArenado={conQueVuelveDelArenado(r.motivo, r.codigo_interno)}
          />
        )}
      </TD>
    </TR>
  )
}

/**
 * En planta, salió o anulado; del que sigue adentro, cuántos días lleva y si ya
 * puede salir; y del que espera para salir, el avance de su código o su OT.
 * Lo que falta lo dice la base (`vehiculos_estado_de_salida`): aquí solo se muestra.
 */
function Situacion({ registro: r, estado, dias }: { registro: RegistroVehiculo; estado: EstadoDeSalida | undefined; dias: number | null }) {
  if (r.anulado_en) return <Insignia tono="peligro">Anulado</Insignia>
  if (r.salida_en)
    return (
      <div className="flex flex-wrap items-center gap-1">
        <Insignia tono="neutro">
          {r.sale_al_arenado ? 'Salió al arenado' : 'Salió'} {fechaHora(r.salida_en)}
        </Insignia>
        {/* En el teléfono no hay columna de salida: aquí va cuánto estuvo. */}
        <span className="text-xs text-texto-suave sm:hidden">{textoEstuvo(diasEntre(diaLima(r.ingreso_en), diaLima(r.salida_en)))}</span>
      </div>
    )
  return (
    <div className="flex flex-wrap items-center gap-1">
      {/* Una sola insignia: «En planta» y sus días; sin los días, solo «En planta». El color
          queda para lo que decide la salida: verde si puede salir, ámbar si le falta algo. */}
      {dias != null ? (
        <Insignia className="tabular" data-dias-en-planta={dias}>
          <Clock aria-hidden className="size-3" />
          {textoEnPlanta(dias)}
        </Insignia>
      ) : (
        <Insignia>En planta</Insignia>
      )}
      {estado?.exige && !estado.falta_para_salir && (
        <Insignia tono="exito" data-puede-salir>
          Puede salir
        </Insignia>
      )}
      {estado?.falta_para_salir && (
        <Insignia tono="aviso" data-falta-para-salir>
          Falta para salir
        </Insignia>
      )}
      {/* Garantía y mantenimiento esperan que Administración dé por terminado el trabajo de su OT. */}
      {estado?.exige && estado.garantia_ot && (
        <span className="tabular text-xs text-texto-suave" data-garantia-salida={estado.garantia_estado ?? ''}>
          {r.motivo === 'MANTENIMIENTO' ? 'Mantenimiento' : 'Garantía'} OT {estado.garantia_ot} ·{' '}
          {estado.garantia_estado === 'TERMINADA'
            ? `${r.motivo === 'MANTENIMIENTO' ? 'terminado' : 'terminada'}${estado.falta_para_salir ? ', falta Tesorería' : ''}`
            : estado.garantia_estado === 'ANULADA'
              ? 'OT anulada'
              : 'por terminar'}
        </span>
      )}
      {estado?.exige && !estado.garantia_ot && (
        <span className="tabular text-xs text-texto-suave" data-avance-salida={estado.avance ?? 0}>
          Avance {estado.avance ?? 0} %{estado.avance === 100 && estado.falta_para_salir ? ' · falta Tesorería' : ''}
        </span>
      )}
    </div>
  )
}
