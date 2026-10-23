-- Los avisos de permiso ya no nombran puestos.
--
-- DKS objetó los avisos que, al negar algo, dicen qué puestos sí pueden
-- («Adquisiciones la ven Contabilidad, Tesorería y Logística»): no eran ciertos
-- y cambian cada vez que cambia un permiso, sin que nadie se acuerde de este
-- texto. La 20261022220000 arregló siete. Aquí van los demás: 49 avisos en 40
-- funciones pasan a la forma «No tienes permiso para <lo que se quiso hacer>.»,
-- que sigue siendo cierta aunque mañana el permiso lo tenga otro puesto.
--
-- Varios ya eran falsos, según los permisos de hoy:
--   * «Lo ve Tesorería», de las notas de crédito a favor: también las ven
--     Gerencia y Costos.
--   * «Las órdenes del taller las abre el supervisor o el jefe de producción»:
--     ese permiso lo tiene solo el jefe de producción.
--   * «El costo lo cierran Costos y Materiales o Administración»: también
--     Requerimientos y el jefe de maestranza.
--   * «Esto lo hace Recursos Humanos: el administrador lo ve, pero no lo
--     cambia» se le decía al administrador también al marcar la asistencia, que
--     es de Portería. Pasa a «No tienes permiso para cambiar esto: el
--     administrador lo ve, pero no lo cambia.»: sigue diciendo lo que DKS
--     decidió el 20 de octubre (el administrador mira y no cambia), sin nombrar
--     a nadie.
--   * Y otros del mismo tipo: «corresponde a Logística» donde Administración
--     también puede, «Solo Administración puede crear pasos de verificación»
--     donde también puede el jefe de maestranza, «Las cuentas de la planilla las
--     ve Tesorería» cuando también las ve Recursos Humanos.
--   * «Solo un administrador puede cambiar el rol, el área, la sede, el costo por
--     hora…» de una cuenta: el costo por hora tampoco lo cambia el administrador
--     desde el 20 de octubre, y al administrador se le decía otra cosa.
--
-- Lo que no se toca, y por qué:
--   * Los avisos donde la regla es el puesto mismo, escrito en el código:
--     programar las fechas de las etapas y corregir el vehículo y el responsable
--     de la OT (piden el rol de Administración), el conteo físico (el área de
--     Almacén), proponer materiales a Diseño (las áreas de Maestranza,
--     Producción y Acabados) y marcar la etapa de un código (Diseño o el
--     supervisor del área, que se saca del dato). Son ciertos mientras la
--     función no cambie; pasarlos a un permiso es decisión de gestión.
--   * «Solo el puesto que aprueba las compras puede …» (aprobar, rechazar y
--     anular compras y órdenes de servicio): no nombra un puesto, sale de la
--     regla de aprobación que se configura, y no se desactualiza.
--   * Las reglas del circuito que dicen a quién acudir: «pídele a Recursos
--     Humanos que lo anule», «La portería solo anula marcas de hoy: las de otros
--     días las anula Recursos Humanos», «Logística la anula primero, con su
--     motivo». No son un aviso de permiso: dicen cuál es el paso siguiente.
--   * El código de cada error: el banco y la aplicación distinguen por él (un
--     aviso de permiso responde 403 y uno sin código, 400). Cambia solo el texto.
--
-- compras_en_gestion y guias_por_emitir también cambian su select en la
-- 20261023110000, de esta misma rama. Los fragmentos no se pisan: aquella toca
-- la línea que nombra la OC y esta, el aviso. Cada uno está una sola vez en su
-- función y se reemplaza por su texto exacto, así que el orden entre las dos
-- migraciones da igual.
--
-- Cómo cambia cada función: igual que en la 20261022220000, no se copia entera.
-- Hay hilos que las cambiaron hace poco, y copiar una versión anterior les
-- quitaría eso. Se reemplaza solo el fragmento exacto. Si no está ni el viejo ni
-- el nuevo, la función cambió por otro lado: la migración se detiene sin tocar
-- nada, para revisarla a mano. Rehacer la función desde pg_get_functiondef
-- conserva security definer, su search_path y sus permisos de ejecución. Al
-- final se comprueba que ninguna función de la base diga todavía uno de los
-- textos viejos.

do $$
declare
  v_c       record;
  v_funcion text;
  v_def     text;
  v_antes   text;
  v_viejos  text[] := '{}';
  v_quedan  text;
begin
  for v_c in
    select * from (values
      (1, 'adjuntar_documento_servicio(uuid,uuid,text,text,text,text)',
       $v$'Los documentos de la orden de servicio los adjuntan Logística y Tesorería.'$v$,
       $v$'No tienes permiso para adjuntar documentos a la orden de servicio.'$v$),
      (2, 'anular_documento_servicio(uuid,text)',
       $v$'Los documentos de la orden de servicio los anulan Logística y Tesorería.'$v$,
       $v$'No tienes permiso para anular documentos de la orden de servicio.'$v$),
      (3, 'anular_documento_compra(uuid,text)',
       $v$'Anular un documento de compra corresponde a Logística.'$v$,
       $v$'No tienes permiso para anular documentos de compra.'$v$),
      (4, 'cargar_cronograma(uuid,jsonb)',
       $v$'El cronograma lo carga Diseño, el supervisor del área o el jefe.'$v$,
       $v$'No tienes permiso para cargar el cronograma.'$v$),
      (5, 'compras_en_gestion()',
       $v$'La gestión de compras la ven Logística y el conductor.'$v$,
       $v$'No tienes permiso para ver la gestión de compras.'$v$),
      (6, 'cotizaciones_para_facturar()',
       $v$'Las cotizaciones aprobadas las ven Administración, Gerencia, Contabilidad y Tesorería.'$v$,
       $v$'No tienes permiso para ver las cotizaciones aprobadas.'$v$),
      (7, 'guias_por_emitir()',
       $v$'Las guías de remisión las carga Contabilidad.'$v$,
       $v$'No tienes permiso para cargar guías de remisión.'$v$),
      (8, 'notas_credito_a_favor()',
       $v$'Lo ve Tesorería.'$v$,
       $v$'No tienes permiso para ver las notas de crédito a favor.'$v$),
      -- Las dos listas de lo que se paga con boleta las lee también quien solo mira
      -- (tesoreria.ver_documentos): por eso «ver», y no «pagar».
      (9, 'partes_con_boleta_por_pagar()',
       $v$'Las boletas de una parte las paga Tesorería.'$v$,
       $v$'No tienes permiso para ver las boletas de una parte por pagar.'$v$),
      (10, 'compras_con_boleta_por_pagar()',
       $v$'Las OC con boleta las paga Tesorería.'$v$,
       $v$'No tienes permiso para ver las OC con boleta por pagar.'$v$),
      (11, 'servicios_por_pagar()',
       $v$'Los pagos de servicio los lleva Tesorería.'$v$,
       $v$'No tienes permiso para ver los pagos de servicio.'$v$),
      (12, 'facturas_para_descontar(uuid)',
       $v$'Lo pagado de más lo descuenta Tesorería.'$v$,
       $v$'No tienes permiso para descontar lo pagado de más.'$v$),
      (13, 'facturas_para_la_nota(uuid)',
       $v$'Lo descuenta Tesorería.'$v$,
       $v$'No tienes permiso para descontar notas de crédito.'$v$),
      (14, 'planilla_diaria_cuentas(uuid)',
       $v$'Las cuentas de la planilla las ve Tesorería, que paga.'$v$,
       $v$'No tienes permiso para ver las cuentas de la planilla.'$v$),
      (15, 'ingresos_para_devolver()',
       $v$'Lo devuelve Almacén.'$v$,
       $v$'No tienes permiso para devolver al proveedor.'$v$),
      (16, 'dejar_de_esperar_reposicion(uuid,text)',
       $v$'Lo dice Almacén o Logística.'$v$,
       $v$'No tienes permiso para dejar de esperar la reposición.'$v$),
      (17, 'rrhh_dni_de_trabajadores()',
       $v$'El DNI del personal lo ve Recursos Humanos.'$v$,
       $v$'No tienes permiso para ver el DNI del personal.'$v$),
      (18, 'asistencia_buscar_por_dni(text)',
       $v$'La búsqueda por DNI es de la portería y de Recursos Humanos.'$v$,
       $v$'No tienes permiso para buscar por DNI.'$v$),
      -- La rama del administrador, aquí y en exigir_permiso_del_puesto, que la heredan las 34
      -- funciones que la llaman (rrhh_*, planilla diaria, reporte diario, marcar_asistencia).
      -- La rama de los demás («No tiene el permiso % …») no nombra puestos y no cambia.
      (19, 'anular_asistencia(uuid,text)',
       $v$'Las marcas las anula Recursos Humanos; la portería, solo las de hoy.'$v$,
       $v$'No tienes permiso para anular marcas de asistencia.'$v$),
      (20, 'anular_asistencia(uuid,text)',
       $v$'Esto lo hace Recursos Humanos: el administrador lo ve, pero no lo cambia.'$v$,
       $v$'No tienes permiso para cambiar esto: el administrador lo ve, pero no lo cambia.'$v$),
      (21, 'exigir_permiso_del_puesto(text)',
       $v$'Esto lo hace Recursos Humanos: el administrador lo ve, pero no lo cambia.'$v$,
       $v$'No tienes permiso para cambiar esto: el administrador lo ve, pero no lo cambia.'$v$),
      (22, 'fn_usuario_reservar_datos()',
       $v$'El DNI y el costo por hora de una cuenta los cambia Recursos Humanos.'$v$,
       $v$'No tienes permiso para cambiar el DNI ni el costo por hora de una cuenta.'$v$),
      (23, 'fn_usuario_reservar_datos_alta()',
       $v$'El DNI y el costo por hora de una cuenta los pone Recursos Humanos: da de alta la cuenta sin ellos.'$v$,
       $v$'No tienes permiso para poner el DNI ni el costo por hora de una cuenta: da de alta la cuenta sin ellos.'$v$),
      (24, 'anular_reporte_diario(uuid,text)',
       $v$'Solo quien subió el reporte o Recursos Humanos lo pueden anular.'$v$,
       $v$'No tienes permiso para anular este reporte.'$v$),
      (25, 'cerrar_costo_ot(uuid,text)',
       $v$'El costo lo cierran Costos y Materiales o Administración.'$v$,
       $v$'No tienes permiso para cerrar el costo de la OT.'$v$),
      (26, 'confirmar_igv_cotizacion(uuid,boolean)',
       $v$'Solo Ventas, Gerencia o Administración confirman si el precio de la cotización incluye IGV.'$v$,
       $v$'No tienes permiso para confirmar si el precio de la cotización incluye IGV.'$v$),
      (27, 'fijar_presupuesto_ot(uuid,numeric,text)',
       $v$'El presupuesto de una OT lo fijan Gerencia o Administración.'$v$,
       $v$'No tienes permiso para fijar el presupuesto de una OT.'$v$),
      (28, 'corregir_orden_servicio(uuid,text,text,text)',
       $v$'Corregir una orden de servicio corresponde a Logística, y su detracción también a Contabilidad.'$v$,
       $v$'No tienes permiso para corregir la orden de servicio.'$v$),
      (29, 'corregir_orden_servicio(uuid,text,text,text)',
       $v$'El código interno de la orden de servicio lo corrige Logística.'$v$,
       $v$'No tienes permiso para corregir el código interno de la orden de servicio.'$v$),
      (30, 'fn_cotizacion_pdf_revision()',
       $v$'La cotización la aprueba o la rechaza Gerencia.'$v$,
       $v$'No tienes permiso para aprobar ni rechazar la cotización.'$v$),
      (31, 'fn_ot_del_taller()',
       $v$'Las órdenes del taller las abre el supervisor o el jefe de producción.'$v$,
       $v$'No tienes permiso para abrir órdenes del taller.'$v$),
      (32, 'fn_ot_permiso_por_estado()',
       $v$'Marcar la orden como facturada es de la oficina.'$v$,
       $v$'No tienes permiso para marcar la orden como facturada.'$v$),
      (33, 'fn_proteger_control_vehicular()',
       $v$'Solo Costos y Materiales registra el control vehicular.'$v$,
       $v$'No tienes permiso para registrar el control vehicular.'$v$),
      (34, 'fn_reporte_revision()',
       $v$'Administración revisa los reportes de Supervisión.'$v$,
       $v$'No tienes permiso para revisar estos reportes.'$v$),
      (35, 'registrar_version_plano(uuid,uuid,uuid,text)',
       $v$'Solo Diseño puede adjuntar versiones de planos.'$v$,
       $v$'No tienes permiso para adjuntar versiones de planos.'$v$),
      -- «Requerimiento de Administración» es el tipo de documento, no un puesto. Se dice
      -- «corregir» porque rq_exigir también se llama con el paso CORREGIR.
      (36, 'rq_exigir(text,text)',
       $v$'No tienes permiso: este es un requerimiento de Administración y su orden de compra la hace la administradora.'$v$,
       $v$'No tienes permiso para hacer la orden de compra de un requerimiento de Administración.'$v$),
      (37, 'rq_exigir(text,text)',
       $v$'No tienes permiso: este es un requerimiento de operación y su orden de compra la hace Logística.'$v$,
       $v$'No tienes permiso para hacer la orden de compra de un requerimiento de operación.'$v$),
      (38, 'rq_exigir(text,text)',
       $v$'No tienes permiso: el requerimiento de Administración lo registra y lo anula la administradora.'$v$,
       $v$'No tienes permiso para registrar, corregir ni anular un requerimiento de Administración.'$v$),
      (39, 'rq_exigir(text,text)',
       $v$'No tienes permiso: el requerimiento de operación lo registra y lo anula el área de Requerimientos.'$v$,
       $v$'No tienes permiso para registrar, corregir ni anular un requerimiento de operación.'$v$),
      (40, 'fn_guardar_marcas_verificacion()',
       $v$'Solo Administración puede crear pasos de verificación.'$v$,
       $v$'No tienes permiso para crear pasos de verificación.'$v$),
      (41, 'fn_guardar_marcas_verificacion()',
       $v$'Solo Administración puede modificar los datos del paso.'$v$,
       $v$'No tienes permiso para modificar los datos del paso.'$v$),
      (42, 'fn_ot_etapa_responsabilidades()',
       $v$'Solo Diseño define las horas previstas de la etapa'$v$,
       $v$'No tienes permiso para definir las horas previstas de la etapa.'$v$),
      (43, 'fn_ot_etapa_responsabilidades()',
       $v$'Solo Diseño ordena las etapas de producción'$v$,
       $v$'No tienes permiso para ordenar las etapas de producción.'$v$),
      (44, 'fn_ot_etapa_responsabilidades()',
       $v$'Solo Producción registra el avance de las etapas'$v$,
       $v$'No tienes permiso para registrar el avance de las etapas.'$v$),
      -- En el flujo de hoy la regla de la tarea es el supervisor del área
      -- (puede_editar_tarea_ot), como en el Grupo G; pasa al estilo nuevo a propósito
      -- porque el texto sigue siendo cierto. La primera rama salta también al quitarla.
      (45, 'validar_editor_tarea_ot()',
       $v$'Solo Supervisión del área puede modificar esta tarea.'$v$,
       $v$'No tienes permiso para modificar ni quitar esta tarea.'$v$),
      (46, 'validar_editor_tarea_ot()',
       $v$'Solo Supervisión del área puede crear o modificar esta tarea.'$v$,
       $v$'No tienes permiso para crear ni modificar esta tarea.'$v$),
      -- Se dice «corregir» porque el disparador también salta cuando quien revisa cambia lo
      -- que se reportó.
      (47, 'validar_reporte_taller()',
       $v$'El reporte de la tarea corresponde al supervisor.'$v$,
       $v$'No tienes permiso para registrar ni corregir el reporte de la tarea.'$v$),
      -- Se va también el parámetro: sin su %, sobraría y la función no compilaría.
      (48, 'resolver_observacion_ot(uuid,text)',
       $v$'La resuelve %, quien la anotó o el jefe de producción.', v_ob.area$v$,
       $v$'No tienes permiso para resolver esta observación.'$v$),
      -- Los datos de la cuenta: pasa también quien tiene usuarios.gestionar, y el costo
      -- por hora ya no lo cambia el administrador (20 de octubre). La pista de lo que
      -- uno sí edita de su cuenta se queda como está.
      (49, 'fn_usuario_proteger_rol()',
       $v$'Solo un administrador puede cambiar el rol, el área, la sede, el costo por hora, el alcance o el estado de un usuario'$v$,
       $v$'No tienes permiso para cambiar estos datos de la cuenta.'$v$)
    ) as c(orden, funcion, viejo, nuevo)
    union all
    select null::integer, null, null, null  -- cierra la última función
    order by 1 nulls last
  loop
    if v_funcion is distinct from v_c.funcion then
      if v_funcion is not null and v_def <> v_antes then
        execute v_def;
      end if;
      exit when v_c.funcion is null;
      v_funcion := v_c.funcion;
      -- Sin los `\r` de un pegado desde Windows: el texto se compara línea por línea.
      v_def := replace(pg_get_functiondef(('public.' || v_funcion)::regprocedure), E'\r', '');
      v_antes := v_def;
    end if;
    v_viejos := v_viejos || v_c.viejo;
    if position(v_c.viejo in v_def) > 0 then
      v_def := replace(v_def, v_c.viejo, v_c.nuevo);
    elsif position(v_c.nuevo in v_def) = 0 then
      raise exception '% cambió: no tiene «%» como lo conoce el repositorio. Revisarla a mano antes de seguir.',
        v_funcion, left(v_c.viejo, 120);
    end if;
  end loop;

  -- Ninguna función de la base dice ya uno de los avisos viejos: ataja una que se
  -- haya saltado porque decía otra cosa, y otra que lo tenga copiado.
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_quedan
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and exists (select 1 from unnest(v_viejos) v where position(v in p.prosrc) > 0);
  if v_quedan is not null then
    raise exception 'Todavía nombran puestos en un aviso de permiso: %. Revisarlas a mano.', v_quedan;
  end if;
end $$;
