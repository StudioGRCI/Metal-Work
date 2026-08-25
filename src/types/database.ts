// Archivo generado automáticamente. No editar a mano.
// Regenerar con: ./scripts/generar-tipos.sh
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
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
      cotizacion_partidas: {
        Row: {
          id: string
          cotizacion_id: string
          orden_secuencia: number
          descripcion: string
          detalle: string | null
          unidad_medida: string
          cantidad: number
          precio_unitario: number
          descuento_porcentaje: number
          subtotal: number
          tipo_costo: Database["public"]["Enums"]["tipo_costo_partida"]
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          cotizacion_id: string
          orden_secuencia: number
          descripcion: string
          detalle?: string | null
          unidad_medida?: string
          cantidad: number
          precio_unitario: number
          descuento_porcentaje?: number
          subtotal?: number
          tipo_costo?: Database["public"]["Enums"]["tipo_costo_partida"]
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          cotizacion_id?: string
          orden_secuencia?: number
          descripcion?: string
          detalle?: string | null
          unidad_medida?: string
          cantidad?: number
          precio_unitario?: number
          descuento_porcentaje?: number
          subtotal?: number
          tipo_costo?: Database["public"]["Enums"]["tipo_costo_partida"]
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "cotizacion_partidas_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          }
        ]
      }
      cotizaciones: {
        Row: {
          id: string
          numero: string
          cliente_id: string
          unidad_id: string | null
          tipo_carroceria_id: string | null
          contacto_id: string | null
          sede_id: string | null
          fecha_emision: string
          validez_dias: number
          fecha_vencimiento: string | null
          moneda: Database["public"]["Enums"]["moneda"]
          tipo_cambio: number
          estado: Database["public"]["Enums"]["estado_cotizacion"]
          subtotal: number
          descuento: number
          igv_porcentaje: number
          igv: number
          total: number
          plazo_entrega_dias: number | null
          forma_pago: string | null
          condiciones: string | null
          observaciones: string | null
          motivo_rechazo: string | null
          fecha_aprobacion: string | null
          aprobada_por: string | null
          vendedor_id: string | null
          creado_en: string
          actualizado_en: string
          creado_por: string | null
        }
        Insert: {
          id?: string
          numero: string
          cliente_id: string
          unidad_id?: string | null
          tipo_carroceria_id?: string | null
          contacto_id?: string | null
          sede_id?: string | null
          fecha_emision?: string
          validez_dias?: number
          moneda?: Database["public"]["Enums"]["moneda"]
          tipo_cambio: number
          estado?: Database["public"]["Enums"]["estado_cotizacion"]
          subtotal?: number
          descuento?: number
          igv_porcentaje: number
          igv?: number
          total?: number
          plazo_entrega_dias?: number | null
          forma_pago?: string | null
          condiciones?: string | null
          observaciones?: string | null
          motivo_rechazo?: string | null
          fecha_aprobacion?: string | null
          aprobada_por?: string | null
          vendedor_id?: string | null
          creado_en?: string
          actualizado_en?: string
          creado_por?: string | null
        }
        Update: {
          id?: string
          numero?: string
          cliente_id?: string
          unidad_id?: string | null
          tipo_carroceria_id?: string | null
          contacto_id?: string | null
          sede_id?: string | null
          fecha_emision?: string
          validez_dias?: number
          moneda?: Database["public"]["Enums"]["moneda"]
          tipo_cambio?: number
          estado?: Database["public"]["Enums"]["estado_cotizacion"]
          subtotal?: number
          descuento?: number
          igv_porcentaje?: number
          igv?: number
          total?: number
          plazo_entrega_dias?: number | null
          forma_pago?: string | null
          condiciones?: string | null
          observaciones?: string | null
          motivo_rechazo?: string | null
          fecha_aprobacion?: string | null
          aprobada_por?: string | null
          vendedor_id?: string | null
          creado_en?: string
          actualizado_en?: string
          creado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cotizaciones_aprobada_por_fkey"
            columns: ["aprobada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "contactos_cliente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_sede_id_fkey"
            columns: ["sede_id"]
            isOneToOne: false
            referencedRelation: "sedes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_tipo_carroceria_id_fkey"
            columns: ["tipo_carroceria_id"]
            isOneToOne: false
            referencedRelation: "tipos_carroceria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cotizaciones_unidad_del_cliente"
            columns: ["unidad_id", "cliente_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id", "cliente_id"]
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
          moneda_base: Database["public"]["Enums"]["moneda"]
          igv_porcentaje: number
          costo_indirecto_hora: number
          creado_en: string
          actualizado_en: string
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
          moneda_base?: Database["public"]["Enums"]["moneda"]
          igv_porcentaje?: number
          costo_indirecto_hora?: number
          creado_en?: string
          actualizado_en?: string
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
          moneda_base?: Database["public"]["Enums"]["moneda"]
          igv_porcentaje?: number
          costo_indirecto_hora?: number
          creado_en?: string
          actualizado_en?: string
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
        }
        Relationships: []
      }
      ordenes_trabajo: {
        Row: {
          id: string
          numero: string
          cliente_id: string
          unidad_id: string | null
          cotizacion_id: string | null
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
          moneda: Database["public"]["Enums"]["moneda"]
          monto_presupuestado: number
          avance_porcentaje: number
          horas_estimadas: number
          horas_reales: number
          motivo_pausa: string | null
          motivo_anulacion: string | null
          observaciones: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          numero: string
          cliente_id: string
          unidad_id?: string | null
          cotizacion_id?: string | null
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
          moneda?: Database["public"]["Enums"]["moneda"]
          monto_presupuestado?: number
          avance_porcentaje?: number
          horas_estimadas?: number
          horas_reales?: number
          motivo_pausa?: string | null
          motivo_anulacion?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          numero?: string
          cliente_id?: string
          unidad_id?: string | null
          cotizacion_id?: string | null
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
          moneda?: Database["public"]["Enums"]["moneda"]
          monto_presupuestado?: number
          avance_porcentaje?: number
          horas_estimadas?: number
          horas_reales?: number
          motivo_pausa?: string | null
          motivo_anulacion?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
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
            foreignKeyName: "ordenes_trabajo_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
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
        }
        Insert: {
          id?: string
          numero: string
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
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_etapas: {
        Row: {
          id: string
          orden_id: string
          etapa_catalogo_id: string
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
        }
        Insert: {
          id?: string
          orden_id: string
          etapa_catalogo_id: string
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
        }
        Update: {
          id?: string
          orden_id?: string
          etapa_catalogo_id?: string
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
        }
        Relationships: [
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
      ot_inspeccion_items: {
        Row: {
          id: string
          inspeccion_id: string
          orden_secuencia: number
          item: string
          cumple: boolean | null
          observacion: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          inspeccion_id: string
          orden_secuencia?: number
          item: string
          cumple?: boolean | null
          observacion?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          inspeccion_id?: string
          orden_secuencia?: number
          item?: string
          cumple?: boolean | null
          observacion?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_inspeccion_items_inspeccion_id_fkey"
            columns: ["inspeccion_id"]
            isOneToOne: false
            referencedRelation: "ot_inspecciones"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_inspecciones: {
        Row: {
          id: string
          numero: string
          orden_id: string
          etapa_id: string | null
          fecha: string
          inspector_id: string | null
          resultado: Database["public"]["Enums"]["resultado_inspeccion"]
          observaciones: string | null
          acciones_correctivas: string | null
          fecha_levantamiento: string | null
          levantado_por: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          numero: string
          orden_id: string
          etapa_id?: string | null
          fecha?: string
          inspector_id?: string | null
          resultado: Database["public"]["Enums"]["resultado_inspeccion"]
          observaciones?: string | null
          acciones_correctivas?: string | null
          fecha_levantamiento?: string | null
          levantado_por?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          numero?: string
          orden_id?: string
          etapa_id?: string | null
          fecha?: string
          inspector_id?: string | null
          resultado?: Database["public"]["Enums"]["resultado_inspeccion"]
          observaciones?: string | null
          acciones_correctivas?: string | null
          fecha_levantamiento?: string | null
          levantado_por?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_ot_inspecciones_etapa"
            columns: ["etapa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id", "orden_id"]
          },
          {
            foreignKeyName: "ot_inspecciones_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_inspecciones_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_inspecciones_levantado_por_fkey"
            columns: ["levantado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_inspecciones_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_personal: {
        Row: {
          id: string
          orden_id: string
          etapa_id: string | null
          usuario_id: string
          rol: Database["public"]["Enums"]["rol_operario"]
          fecha_asignacion: string
          fecha_desasignacion: string | null
          observaciones: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          etapa_id?: string | null
          usuario_id: string
          rol: Database["public"]["Enums"]["rol_operario"]
          fecha_asignacion?: string
          fecha_desasignacion?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          etapa_id?: string | null
          usuario_id?: string
          rol?: Database["public"]["Enums"]["rol_operario"]
          fecha_asignacion?: string
          fecha_desasignacion?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_ot_personal_etapa"
            columns: ["etapa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id", "orden_id"]
          },
          {
            foreignKeyName: "ot_personal_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_personal_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_personal_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      ot_tareas: {
        Row: {
          id: string
          etapa_id: string
          descripcion: string
          detalle: string | null
          estado: Database["public"]["Enums"]["estado_tarea_ot"]
          responsable_id: string | null
          orden_secuencia: number
          horas_estimadas: number
          fecha_programada: string | null
          fecha_inicio_real: string | null
          fecha_fin_real: string | null
          observaciones: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          etapa_id: string
          descripcion: string
          detalle?: string | null
          estado?: Database["public"]["Enums"]["estado_tarea_ot"]
          responsable_id?: string | null
          orden_secuencia?: number
          horas_estimadas?: number
          fecha_programada?: string | null
          fecha_inicio_real?: string | null
          fecha_fin_real?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          etapa_id?: string
          descripcion?: string
          detalle?: string | null
          estado?: Database["public"]["Enums"]["estado_tarea_ot"]
          responsable_id?: string | null
          orden_secuencia?: number
          horas_estimadas?: number
          fecha_programada?: string | null
          fecha_inicio_real?: string | null
          fecha_fin_real?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_tareas_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_tareas_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_tareas_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      parte_detalle: {
        Row: {
          id: string
          parte_id: string
          orden_id: string
          etapa_id: string
          usuario_id: string
          horas: number
          horas_extra: number
          horas_totales: number | null
          descripcion: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          parte_id: string
          orden_id: string
          etapa_id: string
          usuario_id: string
          horas: number
          horas_extra?: number
          descripcion?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          parte_id?: string
          orden_id?: string
          etapa_id?: string
          usuario_id?: string
          horas?: number
          horas_extra?: number
          descripcion?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_parte_detalle_etapa"
            columns: ["etapa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id", "orden_id"]
          },
          {
            foreignKeyName: "parte_detalle_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parte_detalle_parte_id_fkey"
            columns: ["parte_id"]
            isOneToOne: false
            referencedRelation: "partes_diarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parte_detalle_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      partes_diarios: {
        Row: {
          id: string
          numero: string
          fecha: string
          sede_id: string
          estado: Database["public"]["Enums"]["estado_parte_diario"]
          responsable_id: string | null
          total_horas: number
          total_horas_extra: number
          observaciones: string | null
          fecha_cierre: string | null
          aprobado_por: string | null
          fecha_aprobacion: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          numero: string
          fecha?: string
          sede_id: string
          estado?: Database["public"]["Enums"]["estado_parte_diario"]
          responsable_id?: string | null
          total_horas?: number
          total_horas_extra?: number
          observaciones?: string | null
          fecha_cierre?: string | null
          aprobado_por?: string | null
          fecha_aprobacion?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          numero?: string
          fecha?: string
          sede_id?: string
          estado?: Database["public"]["Enums"]["estado_parte_diario"]
          responsable_id?: string | null
          total_horas?: number
          total_horas_extra?: number
          observaciones?: string | null
          fecha_cierre?: string | null
          aprobado_por?: string | null
          fecha_aprobacion?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "partes_diarios_aprobado_por_fkey"
            columns: ["aprobado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partes_diarios_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partes_diarios_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partes_diarios_sede_id_fkey"
            columns: ["sede_id"]
            isOneToOne: false
            referencedRelation: "sedes"
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
      tipos_cambio: {
        Row: {
          fecha: string
          compra: number
          venta: number
          creado_en: string
        }
        Insert: {
          fecha: string
          compra: number
          venta: number
          creado_en?: string
        }
        Update: {
          fecha?: string
          compra?: number
          venta?: number
          creado_en?: string
        }
        Relationships: []
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
        }
        Relationships: []
      }
      unidades: {
        Row: {
          id: string
          cliente_id: string
          placa: string
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
        }
        Insert: {
          id?: string
          cliente_id: string
          placa: string
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
        }
        Update: {
          id?: string
          cliente_id?: string
          placa?: string
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
        }
        Relationships: [
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
    }
    Views: {
      cotizaciones_detalle: {
        Row: {
          id: string | null
          numero: string | null
          estado: Database["public"]["Enums"]["estado_cotizacion"] | null
          fecha_emision: string | null
          fecha_vencimiento: string | null
          dias_para_vencer: number | null
          moneda: Database["public"]["Enums"]["moneda"] | null
          subtotal: number | null
          descuento: number | null
          igv: number | null
          total: number | null
          total_pen: number | null
          cliente_id: string | null
          razon_social: string | null
          numero_documento: string | null
          unidad_id: string | null
          placa: string | null
          tipo_vehiculo: Database["public"]["Enums"]["tipo_vehiculo"] | null
          tipo_carroceria_id: string | null
          tipo_carroceria_codigo: string | null
          tipo_carroceria_nombre: string | null
          vendedor_id: string | null
          sede_id: string | null
          partidas: number | null
        }
        Relationships: []
      }
      ot_horas_aprobadas: {
        Row: {
          detalle_id: string | null
          orden_id: string | null
          etapa_id: string | null
          usuario_id: string | null
          parte_id: string | null
          parte_numero: string | null
          fecha: string | null
          sede_id: string | null
          horas: number | null
          horas_extra: number | null
          horas_totales: number | null
          costo_hora: number | null
          descripcion: string | null
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
          moneda: Database["public"]["Enums"]["moneda"] | null
          monto_presupuestado: number | null
          responsable_id: string | null
          responsable: string | null
          etapas_total: number | null
          etapas_terminadas: number | null
          etapas_en_proceso: number | null
          dias_atraso: number | null
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
          horas_reales: number | null
          desviacion_horas: number | null
          fecha_inicio_programada: string | null
          fecha_fin_programada: string | null
          fecha_inicio_real: string | null
          fecha_fin_real: string | null
          responsable_id: string | null
          requiere_inspeccion: boolean | null
          inspeccion_conforme: boolean | null
          operarios_asignados: number | null
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
    }
    Functions: {
      activar_auditoria: {
        Args: {
          p_tabla: string
        }
        Returns: string
      }
      activar_timestamps: {
        Args: {
          p_tabla: string
        }
        Returns: string
      }
      crear_etapas_ot: {
        Args: {
          p_orden_id: string
        }
        Returns: number
      }
      es_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      es_usuario_activo: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      marcar_cotizaciones_vencidas: {
        Args: {
          p_fecha?: string
        }
        Returns: number
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
      ot_recalcular_avance: {
        Args: {
          p_orden_id: string
        }
        Returns: string
      }
      ot_registrar_evento: {
        Args: {
          p_orden_id: string
          p_tipo: Database["public"]["Enums"]["tipo_evento_ot"]
          p_descripcion: string
          p_datos?: Json
          p_etapa_id?: string
          p_usuario_id?: string
        }
        Returns: string
      }
      ot_transicion_valida: {
        Args: {
          p_origen: Database["public"]["Enums"]["estado_ot"]
          p_destino: Database["public"]["Enums"]["estado_ot"]
        }
        Returns: boolean
      }
      parte_recalcular_totales: {
        Args: {
          p_parte_id: string
        }
        Returns: string
      }
      produccion_siguiente_numero: {
        Args: {
          p_tipo: Database["public"]["Enums"]["tipo_correlativo"]
          p_sede: string
        }
        Returns: string
      }
      recalcular_totales_cotizacion: {
        Args: {
          p_cotizacion: string
        }
        Returns: string
      }
      siguiente_correlativo: {
        Args: {
          p_tipo: Database["public"]["Enums"]["tipo_correlativo"]
          p_serie?: string
          p_sede?: string
        }
        Returns: string
      }
      tiene_permiso: {
        Args: {
          p_codigo: string
        }
        Returns: boolean
      }
      tipo_cambio_vigente: {
        Args: {
          p_fecha?: string
        }
        Returns: number
      }
      usuario_actual: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
    }
    Enums: {
      accion_auditoria: "INSERT" | "UPDATE" | "DELETE"
      estado_cotizacion: "BORRADOR" | "ENVIADA" | "APROBADA" | "RECHAZADA" | "VENCIDA" | "ANULADA"
      estado_etapa_ot: "PENDIENTE" | "EN_PROCESO" | "PAUSADA" | "TERMINADA" | "OMITIDA"
      estado_ot: "BORRADOR" | "APROBADA" | "PROGRAMADA" | "EN_PROCESO" | "PAUSADA" | "CONTROL_CALIDAD" | "TERMINADA" | "ENTREGADA" | "FACTURADA" | "ANULADA"
      estado_parte_diario: "BORRADOR" | "CERRADO" | "APROBADO"
      estado_tarea_ot: "PENDIENTE" | "EN_PROCESO" | "TERMINADA" | "CANCELADA"
      moneda: "PEN" | "USD"
      prioridad_ot: "BAJA" | "NORMAL" | "ALTA" | "URGENTE"
      resultado_inspeccion: "CONFORME" | "OBSERVADO" | "RECHAZADO"
      rol_operario: "SOLDADOR" | "ARMADOR" | "PINTOR" | "ELECTRICISTA" | "AYUDANTE" | "MECANICO"
      tipo_correlativo: "COTIZACION" | "ORDEN_TRABAJO" | "REQUERIMIENTO" | "ORDEN_COMPRA" | "INGRESO_ALMACEN" | "SALIDA_ALMACEN" | "DEVOLUCION_ALMACEN" | "AJUSTE_INVENTARIO" | "PARTE_DIARIO" | "ACTA_CONFORMIDAD" | "INSPECCION_CALIDAD"
      tipo_costo_partida: "MATERIAL" | "MANO_OBRA" | "SERVICIO" | "OTRO"
      tipo_documento_cliente: "RUC" | "DNI" | "CE" | "PASAPORTE"
      tipo_evento_ot: "CREACION" | "CAMBIO_ESTADO" | "AVANCE" | "MATERIAL" | "DOCUMENTO" | "INSPECCION" | "PAUSA" | "REANUDACION" | "COMENTARIO" | "ENTREGA"
      tipo_trabajo_ot: "FABRICACION" | "REPARACION" | "REPOTENCIACION" | "MANTENIMIENTO" | "GARANTIA"
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
