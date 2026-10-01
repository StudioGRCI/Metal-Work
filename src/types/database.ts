// Archivo generado automáticamente. No editar a mano.
// Regenerar con: ./scripts/generar-tipos.sh

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      adquisiciones: {
        Row: {
          id: string
          orden_id: string | null
          orden_compra_id: string | null
          documento_compra_id: string | null
          unidad_id: string | null
          ruta_storage: string | null
          tipo: string
          proveedor: string
          numero_documento: string
          fecha_emision: string
          fecha_vencimiento: string
          moneda: string
          total: number
          condicion_pago: string
          estado: string
          observacion: string
          registrado_por: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id?: string | null
          orden_compra_id?: string | null
          documento_compra_id?: string | null
          unidad_id?: string | null
          ruta_storage?: string | null
          tipo: string
          proveedor: string
          numero_documento: string
          fecha_emision: string
          fecha_vencimiento: string
          moneda: string
          total: number
          condicion_pago: string
          estado?: string
          observacion?: string
          registrado_por?: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string | null
          orden_compra_id?: string | null
          documento_compra_id?: string | null
          unidad_id?: string | null
          ruta_storage?: string | null
          tipo?: string
          proveedor?: string
          numero_documento?: string
          fecha_emision?: string
          fecha_vencimiento?: string
          moneda?: string
          total?: number
          condicion_pago?: string
          estado?: string
          observacion?: string
          registrado_por?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "adquisiciones_documento_compra_id_fkey"
            columns: ["documento_compra_id"]
            isOneToOne: false
            referencedRelation: "documentos_compra_material"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adquisiciones_orden_compra_id_fkey"
            columns: ["orden_compra_id"]
            isOneToOne: false
            referencedRelation: "ordenes_compra_materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adquisiciones_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adquisiciones_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adquisiciones_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          }
        ]
      }
      areas: {
        Row: {
          id: string
          codigo: string
          nombre: string
          encargado: string | null
          orden_secuencia: number
          activo: boolean
          creado_en: string
          actualizado_en: string
          jefe_id: string | null
        }
        Insert: {
          id?: string
          codigo: string
          nombre: string
          encargado?: string | null
          orden_secuencia: number
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          jefe_id?: string | null
        }
        Update: {
          id?: string
          codigo?: string
          nombre?: string
          encargado?: string | null
          orden_secuencia?: number
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          jefe_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "areas_jefe_id_fkey"
            columns: ["jefe_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      audit_log: {
        Row: {
          id: number
          tabla: string
          registro_id: string | null
          accion: Database["public"]["Enums"]["accion_auditoria"]
          datos_antes: Json | null
          datos_despues: Json | null
          campos_modificados: string[] | null
          usuario_id: string | null
          creado_en: string
        }
        Insert: {
          id?: number
          tabla: string
          registro_id?: string | null
          accion: Database["public"]["Enums"]["accion_auditoria"]
          datos_antes?: Json | null
          datos_despues?: Json | null
          campos_modificados?: string[] | null
          usuario_id?: string | null
          creado_en?: string
        }
        Update: {
          id?: number
          tabla?: string
          registro_id?: string | null
          accion?: Database["public"]["Enums"]["accion_auditoria"]
          datos_antes?: Json | null
          datos_despues?: Json | null
          campos_modificados?: string[] | null
          usuario_id?: string | null
          creado_en?: string
        }
        Relationships: []
      }
      catalogo_almacen_fuente: {
        Row: {
          fila_excel: number
          material_id: string
          codigo_original: string
          descripcion_original: string
          familia_original: string
          subfamilia_original: string | null
          proveedor_original: string | null
          creado_en: string
        }
        Insert: {
          fila_excel: number
          material_id: string
          codigo_original: string
          descripcion_original: string
          familia_original: string
          subfamilia_original?: string | null
          proveedor_original?: string | null
          creado_en?: string
        }
        Update: {
          fila_excel?: number
          material_id?: string
          codigo_original?: string
          descripcion_original?: string
          familia_original?: string
          subfamilia_original?: string | null
          proveedor_original?: string | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogo_almacen_fuente_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiales"
            referencedColumns: ["id"]
          }
        ]
      }
      categorias_material: {
        Row: {
          id: string
          codigo: string
          nombre: string
          descripcion: string | null
          categoria_padre_id: string | null
          cuenta_contable: string | null
          orden_visual: number
          activo: boolean
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          codigo: string
          nombre: string
          descripcion?: string | null
          categoria_padre_id?: string | null
          cuenta_contable?: string | null
          orden_visual?: number
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          codigo?: string
          nombre?: string
          descripcion?: string | null
          categoria_padre_id?: string | null
          cuenta_contable?: string | null
          orden_visual?: number
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorias_material_categoria_padre_id_fkey"
            columns: ["categoria_padre_id"]
            isOneToOne: false
            referencedRelation: "categorias_material"
            referencedColumns: ["id"]
          }
        ]
      }
      clientes: {
        Row: {
          id: string
          tipo_documento: Database["public"]["Enums"]["tipo_documento_cliente"]
          numero_documento: string
          razon_social: string
          nombre_comercial: string | null
          direccion_fiscal: string | null
          distrito: string | null
          provincia: string | null
          departamento: string | null
          telefono: string | null
          correo: string | null
          web: string | null
          condicion_pago_dias: number
          linea_credito: number
          moneda_preferida: Database["public"]["Enums"]["moneda"]
          retiene_detraccion: boolean
          porcentaje_detraccion: number
          vendedor_id: string | null
          observaciones: string | null
          activo: boolean
          creado_en: string
          actualizado_en: string
          creado_por: string | null
        }
        Insert: {
          id?: string
          tipo_documento?: Database["public"]["Enums"]["tipo_documento_cliente"]
          numero_documento: string
          razon_social: string
          nombre_comercial?: string | null
          direccion_fiscal?: string | null
          distrito?: string | null
          provincia?: string | null
          departamento?: string | null
          telefono?: string | null
          correo?: string | null
          web?: string | null
          condicion_pago_dias?: number
          linea_credito?: number
          moneda_preferida?: Database["public"]["Enums"]["moneda"]
          retiene_detraccion?: boolean
          porcentaje_detraccion?: number
          vendedor_id?: string | null
          observaciones?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          creado_por?: string | null
        }
        Update: {
          id?: string
          tipo_documento?: Database["public"]["Enums"]["tipo_documento_cliente"]
          numero_documento?: string
          razon_social?: string
          nombre_comercial?: string | null
          direccion_fiscal?: string | null
          distrito?: string | null
          provincia?: string | null
          departamento?: string | null
          telefono?: string | null
          correo?: string | null
          web?: string | null
          condicion_pago_dias?: number
          linea_credito?: number
          moneda_preferida?: Database["public"]["Enums"]["moneda"]
          retiene_detraccion?: boolean
          porcentaje_detraccion?: number
          vendedor_id?: string | null
          observaciones?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          creado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      cobros_ot: {
        Row: {
          id: string
          cuenta_id: string
          fecha: string
          monto: number
          referencia: string
          registrado_por: string
          creado_en: string
        }
        Insert: {
          id?: string
          cuenta_id: string
          fecha: string
          monto: number
          referencia: string
          registrado_por?: string
          creado_en?: string
        }
        Update: {
          id?: string
          cuenta_id?: string
          fecha?: string
          monto?: number
          referencia?: string
          registrado_por?: string
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "cobros_ot_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas_cobrar_ot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobros_ot_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      conceptos_gasto_general: {
        Row: {
          codigo: string
          nombre: string
          grupo: string
          tasa_sugerida: number | null
          orden: number
          activo: boolean
          actualizado_en: string
        }
        Insert: {
          codigo: string
          nombre: string
          grupo: string
          tasa_sugerida?: number | null
          orden: number
          activo?: boolean
          actualizado_en?: string
        }
        Update: {
          codigo?: string
          nombre?: string
          grupo?: string
          tasa_sugerida?: number | null
          orden?: number
          activo?: boolean
          actualizado_en?: string
        }
        Relationships: []
      }
      contactos_cliente: {
        Row: {
          id: string
          cliente_id: string
          nombre: string
          cargo: string | null
          telefono: string | null
          correo: string | null
          es_principal: boolean
          observaciones: string | null
          activo: boolean
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          cliente_id: string
          nombre: string
          cargo?: string | null
          telefono?: string | null
          correo?: string | null
          es_principal?: boolean
          observaciones?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          cliente_id?: string
          nombre?: string
          cargo?: string | null
          telefono?: string | null
          correo?: string | null
          es_principal?: boolean
          observaciones?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "contactos_cliente_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: true
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          }
        ]
      }
      conteos_inventario: {
        Row: {
          id: string
          material_id: string
          cantidad_fisica: number
          ajuste: number
          motivo: string
          registrado_por: string
          registrado_en: string
        }
        Insert: {
          id: string
          material_id: string
          cantidad_fisica: number
          ajuste: number
          motivo: string
          registrado_por: string
          registrado_en?: string
        }
        Update: {
          id?: string
          material_id?: string
          cantidad_fisica?: number
          ajuste?: number
          motivo?: string
          registrado_por?: string
          registrado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "conteos_inventario_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteos_inventario_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      control_vehicular_items: {
        Row: {
          codigo: string
          categoria: string
          nombre: string
          orden: number
          actualizado_en: string
        }
        Insert: {
          codigo: string
          categoria: string
          nombre: string
          orden: number
          actualizado_en?: string
        }
        Update: {
          codigo?: string
          categoria?: string
          nombre?: string
          orden?: number
          actualizado_en?: string
        }
        Relationships: []
      }
      cotizaciones_pdf: {
        Row: {
          id: string
          numero: string
          cliente_id: string
          tipo_carroceria_id: string
          estado: Database["public"]["Enums"]["estado_cotizacion_pdf"]
          observacion: string | null
          revisado_por: string | null
          revisado_en: string | null
          nombre_archivo: string
          ruta_storage: string
          mime_type: string | null
          tamano_bytes: number | null
          registrado_por: string | null
          creado_en: string
          actualizado_en: string
          version: number
          archivo_subido_en: string
          monto_venta: number | null
          moneda: Database["public"]["Enums"]["moneda"] | null
          motivo_anulacion: string | null
          anulado_por: string | null
          anulado_en: string | null
          motivo_correccion: string | null
        }
        Insert: {
          id?: string
          numero: string
          cliente_id: string
          tipo_carroceria_id: string
          estado?: Database["public"]["Enums"]["estado_cotizacion_pdf"]
          observacion?: string | null
          revisado_por?: string | null
          revisado_en?: string | null
          nombre_archivo: string
          ruta_storage: string
          mime_type?: string | null
          tamano_bytes?: number | null
          registrado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          version?: number
          archivo_subido_en?: string
          monto_venta?: number | null
          moneda?: Database["public"]["Enums"]["moneda"] | null
          motivo_anulacion?: string | null
          anulado_por?: string | null
          anulado_en?: string | null
          motivo_correccion?: string | null
        }
        Update: {
          id?: string
          numero?: string
          cliente_id?: string
          tipo_carroceria_id?: string
          estado?: Database["public"]["Enums"]["estado_cotizacion_pdf"]
          observacion?: string | null
          revisado_por?: string | null
          revisado_en?: string | null
          nombre_archivo?: string
          ruta_storage?: string
          mime_type?: string | null
          tamano_bytes?: number | null
          registrado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          version?: number
          archivo_subido_en?: string
          monto_venta?: number | null
          moneda?: Database["public"]["Enums"]["moneda"] | null
          motivo_anulacion?: string | null
          anulado_por?: string | null
          anulado_en?: string | null
          motivo_correccion?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cotizaciones_pdf_anulado_por_fkey"
            columns: ["anulado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_pdf_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_pdf_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_pdf_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_pdf_tipo_carroceria_id_fkey"
            columns: ["tipo_carroceria_id"]
            isOneToOne: false
            referencedRelation: "tipos_carroceria"
            referencedColumns: ["id"]
          }
        ]
      }
      cotizaciones_pdf_liberaciones_tesoreria: {
        Row: {
          id: string
          cotizacion_pdf_id: string
          liberado_por: string
          liberado_en: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          cotizacion_pdf_id: string
          liberado_por?: string
          liberado_en?: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          cotizacion_pdf_id?: string
          liberado_por?: string
          liberado_en?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "cotizaciones_pdf_liberaciones_tesoreria_cotizacion_pdf_id_fkey"
            columns: ["cotizacion_pdf_id"]
            isOneToOne: true
            referencedRelation: "cotizaciones_pdf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_pdf_liberaciones_tesoreria_liberado_por_fkey"
            columns: ["liberado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      cotizaciones_pdf_observaciones_tesoreria: {
        Row: {
          id: string
          cotizacion_pdf_id: string
          observacion: string
          registrado_por: string
          creado_en: string
        }
        Insert: {
          id?: string
          cotizacion_pdf_id: string
          observacion: string
          registrado_por?: string
          creado_en?: string
        }
        Update: {
          id?: string
          cotizacion_pdf_id?: string
          observacion?: string
          registrado_por?: string
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "cotizaciones_pdf_observaciones_tesoreria_cotizacion_pdf_id_fkey"
            columns: ["cotizacion_pdf_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones_pdf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_pdf_observaciones_tesoreria_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      cotizaciones_pdf_versiones: {
        Row: {
          id: string
          cotizacion_id: string
          version: number
          nombre_archivo: string
          ruta_storage: string
          mime_type: string | null
          tamano_bytes: number | null
          subido_en: string
          observacion: string
          rechazado_por: string | null
          rechazado_en: string | null
          creado_en: string
          actualizado_en: string
          estado_al_archivar: string
        }
        Insert: {
          id?: string
          cotizacion_id: string
          version: number
          nombre_archivo: string
          ruta_storage: string
          mime_type?: string | null
          tamano_bytes?: number | null
          subido_en: string
          observacion: string
          rechazado_por?: string | null
          rechazado_en?: string | null
          creado_en?: string
          actualizado_en?: string
          estado_al_archivar?: string
        }
        Update: {
          id?: string
          cotizacion_id?: string
          version?: number
          nombre_archivo?: string
          ruta_storage?: string
          mime_type?: string | null
          tamano_bytes?: number | null
          subido_en?: string
          observacion?: string
          rechazado_por?: string | null
          rechazado_en?: string | null
          creado_en?: string
          actualizado_en?: string
          estado_al_archivar?: string
        }
        Relationships: [
          {
            foreignKeyName: "cotizaciones_pdf_versiones_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones_pdf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_pdf_versiones_rechazado_por_fkey"
            columns: ["rechazado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      cuentas_cobrar_ot: {
        Row: {
          id: string
          orden_id: string
          numero_documento: string
          fecha_emision: string
          fecha_vencimiento: string
          moneda: string
          total: number
          observacion: string
          registrado_por: string
          creado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          numero_documento: string
          fecha_emision: string
          fecha_vencimiento: string
          moneda: string
          total: number
          observacion?: string
          registrado_por?: string
          creado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          numero_documento?: string
          fecha_emision?: string
          fecha_vencimiento?: string
          moneda?: string
          total?: number
          observacion?: string
          registrado_por?: string
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "cuentas_cobrar_ot_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuentas_cobrar_ot_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      diseno_evaluaciones: {
        Row: {
          id: string
          evaluado_nombre: string
          puesto: string
          fecha_ingreso: string | null
          fecha_evaluacion: string
          respuestas: number[]
          comentarios: string
          evaluador_id: string
          creado_en: string
        }
        Insert: {
          id?: string
          evaluado_nombre: string
          puesto: string
          fecha_ingreso?: string | null
          fecha_evaluacion: string
          respuestas: number[]
          comentarios?: string
          evaluador_id?: string
          creado_en?: string
        }
        Update: {
          id?: string
          evaluado_nombre?: string
          puesto?: string
          fecha_ingreso?: string | null
          fecha_evaluacion?: string
          respuestas?: number[]
          comentarios?: string
          evaluador_id?: string
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "diseno_evaluaciones_evaluador_id_fkey"
            columns: ["evaluador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      diseno_informes: {
        Row: {
          id: string
          semana_inicio: string
          responsable: string
          resumen: string
          incidencias: string
          acciones: string
          no_conformidades: string
          indicadores: string
          plan_siguiente: string
          conclusiones: string
          creado_por: string
          actualizado_por: string
          creado_en: string
          actualizado_en: string
          numero: number
          estado: string
          observacion_revision: string | null
          enviado_en: string | null
          revisado_por: string | null
          revisado_en: string | null
          recibido_por: string | null
          recibido_en: string | null
          contenido_enviado: Json | null
        }
        Insert: {
          id?: string
          semana_inicio: string
          responsable: string
          resumen?: string
          incidencias?: string
          acciones?: string
          no_conformidades?: string
          indicadores?: string
          plan_siguiente?: string
          conclusiones?: string
          creado_por?: string
          actualizado_por?: string
          creado_en?: string
          actualizado_en?: string
          numero?: number
          estado?: string
          observacion_revision?: string | null
          enviado_en?: string | null
          revisado_por?: string | null
          revisado_en?: string | null
          recibido_por?: string | null
          recibido_en?: string | null
          contenido_enviado?: Json | null
        }
        Update: {
          id?: string
          semana_inicio?: string
          responsable?: string
          resumen?: string
          incidencias?: string
          acciones?: string
          no_conformidades?: string
          indicadores?: string
          plan_siguiente?: string
          conclusiones?: string
          creado_por?: string
          actualizado_por?: string
          creado_en?: string
          actualizado_en?: string
          numero?: number
          estado?: string
          observacion_revision?: string | null
          enviado_en?: string | null
          revisado_por?: string | null
          revisado_en?: string | null
          recibido_por?: string | null
          recibido_en?: string | null
          contenido_enviado?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "diseno_informes_actualizado_por_fkey"
            columns: ["actualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diseno_informes_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diseno_informes_recibido_por_fkey"
            columns: ["recibido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diseno_informes_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      diseno_tareas: {
        Row: {
          id: string
          orden_id: string
          integrante_id: string
          tipo: string
          componente: string
          fecha_inicio: string
          fecha_entrega: string
          observacion: string
          creado_por: string
          creado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          integrante_id: string
          tipo: string
          componente: string
          fecha_inicio: string
          fecha_entrega: string
          observacion?: string
          creado_por?: string
          creado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          integrante_id?: string
          tipo?: string
          componente?: string
          fecha_inicio?: string
          fecha_entrega?: string
          observacion?: string
          creado_por?: string
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "diseno_tareas_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diseno_tareas_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_diseno_tarea_integrante_orden"
            columns: ["integrante_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_equipo_diseno"
            referencedColumns: ["id", "orden_id"]
          }
        ]
      }
      documentos_compra_material: {
        Row: {
          id: string
          orden_compra_id: string
          tipo: string
          nombre_archivo: string
          ruta_storage: string
          mime_type: string
          tamano_bytes: number
          subido_por: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_compra_id: string
          tipo: string
          nombre_archivo: string
          ruta_storage: string
          mime_type: string
          tamano_bytes: number
          subido_por?: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_compra_id?: string
          tipo?: string
          nombre_archivo?: string
          ruta_storage?: string
          mime_type?: string
          tamano_bytes?: number
          subido_por?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "documentos_compra_material_orden_compra_id_fkey"
            columns: ["orden_compra_id"]
            isOneToOne: false
            referencedRelation: "ordenes_compra_materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_compra_material_subido_por_fkey"
            columns: ["subido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      empresa: {
        Row: {
          id: string
          ruc: string
          razon_social: string
          nombre_comercial: string | null
          direccion: string | null
          distrito: string | null
          provincia: string | null
          departamento: string | null
          telefono: string | null
          correo: string | null
          web: string | null
          logo_url: string | null
          creado_en: string
          actualizado_en: string
          dias_laborables: number[]
        }
        Insert: {
          id?: string
          ruc: string
          razon_social: string
          nombre_comercial?: string | null
          direccion?: string | null
          distrito?: string | null
          provincia?: string | null
          departamento?: string | null
          telefono?: string | null
          correo?: string | null
          web?: string | null
          logo_url?: string | null
          creado_en?: string
          actualizado_en?: string
          dias_laborables?: number[]
        }
        Update: {
          id?: string
          ruc?: string
          razon_social?: string
          nombre_comercial?: string | null
          direccion?: string | null
          distrito?: string | null
          provincia?: string | null
          departamento?: string | null
          telefono?: string | null
          correo?: string | null
          web?: string | null
          logo_url?: string | null
          creado_en?: string
          actualizado_en?: string
          dias_laborables?: number[]
        }
        Relationships: []
      }
      etapas_catalogo: {
        Row: {
          id: string
          codigo: string
          nombre: string
          descripcion: string | null
          orden_secuencia: number
          horas_estandar: number
          requiere_inspeccion: boolean
          permite_paralelo: boolean
          color: string | null
          activo: boolean
          creado_en: string
          actualizado_en: string
          dias_estandar: number
          area_id: string | null
        }
        Insert: {
          id?: string
          codigo: string
          nombre: string
          descripcion?: string | null
          orden_secuencia: number
          horas_estandar?: number
          requiere_inspeccion?: boolean
          permite_paralelo?: boolean
          color?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          dias_estandar?: number
          area_id?: string | null
        }
        Update: {
          id?: string
          codigo?: string
          nombre?: string
          descripcion?: string | null
          orden_secuencia?: number
          horas_estandar?: number
          requiere_inspeccion?: boolean
          permite_paralelo?: boolean
          color?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          dias_estandar?: number
          area_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "etapas_catalogo_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          }
        ]
      }
      feriados: {
        Row: {
          fecha: string
          nombre: string
          ambito: string
          laborable: boolean
          observacion: string | null
          creado_en: string
        }
        Insert: {
          fecha: string
          nombre: string
          ambito?: string
          laborable?: boolean
          observacion?: string | null
          creado_en?: string
        }
        Update: {
          fecha?: string
          nombre?: string
          ambito?: string
          laborable?: boolean
          observacion?: string | null
          creado_en?: string
        }
        Relationships: []
      }
      flota_avance_fotos: {
        Row: {
          id: string
          avance_id: string
          flota_id: string
          bucket: string
          ruta_storage: string
          nombre_archivo: string
          mime_type: string | null
          tamano_bytes: number | null
          pie: string | null
          orden_visual: number
          creado_en: string
        }
        Insert: {
          id?: string
          avance_id: string
          flota_id: string
          bucket?: string
          ruta_storage: string
          nombre_archivo: string
          mime_type?: string | null
          tamano_bytes?: number | null
          pie?: string | null
          orden_visual?: number
          creado_en?: string
        }
        Update: {
          id?: string
          avance_id?: string
          flota_id?: string
          bucket?: string
          ruta_storage?: string
          nombre_archivo?: string
          mime_type?: string | null
          tamano_bytes?: number | null
          pie?: string | null
          orden_visual?: number
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_flota_foto_de_su_reporte"
            columns: ["avance_id", "flota_id"]
            isOneToOne: false
            referencedRelation: "flota_avances"
            referencedColumns: ["id", "flota_id"]
          }
        ]
      }
      flota_avances: {
        Row: {
          id: string
          flota_id: string
          area_id: string
          fecha: string
          descripcion: string
          avance_porcentaje: number | null
          impedimento: string | null
          registrado_por: string | null
          creado_en: string
          actualizado_en: string
          revision: Database["public"]["Enums"]["estado_revision"]
          revisado_por: string | null
          revisado_en: string | null
          observacion: string | null
          corregido_en: string | null
        }
        Insert: {
          id?: string
          flota_id: string
          area_id: string
          fecha?: string
          descripcion: string
          avance_porcentaje?: number | null
          impedimento?: string | null
          registrado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          revision?: Database["public"]["Enums"]["estado_revision"]
          revisado_por?: string | null
          revisado_en?: string | null
          observacion?: string | null
          corregido_en?: string | null
        }
        Update: {
          id?: string
          flota_id?: string
          area_id?: string
          fecha?: string
          descripcion?: string
          avance_porcentaje?: number | null
          impedimento?: string | null
          registrado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          revision?: Database["public"]["Enums"]["estado_revision"]
          revisado_por?: string | null
          revisado_en?: string | null
          observacion?: string | null
          corregido_en?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flota_avances_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flota_avances_flota_id_fkey"
            columns: ["flota_id"]
            isOneToOne: false
            referencedRelation: "flota_unidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flota_avances_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flota_avances_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      flota_unidades: {
        Row: {
          id: string
          placa: string | null
          placa_clave: string | null
          descripcion: string | null
          cliente: string | null
          trajo: string | null
          trabajo: string
          estado: Database["public"]["Enums"]["estado_flota"]
          ingreso: string
          lista_en: string | null
          salio_en: string | null
          salio_por: string | null
          retiro: string | null
          sede_id: string | null
          registrado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          placa?: string | null
          descripcion?: string | null
          cliente?: string | null
          trajo?: string | null
          trabajo: string
          estado?: Database["public"]["Enums"]["estado_flota"]
          ingreso?: string
          lista_en?: string | null
          salio_en?: string | null
          salio_por?: string | null
          retiro?: string | null
          sede_id?: string | null
          registrado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          placa?: string | null
          descripcion?: string | null
          cliente?: string | null
          trajo?: string | null
          trabajo?: string
          estado?: Database["public"]["Enums"]["estado_flota"]
          ingreso?: string
          lista_en?: string | null
          salio_en?: string | null
          salio_por?: string | null
          retiro?: string | null
          sede_id?: string | null
          registrado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "flota_unidades_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flota_unidades_salio_por_fkey"
            columns: ["salio_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flota_unidades_sede_id_fkey"
            columns: ["sede_id"]
            isOneToOne: false
            referencedRelation: "sedes"
            referencedColumns: ["id"]
          }
        ]
      }
      gastos_generales_mes: {
        Row: {
          id: string
          periodo: string
          concepto: string
          descripcion: string
          monto: number
          moneda: string
          reparto: string
          tasa: number | null
          estado: string
          motivo_anulacion: string | null
          anulado_por: string | null
          anulado_en: string | null
          registrado_por: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id: string
          periodo: string
          concepto: string
          descripcion: string
          monto: number
          moneda: string
          reparto: string
          tasa?: number | null
          estado?: string
          motivo_anulacion?: string | null
          anulado_por?: string | null
          anulado_en?: string | null
          registrado_por?: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          periodo?: string
          concepto?: string
          descripcion?: string
          monto?: number
          moneda?: string
          reparto?: string
          tasa?: number | null
          estado?: string
          motivo_anulacion?: string | null
          anulado_por?: string | null
          anulado_en?: string | null
          registrado_por?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "gastos_generales_mes_anulado_por_fkey"
            columns: ["anulado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_generales_mes_concepto_fkey"
            columns: ["concepto"]
            isOneToOne: false
            referencedRelation: "conceptos_gasto_general"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "gastos_generales_mes_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      liberaciones_tesoreria: {
        Row: {
          id: string
          orden_id: string
          liberado_por: string
          liberado_en: string
          observacion: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          liberado_por?: string
          liberado_en?: string
          observacion?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          liberado_por?: string
          liberado_en?: string
          observacion?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "liberaciones_tesoreria_liberado_por_fkey"
            columns: ["liberado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "liberaciones_tesoreria_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: true
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          }
        ]
      }
      materiales: {
        Row: {
          id: string
          codigo: string
          descripcion: string
          categoria_id: string
          unidad_medida_id: string
          especificacion_tecnica: string | null
          espesor_mm: number | null
          ancho_mm: number | null
          largo_mm: number | null
          calidad_acero: string | null
          marca: string | null
          modelo: string | null
          peso_unitario_kg: number | null
          imagen_url: string | null
          observaciones: string | null
          activo: boolean
          creado_por: string | null
          creado_en: string
          actualizado_en: string
          creado_desde_ot: string | null
          codigo_almacen_origen: string | null
          unidad_pendiente: boolean
        }
        Insert: {
          id?: string
          codigo: string
          descripcion: string
          categoria_id: string
          unidad_medida_id: string
          especificacion_tecnica?: string | null
          espesor_mm?: number | null
          ancho_mm?: number | null
          largo_mm?: number | null
          calidad_acero?: string | null
          marca?: string | null
          modelo?: string | null
          peso_unitario_kg?: number | null
          imagen_url?: string | null
          observaciones?: string | null
          activo?: boolean
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          creado_desde_ot?: string | null
          codigo_almacen_origen?: string | null
          unidad_pendiente?: boolean
        }
        Update: {
          id?: string
          codigo?: string
          descripcion?: string
          categoria_id?: string
          unidad_medida_id?: string
          especificacion_tecnica?: string | null
          espesor_mm?: number | null
          ancho_mm?: number | null
          largo_mm?: number | null
          calidad_acero?: string | null
          marca?: string | null
          modelo?: string | null
          peso_unitario_kg?: number | null
          imagen_url?: string | null
          observaciones?: string | null
          activo?: boolean
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          creado_desde_ot?: string | null
          codigo_almacen_origen?: string | null
          unidad_pendiente?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "materiales_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_material"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materiales_creado_desde_ot_fkey"
            columns: ["creado_desde_ot"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materiales_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materiales_unidad_medida_id_fkey"
            columns: ["unidad_medida_id"]
            isOneToOne: false
            referencedRelation: "unidades_medida"
            referencedColumns: ["id"]
          }
        ]
      }
      movimientos_materiales: {
        Row: {
          id: string
          tipo: string
          requerimiento_detalle_id: string | null
          orden_compra_detalle_id: string | null
          cantidad: number
          documento_referencia: string | null
          responsable_id: string | null
          registrado_por: string
          registrado_en: string
          material_id: string | null
          origen: string
          foto_ruta: string | null
          recibido_por_nombre: string | null
          cantidad_de_stock: number
          precio_unitario: number | null
          moneda: string | null
          devolucion_de: string | null
          unidad_id: string | null
          codigo_unidad: string | null
          orden_id: string | null
        }
        Insert: {
          id: string
          tipo: string
          requerimiento_detalle_id?: string | null
          orden_compra_detalle_id?: string | null
          cantidad: number
          documento_referencia?: string | null
          responsable_id?: string | null
          registrado_por?: string
          registrado_en?: string
          material_id?: string | null
          origen?: string
          foto_ruta?: string | null
          recibido_por_nombre?: string | null
          cantidad_de_stock?: number
          precio_unitario?: number | null
          moneda?: string | null
          devolucion_de?: string | null
          unidad_id?: string | null
          codigo_unidad?: string | null
          orden_id?: string | null
        }
        Update: {
          id?: string
          tipo?: string
          requerimiento_detalle_id?: string | null
          orden_compra_detalle_id?: string | null
          cantidad?: number
          documento_referencia?: string | null
          responsable_id?: string | null
          registrado_por?: string
          registrado_en?: string
          material_id?: string | null
          origen?: string
          foto_ruta?: string | null
          recibido_por_nombre?: string | null
          cantidad_de_stock?: number
          precio_unitario?: number | null
          moneda?: string | null
          devolucion_de?: string | null
          unidad_id?: string | null
          codigo_unidad?: string | null
          orden_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_mov_material_oc"
            columns: ["orden_compra_detalle_id", "requerimiento_detalle_id"]
            isOneToOne: false
            referencedRelation: "orden_compra_material_detalles"
            referencedColumns: ["id", "requerimiento_detalle_id"]
          },
          {
            foreignKeyName: "movimientos_materiales_devolucion_de_fkey"
            columns: ["devolucion_de"]
            isOneToOne: false
            referencedRelation: "movimientos_materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_materiales_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_materiales_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_materiales_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_materiales_requerimiento_detalle_id_fkey"
            columns: ["requerimiento_detalle_id"]
            isOneToOne: false
            referencedRelation: "requerimiento_material_detalles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_materiales_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_materiales_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          }
        ]
      }
      notificaciones: {
        Row: {
          id: string
          usuario_id: string
          titulo: string
          cuerpo: string | null
          ruta: string | null
          origen_tabla: string | null
          origen_id: string | null
          leida_en: string | null
          creado_en: string
        }
        Insert: {
          id?: string
          usuario_id: string
          titulo: string
          cuerpo?: string | null
          ruta?: string | null
          origen_tabla?: string | null
          origen_id?: string | null
          leida_en?: string | null
          creado_en?: string
        }
        Update: {
          id?: string
          usuario_id?: string
          titulo?: string
          cuerpo?: string | null
          ruta?: string | null
          origen_tabla?: string | null
          origen_id?: string | null
          leida_en?: string | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificaciones_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      notificaciones_archivo_20260929: {
        Row: {
          id: string
          usuario_id: string
          titulo: string
          cuerpo: string | null
          ruta: string | null
          origen_tabla: string | null
          origen_id: string | null
          leida_en: string | null
          creado_en: string
          archivado_en: string
        }
        Insert: {
          id: string
          usuario_id: string
          titulo: string
          cuerpo?: string | null
          ruta?: string | null
          origen_tabla?: string | null
          origen_id?: string | null
          leida_en?: string | null
          creado_en: string
          archivado_en?: string
        }
        Update: {
          id?: string
          usuario_id?: string
          titulo?: string
          cuerpo?: string | null
          ruta?: string | null
          origen_tabla?: string | null
          origen_id?: string | null
          leida_en?: string | null
          creado_en?: string
          archivado_en?: string
        }
        Relationships: []
      }
      orden_compra_material_detalles: {
        Row: {
          id: string
          orden_compra_id: string
          requerimiento_id: string
          requerimiento_detalle_id: string
          cantidad: number
          creado_en: string
          actualizado_en: string
          precio_unitario: number | null
        }
        Insert: {
          id?: string
          orden_compra_id: string
          requerimiento_id: string
          requerimiento_detalle_id: string
          cantidad: number
          creado_en?: string
          actualizado_en?: string
          precio_unitario?: number | null
        }
        Update: {
          id?: string
          orden_compra_id?: string
          requerimiento_id?: string
          requerimiento_detalle_id?: string
          cantidad?: number
          creado_en?: string
          actualizado_en?: string
          precio_unitario?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_oc_material_req_linea"
            columns: ["requerimiento_detalle_id", "requerimiento_id"]
            isOneToOne: false
            referencedRelation: "requerimiento_material_detalles"
            referencedColumns: ["id", "requerimiento_id"]
          },
          {
            foreignKeyName: "orden_compra_material_detalles_orden_compra_id_fkey"
            columns: ["orden_compra_id"]
            isOneToOne: false
            referencedRelation: "ordenes_compra_materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orden_compra_material_detalles_requerimiento_detalle_id_fkey"
            columns: ["requerimiento_detalle_id"]
            isOneToOne: false
            referencedRelation: "requerimiento_material_detalles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orden_compra_material_detalles_requerimiento_id_fkey"
            columns: ["requerimiento_id"]
            isOneToOne: false
            referencedRelation: "requerimientos_materiales"
            referencedColumns: ["id"]
          }
        ]
      }
      ordenes_compra_materiales: {
        Row: {
          id: string
          requerimiento_id: string
          proveedor: string
          referencia: string
          fecha_estimada: string | null
          creado_por: string
          creado_en: string
          actualizado_en: string
          entregado_almacen_en: string | null
          entregado_almacen_por: string | null
          condicion_pago: string
          dias_credito: number
          moneda: string
        }
        Insert: {
          id?: string
          requerimiento_id: string
          proveedor: string
          referencia: string
          fecha_estimada?: string | null
          creado_por?: string
          creado_en?: string
          actualizado_en?: string
          entregado_almacen_en?: string | null
          entregado_almacen_por?: string | null
          condicion_pago?: string
          dias_credito?: number
          moneda?: string
        }
        Update: {
          id?: string
          requerimiento_id?: string
          proveedor?: string
          referencia?: string
          fecha_estimada?: string | null
          creado_por?: string
          creado_en?: string
          actualizado_en?: string
          entregado_almacen_en?: string | null
          entregado_almacen_por?: string | null
          condicion_pago?: string
          dias_credito?: number
          moneda?: string
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_compra_materiales_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_materiales_entregado_almacen_por_fkey"
            columns: ["entregado_almacen_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_materiales_requerimiento_id_fkey"
            columns: ["requerimiento_id"]
            isOneToOne: false
            referencedRelation: "requerimientos_materiales"
            referencedColumns: ["id"]
          }
        ]
      }
      ordenes_trabajo: {
        Row: {
          id: string
          numero: string
          cliente_id: string | null
          unidad_id: string | null
          tipo_carroceria_id: string | null
          sede_id: string
          tipo_trabajo: Database["public"]["Enums"]["tipo_trabajo_ot"]
          estado: Database["public"]["Enums"]["estado_ot"]
          prioridad: Database["public"]["Enums"]["prioridad_ot"]
          descripcion: string
          especificaciones_tecnicas: string | null
          datos_tecnicos: Json
          fecha_registro: string
          fecha_inicio_programada: string | null
          fecha_fin_programada: string | null
          fecha_entrega_comprometida: string | null
          fecha_inicio_real: string | null
          fecha_fin_real: string | null
          responsable_id: string | null
          supervisor_id: string | null
          avance_porcentaje: number
          horas_estimadas: number
          horas_reales: number
          motivo_pausa: string | null
          motivo_anulacion: string | null
          observaciones: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
          largo_m: number | null
          ancho_m: number | null
          alto_m: number | null
          capacidad_carga: string | null
          ruedas: string | null
          tipo_llantas: string | null
          cantidad_ejes: number | null
          tipo_suspension: string | null
          colores: string | null
          caracteristicas_especiales: string | null
          encargado_produccion_id: string | null
          correo_contacto: string | null
          abierta_en_taller: boolean
          cotizacion_pdf_id: string | null
          tipo_unidad: Database["public"]["Enums"]["tipo_unidad_carroceria"] | null
          diseno_lider_id: string | null
          plan_etapas_manual: boolean
          diseno_lider_entrega_nombre: string | null
        }
        Insert: {
          id?: string
          numero?: string
          cliente_id?: string | null
          unidad_id?: string | null
          tipo_carroceria_id?: string | null
          sede_id: string
          tipo_trabajo?: Database["public"]["Enums"]["tipo_trabajo_ot"]
          estado?: Database["public"]["Enums"]["estado_ot"]
          prioridad?: Database["public"]["Enums"]["prioridad_ot"]
          descripcion: string
          especificaciones_tecnicas?: string | null
          datos_tecnicos?: Json
          fecha_registro?: string
          fecha_inicio_programada?: string | null
          fecha_fin_programada?: string | null
          fecha_entrega_comprometida?: string | null
          fecha_inicio_real?: string | null
          fecha_fin_real?: string | null
          responsable_id?: string | null
          supervisor_id?: string | null
          avance_porcentaje?: number
          horas_estimadas?: number
          horas_reales?: number
          motivo_pausa?: string | null
          motivo_anulacion?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          largo_m?: number | null
          ancho_m?: number | null
          alto_m?: number | null
          capacidad_carga?: string | null
          ruedas?: string | null
          tipo_llantas?: string | null
          cantidad_ejes?: number | null
          tipo_suspension?: string | null
          colores?: string | null
          caracteristicas_especiales?: string | null
          encargado_produccion_id?: string | null
          correo_contacto?: string | null
          abierta_en_taller?: boolean
          cotizacion_pdf_id?: string | null
          tipo_unidad?: Database["public"]["Enums"]["tipo_unidad_carroceria"] | null
          diseno_lider_id?: string | null
          plan_etapas_manual?: boolean
          diseno_lider_entrega_nombre?: string | null
        }
        Update: {
          id?: string
          numero?: string
          cliente_id?: string | null
          unidad_id?: string | null
          tipo_carroceria_id?: string | null
          sede_id?: string
          tipo_trabajo?: Database["public"]["Enums"]["tipo_trabajo_ot"]
          estado?: Database["public"]["Enums"]["estado_ot"]
          prioridad?: Database["public"]["Enums"]["prioridad_ot"]
          descripcion?: string
          especificaciones_tecnicas?: string | null
          datos_tecnicos?: Json
          fecha_registro?: string
          fecha_inicio_programada?: string | null
          fecha_fin_programada?: string | null
          fecha_entrega_comprometida?: string | null
          fecha_inicio_real?: string | null
          fecha_fin_real?: string | null
          responsable_id?: string | null
          supervisor_id?: string | null
          avance_porcentaje?: number
          horas_estimadas?: number
          horas_reales?: number
          motivo_pausa?: string | null
          motivo_anulacion?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          largo_m?: number | null
          ancho_m?: number | null
          alto_m?: number | null
          capacidad_carga?: string | null
          ruedas?: string | null
          tipo_llantas?: string | null
          cantidad_ejes?: number | null
          tipo_suspension?: string | null
          colores?: string | null
          caracteristicas_especiales?: string | null
          encargado_produccion_id?: string | null
          correo_contacto?: string | null
          abierta_en_taller?: boolean
          cotizacion_pdf_id?: string | null
          tipo_unidad?: Database["public"]["Enums"]["tipo_unidad_carroceria"] | null
          diseno_lider_id?: string | null
          plan_etapas_manual?: boolean
          diseno_lider_entrega_nombre?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_trabajo_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_trabajo_cotizacion_pdf_id_fkey"
            columns: ["cotizacion_pdf_id"]
            isOneToOne: true
            referencedRelation: "cotizaciones_pdf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_trabajo_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_trabajo_diseno_lider_id_fkey"
            columns: ["diseno_lider_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_trabajo_encargado_produccion_id_fkey"
            columns: ["encargado_produccion_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_trabajo_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_trabajo_sede_id_fkey"
            columns: ["sede_id"]
            isOneToOne: false
            referencedRelation: "sedes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_trabajo_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_trabajo_tipo_carroceria_id_fkey"
            columns: ["tipo_carroceria_id"]
            isOneToOne: false
            referencedRelation: "tipos_carroceria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_trabajo_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_accesorios: {
        Row: {
          id: string
          orden_id: string
          orden: number
          cantidad: number
          unidad: string
          descripcion: string
          incluye_el_accesorio: boolean
          verificado: boolean
          verificado_por: string | null
          verificado_en: string | null
          observacion: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          orden?: number
          cantidad?: number
          unidad?: string
          descripcion: string
          incluye_el_accesorio?: boolean
          verificado?: boolean
          verificado_por?: string | null
          verificado_en?: string | null
          observacion?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          orden?: number
          cantidad?: number
          unidad?: string
          descripcion?: string
          incluye_el_accesorio?: boolean
          verificado?: boolean
          verificado_por?: string | null
          verificado_en?: string | null
          observacion?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_accesorios_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_accesorios_verificado_por_fkey"
            columns: ["verificado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_actividad_avances: {
        Row: {
          id: string
          actividad_id: string
          orden_id: string
          fecha: string
          avance_pct: number
          nota: string | null
          reportado_por: string | null
          creado_en: string
          actualizado_en: string
          revision: Database["public"]["Enums"]["estado_revision"]
          revisado_por: string | null
          revisado_en: string | null
          observacion: string | null
          corregido_en: string | null
          foto_ruta: string | null
          materiales_usados: Json
        }
        Insert: {
          id?: string
          actividad_id: string
          orden_id: string
          fecha?: string
          avance_pct: number
          nota?: string | null
          reportado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          revision?: Database["public"]["Enums"]["estado_revision"]
          revisado_por?: string | null
          revisado_en?: string | null
          observacion?: string | null
          corregido_en?: string | null
          foto_ruta?: string | null
          materiales_usados?: Json
        }
        Update: {
          id?: string
          actividad_id?: string
          orden_id?: string
          fecha?: string
          avance_pct?: number
          nota?: string | null
          reportado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          revision?: Database["public"]["Enums"]["estado_revision"]
          revisado_por?: string | null
          revisado_en?: string | null
          observacion?: string | null
          corregido_en?: string | null
          foto_ruta?: string | null
          materiales_usados?: Json
        }
        Relationships: [
          {
            foreignKeyName: "fk_avance_actividad"
            columns: ["actividad_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_actividades"
            referencedColumns: ["id", "orden_id"]
          },
          {
            foreignKeyName: "ot_actividad_avances_reportado_por_fkey"
            columns: ["reportado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_actividad_avances_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_actividades: {
        Row: {
          id: string
          orden_id: string
          area_id: string
          orden_secuencia: number
          nombre: string
          detalle: string | null
          referencia: string | null
          peso_pct: number
          creado_por: string | null
          creado_en: string
          actualizado_en: string
          fecha_inicio_plan: string | null
          fecha_fin_plan: string | null
          etapa_id: string | null
        }
        Insert: {
          id?: string
          orden_id: string
          area_id: string
          orden_secuencia?: number
          nombre: string
          detalle?: string | null
          referencia?: string | null
          peso_pct?: number
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          fecha_inicio_plan?: string | null
          fecha_fin_plan?: string | null
          etapa_id?: string | null
        }
        Update: {
          id?: string
          orden_id?: string
          area_id?: string
          orden_secuencia?: number
          nombre?: string
          detalle?: string | null
          referencia?: string | null
          peso_pct?: number
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          fecha_inicio_plan?: string | null
          fecha_fin_plan?: string | null
          etapa_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_ot_actividad_etapa_orden"
            columns: ["etapa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id", "orden_id"]
          },
          {
            foreignKeyName: "ot_actividades_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_actividades_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_actividades_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_adjuntos: {
        Row: {
          id: string
          orden_id: string
          tipo: string
          nombre_archivo: string
          ruta_storage: string
          mime_type: string | null
          tamano_bytes: number | null
          subido_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          tipo?: string
          nombre_archivo: string
          ruta_storage: string
          mime_type?: string | null
          tamano_bytes?: number | null
          subido_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          tipo?: string
          nombre_archivo?: string
          ruta_storage?: string
          mime_type?: string | null
          tamano_bytes?: number | null
          subido_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_adjuntos_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_adjuntos_subido_por_fkey"
            columns: ["subido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_avance_fotos: {
        Row: {
          id: string
          avance_id: string
          bucket: string
          ruta_storage: string
          nombre_archivo: string
          mime_type: string | null
          tamano_bytes: number | null
          pie: string | null
          orden_visual: number
          creado_en: string
        }
        Insert: {
          id?: string
          avance_id: string
          bucket?: string
          ruta_storage: string
          nombre_archivo: string
          mime_type?: string | null
          tamano_bytes?: number | null
          pie?: string | null
          orden_visual?: number
          creado_en?: string
        }
        Update: {
          id?: string
          avance_id?: string
          bucket?: string
          ruta_storage?: string
          nombre_archivo?: string
          mime_type?: string | null
          tamano_bytes?: number | null
          pie?: string | null
          orden_visual?: number
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_avance_fotos_avance_id_fkey"
            columns: ["avance_id"]
            isOneToOne: false
            referencedRelation: "ot_avances"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_avances: {
        Row: {
          id: string
          orden_id: string
          etapa_id: string | null
          fecha: string
          descripcion: string
          avance_porcentaje: number | null
          impedimento: string | null
          registrado_por: string | null
          creado_en: string
          actualizado_en: string
          revision: Database["public"]["Enums"]["estado_revision"]
          revisado_por: string | null
          revisado_en: string | null
          observacion: string | null
          corregido_en: string | null
        }
        Insert: {
          id?: string
          orden_id: string
          etapa_id?: string | null
          fecha?: string
          descripcion: string
          avance_porcentaje?: number | null
          impedimento?: string | null
          registrado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          revision?: Database["public"]["Enums"]["estado_revision"]
          revisado_por?: string | null
          revisado_en?: string | null
          observacion?: string | null
          corregido_en?: string | null
        }
        Update: {
          id?: string
          orden_id?: string
          etapa_id?: string | null
          fecha?: string
          descripcion?: string
          avance_porcentaje?: number | null
          impedimento?: string | null
          registrado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          revision?: Database["public"]["Enums"]["estado_revision"]
          revisado_por?: string | null
          revisado_en?: string | null
          observacion?: string | null
          corregido_en?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_avance_etapa_de_la_orden"
            columns: ["etapa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id", "orden_id"]
          },
          {
            foreignKeyName: "ot_avances_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_avances_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_avances_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_avances_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_bitacora: {
        Row: {
          id: string
          orden_id: string
          etapa_id: string | null
          tipo_evento: Database["public"]["Enums"]["tipo_evento_ot"]
          descripcion: string
          datos: Json
          usuario_id: string | null
          creado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          etapa_id?: string | null
          tipo_evento: Database["public"]["Enums"]["tipo_evento_ot"]
          descripcion: string
          datos?: Json
          usuario_id?: string | null
          creado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          etapa_id?: string | null
          tipo_evento?: Database["public"]["Enums"]["tipo_evento_ot"]
          descripcion?: string
          datos?: Json
          usuario_id?: string | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_bitacora_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_bitacora_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_bitacora_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_checklists: {
        Row: {
          id: string
          orden_id: string
          tipo: string
          identidad_verificada: boolean
          documentos_verificados: boolean
          materiales_verificados: boolean
          condicion_verificada: boolean
          observacion: string
          registrado_por: string
          completado_en: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          tipo: string
          identidad_verificada?: boolean
          documentos_verificados?: boolean
          materiales_verificados?: boolean
          condicion_verificada?: boolean
          observacion?: string
          registrado_por?: string
          completado_en?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          tipo?: string
          identidad_verificada?: boolean
          documentos_verificados?: boolean
          materiales_verificados?: boolean
          condicion_verificada?: boolean
          observacion?: string
          registrado_por?: string
          completado_en?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_checklists_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_checklists_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_control_vehicular: {
        Row: {
          id: string
          orden_id: string
          placa: string
          marca: string
          conductor_ingreso: string
          dni_ingreso: string
          fecha_ingreso: string | null
          combustible_ingreso: string
          conductor_salida: string
          dni_salida: string
          fecha_salida: string | null
          combustible_salida: string
          adicionales: string
          trabajos: string
          observacion_ingreso: string
          observacion_salida: string
          items: Json
          ingreso_cerrado_en: string | null
          salida_cerrada_en: string | null
          escaneo_ruta: string | null
          escaneo_nombre: string | null
          registrado_por: string
          actualizado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          placa?: string
          marca?: string
          conductor_ingreso?: string
          dni_ingreso?: string
          fecha_ingreso?: string | null
          combustible_ingreso?: string
          conductor_salida?: string
          dni_salida?: string
          fecha_salida?: string | null
          combustible_salida?: string
          adicionales?: string
          trabajos?: string
          observacion_ingreso?: string
          observacion_salida?: string
          items?: Json
          ingreso_cerrado_en?: string | null
          salida_cerrada_en?: string | null
          escaneo_ruta?: string | null
          escaneo_nombre?: string | null
          registrado_por?: string
          actualizado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          placa?: string
          marca?: string
          conductor_ingreso?: string
          dni_ingreso?: string
          fecha_ingreso?: string | null
          combustible_ingreso?: string
          conductor_salida?: string
          dni_salida?: string
          fecha_salida?: string | null
          combustible_salida?: string
          adicionales?: string
          trabajos?: string
          observacion_ingreso?: string
          observacion_salida?: string
          items?: Json
          ingreso_cerrado_en?: string | null
          salida_cerrada_en?: string | null
          escaneo_ruta?: string | null
          escaneo_nombre?: string | null
          registrado_por?: string
          actualizado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_control_vehicular_actualizado_por_fkey"
            columns: ["actualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_control_vehicular_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: true
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_control_vehicular_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_entregas: {
        Row: {
          id: string
          numero: string
          orden_id: string
          fecha_entrega: string
          recibe_nombre: string
          recibe_documento: string | null
          recibe_cargo: string | null
          conforme: boolean
          observaciones: string | null
          garantia_meses: number
          garantia_vence: string | null
          entregado_por: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
          salida_confirmada_por: string | null
          salida_confirmada_en: string | null
        }
        Insert: {
          id?: string
          numero?: string
          orden_id: string
          fecha_entrega?: string
          recibe_nombre: string
          recibe_documento?: string | null
          recibe_cargo?: string | null
          conforme?: boolean
          observaciones?: string | null
          garantia_meses?: number
          entregado_por?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          salida_confirmada_por?: string | null
          salida_confirmada_en?: string | null
        }
        Update: {
          id?: string
          numero?: string
          orden_id?: string
          fecha_entrega?: string
          recibe_nombre?: string
          recibe_documento?: string | null
          recibe_cargo?: string | null
          conforme?: boolean
          observaciones?: string | null
          garantia_meses?: number
          entregado_por?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          salida_confirmada_por?: string | null
          salida_confirmada_en?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ot_entregas_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_entregas_entregado_por_fkey"
            columns: ["entregado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_entregas_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: true
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_entregas_salida_confirmada_por_fkey"
            columns: ["salida_confirmada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_equipo_diseno: {
        Row: {
          id: string
          orden_id: string
          nombre: string
          funcion: string
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          nombre: string
          funcion: string
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          nombre?: string
          funcion?: string
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_equipo_diseno_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_equipo_diseno_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: true
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_etapa_reportes: {
        Row: {
          id: string
          etapa_id: string
          orden_id: string
          texto: string
          creado_por: string | null
          creado_en: string
          verificado_por: string | null
          verificado_en: string | null
        }
        Insert: {
          id?: string
          etapa_id: string
          orden_id: string
          texto: string
          creado_por?: string | null
          creado_en?: string
          verificado_por?: string | null
          verificado_en?: string | null
        }
        Update: {
          id?: string
          etapa_id?: string
          orden_id?: string
          texto?: string
          creado_por?: string | null
          creado_en?: string
          verificado_por?: string | null
          verificado_en?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_reporte_etapa"
            columns: ["etapa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id", "orden_id"]
          },
          {
            foreignKeyName: "ot_etapa_reportes_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_etapa_reportes_verificado_por_fkey"
            columns: ["verificado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_etapas: {
        Row: {
          id: string
          orden_id: string
          etapa_catalogo_id: string | null
          estado: Database["public"]["Enums"]["estado_etapa_ot"]
          orden_secuencia: number
          avance_porcentaje: number
          fecha_inicio_programada: string | null
          fecha_fin_programada: string | null
          fecha_inicio_real: string | null
          fecha_fin_real: string | null
          horas_estimadas: number
          horas_reales: number
          responsable_id: string | null
          requiere_inspeccion: boolean
          observaciones: string | null
          creado_en: string
          actualizado_en: string
          area_id: string | null
          peso_pct: number | null
          nombre: string | null
        }
        Insert: {
          id?: string
          orden_id: string
          etapa_catalogo_id?: string | null
          estado?: Database["public"]["Enums"]["estado_etapa_ot"]
          orden_secuencia: number
          avance_porcentaje?: number
          fecha_inicio_programada?: string | null
          fecha_fin_programada?: string | null
          fecha_inicio_real?: string | null
          fecha_fin_real?: string | null
          horas_estimadas?: number
          horas_reales?: number
          responsable_id?: string | null
          requiere_inspeccion?: boolean
          observaciones?: string | null
          creado_en?: string
          actualizado_en?: string
          area_id?: string | null
          peso_pct?: number | null
          nombre?: string | null
        }
        Update: {
          id?: string
          orden_id?: string
          etapa_catalogo_id?: string | null
          estado?: Database["public"]["Enums"]["estado_etapa_ot"]
          orden_secuencia?: number
          avance_porcentaje?: number
          fecha_inicio_programada?: string | null
          fecha_fin_programada?: string | null
          fecha_inicio_real?: string | null
          fecha_fin_real?: string | null
          horas_estimadas?: number
          horas_reales?: number
          responsable_id?: string | null
          requiere_inspeccion?: boolean
          observaciones?: string | null
          creado_en?: string
          actualizado_en?: string
          area_id?: string | null
          peso_pct?: number | null
          nombre?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ot_etapas_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_etapas_etapa_catalogo_id_fkey"
            columns: ["etapa_catalogo_id"]
            isOneToOne: false
            referencedRelation: "etapas_catalogo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_etapas_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_etapas_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_gastos_areas: {
        Row: {
          id: string
          orden_id: string
          area_id: string
          tipo: string
          descripcion: string
          fecha: string
          monto: number
          moneda: string
          comprobante_ruta: string
          comprobante_nombre: string
          estado: string
          observacion_revision: string | null
          registrado_por: string
          revisado_por: string | null
          revisado_en: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          area_id: string
          tipo: string
          descripcion: string
          fecha: string
          monto: number
          moneda: string
          comprobante_ruta: string
          comprobante_nombre: string
          estado?: string
          observacion_revision?: string | null
          registrado_por?: string
          revisado_por?: string | null
          revisado_en?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          area_id?: string
          tipo?: string
          descripcion?: string
          fecha?: string
          monto?: number
          moneda?: string
          comprobante_ruta?: string
          comprobante_nombre?: string
          estado?: string
          observacion_revision?: string | null
          registrado_por?: string
          revisado_por?: string | null
          revisado_en?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_gastos_areas_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_gastos_areas_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_gastos_areas_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_gastos_areas_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_materiales: {
        Row: {
          id: string
          orden_id: string
          plano_id: string | null
          etapa_id: string | null
          material_id: string
          cantidad: number
          observacion: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
          area_destino: string
        }
        Insert: {
          id?: string
          orden_id: string
          plano_id?: string | null
          etapa_id?: string | null
          material_id: string
          cantidad: number
          observacion?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          area_destino?: string
        }
        Update: {
          id?: string
          orden_id?: string
          plano_id?: string | null
          etapa_id?: string | null
          material_id?: string
          cantidad?: number
          observacion?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          area_destino?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_ot_material_etapa"
            columns: ["etapa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id", "orden_id"]
          },
          {
            foreignKeyName: "fk_ot_material_plano"
            columns: ["plano_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_planos"
            referencedColumns: ["id", "orden_id"]
          },
          {
            foreignKeyName: "ot_materiales_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_materiales_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_materiales_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_mermas: {
        Row: {
          id: string
          orden_id: string
          porcentaje: number
          motivo: string
          registrado_por: string
          registrado_en: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          porcentaje: number
          motivo: string
          registrado_por?: string
          registrado_en?: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          porcentaje?: number
          motivo?: string
          registrado_por?: string
          registrado_en?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_mermas_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: true
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_mermas_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_observaciones: {
        Row: {
          id: string
          orden_id: string
          area_id: string
          descripcion: string
          registrado_por: string
          resolucion: string | null
          resuelta_por: string | null
          resuelta_en: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          area_id: string
          descripcion: string
          registrado_por?: string
          resolucion?: string | null
          resuelta_por?: string | null
          resuelta_en?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          area_id?: string
          descripcion?: string
          registrado_por?: string
          resolucion?: string | null
          resuelta_por?: string | null
          resuelta_en?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_observaciones_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_observaciones_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_observaciones_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_observaciones_resuelta_por_fkey"
            columns: ["resuelta_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_piezas: {
        Row: {
          id: string
          plano_id: string
          orden_id: string
          orden_secuencia: number
          numero_pieza: string
          nombre: string
          cantidad: number
          es_ensamble: boolean
          observacion: string | null
          mtz_inicio: string | null
          mtz_habilitado: boolean
          mtz_culminacion: string | null
          mtz_entregado: boolean
          mtz_observacion: string | null
          prd_recepcion: string | null
          prd_recibido: boolean
          prd_inicio: string | null
          prd_armado: boolean
          prd_observacion: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          plano_id: string
          orden_id: string
          orden_secuencia?: number
          numero_pieza: string
          nombre: string
          cantidad?: number
          es_ensamble?: boolean
          observacion?: string | null
          mtz_inicio?: string | null
          mtz_habilitado?: boolean
          mtz_culminacion?: string | null
          mtz_entregado?: boolean
          mtz_observacion?: string | null
          prd_recepcion?: string | null
          prd_recibido?: boolean
          prd_inicio?: string | null
          prd_armado?: boolean
          prd_observacion?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          plano_id?: string
          orden_id?: string
          orden_secuencia?: number
          numero_pieza?: string
          nombre?: string
          cantidad?: number
          es_ensamble?: boolean
          observacion?: string | null
          mtz_inicio?: string | null
          mtz_habilitado?: boolean
          mtz_culminacion?: string | null
          mtz_entregado?: boolean
          mtz_observacion?: string | null
          prd_recepcion?: string | null
          prd_recibido?: boolean
          prd_inicio?: string | null
          prd_armado?: boolean
          prd_observacion?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_pieza_plano"
            columns: ["plano_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_planos"
            referencedColumns: ["id", "orden_id"]
          }
        ]
      }
      ot_plano_versiones: {
        Row: {
          id: string
          plano_id: string
          area_id: string
          revision: number
          nombre_archivo: string
          ruta_storage: string
          estado: string
          vigente: boolean
          observacion: string | null
          creado_por: string
          revisado_por: string | null
          revisado_en: string | null
          recibido_por: string | null
          recibido_en: string | null
          creado_en: string
          actualizado_en: string
          nota_envio: string | null
          revision_diseno: string
          revision_diseno_por: string | null
          revision_diseno_en: string | null
          observacion_diseno: string | null
        }
        Insert: {
          id: string
          plano_id: string
          area_id: string
          revision: number
          nombre_archivo: string
          ruta_storage: string
          estado?: string
          vigente?: boolean
          observacion?: string | null
          creado_por: string
          revisado_por?: string | null
          revisado_en?: string | null
          recibido_por?: string | null
          recibido_en?: string | null
          creado_en?: string
          actualizado_en?: string
          nota_envio?: string | null
          revision_diseno?: string
          revision_diseno_por?: string | null
          revision_diseno_en?: string | null
          observacion_diseno?: string | null
        }
        Update: {
          id?: string
          plano_id?: string
          area_id?: string
          revision?: number
          nombre_archivo?: string
          ruta_storage?: string
          estado?: string
          vigente?: boolean
          observacion?: string | null
          creado_por?: string
          revisado_por?: string | null
          revisado_en?: string | null
          recibido_por?: string | null
          recibido_en?: string | null
          creado_en?: string
          actualizado_en?: string
          nota_envio?: string | null
          revision_diseno?: string
          revision_diseno_por?: string | null
          revision_diseno_en?: string | null
          observacion_diseno?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ot_plano_versiones_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_plano_versiones_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_plano_versiones_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "ot_planos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_plano_versiones_recibido_por_fkey"
            columns: ["recibido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_plano_versiones_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_plano_versiones_revision_diseno_por_fkey"
            columns: ["revision_diseno_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_planos: {
        Row: {
          id: string
          orden_id: string
          orden_secuencia: number
          numero_plano: string
          nombre: string
          peso_pct: number
          fecha_entrega: string | null
          observacion: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
          responsable_diseno_id: string | null
          etapa_id: string | null
          integrante_diseno_id: string | null
        }
        Insert: {
          id?: string
          orden_id: string
          orden_secuencia?: number
          numero_plano: string
          nombre: string
          peso_pct?: number
          fecha_entrega?: string | null
          observacion?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          responsable_diseno_id?: string | null
          etapa_id?: string | null
          integrante_diseno_id?: string | null
        }
        Update: {
          id?: string
          orden_id?: string
          orden_secuencia?: number
          numero_plano?: string
          nombre?: string
          peso_pct?: number
          fecha_entrega?: string | null
          observacion?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          responsable_diseno_id?: string | null
          etapa_id?: string | null
          integrante_diseno_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_ot_plano_etapa_orden"
            columns: ["etapa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id", "orden_id"]
          },
          {
            foreignKeyName: "ot_planos_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_planos_integrante_diseno_id_fkey"
            columns: ["integrante_diseno_id"]
            isOneToOne: false
            referencedRelation: "ot_equipo_diseno"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_planos_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_planos_responsable_diseno_id_fkey"
            columns: ["responsable_diseno_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_repuestos: {
        Row: {
          id: string
          orden_id: string
          orden: number
          cantidad: number
          descripcion: string
          marca: string | null
          observacion: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          orden?: number
          cantidad?: number
          descripcion: string
          marca?: string | null
          observacion?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          orden?: number
          cantidad?: number
          descripcion?: string
          marca?: string | null
          observacion?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_repuestos_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_salidas: {
        Row: {
          id: string
          entrega_id: string
          registrado_por: string
          constancia: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          entrega_id: string
          registrado_por: string
          constancia: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          entrega_id?: string
          registrado_por?: string
          constancia?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_salidas_entrega_id_fkey"
            columns: ["entrega_id"]
            isOneToOne: true
            referencedRelation: "ot_entregas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_salidas_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_solicitudes_tesoreria: {
        Row: {
          id: string
          orden_id: string
          tipo: string
          concepto: string
          monto: number | null
          moneda: string | null
          estado: string
          respuesta: string | null
          solicitado_por: string
          atendido_por: string | null
          atendido_en: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          tipo: string
          concepto: string
          monto?: number | null
          moneda?: string | null
          estado?: string
          respuesta?: string | null
          solicitado_por?: string
          atendido_por?: string | null
          atendido_en?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          tipo?: string
          concepto?: string
          monto?: number | null
          moneda?: string | null
          estado?: string
          respuesta?: string | null
          solicitado_por?: string
          atendido_por?: string | null
          atendido_en?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_solicitudes_tesoreria_atendido_por_fkey"
            columns: ["atendido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_solicitudes_tesoreria_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_solicitudes_tesoreria_solicitado_por_fkey"
            columns: ["solicitado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_ventas_anteriores: {
        Row: {
          id: string
          orden_id: string
          cliente_id: string | null
          cotizacion_pdf_id: string | null
          datos: Json
          creado_por: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          cliente_id?: string | null
          cotizacion_pdf_id?: string | null
          datos: Json
          creado_por: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          cliente_id?: string | null
          cotizacion_pdf_id?: string | null
          datos?: Json
          creado_por?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_ventas_anteriores_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_ventas_anteriores_cotizacion_pdf_id_fkey"
            columns: ["cotizacion_pdf_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones_pdf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_ventas_anteriores_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_ventas_anteriores_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_verificaciones: {
        Row: {
          id: string
          orden_id: string
          numero: number
          descripcion: string
          responsable_id: string | null
          avance_1: boolean
          avance_1_en: string | null
          avance_2: boolean
          avance_2_en: string | null
          observaciones: string | null
          creado_en: string
          actualizado_en: string
          avance_1_por: string | null
          avance_2_por: string | null
        }
        Insert: {
          id?: string
          orden_id: string
          numero: number
          descripcion: string
          responsable_id?: string | null
          avance_1?: boolean
          avance_1_en?: string | null
          avance_2?: boolean
          avance_2_en?: string | null
          observaciones?: string | null
          creado_en?: string
          actualizado_en?: string
          avance_1_por?: string | null
          avance_2_por?: string | null
        }
        Update: {
          id?: string
          orden_id?: string
          numero?: number
          descripcion?: string
          responsable_id?: string | null
          avance_1?: boolean
          avance_1_en?: string | null
          avance_2?: boolean
          avance_2_en?: string | null
          observaciones?: string | null
          creado_en?: string
          actualizado_en?: string
          avance_1_por?: string | null
          avance_2_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ot_verificaciones_avance_1_por_fkey"
            columns: ["avance_1_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_verificaciones_avance_2_por_fkey"
            columns: ["avance_2_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_verificaciones_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_verificaciones_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      pagos_adquisicion: {
        Row: {
          id: string
          adquisicion_id: string
          fecha: string
          monto: number
          referencia: string
          registrado_por: string
          creado_en: string
        }
        Insert: {
          id?: string
          adquisicion_id: string
          fecha: string
          monto: number
          referencia: string
          registrado_por?: string
          creado_en?: string
        }
        Update: {
          id?: string
          adquisicion_id?: string
          fecha?: string
          monto?: number
          referencia?: string
          registrado_por?: string
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "pagos_adquisicion_adquisicion_id_fkey"
            columns: ["adquisicion_id"]
            isOneToOne: false
            referencedRelation: "adquisiciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_adquisicion_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      permisos: {
        Row: {
          codigo: string
          modulo: string
          descripcion: string
        }
        Insert: {
          codigo: string
          modulo: string
          descripcion: string
        }
        Update: {
          codigo?: string
          modulo?: string
          descripcion?: string
        }
        Relationships: []
      }
      planilla_distribuciones: {
        Row: {
          id: string
          persona_id: string
          orden_id: string
          porcentaje: number
          registrado_por: string
          creado_en: string
        }
        Insert: {
          id?: string
          persona_id: string
          orden_id: string
          porcentaje: number
          registrado_por?: string
          creado_en?: string
        }
        Update: {
          id?: string
          persona_id?: string
          orden_id?: string
          porcentaje?: number
          registrado_por?: string
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "planilla_distribuciones_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planilla_distribuciones_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "planilla_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planilla_distribuciones_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      planilla_personas: {
        Row: {
          id: string
          planilla_id: string
          nombre: string
          documento: string | null
          monto: number
          registrado_por: string
          creado_en: string
          detalle: Json | null
          origen_hoja: string | null
          fila_origen: number | null
          importacion_id: string | null
        }
        Insert: {
          id?: string
          planilla_id: string
          nombre: string
          documento?: string | null
          monto: number
          registrado_por?: string
          creado_en?: string
          detalle?: Json | null
          origen_hoja?: string | null
          fila_origen?: number | null
          importacion_id?: string | null
        }
        Update: {
          id?: string
          planilla_id?: string
          nombre?: string
          documento?: string | null
          monto?: number
          registrado_por?: string
          creado_en?: string
          detalle?: Json | null
          origen_hoja?: string | null
          fila_origen?: number | null
          importacion_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "planilla_personas_planilla_id_fkey"
            columns: ["planilla_id"]
            isOneToOne: false
            referencedRelation: "planillas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planilla_personas_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      planillas: {
        Row: {
          id: string
          tipo: string
          periodo: string
          moneda: string
          estado: string
          observacion: string
          registrado_por: string
          cerrado_por: string | null
          cerrado_en: string | null
          creado_en: string
        }
        Insert: {
          id?: string
          tipo: string
          periodo: string
          moneda?: string
          estado?: string
          observacion?: string
          registrado_por?: string
          cerrado_por?: string | null
          cerrado_en?: string | null
          creado_en?: string
        }
        Update: {
          id?: string
          tipo?: string
          periodo?: string
          moneda?: string
          estado?: string
          observacion?: string
          registrado_por?: string
          cerrado_por?: string | null
          cerrado_en?: string | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "planillas_cerrado_por_fkey"
            columns: ["cerrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planillas_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      plantilla_ficha_accesorios: {
        Row: {
          id: string
          plantilla_id: string
          orden: number
          cantidad: number
          unidad: string
          descripcion: string
          incluye_el_accesorio: boolean
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          plantilla_id: string
          orden?: number
          cantidad?: number
          unidad?: string
          descripcion: string
          incluye_el_accesorio?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          plantilla_id?: string
          orden?: number
          cantidad?: number
          unidad?: string
          descripcion?: string
          incluye_el_accesorio?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "plantilla_ficha_accesorios_plantilla_id_fkey"
            columns: ["plantilla_id"]
            isOneToOne: false
            referencedRelation: "plantillas_ficha"
            referencedColumns: ["id"]
          }
        ]
      }
      plantilla_ficha_lineas: {
        Row: {
          id: string
          plantilla_id: string
          seccion: string
          orden_seccion: number
          orden_linea: number
          etiqueta: string | null
          detalle: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          plantilla_id: string
          seccion: string
          orden_seccion?: number
          orden_linea?: number
          etiqueta?: string | null
          detalle: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          plantilla_id?: string
          seccion?: string
          orden_seccion?: number
          orden_linea?: number
          etiqueta?: string | null
          detalle?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "plantilla_ficha_lineas_plantilla_id_fkey"
            columns: ["plantilla_id"]
            isOneToOne: false
            referencedRelation: "plantillas_ficha"
            referencedColumns: ["id"]
          }
        ]
      }
      plantillas_ficha: {
        Row: {
          id: string
          tipo_carroceria_id: string | null
          nombre: string
          descripcion: string | null
          activa: boolean
          creado_en: string
          actualizado_en: string
          predeterminada: boolean
          tipo_unidad: Database["public"]["Enums"]["tipo_unidad_carroceria"] | null
          capacidad_habitual: string | null
          fuentes: string[]
        }
        Insert: {
          id?: string
          tipo_carroceria_id?: string | null
          nombre: string
          descripcion?: string | null
          activa?: boolean
          creado_en?: string
          actualizado_en?: string
          predeterminada?: boolean
          tipo_unidad?: Database["public"]["Enums"]["tipo_unidad_carroceria"] | null
          capacidad_habitual?: string | null
          fuentes?: string[]
        }
        Update: {
          id?: string
          tipo_carroceria_id?: string | null
          nombre?: string
          descripcion?: string | null
          activa?: boolean
          creado_en?: string
          actualizado_en?: string
          predeterminada?: boolean
          tipo_unidad?: Database["public"]["Enums"]["tipo_unidad_carroceria"] | null
          capacidad_habitual?: string | null
          fuentes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "plantillas_ficha_tipo_carroceria_id_fkey"
            columns: ["tipo_carroceria_id"]
            isOneToOne: true
            referencedRelation: "tipos_carroceria"
            referencedColumns: ["id"]
          }
        ]
      }
      plantillas_verificacion: {
        Row: {
          id: string
          tipo_carroceria_id: string | null
          numero: number
          descripcion: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          tipo_carroceria_id?: string | null
          numero: number
          descripcion: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          tipo_carroceria_id?: string | null
          numero?: number
          descripcion?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "plantillas_verificacion_tipo_carroceria_id_fkey"
            columns: ["tipo_carroceria_id"]
            isOneToOne: false
            referencedRelation: "tipos_carroceria"
            referencedColumns: ["id"]
          }
        ]
      }
      pruebas_cuentas: {
        Row: {
          usuario_id: string
          motivo: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          usuario_id: string
          motivo: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          usuario_id?: string
          motivo?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "pruebas_cuentas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: true
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      pruebas_filas: {
        Row: {
          orden: number
          lote_id: string
          tabla: string
          fila_id: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          orden?: number
          lote_id: string
          tabla: string
          fila_id: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          orden?: number
          lote_id?: string
          tabla?: string
          fila_id?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "pruebas_filas_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "pruebas_lotes"
            referencedColumns: ["id"]
          }
        ]
      }
      pruebas_lotes: {
        Row: {
          id: string
          motivo: string
          cuentas: string[]
          abierto_en: string
          limpiado_en: string | null
          filas_borradas: number | null
          archivos_pendientes: Json | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          motivo: string
          cuentas?: string[]
          abierto_en?: string
          limpiado_en?: string | null
          filas_borradas?: number | null
          archivos_pendientes?: Json | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          motivo?: string
          cuentas?: string[]
          abierto_en?: string
          limpiado_en?: string | null
          filas_borradas?: number | null
          archivos_pendientes?: Json | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: []
      }
      requerimiento_material_detalles: {
        Row: {
          id: string
          requerimiento_id: string
          ot_material_id: string
          cantidad_solicitada: number
          creado_en: string
          actualizado_en: string
          aprobacion_diseno: string
          aprobado_por: string | null
          aprobado_en: string | null
          decision_almacen: string
          revisado_por: string | null
          revisado_en: string | null
          cantidad_stock: number | null
        }
        Insert: {
          id?: string
          requerimiento_id: string
          ot_material_id: string
          cantidad_solicitada: number
          creado_en?: string
          actualizado_en?: string
          aprobacion_diseno?: string
          aprobado_por?: string | null
          aprobado_en?: string | null
          decision_almacen?: string
          revisado_por?: string | null
          revisado_en?: string | null
          cantidad_stock?: number | null
        }
        Update: {
          id?: string
          requerimiento_id?: string
          ot_material_id?: string
          cantidad_solicitada?: number
          creado_en?: string
          actualizado_en?: string
          aprobacion_diseno?: string
          aprobado_por?: string | null
          aprobado_en?: string | null
          decision_almacen?: string
          revisado_por?: string | null
          revisado_en?: string | null
          cantidad_stock?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "requerimiento_material_detalles_aprobado_por_fkey"
            columns: ["aprobado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requerimiento_material_detalles_ot_material_id_fkey"
            columns: ["ot_material_id"]
            isOneToOne: true
            referencedRelation: "ot_materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requerimiento_material_detalles_requerimiento_id_fkey"
            columns: ["requerimiento_id"]
            isOneToOne: false
            referencedRelation: "requerimientos_materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requerimiento_material_detalles_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      requerimientos_materiales: {
        Row: {
          id: string
          orden_id: string
          area_destino: string
          solicitado_por: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          area_destino: string
          solicitado_por?: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          area_destino?: string
          solicitado_por?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "requerimientos_materiales_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requerimientos_materiales_solicitado_por_fkey"
            columns: ["solicitado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      roles: {
        Row: {
          id: string
          codigo: string
          nombre: string
          descripcion: string | null
          nivel: number
          es_sistema: boolean
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          codigo: string
          nombre: string
          descripcion?: string | null
          nivel?: number
          es_sistema?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          codigo?: string
          nombre?: string
          descripcion?: string | null
          nivel?: number
          es_sistema?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: []
      }
      roles_permisos: {
        Row: {
          rol_id: string
          permiso_codigo: string
        }
        Insert: {
          rol_id: string
          permiso_codigo: string
        }
        Update: {
          rol_id?: string
          permiso_codigo?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_permisos_permiso_codigo_fkey"
            columns: ["permiso_codigo"]
            isOneToOne: false
            referencedRelation: "permisos"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "roles_permisos_rol_id_fkey"
            columns: ["rol_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          }
        ]
      }
      sedes: {
        Row: {
          id: string
          codigo: string
          nombre: string
          direccion: string | null
          telefono: string | null
          responsable: string | null
          capacidad_ot_simultaneas: number | null
          activo: boolean
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          codigo: string
          nombre: string
          direccion?: string | null
          telefono?: string | null
          responsable?: string | null
          capacidad_ot_simultaneas?: number | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          codigo?: string
          nombre?: string
          direccion?: string | null
          telefono?: string | null
          responsable?: string | null
          capacidad_ot_simultaneas?: number | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: []
      }
      series_documentarias: {
        Row: {
          id: string
          tipo: Database["public"]["Enums"]["tipo_correlativo"]
          serie: string
          prefijo: string
          correlativo_actual: number
          longitud: number
          sede_id: string | null
          activo: boolean
          creado_en: string
          actualizado_en: string
          formato: string
        }
        Insert: {
          id?: string
          tipo: Database["public"]["Enums"]["tipo_correlativo"]
          serie?: string
          prefijo?: string
          correlativo_actual?: number
          longitud?: number
          sede_id?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          formato?: string
        }
        Update: {
          id?: string
          tipo?: Database["public"]["Enums"]["tipo_correlativo"]
          serie?: string
          prefijo?: string
          correlativo_actual?: number
          longitud?: number
          sede_id?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          formato?: string
        }
        Relationships: [
          {
            foreignKeyName: "series_documentarias_sede_id_fkey"
            columns: ["sede_id"]
            isOneToOne: false
            referencedRelation: "sedes"
            referencedColumns: ["id"]
          }
        ]
      }
      tipos_carroceria: {
        Row: {
          id: string
          codigo: string
          nombre: string
          descripcion: string | null
          horas_hombre_estandar: number
          peso_estimado_kg: number
          precio_referencial: number
          moneda_referencial: Database["public"]["Enums"]["moneda"]
          orden_secuencia: number
          activo: boolean
          creado_en: string
          actualizado_en: string
          modelo: string | null
          tipo: string | null
          largo_m: number | null
          ancho_m: number | null
          alto_m: number | null
          capacidad: string | null
          peso_neto_tn: number | null
          carroceria_texto: string | null
          largo_util_m: number | null
          ejes: string | null
          normas: string | null
          tipo_unidad: Database["public"]["Enums"]["tipo_unidad_carroceria"] | null
          categoria_vehicular: Database["public"]["Enums"]["categoria_vehicular"] | null
        }
        Insert: {
          id?: string
          codigo: string
          nombre: string
          descripcion?: string | null
          horas_hombre_estandar?: number
          peso_estimado_kg?: number
          precio_referencial?: number
          moneda_referencial?: Database["public"]["Enums"]["moneda"]
          orden_secuencia?: number
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          modelo?: string | null
          tipo?: string | null
          largo_m?: number | null
          ancho_m?: number | null
          alto_m?: number | null
          capacidad?: string | null
          peso_neto_tn?: number | null
          carroceria_texto?: string | null
          largo_util_m?: number | null
          ejes?: string | null
          normas?: string | null
          tipo_unidad?: Database["public"]["Enums"]["tipo_unidad_carroceria"] | null
          categoria_vehicular?: Database["public"]["Enums"]["categoria_vehicular"] | null
        }
        Update: {
          id?: string
          codigo?: string
          nombre?: string
          descripcion?: string | null
          horas_hombre_estandar?: number
          peso_estimado_kg?: number
          precio_referencial?: number
          moneda_referencial?: Database["public"]["Enums"]["moneda"]
          orden_secuencia?: number
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          modelo?: string | null
          tipo?: string | null
          largo_m?: number | null
          ancho_m?: number | null
          alto_m?: number | null
          capacidad?: string | null
          peso_neto_tn?: number | null
          carroceria_texto?: string | null
          largo_util_m?: number | null
          ejes?: string | null
          normas?: string | null
          tipo_unidad?: Database["public"]["Enums"]["tipo_unidad_carroceria"] | null
          categoria_vehicular?: Database["public"]["Enums"]["categoria_vehicular"] | null
        }
        Relationships: []
      }
      unidades: {
        Row: {
          id: string
          cliente_id: string | null
          placa: string | null
          tipo_vehiculo: Database["public"]["Enums"]["tipo_vehiculo"]
          marca: string | null
          modelo: string | null
          anio: number | null
          numero_chasis: string | null
          numero_motor: string | null
          color: string | null
          capacidad_m3: number | null
          capacidad_toneladas: number | null
          tipo_carroceria_id: string | null
          observaciones: string | null
          activo: boolean
          creado_en: string
          actualizado_en: string
          creado_por: string | null
          codigo_interno: string | null
          numero_fmi: string | null
        }
        Insert: {
          id?: string
          cliente_id?: string | null
          placa?: string | null
          tipo_vehiculo?: Database["public"]["Enums"]["tipo_vehiculo"]
          marca?: string | null
          modelo?: string | null
          anio?: number | null
          numero_chasis?: string | null
          numero_motor?: string | null
          color?: string | null
          capacidad_m3?: number | null
          capacidad_toneladas?: number | null
          tipo_carroceria_id?: string | null
          observaciones?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          creado_por?: string | null
          codigo_interno?: string | null
          numero_fmi?: string | null
        }
        Update: {
          id?: string
          cliente_id?: string | null
          placa?: string | null
          tipo_vehiculo?: Database["public"]["Enums"]["tipo_vehiculo"]
          marca?: string | null
          modelo?: string | null
          anio?: number | null
          numero_chasis?: string | null
          numero_motor?: string | null
          color?: string | null
          capacidad_m3?: number | null
          capacidad_toneladas?: number | null
          tipo_carroceria_id?: string | null
          observaciones?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          creado_por?: string | null
          codigo_interno?: string | null
          numero_fmi?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unidades_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unidades_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unidades_tipo_carroceria_id_fkey"
            columns: ["tipo_carroceria_id"]
            isOneToOne: false
            referencedRelation: "tipos_carroceria"
            referencedColumns: ["id"]
          }
        ]
      }
      unidades_medida: {
        Row: {
          id: string
          codigo: string
          nombre: string
          magnitud: Database["public"]["Enums"]["magnitud_medida"]
          unidad_base_id: string | null
          factor_conversion: number
          decimales: number
          activo: boolean
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          codigo: string
          nombre: string
          magnitud?: Database["public"]["Enums"]["magnitud_medida"]
          unidad_base_id?: string | null
          factor_conversion?: number
          decimales?: number
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          codigo?: string
          nombre?: string
          magnitud?: Database["public"]["Enums"]["magnitud_medida"]
          unidad_base_id?: string | null
          factor_conversion?: number
          decimales?: number
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "unidades_medida_unidad_base_id_fkey"
            columns: ["unidad_base_id"]
            isOneToOne: false
            referencedRelation: "unidades_medida"
            referencedColumns: ["id"]
          }
        ]
      }
      usuarios: {
        Row: {
          id: string
          codigo: string | null
          nombres: string
          apellidos: string
          documento: string | null
          correo: string
          telefono: string | null
          cargo: string | null
          rol_id: string
          sede_id: string | null
          es_operario: boolean
          costo_hora: number
          fecha_ingreso: string | null
          foto_url: string | null
          activo: boolean
          creado_en: string
          actualizado_en: string
          area_id: string | null
        }
        Insert: {
          id: string
          codigo?: string | null
          nombres: string
          apellidos: string
          documento?: string | null
          correo: string
          telefono?: string | null
          cargo?: string | null
          rol_id: string
          sede_id?: string | null
          es_operario?: boolean
          costo_hora?: number
          fecha_ingreso?: string | null
          foto_url?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          area_id?: string | null
        }
        Update: {
          id?: string
          codigo?: string | null
          nombres?: string
          apellidos?: string
          documento?: string | null
          correo?: string
          telefono?: string | null
          cargo?: string | null
          rol_id?: string
          sede_id?: string | null
          es_operario?: boolean
          costo_hora?: number
          fecha_ingreso?: string | null
          foto_url?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          area_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_usuarios_auth"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usuarios_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usuarios_rol_id_fkey"
            columns: ["rol_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usuarios_sede_id_fkey"
            columns: ["sede_id"]
            isOneToOne: false
            referencedRelation: "sedes"
            referencedColumns: ["id"]
          }
        ]
      }
      valorizaciones_material: {
        Row: {
          id: string
          material_id: string
          precio: number
          moneda: string
          observacion: string
          registrado_por: string
          vigente_desde: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id: string
          material_id: string
          precio: number
          moneda: string
          observacion?: string
          registrado_por?: string
          vigente_desde?: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          material_id?: string
          precio?: number
          moneda?: string
          observacion?: string
          registrado_por?: string
          vigente_desde?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "valorizaciones_material_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valorizaciones_material_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      ot_avance_resumen: {
        Row: {
          id: string | null
          orden_id: string | null
          orden_numero: string | null
          orden_estado: Database["public"]["Enums"]["estado_ot"] | null
          cliente: string | null
          placa: string | null
          etapa_id: string | null
          etapa: string | null
          fecha: string | null
          descripcion: string | null
          avance_porcentaje: number | null
          impedimento: string | null
          registrado_por: string | null
          registrado_por_nombre: string | null
          creado_en: string | null
          fotos: number | null
          revision: string | null
          observacion: string | null
          revisado_en: string | null
          revisado_por_nombre: string | null
          corregido_en: string | null
        }
        Relationships: []
      }
      ot_fechas_clave: {
        Row: {
          orden_id: string | null
          numero: string | null
          fecha_registro: string | null
          limite_os_produccion: string | null
          limite_diseno: string | null
          limite_os_acabados: string | null
          limite_certificados: string | null
          limite_tarjeta_placas: string | null
          primera_os: string | null
          fecha_entrega: string | null
        }
        Relationships: []
      }
      ot_ficha_resumen: {
        Row: {
          orden_id: string | null
          numero: string | null
          accesorios: number | null
          accesorios_verificados: number | null
          pasos: number | null
          pasos_avance_1: number | null
          pasos_avance_2: number | null
          repuestos: number | null
        }
        Relationships: []
      }
      ot_resumen: {
        Row: {
          id: string | null
          numero: string | null
          estado: Database["public"]["Enums"]["estado_ot"] | null
          prioridad: Database["public"]["Enums"]["prioridad_ot"] | null
          tipo_trabajo: Database["public"]["Enums"]["tipo_trabajo_ot"] | null
          sede_id: string | null
          sede: string | null
          cliente_id: string | null
          cliente: string | null
          cliente_documento: string | null
          unidad_id: string | null
          placa: string | null
          tipo_carroceria: string | null
          descripcion: string | null
          fecha_registro: string | null
          fecha_inicio_programada: string | null
          fecha_fin_programada: string | null
          fecha_entrega_comprometida: string | null
          fecha_inicio_real: string | null
          fecha_fin_real: string | null
          avance_porcentaje: number | null
          horas_estimadas: number | null
          horas_reales: number | null
          desviacion_horas: number | null
          responsable_id: string | null
          responsable: string | null
          etapas_total: number | null
          etapas_terminadas: number | null
          etapas_en_proceso: number | null
          dias_atraso: number | null
          dias_habiles_restantes: number | null
          codigo_interno: string | null
          numero_chasis: string | null
          marca: string | null
          modelo: string | null
          abierta_en_taller: boolean | null
        }
        Relationships: []
      }
      ot_tablero_etapas: {
        Row: {
          etapa_id: string | null
          orden_id: string | null
          ot_numero: string | null
          ot_estado: Database["public"]["Enums"]["estado_ot"] | null
          prioridad: Database["public"]["Enums"]["prioridad_ot"] | null
          sede_id: string | null
          cliente: string | null
          placa: string | null
          etapa_codigo: string | null
          etapa: string | null
          permite_paralelo: boolean | null
          orden_secuencia: number | null
          estado: Database["public"]["Enums"]["estado_etapa_ot"] | null
          avance_porcentaje: number | null
          horas_estimadas: number | null
          fecha_inicio_programada: string | null
          fecha_fin_programada: string | null
          fecha_inicio_real: string | null
          fecha_fin_real: string | null
          responsable_id: string | null
        }
        Relationships: []
      }
      unidad_tablero: {
        Row: {
          orden_id: string | null
          orden_numero: string | null
          orden_estado: Database["public"]["Enums"]["estado_ot"] | null
          prioridad: Database["public"]["Enums"]["prioridad_ot"] | null
          sede_id: string | null
          unidad_id: string | null
          placa: string | null
          tipo_vehiculo: Database["public"]["Enums"]["tipo_vehiculo"] | null
          marca: string | null
          modelo: string | null
          cliente_id: string | null
          cliente: string | null
          tipo_carroceria: string | null
          descripcion: string | null
          avance_porcentaje: number | null
          fecha_entrega_comprometida: string | null
          dias_habiles_restantes: number | null
          responsable: string | null
          etapa_actual: string | null
          estado_etapa: Database["public"]["Enums"]["estado_etapa_ot"] | null
          avance_etapa: number | null
          ultimo_avance_fecha: string | null
          ultimo_avance: string | null
          dias_sin_avance: number | null
          impedimento: string | null
          fotos: number | null
          abierta_en_taller: boolean | null
        }
        Relationships: []
      }
      usuarios_nombre_completo: {
        Row: {
          id: string | null
          nombre_completo: string | null
        }
        Relationships: []
      }
      v_atencion_materiales: {
        Row: {
          requerimiento_id: string | null
          detalle_id: string | null
          orden_id: string | null
          numero_ot: string | null
          area_destino: string | null
          ot_material_id: string | null
          numero_plano: string | null
          plano: string | null
          material_id: string | null
          material_codigo: string | null
          material: string | null
          unidad: string | null
          cantidad_solicitada: number | null
          cantidad_comprada: number | null
          cantidad_recibida: number | null
          cantidad_despachada: number | null
          estado: string | null
          responsables: string | null
          solicitado_por: string | null
          creado_en: string | null
        }
        Relationships: []
      }
      v_compras_credito_sin_comprobante: {
        Row: {
          orden_compra_id: string | null
          orden_id: string | null
          numero_ot: string | null
          proveedor: string | null
          referencia: string | null
          fecha_compra: string | null
          fecha_vencimiento: string | null
          total_estimado: number | null
          moneda: string | null
        }
        Relationships: []
      }
      v_cotizaciones_pdf: {
        Row: {
          id: string | null
          numero: string | null
          estado: string | null
          observacion: string | null
          cliente_id: string | null
          cliente: string | null
          tipo_carroceria_id: string | null
          carroceria: string | null
          nombre_archivo: string | null
          ruta_storage: string | null
          tamano_bytes: number | null
          creado_en: string | null
          registrado_por: string | null
          registrado_por_nombre: string | null
          revisado_en: string | null
          revisado_por_nombre: string | null
          orden_id: string | null
          orden_numero: string | null
          orden_estado: string | null
          tuvo_orden: boolean | null
          version: number | null
          mime_type: string | null
          archivo_subido_en: string | null
          monto_venta: number | null
          moneda: Database["public"]["Enums"]["moneda"] | null
        }
        Relationships: []
      }
      v_cotizaciones_pdf_versiones: {
        Row: {
          id: string | null
          cotizacion_id: string | null
          version: number | null
          nombre_archivo: string | null
          ruta_storage: string | null
          mime_type: string | null
          tamano_bytes: number | null
          subido_en: string | null
          observacion: string | null
          rechazado_en: string | null
          rechazado_por_nombre: string | null
          estado_al_archivar: string | null
        }
        Relationships: []
      }
      v_cronograma_ot: {
        Row: {
          etapa_id: string | null
          orden_id: string | null
          etapa_codigo: string | null
          etapa: string | null
          color: string | null
          orden_secuencia: number | null
          area_codigo: string | null
          area_nombre: string | null
          estado: Database["public"]["Enums"]["estado_etapa_ot"] | null
          avance_porcentaje: number | null
          fecha_inicio_programada: string | null
          fecha_fin_programada: string | null
          fecha_inicio_real: string | null
          fecha_fin_real: string | null
          dias: number | null
          plazo: Database["public"]["Enums"]["estado_plazo"] | null
          ultimo_reporte: string | null
          ultimo_reporte_en: string | null
        }
        Relationships: []
      }
      v_cuentas_cobrar_ot: {
        Row: {
          id: string | null
          orden_id: string | null
          numero_ot: string | null
          numero_documento: string | null
          fecha_emision: string | null
          fecha_vencimiento: string | null
          moneda: string | null
          total: number | null
          cobrado: number | null
          saldo: number | null
        }
        Relationships: []
      }
      v_cuentas_pagar: {
        Row: {
          id: string | null
          orden_id: string | null
          numero_ot: string | null
          proveedor: string | null
          numero_documento: string | null
          fecha_emision: string | null
          fecha_vencimiento: string | null
          moneda: string | null
          total: number | null
          pagado: number | null
          saldo: number | null
        }
        Relationships: []
      }
      v_cumplimiento_ot: {
        Row: {
          orden_id: string | null
          numero: string | null
          planos: number | null
          planos_entregados: number | null
          piezas: number | null
          piezas_entregadas: number | null
          piezas_armadas: number | null
          peso_total: number | null
          avance_pct: number | null
          primer_plano: string | null
          ultimo_plano: string | null
        }
        Relationships: []
      }
      v_cumplimiento_piezas: {
        Row: {
          id: string | null
          plano_id: string | null
          orden_id: string | null
          orden_secuencia: number | null
          numero_pieza: string | null
          nombre: string | null
          cantidad: number | null
          es_ensamble: boolean | null
          observacion: string | null
          mtz_inicio: string | null
          mtz_habilitado: boolean | null
          mtz_culminacion: string | null
          mtz_entregado: boolean | null
          mtz_observacion: string | null
          prd_recepcion: string | null
          prd_recibido: boolean | null
          prd_inicio: string | null
          prd_armado: boolean | null
          prd_observacion: string | null
          creado_en: string | null
          actualizado_en: string | null
          avance_pct: number | null
        }
        Relationships: []
      }
      v_cumplimiento_planos: {
        Row: {
          plano_id: string | null
          orden_id: string | null
          orden_secuencia: number | null
          numero_plano: string | null
          nombre: string | null
          peso_pct: number | null
          fecha_entrega: string | null
          observacion: string | null
          piezas: number | null
          piezas_entregadas: number | null
          piezas_armadas: number | null
          avance_pct: number | null
          mtz_desde: string | null
          mtz_hasta: string | null
          prd_desde: string | null
          prd_hasta: string | null
        }
        Relationships: []
      }
      v_documentos_compra_tesoreria: {
        Row: {
          id: string | null
          orden_compra_id: string | null
          tipo: string | null
          nombre_archivo: string | null
          ruta_storage: string | null
          mime_type: string | null
          tamano_bytes: number | null
          subido_por: string | null
          creado_en: string | null
          proveedor: string | null
          referencia: string | null
          fecha_estimada: string | null
          orden_id: string | null
          numero_ot: string | null
          area_destino: string | null
          vinculos_ot: Json | null
        }
        Relationships: []
      }
      v_equipo_diseno_ot: {
        Row: {
          orden_id: string | null
          diseno_lider_id: string | null
          lider_nombre: string | null
          plano_id: string | null
          numero_plano: string | null
          plano_nombre: string | null
          responsable_diseno_id: string | null
          responsable_nombre: string | null
        }
        Relationships: []
      }
      v_existencias_materiales: {
        Row: {
          material_id: string | null
          codigo: string | null
          descripcion: string | null
          unidad: string | null
          existencia: number | null
          reservado: number | null
          disponible: number | null
        }
        Relationships: []
      }
      v_flota_avance_diario: {
        Row: {
          id: string | null
          flota_id: string | null
          fecha: string | null
          descripcion: string | null
          avance_porcentaje: number | null
          impedimento: string | null
          creado_en: string | null
          area_id: string | null
          area_codigo: string | null
          area: string | null
          placa: string | null
          unidad: string | null
          cliente: string | null
          trabajo: string | null
          estado: string | null
          registrado_por: string | null
          registrado_por_nombre: string | null
          fotos: number | null
          revision: string | null
          observacion: string | null
          revisado_en: string | null
          revisado_por_nombre: string | null
          corregido_en: string | null
        }
        Relationships: []
      }
      v_flota_unidades: {
        Row: {
          id: string | null
          placa: string | null
          placa_clave: string | null
          descripcion: string | null
          cliente: string | null
          trajo: string | null
          trabajo: string | null
          estado: string | null
          ingreso: string | null
          ingreso_fecha: string | null
          lista_en: string | null
          salio_en: string | null
          retiro: string | null
          sede_id: string | null
          registrado_por: string | null
          registrado_por_nombre: string | null
          ultimo_avance_fecha: string | null
          ultimo_avance: string | null
          area_actual_id: string | null
          area_actual: string | null
          avance_porcentaje: number | null
          dias_sin_avance: number | null
          dias_en_taller: number | null
          impedimento: string | null
          fotos: number | null
          reportes: number | null
        }
        Relationships: []
      }
      v_kardex_almacen: {
        Row: {
          id: string | null
          fecha: string | null
          material_id: string | null
          material_codigo: string | null
          material: string | null
          unidad_medida: string | null
          movimiento: string | null
          origen: string | null
          entrada: number | null
          salida: number | null
          saldo: number | null
          documento: string | null
          unidad_id: string | null
          codigo_unidad: string | null
          orden_id: string | null
          orden_numero: string | null
          recibido_por_nombre: string | null
          registrado_por: string | null
          registrado_por_nombre: string | null
          precio_unitario: number | null
          moneda: string | null
          con_foto: boolean | null
          devolucion_de: string | null
        }
        Relationships: []
      }
      v_orden_compra_material_pendiente: {
        Row: {
          id: string | null
          requerimiento_id: string | null
          requerimiento_detalle_id: string | null
          proveedor: string | null
          referencia: string | null
          fecha_estimada: string | null
          cantidad_comprada: number | null
          cantidad_recibida: number | null
          cantidad_pendiente: number | null
          orden_compra_id: string | null
        }
        Relationships: []
      }
      v_ot_actividades: {
        Row: {
          id: string | null
          orden_id: string | null
          area_id: string | null
          area_codigo: string | null
          area: string | null
          orden_secuencia: number | null
          nombre: string | null
          detalle: string | null
          referencia: string | null
          peso_pct: number | null
          avance_pct: number | null
          terminada: boolean | null
          ultimo_reporte: string | null
          reportes: number | null
          creado_por: string | null
          creado_en: string | null
          fecha_inicio_plan: string | null
          fecha_fin_plan: string | null
          orden_numero: string | null
          orden_estado: string | null
          abierta_en_taller: boolean | null
          etapa_id: string | null
        }
        Relationships: []
      }
      v_ot_avance_areas: {
        Row: {
          orden_id: string | null
          area_id: string | null
          area_codigo: string | null
          area: string | null
          actividades: number | null
          terminadas: number | null
          peso_repartido: number | null
          avance_pct: number | null
          ultimo_reporte: string | null
          orden_numero: string | null
          orden_estado: string | null
        }
        Relationships: []
      }
      v_ot_avance_diario: {
        Row: {
          id: string | null
          fecha: string | null
          avance_pct: number | null
          nota: string | null
          creado_en: string | null
          actividad_id: string | null
          actividad: string | null
          referencia: string | null
          peso_pct: number | null
          area_id: string | null
          area_codigo: string | null
          area: string | null
          orden_id: string | null
          orden_numero: string | null
          orden_estado: string | null
          orden_descripcion: string | null
          reportado_por: string | null
          reportado_por_nombre: string | null
          acumulado_pct: number | null
          revision: string | null
          observacion: string | null
          revisado_en: string | null
          revisado_por_nombre: string | null
          corregido_en: string | null
        }
        Relationships: []
      }
      v_ot_materiales: {
        Row: {
          id: string | null
          orden_id: string | null
          plano_id: string | null
          numero_plano: string | null
          plano_nombre: string | null
          etapa_id: string | null
          etapa: string | null
          area: string | null
          material_id: string | null
          material_codigo: string | null
          material: string | null
          especificacion_tecnica: string | null
          unidad: string | null
          cantidad: number | null
          observacion: string | null
          creado_por: string | null
          creado_en: string | null
          area_destino: string | null
        }
        Relationships: []
      }
      v_ot_observaciones: {
        Row: {
          id: string | null
          orden_id: string | null
          area_id: string | null
          area_codigo: string | null
          area: string | null
          descripcion: string | null
          registrado_por: string | null
          registrado_por_nombre: string | null
          creado_en: string | null
          resolucion: string | null
          resuelta_por: string | null
          resuelta_por_nombre: string | null
          resuelta_en: string | null
          abierta: boolean | null
        }
        Relationships: []
      }
      v_ot_timeline: {
        Row: {
          orden_id: string | null
          ocurrido_en: string | null
          categoria: string | null
          titulo: string | null
          detalle: string | null
          usuario_id: string | null
          referencia_tabla: string | null
          referencia_id: string | null
          referencia_clave: string | null
          datos: Json | null
        }
        Relationships: []
      }
      v_pendientes_materiales: {
        Row: {
          detalle_id: string | null
          orden_id: string | null
          numero_ot: string | null
          por_aprobar: boolean | null
          por_revisar_stock: boolean | null
          por_comprar: boolean | null
          por_recibir: boolean | null
          por_despachar: boolean | null
        }
        Relationships: []
      }
      v_plazos_por_area: {
        Row: {
          etapa_id: string | null
          orden_id: string | null
          orden_numero: string | null
          area_id: string | null
          area_codigo: string | null
          area_nombre: string | null
          area_encargado: string | null
          etapa_nombre: string | null
          orden_secuencia: number | null
          unidad: string | null
          cliente: string | null
          codigo_interno: string | null
          placa: string | null
          fecha_inicio_programada: string | null
          fecha_fin_programada: string | null
          fecha_fin_real: string | null
          estado: Database["public"]["Enums"]["estado_etapa_ot"] | null
          avance_porcentaje: number | null
          responsable_id: string | null
          dias: number | null
          plazo: Database["public"]["Enums"]["estado_plazo"] | null
          material_lineas: number | null
          material_monto: number | null
          ultimo_reporte_id: string | null
          ultimo_reporte: string | null
          ultimo_reporte_en: string | null
          ultimo_reporte_verificado_en: string | null
        }
        Relationships: []
      }
      v_plazos_resumen: {
        Row: {
          area_codigo: string | null
          area_nombre: string | null
          plazo: Database["public"]["Enums"]["estado_plazo"] | null
          cantidad: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      abrir_orden_del_taller: {
        Args: {
          p_placa: string | null
          p_tipo_vehiculo: Database["public"]["Enums"]["tipo_vehiculo"] | null
          p_marca: string | null
          p_modelo: string | null
          p_trabajo: string | null
          p_tipo_trabajo?: Database["public"]["Enums"]["tipo_trabajo_ot"] | null
          p_prioridad?: Database["public"]["Enums"]["prioridad_ot"] | null
        }
        Returns: string
      }
      activar_auditoria: {
        Args: {
          p_tabla: string | null
        }
        Returns: null
      }
      activar_registro_de_prueba: {
        Args: {
          p_tabla: string | null
        }
        Returns: null
      }
      activar_timestamps: {
        Args: {
          p_tabla: string | null
        }
        Returns: null
      }
      anular_gasto_general: {
        Args: {
          p_id: string | null
          p_motivo: string | null
        }
        Returns: string
      }
      archivo_plano_vinculado: {
        Args: {
          p_ruta: string | null
        }
        Returns: boolean
      }
      armar_ficha_ot: {
        Args: {
          p_orden: string | null
        }
        Returns: null
      }
      asignar_equipo_diseno: {
        Args: {
          p_orden: string | null
          p_lider: string | null
          p_responsables: Json | null
        }
        Returns: null
      }
      asignar_responsables_ot: {
        Args: {
          p_orden_id: string | null
        }
        Returns: number
      }
      cambiar_clave_personal: {
        Args: {
          p_usuario: string | null
          p_clave: string | null
        }
        Returns: null
      }
      cambiar_estado_personal: {
        Args: {
          p_usuario: string | null
          p_activo: boolean | null
        }
        Returns: null
      }
      cargar_cronograma: {
        Args: {
          p_orden: string | null
          p_filas: Json | null
        }
        Returns: Json
      }
      cerrar_planilla: {
        Args: {
          p_planilla: string | null
        }
        Returns: string
      }
      cifrar_clave: {
        Args: {
          p_clave: string | null
        }
        Returns: string
      }
      completar_cuenta_acceso: {
        Args: {
          p_cuenta: string | null
        }
        Returns: null
      }
      confirmar_salida_porteria: {
        Args: {
          p_entrega: string | null
        }
        Returns: null
      }
      crear_compra_agrupada: {
        Args: {
          p_id: string | null
          p_proveedor: string | null
          p_referencia: string | null
          p_detalles: Json | null
          p_fecha: string | null
          p_condicion: string | null
          p_dias: number | null
          p_moneda: string | null
        }
        Returns: string
      }
      crear_etapas_ot: {
        Args: {
          p_orden_id: string | null
        }
        Returns: number
      }
      crear_orden_compra_material: {
        Args: {
          p_id: string | null
          p_requerimiento_id: string | null
          p_proveedor: string | null
          p_referencia: string | null
          p_detalles: Json | null
          p_fecha_estimada?: string | null
        }
        Returns: string
      }
      crear_orden_compra_material_con_pago: {
        Args: {
          p_id: string | null
          p_requerimiento_id: string | null
          p_proveedor: string | null
          p_referencia: string | null
          p_detalles: Json | null
          p_fecha_estimada: string | null
          p_condicion: string | null
          p_dias: number | null
          p_moneda: string | null
        }
        Returns: string
      }
      crear_personal: {
        Args: {
          p_nombres: string | null
          p_apellidos: string | null
          p_correo: string | null
          p_clave: string | null
          p_rol_id: string | null
          p_sede_id: string | null
          p_area_id?: string | null
          p_cargo?: string | null
          p_documento?: string | null
          p_telefono?: string | null
          p_es_operario?: boolean | null
          p_costo_hora?: number | null
        }
        Returns: string
      }
      crear_requerimiento_material: {
        Args: {
          p_orden_id: string | null
          p_area_destino: string | null
          p_materiales: string[] | null
        }
        Returns: string
      }
      datos_de_empresa: {
        Args: Record<PropertyKey, never>
        Returns: {
          razon_social: string | null
          nombre_comercial: string | null
          ruc: string | null
          direccion: string | null
          distrito: string | null
          provincia: string | null
          departamento: string | null
          telefono: string | null
          correo: string | null
          web: string | null
          gerente_general: string | null
          gerente_general_cargo: string | null
        }[]
      }
      definir_etapas_diseno: {
        Args: {
          p_orden_id: string | null
          p_etapas: string[] | null
        }
        Returns: number
      }
      definir_etapas_ponderadas: {
        Args: {
          p_orden_id: string | null
          p_config: Json | null
        }
        Returns: number
      }
      despachar_material: {
        Args: {
          p_id: string | null
          p_requerimiento_detalle_id: string | null
          p_cantidad: number | null
          p_responsable_id: string | null
        }
        Returns: string
      }
      despachar_material_con_foto: {
        Args: {
          p_id: string | null
          p_detalle: string | null
          p_cantidad: number | null
          p_responsable: string | null
          p_recibe: string | null
          p_foto: string | null
        }
        Returns: string
      }
      detalle_costeo_ot: {
        Args: {
          p_orden: string | null
        }
        Returns: {
          fuente: string | null
          fecha: string | null
          concepto: string | null
          detalle: string | null
          cantidad: number | null
          unidad: string | null
          precio_unitario: number | null
          moneda: string | null
          monto: number | null
          referencia: string | null
        }[]
      }
      dias_de_taller: {
        Args: {
          p_desde: string | null
          p_hasta: string | null
        }
        Returns: number
      }
      dias_habiles_entre: {
        Args: {
          p_desde: string | null
          p_hasta: string | null
        }
        Returns: number
      }
      editar_carroceria_ventas: {
        Args: {
          p_id: string | null
          p_nombre: string | null
          p_descripcion: string | null
          p_activo: boolean | null
        }
        Returns: string
      }
      editar_ot_con_historial: {
        Args: {
          p_orden: string | null
          p_version: string | null
          p_datos: Json | null
          p_motivo: string | null
        }
        Returns: string
      }
      editar_ot_con_historial_base: {
        Args: {
          p_orden: string | null
          p_version: string | null
          p_datos: Json | null
          p_motivo: string | null
        }
        Returns: string
      }
      editar_resumen_ot_administracion: {
        Args: {
          p_orden: string | null
          p_version: string | null
          p_version_unidad: string | null
          p_marca: string | null
          p_modelo: string | null
          p_anio: number | null
          p_responsable: string | null
          p_motivo: string | null
        }
        Returns: string
      }
      emitir_orden_de_cotizacion: {
        Args: {
          p_cotizacion: string | null
          p_orden: string | null
          p_numero: string | null
          p_numero_fmi: string | null
          p_tipo_unidad: Database["public"]["Enums"]["tipo_unidad_carroceria"] | null
          p_marca: string | null
          p_modelo: string | null
          p_fecha_entrega: string | null
          p_ruta_pdf: string | null
          p_nombre_pdf: string | null
          p_tamano_pdf?: number | null
        }
        Returns: string
      }
      es_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      es_laborable: {
        Args: {
          p_fecha: string | null
        }
        Returns: boolean
      }
      es_usuario_activo: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      estado_del_plazo: {
        Args: {
          p_fin_programada: string | null
          p_fin_real?: string | null
        }
        Returns: Database["public"]["Enums"]["estado_plazo"]
      }
      exigir_permiso: {
        Args: {
          p_permiso: string | null
        }
        Returns: null
      }
      fijar_condicion_pago_compra: {
        Args: {
          p_compra: string | null
          p_condicion: string | null
          p_dias: number | null
          p_moneda: string | null
        }
        Returns: string
      }
      fijar_merma_ot: {
        Args: {
          p_orden: string | null
          p_porcentaje: number | null
          p_motivo: string | null
        }
        Returns: string
      }
      fijar_precio_compra_material: {
        Args: {
          p_detalle: string | null
          p_precio: number | null
        }
        Returns: string
      }
      flota_sigue_en_taller: {
        Args: {
          p_flota: string | null
        }
        Returns: boolean
      }
      guardar_etapas_libres: {
        Args: {
          p_orden_id: string | null
          p_config: Json | null
          p_etapa_actividad?: string | null
        }
        Returns: number
      }
      guardar_ficha_diseno: {
        Args: {
          p_orden: string | null
          p_datos: Json | null
        }
        Returns: string
      }
      guardar_lider_entrega_planos: {
        Args: {
          p_orden: string | null
          p_nombre: string | null
        }
        Returns: string
      }
      importar_detalle_planilla: {
        Args: {
          p_id: string | null
          p_planilla: string | null
          p_hoja: string | null
          p_lineas: Json | null
        }
        Returns: string
      }
      indicadores_tablero: {
        Args: {
          p_sede_id?: string | null
        }
        Returns: {
          abiertas: number | null
          en_proceso: number | null
          pausadas: number | null
          atrasadas: number | null
          urgentes: number | null
          total: number | null
          por_estado: Json | null
        }[]
      }
      levantar_observacion_ot: {
        Args: {
          p_orden: string | null
          p_area: string | null
          p_descripcion: string | null
        }
        Returns: string
      }
      liberar_cotizacion_a_tesoreria: {
        Args: {
          p_cotizacion: string | null
        }
        Returns: string
      }
      lote_de_prueba: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      marcar_compra_entregada_almacen: {
        Args: {
          p_compra: string | null
        }
        Returns: string
      }
      materiales_para_valorizar: {
        Args: Record<PropertyKey, never>
        Returns: {
          material_id: string | null
          codigo: string | null
          descripcion: string | null
          unidad: string | null
          existencia: number | null
          ultima_compra: number | null
          moneda_compra: string | null
          precio: number | null
          moneda: string | null
          valorizado_en: string | null
        }[]
      }
      mi_rol: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      mi_sede: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      mi_usuario: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      nombre_unidad_almacen: {
        Args: {
          p_u: string | null
        }
        Returns: string
      }
      notificar_a_permiso: {
        Args: {
          p_permiso: string | null
          p_titulo: string | null
          p_cuerpo: string | null
          p_ruta: string | null
          p_tabla: string | null
          p_id: string | null
          p_excepto?: string | null
        }
        Returns: number
      }
      notificar_a_usuario: {
        Args: {
          p_usuario: string | null
          p_titulo: string | null
          p_cuerpo: string | null
          p_ruta: string | null
          p_tabla: string | null
          p_id: string | null
          p_excepto?: string | null
        }
        Returns: number
      }
      orden_compra_de_ruta: {
        Args: {
          p_ruta: string | null
        }
        Returns: string
      }
      orden_de_ruta: {
        Args: {
          p_ruta: string | null
        }
        Returns: string
      }
      ot_recalcular_avance: {
        Args: {
          p_orden_id: string | null
        }
        Returns: null
      }
      ot_registrar_evento: {
        Args: {
          p_orden_id: string | null
          p_tipo: Database["public"]["Enums"]["tipo_evento_ot"] | null
          p_descripcion?: string | null
          p_datos?: Json | null
          p_etapa_id?: string | null
          p_usuario_id?: string | null
        }
        Returns: string
      }
      ot_registrar_evento_interna: {
        Args: {
          p_orden_id: string | null
          p_tipo: Database["public"]["Enums"]["tipo_evento_ot"] | null
          p_descripcion: string | null
          p_datos?: Json | null
          p_etapa_id?: string | null
          p_usuario_id?: string | null
        }
        Returns: string
      }
      ot_transicion_valida: {
        Args: {
          p_origen: Database["public"]["Enums"]["estado_ot"] | null
          p_destino: Database["public"]["Enums"]["estado_ot"] | null
        }
        Returns: boolean
      }
      pascua: {
        Args: {
          p_anio: number | null
        }
        Returns: string
      }
      plantilla_de_la_carroceria: {
        Args: {
          p_tipo: string | null
        }
        Returns: string
      }
      poner_cliente_a_orden: {
        Args: {
          p_orden: string | null
          p_cliente: string | null
        }
        Returns: null
      }
      produccion_siguiente_numero: {
        Args: {
          p_tipo: Database["public"]["Enums"]["tipo_correlativo"] | null
          p_sede: string | null
        }
        Returns: string
      }
      programar_etapa_administracion: {
        Args: {
          p_etapa_id: string | null
          p_inicio: string | null
          p_fin: string | null
        }
        Returns: string
      }
      programar_etapas_ot: {
        Args: {
          p_orden_id: string | null
        }
        Returns: number
      }
      proponer_material_de_area: {
        Args: {
          p_orden: string | null
          p_plano: string | null
          p_material: string | null
          p_cantidad: number | null
          p_observacion?: string | null
        }
        Returns: string
      }
      proponer_material_nuevo_de_area: {
        Args: {
          p_id: string | null
          p_orden: string | null
          p_plano: string | null
          p_descripcion: string | null
          p_categoria: string | null
          p_unidad: string | null
          p_cantidad: number | null
          p_especificacion?: string | null
        }
        Returns: string
      }
      pruebas_abrir: {
        Args: {
          p_motivo: string | null
          p_cuentas?: string[] | null
        }
        Returns: string
      }
      pruebas_limpiar: {
        Args: {
          p_lote: string | null
        }
        Returns: Json
      }
      puede_armar_hoja_de_area: {
        Args: {
          p_area_id: string | null
        }
        Returns: boolean
      }
      puede_editar_tarea_ot: {
        Args: {
          p_orden_id: string | null
          p_area_id: string | null
        }
        Returns: boolean
      }
      puede_hoja_de_actividad: {
        Args: {
          p_actividad_id: string | null
        }
        Returns: boolean
      }
      puede_hoja_de_area: {
        Args: {
          p_area_id: string | null
        }
        Returns: boolean
      }
      puede_ver_area_material: {
        Args: {
          p_area: string | null
        }
        Returns: boolean
      }
      puede_ver_hoja_de_area: {
        Args: {
          p_area: string | null
        }
        Returns: boolean
      }
      puede_ver_orden: {
        Args: {
          p_orden_id: string | null
        }
        Returns: boolean
      }
      puede_ver_pdf_ot: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      puede_ver_plano_tecnico: {
        Args: {
          p_id: string | null
        }
        Returns: boolean
      }
      puede_ver_version_plano: {
        Args: {
          p_id: string | null
        }
        Returns: boolean
      }
      puesto: {
        Args: {
          u: string | null
        }
        Returns: string
      }
      puesto_de: {
        Args: {
          p_usuario: string | null
        }
        Returns: string
      }
      recalcular_etapa_desde_actividades: {
        Args: {
          p_etapa_id: string | null
        }
        Returns: null
      }
      recibir_version_plano: {
        Args: {
          p_id: string | null
        }
        Returns: string
      }
      reemplazar_etapas_historicas: {
        Args: {
          p_orden_id: string | null
          p_config: Json | null
          p_etapa_actividad: string | null
        }
        Returns: number
      }
      registrar_conteo_almacen: {
        Args: {
          p_id: string | null
          p_material: string | null
          p_cantidad_fisica: number | null
          p_motivo: string | null
        }
        Returns: string
      }
      registrar_evento_ot: {
        Args: {
          p_orden_id: string | null
          p_tipo_evento: Database["public"]["Enums"]["tipo_evento_ot"] | null
          p_descripcion: string | null
          p_datos?: Json | null
        }
        Returns: string
      }
      registrar_gasto_general: {
        Args: {
          p_id: string | null
          p_periodo: string | null
          p_concepto: string | null
          p_descripcion: string | null
          p_monto: number | null
          p_moneda: string | null
          p_reparto: string | null
          p_tasa: number | null
        }
        Returns: string
      }
      registrar_ingreso_almacen: {
        Args: {
          p_id: string | null
          p_material: string | null
          p_cantidad: number | null
          p_origen: string | null
          p_documento: string | null
          p_precio: number | null
          p_moneda: string | null
          p_devolucion?: string | null
        }
        Returns: string
      }
      registrar_recepcion_material: {
        Args: {
          p_id: string | null
          p_orden_compra_detalle_id: string | null
          p_cantidad: number | null
          p_documento_referencia: string | null
        }
        Returns: string
      }
      registrar_salida_almacen: {
        Args: {
          p_id: string | null
          p_material: string | null
          p_cantidad: number | null
          p_unidad: string | null
          p_codigo: string | null
          p_motivo: string | null
          p_recibe: string | null
          p_foto: string | null
        }
        Returns: string
      }
      registrar_salida_fisica: {
        Args: {
          p_entrega: string | null
          p_constancia: string | null
        }
        Returns: string
      }
      registrar_version_plano: {
        Args: {
          p_id: string | null
          p_plano: string | null
          p_area: string | null
          p_nombre: string | null
        }
        Returns: string
      }
      registrar_version_plano_con_nota: {
        Args: {
          p_id: string | null
          p_plano: string | null
          p_area: string | null
          p_nombre: string | null
          p_nota: string | null
        }
        Returns: string
      }
      resolver_observacion_ot: {
        Args: {
          p_id: string | null
          p_resolucion: string | null
        }
        Returns: string
      }
      resolver_propuesta_material: {
        Args: {
          p_detalle: string | null
          p_aprobar: boolean | null
        }
        Returns: string
      }
      resolver_revision_diseno: {
        Args: {
          p_version: string | null
          p_aprobar: boolean | null
          p_observacion?: string | null
        }
        Returns: string
      }
      restar_dias_habiles: {
        Args: {
          p_desde: string | null
          p_dias: number | null
        }
        Returns: string
      }
      resumen_costeo_ot: {
        Args: {
          p_orden: string | null
        }
        Returns: {
          fuente: string | null
          moneda: string | null
          monto: number | null
          pendientes: number | null
        }[]
      }
      resumen_planilla_por_ot: {
        Args: Record<PropertyKey, never>
        Returns: {
          orden_id: string | null
          numero_ot: string | null
          tipo: string | null
          periodo: string | null
          moneda: string | null
          monto: number | null
        }[]
      }
      revisar_stock_requerimiento: {
        Args: {
          p_detalle: string | null
          p_decision: string | null
        }
        Returns: string
      }
      revisar_version_plano: {
        Args: {
          p_id: string | null
          p_aprobar: boolean | null
          p_observacion?: string | null
        }
        Returns: string
      }
      saldo_registrado_material: {
        Args: {
          p_material: string | null
        }
        Returns: number
      }
      sembrar_feriados: {
        Args: {
          p_anio: number | null
        }
        Returns: number
      }
      sembrar_plantilla_ficha: {
        Args: {
          p_tipo_codigo: string | null
          p_nombre: string | null
          p_descripcion: string | null
          p_lineas: Json | null
          p_accesorios: Json | null
          p_tipo_unidad?: string | null
          p_capacidad?: string | null
          p_fuentes?: string[] | null
          p_predeterminada?: boolean | null
        }
        Returns: string
      }
      sembrar_verificacion: {
        Args: {
          p_codigo: string | null
          p_pasos: string[] | null
        }
        Returns: number
      }
      siguiente_correlativo: {
        Args: {
          p_tipo: Database["public"]["Enums"]["tipo_correlativo"] | null
          p_serie?: string | null
          p_sede?: string | null
        }
        Returns: string
      }
      sumar_dias_habiles: {
        Args: {
          p_desde: string | null
          p_dias: number | null
        }
        Returns: string
      }
      tiene_permiso: {
        Args: {
          p_codigo: string | null
        }
        Returns: boolean
      }
      transitar_informe_diseno: {
        Args: {
          p_informe: string | null
          p_estado: string | null
          p_observacion?: string | null
        }
        Returns: string
      }
      unidades_para_salida_almacen: {
        Args: Record<PropertyKey, never>
        Returns: {
          id: string | null
          nombre: string | null
          codigo_interno: string | null
          placa: string | null
          vehiculo: string | null
          ordenes: string | null
        }[]
      }
      usuario_actual: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      usuarios_diseno_asignables: {
        Args: Record<PropertyKey, never>
        Returns: {
          id: string | null
          nombre: string | null
          rol: string | null
        }[]
      }
      valorizar_material: {
        Args: {
          p_id: string | null
          p_material: string | null
          p_precio: number | null
          p_moneda: string | null
          p_observacion?: string | null
        }
        Returns: string
      }
    }
    Enums: {
      accion_auditoria: "INSERT" | "UPDATE" | "DELETE"
      categoria_vehicular: "O3" | "O4" | "N1" | "N2" | "N3"
      estado_cotizacion_pdf: "POR_REVISAR" | "APROBADA" | "RECHAZADA" | "ANULADA"
      estado_etapa_ot: "PENDIENTE" | "EN_PROCESO" | "PAUSADA" | "TERMINADA" | "OMITIDA" | "REQUIERE_REVISION"
      estado_flota: "EN_TALLER" | "LISTA" | "SALIO"
      estado_ot: "BORRADOR" | "APROBADA" | "PROGRAMADA" | "EN_PROCESO" | "PAUSADA" | "CONTROL_CALIDAD" | "TERMINADA" | "ENTREGADA" | "FACTURADA" | "ANULADA"
      estado_plazo: "VIGENTE" | "POR_VENCER" | "VENCIDO" | "CUMPLIDO" | "CUMPLIDO_TARDE"
      estado_revision: "PENDIENTE" | "APROBADO" | "OBSERVADO"
      magnitud_medida: "UNIDAD" | "MASA" | "LONGITUD" | "AREA" | "VOLUMEN"
      moneda: "PEN" | "USD"
      prioridad_ot: "BAJA" | "NORMAL" | "ALTA" | "URGENTE"
      tipo_correlativo: "ORDEN_TRABAJO" | "REQUERIMIENTO" | "ORDEN_COMPRA" | "INGRESO_ALMACEN" | "SALIDA_ALMACEN" | "DEVOLUCION_ALMACEN" | "AJUSTE_INVENTARIO" | "PARTE_DIARIO" | "ACTA_CONFORMIDAD" | "INSPECCION_CALIDAD" | "TRANSFERENCIA_ALMACEN" | "RECEPCION_COMPRA" | "ORDEN_SERVICIO"
      tipo_documento_cliente: "RUC" | "DNI" | "CE" | "PASAPORTE"
      tipo_evento_ot: "CREACION" | "CAMBIO_ESTADO" | "AVANCE" | "MATERIAL" | "DOCUMENTO" | "INSPECCION" | "PAUSA" | "REANUDACION" | "COMENTARIO" | "ENTREGA"
      tipo_trabajo_ot: "FABRICACION" | "REPARACION" | "REPOTENCIACION" | "MANTENIMIENTO" | "GARANTIA"
      tipo_unidad_carroceria: "SEMIRREMOLQUE" | "CARROCERIA_MONTADA"
      tipo_vehiculo: "VOLQUETE" | "TRACTO" | "SEMIRREMOLQUE" | "CAMION" | "REMOLQUE" | "FURGON" | "OTRO"
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
