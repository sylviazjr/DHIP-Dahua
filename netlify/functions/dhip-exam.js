// Netlify Function — Examen DHIP (registro centralizado, validación cruzada de dispositivos)
const ADMIN_EMAIL = 'sylviazjr@gmail.com';
const MAX_ATTEMPTS = 2;
const STORE_NAME = 'dhip_exam_records';

async function getStore() {
  const { getStore } = require('@netlify/blobs');
  return getStore(STORE_NAME);
}

async function loadAll(store) {
  try {
    const data = await store.get('data', { type: 'json' });
    return data || [];
  } catch (e) {
    return [];
  }
}

async function saveAll(store, records) {
  await store.set('data', JSON.stringify(records), { metadata: { updated: new Date().toISOString() } });
}

// Huella de integridad (evita manipulación de registros)
function makeHash(r) {
  const s = `${r.nombre}|${r.email}|${r.pais}|${r.puntaje}|${r.fecha}|DHIP2026`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
  return Math.abs(h).toString(36);
}

exports.handler = async (event) => {
  try {
   const store = getStore({
  name: process.env.NETLIFY_BLOBS_STORE_NAME || 'dhip_exam_records',
  siteID: process.env.NETLIFY_BLOBS_SITE_ID,
  token: process.env.NETLIFY_BLOBS_TOKEN
});
    const params = new URLSearchParams(event.rawQuery);
    const action = params.get('action');

    // 1) Verificar intentos (por nombre O correo, válido en cualquier dispositivo)
    if (action === 'check') {
      const nombre = (params.get('name') || '').trim();
      const email = (params.get('email') || '').trim().toLowerCase();
      if (!nombre || !email) {
        return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Datos incompletos' }) };
      }
      const records = await loadAll(store);
      const attempts = records.filter(r =>
        (r.email || '').toLowerCase() === email ||
        (r.nombre || '').trim().toLowerCase() === nombre.toLowerCase()
      ).length;
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, attempts, exceeded: attempts >= MAX_ATTEMPTS })
      };
    }

    // 2) Enviar / guardar un nuevo intento
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { nombre, email, pais, puntaje, estado, auto } = body;
      if (!nombre || !email || !pais || puntaje === undefined) {
        return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Datos incompletos' }) };
      }
      const records = await loadAll(store);
      const samePerson = records.filter(r =>
        (r.email || '').toLowerCase() === email.toLowerCase() ||
        (r.nombre || '').trim().toLowerCase() === nombre.toLowerCase()
      ).length;

      if (samePerson >= MAX_ATTEMPTS) {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: false, error: 'Límite de 2 intentos alcanzado' })
        };
      }

      const fecha = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
      const newRec = {
        nombre: nombre.trim(),
        email: email.trim(),
        pais: pais.trim(),
        puntaje: Number(puntaje),
        estado: estado || 'REPROBADO',
        intento: samePerson + 1,
        auto: !!auto,
        fecha,
        hash: makeHash({ nombre, email, pais, puntaje, fecha })
      };
      records.push(newRec);
      await saveAll(store, records);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, attempts: newRec.intento, remaining: MAX_ATTEMPTS - newRec.intento })
      };
    }

    // 3) Exportar TODOS los registros (solo administrador)
    if (action === 'export') {
      const email = (params.get('email') || '').trim().toLowerCase();
      if (email !== ADMIN_EMAIL.toLowerCase()) {
        return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'No autorizado' }) };
      }
      const records = await loadAll(store);
      const clean = records.map(({ hash, ...r }) => r);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, records: clean })
      };
    }

    return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false }) };
  } catch (e) {
    console.error('dhip-exam error:', e);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Error del servidor' }) };
  }
};
