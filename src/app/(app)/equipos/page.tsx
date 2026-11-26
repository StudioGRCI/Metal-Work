import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Paginacion } from '@/components/estructura/paginacion'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import {
  areasDeEquipo,
  categoriasDeEquipo,
  codigosQueSiguen,
  contarEquipos,
  EQUIPOS_POR_PAGINA,
  historiaDeEquipos,
  listarEquipos,
} from '@/lib/datos/equipos'
import { notaDelParo } from '@/lib/dominio/averias'
import { palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { cuantosEquipos, ESTADO_EQUIPO, FILTRO_DE_ESTADO } from '@/lib/dominio/equipos'
import { paginaPedida } from '@/lib/dominio/paginas'
import { fecha } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AccionesEquipo, AvisoDelPadron, CategoriasDeEquipo, NuevoEquipo } from './formulario'
import { LecturaDeEquipos } from './lectura'

export const metadata = { title: 'Equipos' }

const uno = (valor: string | string[] | undefined) => (typeof valor === 'string' && valor ? valor : undefined)
// Un id con otra forma en la URL no filtra nada, en vez de hacer caer la consulta.
const FORMA_DE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaginaEquipos({ searchParams }: PageProps<'/equipos'>) {
  // Cualquiera de los tres basta para leer, igual que la política `ver_equipos`.
  const perfil = await exigirPermiso(['equipos.ver', 'equipos.gestionar', 'equipos.asignar'])
  const params = await searchParams
  const gestiona = puede(perfil, 'equipos.gestionar')
  const asigna = puede(perfil, 'equipos.asignar')

  const busqueda = typeof params.q === 'string' && palabrasDeBusqueda(params.q).length > 0 ? params.q : undefined
  const deBaja = params.ver === 'de-baja'
  const filtroEstado = uno(params.estado)
  const estado = filtroEstado ? FILTRO_DE_ESTADO[filtroEstado] : undefined

  const pedida = uno(params.categoria)
  const categoria = pedida && FORMA_DE_ID.test(pedida) ? pedida : undefined

  const conFiltro = Boolean(busqueda || (!deBaja && (estado || categoria)))
  // La lectura de Gerencia (Plan 16.4), arriba del padrón sin filtros: los
  // parados hoy y los que más fallan. La historia la cuenta la base. Se pide
  // junto con lo demás, sin esperar a la cuenta.
  const pideLectura = !deBaja && !conFiltro

  const [categorias, areas, cuenta, siguientes, lista, historia, parados] = await Promise.all([
    categoriasDeEquipo(),
    areasDeEquipo(),
    contarEquipos(),
    gestiona ? codigosQueSiguen() : Promise.resolve({} as Record<string, string>),
    listarEquipos({
      busqueda,
      estado: deBaja ? undefined : estado,
      categoria: deBaja ? undefined : categoria,
      deBaja,
      pagina: paginaPedida(params.pagina),
    }),
    pideLectura ? historiaDeEquipos() : null,
    pideLectura ? listarEquipos({ estado: 'PARADO' }) : null,
  ])
  // Quien no ve todas las averías (Almacén) no lee en la nota del paro lo que
  // escribió quien la reportó: solo su número. Se limpia antes de pintar, y
  // también lo que va al navegador con «Acciones».
  const veTodasLasAverias = puede(perfil, 'averias.atender') || puede(perfil, 'averias.ver')
  const sinTextoAjeno = <T extends { estado_nota: string | null }>(e: T): T => ({ ...e, estado_nota: notaDelParo(e.estado_nota, veTodasLasAverias) })
  const { total, pagina, paginas } = lista
  const equipos = lista.equipos.map(sinTextoAjeno)
  const conLectura = pideLectura && cuenta.enUso > 0 && historia !== null && historia.size > 0

  const resumen = deBaja
    ? `${cuantosEquipos(cuenta.deBaja)} ${cuenta.deBaja === 1 ? 'dado' : 'dados'} de baja`
    : cuenta.enUso === 0
      ? 'Todavía no hay equipos en el padrón'
      : [
          `${cuantosEquipos(cuenta.enUso)} en el padrón`,
          cuenta.porEstado.PARADO > 0 ? `${cuenta.porEstado.PARADO} ${cuenta.porEstado.PARADO === 1 ? 'parado' : 'parados'}` : null,
          cuenta.porEstado.CON_OBSERVACION > 0 ? `${cuenta.porEstado.CON_OBSERVACION} con observación` : null,
        ]
          .filter(Boolean)
          .join(' · ')

  const columnas = 5 + (gestiona || asigna ? 1 : 0)
  const categoriasConEquipos = categorias.filter((c) => (cuenta.porCategoria[c.id] ?? 0) > 0 || c.id === categoria)

  return (
    <>
      <EncabezadoPagina
        titulo="Equipos"
        descripcion={resumen}
        ayuda="El padrón de máquinas, herramientas y equipos de cómputo de la planta. Lo lleva Mantenimiento; Almacén anota quién tiene cada uno. Un equipo no se borra: se da de baja desde «Editar», y si fue un error se reactiva diciendo por qué."
        acciones={
          <div className="flex flex-wrap items-center gap-3">
            {gestiona && <NuevoEquipo categorias={categorias} areas={areas} siguientes={siguientes} />}
            {gestiona && <CategoriasDeEquipo categorias={categorias} />}
          </div>
        }
      />

      {(gestiona || asigna) && <AvisoDelPadron />}
      {conLectura && historia && (
        <LecturaDeEquipos parados={(parados?.equipos ?? []).map(sinTextoAjeno)} totalParados={parados?.total ?? 0} historia={historia} />
      )}
      <div className="space-y-3">
        <BuscadorSimple ruta="/equipos" etiqueta="Buscar equipos" marcador="Código, nombre, marca o serie" />
        {(cuenta.deBaja > 0 || deBaja) && (
          <PastillaFiltro
            ruta="/equipos"
            clave="ver"
            params={params}
            activo={deBaja ? 'de-baja' : null}
            etiqueta="En uso o dados de baja"
            opciones={[
              { valor: null, etiqueta: `En uso (${cuenta.enUso})` },
              { valor: 'de-baja', etiqueta: `Dados de baja (${cuenta.deBaja})` },
            ]}
          />
        )}
        {!deBaja && cuenta.enUso > 0 && (
          <PastillaFiltro
            ruta="/equipos"
            clave="estado"
            params={params}
            activo={estado ? filtroEstado : null}
            etiqueta="Estado del equipo"
            opciones={[
              { valor: null, etiqueta: `Todos (${cuenta.enUso})` },
              { valor: 'parados', etiqueta: `Parados (${cuenta.porEstado.PARADO})` },
              { valor: 'con-observacion', etiqueta: `Con observación (${cuenta.porEstado.CON_OBSERVACION})` },
              { valor: 'operativos', etiqueta: `Operativos (${cuenta.porEstado.OPERATIVO})` },
            ]}
          />
        )}
        {!deBaja && categoriasConEquipos.length > 1 && (
          <PastillaFiltro
            ruta="/equipos"
            clave="categoria"
            params={params}
            activo={categoria ?? null}
            etiqueta="Categoría"
            opciones={[
              { valor: null, etiqueta: 'Todas las categorías' },
              ...categoriasConEquipos.map((c) => ({ valor: c.id, etiqueta: `${c.nombre} (${cuenta.porCategoria[c.id] ?? 0})` })),
            ]}
          />
        )}
      </div>

      <Tarjeta className="mt-4 overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Equipo</TH>
              {/* En el teléfono, categoría, área, quién lo tiene y el estado bajan
                  a la celda del equipo: así caben sin correr la tabla de lado. */}
              <TH className="hidden md:table-cell">Categoría</TH>
              <TH className="hidden md:table-cell">Área y ubicación</TH>
              <TH className="hidden lg:table-cell">A cargo de</TH>
              <TH className="hidden sm:table-cell">{deBaja ? 'Baja' : 'Estado'}</TH>
              {(gestiona || asigna) && <TH>Acciones</TH>}
            </tr>
          </TablaCabecera>
          <tbody>
            {equipos.length === 0 ? (
              <SinDatos
                colSpan={columnas}
                titulo={
                  conFiltro
                    ? 'Ningún equipo coincide'
                    : deBaja
                      ? 'No hay equipos dados de baja'
                      : 'Aún no hay equipos en el padrón'
                }
                descripcion={
                  conFiltro
                    ? 'Prueba con menos palabras, con el código o quitando un filtro.'
                    : deBaja
                      ? 'Los que se den de baja quedan aquí, con su motivo.'
                      : gestiona
                        ? 'Registra el primero con «Nuevo equipo»: si dejas el código vacío, toma el que sigue en su categoría.'
                        : 'Mantenimiento los registra; aquí aparecerán.'
                }
              />
            ) : (
              equipos.map((e) => {
                const def = ESTADO_EQUIPO[e.estado]
                const donde = [e.area?.nombre, e.ubicacion].filter(Boolean).join(' · ')
                const series = [e.serie_maquina && `Serie ${e.serie_maquina}`, e.serie_cabezal && `Cabezal ${e.serie_cabezal}`].filter(Boolean).join(' · ')
                const estadoODeBaja = e.activo ? (
                  <>
                    <Insignia tono={def.tono}>{def.etiqueta}</Insignia>
                    {e.estado !== 'OPERATIVO' && (
                      <>
                        <p className="mt-1 text-xs text-texto">{e.estado_nota}</p>
                        <p className="text-xs text-texto-suave">Desde el {fecha(e.estado_desde)}</p>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <Insignia tono="neutro">Dado de baja</Insignia>
                    <p className="mt-1 text-xs text-texto">{e.baja_motivo}</p>
                    <p className="text-xs text-texto-suave">
                      Desde el {fecha(e.dado_de_baja_en)}
                      {e.baja && ` · por ${[e.baja.nombres, e.baja.apellidos].filter(Boolean).join(' ')}`}
                    </p>
                  </>
                )
                return (
                  <TR key={e.id}>
                    <TD>
                      {/* El código lleva a su historia: averías, tiempo parado y repetidas. */}
                      <Link href={`/equipos/${e.id}`} className="inline-flex min-h-11 items-center font-medium text-acento hover:underline sm:min-h-0">
                        <span>
                          <span className="tabular">{e.codigo}</span>
                          <span className="font-normal text-texto-suave"> · </span>
                          {e.descripcion}
                        </span>
                      </Link>
                      {(e.marca || series) && <p className="text-xs text-texto-suave">{[e.marca, series].filter(Boolean).join(' · ')}</p>}
                      <p className="text-xs text-texto-suave md:hidden">{[e.categoria?.nombre, donde].filter(Boolean).join(' · ')}</p>
                      {e.a_cargo_de && <p className="text-xs text-texto-suave lg:hidden">A cargo de {e.a_cargo_de}</p>}
                      <div className="mt-1.5 sm:hidden">{estadoODeBaja}</div>
                    </TD>
                    <TD className="hidden text-texto-suave md:table-cell">{e.categoria?.nombre ?? '—'}</TD>
                    <TD className="hidden text-texto-suave md:table-cell">{donde || <span className="text-aviso">Sin área</span>}</TD>
                    <TD className="hidden text-texto-suave lg:table-cell">{e.a_cargo_de ?? '—'}</TD>
                    <TD className="hidden sm:table-cell">{estadoODeBaja}</TD>
                    {(gestiona || asigna) && (
                      <TD>
                        <AccionesEquipo equipo={e} gestiona={gestiona} asigna={asigna} categorias={categorias} areas={areas} />
                      </TD>
                    )}
                  </TR>
                )
              })
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      <Paginacion ruta="/equipos" pagina={pagina} paginas={paginas} total={total} porPagina={EQUIPOS_POR_PAGINA} params={params} />
    </>
  )
}
