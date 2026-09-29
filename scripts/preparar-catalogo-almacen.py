"""Genera una migración reproducible desde la hoja COD-ALM del catálogo de Almacén.

Los códigos repetidos conservan el código original como referencia y reciben
un código interno con la fila de origen. Las filas idénticas representan un
solo material; la tabla de procedencia conserva cada fila y proveedor.
"""

from __future__ import annotations

import argparse
import collections
import re
import unicodedata
from pathlib import Path

import openpyxl


def literal(value: object) -> str:
    if value is None or str(value).strip() == "":
        return "null"
    return "'" + str(value).strip().replace("'", "''") + "'"


def code_for_family(family: str) -> str:
    text = unicodedata.normalize("NFKD", family.replace("�", "O"))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return "ALM_" + re.sub(r"[^A-Z0-9]+", "_", text.upper()).strip("_")[:60]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("excel", type=Path)
    parser.add_argument("salida", type=Path)
    args = parser.parse_args()
    sheet = openpyxl.load_workbook(args.excel, read_only=True, data_only=True)["COD-ALM"]
    rows: list[tuple[int, str, str, str, str, str | None]] = []
    for number, row in enumerate(sheet.iter_rows(values_only=True), 1):
        if len(row) < 10 or row[8] is None or row[9] is None:
            continue
        code, description = str(row[8]).strip(), str(row[9]).strip()
        if code == "COD DE PRODUCTO" or not code or not description:
            continue
        if len(description) > 200:
            raise ValueError(f"Descripción de más de 200 caracteres en fila {number}")
        family = str(row[3]).strip().replace("�", "Ó")
        subfamily = str(row[4]).strip().replace("�", "Ó") if row[4] else ""
        supplier = str(row[11]).strip() if len(row) > 11 and row[11] else None
        rows.append((number, code, description, family, subfamily, supplier))

    if not rows:
        raise ValueError("No hay materiales en COD-ALM")
    if len({r[0] for r in rows}) != len(rows):
        raise ValueError("Hay filas de origen repetidas")
    families = sorted({r[3] for r in rows})
    family_codes = {family: code_for_family(family) for family in families}
    if len(set(family_codes.values())) != len(families):
        raise ValueError("Dos familias producen el mismo código de categoría")

    header = """-- Generada por scripts/preparar-catalogo-almacen.py desde COD-ALM.
-- El Excel no incluye unidad: UND es provisional y debe confirmarla Almacén.
-- Los códigos repetidos reciben sufijo de fila; el original siempre se conserva.
alter table public.materiales add column if not exists codigo_almacen_origen text;
alter table public.materiales add column if not exists unidad_pendiente boolean not null default false;

create table if not exists public.catalogo_almacen_fuente (
  fila_excel integer primary key check (fila_excel > 0),
  material_id uuid not null references public.materiales(id) on delete restrict,
  codigo_original text not null,
  descripcion_original text not null,
  familia_original text not null,
  subfamilia_original text,
  proveedor_original text,
  creado_en timestamptz not null default now()
);
create index if not exists idx_catalogo_almacen_fuente_material
  on public.catalogo_almacen_fuente(material_id);
alter table public.catalogo_almacen_fuente enable row level security;
revoke all on public.catalogo_almacen_fuente from public, anon, authenticated;

create temporary table _catalogo_almacen_excel (
  fila integer primary key, codigo text not null, descripcion text not null,
  familia text not null, subfamilia text, proveedor text
) on commit drop;
insert into _catalogo_almacen_excel
  (fila, codigo, descripcion, familia, subfamilia, proveedor) values
"""
    values = [
        "  (" + ", ".join([str(row[0]), *(literal(v) for v in row[1:])]) + ")"
        for row in rows
    ]
    categories = ",\n".join(
        f"  ({literal(family_codes[f])}, {literal(f)}, true)" for f in families
    )
    footer = """;

insert into public.categorias_material (codigo, nombre, activo)
values
""" + categories + """
on conflict (codigo) do nothing;

create temporary table _catalogo_almacen_producto on commit drop as
with productos as (
  select codigo, descripcion, min(fila) as fila, min(familia) as familia
  from _catalogo_almacen_excel group by codigo, descripcion
), codigos as (
  select codigo, count(*) as productos from productos group by codigo
)
select p.codigo as codigo_original, p.descripcion, p.fila, p.familia,
  case when c.productos > 1 then p.codigo || '-F' || lpad(p.fila::text, 4, '0')
       else p.codigo end as codigo_interno
from productos p join codigos c using (codigo);

do $$
begin
  if exists (select 1 from _catalogo_almacen_producto p
    join public.materiales m on m.codigo = p.codigo_interno
    where m.descripcion <> p.descripcion) then
    raise exception 'Un código del Excel coincide con otro material existente.';
  end if;
end;
$$;

insert into public.materiales
  (codigo, descripcion, categoria_id, unidad_medida_id,
   codigo_almacen_origen, unidad_pendiente, activo)
select p.codigo_interno, p.descripcion, c.id, u.id,
  p.codigo_original, true, true
from _catalogo_almacen_producto p
join public.categorias_material c on c.codigo = case
""" + "\n".join(
        f"  when p.familia = {literal(f)} then {literal(family_codes[f])}"
        for f in families
    ) + """
end
join public.unidades_medida u on u.codigo = 'UND'
on conflict (codigo) do nothing;

insert into public.catalogo_almacen_fuente
  (fila_excel, material_id, codigo_original, descripcion_original,
   familia_original, subfamilia_original, proveedor_original)
select e.fila, m.id, e.codigo, e.descripcion,
  e.familia, e.subfamilia, e.proveedor
from _catalogo_almacen_excel e
join _catalogo_almacen_producto p
  on p.codigo_original = e.codigo and p.descripcion = e.descripcion
join public.materiales m on m.codigo = p.codigo_interno
on conflict (fila_excel) do nothing;

do $$
begin
  if (select count(*) from public.catalogo_almacen_fuente) <
     (select count(*) from _catalogo_almacen_excel) then
    raise exception 'La importación no conservó todas las filas del Excel.';
  end if;
end;
$$;
"""
    args.salida.write_text(header + ",\n".join(values) + footer, encoding="utf-8")
    counts = collections.Counter(row[1] for row in rows)
    print(
        f"{len(rows)} filas, {len(set((r[1], r[2]) for r in rows))} productos, "
        f"{sum(n > 1 for n in counts.values())} códigos repetidos, "
        f"{len(families)} familias -> {args.salida}"
    )


if __name__ == "__main__":
    main()
