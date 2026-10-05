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

  var resultado = slice.map(function(c) {
    var cliente = null, empleado = null, servicio = null;
    for (var i = 0; i < clientes.length;  i++) { if (clientes[i].id  === c.id_cliente)  { cliente  = clientes[i];  break; } }
    for (var j = 0; j < empleados.length; j++) { if (empleados[j].id === c.id_empleado) { empleado = empleados[j]; break; } }
    for (var k = 0; k < servicios.length; k++) { if (servicios[k].id === c.id_servicio) { servicio = servicios[k]; break; } }

    // Cruzar productos de la cita
    var prodsCita = [];
    if (c.productos && c.productos.length > 0) {
      prodsCita = c.productos.map(function(cp) {
        var prod = null;
        for (var p = 0; p < productos.length; p++) {
          if (productos[p].id === cp.id_producto) { prod = productos[p]; break; }
        }
return {
  ID_Cita         : c.id            || c.ID_Cita,
  ID_Cliente      : c.id_cliente    || c.ID_Cliente,
  ID_Empleado     : c.id_empleado   || c.ID_Empleado,
  ID_Servicio     : c.id_servicio   || c.ID_Servicio,
  Fecha           : _serializarFecha(c.fecha || c.Fecha),
  Hora            : _serializarHora(c.hora   || c.Hora),
  Estado          : c.estado        || c.Estado        || '',
  Forma_pago      : c.forma_pago    || c.Forma_pago    || '',
  Total           : c.total         || c.Total         || 0,
  Notas           : c.notas         || c.Notas         || '',
  ID_Agenda       : c.id_agenda     || c.ID_Agenda     || '',
  Nombre_Cliente  : cliente  ? (cliente.nombre_cliente  || cliente.Nombre_Cliente)  : '',
  Telefono        : cliente  ? (cliente.telefono        || cliente.Telefono)        : '',
  Nombre_Empleado : empleado ? (empleado.nombre_empleado|| empleado.Nombre_Empleado): '',
  Nombre_Servicio : servicio ? (servicio.nombre         || servicio.Nombre)         : '',
  Productos       : prodsCita
};
      });
    }

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
  // 1. Buscar o crear cliente
  var idCliente = agregarCliente(nombreCliente, telefono, '');
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