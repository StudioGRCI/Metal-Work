import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { areasParaPersonal, listarTrabajadores, type Trabajador } from '@/lib/datos/rrhh'
import { HORAS_DEL_MES, TIPO_CUENTA, horaCorta } from '@/lib/dominio/rrhh'
import { moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { ControlesTrabajador, NuevoTrabajador } from './formulario'

export const metadata = { title: 'Personal de Recursos Humanos' }

const FILTROS = [
  { valor: 'activos', titulo: 'Activos' },
  { valor: 'todos', titulo: 'Todos' },
] as const

export default async function PaginaPersonalRRHH({ searchParams }: PageProps<'/rrhh/personal'>) {
  const perfil = await exigirPermiso(['rrhh.personal', 'asistencia.ver'])
  const gestiona = puede(perfil, 'rrhh.personal')
  // La miga lleva a las planillas solo a quien las abre: Gerencia y
  // Administración consultan esto con `asistencia.ver` y ahí las rebotaban.
  const planillas = puede(perfil, 'rrhh.ver_planillas')
  const params = await searchParams
  const filtro = params.estado === 'todos' ? 'todos' : 'activos'
  const [personal, areas] = await Promise.all([listarTrabajadores(filtro), areasParaPersonal()])

  return (
    <>
      <EncabezadoPagina
        titulo="Personal"
        descripcion="La ficha de cada persona de planta y oficina: sus datos, la cuenta donde se le paga, su horario y lo que gana y lo que cuesta al mes. Con el horario, la marca del portero sabe si llegó tarde; con la remuneración se le paga en la planilla diaria; con el costo, sus horas se cargan a cada código interno."
        migas={[{ titulo: 'Recursos Humanos', ruta: planillas ? '/rrhh' : undefined }, { titulo: 'Personal' }]}
        acciones={gestiona && <NuevoTrabajador areas={areas} />}
      />

      <Vistas
        etiqueta="Filtro"
        className="mb-3"
        vistas={FILTROS.map((f) => ({
          clave: f.valor,
          titulo: f.titulo,
          href: f.valor === 'activos' ? '/rrhh/personal' : `/rrhh/personal?estado=${f.valor}`,
          activa: filtro === f.valor,
          cuenta: filtro === f.valor ? personal.length : undefined,
        }))}
      />

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Persona</TH>
              <TH className="hidden md:table-cell">Horario</TH>
              {gestiona && <TH className="hidden lg:table-cell">Cuenta</TH>}
              <TH>Estado</TH>
              {gestiona && (
                <TH className="text-right">
                  <span className="sr-only">Acciones</span>
                </TH>
              )}
            </tr>
          </TablaCabecera>
          <tbody>
            {personal.length === 0 ? (
              <SinDatos
                titulo={filtro === 'activos' ? 'No hay personal activo' : 'Todavía no hay nadie registrado'}
                descripcion={gestiona ? 'Registra a la primera persona con el botón de arriba.' : 'Recursos Humanos registra al personal.'}
              />
            ) : (
              personal.map((t) => <FilaTrabajador key={t.id} trabajador={t} areas={areas} gestiona={gestiona} />)
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}

function FilaTrabajador({
  trabajador: t,
  areas,
  gestiona,
}: {
  trabajador: Trabajador
  areas: { id: string; codigo: string; nombre: string }[]
  gestiona: boolean
}) {
  const horario = `${horaCorta(t.hora_entrada)} – ${horaCorta(t.hora_salida)}`
  return (
    <TR className={t.activo ? undefined : 'opacity-60'}>
      <TD className="align-top">
        <p className="font-semibold text-texto">
          {t.apellidos}, {t.nombres}
        </p>
        <p className="tabular text-xs text-texto-suave">DNI {t.dni}</p>
        {(t.cargo || t.area) && (
          <p className="text-xs text-texto">
            {t.cargo ?? 'Sin cargo'}
            {t.area && ` · ${t.area.nombre}`}
          </p>
        )}
        <p className="tabular text-[11px] text-texto-suave md:hidden">{horario}</p>
      </TD>
      <TD className="hidden align-top md:table-cell">
        <span className="tabular text-sm text-texto">{horario}</span>
      </TD>
      {gestiona && (
        <TD className="hidden align-top lg:table-cell">
          {t.cuenta ? (
            <>
              <p className="text-sm text-texto">
                {t.cuenta.banco} · {TIPO_CUENTA[t.cuenta.tipo_cuenta]?.etiqueta ?? t.cuenta.tipo_cuenta}
              </p>
              <p className="tabular text-xs text-texto-suave">{t.cuenta.numero_cuenta}</p>
              {t.cuenta.cci && <p className="tabular text-[11px] text-texto-suave">CCI {t.cuenta.cci}</p>}
            </>
          ) : (
            <span className="text-xs text-texto-suave">Sin cuenta</span>
          )}
          <p className="mt-1 text-[11px] text-texto-suave">
            {t.remuneracion_mensual ? (
              <>
                Gana <span className="tabular">{moneda(t.remuneracion_mensual)}</span> al mes ·{' '}
                <span className="tabular">{moneda(t.remuneracion_mensual / HORAS_DEL_MES)}</span> la hora
              </>
            ) : (
              'Sin remuneración mensual: sus horas validadas esperan para entrar a la planilla diaria'
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-texto-suave">
            {t.costo_mensual ? (
              <>
                Cuesta <span className="tabular">{moneda(t.costo_mensual)}</span> al mes ·{' '}
                <span className="tabular">{moneda(t.costo_mensual / HORAS_DEL_MES)}</span> la hora
              </>
            ) : (
              'Sin costo mensual: no se le pueden cargar horas, y las de los reportes diarios esperan a que se lo pongas'
            )}
          </p>
        </TD>
      )}
      <TD className="align-top">
        {t.activo ? <Insignia tono="exito">Activo</Insignia> : <Insignia tono="neutro">De baja</Insignia>}
      </TD>
      {gestiona && (
        <TD className="text-right align-top">
          <ControlesTrabajador trabajador={t} areas={areas} />
        </TD>
      )}
    </TR>
  )
}
