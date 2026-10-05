// ══════════════════════════════════════════════════════════
//  DATASERVICE.GS — Servicios · Productos · Empleados · Clientes
//  Fuente de datos: Firebase Firestore
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
//  SERVICIOS
// ══════════════════════════════════════════════════════════
function obtenerServicios() {
  var cached = getCacheData('servicios');
  if (cached) return cached;
  var data = fsQuery('servicios', 'activo', 'EQUAL', true);
  setCacheData('servicios', data, 300);
  return data;
}

function agregarServicio(nombre, descripcion, duracion, precio, cantidad) {
  var id = fsCreate('servicios', {
    nombre              : nombre,
    descripcion         : descripcion,
    duracion_min        : Number(duracion),
    precio              : Number(precio),
    cantidad_disponible : Number(cantidad),
    activo              : true
  });
  setCacheData('servicios', null, 1);
  return id;
}

function editarServicio(id, nombre, descripcion, duracion, precio, cantidad) {
  fsUpdate('servicios', id, {
    nombre              : nombre,
    descripcion         : descripcion,
    duracion_min        : Number(duracion),
    precio              : Number(precio),
    cantidad_disponible : Number(cantidad)
  });
  setCacheData('servicios', null, 1);
}

function eliminarServicio(id) {
  fsUpdate('servicios', id, { activo: false });
  setCacheData('servicios', null, 1);
}

// ══════════════════════════════════════════════════════════
//  PRODUCTOS
// ══════════════════════════════════════════════════════════
function obtenerProductos() {
  var cached = getCacheData('productos');
  if (cached) return cached;
  var data = fsQuery('productos', 'activo', 'EQUAL', true);
  setCacheData('productos', data, 300);
  return data;
}

function agregarProducto(titulo, subtitulo, descripcion, cantidadStock, precio) {
  var id = fsCreate('productos', {
    titulo         : titulo,
    sub_titulo     : subtitulo || '',
    descripcion    : descripcion || '',
    cantidad_stock : Number(cantidadStock),
    precio         : Number(precio),
    activo         : true
  });
  setCacheData('productos', null, 1);
  return id;
}

function editarProducto(id, titulo, subtitulo, descripcion, cantidadStock, precio) {
  fsUpdate('productos', id, {
    titulo         : titulo,
    sub_titulo     : subtitulo || '',
    descripcion    : descripcion || '',
    cantidad_stock : Number(cantidadStock),
    precio         : Number(precio)
  });
  setCacheData('productos', null, 1);
}

function eliminarProducto(id) {
  fsUpdate('productos', id, { activo: false });
  setCacheData('productos', null, 1);
}

// ══════════════════════════════════════════════════════════
//  EMPLEADOS
// ══════════════════════════════════════════════════════════
function obtenerEmpleados() {
  var cached = getCacheData('empleados');
  if (cached) return cached;
  var data = fsQuery('empleados', 'activo', 'EQUAL', true);
  setCacheData('empleados', data, 300);
  return data;
}

function agregarEmpleado(nombre, especialidad, telefono) {
  var id = fsCreate('empleados', {
    nombre_empleado : nombre,
    especialidad    : especialidad || '',
    telefono        : telefono || '',
    activo          : true
  });
  setCacheData('empleados', null, 1);
  return id;
}

function editarEmpleado(id, nombre, especialidad, telefono) {
  fsUpdate('empleados', id, {
    nombre_empleado : nombre,
    especialidad    : especialidad || '',
    telefono        : telefono || ''
  });
  setCacheData('empleados', null, 1);
}

function eliminarEmpleado(id) {
  fsUpdate('empleados', id, { activo: false });
  setCacheData('empleados', null, 1);
}

// ══════════════════════════════════════════════════════════
//  CLIENTES
// ══════════════════════════════════════════════════════════
function obtenerClientes() {
  var cached = getCacheData('clientes');
  if (cached) return cached;
  var data = fsGetAll('clientes');
  setCacheData('clientes', data, 300);
  return data;
}

function buscarClientePorTelefono(telefono) {
  var resultado = fsQuery('clientes', 'telefono', 'EQUAL', String(telefono));
  if (resultado.length > 0) return resultado[0];
  return null;
}

function agregarCliente(nombre, telefono, email) {
  var tel       = String(telefono).trim();
  var existente = buscarClientePorTelefono(tel);
  if (existente) {
    // Mismo teléfono: se conserva el cliente pero se actualiza el nombre si cambió
    var nombreNuevo = String(nombre || '').trim();
    if (nombreNuevo && nombreNuevo !== existente.nombre_cliente) {
      fsUpdate('clientes', existente.id, { nombre_cliente: nombreNuevo });
      setCacheData('clientes', null);
    }
    return existente.id;
  }

  var id = fsCreate('clientes', {
    nombre_cliente  : String(nombre),
    telefono        : tel,
    email           : String(email || ''),
    fecha_registro  : getFechaLocal()
  });
  setCacheData('clientes', null, 1);
  return id;
}

function editarCliente(id, nombre, telefono, email) {
  Logger.log('editarCliente llamado con id: ' + id);
  fsUpdate('clientes', id, {
    nombre_cliente : String(nombre),
    telefono       : String(telefono),
    email          : String(email || '')
  });
  setCacheData('clientes', null, 1);
}