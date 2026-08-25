#!/usr/bin/env node
/**
 * Genera src/types/database.ts a partir del esquema real de Postgres.
 *
 * Lee por la entrada estándar el JSON que produce db/tools/introspeccion.sql,
 * de modo que funciona igual contra la base local de pruebas y contra el
 * proyecto de Supabase, sin necesidad de Docker.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const esquema = JSON.parse(readFileSync(0, 'utf8'))

const enumsDeclarados = new Set(esquema.enums.map((e) => e.nombre))

/** Traduce el token que emite la introspección al tipo TypeScript final. */
function tipo(token) {
  const arreglo = token.endsWith('[]')
  const base = arreglo ? token.slice(0, -2) : token
  const resuelto = base.startsWith('enum:')
    ? enumsDeclarados.has(base.slice(5))
      ? `Database["public"]["Enums"]["${base.slice(5)}"]`
      : 'string'
    : base
  return arreglo ? `${resuelto}[]` : resuelto
}

function campo(col, modo) {
  const t = tipo(col.tipo)
  const valor = col.nullable ? `${t} | null` : t

  if (modo === 'Row') return `          ${col.nombre}: ${valor}`
  if (modo === 'Update') return `          ${col.nombre}?: ${valor}`

  // Insert: opcional si tiene default, es generada o admite nulos.
  const opcional = col.opcional_insert || col.generada || col.nullable
  return `          ${col.nombre}${opcional ? '?' : ''}: ${valor}`
}

function relaciones(rels) {
  if (!rels?.length) return '        Relationships: []'
  const cuerpo = rels
    .map(
      (r) => `          {
            foreignKeyName: "${r.nombre}"
            columns: [${r.columnas.map((c) => `"${c}"`).join(', ')}]
            isOneToOne: ${r.uno_a_uno}
            referencedRelation: "${r.tabla_referida}"
            referencedColumns: [${r.columnas_referidas.map((c) => `"${c}"`).join(', ')}]
          }`,
    )
    .join(',\n')
  return `        Relationships: [\n${cuerpo}\n        ]`
}

const tablas = esquema.tablas.filter((t) => t.tipo === 'tabla')
const vistas = esquema.tablas.filter((t) => t.tipo === 'vista')

const bloqueTablas = tablas
  .map(
    (t) => `      ${t.nombre}: {
        Row: {
${t.columnas.map((c) => campo(c, 'Row')).join('\n')}
        }
        Insert: {
${t.columnas.filter((c) => !c.generada).map((c) => campo(c, 'Insert')).join('\n')}
        }
        Update: {
${t.columnas.filter((c) => !c.generada).map((c) => campo(c, 'Update')).join('\n')}
        }
${relaciones(t.relaciones)}
      }`,
  )
  .join('\n')

const bloqueVistas = vistas.length
  ? vistas
      .map(
        (v) => `      ${v.nombre}: {
        Row: {
${v.columnas.map((c) => campo(c, 'Row')).join('\n')}
        }
${relaciones(v.relaciones)}
      }`,
      )
      .join('\n')
  : ''

// Las sobrecargas comparten nombre; se conserva la de más argumentos.
const porNombre = new Map()
for (const f of esquema.funciones) {
  const previa = porNombre.get(f.nombre)
  if (!previa || f.argumentos.length > previa.argumentos.length) porNombre.set(f.nombre, f)
}

const bloqueFunciones = [...porNombre.values()]
  .map((f) => {
    const args = f.argumentos.length
      ? `{
${f.argumentos.map((a) => `          ${a.nombre}${a.opcional ? '?' : ''}: ${tipo(a.tipo)}`).join('\n')}
        }`
      : 'Record<PropertyKey, never>'
    const retorno = f.retorna === 'void' ? 'undefined' : tipo(f.retorna)
    return `      ${f.nombre}: {
        Args: ${args}
        Returns: ${retorno}${f.retorna_conjunto ? '[]' : ''}
      }`
  })
  .join('\n')

const bloqueEnums = esquema.enums.length
  ? esquema.enums
      .map((e) => `      ${e.nombre}: ${e.valores.map((v) => `"${v}"`).join(' | ')}`)
      .join('\n')
  : '      [_ in never]: never'

const salida = `// Archivo generado automáticamente. No editar a mano.
// Regenerar con: ./scripts/generar-tipos.sh
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
${bloqueTablas}
    }
    Views: {
${bloqueVistas || '      [_ in never]: never'}
    }
    Functions: {
${bloqueFunciones || '      [_ in never]: never'}
    }
    Enums: {
${bloqueEnums}
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type SchemaPublico = Database['public']

export type Tablas<T extends keyof SchemaPublico['Tables']> = SchemaPublico['Tables'][T]['Row']
export type TablasInsert<T extends keyof SchemaPublico['Tables']> = SchemaPublico['Tables'][T]['Insert']
export type TablasUpdate<T extends keyof SchemaPublico['Tables']> = SchemaPublico['Tables'][T]['Update']
export type Vistas<T extends keyof SchemaPublico['Views']> = SchemaPublico['Views'][T]['Row']
export type Enums<T extends keyof SchemaPublico['Enums']> = SchemaPublico['Enums'][T]
`

mkdirSync(resolve(raiz, 'src/types'), { recursive: true })
writeFileSync(resolve(raiz, 'src/types/database.ts'), salida)
console.error(
  `✔ src/types/database.ts · ${tablas.length} tablas, ${vistas.length} vistas, ` +
    `${porNombre.size} funciones, ${esquema.enums.length} enums`,
)
