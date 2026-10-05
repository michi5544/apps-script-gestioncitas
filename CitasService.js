// ══════════════════════════════════════════════════════════
//  CITASSERVICE.GS — Citas
//  Fuente de datos: Firebase Firestore
// ══════════════════════════════════════════════════════════

// ── Helpers de serialización ──────────────────────────────
function _serializarFecha(valor) {
  if (!valor) return '';
  return String(valor).split('T')[0];
}

function _serializarHora(valor) {
  if (!valor) return '';
  return String(valor).substring(0, 5);
}

// ══════════════════════════════════════════════════════════
//  LEER CITAS
// ══════════════════════════════════════════════════════════
function obtenerCitas(filtroEstado, pagina, porPagina) {
  pagina    = pagina    || 1;
  porPagina = porPagina || 30;

  // Tablas de apoyo con caché
  var clientes  = getCacheData('clientes')  || fsGetAll('clientes');
  var empleados = getCacheData('empleados') || fsQuery('empleados', 'activo', 'EQUAL', true);
  var servicios = getCacheData('servicios') || fsQuery('servicios', 'activo', 'EQUAL', true);
  var productos = getCacheData('productos') || fsQuery('productos', 'activo', 'EQUAL', true);

  setCacheData('clientes',  clientes,  300);
  setCacheData('empleados', empleados, 300);
  setCacheData('servicios', servicios, 300);
  setCacheData('productos', productos, 300);

  // Citas siempre frescas
  var citas = filtroEstado
    ? fsQuery('citas', 'estado', 'EQUAL', filtroEstado)
    : fsGetAll('citas');

  // Ordenar por fecha_registro descendente
  citas.sort(function(a, b) {
    return String(b.fecha_registro) > String(a.fecha_registro) ? 1 : -1;
  });

  var total  = citas.length;
  var inicio = (pagina - 1) * porPagina;
  var slice  = citas.slice(inicio, inicio + porPagina);

  var porId = function(lista) {
    var m = {};
    lista.forEach(function(x) { m[x.id] = x; });
    return m;
  };
  var mapClientes  = porId(clientes);
  var mapEmpleados = porId(empleados);
  var mapServicios = porId(servicios);
  var mapProductos = porId(productos);

  var resultado = slice.map(function(c) {
    var cliente  = mapClientes[c.id_cliente]   || null;
    var empleado = mapEmpleados[c.id_empleado] || null;
    var servicio = mapServicios[c.id_servicio] || null;

    var prodsCita = (c.productos || []).map(function(cp) {
      var prod = mapProductos[cp.id_producto] || null;
      return {
        ID_Producto     : cp.id_producto,
        Cantidad        : cp.cantidad,
        Precio_unitario : cp.precio_unitario,
        Subtotal        : cp.subtotal,
        Titulo          : prod ? prod.titulo : ''
      };
    });

    return {
      ID_Cita         : c.id,
      ID_Cliente      : c.id_cliente,
      ID_Empleado     : c.id_empleado,
      ID_Servicio     : c.id_servicio,
      Fecha           : _serializarFecha(c.fecha),
      Hora            : _serializarHora(c.hora),
      Estado          : c.estado,
      Forma_pago      : c.forma_pago,
      Total           : c.total,
      Notas           : c.notas || '',
      ID_Agenda       : c.id_agenda,
      Nombre_Cliente  : cliente  ? cliente.nombre_cliente   : '',
      Telefono        : cliente  ? cliente.telefono         : '',
      Nombre_Empleado : empleado ? empleado.nombre_empleado : '',
      Nombre_Servicio : servicio ? servicio.nombre          : '',
      Productos       : prodsCita
    };
  });

  return {
    citas  : resultado,
    total  : total,
    pagina : pagina,
    hayMas : (inicio + porPagina) < total
  };
}

// ══════════════════════════════════════════════════════════
//  CREAR CITA
// ══════════════════════════════════════════════════════════
function crearCitaPublica(nombreCliente, telefono, idEmpleado, idServicio, idAgenda, fecha, hora, formaPago, productos) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return _crearCitaPublica(nombreCliente, telefono, idEmpleado, idServicio, idAgenda, fecha, hora, formaPago, productos);
  } finally {
    lock.releaseLock();
  }
}

function _crearCitaPublica(nombreCliente, telefono, idEmpleado, idServicio, idAgenda, fecha, hora, formaPago, productos) {
  // 0. Verificar que el horario siga disponible
  if (idAgenda) {
    var slot = fsGet('agenda', idAgenda);
    if (!slot || slot.disponible !== true) {
      throw new Error('El horario seleccionado ya no está disponible. Elige otro.');
    }
  }

  // 1. Buscar o crear cliente
  var idCliente  = agregarCliente(nombreCliente, telefono, '');
  var numeroCita = getNextCitaNumero();

  // 2. Calcular total
  var servicios = getCacheData('servicios') || fsQuery('servicios', 'activo', 'EQUAL', true);
  var prods     = getCacheData('productos') || fsQuery('productos', 'activo', 'EQUAL', true);

  var servicio = null;
  for (var i = 0; i < servicios.length; i++) {
    if (servicios[i].id === idServicio) { servicio = servicios[i]; break; }
  }
  var total = servicio ? Number(servicio.precio) : 0;

  var prodsCita = [];
  if (productos && productos.length > 0) {
    productos.forEach(function(p) {
      var prod = null;
      for (var j = 0; j < prods.length; j++) {
        if (prods[j].id === p.idProducto) { prod = prods[j]; break; }
      }
      var precioUnit = prod ? Number(prod.precio) : 0;
      var subtotal   = precioUnit * p.cantidad;
      total += subtotal;
      prodsCita.push({
        id_producto     : p.idProducto,
        cantidad        : p.cantidad,
        precio_unitario : precioUnit,
        subtotal        : subtotal
      });
    });
  }

  // 3. Crear cita en Firestore
var idCita = fsCreate('citas', {
  numero_cita     : numeroCita,
  id_cliente      : idCliente,
  id_empleado     : idEmpleado,
  id_servicio     : idServicio,
  id_agenda       : idAgenda,
  fecha           : fecha,
  hora            : hora,
  estado          : 'Pendiente',
  forma_pago      : formaPago,
  total           : total,
  notas           : '',
  fecha_registro  : getFechaLocal(),
  productos       : prodsCita
});

  // 4. Marcar horario como ocupado
  if (idAgenda) ocuparHorario(idAgenda);

return { id: idCita, numero: numeroCita };
}

// ══════════════════════════════════════════════════════════
//  CAMBIAR ESTADO
// ══════════════════════════════════════════════════════════
function cambiarEstadoCita(idCita, nuevoEstado) {
  var cita = fsGet('citas', idCita);
  if (!cita) throw new Error('Cita no encontrada: ' + idCita);
  if (cita.estado === 'Completada') {
    throw new Error('No se puede modificar una cita ya completada.');
  }

  fsUpdate('citas', idCita, { estado: nuevoEstado });

  if (nuevoEstado === 'Cancelada' && cita.id_agenda) {
    liberarHorario(cita.id_agenda);
  }
}

function cancelarCita(idCita) {
  cambiarEstadoCita(idCita, 'Cancelada');
}

// ══════════════════════════════════════════════════════════
//  PRODUCTOS DE UNA CITA
// ══════════════════════════════════════════════════════════
function obtenerProductosDeCita(idCita) {
  var cita = fsGet('citas', idCita);
  if (!cita || !cita.productos) return [];

  var productos = getCacheData('productos') || fsQuery('productos', 'activo', 'EQUAL', true);

  return cita.productos.map(function(cp) {
    var prod = null;
    for (var i = 0; i < productos.length; i++) {
      if (productos[i].id === cp.id_producto) { prod = productos[i]; break; }
    }
    return {
      ID_Producto     : cp.id_producto,
      Cantidad        : cp.cantidad,
      Precio_unitario : cp.precio_unitario,
      Subtotal        : cp.subtotal,
      Titulo          : prod ? prod.titulo : ''
    };
  });
}