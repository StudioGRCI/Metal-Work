import { Camera } from "lucide-react";
import { notFound } from "next/navigation";

import { EncabezadoPagina } from "@/components/estructura/encabezado-pagina";
import { Insignia, type Tono } from "@/components/ui/etiqueta-estado";
import {
  Tarjeta,
  TarjetaCabecera,
  TarjetaCuerpo,
} from "@/components/ui/tarjeta";
import {
  cargarReporteSsoma,
  cuentasParaAsignar,
  historiaDeAccion,
  listarAccionesSsoma,
  seguimientoDe,
  seguimientoDeReportes,
  type AccionSsoma,
  type DetalleReporteSsoma,
  type FotoSsoma,
  type PasoDeAccion,
  type SeguimientoSsoma,
} from "@/lib/datos/ssoma";
import {
  CLASIFICACION_SSOMA,
  cuandoVence,
  diasEnEspera,
  ESTADO_ACCION_SSOMA,
  ESTADO_REPORTE_SSOMA,
  PASO_ACCION_SSOMA,
  TIPO_REPORTE_SSOMA,
} from "@/lib/dominio/ssoma";
import { fecha, fechaHora, hoyLima } from "@/lib/format";
import { exigirSesion, puede } from "@/lib/sesion";
import { cn } from "@/lib/utils";

import {
  AgregarAccion,
  AnularAccion,
  AnularReporte,
  CerrarAccion,
  ClasificarReporte,
  ReabrirAccion,
  ReasignarAccion,
} from "./controles";

export const metadata = { title: "Reporte de seguridad" };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La clase con que se empieza a clasificar, según lo que se reportó. */
const PROPUESTA: Record<string, string> = {
  ACCIDENTE: "ACCIDENTE_LEVE",
  INCIDENTE: "INCIDENTE",
  CONDICION_INSEGURA: "CONDICION_INSEGURA",
};

/**
 * Un reporte de seguridad: qué pasó, cómo lo clasificó SSOMA, qué se corrige,
 * su recorrido y sus fotos. Quien lo reportó ve cómo va; el área y quien tiene
 * una acción lo ven sin el nombre de quien reportó y sin las fotos; SSOMA y
 * Gerencia lo ven entero. Lo que cada quien ve lo decide la base.
 */
export default async function PaginaReporteSsoma({
  params,
}: PageProps<"/ssoma/[id]">) {
  const perfil = await exigirSesion();
  const { id } = await params;
  if (!GUID.test(id)) notFound();
  const r = await cargarReporteSsoma(id);
  if (!r) notFound();

  // El mismo permiso que piden las funciones de SSOMA en la base.
  const gestiona = puede(perfil, "ssoma.gestionar");
  const anulado = r.estado === "ANULADO";
  const [porReporte, acciones, cuentas] = await Promise.all([
    seguimientoDeReportes(id),
    listarAccionesSsoma({ reporte: id }),
    gestiona && !anulado ? cuentasParaAsignar() : Promise.resolve([]),
  ]);
  const seg = seguimientoDe(porReporte, id);
  // La historia y la evidencia, de las acciones que la base deja ver enteras.
  const historias = await Promise.all(
    acciones.map((a) =>
      a.alcance === "REPORTE" ? Promise.resolve([]) : historiaDeAccion(a.id),
    ),
  );
  const hoy = hoyLima();

  const tipo = TIPO_REPORTE_SSOMA[r.tipo];
  const estado = ESTADO_REPORTE_SSOMA[r.estado];
  const vigentes = acciones.filter((a) => a.estado !== "ANULADA").length;
  // Un reporte con acciones vigentes no se anula (`ssoma_anular_reporte`).
  const anula = gestiona && !anulado && vigentes === 0;
  const sinAutor = r.alcance === "AREA" || r.alcance === "ACCION";
  const veTodo = r.alcance === "TODOS";

  return (
    <>
      <EncabezadoPagina
        titulo={<span className="tabular">{r.numero}</span>}
        descripcion={`${tipo?.etiqueta ?? r.tipo} · ${r.area} · ${r.lugar}`}
        migas={[{ titulo: "SSOMA", ruta: "/ssoma" }, { titulo: r.numero }]}
        acciones={anula && <AnularReporte id={r.id} numero={r.numero} />}
      />

      <div className="space-y-5">
        <Tarjeta>
          <TarjetaCuerpo className="space-y-4">
            <div className="flex flex-wrap items-start gap-x-8 gap-y-3 text-sm">
              <Dato titulo="Qué se reporta">
                {tipo ? (
                  <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia>
                ) : (
                  r.tipo
                )}
              </Dato>
              <Dato titulo="Cómo va">
                {estado ? (
                  <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                ) : (
                  r.estado
                )}
              </Dato>
              <Dato titulo="Dónde">
                {r.area} · {r.lugar}
              </Dato>
              <Dato titulo="Cuándo pasó">{fechaHora(r.ocurrido_en)}</Dato>
              {r.hubo_atencion !== null && (
                <Dato titulo="Atención médica">
                  {r.hubo_atencion ? "Sí hubo" : "No hubo"}
                </Dato>
              )}
            </div>
            <div>
              <p className="text-xs text-texto-suave">
                {r.tipo === "CONDICION_INSEGURA" ? "Qué se vio" : "Qué pasó"}
              </p>
              <p className="mt-1 max-w-3xl text-sm whitespace-pre-wrap text-texto">
                {r.descripcion}
              </p>
            </div>
            {sinAutor && (
              <p className="text-xs text-texto-suave" data-alcance-area>
                {r.alcance === "ACCION"
                  ? "Lo ves porque tienes a cargo una acción correctiva de este reporte. Quién lo reportó y las fotos los ven solo SSOMA y Gerencia."
                  : "Lo ves porque pasó en tu área. Quién lo reportó y las fotos los ven solo SSOMA y Gerencia."}
              </p>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        {veTodo && (
          <Clasificacion
            reporte={r}
            seg={seg}
            boton={
              gestiona && !anulado ? (
                <ClasificarReporte
                  id={r.id}
                  numero={r.numero}
                  propuesta={PROPUESTA[r.tipo] ?? "INCIDENTE"}
                  atencionReportada={r.hubo_atencion}
                  actual={
                    seg.clasificacion && seg.causa
                      ? {
                          clasificacion: seg.clasificacion,
                          hubo_atencion: seg.hubo_atencion,
                          dias_perdidos: seg.dias_perdidos,
                          causa: seg.causa,
                        }
                      : null
                  }
                />
              ) : null
            }
          />
        )}

        {!anulado && (
          <Tarjeta id="acciones" className="scroll-mt-20">
            <TarjetaCabecera
              titulo={`Acciones correctivas${vigentes > 0 ? ` · ${vigentes}` : ""}`}
              descripcion={resumenDeAcciones(seg)}
              ayuda="Qué se corrige para que no vuelva a pasar, quién lo hace y hasta cuándo. Las cierra su responsable con fotos de lo que hizo; SSOMA las revisa."
              acciones={
                gestiona && r.estado !== "REPORTADO" ? (
                  <AgregarAccion
                    reporteId={r.id}
                    numero={r.numero}
                    cuentas={cuentas}
                    hoy={hoy}
                  />
                ) : null
              }
            />
            <TarjetaCuerpo>
              {acciones.length === 0 ? (
                <p className="text-sm text-texto-suave" data-sin-acciones>
                  {r.estado === "REPORTADO"
                    ? gestiona
                      ? "Primero clasifica el reporte y anota la causa: después encargas qué se corrige."
                      : "SSOMA lo está revisando: cuando lo clasifique, aquí verás qué se corrige y quién."
                    : gestiona
                      ? "Todavía no hay acciones. Agrega la primera: qué se hace, quién y hasta cuándo."
                      : "SSOMA todavía no definió qué se corrige."}
                </p>
              ) : (
                <ul className="divide-y divide-borde">
                  {acciones.map((a, i) => (
                    <FilaAccion
                      key={a.id}
                      accion={a}
                      historia={historias[i] ?? []}
                      esMia={a.responsable_id === perfil.id}
                      gestiona={gestiona}
                      cuentaId={perfil.id}
                      cuentas={cuentas}
                      hoy={hoy}
                    />
                  ))}
                </ul>
              )}
            </TarjetaCuerpo>
          </Tarjeta>
        )}

        <Recorrido reporte={r} seg={seg} />

        {!sinAutor && (
          <Tarjeta>
            <TarjetaCabecera
              titulo={`Fotos${r.fotosDelReporte.length > 0 ? ` · ${r.fotosDelReporte.length}` : ""}`}
            />
            <TarjetaCuerpo>
              {r.fotosDelReporte.length === 0 ? (
                <p className="text-sm text-texto-suave">
                  El reporte se envió sin fotos.
                </p>
              ) : (
                <Galeria
                  fotos={r.fotosDelReporte}
                  texto={(f) => `Foto ${f.orden} del reporte ${r.numero}`}
                />
              )}
            </TarjetaCuerpo>
          </Tarjeta>
        )}
      </div>
    </>
  );
}

function Dato({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-texto-suave">{titulo}</p>
      <div className="tabular text-texto">{children}</div>
    </div>
  );
}

function Galeria({
  fotos,
  texto,
}: {
  fotos: FotoSsoma[];
  texto: (f: FotoSsoma) => string;
}) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {fotos.map((f) => (
        <li key={f.id}>
          {f.enlace ? (
            <a
              href={f.enlace}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-lg border border-borde"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado de Storage, no pasa por el optimizador */}
              <img
                src={f.enlace}
                alt={texto(f)}
                className="aspect-square w-full object-cover"
                loading="lazy"
              />
            </a>
          ) : (
            <p className="flex aspect-square items-center justify-center rounded-lg border border-borde p-2 text-center text-xs text-texto-suave">
              La foto {f.orden} no se pudo abrir ahora
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** «2 abiertas, 1 vencida · 1 cerrada»: lo que hay que ver de un vistazo. */
function resumenDeAcciones(seg: SeguimientoSsoma) {
  if (seg.acciones === 0) return undefined;
  const partes = [
    seg.abiertas > 0 &&
      `${seg.abiertas} ${seg.abiertas === 1 ? "abierta" : "abiertas"}`,
    seg.vencidas > 0 &&
      `${seg.vencidas} ${seg.vencidas === 1 ? "vencida" : "vencidas"}`,
    seg.cerradas > 0 &&
      `${seg.cerradas} ${seg.cerradas === 1 ? "cerrada" : "cerradas"}`,
  ].filter(Boolean);
  return partes.join(" · ");
}

/** La clasificación de SSOMA, con su causa: solo para SSOMA y Gerencia. */
function Clasificacion({
  reporte: r,
  seg,
  boton,
}: {
  reporte: DetalleReporteSsoma;
  seg: SeguimientoSsoma;
  boton: React.ReactNode;
}) {
  const clase = seg.clasificacion
    ? CLASIFICACION_SSOMA[seg.clasificacion]
    : null;
  return (
    <Tarjeta data-clasificacion>
      <TarjetaCabecera
        titulo="Clasificación y causa"
        descripcion={
          seg.clasificacion
            ? undefined
            : r.estado === "ANULADO"
              ? "Se anuló sin clasificar."
              : "Todavía sin clasificar."
        }
        ayuda="Con las clases del registro de la R.M. 050-2013-TR. La ven solo SSOMA y Gerencia: la causa puede nombrar a alguien."
        acciones={boton}
      />
      {seg.clasificacion && (
        <TarjetaCuerpo className="space-y-4">
          <div className="flex flex-wrap items-start gap-x-8 gap-y-3 text-sm">
            <Dato titulo="Clasificación">
              {clase ? (
                <Insignia tono={clase.tono}>{clase.etiqueta}</Insignia>
              ) : (
                seg.clasificacion
              )}
            </Dato>
            {seg.hubo_atencion !== null && (
              <Dato titulo="Atención médica">
                {seg.hubo_atencion ? "Sí hubo" : "No hubo"}
              </Dato>
            )}
            {seg.dias_perdidos !== null && (
              <Dato titulo="Días perdidos">
                {seg.dias_perdidos} {seg.dias_perdidos === 1 ? "día" : "días"}
              </Dato>
            )}
          </div>
          <div>
            <p className="text-xs text-texto-suave">Causa</p>
            <p className="mt-1 max-w-3xl text-sm whitespace-pre-wrap text-texto">
              {seg.causa}
            </p>
          </div>
          {seg.clasificado_en && (
            <p className="tabular text-xs text-texto-suave">
              Clasificó {seg.clasifico ?? "SSOMA"} ·{" "}
              {fechaHora(seg.clasificado_en)}
            </p>
          )}
        </TarjetaCuerpo>
      )}
    </Tarjeta>
  );
}

/**
 * Una acción: qué se corrige, quién, hasta cuándo y cómo va, con lo que puede
 * hacer quien mira. Su historia y su evidencia, para quien la base deja verlas.
 */
function FilaAccion({
  accion: a,
  historia,
  esMia,
  gestiona,
  cuentaId,
  cuentas,
  hoy,
}: {
  accion: AccionSsoma;
  historia: PasoDeAccion[];
  esMia: boolean;
  gestiona: boolean;
  cuentaId: string;
  cuentas: Awaited<ReturnType<typeof cuentasParaAsignar>>;
  hoy: string;
}) {
  const estado = ESTADO_ACCION_SSOMA[a.estado];
  const vence = a.estado === "ABIERTA" ? cuandoVence(a.dias_para_vencer) : null;
  const vencida = (a.dias_para_vencer ?? 0) < 0 && a.estado === "ABIERTA";
  const abierta = a.estado === "ABIERTA";
  const cierra = abierta && (esMia || gestiona);
  const ultimoCierre = [...historia]
    .reverse()
    .find((p) => p.tipo === "CERRADA");
  return (
    <li
      id={`accion-${a.id}`}
      className={cn(
        "scroll-mt-20 py-4 first:pt-0 last:pb-0 target:rounded-lg target:bg-acento-suave/40",
        a.estado === "ANULADA" && "opacity-80",
      )}
      data-accion-ssoma={a.id}
      data-estado={a.estado}
      data-vencida={vencida || undefined}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {estado ? (
              <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
            ) : (
              a.estado
            )}
            {vence && (
              <Insignia tono={vence.tono}>
                <span className="tabular">{vence.texto}</span>
              </Insignia>
            )}
            {esMia && abierta && (
              <span className="text-xs font-medium text-acento">
                A tu cargo
              </span>
            )}
          </div>
          <p
            className={cn(
              "max-w-3xl text-sm whitespace-pre-wrap text-texto",
              a.estado === "ANULADA" && "line-through decoration-texto-tenue",
            )}
          >
            {a.descripcion}
          </p>
          <p className="tabular text-xs text-texto-suave">
            {a.responsable}
            {a.responsable_puesto ? ` · ${a.responsable_puesto}` : ""} · hasta
            el {fecha(a.fecha_limite)}
          </p>
          {a.estado === "CERRADA" && (
            <div className="mt-2 rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-xs text-texto">
              <p className="tabular text-texto-suave">
                Cerró {a.cerro ?? "el responsable"}
                {a.cerrado_en ? ` · ${fechaHora(a.cerrado_en)}` : ""}
                {a.fotos > 0 && (
                  <span className="ml-1 inline-flex items-center gap-1">
                    · <Camera aria-hidden className="size-3.5" /> {a.fotos}{" "}
                    {a.fotos === 1 ? "foto" : "fotos"}
                  </span>
                )}
              </p>
              {a.nota_cierre && (
                <p className="mt-1 whitespace-pre-wrap">{a.nota_cierre}</p>
              )}
            </div>
          )}
          {a.estado === "ANULADA" && a.motivo_anulacion && (
            <p className="text-xs text-texto-suave">
              Anulada: {a.motivo_anulacion}
            </p>
          )}
          {ultimoCierre &&
            ultimoCierre.fotosDelCierre.length > 0 &&
            a.estado === "CERRADA" && (
              <div className="pt-2">
                <Galeria
                  fotos={ultimoCierre.fotosDelCierre}
                  texto={(f) => `Foto ${f.orden} de la evidencia`}
                />
              </div>
            )}
        </div>
        {(cierra || (gestiona && a.estado !== "ANULADA")) && (
          <div className="flex flex-wrap items-start gap-2 sm:justify-end">
            {cierra && (
              <CerrarAccion
                accionId={a.id}
                cuentaId={cuentaId}
                descripcion={a.descripcion}
              />
            )}
            {gestiona && abierta && (
              <ReasignarAccion
                id={a.id}
                responsableId={a.responsable_id}
                fechaLimite={a.fecha_limite}
                cuentas={cuentas}
                hoy={hoy}
              />
            )}
            {gestiona && abierta && <AnularAccion id={a.id} />}
            {gestiona && a.estado === "CERRADA" && (
              <ReabrirAccion id={a.id} hoy={hoy} />
            )}
          </div>
        )}
      </div>
      {historia.length > 1 && <HistoriaDeAccion pasos={historia} />}
    </li>
  );
}

function HistoriaDeAccion({ pasos }: { pasos: PasoDeAccion[] }) {
  return (
    <details
      className="group mt-3 rounded-lg border border-borde"
      data-historia-accion
    >
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-xs font-medium text-texto-suave hover:text-texto sm:min-h-9">
        Historia · {pasos.length} pasos
      </summary>
      <ol className="space-y-3 border-t border-borde px-3 py-3">
        {pasos.map((p) => (
          <li key={p.id} className="text-xs">
            <p className="text-texto">
              <span className="font-medium">
                {PASO_ACCION_SSOMA[p.tipo] ?? p.tipo}
              </span>
              <span className="text-texto-suave">
                {" "}
                · {p.hizo}
                {p.hizo_puesto ? ` (${p.hizo_puesto})` : ""}
              </span>
            </p>
            <time
              dateTime={p.creado_en}
              className="tabular block text-texto-suave"
            >
              {fechaHora(p.creado_en)}
            </time>
            {(p.tipo === "ASIGNADA" ||
              p.tipo === "REASIGNADA" ||
              p.tipo === "REABIERTA") && (
              <p className="tabular text-texto-suave">
                A cargo de {p.responsable ?? "—"}
                {p.fecha_limite ? `, hasta el ${fecha(p.fecha_limite)}` : ""}
              </p>
            )}
            {p.nota && (
              <p className="mt-0.5 max-w-2xl whitespace-pre-wrap text-texto-suave">
                {p.nota}
              </p>
            )}
            {p.tipo === "CERRADA" && p.fotosDelCierre.length > 0 && (
              <div className="mt-2 max-w-md">
                <Galeria
                  fotos={p.fotosDelCierre}
                  texto={(f) =>
                    `Foto ${f.orden} del cierre del ${fechaHora(p.creado_en)}`
                  }
                />
              </div>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

type Paso = {
  clave: string;
  titulo: string;
  /** Quién lo hizo o quién lo tiene. */
  quien: string | null;
  cuando: string | null;
  detalle: string | null;
  tono: Tono;
  /** El paso donde está ahora: todavía no terminó. */
  actual?: boolean;
};

const PUNTO: Partial<Record<Tono, string>> = {
  exito: "bg-exito",
  aviso: "bg-aviso",
  peligro: "bg-peligro",
  info: "bg-info",
  neutro: "bg-texto-tenue",
};

/**
 * El recorrido del reporte: quién lo tiene y desde cuándo. Sale de la fila
 * misma y de su seguimiento. Cuando el componente «Recorrido» del Plan 0 esté
 * en main, este bloque se cambia por él; los pasos son los mismos.
 */
function pasosDe(r: DetalleReporteSsoma, seg: SeguimientoSsoma): Paso[] {
  const sinAutor = r.alcance === "AREA" || r.alcance === "ACCION";
  const pasos: Paso[] = [
    {
      clave: "reportado",
      titulo: "Reportado",
      quien: sinAutor
        ? null
        : [
            r.reporto &&
              [r.reporto, r.reporto_puesto].filter(Boolean).join(" · "),
            r.a_nombre_de &&
              `a nombre de ${r.a_nombre_de}${r.a_nombre_de_cargo ? ` (${r.a_nombre_de_cargo})` : ""}`,
          ]
            .filter(Boolean)
            .join(", ") || null,
      cuando: r.creado_en,
      detalle: null,
      tono: "exito",
    },
  ];
  if (r.estado === "ANULADO") {
    pasos.push({
      clave: "anulado",
      titulo: "Anulado por SSOMA",
      quien: r.anulo,
      cuando: r.anulado_en,
      detalle: r.motivo_anulacion,
      tono: "neutro",
    });
    return pasos;
  }
  if (r.estado === "REPORTADO") {
    const espera = diasEnEspera(r.dias_en_espera);
    pasos.push({
      clave: "en-ssoma",
      titulo: "Lo tiene SSOMA",
      quien: espera ? `desde ${espera}` : null,
      cuando: null,
      detalle:
        "SSOMA lo revisa, anota la causa y define qué se corrige y quién.",
      tono: "aviso",
      actual: true,
    });
    return pasos;
  }
  pasos.push({
    clave: "clasificado",
    titulo: "Clasificado por SSOMA",
    quien: seg.clasifico,
    cuando: seg.clasificado_en,
    detalle: null,
    tono: "exito",
  });
  if (r.estado === "CERRADO") {
    pasos.push({
      clave: "corregido",
      titulo: "Corregido",
      quien: `${seg.cerradas} ${seg.cerradas === 1 ? "acción cerrada" : "acciones cerradas"} con evidencia`,
      cuando: seg.cerrado_en,
      detalle: null,
      tono: "exito",
    });
  } else {
    pasos.push({
      clave: "en-correccion",
      titulo:
        seg.acciones === 0 ? "SSOMA define qué se corrige" : "En corrección",
      quien:
        seg.acciones === 0
          ? null
          : `${seg.cerradas} de ${seg.acciones} ${seg.acciones === 1 ? "acción cerrada" : "acciones cerradas"}${seg.vencidas > 0 ? ` · ${seg.vencidas} ${seg.vencidas === 1 ? "vencida" : "vencidas"}` : ""}`,
      cuando: null,
      detalle:
        seg.acciones === 0
          ? null
          : "Se cierra cuando todas sus acciones estén cerradas con evidencia.",
      tono: seg.vencidas > 0 ? "peligro" : "aviso",
      actual: true,
    });
  }
  return pasos;
}

function Recorrido({
  reporte,
  seg,
}: {
  reporte: DetalleReporteSsoma;
  seg: SeguimientoSsoma;
}) {
  const pasos = pasosDe(reporte, seg);
  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Recorrido"
        ayuda="Por dónde va el reporte: quién lo tiene ahora y desde cuándo."
      />
      <TarjetaCuerpo>
        <ol className="space-y-0" data-recorrido>
          {pasos.map((p, i) => (
            <li
              key={p.clave}
              className="relative flex gap-3 pb-4 last:pb-0"
              aria-current={p.actual ? "step" : undefined}
            >
              {i < pasos.length - 1 && (
                <span
                  aria-hidden
                  className="absolute top-5 bottom-0 left-[5px] w-px bg-borde"
                />
              )}
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-[var(--superficie)]",
                  PUNTO[p.tono] ?? "bg-acento",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-texto">
                  {p.titulo}
                  {p.quien && (
                    <span className="font-normal text-texto-suave">
                      {" "}
                      · {p.quien}
                    </span>
                  )}
                </p>
                {p.cuando && (
                  <time
                    dateTime={p.cuando}
                    className="tabular block text-xs text-texto-suave"
                  >
                    {fechaHora(p.cuando)}
                  </time>
                )}
                {p.detalle && (
                  <p className="mt-0.5 max-w-2xl text-xs whitespace-pre-wrap text-texto-suave">
                    {p.detalle}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </TarjetaCuerpo>
    </Tarjeta>
  );
}
