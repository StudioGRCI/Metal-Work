// Archivo generado automáticamente. No editar a mano.
// Regenerar con: ./scripts/generar-tipos.sh

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      almacen_stock: {
        Row: {
          id: string
          almacen_id: string
          material_id: string
          cantidad: number
          cantidad_reservada: number
          cantidad_disponible: number | null
          costo_promedio: number
          saldo_valor: number
          ubicacion: string | null
          fecha_ultimo_movimiento: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          almacen_id: string
          material_id: string
          cantidad?: number
          cantidad_reservada?: number
          costo_promedio?: number
          saldo_valor?: number
          ubicacion?: string | null
          fecha_ultimo_movimiento?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          almacen_id?: string
          material_id?: string
          cantidad?: number
          cantidad_reservada?: number
          costo_promedio?: number
          saldo_valor?: number
          ubicacion?: string | null
          fecha_ultimo_movimiento?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "almacen_stock_almacen_id_fkey"
            columns: ["almacen_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "almacen_stock_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiales"
            referencedColumns: ["id"]
          }
        ]
      }
      almacenes: {
        Row: {
          id: string
          codigo: string
          nombre: string
          sede_id: string
          tipo: Database["public"]["Enums"]["tipo_almacen"]
          responsable_id: string | null
          direccion: string | null
          permite_movimientos: boolean
          activo: boolean
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          codigo: string
          nombre: string
          sede_id: string
          tipo?: Database["public"]["Enums"]["tipo_almacen"]
          responsable_id?: string | null
          direccion?: string | null
          permite_movimientos?: boolean
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          codigo?: string
          nombre?: string
          sede_id?: string
          tipo?: Database["public"]["Enums"]["tipo_almacen"]
          responsable_id?: string | null
          direccion?: string | null
          permite_movimientos?: boolean
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "almacenes_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "almacenes_sede_id_fkey"
            columns: ["sede_id"]
            isOneToOne: true
            referencedRelation: "sedes"
            referencedColumns: ["id"]
          }
        ]
      }
      aprobaciones: {
        Row: {
          id: string
          documento_id: string
          aprobador_id: string
          orden_firma: number
          estado: Database["public"]["Enums"]["estado_aprobacion"]
          comentario: string | null
          fecha: string | null
          version_aprobada: number | null
          solicitado_por: string | null
          solicitado_en: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          documento_id: string
          aprobador_id: string
          orden_firma?: number
          estado?: Database["public"]["Enums"]["estado_aprobacion"]
          comentario?: string | null
          fecha?: string | null
          version_aprobada?: number | null
          solicitado_por?: string | null
          solicitado_en?: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          documento_id?: string
          aprobador_id?: string
          orden_firma?: number
          estado?: Database["public"]["Enums"]["estado_aprobacion"]
          comentario?: string | null
          fecha?: string | null
          version_aprobada?: number | null
          solicitado_por?: string | null
          solicitado_en?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "aprobaciones_aprobador_id_fkey"
            columns: ["aprobador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprobaciones_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprobaciones_solicitado_por_fkey"
            columns: ["solicitado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
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
        }
        Relationships: []
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
      centros_costo: {
        Row: {
          id: string
          codigo: string
          nombre: string
          tipo: Database["public"]["Enums"]["tipo_centro_costo"]
          descripcion: string | null
          responsable_id: string | null
          sede_id: string | null
          activo: boolean
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          codigo: string
          nombre: string
          tipo?: Database["public"]["Enums"]["tipo_centro_costo"]
          descripcion?: string | null
          responsable_id?: string | null
          sede_id?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          codigo?: string
          nombre?: string
          tipo?: Database["public"]["Enums"]["tipo_centro_costo"]
          descripcion?: string | null
          responsable_id?: string | null
          sede_id?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "centros_costo_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "centros_costo_sede_id_fkey"
            columns: ["sede_id"]
            isOneToOne: false
            referencedRelation: "sedes"
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
      codificacion_familias: {
        Row: {
          codigo: string
          nombre: string
          agrupa: string | null
          orden_visual: number
          activo: boolean
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          codigo: string
          nombre: string
          agrupa?: string | null
          orden_visual?: number
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          codigo?: string
          nombre?: string
          agrupa?: string | null
          orden_visual?: number
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: []
      }
      codificacion_materiales: {
        Row: {
          codigo: string
          nombre: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          codigo: string
          nombre: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          codigo?: string
          nombre?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: []
      }
      codificacion_subfamilias: {
        Row: {
          familia_codigo: string
          codigo: string
          nombre: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          familia_codigo: string
          codigo: string
          nombre: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          familia_codigo?: string
          codigo?: string
          nombre?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "codificacion_subfamilias_familia_codigo_fkey"
            columns: ["familia_codigo"]
            isOneToOne: false
            referencedRelation: "codificacion_familias"
            referencedColumns: ["codigo"]
          }
        ]
      }
      codificacion_tipos: {
        Row: {
          subfamilia_codigo: string
          codigo: string
          nombre: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          subfamilia_codigo: string
          codigo: string
          nombre: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          subfamilia_codigo?: string
          codigo?: string
          nombre?: string
          creado_en?: string
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
      cotizacion_accesorios: {
        Row: {
          id: string
          cotizacion_id: string
          orden: number
          cantidad: number
          unidad: string
          descripcion: string
          incluye_el_accesorio: boolean
          observacion: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          cotizacion_id: string
          orden?: number
          cantidad?: number
          unidad?: string
          descripcion: string
          incluye_el_accesorio?: boolean
          observacion?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          cotizacion_id?: string
          orden?: number
          cantidad?: number
          unidad?: string
          descripcion?: string
          incluye_el_accesorio?: boolean
          observacion?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "cotizacion_accesorios_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          }
        ]
      }
      cotizacion_especificaciones: {
        Row: {
          id: string
          cotizacion_id: string
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
          cotizacion_id: string
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
          cotizacion_id?: string
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
            foreignKeyName: "cotizacion_especificaciones_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
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
          tipo_cambio: number | null
          estado: Database["public"]["Enums"]["estado_cotizacion"]
          subtotal: number
          descuento: number
          igv_porcentaje: number | null
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
          marca: string | null
          modelo: string | null
          tipo: string | null
          largo_m: number | null
          ancho_m: number | null
          alto_m: number | null
          capacidad: string | null
          peso_neto_tn: number | null
          garantia_meses: number
          incluye_igv: boolean
          plazo_en_habiles: boolean
          nota: string | null
          motivo_anulacion: string | null
          anulada_por: string | null
          anulada_en: string | null
          concepto: string | null
          concepto_cantidad: number
          concepto_unidad: string
          plazo_desde: string | null
          garantia_texto: string | null
          peso_tolerancia: string | null
          no_incluye: string | null
          precio_venta: number | null
          costo_estimado: number
          costeo_pedido_en: string | null
          costeo_pedido_por: string | null
          costeo_listo_en: string | null
          costeo_listo_por: string | null
          revisada_en: string | null
          revisada_por: string | null
          motivo_observacion: string | null
        }
        Insert: {
          id?: string
          numero?: string
          cliente_id: string
          unidad_id?: string | null
          tipo_carroceria_id?: string | null
          contacto_id?: string | null
          sede_id?: string | null
          fecha_emision?: string
          validez_dias?: number
          moneda?: Database["public"]["Enums"]["moneda"]
          tipo_cambio?: number | null
          estado?: Database["public"]["Enums"]["estado_cotizacion"]
          subtotal?: number
          descuento?: number
          igv_porcentaje?: number | null
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
          marca?: string | null
          modelo?: string | null
          tipo?: string | null
          largo_m?: number | null
          ancho_m?: number | null
          alto_m?: number | null
          capacidad?: string | null
          peso_neto_tn?: number | null
          garantia_meses?: number
          incluye_igv?: boolean
          plazo_en_habiles?: boolean
          nota?: string | null
          motivo_anulacion?: string | null
          anulada_por?: string | null
          anulada_en?: string | null
          concepto?: string | null
          concepto_cantidad?: number
          concepto_unidad?: string
          plazo_desde?: string | null
          garantia_texto?: string | null
          peso_tolerancia?: string | null
          no_incluye?: string | null
          precio_venta?: number | null
          costo_estimado?: number
          costeo_pedido_en?: string | null
          costeo_pedido_por?: string | null
          costeo_listo_en?: string | null
          costeo_listo_por?: string | null
          revisada_en?: string | null
          revisada_por?: string | null
          motivo_observacion?: string | null
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
          tipo_cambio?: number | null
          estado?: Database["public"]["Enums"]["estado_cotizacion"]
          subtotal?: number
          descuento?: number
          igv_porcentaje?: number | null
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
          marca?: string | null
          modelo?: string | null
          tipo?: string | null
          largo_m?: number | null
          ancho_m?: number | null
          alto_m?: number | null
          capacidad?: string | null
          peso_neto_tn?: number | null
          garantia_meses?: number
          incluye_igv?: boolean
          plazo_en_habiles?: boolean
          nota?: string | null
          motivo_anulacion?: string | null
          anulada_por?: string | null
          anulada_en?: string | null
          concepto?: string | null
          concepto_cantidad?: number
          concepto_unidad?: string
          plazo_desde?: string | null
          garantia_texto?: string | null
          peso_tolerancia?: string | null
          no_incluye?: string | null
          precio_venta?: number | null
          costo_estimado?: number
          costeo_pedido_en?: string | null
          costeo_pedido_por?: string | null
          costeo_listo_en?: string | null
          costeo_listo_por?: string | null
          revisada_en?: string | null
          revisada_por?: string | null
          motivo_observacion?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cotizaciones_anulada_por_fkey"
            columns: ["anulada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
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
      documento_accesos: {
        Row: {
          id: string
          documento_id: string
          version_id: string | null
          usuario_id: string | null
          tipo_acceso: Database["public"]["Enums"]["tipo_acceso_documento"]
          ip: string | null
          user_agent: string | null
          creado_en: string
        }
        Insert: {
          id?: string
          documento_id: string
          version_id?: string | null
          usuario_id?: string | null
          tipo_acceso?: Database["public"]["Enums"]["tipo_acceso_documento"]
          ip?: string | null
          user_agent?: string | null
          creado_en?: string
        }
        Update: {
          id?: string
          documento_id?: string
          version_id?: string | null
          usuario_id?: string | null
          tipo_acceso?: Database["public"]["Enums"]["tipo_acceso_documento"]
          ip?: string | null
          user_agent?: string | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "documento_accesos_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documento_accesos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documento_accesos_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "documento_versiones"
            referencedColumns: ["id"]
          }
        ]
      }
      documento_versiones: {
        Row: {
          id: string
          documento_id: string
          version: number | null
          bucket: string
          ruta_storage: string
          nombre_archivo: string
          extension: string
          tamano_bytes: number
          mime_type: string | null
          hash_sha256: string | null
          comentario: string | null
          subido_por: string | null
          subido_en: string
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          documento_id: string
          version?: number | null
          bucket?: string
          ruta_storage: string
          nombre_archivo: string
          extension: string
          tamano_bytes: number
          mime_type?: string | null
          hash_sha256?: string | null
          comentario?: string | null
          subido_por?: string | null
          subido_en?: string
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          documento_id?: string
          version?: number | null
          bucket?: string
          ruta_storage?: string
          nombre_archivo?: string
          extension?: string
          tamano_bytes?: number
          mime_type?: string | null
          hash_sha256?: string | null
          comentario?: string | null
          subido_por?: string | null
          subido_en?: string
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "documento_versiones_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documento_versiones_subido_por_fkey"
            columns: ["subido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      documentos: {
        Row: {
          id: string
          tipo_documento_id: string
          titulo: string
          descripcion: string | null
          numero_externo: string | null
          fecha_documento: string | null
          entidad_tabla: string
          entidad_id: string
          orden_id: string | null
          estado: Database["public"]["Enums"]["estado_documento"]
          es_confidencial: boolean
          etiquetas: string[]
          version_actual: number
          reemplaza_a: string | null
          estado_aprobacion: Database["public"]["Enums"]["estado_aprobacion"] | null
          aprobado_en: string | null
          vence_en: string | null
          motivo_anulacion: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          tipo_documento_id: string
          titulo: string
          descripcion?: string | null
          numero_externo?: string | null
          fecha_documento?: string | null
          entidad_tabla: string
          entidad_id: string
          orden_id?: string | null
          estado?: Database["public"]["Enums"]["estado_documento"]
          es_confidencial?: boolean
          etiquetas?: string[]
          version_actual?: number
          reemplaza_a?: string | null
          estado_aprobacion?: Database["public"]["Enums"]["estado_aprobacion"] | null
          aprobado_en?: string | null
          vence_en?: string | null
          motivo_anulacion?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          tipo_documento_id?: string
          titulo?: string
          descripcion?: string | null
          numero_externo?: string | null
          fecha_documento?: string | null
          entidad_tabla?: string
          entidad_id?: string
          orden_id?: string | null
          estado?: Database["public"]["Enums"]["estado_documento"]
          es_confidencial?: boolean
          etiquetas?: string[]
          version_actual?: number
          reemplaza_a?: string | null
          estado_aprobacion?: Database["public"]["Enums"]["estado_aprobacion"] | null
          aprobado_en?: string | null
          vence_en?: string | null
          motivo_anulacion?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "documentos_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_reemplaza_a_fkey"
            columns: ["reemplaza_a"]
            isOneToOne: false
            referencedRelation: "documentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_tipo_documento_id_fkey"
            columns: ["tipo_documento_id"]
            isOneToOne: false
            referencedRelation: "tipos_documento"
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
          moneda_base: Database["public"]["Enums"]["moneda"]
          igv_porcentaje: number
          costo_indirecto_hora: number
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
          moneda_base?: Database["public"]["Enums"]["moneda"]
          igv_porcentaje?: number
          costo_indirecto_hora?: number
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
          moneda_base?: Database["public"]["Enums"]["moneda"]
          igv_porcentaje?: number
          costo_indirecto_hora?: number
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
        }
        Relationships: []
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
      garantia_reclamos: {
        Row: {
          id: string
          entrega_id: string
          correlativo: number
          numero: string | null
          fecha_reclamo: string
          reportado_por: string | null
          contacto: string | null
          descripcion: string
          dentro_de_garantia: boolean
          estado: string
          evaluacion: string | null
          atendido_por: string | null
          atendido_en: string | null
          orden_reparacion_id: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          entrega_id: string
          correlativo?: number
          fecha_reclamo?: string
          reportado_por?: string | null
          contacto?: string | null
          descripcion: string
          dentro_de_garantia?: boolean
          estado?: string
          evaluacion?: string | null
          atendido_por?: string | null
          atendido_en?: string | null
          orden_reparacion_id?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          entrega_id?: string
          correlativo?: number
          fecha_reclamo?: string
          reportado_por?: string | null
          contacto?: string | null
          descripcion?: string
          dentro_de_garantia?: boolean
          estado?: string
          evaluacion?: string | null
          atendido_por?: string | null
          atendido_en?: string | null
          orden_reparacion_id?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "garantia_reclamos_atendido_por_fkey"
            columns: ["atendido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "garantia_reclamos_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "garantia_reclamos_entrega_id_fkey"
            columns: ["entrega_id"]
            isOneToOne: false
            referencedRelation: "ot_entregas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "garantia_reclamos_orden_reparacion_id_fkey"
            columns: ["orden_reparacion_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          }
        ]
      }
      gastos_indirectos: {
        Row: {
          id: string
          periodo: string
          categoria: Database["public"]["Enums"]["categoria_gasto_indirecto"]
          descripcion: string
          centro_costo_id: string
          sede_id: string | null
          moneda: Database["public"]["Enums"]["moneda"]
          monto: number
          tipo_cambio: number
          monto_base: number | null
          numero_documento: string | null
          fecha_documento: string | null
          prorratear: boolean
          observaciones: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          periodo: string
          categoria?: Database["public"]["Enums"]["categoria_gasto_indirecto"]
          descripcion: string
          centro_costo_id: string
          sede_id?: string | null
          moneda?: Database["public"]["Enums"]["moneda"]
          monto: number
          tipo_cambio: number
          numero_documento?: string | null
          fecha_documento?: string | null
          prorratear?: boolean
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          periodo?: string
          categoria?: Database["public"]["Enums"]["categoria_gasto_indirecto"]
          descripcion?: string
          centro_costo_id?: string
          sede_id?: string | null
          moneda?: Database["public"]["Enums"]["moneda"]
          monto?: number
          tipo_cambio?: number
          numero_documento?: string | null
          fecha_documento?: string | null
          prorratear?: boolean
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "gastos_indirectos_centro_costo_id_fkey"
            columns: ["centro_costo_id"]
            isOneToOne: false
            referencedRelation: "centros_costo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_indirectos_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_indirectos_sede_id_fkey"
            columns: ["sede_id"]
            isOneToOne: false
            referencedRelation: "sedes"
            referencedColumns: ["id"]
          }
        ]
      }
      kardex: {
        Row: {
          id: string
          secuencia: number
          material_id: string
          almacen_id: string
          lote_id: string | null
          fecha: string
          tipo_movimiento: Database["public"]["Enums"]["tipo_movimiento_kardex"]
          cantidad: number
          costo_unitario: number
          costo_total: number
          saldo_cantidad: number
          saldo_valor: number
          costo_promedio: number
          orden_id: string | null
          etapa_id: string | null
          movimiento_id: string | null
          referencia_tabla: string | null
          referencia_id: string | null
          observaciones: string | null
          usuario_id: string | null
          creado_en: string
        }
        Insert: {
          id?: string
          secuencia?: number
          material_id: string
          almacen_id: string
          lote_id?: string | null
          fecha?: string
          tipo_movimiento: Database["public"]["Enums"]["tipo_movimiento_kardex"]
          cantidad: number
          costo_unitario: number
          costo_total: number
          saldo_cantidad: number
          saldo_valor: number
          costo_promedio?: number
          orden_id?: string | null
          etapa_id?: string | null
          movimiento_id?: string | null
          referencia_tabla?: string | null
          referencia_id?: string | null
          observaciones?: string | null
          usuario_id?: string | null
          creado_en?: string
        }
        Update: {
          id?: string
          secuencia?: number
          material_id?: string
          almacen_id?: string
          lote_id?: string | null
          fecha?: string
          tipo_movimiento?: Database["public"]["Enums"]["tipo_movimiento_kardex"]
          cantidad?: number
          costo_unitario?: number
          costo_total?: number
          saldo_cantidad?: number
          saldo_valor?: number
          costo_promedio?: number
          orden_id?: string | null
          etapa_id?: string | null
          movimiento_id?: string | null
          referencia_tabla?: string | null
          referencia_id?: string | null
          observaciones?: string | null
          usuario_id?: string | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_kardex_etapa"
            columns: ["etapa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id", "orden_id"]
          },
          {
            foreignKeyName: "fk_kardex_movimiento"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "movimientos_almacen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kardex_almacen_id_fkey"
            columns: ["almacen_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kardex_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_material"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kardex_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kardex_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kardex_usuario_id_fkey"
            columns: ["usuario_id"]
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
      lotes_material: {
        Row: {
          id: string
          material_id: string
          numero_lote: string
          numero_colada: string | null
          certificado_calidad: string | null
          certificado_url: string | null
          proveedor_id: string | null
          orden_compra_id: string | null
          recepcion_id: string | null
          almacen_id: string | null
          fecha_ingreso: string
          fecha_vencimiento: string | null
          cantidad_ingresada: number
          cantidad_disponible: number
          costo_unitario: number
          observaciones: string | null
          activo: boolean
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          material_id: string
          numero_lote: string
          numero_colada?: string | null
          certificado_calidad?: string | null
          certificado_url?: string | null
          proveedor_id?: string | null
          orden_compra_id?: string | null
          recepcion_id?: string | null
          almacen_id?: string | null
          fecha_ingreso?: string
          fecha_vencimiento?: string | null
          cantidad_ingresada?: number
          cantidad_disponible?: number
          costo_unitario?: number
          observaciones?: string | null
          activo?: boolean
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          material_id?: string
          numero_lote?: string
          numero_colada?: string | null
          certificado_calidad?: string | null
          certificado_url?: string | null
          proveedor_id?: string | null
          orden_compra_id?: string | null
          recepcion_id?: string | null
          almacen_id?: string | null
          fecha_ingreso?: string
          fecha_vencimiento?: string | null
          cantidad_ingresada?: number
          cantidad_disponible?: number
          costo_unitario?: number
          observaciones?: string | null
          activo?: boolean
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_lote_orden_compra"
            columns: ["orden_compra_id"]
            isOneToOne: false
            referencedRelation: "ordenes_compra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_lote_proveedor"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_lote_recepcion"
            columns: ["recepcion_id"]
            isOneToOne: false
            referencedRelation: "recepciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lotes_material_almacen_id_fkey"
            columns: ["almacen_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lotes_material_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lotes_material_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiales"
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
          costo_promedio: number
          ultimo_costo: number
          fecha_ultimo_costo: string | null
          stock_minimo: number
          stock_maximo: number
          punto_reposicion: number
          es_critico: boolean
          controla_lote: boolean
          es_inventariable: boolean
          codigo_barras: string | null
          imagen_url: string | null
          observaciones: string | null
          activo: boolean
          creado_por: string | null
          creado_en: string
          actualizado_en: string
          cod_familia: string | null
          cod_subfamilia: string | null
          cod_material: string | null
          cod_tipo: string | null
          cod_correlativo: number | null
          criticidad: string | null
          ubicacion: string | null
          costo_reposicion: number | null
          controla_serie: boolean
          controla_caducidad: boolean
          codigo_almacen: string | null
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
          costo_promedio?: number
          ultimo_costo?: number
          fecha_ultimo_costo?: string | null
          stock_minimo?: number
          stock_maximo?: number
          punto_reposicion?: number
          es_critico?: boolean
          controla_lote?: boolean
          es_inventariable?: boolean
          codigo_barras?: string | null
          imagen_url?: string | null
          observaciones?: string | null
          activo?: boolean
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          cod_familia?: string | null
          cod_subfamilia?: string | null
          cod_material?: string | null
          cod_tipo?: string | null
          cod_correlativo?: number | null
          criticidad?: string | null
          ubicacion?: string | null
          costo_reposicion?: number | null
          controla_serie?: boolean
          controla_caducidad?: boolean
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
          costo_promedio?: number
          ultimo_costo?: number
          fecha_ultimo_costo?: string | null
          stock_minimo?: number
          stock_maximo?: number
          punto_reposicion?: number
          es_critico?: boolean
          controla_lote?: boolean
          es_inventariable?: boolean
          codigo_barras?: string | null
          imagen_url?: string | null
          observaciones?: string | null
          activo?: boolean
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          cod_familia?: string | null
          cod_subfamilia?: string | null
          cod_material?: string | null
          cod_tipo?: string | null
          cod_correlativo?: number | null
          criticidad?: string | null
          ubicacion?: string | null
          costo_reposicion?: number | null
          controla_serie?: boolean
          controla_caducidad?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fk_material_subfamilia"
            columns: ["cod_familia", "cod_subfamilia"]
            isOneToOne: false
            referencedRelation: "codificacion_subfamilias"
            referencedColumns: ["familia_codigo", "codigo"]
          },
          {
            foreignKeyName: "fk_material_tipo"
            columns: ["cod_subfamilia", "cod_tipo"]
            isOneToOne: false
            referencedRelation: "codificacion_tipos"
            referencedColumns: ["subfamilia_codigo", "codigo"]
          },
          {
            foreignKeyName: "materiales_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_material"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materiales_cod_familia_fkey"
            columns: ["cod_familia"]
            isOneToOne: false
            referencedRelation: "codificacion_familias"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "materiales_cod_material_fkey"
            columns: ["cod_material"]
            isOneToOne: false
            referencedRelation: "codificacion_materiales"
            referencedColumns: ["codigo"]
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
      movimiento_detalle: {
        Row: {
          id: string
          movimiento_id: string
          material_id: string
          lote_id: string | null
          requerimiento_detalle_id: string | null
          cantidad: number
          costo_unitario: number
          costo_total: number
          cantidad_sistema: number | null
          cantidad_fisica: number | null
          observaciones: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          movimiento_id: string
          material_id: string
          lote_id?: string | null
          requerimiento_detalle_id?: string | null
          cantidad: number
          costo_unitario?: number
          costo_total?: number
          cantidad_sistema?: number | null
          cantidad_fisica?: number | null
          observaciones?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          movimiento_id?: string
          material_id?: string
          lote_id?: string | null
          requerimiento_detalle_id?: string | null
          cantidad?: number
          costo_unitario?: number
          costo_total?: number
          cantidad_sistema?: number | null
          cantidad_fisica?: number | null
          observaciones?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_mov_detalle_requerimiento"
            columns: ["requerimiento_detalle_id"]
            isOneToOne: false
            referencedRelation: "requerimiento_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimiento_detalle_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_material"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimiento_detalle_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimiento_detalle_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "movimientos_almacen"
            referencedColumns: ["id"]
          }
        ]
      }
      movimientos_almacen: {
        Row: {
          id: string
          numero: string
          tipo: Database["public"]["Enums"]["tipo_movimiento_almacen"]
          estado: Database["public"]["Enums"]["estado_movimiento_almacen"]
          fecha: string
          almacen_id: string
          almacen_destino_id: string | null
          orden_id: string | null
          etapa_id: string | null
          requerimiento_id: string | null
          proveedor_id: string | null
          documento_referencia: string | null
          referencia_tabla: string | null
          referencia_id: string | null
          motivo: string | null
          observaciones: string | null
          total_valorizado: number
          responsable_id: string | null
          confirmado_por: string | null
          fecha_confirmacion: string | null
          anulado_por: string | null
          fecha_anulacion: string | null
          motivo_anulacion: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          numero?: string
          tipo: Database["public"]["Enums"]["tipo_movimiento_almacen"]
          estado?: Database["public"]["Enums"]["estado_movimiento_almacen"]
          fecha?: string
          almacen_id: string
          almacen_destino_id?: string | null
          orden_id?: string | null
          etapa_id?: string | null
          requerimiento_id?: string | null
          proveedor_id?: string | null
          documento_referencia?: string | null
          referencia_tabla?: string | null
          referencia_id?: string | null
          motivo?: string | null
          observaciones?: string | null
          total_valorizado?: number
          responsable_id?: string | null
          confirmado_por?: string | null
          fecha_confirmacion?: string | null
          anulado_por?: string | null
          fecha_anulacion?: string | null
          motivo_anulacion?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          numero?: string
          tipo?: Database["public"]["Enums"]["tipo_movimiento_almacen"]
          estado?: Database["public"]["Enums"]["estado_movimiento_almacen"]
          fecha?: string
          almacen_id?: string
          almacen_destino_id?: string | null
          orden_id?: string | null
          etapa_id?: string | null
          requerimiento_id?: string | null
          proveedor_id?: string | null
          documento_referencia?: string | null
          referencia_tabla?: string | null
          referencia_id?: string | null
          motivo?: string | null
          observaciones?: string | null
          total_valorizado?: number
          responsable_id?: string | null
          confirmado_por?: string | null
          fecha_confirmacion?: string | null
          anulado_por?: string | null
          fecha_anulacion?: string | null
          motivo_anulacion?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_mov_etapa"
            columns: ["etapa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id", "orden_id"]
          },
          {
            foreignKeyName: "fk_mov_proveedor"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_mov_requerimiento"
            columns: ["requerimiento_id"]
            isOneToOne: false
            referencedRelation: "requerimientos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_almacen_almacen_destino_id_fkey"
            columns: ["almacen_destino_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_almacen_almacen_id_fkey"
            columns: ["almacen_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_almacen_anulado_por_fkey"
            columns: ["anulado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_almacen_confirmado_por_fkey"
            columns: ["confirmado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_almacen_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_almacen_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_almacen_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      notas: {
        Row: {
          id: string
          entidad_tabla: string
          entidad_id: string
          orden_id: string | null
          texto: string
          autor_id: string | null
          menciones: string[]
          nota_padre_id: string | null
          es_interna: boolean
          fijada: boolean
          editada_en: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          entidad_tabla: string
          entidad_id: string
          orden_id?: string | null
          texto: string
          autor_id?: string | null
          menciones?: string[]
          nota_padre_id?: string | null
          es_interna?: boolean
          fijada?: boolean
          editada_en?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          entidad_tabla?: string
          entidad_id?: string
          orden_id?: string | null
          texto?: string
          autor_id?: string | null
          menciones?: string[]
          nota_padre_id?: string | null
          es_interna?: boolean
          fijada?: boolean
          editada_en?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "notas_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_nota_padre_id_fkey"
            columns: ["nota_padre_id"]
            isOneToOne: false
            referencedRelation: "notas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          }
        ]
      }
      notas_cotizacion: {
        Row: {
          id: string
          codigo: string
          texto: string
          orden: number
          activo: boolean
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          codigo: string
          texto: string
          orden?: number
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          codigo?: string
          texto?: string
          orden?: number
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: []
      }
      orden_compra_detalle: {
        Row: {
          id: string
          orden_compra_id: string
          material_id: string
          requerimiento_detalle_id: string | null
          descripcion: string | null
          cantidad: number
          precio_unitario: number
          descuento_porcentaje: number
          subtotal: number | null
          cantidad_recibida: number
          cantidad_pendiente: number | null
          fecha_entrega_esperada: string | null
          observaciones: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_compra_id: string
          material_id: string
          requerimiento_detalle_id?: string | null
          descripcion?: string | null
          cantidad: number
          precio_unitario: number
          descuento_porcentaje?: number
          cantidad_recibida?: number
          fecha_entrega_esperada?: string | null
          observaciones?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_compra_id?: string
          material_id?: string
          requerimiento_detalle_id?: string | null
          descripcion?: string | null
          cantidad?: number
          precio_unitario?: number
          descuento_porcentaje?: number
          cantidad_recibida?: number
          fecha_entrega_esperada?: string | null
          observaciones?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "orden_compra_detalle_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orden_compra_detalle_orden_compra_id_fkey"
            columns: ["orden_compra_id"]
            isOneToOne: false
            referencedRelation: "ordenes_compra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orden_compra_detalle_requerimiento_detalle_id_fkey"
            columns: ["requerimiento_detalle_id"]
            isOneToOne: false
            referencedRelation: "requerimiento_detalle"
            referencedColumns: ["id"]
          }
        ]
      }
      ordenes_compra: {
        Row: {
          id: string
          numero: string
          proveedor_id: string
          requerimiento_id: string | null
          orden_id: string | null
          sede_id: string
          almacen_destino_id: string | null
          estado: Database["public"]["Enums"]["estado_orden_compra"]
          fecha: string
          fecha_entrega_esperada: string | null
          moneda: Database["public"]["Enums"]["moneda"]
          tipo_cambio: number
          condicion_pago: Database["public"]["Enums"]["condicion_pago"]
          lugar_entrega: string | null
          subtotal: number
          descuento: number
          igv_porcentaje: number
          igv: number
          total: number
          observaciones: string | null
          aprobada_por: string | null
          fecha_aprobacion: string | null
          fecha_envio: string | null
          motivo_anulacion: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          numero?: string
          proveedor_id: string
          requerimiento_id?: string | null
          orden_id?: string | null
          sede_id: string
          almacen_destino_id?: string | null
          estado?: Database["public"]["Enums"]["estado_orden_compra"]
          fecha?: string
          fecha_entrega_esperada?: string | null
          moneda?: Database["public"]["Enums"]["moneda"]
          tipo_cambio?: number
          condicion_pago?: Database["public"]["Enums"]["condicion_pago"]
          lugar_entrega?: string | null
          subtotal?: number
          descuento?: number
          igv_porcentaje?: number
          igv?: number
          total?: number
          observaciones?: string | null
          aprobada_por?: string | null
          fecha_aprobacion?: string | null
          fecha_envio?: string | null
          motivo_anulacion?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          numero?: string
          proveedor_id?: string
          requerimiento_id?: string | null
          orden_id?: string | null
          sede_id?: string
          almacen_destino_id?: string | null
          estado?: Database["public"]["Enums"]["estado_orden_compra"]
          fecha?: string
          fecha_entrega_esperada?: string | null
          moneda?: Database["public"]["Enums"]["moneda"]
          tipo_cambio?: number
          condicion_pago?: Database["public"]["Enums"]["condicion_pago"]
          lugar_entrega?: string | null
          subtotal?: number
          descuento?: number
          igv_porcentaje?: number
          igv?: number
          total?: number
          observaciones?: string | null
          aprobada_por?: string | null
          fecha_aprobacion?: string | null
          fecha_envio?: string | null
          motivo_anulacion?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_compra_almacen_destino_id_fkey"
            columns: ["almacen_destino_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_aprobada_por_fkey"
            columns: ["aprobada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_requerimiento_id_fkey"
            columns: ["requerimiento_id"]
            isOneToOne: false
            referencedRelation: "requerimientos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_sede_id_fkey"
            columns: ["sede_id"]
            isOneToOne: false
            referencedRelation: "sedes"
            referencedColumns: ["id"]
          }
        ]
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
        }
        Insert: {
          id?: string
          numero?: string
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
      ot_costos_adicionales: {
        Row: {
          id: string
          orden_id: string
          etapa_id: string | null
          fecha: string
          tipo_costo: Database["public"]["Enums"]["tipo_costo"]
          descripcion: string
          moneda: Database["public"]["Enums"]["moneda"]
          monto: number
          tipo_cambio: number
          monto_base: number | null
          centro_costo_id: string | null
          numero_documento: string | null
          observaciones: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          etapa_id?: string | null
          fecha?: string
          tipo_costo?: Database["public"]["Enums"]["tipo_costo"]
          descripcion: string
          moneda?: Database["public"]["Enums"]["moneda"]
          monto: number
          tipo_cambio: number
          centro_costo_id?: string | null
          numero_documento?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          etapa_id?: string | null
          fecha?: string
          tipo_costo?: Database["public"]["Enums"]["tipo_costo"]
          descripcion?: string
          moneda?: Database["public"]["Enums"]["moneda"]
          monto?: number
          tipo_cambio?: number
          centro_costo_id?: string | null
          numero_documento?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_costo_adicional_etapa"
            columns: ["etapa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id", "orden_id"]
          },
          {
            foreignKeyName: "ot_costos_adicionales_centro_costo_id_fkey"
            columns: ["centro_costo_id"]
            isOneToOne: false
            referencedRelation: "centros_costo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_costos_adicionales_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_costos_adicionales_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
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
            isOneToOne: false
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
          numero?: string
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
      ot_presupuesto: {
        Row: {
          id: string
          orden_id: string
          tipo_costo: Database["public"]["Enums"]["tipo_costo"]
          descripcion: string
          detalle: string | null
          unidad_medida: string
          cantidad: number
          costo_unitario: number
          monto_presupuestado: number
          origen: Database["public"]["Enums"]["origen_presupuesto"]
          cotizacion_partida_id: string | null
          material_id: string | null
          especialidad: Database["public"]["Enums"]["rol_operario"] | null
          horas_presupuestadas: number
          centro_costo_id: string | null
          observaciones: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          orden_id: string
          tipo_costo: Database["public"]["Enums"]["tipo_costo"]
          descripcion: string
          detalle?: string | null
          unidad_medida?: string
          cantidad?: number
          costo_unitario?: number
          monto_presupuestado?: number
          origen?: Database["public"]["Enums"]["origen_presupuesto"]
          cotizacion_partida_id?: string | null
          material_id?: string | null
          especialidad?: Database["public"]["Enums"]["rol_operario"] | null
          horas_presupuestadas?: number
          centro_costo_id?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          orden_id?: string
          tipo_costo?: Database["public"]["Enums"]["tipo_costo"]
          descripcion?: string
          detalle?: string | null
          unidad_medida?: string
          cantidad?: number
          costo_unitario?: number
          monto_presupuestado?: number
          origen?: Database["public"]["Enums"]["origen_presupuesto"]
          cotizacion_partida_id?: string | null
          material_id?: string | null
          especialidad?: Database["public"]["Enums"]["rol_operario"] | null
          horas_presupuestadas?: number
          centro_costo_id?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_presupuesto_centro_costo_id_fkey"
            columns: ["centro_costo_id"]
            isOneToOne: false
            referencedRelation: "centros_costo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_presupuesto_cotizacion_partida_id_fkey"
            columns: ["cotizacion_partida_id"]
            isOneToOne: false
            referencedRelation: "cotizacion_partidas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_presupuesto_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_presupuesto_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_presupuesto_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
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
        }
        Relationships: [
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
          numero?: string
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
        }
        Insert: {
          id?: string
          tipo_carroceria_id?: string | null
          nombre: string
          descripcion?: string | null
          activa?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          tipo_carroceria_id?: string | null
          nombre?: string
          descripcion?: string | null
          activa?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "plantillas_ficha_tipo_carroceria_id_fkey"
            columns: ["tipo_carroceria_id"]
            isOneToOne: false
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
      prorrateo_indirectos: {
        Row: {
          id: string
          periodo: string
          orden_id: string
          horas_hombre: number
          horas_totales_periodo: number
          gasto_total_periodo: number
          tasa_hora: number
          monto_asignado: number
          calculado_en: string
          calculado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          periodo: string
          orden_id: string
          horas_hombre: number
          horas_totales_periodo: number
          gasto_total_periodo: number
          tasa_hora: number
          monto_asignado: number
          calculado_en?: string
          calculado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          periodo?: string
          orden_id?: string
          horas_hombre?: number
          horas_totales_periodo?: number
          gasto_total_periodo?: number
          tasa_hora?: number
          monto_asignado?: number
          calculado_en?: string
          calculado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "prorrateo_indirectos_calculado_por_fkey"
            columns: ["calculado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prorrateo_indirectos_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          }
        ]
      }
      proveedor_materiales: {
        Row: {
          id: string
          proveedor_id: string
          material_id: string
          codigo_proveedor: string | null
          precio_referencial: number
          moneda: Database["public"]["Enums"]["moneda"]
          fecha_precio: string | null
          tiempo_entrega_dias: number
          cantidad_minima: number
          es_preferente: boolean
          observaciones: string | null
          activo: boolean
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          proveedor_id: string
          material_id: string
          codigo_proveedor?: string | null
          precio_referencial?: number
          moneda?: Database["public"]["Enums"]["moneda"]
          fecha_precio?: string | null
          tiempo_entrega_dias?: number
          cantidad_minima?: number
          es_preferente?: boolean
          observaciones?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          proveedor_id?: string
          material_id?: string
          codigo_proveedor?: string | null
          precio_referencial?: number
          moneda?: Database["public"]["Enums"]["moneda"]
          fecha_precio?: string | null
          tiempo_entrega_dias?: number
          cantidad_minima?: number
          es_preferente?: boolean
          observaciones?: string | null
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "proveedor_materiales_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: true
            referencedRelation: "materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proveedor_materiales_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          }
        ]
      }
      proveedores: {
        Row: {
          id: string
          codigo: string | null
          numero_documento: string
          razon_social: string
          nombre_comercial: string | null
          direccion: string | null
          distrito: string | null
          provincia: string | null
          departamento: string | null
          telefono: string | null
          correo: string | null
          web: string | null
          contacto_nombre: string | null
          contacto_telefono: string | null
          contacto_correo: string | null
          condicion_pago: Database["public"]["Enums"]["condicion_pago"]
          dias_credito: number
          moneda: Database["public"]["Enums"]["moneda"]
          banco: string | null
          cuenta_bancaria: string | null
          cuenta_cci: string | null
          calificacion: number | null
          es_homologado: boolean
          observaciones: string | null
          activo: boolean
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          codigo?: string | null
          numero_documento: string
          razon_social: string
          nombre_comercial?: string | null
          direccion?: string | null
          distrito?: string | null
          provincia?: string | null
          departamento?: string | null
          telefono?: string | null
          correo?: string | null
          web?: string | null
          contacto_nombre?: string | null
          contacto_telefono?: string | null
          contacto_correo?: string | null
          condicion_pago?: Database["public"]["Enums"]["condicion_pago"]
          dias_credito?: number
          moneda?: Database["public"]["Enums"]["moneda"]
          banco?: string | null
          cuenta_bancaria?: string | null
          cuenta_cci?: string | null
          calificacion?: number | null
          es_homologado?: boolean
          observaciones?: string | null
          activo?: boolean
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          codigo?: string | null
          numero_documento?: string
          razon_social?: string
          nombre_comercial?: string | null
          direccion?: string | null
          distrito?: string | null
          provincia?: string | null
          departamento?: string | null
          telefono?: string | null
          correo?: string | null
          web?: string | null
          contacto_nombre?: string | null
          contacto_telefono?: string | null
          contacto_correo?: string | null
          condicion_pago?: Database["public"]["Enums"]["condicion_pago"]
          dias_credito?: number
          moneda?: Database["public"]["Enums"]["moneda"]
          banco?: string | null
          cuenta_bancaria?: string | null
          cuenta_cci?: string | null
          calificacion?: number | null
          es_homologado?: boolean
          observaciones?: string | null
          activo?: boolean
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "proveedores_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      recepcion_detalle: {
        Row: {
          id: string
          recepcion_id: string
          orden_compra_detalle_id: string
          material_id: string
          cantidad_recibida: number
          cantidad_rechazada: number
          motivo_rechazo: string | null
          costo_unitario: number
          numero_lote: string | null
          numero_colada: string | null
          certificado_calidad: string | null
          fecha_vencimiento: string | null
          observaciones: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          recepcion_id: string
          orden_compra_detalle_id: string
          material_id: string
          cantidad_recibida: number
          cantidad_rechazada?: number
          motivo_rechazo?: string | null
          costo_unitario?: number
          numero_lote?: string | null
          numero_colada?: string | null
          certificado_calidad?: string | null
          fecha_vencimiento?: string | null
          observaciones?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          recepcion_id?: string
          orden_compra_detalle_id?: string
          material_id?: string
          cantidad_recibida?: number
          cantidad_rechazada?: number
          motivo_rechazo?: string | null
          costo_unitario?: number
          numero_lote?: string | null
          numero_colada?: string | null
          certificado_calidad?: string | null
          fecha_vencimiento?: string | null
          observaciones?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "recepcion_detalle_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recepcion_detalle_orden_compra_detalle_id_fkey"
            columns: ["orden_compra_detalle_id"]
            isOneToOne: false
            referencedRelation: "orden_compra_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recepcion_detalle_recepcion_id_fkey"
            columns: ["recepcion_id"]
            isOneToOne: false
            referencedRelation: "recepciones"
            referencedColumns: ["id"]
          }
        ]
      }
      recepciones: {
        Row: {
          id: string
          numero: string
          orden_compra_id: string
          almacen_id: string
          estado: Database["public"]["Enums"]["estado_movimiento_almacen"]
          fecha: string
          numero_guia: string | null
          fecha_guia: string | null
          numero_factura: string | null
          fecha_factura: string | null
          transportista: string | null
          placa_vehiculo: string | null
          movimiento_id: string | null
          observaciones: string | null
          recibido_por: string | null
          confirmado_por: string | null
          fecha_confirmacion: string | null
          motivo_anulacion: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          numero?: string
          orden_compra_id: string
          almacen_id: string
          estado?: Database["public"]["Enums"]["estado_movimiento_almacen"]
          fecha?: string
          numero_guia?: string | null
          fecha_guia?: string | null
          numero_factura?: string | null
          fecha_factura?: string | null
          transportista?: string | null
          placa_vehiculo?: string | null
          movimiento_id?: string | null
          observaciones?: string | null
          recibido_por?: string | null
          confirmado_por?: string | null
          fecha_confirmacion?: string | null
          motivo_anulacion?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          numero?: string
          orden_compra_id?: string
          almacen_id?: string
          estado?: Database["public"]["Enums"]["estado_movimiento_almacen"]
          fecha?: string
          numero_guia?: string | null
          fecha_guia?: string | null
          numero_factura?: string | null
          fecha_factura?: string | null
          transportista?: string | null
          placa_vehiculo?: string | null
          movimiento_id?: string | null
          observaciones?: string | null
          recibido_por?: string | null
          confirmado_por?: string | null
          fecha_confirmacion?: string | null
          motivo_anulacion?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_recepcion_movimiento"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "movimientos_almacen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recepciones_almacen_id_fkey"
            columns: ["almacen_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recepciones_confirmado_por_fkey"
            columns: ["confirmado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recepciones_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recepciones_orden_compra_id_fkey"
            columns: ["orden_compra_id"]
            isOneToOne: false
            referencedRelation: "ordenes_compra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recepciones_recibido_por_fkey"
            columns: ["recibido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      requerimiento_detalle: {
        Row: {
          id: string
          requerimiento_id: string
          material_id: string
          cantidad_solicitada: number
          cantidad_aprobada: number
          cantidad_atendida: number
          cantidad_reservada: number
          especificacion: string | null
          observaciones: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          requerimiento_id: string
          material_id: string
          cantidad_solicitada: number
          cantidad_aprobada?: number
          cantidad_atendida?: number
          cantidad_reservada?: number
          especificacion?: string | null
          observaciones?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          requerimiento_id?: string
          material_id?: string
          cantidad_solicitada?: number
          cantidad_aprobada?: number
          cantidad_atendida?: number
          cantidad_reservada?: number
          especificacion?: string | null
          observaciones?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "requerimiento_detalle_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requerimiento_detalle_requerimiento_id_fkey"
            columns: ["requerimiento_id"]
            isOneToOne: false
            referencedRelation: "requerimientos"
            referencedColumns: ["id"]
          }
        ]
      }
      requerimientos: {
        Row: {
          id: string
          numero: string
          orden_id: string | null
          etapa_id: string | null
          sede_id: string
          almacen_id: string | null
          estado: Database["public"]["Enums"]["estado_requerimiento"]
          prioridad: Database["public"]["Enums"]["prioridad_ot"]
          fecha: string
          fecha_requerida: string | null
          solicitante_id: string | null
          aprobador_id: string | null
          fecha_aprobacion: string | null
          motivo_rechazo: string | null
          observaciones: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          numero?: string
          orden_id?: string | null
          etapa_id?: string | null
          sede_id: string
          almacen_id?: string | null
          estado?: Database["public"]["Enums"]["estado_requerimiento"]
          prioridad?: Database["public"]["Enums"]["prioridad_ot"]
          fecha?: string
          fecha_requerida?: string | null
          solicitante_id?: string | null
          aprobador_id?: string | null
          fecha_aprobacion?: string | null
          motivo_rechazo?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          numero?: string
          orden_id?: string | null
          etapa_id?: string | null
          sede_id?: string
          almacen_id?: string | null
          estado?: Database["public"]["Enums"]["estado_requerimiento"]
          prioridad?: Database["public"]["Enums"]["prioridad_ot"]
          fecha?: string
          fecha_requerida?: string | null
          solicitante_id?: string | null
          aprobador_id?: string | null
          fecha_aprobacion?: string | null
          motivo_rechazo?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_req_etapa"
            columns: ["etapa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id", "orden_id"]
          },
          {
            foreignKeyName: "requerimientos_almacen_id_fkey"
            columns: ["almacen_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requerimientos_aprobador_id_fkey"
            columns: ["aprobador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requerimientos_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requerimientos_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requerimientos_sede_id_fkey"
            columns: ["sede_id"]
            isOneToOne: false
            referencedRelation: "sedes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requerimientos_solicitante_id_fkey"
            columns: ["solicitante_id"]
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
      servicios_terceros: {
        Row: {
          id: string
          orden_id: string
          etapa_id: string | null
          proveedor_id: string
          tipo_servicio: Database["public"]["Enums"]["tipo_servicio_tercero"]
          descripcion: string
          especificacion: string | null
          fecha: string
          fecha_entrega: string | null
          moneda: Database["public"]["Enums"]["moneda"]
          monto: number
          tipo_cambio: number
          monto_base: number | null
          numero_factura: string | null
          fecha_factura: string | null
          estado: Database["public"]["Enums"]["estado_servicio_tercero"]
          centro_costo_id: string | null
          responsable_id: string | null
          observaciones: string | null
          creado_por: string | null
          creado_en: string
          actualizado_en: string
          numero: string
          plazo_dias: number | null
          aprobado_por: string | null
          fecha_aprobacion: string | null
          fecha_conformidad: string | null
          conformidad_por: string | null
          observaciones_conformidad: string | null
        }
        Insert: {
          id?: string
          orden_id: string
          etapa_id?: string | null
          proveedor_id: string
          tipo_servicio?: Database["public"]["Enums"]["tipo_servicio_tercero"]
          descripcion: string
          especificacion?: string | null
          fecha?: string
          fecha_entrega?: string | null
          moneda?: Database["public"]["Enums"]["moneda"]
          monto: number
          tipo_cambio: number
          numero_factura?: string | null
          fecha_factura?: string | null
          estado?: Database["public"]["Enums"]["estado_servicio_tercero"]
          centro_costo_id?: string | null
          responsable_id?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          numero?: string
          plazo_dias?: number | null
          aprobado_por?: string | null
          fecha_aprobacion?: string | null
          fecha_conformidad?: string | null
          conformidad_por?: string | null
          observaciones_conformidad?: string | null
        }
        Update: {
          id?: string
          orden_id?: string
          etapa_id?: string | null
          proveedor_id?: string
          tipo_servicio?: Database["public"]["Enums"]["tipo_servicio_tercero"]
          descripcion?: string
          especificacion?: string | null
          fecha?: string
          fecha_entrega?: string | null
          moneda?: Database["public"]["Enums"]["moneda"]
          monto?: number
          tipo_cambio?: number
          numero_factura?: string | null
          fecha_factura?: string | null
          estado?: Database["public"]["Enums"]["estado_servicio_tercero"]
          centro_costo_id?: string | null
          responsable_id?: string | null
          observaciones?: string | null
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
          numero?: string
          plazo_dias?: number | null
          aprobado_por?: string | null
          fecha_aprobacion?: string | null
          fecha_conformidad?: string | null
          conformidad_por?: string | null
          observaciones_conformidad?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_servicio_etapa"
            columns: ["etapa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ot_etapas"
            referencedColumns: ["id", "orden_id"]
          },
          {
            foreignKeyName: "servicios_terceros_aprobado_por_fkey"
            columns: ["aprobado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_terceros_centro_costo_id_fkey"
            columns: ["centro_costo_id"]
            isOneToOne: false
            referencedRelation: "centros_costo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_terceros_conformidad_por_fkey"
            columns: ["conformidad_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_terceros_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_terceros_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_terceros_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_terceros_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          }
        ]
      }
      tarifas_mano_obra: {
        Row: {
          id: string
          codigo: string
          especialidad: Database["public"]["Enums"]["rol_operario"]
          nombre: string
          costo_hora: number
          costo_hora_extra: number
          vigencia_desde: string
          vigencia_hasta: string | null
          centro_costo_id: string | null
          observaciones: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          codigo: string
          especialidad: Database["public"]["Enums"]["rol_operario"]
          nombre: string
          costo_hora: number
          costo_hora_extra: number
          vigencia_desde?: string
          vigencia_hasta?: string | null
          centro_costo_id?: string | null
          observaciones?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          codigo?: string
          especialidad?: Database["public"]["Enums"]["rol_operario"]
          nombre?: string
          costo_hora?: number
          costo_hora_extra?: number
          vigencia_desde?: string
          vigencia_hasta?: string | null
          centro_costo_id?: string | null
          observaciones?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarifas_mano_obra_centro_costo_id_fkey"
            columns: ["centro_costo_id"]
            isOneToOne: false
            referencedRelation: "centros_costo"
            referencedColumns: ["id"]
          }
        ]
      }
      tipos_cambio: {
        Row: {
          fecha: string
          compra: number
          venta: number
          fuente: string
          creado_en: string
        }
        Insert: {
          fecha: string
          compra: number
          venta: number
          fuente?: string
          creado_en?: string
        }
        Update: {
          fecha?: string
          compra?: number
          venta?: number
          fuente?: string
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
          modelo: string | null
          tipo: string | null
          largo_m: number | null
          ancho_m: number | null
          alto_m: number | null
          capacidad: string | null
          peso_neto_tn: number | null
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
          modelo?: string | null
          tipo?: string | null
          largo_m?: number | null
          ancho_m?: number | null
          alto_m?: number | null
          capacidad?: string | null
          peso_neto_tn?: number | null
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
          modelo?: string | null
          tipo?: string | null
          largo_m?: number | null
          ancho_m?: number | null
          alto_m?: number | null
          capacidad?: string | null
          peso_neto_tn?: number | null
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
      tipos_documento: {
        Row: {
          id: string
          codigo: string
          nombre: string
          descripcion: string | null
          categoria: Database["public"]["Enums"]["categoria_documento"]
          entidad_tabla: string | null
          requiere_aprobacion: boolean
          obligatorio_para_cierre: boolean
          extensiones_permitidas: string[]
          tamano_maximo_mb: number
          confidencial_por_defecto: boolean
          bucket: string
          retencion_meses: number | null
          orden_visualizacion: number
          activo: boolean
          creado_en: string
          actualizado_en: string
          tipo_sig: string | null
          area_codigo: string | null
          correlativo_sig: number | null
          codigo_sig: string | null
        }
        Insert: {
          id?: string
          codigo: string
          nombre: string
          descripcion?: string | null
          categoria?: Database["public"]["Enums"]["categoria_documento"]
          entidad_tabla?: string | null
          requiere_aprobacion?: boolean
          obligatorio_para_cierre?: boolean
          extensiones_permitidas?: string[]
          tamano_maximo_mb?: number
          confidencial_por_defecto?: boolean
          bucket?: string
          retencion_meses?: number | null
          orden_visualizacion?: number
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          tipo_sig?: string | null
          area_codigo?: string | null
          correlativo_sig?: number | null
        }
        Update: {
          id?: string
          codigo?: string
          nombre?: string
          descripcion?: string | null
          categoria?: Database["public"]["Enums"]["categoria_documento"]
          entidad_tabla?: string | null
          requiere_aprobacion?: boolean
          obligatorio_para_cierre?: boolean
          extensiones_permitidas?: string[]
          tamano_maximo_mb?: number
          confidencial_por_defecto?: boolean
          bucket?: string
          retencion_meses?: number | null
          orden_visualizacion?: number
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
          tipo_sig?: string | null
          area_codigo?: string | null
          correlativo_sig?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tipos_documento_area_codigo_fkey"
            columns: ["area_codigo"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "tipos_documento_tipo_sig_fkey"
            columns: ["tipo_sig"]
            isOneToOne: false
            referencedRelation: "tipos_documento_sig"
            referencedColumns: ["codigo"]
          }
        ]
      }
      tipos_documento_sig: {
        Row: {
          codigo: string
          nombre: string
          uso_tipico: string | null
          orden_secuencia: number
          activo: boolean
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          codigo: string
          nombre: string
          uso_tipico?: string | null
          orden_secuencia: number
          activo?: boolean
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          codigo?: string
          nombre?: string
          uso_tipico?: string | null
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
        }
        Insert: {
          id?: string
          cliente_id: string
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
        }
        Update: {
          id?: string
          cliente_id?: string
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
    }
    Views: {
      cotizacion_ficha: {
        Row: {
          cotizacion_id: string | null
          numero: string | null
          seccion: string | null
          orden_seccion: number | null
          orden_linea: number | null
          etiqueta: string | null
          detalle: string | null
        }
        Relationships: []
      }
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
      documento_firmas: {
        Row: {
          aprobacion_id: string | null
          documento_id: string | null
          orden_firma: number | null
          estado: Database["public"]["Enums"]["estado_aprobacion"] | null
          comentario: string | null
          fecha: string | null
          version_aprobada: number | null
          solicitado_en: string | null
          aprobador_id: string | null
          aprobador: string | null
          aprobador_cargo: string | null
          solicitado_por_nombre: string | null
          le_toca: boolean | null
        }
        Relationships: []
      }
      garantias_resumen: {
        Row: {
          entrega_id: string | null
          orden_id: string | null
          orden: string | null
          placa: string | null
          marca: string | null
          cliente: string | null
          carroceria: string | null
          fecha_entrega: string | null
          garantia_meses: number | null
          garantia_vence: string | null
          vigente: boolean | null
          dias_restantes: number | null
          reclamos: number | null
          reclamos_abiertos: number | null
        }
        Relationships: []
      }
      mis_firmas_pendientes: {
        Row: {
          aprobacion_id: string | null
          documento_id: string | null
          orden_firma: number | null
          solicitado_en: string | null
          titulo: string | null
          descripcion: string | null
          numero_externo: string | null
          fecha_documento: string | null
          version_actual: number | null
          orden_id: string | null
          orden_numero: string | null
          cliente: string | null
          placa: string | null
          tipo_codigo: string | null
          tipo_nombre: string | null
          tipo_categoria: Database["public"]["Enums"]["categoria_documento"] | null
          solicitado_por_nombre: string | null
          le_toca: boolean | null
          firmas_total: number | null
        }
        Relationships: []
      }
      os_resumen: {
        Row: {
          id: string | null
          numero: string | null
          orden_id: string | null
          orden_numero: string | null
          cliente: string | null
          placa: string | null
          proveedor_id: string | null
          proveedor: string | null
          tipo_servicio: Database["public"]["Enums"]["tipo_servicio_tercero"] | null
          descripcion: string | null
          especificacion: string | null
          estado: Database["public"]["Enums"]["estado_servicio_tercero"] | null
          fecha: string | null
          fecha_entrega: string | null
          plazo_dias: number | null
          fecha_conformidad: string | null
          moneda: Database["public"]["Enums"]["moneda"] | null
          monto: number | null
          monto_base: number | null
          numero_factura: string | null
          fecha_factura: string | null
          atrasada: boolean | null
          etapa_id: string | null
          etapa: string | null
        }
        Relationships: []
      }
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
          dias_habiles_restantes: number | null
          codigo_interno: string | null
          numero_chasis: string | null
          marca: string | null
          modelo: string | null
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
      v_documentos_por_aprobar: {
        Row: {
          aprobacion_id: string | null
          documento_id: string | null
          aprobador_id: string | null
          orden_firma: number | null
          solicitado_en: string | null
          titulo: string | null
          orden_id: string | null
          version_actual: number | null
          tipo_codigo: string | null
          tipo_nombre: string | null
          le_toca: boolean | null
        }
        Relationships: []
      }
      v_documentos_vigentes: {
        Row: {
          id: string | null
          tipo_documento_id: string | null
          tipo_codigo: string | null
          tipo_nombre: string | null
          categoria: Database["public"]["Enums"]["categoria_documento"] | null
          titulo: string | null
          descripcion: string | null
          numero_externo: string | null
          fecha_documento: string | null
          entidad_tabla: string | null
          entidad_id: string | null
          orden_id: string | null
          orden_numero: string | null
          estado: Database["public"]["Enums"]["estado_documento"] | null
          es_confidencial: boolean | null
          etiquetas: string[] | null
          version_actual: number | null
          estado_aprobacion: Database["public"]["Enums"]["estado_aprobacion"] | null
          aprobado_en: string | null
          vence_en: string | null
          vencido: boolean | null
          version_id: string | null
          bucket: string | null
          ruta_storage: string | null
          nombre_archivo: string | null
          extension: string | null
          tamano_bytes: number | null
          mime_type: string | null
          hash_sha256: string | null
          subido_por: string | null
          subido_en: string | null
          creado_por: string | null
          creado_en: string | null
        }
        Relationships: []
      }
      v_materiales_por_ot: {
        Row: {
          orden_id: string | null
          orden_numero: string | null
          materiales_distintos: number | null
          movimientos: number | null
          costo_material: number | null
          primer_consumo: string | null
          ultimo_consumo: string | null
        }
        Relationships: []
      }
      v_ordenes_compra_pendientes: {
        Row: {
          orden_compra_id: string | null
          numero: string | null
          estado: Database["public"]["Enums"]["estado_orden_compra"] | null
          fecha: string | null
          fecha_entrega_esperada: string | null
          proveedor: string | null
          moneda: Database["public"]["Enums"]["moneda"] | null
          total: number | null
          cantidad_pedida: number | null
          cantidad_recibida: number | null
          cantidad_pendiente: number | null
          dias_atraso: number | null
        }
        Relationships: []
      }
      v_ot_costo_adicional: {
        Row: {
          orden_id: string | null
          costo_adicional: number | null
          documentos: number | null
        }
        Relationships: []
      }
      v_ot_costo_indirecto: {
        Row: {
          orden_id: string | null
          costo_indirecto: number | null
          horas_prorrateadas: number | null
          periodos_prorrateados: number | null
          ultimo_periodo: string | null
        }
        Relationships: []
      }
      v_ot_costo_mano_obra: {
        Row: {
          orden_id: string | null
          horas_normales: number | null
          horas_extra: number | null
          horas_totales: number | null
          costo_normal: number | null
          costo_extra: number | null
          costo_mano_obra: number | null
          horas_sin_costo: number | null
          operarios: number | null
        }
        Relationships: []
      }
      v_ot_costo_materiales: {
        Row: {
          orden_id: string | null
          consumo_material: number | null
          devoluciones_material: number | null
          costo_materiales: number | null
          vales_consumo: number | null
          ultimo_movimiento: string | null
        }
        Relationships: []
      }
      v_ot_costo_por_tipo: {
        Row: {
          orden_id: string | null
          tipo_costo: Database["public"]["Enums"]["tipo_costo"] | null
          presupuesto: number | null
          costo_real: number | null
          desviacion: number | null
          desviacion_porcentaje: number | null
        }
        Relationships: []
      }
      v_ot_costo_servicios: {
        Row: {
          orden_id: string | null
          costo_servicios: number | null
          servicios_comprometidos: number | null
          servicios_pagados: number | null
          servicios: number | null
          servicios_pendientes: number | null
        }
        Relationships: []
      }
      v_ot_costo_total: {
        Row: {
          orden_id: string | null
          numero: string | null
          cliente_id: string | null
          cliente: string | null
          unidad_id: string | null
          cotizacion_id: string | null
          sede_id: string | null
          tipo_trabajo: Database["public"]["Enums"]["tipo_trabajo_ot"] | null
          estado: Database["public"]["Enums"]["estado_ot"] | null
          moneda: Database["public"]["Enums"]["moneda"] | null
          fecha_registro: string | null
          fecha_fin_real: string | null
          avance_porcentaje: number | null
          costo_materiales: number | null
          costo_mano_obra: number | null
          costo_servicios: number | null
          costo_indirecto: number | null
          costo_adicional: number | null
          servicios_comprometidos: number | null
          horas_reales: number | null
          horas_sin_costo: number | null
          horas_estimadas: number | null
          presupuesto: number | null
          fuente_presupuesto: string | null
          costo_total: number | null
          desviacion: number | null
          desviacion_porcentaje: number | null
          consumo_presupuesto_porcentaje: number | null
          costo_por_hora: number | null
        }
        Relationships: []
      }
      v_ot_documentos_faltantes: {
        Row: {
          orden_id: string | null
          orden_numero: string | null
          cliente_id: string | null
          estado: Database["public"]["Enums"]["estado_ot"] | null
          tipo_documento_id: string | null
          tipo_codigo: string | null
          tipo_nombre: string | null
        }
        Relationships: []
      }
      v_ot_mano_obra_detalle: {
        Row: {
          detalle_id: string | null
          orden_id: string | null
          etapa_id: string | null
          usuario_id: string | null
          parte_id: string | null
          parte_numero: string | null
          fecha: string | null
          especialidad: Database["public"]["Enums"]["rol_operario"] | null
          tarifa_id: string | null
          horas: number | null
          horas_extra: number | null
          horas_totales: number | null
          costo_hora: number | null
          costo_hora_extra: number | null
          costo_normal: number | null
          costo_extra: number | null
          costo_hora_hombre: number | null
        }
        Relationships: []
      }
      v_ot_mano_obra_especialidad: {
        Row: {
          orden_id: string | null
          especialidad: Database["public"]["Enums"]["rol_operario"] | null
          horas_normales: number | null
          horas_extra: number | null
          horas_totales: number | null
          costo_mano_obra: number | null
          operarios: number | null
        }
        Relationships: []
      }
      v_ot_margen: {
        Row: {
          orden_id: string | null
          numero: string | null
          cliente_id: string | null
          cliente: string | null
          unidad_id: string | null
          cotizacion_id: string | null
          sede_id: string | null
          tipo_trabajo: Database["public"]["Enums"]["tipo_trabajo_ot"] | null
          estado: Database["public"]["Enums"]["estado_ot"] | null
          moneda: Database["public"]["Enums"]["moneda"] | null
          fecha_registro: string | null
          fecha_fin_real: string | null
          avance_porcentaje: number | null
          costo_materiales: number | null
          costo_mano_obra: number | null
          costo_servicios: number | null
          costo_indirecto: number | null
          costo_adicional: number | null
          servicios_comprometidos: number | null
          horas_reales: number | null
          horas_sin_costo: number | null
          horas_estimadas: number | null
          presupuesto: number | null
          fuente_presupuesto: string | null
          costo_total: number | null
          desviacion: number | null
          desviacion_porcentaje: number | null
          consumo_presupuesto_porcentaje: number | null
          costo_por_hora: number | null
          cotizacion_numero: string | null
          valor_venta_cotizado: number | null
          valor_venta_con_igv: number | null
          valor_venta: number | null
          utilidad: number | null
          margen_porcentaje: number | null
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
      v_stock_actual: {
        Row: {
          stock_id: string | null
          material_id: string | null
          material_codigo: string | null
          material_descripcion: string | null
          especificacion_tecnica: string | null
          categoria: string | null
          unidad_medida: string | null
          almacen_id: string | null
          almacen_codigo: string | null
          almacen_nombre: string | null
          almacen_tipo: Database["public"]["Enums"]["tipo_almacen"] | null
          sede_id: string | null
          ubicacion: string | null
          cantidad: number | null
          cantidad_reservada: number | null
          cantidad_disponible: number | null
          costo_promedio: number | null
          valorizado: number | null
          stock_minimo: number | null
          stock_maximo: number | null
          punto_reposicion: number | null
          es_critico: boolean | null
          controla_lote: boolean | null
          fecha_ultimo_movimiento: string | null
          bajo_minimo: boolean | null
          requiere_reposicion: boolean | null
        }
        Relationships: []
      }
      v_trazabilidad_lotes: {
        Row: {
          lote_id: string | null
          numero_lote: string | null
          numero_colada: string | null
          certificado_calidad: string | null
          material_codigo: string | null
          material_descripcion: string | null
          proveedor: string | null
          fecha_ingreso: string | null
          orden_id: string | null
          orden_numero: string | null
          orden_descripcion: string | null
          cliente: string | null
          placa: string | null
          fecha_consumo: string | null
          cantidad_consumida: number | null
          costo_total: number | null
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
      actualizar_estado_requerimiento: {
        Args: {
          p_requerimiento: string
        }
        Returns: string
      }
      anular_movimiento_almacen: {
        Args: {
          p_movimiento: string
          p_motivo: string
        }
        Returns: string
      }
      anular_movimiento_almacen_interna: {
        Args: {
          p_movimiento: string
          p_motivo: string
        }
        Returns: string
      }
      aplicar_plantilla_ficha: {
        Args: {
          p_cotizacion: string
          p_plantilla: string
        }
        Returns: number
      }
      aprobar_requerimiento: {
        Args: {
          p_requerimiento: string
          p_aprobador: string
        }
        Returns: string
      }
      aprobar_requerimiento_interna: {
        Args: {
          p_requerimiento: string
          p_aprobador?: string
        }
        Returns: string
      }
      armar_ficha_ot: {
        Args: {
          p_orden: string
        }
        Returns: string
      }
      asignar_codigo_almacen: {
        Args: {
          p_material: string
          p_familia: string
          p_subfamilia?: string
          p_material_cod?: string
          p_tipo?: string
        }
        Returns: string
      }
      cambiar_clave_personal: {
        Args: {
          p_usuario: string
          p_clave: string
        }
        Returns: string
      }
      cambiar_estado_personal: {
        Args: {
          p_usuario: string
          p_activo: boolean
        }
        Returns: string
      }
      cifrar_clave: {
        Args: {
          p_clave: string
        }
        Returns: string
      }
      completar_cuenta_acceso: {
        Args: {
          p_cuenta: string
        }
        Returns: string
      }
      confirmar_movimiento_almacen: {
        Args: {
          p_movimiento: string
        }
        Returns: string
      }
      confirmar_movimiento_almacen_interna: {
        Args: {
          p_movimiento: string
        }
        Returns: string
      }
      confirmar_recepcion: {
        Args: {
          p_recepcion: string
        }
        Returns: string
      }
      confirmar_recepcion_interna: {
        Args: {
          p_recepcion: string
        }
        Returns: string
      }
      confirmar_salida_porteria: {
        Args: {
          p_entrega: string
        }
        Returns: string
      }
      costos_validar_orden: {
        Args: {
          p_orden_id: string
        }
        Returns: string
      }
      crear_etapas_ot: {
        Args: {
          p_orden_id: string
        }
        Returns: number
      }
      crear_personal: {
        Args: {
          p_nombres: string
          p_apellidos: string
          p_correo: string
          p_clave: string
          p_rol_id: string
          p_sede_id: string
          p_area_id?: string
          p_cargo?: string
          p_documento?: string
          p_telefono?: string
          p_es_operario?: boolean
          p_costo_hora?: number
        }
        Returns: string
      }
      dar_conformidad_servicio: {
        Args: {
          p_servicio: string
          p_observaciones?: string
          p_fecha?: string
        }
        Returns: string
      }
      datos_de_empresa: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      dias_habiles_entre: {
        Args: {
          p_desde: string
          p_hasta: string
        }
        Returns: number
      }
      documentos_obligatorios_faltantes: {
        Args: {
          p_orden_id: string
        }
        Returns: string[]
      }
      es_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      es_laborable: {
        Args: {
          p_fecha: string
        }
        Returns: boolean
      }
      es_usuario_activo: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      exigir_permiso: {
        Args: {
          p_permiso: string
        }
        Returns: string
      }
      firmar_documento: {
        Args: {
          p_aprobacion: string
          p_estado: string
          p_comentario?: string
        }
        Returns: string
      }
      generar_presupuesto_desde_cotizacion: {
        Args: {
          p_orden_id: string
          p_factor_costo?: number
          p_reemplazar?: boolean
        }
        Returns: number
      }
      informe_comercial: {
        Args: {
          p_desde: string
          p_hasta: string
        }
        Returns: string[]
      }
      informe_consumo_materiales: {
        Args: {
          p_desde: string
          p_hasta: string
        }
        Returns: string[]
      }
      informe_cumplimiento: {
        Args: {
          p_desde: string
          p_hasta: string
        }
        Returns: string[]
      }
      informe_produccion: {
        Args: {
          p_desde: string
          p_hasta: string
        }
        Returns: string[]
      }
      informe_rentabilidad: {
        Args: {
          p_desde: string
          p_hasta: string
        }
        Returns: string[]
      }
      informe_resumen: {
        Args: {
          p_desde: string
          p_hasta: string
        }
        Returns: string[]
      }
      informe_subcontratos: {
        Args: {
          p_desde: string
          p_hasta: string
        }
        Returns: string[]
      }
      kardex_registrar: {
        Args: {
          p_material: string
          p_almacen: string
          p_tipo: Database["public"]["Enums"]["tipo_movimiento_kardex"]
          p_cantidad: number
          p_costo_unitario?: number
          p_fecha?: string
          p_orden?: string
          p_etapa?: string
          p_lote?: string
          p_movimiento?: string
          p_referencia_tabla?: string
          p_referencia_id?: string
          p_usuario?: string
          p_observaciones?: string
        }
        Returns: string
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
      orden_de_ruta: {
        Args: {
          p_ruta: string
        }
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
          p_descripcion?: string
          p_datos?: Json
          p_etapa_id?: string
          p_usuario_id?: string
        }
        Returns: string
      }
      ot_registrar_evento_interna: {
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
      pascua: {
        Args: {
          p_anio: number
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
      prorratear_indirectos: {
        Args: {
          p_periodo: string
        }
        Returns: string[]
      }
      puede_ver_orden: {
        Args: {
          p_orden_id: string
        }
        Returns: boolean
      }
      recalcular_totales_cotizacion: {
        Args: {
          p_cotizacion: string
        }
        Returns: string
      }
      registrar_acceso_documento: {
        Args: {
          p_documento_id: string
          p_tipo_acceso: Database["public"]["Enums"]["tipo_acceso_documento"]
          p_version_id?: string
          p_ip?: string
          p_user_agent?: string
        }
        Returns: string
      }
      registrar_acceso_documento_interna: {
        Args: {
          p_documento_id: string
          p_tipo_acceso?: Database["public"]["Enums"]["tipo_acceso_documento"]
          p_version_id?: string
          p_ip?: string
          p_user_agent?: string
        }
        Returns: string
      }
      registrar_evento_ot: {
        Args: {
          p_orden_id: string
          p_tipo_evento: Database["public"]["Enums"]["tipo_evento_ot"]
          p_descripcion: string
          p_datos?: Json
        }
        Returns: string
      }
      restar_dias_habiles: {
        Args: {
          p_desde: string
          p_dias: number
        }
        Returns: string
      }
      sembrar_feriados: {
        Args: {
          p_anio: number
        }
        Returns: number
      }
      sembrar_verificacion: {
        Args: {
          p_codigo: string
          p_pasos: string[]
        }
        Returns: number
      }
      siguiente_correlativo: {
        Args: {
          p_tipo: Database["public"]["Enums"]["tipo_correlativo"]
          p_serie?: string
          p_sede?: string
        }
        Returns: string
      }
      solicitar_firmas: {
        Args: {
          p_documento: string
          p_aprobadores: string[]
        }
        Returns: number
      }
      sumar_dias_habiles: {
        Args: {
          p_desde: string
          p_dias: number
        }
        Returns: string
      }
      tarifa_vigente: {
        Args: {
          p_especialidad: Database["public"]["Enums"]["rol_operario"]
          p_fecha?: string
        }
        Returns: string
      }
      tiene_permiso: {
        Args: {
          p_codigo: string
        }
        Returns: boolean
      }
      tipo_cambio_costo: {
        Args: {
          p_moneda: Database["public"]["Enums"]["moneda"]
          p_fecha: string
          p_tipo_cambio?: number
        }
        Returns: number
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
      categoria_documento: "TECNICO" | "COMERCIAL" | "CALIDAD" | "LOGISTICO" | "ADMINISTRATIVO" | "LEGAL" | "FOTOGRAFICO"
      categoria_gasto_indirecto: "ENERGIA" | "AGUA" | "ALQUILER" | "DEPRECIACION" | "SUELDOS_INDIRECTOS" | "MANTENIMIENTO_PLANTA" | "SEGUROS" | "EPP" | "COMUNICACIONES" | "LIMPIEZA" | "OTRO"
      condicion_pago: "CONTADO" | "CREDITO_7" | "CREDITO_15" | "CREDITO_30" | "CREDITO_45" | "CREDITO_60" | "LETRAS"
      estado_aprobacion: "PENDIENTE" | "APROBADO" | "OBSERVADO" | "RECHAZADO"
      estado_cotizacion: "BORRADOR" | "EN_COSTEO" | "EN_REVISION" | "OBSERVADA" | "REVISADA" | "ENVIADA" | "APROBADA" | "RECHAZADA" | "VENCIDA" | "ANULADA"
      estado_documento: "VIGENTE" | "REEMPLAZADO" | "ANULADO"
      estado_etapa_ot: "PENDIENTE" | "EN_PROCESO" | "PAUSADA" | "TERMINADA" | "OMITIDA" | "REQUIERE_REVISION"
      estado_movimiento_almacen: "BORRADOR" | "CONFIRMADO" | "ANULADO"
      estado_orden_compra: "BORRADOR" | "APROBADA" | "ENVIADA" | "RECIBIDA_PARCIAL" | "RECIBIDA" | "ANULADA"
      estado_ot: "BORRADOR" | "APROBADA" | "PROGRAMADA" | "EN_PROCESO" | "PAUSADA" | "CONTROL_CALIDAD" | "TERMINADA" | "ENTREGADA" | "FACTURADA" | "ANULADA"
      estado_parte_diario: "BORRADOR" | "CERRADO" | "APROBADO"
      estado_requerimiento: "SOLICITADO" | "APROBADO" | "ATENDIDO_PARCIAL" | "ATENDIDO" | "RECHAZADO" | "ANULADO"
      estado_servicio_tercero: "SOLICITADO" | "EN_EJECUCION" | "EJECUTADO" | "CONFORME" | "PAGADO" | "ANULADO"
      estado_tarea_ot: "PENDIENTE" | "EN_PROCESO" | "TERMINADA" | "CANCELADA"
      magnitud_medida: "UNIDAD" | "MASA" | "LONGITUD" | "AREA" | "VOLUMEN"
      moneda: "PEN" | "USD"
      origen_presupuesto: "COTIZACION" | "MANUAL"
      prioridad_ot: "BAJA" | "NORMAL" | "ALTA" | "URGENTE"
      resultado_inspeccion: "CONFORME" | "OBSERVADO" | "RECHAZADO"
      rol_operario: "SOLDADOR" | "ARMADOR" | "PINTOR" | "ELECTRICISTA" | "AYUDANTE" | "MECANICO"
      tipo_acceso_documento: "VISTA" | "DESCARGA" | "IMPRESION" | "COMPARTIDO"
      tipo_almacen: "PRINCIPAL" | "OBRA" | "HERRAMIENTAS" | "MERMA"
      tipo_centro_costo: "PRODUCCION" | "ADMINISTRATIVO" | "VENTAS"
      tipo_correlativo: "COTIZACION" | "ORDEN_TRABAJO" | "REQUERIMIENTO" | "ORDEN_COMPRA" | "INGRESO_ALMACEN" | "SALIDA_ALMACEN" | "DEVOLUCION_ALMACEN" | "AJUSTE_INVENTARIO" | "PARTE_DIARIO" | "ACTA_CONFORMIDAD" | "INSPECCION_CALIDAD" | "TRANSFERENCIA_ALMACEN" | "RECEPCION_COMPRA" | "ORDEN_SERVICIO"
      tipo_costo: "MATERIAL" | "MANO_OBRA" | "SERVICIO" | "INDIRECTO" | "OTRO"
      tipo_costo_partida: "MATERIAL" | "MANO_OBRA" | "SERVICIO" | "OTRO"
      tipo_documento_cliente: "RUC" | "DNI" | "CE" | "PASAPORTE"
      tipo_evento_ot: "CREACION" | "CAMBIO_ESTADO" | "AVANCE" | "MATERIAL" | "DOCUMENTO" | "INSPECCION" | "PAUSA" | "REANUDACION" | "COMENTARIO" | "ENTREGA"
      tipo_movimiento_almacen: "INGRESO" | "SALIDA_OT" | "DEVOLUCION_OT" | "TRANSFERENCIA" | "AJUSTE" | "SALIDA_MERMA"
      tipo_movimiento_kardex: "INGRESO_COMPRA" | "INGRESO_DEVOLUCION" | "INGRESO_AJUSTE" | "INGRESO_TRANSFERENCIA" | "SALIDA_OT" | "SALIDA_AJUSTE" | "SALIDA_TRANSFERENCIA" | "SALIDA_MERMA"
      tipo_servicio_tercero: "ARENADO" | "CORTE_LASER" | "CORTE_PLASMA" | "DOBLADO" | "TORNO" | "GALVANIZADO" | "TRATAMIENTO_TERMICO" | "TAPICERIA" | "PINTURA" | "ELECTRICIDAD" | "HIDRAULICA" | "TRANSPORTE" | "CERTIFICACION" | "OTRO"
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
