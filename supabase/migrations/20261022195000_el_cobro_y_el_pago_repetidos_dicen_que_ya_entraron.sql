-- El cobro, los pagos, la factura de venta y el recibo repetidos dicen que ya
-- entraron la primera vez, como los demás envíos repetidos.
--
-- `20261022160000` hizo que un reintento con el mismo id y otro archivo se
-- rechazara en vez de darse por bueno, con un aviso «… ya quedó registrado con
-- otro voucher: recarga la pantalla para verlo». La ruta del archivo es nueva
-- en cada envío aunque la persona elija el mismo, así que «con otro voucher»
-- no siempre es cierto: lo que la base sí sabe es que ese envío ya entró la
-- primera vez. La rama del PR #148 cambió el texto dentro de la 160000 después
-- de que esa versión ya se había aplicado en producción (2026-10-22), y una
-- migración aplicada no se vuelve a pegar: el cambio va aquí.
--
-- El texto nuevo es el que la pantalla reconoce (`yaEntroLaPrimeraVez`): la
-- ventana no lo pinta en rojo, solo ofrece «Cerrar» y, al cerrarla, la
-- pantalla de detrás se pone al día. Con el texto viejo salía en rojo y con el
-- botón activo, y parecía que faltaba algo. El contrato del subcontrato sigue
-- diciendo «con otro archivo»: va a la ruta fija de su ventana, y es lo que pasó.
--
-- Cada función se reescribe desde su definición vigente cambiando solo ese
-- texto. Si ya está, se salta; si el texto viejo no está exactamente una vez,
-- se detiene en vez de adivinar. Después de esta, volver a pegar la 160000 se
-- detiene en su guarda sin tocar nada: ya no reconoce estas siete funciones.
do $$
declare
  v_cambio record;
  v_def    text;
begin
  for v_cambio in
    select * from (values
      ('registrar_cobro_factura(uuid,uuid,date,numeric,boolean,text,text,uuid,numeric)',
       'Ese cobro ya quedó registrado con otro voucher: recarga la pantalla para verlo.',
       'Este cobro ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.'),
      ('registrar_pago_factura(uuid,uuid,date,numeric,text,text,uuid,numeric)',
       'Ese pago ya quedó registrado con otro comprobante: recarga la pantalla para verlo.',
       'Este pago ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.'),
      ('registrar_pago_servicio(uuid,uuid,date,numeric,boolean,text,text,text,uuid,numeric)',
       'Ese pago ya quedó registrado con otro comprobante: recarga la pantalla para verlo.',
       'Este pago ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.'),
      ('registrar_pago_recibo_honorarios(uuid,uuid,date,text,text,uuid,numeric)',
       'Ese pago ya quedó registrado con otro voucher: recarga la pantalla para verlo.',
       'Este pago ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.'),
      ('registrar_pago_planilla_diaria(uuid,uuid,uuid[],date,text,text,uuid,numeric)',
       'Ese pago ya quedó registrado con otro comprobante: recarga la pantalla para verlo.',
       'Este pago ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.'),
      ('registrar_factura_venta(uuid,uuid,text,date,date,text,numeric,text,text,text)',
       'Esa factura ya quedó registrada con otro PDF: recarga la pantalla para verla.',
       'Esta factura ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.'),
      ('registrar_recibo_honorarios(uuid,uuid,text,date,text,numeric,boolean,text)',
       'Ese recibo ya quedó registrado con otro archivo: recarga la pantalla para verlo.',
       'Este recibo ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.')
    ) as c(funcion, viejo, nuevo)
  loop
    v_def := replace(pg_get_functiondef(('public.' || v_cambio.funcion)::regprocedure), E'\r', '');
    if position(v_cambio.nuevo in v_def) > 0 then
      continue;  -- ya estaba
    end if;
    if (char_length(v_def) - char_length(replace(v_def, v_cambio.viejo, ''))) / char_length(v_cambio.viejo) <> 1 then
      raise exception '% cambió: su aviso del envío repetido no está como lo conoce el repositorio. Revisarla a mano antes de seguir.', v_cambio.funcion;
    end if;
    execute replace(v_def, v_cambio.viejo, v_cambio.nuevo);
  end loop;
end $$;
