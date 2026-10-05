// ══════════════════════════════════════════════════════════
//  FIREBASESERVICE.GS
// ══════════════════════════════════════════════════════════

function getProjectId() {
  return PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID');
}

function getFirestoreBaseUrl() {
  return 'https://firestore.googleapis.com/v1/projects/'
    + getProjectId() + '/databases/(default)/documents';
}

// ── Obtener token de acceso (cacheado ~55 min) ────────────
function getFirebaseToken() {
  var cache  = CacheService.getScriptCache();
  var cached = cache.get('FIREBASE_TOKEN');
  if (cached) return cached;

  var props       = PropertiesService.getScriptProperties();
  var clientEmail = props.getProperty('FIREBASE_CLIENT_EMAIL');
  var privateKey  = props.getProperty('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');

  var now     = Math.floor(Date.now() / 1000);
  var header  = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss  : clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud  : 'https://oauth2.googleapis.com/token',
    exp  : now + 3600,
    iat  : now
  }));

  var signInput = header + '.' + payload;
  var signature = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(signInput, privateKey)
  );
  var jwt = signInput + '.' + signature;

  var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method     : 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload    : 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt
  });

  var token = JSON.parse(response.getContentText()).access_token;
  cache.put('FIREBASE_TOKEN', token, 3300);
  return token;
}

// ── Petición a Firestore con validación de errores ────────
function fsFetch(url, opciones) {
  opciones = opciones || {};
  opciones.headers = { Authorization: 'Bearer ' + getFirebaseToken() };
  opciones.muteHttpExceptions = true;
  var response = UrlFetchApp.fetch(url, opciones);
  var codigo   = response.getResponseCode();
  if (codigo >= 400) {
    throw new Error('Firestore ' + codigo + ': ' + response.getContentText());
  }
  return JSON.parse(response.getContentText());
}

function fsDocToObj(doc) {
  var obj = fromFirestore(doc.fields);
  obj.id  = doc.name.split('/').pop();
  return obj;
}

// ── Convertir objeto JS → formato Firestore ───────────────
function toFirestore(obj) {
  var fields = {};
  Object.keys(obj).forEach(function(key) {
    var val = obj[key];
    if (val === null || val === undefined) {
      fields[key] = { nullValue: null };
    } else if (typeof val === 'boolean') {
      fields[key] = { booleanValue: val };
    } else if (typeof val === 'number') {
      fields[key] = { doubleValue: val };
    } else if (typeof val === 'string') {
      fields[key] = { stringValue: val };
    } else if (Array.isArray(val)) {
      fields[key] = { arrayValue: { values: val.map(function(v) {
        if (typeof v === 'object' && v !== null) {
          return { mapValue: { fields: toFirestore(v) } };
        }
        return toFirestore({ v: v }).v;
      })}};
    } else if (typeof val === 'object') {
      fields[key] = { mapValue: { fields: toFirestore(val) } };
    }
  });
  return fields;
}

// ── Convertir formato Firestore → objeto JS ───────────────
function fromFirestore(fields) {
  if (!fields) return {};
  var obj = {};
  Object.keys(fields).forEach(function(key) {
    var f = fields[key];
    if      (f.stringValue  !== undefined) obj[key] = f.stringValue;
    else if (f.doubleValue  !== undefined) obj[key] = f.doubleValue;
    else if (f.integerValue !== undefined) obj[key] = Number(f.integerValue);
    else if (f.booleanValue !== undefined) obj[key] = f.booleanValue;
    else if (f.nullValue    !== undefined) obj[key] = null;
    else if (f.arrayValue   !== undefined) {
      obj[key] = (f.arrayValue.values || []).map(function(v) {
        if (v.mapValue) return fromFirestore(v.mapValue.fields);
        return fromFirestore({ v: v }).v;
      });
    } else if (f.mapValue !== undefined) {
      obj[key] = fromFirestore(f.mapValue.fields);
    }
  });
  return obj;
}

// ── CRUD genérico ─────────────────────────────────────────
function fsGet(coleccion, id) {
  var url      = getFirestoreBaseUrl() + '/' + coleccion + '/' + id;
  var response = UrlFetchApp.fetch(url, {
    headers            : { Authorization: 'Bearer ' + getFirebaseToken() },
    muteHttpExceptions : true
  });
  if (response.getResponseCode() === 404) return null;
  if (response.getResponseCode() >= 400) {
    throw new Error('Firestore ' + response.getResponseCode() + ': ' + response.getContentText());
  }
  var doc = JSON.parse(response.getContentText());
  return doc.fields ? fsDocToObj(doc) : null;
}

function fsGetAll(coleccion) {
  var resultado = [];
  var pageToken = '';
  do {
    var url  = getFirestoreBaseUrl() + '/' + coleccion + '?pageSize=300'
             + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var data = fsFetch(url);
    (data.documents || []).forEach(function(doc) {
      resultado.push(fsDocToObj(doc));
    });
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return resultado;
}

function fsCreate(coleccion, datos) {
  var id  = Utilities.getUuid();
  var url = getFirestoreBaseUrl() + '/' + coleccion + '/' + id;
  fsFetch(url, {
    method      : 'patch',
    contentType : 'application/json',
    payload     : JSON.stringify({ fields: toFirestore(datos) })
  });
  return id;
}

function fsUpdate(coleccion, id, datos) {
  var fields = toFirestore(datos);

  // updateMask: solo se actualizan los campos enviados
  var maskParams = Object.keys(fields).map(function(k) {
    return 'updateMask.fieldPaths=' + encodeURIComponent(k);
  }).join('&');

  var url = getFirestoreBaseUrl() + '/' + coleccion + '/' + id + '?' + maskParams;
  fsFetch(url, {
    method      : 'patch',
    contentType : 'application/json',
    payload     : JSON.stringify({ fields: fields })
  });
}

function fsDelete(coleccion, id) {
  fsFetch(getFirestoreBaseUrl() + '/' + coleccion + '/' + id, { method: 'delete' });
}

// Escritura masiva (hasta 500 docs por lote): docs = [{ coleccion, datos }]
function fsCreateBatch(docs) {
  var base   = getFirestoreBaseUrl();
  var nombre = base.replace('https://firestore.googleapis.com/v1/', '');
  var ids    = [];
  for (var i = 0; i < docs.length; i += 500) {
    var writes = docs.slice(i, i + 500).map(function(d) {
      var id = Utilities.getUuid();
      ids.push(id);
      return { update: { name: nombre + '/' + d.coleccion + '/' + id, fields: toFirestore(d.datos) } };
    });
    fsFetch(base + ':commit', {
      method      : 'post',
      contentType : 'application/json',
      payload     : JSON.stringify({ writes: writes })
    });
  }
  return ids;
}

function fsQuery(coleccion, campo, operador, valor) {
  var tipoValor = typeof valor === 'boolean' ? { booleanValue: valor }
                : typeof valor === 'number'  ? { doubleValue: valor }
                : { stringValue: String(valor) };

  var results = fsFetch(getFirestoreBaseUrl() + ':runQuery', {
    method      : 'post',
    contentType : 'application/json',
    payload     : JSON.stringify({
      structuredQuery: {
        from  : [{ collectionId: coleccion }],
        where : { fieldFilter: { field: { fieldPath: campo }, op: operador, value: tipoValor } }
      }
    })
  });

  return results
    .filter(function(r) { return r.document; })
    .map(function(r) { return fsDocToObj(r.document); });
}
