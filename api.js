// Capa de datos del Aula Point: todas las llamadas a Supabase pasan por acá.
// Los permisos reales los controla la base (RLS); esto solo arma las consultas.
import { createClient } from './vendor/supabase.js'; // supabase-js 2.119.2 empaquetado
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const configurado = !SUPABASE_URL.startsWith('PEGAR') && !SUPABASE_KEY.startsWith('PEGAR');
const sb = configurado ? createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
}) : null;

const ok = ({ data, error }) => { if (error) throw traducir(error); return data; };
function traducir(e) {
  const m = e?.message || String(e);
  if (/row-level security|permission denied/i.test(m)) return new Error('No tenés permiso para hacer esto.');
  if (/responsable_si_menor/.test(m)) return new Error('Si el alumno es menor, completá el nombre y WhatsApp del adulto responsable.');
  if (/link_(meet|grabacion)_check/.test(m)) return new Error('Los links tienen que empezar con https://');
  if (/duplicate key/i.test(m)) return new Error('Eso ya existe.');
  if (/Payload too large|exceeded the maximum/i.test(m)) return new Error('El archivo es muy pesado.');
  if (/mime type/i.test(m)) return new Error('Ese tipo de archivo no está permitido. Usá PDF, foto o Word.');
  return new Error(m);
}
let uid = null;

// ---------------- Sesión ----------------
export async function sesion() {
  const { data } = await sb.auth.getSession();
  uid = data.session?.user?.id ?? null;
  return data.session;
}
export function alCambiarSesion(cb) {
  sb.auth.onAuthStateChange((evento, s) => { uid = s?.user?.id ?? null; cb(evento, s); });
}
const urlRegreso = () => location.origin + location.pathname;
export const entrarConGoogle = async () =>
  ok(await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: urlRegreso(), queryParams: { prompt: 'select_account' } } }));
export const entrarConMail = async (email) =>
  ok(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: urlRegreso() } }));
export const salir = async () => { await sb.auth.signOut(); uid = null; };

// ---------------- Perfil e inscripción ----------------
export const miPerfil = async () => ok(await sb.from('perfiles').select('*').eq('id', uid).single());

export async function guardarMisDatos(d) {
  const campos = (({ nombre, apellido, whatsapp, nivel, curso, modalidad, es_menor, responsable_nombre, responsable_whatsapp, comentario }) =>
    ({ nombre, apellido, whatsapp, nivel, curso, modalidad, es_menor, responsable_nombre, responsable_whatsapp, comentario }))(d);
  if (!campos.es_menor) { campos.responsable_nombre = null; campos.responsable_whatsapp = null; }
  return ok(await sb.from('perfiles').update(campos).eq('id', uid).select().single());
}

export const materiasActivas = async () =>
  ok(await sb.from('materias').select('*').eq('activa', true).order('orden'));

export const misSolicitudes = async () =>
  ok(await sb.from('solicitudes').select('materia_id').eq('alumno_id', uid)).map((r) => r.materia_id);

export async function guardarSolicitudes(ids) {
  const actuales = await misSolicitudes();
  const sacar = actuales.filter((x) => !ids.includes(x));
  const poner = ids.filter((x) => !actuales.includes(x));
  if (sacar.length) ok(await sb.from('solicitudes').delete().eq('alumno_id', uid).in('materia_id', sacar));
  if (poner.length) ok(await sb.from('solicitudes').insert(poner.map((materia_id) => ({ alumno_id: uid, materia_id }))));
}

// ---------------- Materias ----------------
// Alumno: en las que está inscripto. Profe / admin: las que da.
export async function misMaterias(perfil) {
  if (perfil.rol === 'alumno') {
    const filas = ok(await sb.from('inscripciones').select('materia_id').eq('alumno_id', uid).eq('activa', true));
    if (!filas.length) return [];
    return ok(await sb.from('materias').select('*').in('id', filas.map((f) => f.materia_id)).order('orden'));
  }
  const filas = ok(await sb.from('materia_profes').select('materia_id').eq('profe_id', uid));
  if (!filas.length) return [];
  return ok(await sb.from('materias').select('*').in('id', filas.map((f) => f.materia_id)).order('orden'));
}
export const materia = async (id) => ok(await sb.from('materias').select('*').eq('id', id).single());
export const profesDe = async (materiaIds) =>
  materiaIds.length ? ok(await sb.from('profes_publicos').select('*').in('materia_id', materiaIds)) : [];

// ---------------- Clases ----------------
export const clases = async (materiaIds) =>
  materiaIds.length ? ok(await sb.from('clases').select('*').in('materia_id', materiaIds).order('fecha_hora', { ascending: false, nullsFirst: false })) : [];
export async function crearClase(c, archivo) {
  const fila = { ...c };
  if (archivo) fila.material_path = await subir('materiales', String(c.materia_id), archivo);
  return ok(await sb.from('clases').insert(fila).select().single());
}
export async function editarClase(clase, c, archivo, quitarMaterial = false) {
  const fila = { ...c };
  if (archivo) fila.material_path = await subir('materiales', String(clase.materia_id), archivo);
  else if (quitarMaterial) fila.material_path = null;
  const r = ok(await sb.from('clases').update(fila).eq('id', clase.id).select().single());
  if ((archivo || quitarMaterial) && clase.material_path) await sb.storage.from('materiales').remove([clase.material_path]);
  return r;
}
export async function borrarClase(clase) {
  ok(await sb.from('clases').delete().eq('id', clase.id));
  if (clase.material_path) await sb.storage.from('materiales').remove([clase.material_path]);
}

// ---------------- Archivos ----------------
const limpio = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80);
async function subir(bucket, carpeta, archivo) {
  const path = `${carpeta}/${Date.now()}-${limpio(archivo.name)}`;
  ok(await sb.storage.from(bucket).upload(path, archivo, { contentType: archivo.type || undefined, upsert: false }));
  return path;
}
export async function urlArchivo(bucket, path) {
  const d = ok(await sb.storage.from(bucket).createSignedUrl(path, 3600));
  return d.signedUrl;
}

// ---------------- Tareas ----------------
export const tarea = async (id) => ok(await sb.from('tareas').select('*').eq('id', id).single());
export const tareas = async (materiaIds) =>
  materiaIds.length ? ok(await sb.from('tareas').select('*').in('materia_id', materiaIds).order('fecha_entrega', { ascending: true, nullsFirst: false })) : [];
export async function crearTarea(t, archivo) {
  const fila = { ...t };
  if (archivo) fila.adjunto_path = await subir('materiales', String(t.materia_id), archivo);
  return ok(await sb.from('tareas').insert(fila).select().single());
}
export async function borrarTarea(t) {
  ok(await sb.from('tareas').delete().eq('id', t.id));
  if (t.adjunto_path) await sb.storage.from('materiales').remove([t.adjunto_path]);
}

// ---------------- Entregas ----------------
export const misEntregas = async () => ok(await sb.from('entregas').select('*').eq('alumno_id', uid));
export async function entregar(tarea, comentario, archivo) {
  const previa = ok(await sb.from('entregas').select('*').eq('tarea_id', tarea.id).eq('alumno_id', uid).maybeSingle());
  let archivo_path = previa?.archivo_path ?? null;
  if (archivo) archivo_path = await subir('entregas', `${tarea.materia_id}/${tarea.id}/${uid}`, archivo);
  const fila = previa
    ? ok(await sb.from('entregas').update({ comentario, archivo_path }).eq('id', previa.id).select().single())
    : ok(await sb.from('entregas').insert({ tarea_id: tarea.id, alumno_id: uid, comentario, archivo_path }).select().single());
  if (archivo && previa?.archivo_path && previa.archivo_path !== archivo_path) await sb.storage.from('entregas').remove([previa.archivo_path]);
  return fila;
}
export const entregasDeTarea = async (tareaId) => ok(await sb.from('entregas').select('*').eq('tarea_id', tareaId));
export const corregir = async (id, devolucion, nota) =>
  ok(await sb.from('entregas').update({ devolucion, nota }).eq('id', id).select().single());

// ---------------- Alumnos de una materia (profe / admin) ----------------
export async function alumnosDe(materiaId) {
  const ins = ok(await sb.from('inscripciones').select('alumno_id').eq('materia_id', materiaId).eq('activa', true));
  if (!ins.length) return [];
  return ok(await sb.from('perfiles').select('*').in('id', ins.map((i) => i.alumno_id)).order('apellido'));
}

// ---------------- Administración ----------------
export async function pendientes() {
  const ps = ok(await sb.from('perfiles').select('*').eq('rol', 'alumno').eq('estado', 'pendiente').order('creado_en'));
  if (!ps.length) return [];
  const sol = ok(await sb.from('solicitudes').select('*').in('alumno_id', ps.map((p) => p.id)));
  return ps.map((p) => ({ ...p, pedidas: sol.filter((s) => s.alumno_id === p.id).map((s) => s.materia_id) }));
}
export const aprobar = async (alumnoId, materiaIds) =>
  ok(await sb.rpc('aprobar_alumno', { p_alumno: alumnoId, p_materias: materiaIds }));
export const cambiarEstado = async (id, estado) => ok(await sb.from('perfiles').update({ estado }).eq('id', id));
export const cambiarRol = async (id, rol) => ok(await sb.from('perfiles').update({ rol, estado: 'activo' }).eq('id', id));

export async function usuarios() {
  const ps = ok(await sb.from('perfiles').select('*').order('apellido'));
  const ins = ok(await sb.from('inscripciones').select('*').eq('activa', true));
  return ps.map((p) => ({ ...p, materias: ins.filter((i) => i.alumno_id === p.id).map((i) => i.materia_id) }));
}
export async function setInscripciones(alumnoId, ids) {
  const actuales = ok(await sb.from('inscripciones').select('*').eq('alumno_id', alumnoId));
  const activas = actuales.filter((i) => i.activa).map((i) => i.materia_id);
  const bajar = activas.filter((x) => !ids.includes(x));
  const subirIds = ids.filter((x) => !activas.includes(x));
  if (bajar.length) ok(await sb.from('inscripciones').update({ activa: false }).eq('alumno_id', alumnoId).in('materia_id', bajar));
  for (const m of subirIds) {
    if (actuales.some((i) => i.materia_id === m)) ok(await sb.from('inscripciones').update({ activa: true }).eq('alumno_id', alumnoId).eq('materia_id', m));
    else ok(await sb.from('inscripciones').insert({ alumno_id: alumnoId, materia_id: m }));
  }
}

export const todasLasMaterias = async () => ok(await sb.from('materias').select('*').order('orden'));
export const crearMateria = async (m) => ok(await sb.from('materias').insert(m).select().single());
export const editarMateria = async (id, m) => ok(await sb.from('materias').update(m).eq('id', id).select().single());
export const asignaciones = async () => ok(await sb.from('materia_profes').select('*'));
export async function setProfes(materiaId, profeIds) {
  const act = ok(await sb.from('materia_profes').select('profe_id').eq('materia_id', materiaId)).map((r) => r.profe_id);
  const sacar = act.filter((x) => !profeIds.includes(x));
  const poner = profeIds.filter((x) => !act.includes(x));
  if (sacar.length) ok(await sb.from('materia_profes').delete().eq('materia_id', materiaId).in('profe_id', sacar));
  if (poner.length) ok(await sb.from('materia_profes').insert(poner.map((profe_id) => ({ materia_id: materiaId, profe_id }))));
}

export const personal = async () => ok(await sb.from('personal_autorizado').select('*').order('nombre'));
export const agregarPersonal = async (p) => ok(await sb.from('personal_autorizado').insert({ ...p, email: p.email.trim().toLowerCase() }));
export const borrarPersonal = async (email) => ok(await sb.from('personal_autorizado').delete().eq('email', email));
