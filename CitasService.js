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
var FORMAS_PAGO = ['Efectivo', 'Tarjeta', 'Transferencia'];

function _validarDatosCita(nombre, telefono, idEmpleado, idServicio, fecha, hora, formaPago, productos) {
  nombre = String(nombre || '').trim();
  if (nombre.length < 2 || nombre.length > 100) throw new Error('Nombre inválido.');

  var tel = String(telefono || '').replace(/[\s-]/g, '');
  if (!/^\+?\d{8,15}$/.test(tel)) throw new Error('Teléfono inválido.');

  if (!idEmpleado || !idServicio) throw new Error('Selecciona empleado y servicio.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha)))  throw new Error('Fecha inválida.');
  if (!/^\d{2}:\d{2}/.test(String(hora)))          throw new Error('Hora inválida.');
  if (FORMAS_PAGO.indexOf(formaPago) === -1)        throw new Error('Forma de pago inválida.');

  (productos || []).forEach(function(p) {
    var cant = Number(p.cantidad);
    if (!p.idProducto || !(cant >= 1) || cant % 1 !== 0 || cant > 99) {
      throw new Error('Cantidad de producto inválida.');
    }
  });

  return { nombre: nombre, telefono: tel };
}

function crearCitaPublica(nombreCliente, telefono, idEmpleado, idServicio, idAgenda, fecha, hora, formaPago, productos) {
  var datos = _validarDatosCita(nombreCliente, telefono, idEmpleado, idServicio, fecha, hora, formaPago, productos);

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return _crearCitaPublica(datos.nombre, datos.telefono, idEmpleado, idServicio, idAgenda, fecha, hora, formaPago, productos || []);
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

  // 1. Validar servicio y calcular total con precios del servidor
  var servicio = fsGet('servicios', idServicio);
  if (!servicio || servicio.activo !== true) throw new Error('El servicio seleccionado no existe.');
  var total = Number(servicio.precio) || 0;

  // 2. Productos: verificar stock actual (sin caché) y precios
  var prodsCita = [];
  var stockNuevo = [];
  productos.forEach(function(p) {
    var prod = fsGet('productos', p.idProducto);
    if (!prod || prod.activo !== true) throw new Error('Un producto seleccionado no existe.');
    var cantidad = Number(p.cantidad);
    if (Number(prod.cantidad_stock) < cantidad) {
      throw new Error('Stock insuficiente de "' + prod.titulo + '" (quedan ' + prod.cantidad_stock + ').');
    }
    var precioUnit = Number(prod.precio) || 0;
    var subtotal   = precioUnit * cantidad;
    total += subtotal;
    prodsCita.push({
      id_producto     : p.idProducto,
      cantidad        : cantidad,
      precio_unitario : precioUnit,
      subtotal        : subtotal
    });
    stockNuevo.push({ id: p.idProducto, stock: Number(prod.cantidad_stock) - cantidad });
  });

  // 3. Cliente, número y cita
  var idCliente  = agregarCliente(nombreCliente, telefono, '');
  var numeroCita = getNextCitaNumero();

  var idCita = fsCreate('citas', {
    numero_cita     : numeroCita,
    id_cliente      : idCliente,
    id_empleado     : idEmpleado,
    id_servicio     : idServicio,
    id_agenda       : idAgenda || '',
    fecha           : fecha,
    hora            : hora,
    estado          : 'Pendiente',
    forma_pago      : formaPago,
    total           : total,
    notas           : '',
    fecha_registro  : getFechaLocal(),
    productos       : prodsCita
  });

  // 4. Descontar stock y ocupar horario
  stockNuevo.forEach(function(s) { fsUpdate('productos', s.id, { cantidad_stock: s.stock }); });
  if (stockNuevo.length > 0) setCacheData('productos', null);
  if (idAgenda) ocuparHorario(idAgenda);

  return { id: idCita, numero: numeroCita };
}

// ══════════════════════════════════════════════════════════
//  CAMBIAR ESTADO
// ══════════════════════════════════════════════════════════
var ESTADOS_CITA = ['Pendiente', 'Confirmada', 'Completada', 'Cancelada'];

function cambiarEstadoCita(idCita, nuevoEstado) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var cita = fsGet('citas', idCita);
    if (!cita) throw new Error('Cita no encontrada: ' + idCita);
    if (cita.estado === 'Completada') {
      throw new Error('No se puede modificar una cita ya completada.');
    }
    if (cita.estado === 'Cancelada') {
      throw new Error('No se puede modificar una cita cancelada.');
    }
    if (ESTADOS_CITA.indexOf(nuevoEstado) === -1) {
      throw new Error('Estado inválido: ' + nuevoEstado);
    }

    fsUpdate('citas', idCita, { estado: nuevoEstado });

    if (nuevoEstado === 'Cancelada') {
      if (cita.id_agenda) liberarHorario(cita.id_agenda);
      // Devolver stock de productos reservados
      (cita.productos || []).forEach(function(cp) {
        var prod = fsGet('productos', cp.id_producto);
        if (prod) {
          fsUpdate('productos', cp.id_producto, {
            cantidad_stock: Number(prod.cantidad_stock) + Number(cp.cantidad)
          });
        }
      });
      setCacheData('productos', null);
    }
  } finally {
    lock.releaseLock();
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