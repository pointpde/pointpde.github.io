// Aula Point: pantallas y navegación.
// En localhost se puede probar sin Supabase con ?mock=alumno|nuevo|profe|admin
const esLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const modoMock = esLocal && new URLSearchParams(location.search).get('mock');
let api;
try { api = modoMock ? await import('./mock-api.js') : await import('./api.js'); }
catch (e) {
  console.error(e);
  document.getElementById('app').innerHTML = '<div class="vacio">No se pudo cargar el aula. Revisá tu conexión y recargá la página.</div>';
  throw e;
}

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $navLinks = document.getElementById('nav-links');
let perfil = null;
let misMats = [];          // materias del usuario (alumno: inscripto; profe/admin: las que da)
let uidActual = undefined;

// ---------------- Utilidades ----------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = 'America/Argentina/Tucuman';
const fFecha = (iso, conHora = true) => iso ? new Intl.DateTimeFormat('es-AR', {
  timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', ...(conHora ? { hour: '2-digit', minute: '2-digit' } : {}),
}).format(new Date(iso)) : '';
const aInputFecha = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const deInputFecha = (v) => v ? new Date(v).toISOString() : null;
const nombre = (p) => `${p.nombre || ''} ${p.apellido || ''}`.trim() || p.email;
const NIVELES = { primaria: 'Primaria', secundaria: 'Secundaria', universitario: 'Universitario', ingles: 'Inglés', capacitacion: 'Capacitación', otros: 'Otros' };
const MODALIDADES = { presencial_las_talitas: 'Presencial · Las Talitas', presencial_smt: 'Presencial · San Miguel de Tucumán', presencial_tafi_viejo: 'Presencial · Tafí Viejo', online: 'Online' };
const ROLES = { alumno: 'Alumno', profe: 'Profe', admin: 'Admin' };
const wa = (n) => n ? `https://wa.me/${String(n).replace(/\D/g, '').replace(/^0/, '').replace(/^(?!54)/, '549')}` : null;

function aviso(msg, error = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'aviso-flotante' + (error ? ' error' : ''); t.hidden = false;
  clearTimeout(aviso._t); aviso._t = setTimeout(() => { t.hidden = true; }, error ? 6000 : 3500);
}
// Envuelve una acción: deshabilita el botón, muestra el error si falla.
async function accion(btn, fn, okMsg) {
  if (btn) { btn.disabled = true; btn.dataset.txt ??= btn.textContent; btn.textContent = 'Guardando…'; }
  try { const r = await fn(); if (okMsg) aviso(okMsg); return r; }
  catch (e) { console.error(e); aviso(e.message || 'Algo salió mal', true); throw e; }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.txt; } }
}
const pintar = (html) => { $app.innerHTML = html; };
const datosForm = (form) => Object.fromEntries(new FormData(form).entries());
const vacio = (txt) => `<div class="vacio">${txt}</div>`;

function embed(url) {
  if (!url) return null;
  let m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/))([\w-]{11})/);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0`;
  m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  return null;
}
async function comprimir(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 900_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}
function archivoValido(file, maxMb) {
  if (!file || !file.size) return null;
  if (file.size > maxMb * 1024 * 1024) throw new Error(`El archivo pesa más de ${maxMb} MB.`);
  return file;
}
async function abrirArchivo(bucket, path) {
  const w = window.open('', '_blank');
  try { const url = await api.urlArchivo(bucket, path); if (w) w.location = url; else location.href = url; }
  catch (e) { if (w) w.close(); aviso(e.message, true); }
}

// ---------------- Arranque ----------------
let arrancando = null;
function arrancar() { arrancando ??= arrancarReal().finally(() => { arrancando = null; }); return arrancando; }
async function arrancarReal() {
  if (!modoMock && !api.configurado) {
    return pintar(`<div class="login-aula"><h1>Falta configurar</h1><p>Completá <code>aula/config.js</code> con los datos de Supabase.</p></div>`);
  }
  const err = new URLSearchParams(location.search).get('error_description') || new URLSearchParams(location.hash.slice(1)).get('error_description');
  const s = await api.sesion();
  if (!s) { uidActual = null; return pantallaLogin(err); }
  if (uidActual === s.user.id && perfil) return;
  uidActual = s.user.id;
  try { perfil = await api.miPerfil(); }
  catch (e) { return pintar(vacio(`No pudimos cargar tu perfil. Probá salir y volver a entrar.<br><small>${esc(e.message)}</small>`)); }

  document.getElementById('usuario').hidden = false;
  document.getElementById('usuario-nombre').textContent = nombre(perfil);
  document.getElementById('usuario-rol').textContent = ROLES[perfil.rol];

  if (perfil.estado === 'baja') { $nav.hidden = true; return pintar(vacio('Tu usuario está dado de baja. Si creés que es un error, escribinos por WhatsApp al <a href="https://wa.me/5493816111359">381 611-1359</a>.')); }
  if (perfil.estado === 'pendiente') { $nav.hidden = true; return pantallaPendiente(); }

  misMats = await api.misMaterias(perfil);
  armarNav();
  window.onhashchange = rutear;
  if (!location.hash || location.hash === '#') location.hash = perfil.rol === 'admin' ? '#/admin/pendientes' : perfil.rol === 'profe' ? '#/materias' : '#/inicio';
  else rutear();
}

document.getElementById('btn-salir').onclick = async () => { await api.salir(); location.hash = ''; location.reload(); };

async function armarNav() {
  const items = perfil.rol === 'alumno'
    ? [['#/inicio', 'Inicio'], ['#/materias', 'Mis materias']]
    : [['#/materias', 'Mis clases']];
  if (perfil.rol === 'admin') {
    let n = 0; try { n = (await api.pendientes()).length; } catch {}
    items.unshift(['#/admin/pendientes', `Pendientes${n ? `<span class="cuenta">${n}</span>` : ''}`]);
    items.push(['#/admin/usuarios', 'Usuarios'], ['#/admin/materias', 'Materias'], ['#/admin/personal', 'Personal']);
  }
  $navLinks.innerHTML = items.map(([h, t]) => `<a href="${h}">${t}</a>`).join('');
  $nav.hidden = false; marcarNav();
}
function marcarNav() {
  $navLinks.querySelectorAll('a').forEach((a) => {
    const base = a.getAttribute('href');
    a.classList.toggle('activo', location.hash === base || (base === '#/materias' && location.hash.startsWith('#/materia/')));
  });
}

async function rutear() {
  marcarNav();
  const partes = location.hash.replace(/^#\/?/, '').split('/');
  pintar('<div class="cargando" role="status">Cargando…</div>');
  try {
    if (partes[0] === 'inicio') return await vistaInicio();
    if (partes[0] === 'materias') return await vistaMaterias();
    if (partes[0] === 'materia') {
      const id = Number(partes[1]);
      if (partes[2] === 'tarea') return await vistaEntregas(id, Number(partes[3]));
      return await vistaMateria(id, partes[2] || 'clases');
    }
    if (partes[0] === 'admin' && perfil.rol === 'admin') {
      if (partes[1] === 'pendientes') return await vistaPendientes();
      if (partes[1] === 'usuarios') return await vistaUsuarios();
      if (partes[1] === 'materias') return await vistaAdminMaterias();
      if (partes[1] === 'personal') return await vistaPersonal();
    }
    location.hash = perfil.rol === 'admin' ? '#/admin/pendientes' : perfil.rol === 'profe' ? '#/materias' : '#/inicio';
  } catch (e) {
    console.error(e);
    pintar(vacio(`No se pudo cargar esta sección.<br><small>${esc(e.message)}</small>`));
  } finally { $app.focus({ preventScroll: true }); }
}

// ---------------- Login ----------------
function pantallaLogin(error) {
  $nav.hidden = true; document.getElementById('usuario').hidden = true;
  pintar(`
  <div class="login-aula">
    <img src="/logo.png" alt="" width="96" height="96">
    <h1>Ingresá al aula</h1>
    <p class="meta">¿Primera vez? Entrá igual: completás tus datos y Point te habilita.</p>
    ${error ? `<p class="error-form">${esc(error)}</p>` : ''}
    <button class="btn-google" type="button" id="btn-google">
      <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
      Continuar con Google
    </button>
    <div class="separador">o con tu mail</div>
    <form id="form-mail">
      <label>Tu mail<input type="email" name="email" required autocomplete="email" placeholder="nombre@gmail.com"></label>
      <button class="btn-s b" type="submit">Enviarme un link para entrar</button>
    </form>
    <p class="meta" style="font-size:14px">¿Dudas? Escribinos por <a href="https://wa.me/5493816111359">WhatsApp</a>.</p>
  </div>`);
  document.getElementById('btn-google').onclick = (e) => accion(e.currentTarget, () => api.entrarConGoogle());
  document.getElementById('form-mail').onsubmit = async (e) => {
    e.preventDefault();
    const email = datosForm(e.target).email;
    await accion(e.submitter, () => api.entrarConMail(email));
    e.target.outerHTML = `<p class="devolucion"><b>¡Listo!</b> Te mandamos un link a <b>${esc(email)}</b>. Abrilo desde este mismo dispositivo para entrar. Si no llega, revisá spam.</p>`;
  };
}

// ---------------- Inscripción (alumno pendiente) ----------------
async function pantallaPendiente(editar = false) {
  const [mats, sol] = await Promise.all([api.materiasActivas(), api.misSolicitudes()]);
  if (perfil.datos_completos && sol.length && !editar) {
    const pedidas = mats.filter((m) => sol.includes(m.id));
    pintar(`
    <div class="login-aula" style="max-width:620px;text-align:left">
      <h1>¡Gracias, ${esc(perfil.nombre)}!</h1>
      <p>Tu inscripción está <b>en revisión</b>. Point te va a habilitar y avisar por WhatsApp. Cuando estés habilitado, al entrar vas a ver tus clases y tareas.</p>
      <div class="caja" style="box-shadow:none;background:var(--lila2)">
        <p><b>Pediste:</b> ${pedidas.map((m) => esc(m.nombre)).join(', ') || '—'}</p>
        <p><b>WhatsApp:</b> ${esc(perfil.whatsapp)} · <b>Modalidad:</b> ${esc(MODALIDADES[perfil.modalidad] || '')}</p>
      </div>
      <div class="fila-acciones"><button class="btn-s b" id="btn-editar" type="button">Editar mis datos</button>
        <a class="btn-s n" href="https://wa.me/5493816111359">Escribir a Point</a></div>
    </div>`);
    document.getElementById('btn-editar').onclick = () => pantallaPendiente(true);
    return;
  }
  const p = perfil;
  pintar(`
  <div class="titulo-aula"><div><h1>Completá tu inscripción</h1><p>Con estos datos Point te habilita en tus materias.</p></div></div>
  <form class="caja form-aula" id="form-insc">
    <label>Nombre<input name="nombre" required value="${esc(p.nombre)}" autocomplete="given-name"></label>
    <label>Apellido<input name="apellido" required value="${esc(p.apellido)}" autocomplete="family-name"></label>
    <label>WhatsApp<input name="whatsapp" type="tel" required value="${esc(p.whatsapp)}" placeholder="381 555-5555" autocomplete="tel"></label>
    <label>Nivel<select name="nivel" required>${Object.entries(NIVELES).map(([k, v]) => `<option value="${k}" ${p.nivel === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Curso o año <small>(opcional)</small><input name="curso" value="${esc(p.curso)}" placeholder="Ej: 2° año, 5° grado, B1"></label>
    <label>Modalidad<select name="modalidad" required>${Object.entries(MODALIDADES).map(([k, v]) => `<option value="${k}" ${p.modalidad === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="check full"><input type="checkbox" name="es_menor" id="es-menor" ${p.es_menor ? 'checked' : ''}> El alumno es menor de edad</label>
    <div class="full form-aula" id="responsable" ${p.es_menor ? '' : 'hidden'}>
      <label>Nombre del adulto responsable<input name="responsable_nombre" value="${esc(p.responsable_nombre)}"></label>
      <label>WhatsApp del adulto responsable<input name="responsable_whatsapp" type="tel" value="${esc(p.responsable_whatsapp)}"></label>
    </div>
    <fieldset class="full"><legend>¿Qué querés cursar?</legend>
      ${mats.length ? `<div class="opciones">${mats.map((m) => `<label class="opcion"><input type="checkbox" name="mat" value="${m.id}" ${sol.includes(m.id) ? 'checked' : ''}> ${esc(m.nombre)}</label>`).join('')}</div>`
        : '<p class="meta">Por ahora no hay cursos abiertos en el aula. Igual dejá tus datos y te avisamos.</p>'}
    </fieldset>
    <label class="full">Comentario <small>(opcional)</small><textarea name="comentario" rows="3" placeholder="Contanos qué necesitás">${esc(p.comentario)}</textarea></label>
    <p class="error-form full" id="err" hidden></p>
    <div class="full fila-acciones"><button class="btn-s v" type="submit">Enviar inscripción</button></div>
  </form>`);
  const menor = document.getElementById('es-menor');
  menor.onchange = () => { document.getElementById('responsable').hidden = !menor.checked;
    document.querySelectorAll('#responsable input').forEach((i) => { i.required = menor.checked; }); };
  menor.onchange();
  document.getElementById('form-insc').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target; const d = datosForm(f); d.es_menor = f.es_menor.checked;
    const ids = [...f.querySelectorAll('input[name=mat]:checked')].map((i) => Number(i.value));
    const err = document.getElementById('err');
    if (mats.length && !ids.length) { err.textContent = 'Elegí al menos un curso.'; err.hidden = false; return; }
    err.hidden = true;
    await accion(e.submitter, async () => { perfil = await api.guardarMisDatos(d); await api.guardarSolicitudes(ids); }, '¡Inscripción enviada!');
    pantallaPendiente();
  };
}

// ---------------- Inicio del alumno ----------------
async function vistaInicio() {
  const ids = misMats.map((m) => m.id);
  const [cls, tps, ents] = await Promise.all([api.clases(ids), api.tareas(ids), perfil.rol === 'alumno' ? api.misEntregas() : []]);
  const matNom = Object.fromEntries(misMats.map((m) => [m.id, m.nombre]));
  const ahora = Date.now();
  const proximas = cls.filter((c) => c.fecha_hora && new Date(c.fecha_hora).getTime() > ahora - 3 * 3600e3)
    .sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora)).slice(0, 4);
  const grab = cls.filter((c) => c.link_grabacion).slice(0, 4);
  const pend = tps.filter((t) => t.publicada && !ents.some((e) => e.tarea_id === t.id));
  pintar(`
  <div class="titulo-aula"><div><h1>¡Hola, ${esc(perfil.nombre || 'bienvenido')}!</h1><p>${misMats.length ? 'Esto es lo que tenés en el aula.' : ''}</p></div></div>
  ${!misMats.length ? vacio('Todavía no tenés materias asignadas. Point te va a sumar pronto.') : `
  <h2 class="sub">Próximas clases en vivo</h2>
  ${proximas.length ? `<div class="grid-aula">${proximas.map((c) => tarjetaVivo(c, matNom[c.materia_id])).join('')}</div>` : vacio('No hay clases en vivo programadas.')}
  <h2 class="sub">Tareas pendientes</h2>
  ${pend.length ? `<div class="lista">${pend.map((t) => `<a class="item" style="text-decoration:none;color:inherit" href="#/materia/${t.materia_id}/tareas">
      <div class="item-cab"><h3>${esc(t.titulo)}</h3>${t.fecha_entrega ? `<span class="chip-s pend">Entregar: ${fFecha(t.fecha_entrega, false)}</span>` : ''}</div>
      <span class="meta">${esc(matNom[t.materia_id])}</span></a>`).join('')}</div>` : vacio('¡Estás al día! No tenés tareas pendientes.')}
  <h2 class="sub">Últimas clases grabadas</h2>
  ${grab.length ? `<div class="grid-aula">${grab.map((c) => `<a class="materia-card" href="#/materia/${c.materia_id}/clases"><div class="cuerpo">
      <span class="chip-s">${esc(matNom[c.materia_id])}</span><h3>${esc(c.titulo)}</h3><span class="meta">${fFecha(c.fecha_hora, false)}</span></div></a>`).join('')}</div>` : vacio('Todavía no hay grabaciones.')}`}`);
}
function tarjetaVivo(c, mat) {
  const hoy = c.fecha_hora && new Date(c.fecha_hora).toDateString() === new Date().toDateString();
  return `<div class="item"><span class="chip-s ${hoy ? 'vivo' : ''}">${hoy ? 'Hoy · ' : ''}${fFecha(c.fecha_hora)}</span>
    <h3>${esc(c.titulo)}</h3><span class="meta">${esc(mat || '')}</span>
    <div class="fila-acciones">${c.link_meet ? `<a class="btn-s v" href="${esc(c.link_meet)}" target="_blank" rel="noopener">Entrar a la clase (Meet)</a>` : '<span class="meta">El link aparece cuando el profe lo cargue.</span>'}
    <a class="btn-s b" href="#/materia/${c.materia_id}/clases">Ver materia</a></div></div>`;
}

// ---------------- Mis materias / Mis clases ----------------
async function vistaMaterias() {
  const profes = await api.profesDe(misMats.map((m) => m.id));
  const esStaff = perfil.rol !== 'alumno';
  pintar(`
  <div class="titulo-aula"><div><h1>${esStaff ? 'Mis clases' : 'Mis materias'}</h1>
    <p>${esStaff ? 'Las materias que das. Entrá para cargar clases, tareas y corregir.' : 'Entrá a cada materia para ver clases, grabaciones y tareas.'}</p></div>
    ${perfil.rol === 'admin' ? '<a class="btn-s b" href="#/admin/materias">Ver todas las materias</a>' : ''}</div>
  ${misMats.length ? `<div class="grid-aula">${misMats.map((m) => {
    const ps = profes.filter((p) => p.materia_id === m.id).map(nombre);
    return `<a class="materia-card" href="#/materia/${m.id}"><div class="franja" style="background:${esc(m.color)}"></div>
      <div class="cuerpo"><span class="meta">${NIVELES[m.nivel]}</span><h3>${esc(m.nombre)}</h3><span class="meta">${ps.length ? 'Profe: ' + esc(ps.join(', ')) : ''}</span></div></a>`;
  }).join('')}</div>` : vacio(esStaff
    ? (perfil.rol === 'admin' ? 'No tenés materias asignadas como profe. Podés asignarte desde <a href="#/admin/materias">Materias</a>.' : 'Todavía no tenés materias asignadas. Pedile a Lucas que te asigne.')
    : 'Todavía no tenés materias asignadas.')}`);
}

// ---------------- Materia ----------------
const puedeGestionar = (id) => perfil.rol === 'admin' || (perfil.rol === 'profe' && misMats.some((m) => m.id === id));

async function vistaMateria(id, pestana) {
  const gestiona = puedeGestionar(id);
  const [m, profes] = await Promise.all([api.materia(id), api.profesDe([id])]);
  const tabs = [['clases', 'Clases'], ['tareas', 'Tareas'], ...(gestiona ? [['alumnos', 'Alumnos']] : [])];
  pintar(`
  <div class="titulo-aula"><div><span class="chip-s" style="background:${esc(m.color)};color:var(--noche)">${NIVELES[m.nivel]}</span>
    <h1 style="margin-top:8px">${esc(m.nombre)}</h1>
    <p>${profes.length ? 'Profe: ' + esc(profes.map(nombre).join(', ')) : ''}</p></div>
    <div class="seg" role="group" aria-label="Secciones de la materia">${tabs.map(([k, t]) => `<button type="button" aria-pressed="${k === pestana}" data-tab="${k}">${t}</button>`).join('')}</div></div>
  <div id="contenido"></div>`);
  $app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { location.hash = `#/materia/${id}/${b.dataset.tab}`; }; });
  const cont = document.getElementById('contenido');
  if (pestana === 'tareas') return seccionTareas(cont, m, gestiona);
  if (pestana === 'alumnos' && gestiona) return seccionAlumnos(cont, m);
  return seccionClases(cont, m, gestiona);
}

function formClase(c = {}) {
  return `<form class="form-aula form-clase">
    <label class="full">Título<input name="titulo" required value="${esc(c.titulo)}" placeholder="Ej: Clase 3 · Present perfect"></label>
    <label>Día y hora<input type="datetime-local" name="fecha_hora" value="${aInputFecha(c.fecha_hora)}"></label>
    <label>Link de Meet<input type="url" name="link_meet" value="${esc(c.link_meet)}" placeholder="https://meet.google.com/..."></label>
    <label class="full">Link de YouTube de la grabación <small>(se ve dentro del aula; podés agregarlo después de la clase)</small><input type="url" name="link_grabacion" value="${esc(c.link_grabacion)}" placeholder="https://youtu.be/..."></label>
    <label class="full">Material de la clase <small>(PDF, Word, PowerPoint o foto · hasta 20 MB${c.material_path ? ' · si subís uno nuevo, reemplaza al actual' : ''})</small><input type="file" name="archivo" accept=".pdf,.doc,.docx,.ppt,.pptx,image/*"></label>
    ${c.material_path ? '<label class="check full"><input type="checkbox" name="quitar_material"> Quitar el material actual</label>' : ''}
    <label class="full">Descripción <small>(opcional)</small><textarea name="descripcion" rows="2">${esc(c.descripcion)}</textarea></label>
    <div class="full fila-acciones"><button class="btn-s v" type="submit">${c.id ? 'Guardar cambios' : 'Publicar clase'}</button>
      ${c.id ? '<button class="btn-s b" type="button" data-cancelar>Cancelar</button>' : ''}</div></form>`;
}
const leerClase = (f) => { const d = datosForm(f); return { titulo: d.titulo.trim(), descripcion: d.descripcion || null,
  fecha_hora: deInputFecha(d.fecha_hora), link_meet: d.link_meet.trim() || null, link_grabacion: d.link_grabacion.trim() || null }; };

async function seccionClases(cont, m, gestiona) {
  const lista = await api.clases([m.id]);
  cont.innerHTML = `
    ${gestiona ? `<details class="desplegable caja" style="margin-bottom:18px"><summary class="btn-s v">+ Nueva clase</summary>${formClase()}</details>` : ''}
    ${lista.length ? `<div class="lista">${lista.map((c) => {
      const em = embed(c.link_grabacion);
      return `<article class="item" data-id="${c.id}">
        <div class="item-cab"><div><h3>${esc(c.titulo)}</h3><span class="meta">${c.fecha_hora ? fFecha(c.fecha_hora) : 'Sin fecha'}</span></div>
          <div class="chips">${c.link_grabacion ? '<span class="chip-s ok">Grabada</span>' : ''}${c.material_path ? '<span class="chip-s">Con material</span>' : ''}</div></div>
        ${c.descripcion ? `<p class="texto-largo">${esc(c.descripcion)}</p>` : ''}
        <div class="fila-acciones">
          ${c.link_meet ? `<a class="btn-s v" href="${esc(c.link_meet)}" target="_blank" rel="noopener">Entrar a la clase (Meet)</a>` : ''}
          ${c.material_path ? '<button class="btn-s b" type="button" data-material>Material de la clase</button>' : ''}
          ${c.link_grabacion ? (em ? `<button class="btn-s n" type="button" data-ver>Ver grabación</button>` : `<a class="btn-s n" href="${esc(c.link_grabacion)}" target="_blank" rel="noopener">Ver grabación</a>`) : ''}
          ${gestiona ? '<button class="btn-s b" type="button" data-editar>Editar</button><button class="btn-s r" type="button" data-borrar>Borrar</button>' : ''}
        </div><div data-zona></div></article>`;
    }).join('')}</div>` : vacio(gestiona ? 'Todavía no cargaste clases. Tocá "Nueva clase".' : 'Todavía no hay clases cargadas.')}`;

  const nueva = cont.querySelector('details .form-clase');
  if (nueva) nueva.onsubmit = async (e) => { e.preventDefault();
    await accion(e.submitter, async () => api.crearClase({ ...leerClase(e.target), materia_id: m.id },
      archivoValido(await comprimir(e.target.archivo.files[0]), 20)), 'Clase publicada'); seccionClases(cont, m, gestiona); };
  cont.querySelectorAll('article.item').forEach((art) => {
    const c = lista.find((x) => x.id === Number(art.dataset.id)); const zona = art.querySelector('[data-zona]');
    const ver = art.querySelector('[data-ver]');
    if (ver) ver.onclick = () => { zona.innerHTML = zona.innerHTML ? '' : `<div class="video"><iframe src="${esc(embed(c.link_grabacion))}" title="Grabación: ${esc(c.titulo)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
      ver.textContent = zona.innerHTML ? 'Ocultar grabación' : 'Ver grabación'; };
    const ed = art.querySelector('[data-editar]');
    if (ed) ed.onclick = () => { zona.innerHTML = `<div class="panel-edit">${formClase(c)}</div>`;
      const f = zona.querySelector('form');
      f.querySelector('[data-cancelar]').onclick = () => { zona.innerHTML = ''; };
      f.onsubmit = async (e) => { e.preventDefault();
        await accion(e.submitter, async () => api.editarClase(c, leerClase(f), archivoValido(await comprimir(f.archivo.files[0]), 20), !!f.quitar_material?.checked), 'Clase actualizada');
        seccionClases(cont, m, gestiona); }; };
    const br = art.querySelector('[data-borrar]');
    if (br) br.onclick = async () => { if (!confirm(`¿Borrar la clase "${c.titulo}"?`)) return;
      await accion(br, () => api.borrarClase(c), 'Clase borrada'); seccionClases(cont, m, gestiona); };
    art.querySelector('[data-material]')?.addEventListener('click', () => abrirArchivo('materiales', c.material_path));
  });
}

async function seccionTareas(cont, m, gestiona) {
  const [lista, ents, alumnos] = await Promise.all([api.tareas([m.id]),
    perfil.rol === 'alumno' ? api.misEntregas() : Promise.resolve([]), gestiona ? api.alumnosDe(m.id) : Promise.resolve([])]);
  const visibles = gestiona ? lista : lista.filter((t) => t.publicada);
  const conteos = {};
  if (gestiona) await Promise.all(visibles.map(async (t) => { conteos[t.id] = (await api.entregasDeTarea(t.id)).length; }));
  cont.innerHTML = `
    ${gestiona ? `<details class="desplegable caja" style="margin-bottom:18px"><summary class="btn-s v">+ Nueva tarea</summary>
      <form class="form-aula" id="form-tarea">
        <label class="full">Título<input name="titulo" required placeholder="Ej: Writing: my last holidays"></label>
        <label class="full">Consigna<textarea name="consigna" rows="4"></textarea></label>
        <label>Fecha de entrega <small>(opcional)</small><input type="datetime-local" name="fecha_entrega"></label>
        <label>Material adjunto <small>(PDF, Word, foto · hasta 20 MB)</small><input type="file" name="archivo" accept=".pdf,.doc,.docx,.ppt,.pptx,image/*"></label>
        <label class="check full"><input type="checkbox" name="publicada" checked> Visible para los alumnos</label>
        <div class="full"><button class="btn-s v" type="submit">Publicar tarea</button></div></form></details>` : ''}
    ${visibles.length ? `<div class="lista">${visibles.map((t) => {
      const en = ents.find((e) => e.tarea_id === t.id);
      const vencida = t.fecha_entrega && new Date(t.fecha_entrega) < new Date();
      const estado = gestiona ? `<span class="chip-s">${conteos[t.id] ?? 0}/${alumnos.length} entregas</span>${t.publicada ? '' : '<span class="chip-s pend">Oculta</span>'}`
        : en?.corregida_en ? '<span class="chip-s ok">Corregida</span>' : en ? '<span class="chip-s ok">Entregada</span>'
        : vencida ? '<span class="chip-s alerta">Vencida</span>' : '<span class="chip-s pend">Pendiente</span>';
      return `<article class="item" data-id="${t.id}">
        <div class="item-cab"><div><h3>${esc(t.titulo)}</h3><span class="meta">${t.fecha_entrega ? 'Entregar hasta ' + fFecha(t.fecha_entrega) : 'Sin fecha de entrega'}</span></div><div class="chips">${estado}</div></div>
        ${t.consigna ? `<p class="texto-largo">${esc(t.consigna)}</p>` : ''}
        <div class="fila-acciones">
          ${t.adjunto_path ? '<button class="btn-s b" type="button" data-material>Ver material</button>' : ''}
          ${gestiona ? `<a class="btn-s v" href="#/materia/${m.id}/tarea/${t.id}">Ver entregas y corregir</a><button class="btn-s r" type="button" data-borrar>Borrar</button>` : ''}
        </div>
        ${!gestiona ? (en?.corregida_en ? `<div class="devolucion"><b>Devolución${en.nota ? ` · Nota: ${esc(en.nota)}` : ''}</b><p class="texto-largo">${esc(en.devolucion || '')}</p></div>
          ${en.archivo_path ? '<div><button class="btn-s b" type="button" data-mi-archivo>Ver lo que entregué</button></div>' : ''}`
          : `<form class="form-aula panel-edit form-entrega">
              ${en ? `<p class="full meta">Entregaste el ${fFecha(en.entregada_en)}. Podés reemplazar tu entrega hasta que el profe la corrija.
                ${en.archivo_path ? ' <button class="btn-s b" type="button" data-mi-archivo>Ver lo que entregué</button>' : ''}</p>` : ''}
              <label class="full">Comentario <small>(opcional)</small><textarea name="comentario" rows="2">${esc(en?.comentario)}</textarea></label>
              <label class="full">Archivo <small>(PDF, Word o foto · hasta 10 MB)</small><input type="file" name="archivo" accept=".pdf,.doc,.docx,image/*"></label>
              <div class="full"><button class="btn-s v" type="submit">${en ? 'Reemplazar entrega' : 'Entregar'}</button></div></form>`) : ''}
      </article>`;
    }).join('')}</div>` : vacio(gestiona ? 'Todavía no cargaste tareas.' : 'No hay tareas por ahora.')}`;

  const ft = cont.querySelector('#form-tarea');
  if (ft) ft.onsubmit = async (e) => { e.preventDefault(); const d = datosForm(ft);
    await accion(e.submitter, async () => {
      const arch = archivoValido(await comprimir(ft.archivo.files[0]), 20);
      await api.crearTarea({ materia_id: m.id, titulo: d.titulo.trim(), consigna: d.consigna || null,
        fecha_entrega: deInputFecha(d.fecha_entrega), publicada: ft.publicada.checked }, arch);
    }, 'Tarea publicada'); seccionTareas(cont, m, gestiona); };
  cont.querySelectorAll('article.item').forEach((art) => {
    const t = visibles.find((x) => x.id === Number(art.dataset.id)); const en = ents.find((e) => e.tarea_id === t.id);
    art.querySelector('[data-material]')?.addEventListener('click', () => abrirArchivo('materiales', t.adjunto_path));
    art.querySelectorAll('[data-mi-archivo]').forEach((b) => b.addEventListener('click', () => abrirArchivo('entregas', en.archivo_path)));
    const br = art.querySelector('[data-borrar]');
    if (br) br.onclick = async () => { if (!confirm(`¿Borrar la tarea "${t.titulo}" y todas sus entregas?`)) return;
      await accion(br, () => api.borrarTarea(t), 'Tarea borrada'); seccionTareas(cont, m, gestiona); };
    const fe = art.querySelector('.form-entrega');
    if (fe) fe.onsubmit = async (e) => { e.preventDefault();
      await accion(e.submitter, async () => {
        const arch = archivoValido(await comprimir(fe.archivo.files[0]), 10);
        const com = fe.comentario.value.trim() || null;
        if (!arch && !com && !en?.archivo_path) throw new Error('Adjuntá un archivo o escribí un comentario.');
        await api.entregar(t, com, arch);
      }, '¡Tarea entregada!'); seccionTareas(cont, m, gestiona); };
  });
}

async function seccionAlumnos(cont, m) {
  const al = await api.alumnosDe(m.id);
  cont.innerHTML = al.length ? `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Alumno</th><th>WhatsApp</th><th>Curso</th><th>Responsable</th></tr></thead><tbody>
    ${al.map((a) => `<tr><td><b>${esc(nombre(a))}</b><br><span class="meta">${esc(a.email)}</span></td>
      <td>${a.whatsapp ? `<a href="${wa(a.whatsapp)}" target="_blank" rel="noopener">${esc(a.whatsapp)}</a>` : '—'}</td>
      <td>${esc(a.curso || '—')}</td>
      <td>${a.es_menor ? `${esc(a.responsable_nombre)}<br>${a.responsable_whatsapp ? `<a href="${wa(a.responsable_whatsapp)}" target="_blank" rel="noopener">${esc(a.responsable_whatsapp)}</a>` : ''}` : '—'}</td></tr>`).join('')}
    </tbody></table></div>` : vacio('Todavía no hay alumnos inscriptos en esta materia.' + (perfil.rol === 'admin' ? ' Asignalos desde <a href="#/admin/usuarios">Usuarios</a> o <a href="#/admin/pendientes">Pendientes</a>.' : ''));
}

async function vistaEntregas(materiaId, tareaId) {
  if (!puedeGestionar(materiaId)) { location.hash = `#/materia/${materiaId}/tareas`; return; }
  const [m, tps, al, ents] = await Promise.all([api.materia(materiaId), api.tareas([materiaId]), api.alumnosDe(materiaId), api.entregasDeTarea(tareaId)]);
  const t = tps.find((x) => x.id === tareaId);
  if (!t) { pintar(vacio('La tarea no existe.')); return; }
  const filas = al.map((a) => ({ a, e: ents.find((x) => x.alumno_id === a.id) }))
    .sort((x, y) => (y.e ? 1 : 0) - (x.e ? 1 : 0) || nombre(x.a).localeCompare(nombre(y.a)));
  pintar(`
  <div class="titulo-aula"><div><a href="#/materia/${materiaId}/tareas">← ${esc(m.nombre)}</a><h1 style="margin-top:8px">${esc(t.titulo)}</h1>
    <p>${ents.length}/${al.length} entregas${t.fecha_entrega ? ' · Entrega: ' + fFecha(t.fecha_entrega) : ''}</p></div></div>
  ${filas.length ? `<div class="lista">${filas.map(({ a, e }) => `<article class="item" data-alumno="${a.id}">
    <div class="item-cab"><div><h3>${esc(nombre(a))}</h3><span class="meta">${e ? 'Entregó el ' + fFecha(e.entregada_en) : 'Sin entregar'}</span></div>
      <div class="chips">${e?.corregida_en ? '<span class="chip-s ok">Corregida</span>' : e ? '<span class="chip-s pend">Para corregir</span>' : '<span class="chip-s alerta">Sin entregar</span>'}</div></div>
    ${e ? `${e.comentario ? `<p class="texto-largo"><b>Comentario:</b> ${esc(e.comentario)}</p>` : ''}
      ${e.archivo_path ? '<div><button class="btn-s b" type="button" data-archivo>Ver archivo entregado</button></div>' : ''}
      <form class="form-aula panel-edit">
        <label class="full">Devolución<textarea name="devolucion" rows="3">${esc(e.devolucion)}</textarea></label>
        <label>Nota <small>(opcional)</small><input name="nota" value="${esc(e.nota)}" placeholder="Ej: 8, Muy bien"></label>
        <div class="full"><button class="btn-s v" type="submit">${e.corregida_en ? 'Actualizar devolución' : 'Guardar corrección'}</button></div></form>` : ''}
  </article>`).join('')}</div>` : vacio('No hay alumnos inscriptos.')}`);
  $app.querySelectorAll('article[data-alumno]').forEach((art) => {
    const e = ents.find((x) => x.alumno_id === art.dataset.alumno); if (!e) return;
    art.querySelector('[data-archivo]')?.addEventListener('click', () => abrirArchivo('entregas', e.archivo_path));
    const f = art.querySelector('form');
    f.onsubmit = async (ev) => { ev.preventDefault();
      await accion(ev.submitter, () => api.corregir(e.id, f.devolucion.value.trim() || null, f.nota.value.trim() || null), 'Corrección guardada');
      vistaEntregas(materiaId, tareaId); };
  });
}

// ---------------- Admin: pendientes ----------------
async function vistaPendientes() {
  const [ps, mats] = await Promise.all([api.pendientes(), api.todasLasMaterias()]);
  const activas = mats.filter((m) => m.activa);
  pintar(`
  <div class="titulo-aula"><div><h1>Pendientes</h1><p>Personas que se registraron y esperan que las habilites.</p></div></div>
  ${ps.length ? `<div class="lista">${ps.map((p) => {
    const opciones = mats.filter((m) => m.activa || p.pedidas.includes(m.id));
    return `<article class="item" data-id="${p.id}">
    <div class="item-cab"><div><h3>${esc(nombre(p))}</h3><span class="meta">${esc(p.email)} · se registró el ${fFecha(p.creado_en, false)}</span></div>
      <div class="chips">${p.datos_completos ? '<span class="chip-s ok">Datos completos</span>' : '<span class="chip-s pend">Sin completar datos</span>'}</div></div>
    ${p.datos_completos ? `<p class="meta">
      ${p.whatsapp ? `WhatsApp: <a href="${wa(p.whatsapp)}" target="_blank" rel="noopener">${esc(p.whatsapp)}</a> · ` : ''}
      ${esc(NIVELES[p.nivel] || '')}${p.curso ? ' ' + esc(p.curso) : ''} · ${esc(MODALIDADES[p.modalidad] || '')}
      ${p.es_menor ? `<br>Menor · Responsable: ${esc(p.responsable_nombre)} (${p.responsable_whatsapp ? `<a href="${wa(p.responsable_whatsapp)}" target="_blank" rel="noopener">${esc(p.responsable_whatsapp)}</a>` : ''})` : ''}</p>
      ${p.comentario ? `<p class="texto-largo"><b>Comentario:</b> ${esc(p.comentario)}</p>` : ''}` : ''}
    <form class="panel-edit">
      <b>Inscribir en:</b>
      ${opciones.length ? `<div class="opciones">${opciones.map((m) => `<label class="opcion ${m.activa ? '' : 'inactiva'}"><input type="checkbox" name="mat" value="${m.id}" ${p.pedidas.includes(m.id) || (opciones.length === 1) ? 'checked' : ''}> ${esc(m.nombre)}</label>`).join('')}</div>`
        : '<p class="meta">No hay materias activas. Activá una en <a href="#/admin/materias">Materias</a>.</p>'}
      <div class="fila-acciones">
        <button class="btn-s v" type="submit">Aprobar e inscribir</button>
        <button class="btn-s b" type="button" data-profe>Es profe</button>
        <button class="btn-s r" type="button" data-rechazar>Rechazar</button>
      </div></form></article>`;
  }).join('')}</div>` : vacio('No hay nadie esperando.')}`);
  $app.querySelectorAll('article[data-id]').forEach((art) => {
    const id = art.dataset.id; const p = ps.find((x) => x.id === id); const f = art.querySelector('form');
    f.onsubmit = async (e) => { e.preventDefault();
      const ids = [...f.querySelectorAll('input[name=mat]:checked')].map((i) => Number(i.value));
      if (!ids.length && !confirm(`¿Aprobar a ${nombre(p)} sin inscribirlo en ninguna materia?`)) return;
      await accion(e.submitter, () => api.aprobar(id, ids), `${nombre(p)} quedó habilitado`); armarNav(); vistaPendientes(); };
    art.querySelector('[data-profe]').onclick = async (e) => { if (!confirm(`¿${nombre(p)} es del personal? Va a quedar como profe activo.`)) return;
      await accion(e.currentTarget, () => api.cambiarRol(id, 'profe'), 'Ahora es profe. Asignale materias en "Materias".'); armarNav(); vistaPendientes(); };
    art.querySelector('[data-rechazar]').onclick = async (e) => { if (!confirm(`¿Rechazar a ${nombre(p)}? Queda dado de baja (se puede reactivar desde Usuarios).`)) return;
      await accion(e.currentTarget, () => api.cambiarEstado(id, 'baja'), 'Rechazado'); armarNav(); vistaPendientes(); };
  });
}

// ---------------- Admin: usuarios ----------------
let filtroUsuarios = 'alumno';
async function vistaUsuarios() {
  const [us, mats, asig] = await Promise.all([api.usuarios(), api.todasLasMaterias(), api.asignaciones()]);
  const matNom = Object.fromEntries(mats.map((m) => [m.id, m.nombre]));
  pintar(`
  <div class="titulo-aula"><div><h1>Usuarios</h1><p>Cambiá roles, inscribí alumnos en sus aulas y asigná materias a los profes.</p></div></div>
  <div class="buscador">
    <div class="seg" role="group" aria-label="Filtrar">${[['alumno', 'Alumnos'], ['staff', 'Profes y admins'], ['baja', 'Dados de baja'], ['todos', 'Todos']].map(([k, t]) =>
      `<button type="button" data-filtro="${k}" aria-pressed="${filtroUsuarios === k}">${t}</button>`).join('')}</div>
    <input type="search" id="buscar" placeholder="Buscar por nombre o mail" aria-label="Buscar usuario">
  </div>
  <div class="lista" id="lista-us"></div>`);
  const dibujar = () => {
    const q = document.getElementById('buscar').value.trim().toLowerCase();
    const lista = us.filter((u) => (filtroUsuarios === 'todos' || (filtroUsuarios === 'baja' ? u.estado === 'baja'
      : u.estado !== 'baja' && u.estado !== 'pendiente' && (filtroUsuarios === 'alumno' ? u.rol === 'alumno' : u.rol !== 'alumno'))))
      .filter((u) => !q || `${nombre(u)} ${u.email}`.toLowerCase().includes(q));
    const cont = document.getElementById('lista-us');
    cont.innerHTML = lista.length ? lista.map((u) => {
      const da = asig.filter((a) => a.profe_id === u.id).map((a) => a.materia_id);
      const chipsM = (u.rol === 'alumno' ? u.materias : da).map((id) => `<span class="chip-s">${esc(matNom[id])}</span>`).join('');
      return `<article class="item" data-id="${u.id}">
        <div class="item-cab"><div><h3>${esc(nombre(u))}${u.id === perfil.id ? ' <small class="meta">(vos)</small>' : ''}</h3><span class="meta">${esc(u.email)}${u.whatsapp ? ' · ' + esc(u.whatsapp) : ''}</span></div>
          <div class="chips"><span class="chip-s ${u.rol === 'admin' ? 'vivo' : u.rol === 'profe' ? 'ok' : ''}">${ROLES[u.rol]}</span>
          ${u.estado !== 'activo' ? `<span class="chip-s ${u.estado === 'baja' ? 'alerta' : 'pend'}">${u.estado === 'baja' ? 'Baja' : 'Pendiente'}</span>` : ''}</div></div>
        <div class="chips">${chipsM || `<span class="meta">${u.rol === 'alumno' ? 'Sin materias' : 'No da materias'}</span>`}</div>
        <div><button class="btn-s b" type="button" data-editar>Editar</button></div><div data-zona></div></article>`;
    }).join('') : vacio('No hay usuarios en esta lista.');
    cont.querySelectorAll('article').forEach((art) => {
      art.querySelector('[data-editar]').onclick = () => editarUsuario(art, us.find((u) => u.id === art.dataset.id), mats, asig);
    });
  };
  $app.querySelectorAll('[data-filtro]').forEach((b) => { b.onclick = () => {
    filtroUsuarios = b.dataset.filtro; $app.querySelectorAll('[data-filtro]').forEach((x) => x.setAttribute('aria-pressed', x === b)); dibujar(); }; });
  document.getElementById('buscar').oninput = dibujar;
  dibujar();
}

function editarUsuario(art, u, mats, asig) {
  const zona = art.querySelector('[data-zona]');
  if (zona.innerHTML) { zona.innerHTML = ''; return; }
  const yo = u.id === perfil.id;
  const da = asig.filter((a) => a.profe_id === u.id).map((a) => a.materia_id);
  const checks = (sel, name) => `<div class="opciones">${mats.map((m) => `<label class="opcion ${m.activa ? '' : 'inactiva'}">
    <input type="checkbox" name="${name}" value="${m.id}" ${sel.includes(m.id) ? 'checked' : ''}> ${esc(m.nombre)}${m.activa ? '' : ' <small>(inactiva)</small>'}</label>`).join('')}</div>`;
  zona.innerHTML = `<div class="panel-edit">
    <form class="fila-acciones" data-f="rol"><label style="font-weight:800">Rol
      <select name="rol" ${yo ? 'disabled' : ''}>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${u.rol === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${yo ? '<span class="meta">No podés cambiar tu propio rol.</span>' : '<button class="btn-s v" type="submit">Guardar rol</button>'}</form>
    ${u.rol === 'alumno' ? `<form data-f="mats"><b>Aulas donde está inscripto</b>${checks(u.materias, 'mat')}
      <div style="margin-top:10px"><button class="btn-s v" type="submit">Guardar aulas</button></div></form>`
      : `<form data-f="da"><b>Materias que da como profe</b>${checks(da, 'mat')}
      <div style="margin-top:10px"><button class="btn-s v" type="submit">Guardar materias</button></div></form>`}
    ${yo ? '' : `<div class="fila-acciones">${u.estado === 'baja' || u.estado === 'pendiente'
      ? '<button class="btn-s n" type="button" data-activar>Activar</button>' : '<button class="btn-s r" type="button" data-baja>Dar de baja</button>'}</div>`}
  </div>`;
  const recargar = () => vistaUsuarios();
  zona.querySelector('[data-f=rol]').onsubmit = async (e) => { e.preventDefault(); const rol = e.target.rol.value;
    if (rol === u.rol) return;
    if (rol === 'admin' && !confirm(`¿Hacer admin a ${nombre(u)}? Va a poder ver y cambiar todo.`)) return;
    await accion(e.submitter, () => api.cambiarRol(u.id, rol), `${nombre(u)} ahora es ${ROLES[rol]}`); recargar(); };
  const fm = zona.querySelector('[data-f=mats]');
  if (fm) fm.onsubmit = async (e) => { e.preventDefault();
    const ids = [...fm.querySelectorAll('input:checked')].map((i) => Number(i.value));
    await accion(e.submitter, () => api.setInscripciones(u.id, ids), 'Aulas actualizadas'); recargar(); };
  const fd = zona.querySelector('[data-f=da]');
  if (fd) fd.onsubmit = async (e) => { e.preventDefault();
    const ids = [...fd.querySelectorAll('input:checked')].map((i) => Number(i.value));
    const cambiadas = mats.filter((m) => ids.includes(m.id) !== da.includes(m.id));
    await accion(e.submitter, async () => {
      for (const m of cambiadas) {
        const actuales = asig.filter((a) => a.materia_id === m.id).map((a) => a.profe_id);
        await api.setProfes(m.id, ids.includes(m.id) ? [...actuales, u.id] : actuales.filter((x) => x !== u.id));
      }
    }, 'Materias actualizadas');
    if (u.id === perfil.id) misMats = await api.misMaterias(perfil);
    recargar(); };
  zona.querySelector('[data-activar]')?.addEventListener('click', async (e) => {
    await accion(e.currentTarget, () => api.cambiarEstado(u.id, 'activo'), 'Usuario activado'); armarNav(); recargar(); });
  zona.querySelector('[data-baja]')?.addEventListener('click', async (e) => {
    if (!confirm(`¿Dar de baja a ${nombre(u)}? Deja de ver el aula, pero no se borra nada.`)) return;
    await accion(e.currentTarget, () => api.cambiarEstado(u.id, 'baja'), 'Usuario dado de baja'); recargar(); });
}

// ---------------- Admin: materias ----------------
async function vistaAdminMaterias() {
  const [mats, asig, us] = await Promise.all([api.todasLasMaterias(), api.asignaciones(), api.usuarios()]);
  const staff = us.filter((u) => u.rol !== 'alumno' && u.estado === 'activo');
  const cuenta = (id) => us.filter((u) => u.rol === 'alumno' && u.estado === 'activo' && u.materias.includes(id)).length;
  const grupos = Object.keys(NIVELES).map((n) => [n, mats.filter((m) => m.nivel === n)]).filter(([, l]) => l.length);
  pintar(`
  <div class="titulo-aula"><div><h1>Materias</h1><p>Activá las aulas que se usan, asignales profe y entrá a cada una.</p></div></div>
  <details class="desplegable caja" style="margin-bottom:18px"><summary class="btn-s v">+ Nueva materia</summary>
    <form class="form-aula" id="form-mat">
      <label>Nombre<input name="nombre" required placeholder="Ej: Inglés · Nivel inicial"></label>
      <label>Nivel<select name="nivel">${Object.entries(NIVELES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>Color<select name="color"><option value="#8D53FF">Violeta</option><option value="#FEAD34">Naranja</option><option value="#16BCC4">Turquesa</option><option value="#AFBD32">Verde</option></select></label>
      <label class="check"><input type="checkbox" name="activa" checked> Activa</label>
      <div class="full"><button class="btn-s v" type="submit">Crear materia</button></div></form></details>
  ${grupos.map(([n, l]) => `<h2 class="sub">${NIVELES[n]}</h2><div class="lista">${l.map((m) => {
    const ps = asig.filter((a) => a.materia_id === m.id).map((a) => staff.find((s) => s.id === a.profe_id)).filter(Boolean);
    return `<article class="item" data-id="${m.id}">
      <div class="item-cab"><div><h3><span aria-hidden="true" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${esc(m.color)};margin-right:8px"></span>${esc(m.nombre)}</h3>
        <span class="meta">${ps.length ? 'Profe: ' + esc(ps.map(nombre).join(', ')) : 'Sin profe asignado'} · ${cuenta(m.id)} alumnos</span></div>
        <div class="chips">${m.activa ? '<span class="chip-s ok">Activa</span>' : '<span class="chip-s">Inactiva</span>'}</div></div>
      <div class="fila-acciones"><a class="btn-s v" href="#/materia/${m.id}">Entrar al aula</a>
        <button class="btn-s b" type="button" data-editar>Profes y estado</button></div><div data-zona></div></article>`;
  }).join('')}</div>`).join('')}`);
  document.getElementById('form-mat').onsubmit = async (e) => { e.preventDefault(); const d = datosForm(e.target);
    await accion(e.submitter, () => api.crearMateria({ nombre: d.nombre.trim(), nivel: d.nivel, color: d.color, activa: e.target.activa.checked, orden: 100 }), 'Materia creada');
    vistaAdminMaterias(); };
  $app.querySelectorAll('article[data-id]').forEach((art) => {
    const m = mats.find((x) => x.id === Number(art.dataset.id));
    art.querySelector('[data-editar]').onclick = () => {
      const zona = art.querySelector('[data-zona]'); if (zona.innerHTML) { zona.innerHTML = ''; return; }
      const act = asig.filter((a) => a.materia_id === m.id).map((a) => a.profe_id);
      zona.innerHTML = `<form class="panel-edit">
        <label class="opcion" style="max-width:320px"><input type="checkbox" name="activa" ${m.activa ? 'checked' : ''}> Activa (los alumnos pueden pedirla al inscribirse)</label>
        <b>Profes de esta materia</b>
        ${staff.length ? `<div class="opciones">${staff.map((s) => `<label class="opcion"><input type="checkbox" name="profe" value="${s.id}" ${act.includes(s.id) ? 'checked' : ''}> ${esc(nombre(s))} <small>(${ROLES[s.rol]})</small></label>`).join('')}</div>`
          : '<p class="meta">No hay profes activos. Cargalos en <a href="#/admin/personal">Personal</a>.</p>'}
        <div><button class="btn-s v" type="submit">Guardar</button></div></form>`;
      zona.querySelector('form').onsubmit = async (e) => { e.preventDefault(); const f = e.target;
        const ids = [...f.querySelectorAll('input[name=profe]:checked')].map((i) => i.value);
        await accion(e.submitter, async () => {
          if (f.activa.checked !== m.activa) await api.editarMateria(m.id, { activa: f.activa.checked });
          await api.setProfes(m.id, ids);
        }, 'Materia actualizada');
        misMats = await api.misMaterias(perfil); vistaAdminMaterias(); };
    };
  });
}

// ---------------- Admin: personal ----------------
async function vistaPersonal() {
  const lista = await api.personal();
  pintar(`
  <div class="titulo-aula"><div><h1>Personal</h1>
    <p>Cargá el mail de cada profe <b>antes</b> de que entre al aula: cuando entre con ese mail, queda activo como profe automáticamente.</p></div></div>
  <form class="caja form-aula" id="form-pers" style="margin-bottom:22px">
    <label>Nombre<input name="nombre" required placeholder="Ej: Iván Rellip"></label>
    <label>Mail (el que usa para entrar)<input name="email" type="email" required placeholder="nombre@gmail.com"></label>
    <label>Rol<select name="rol"><option value="profe">Profe</option><option value="admin">Admin</option></select></label>
    <div class="full"><button class="btn-s v" type="submit">Agregar</button></div></form>
  ${lista.length ? `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Nombre</th><th>Mail</th><th>Rol</th><th></th></tr></thead><tbody>
    ${lista.map((p) => `<tr><td>${esc(p.nombre || '—')}</td><td>${esc(p.email)}</td><td>${ROLES[p.rol]}</td>
      <td><button class="btn-s r" type="button" data-email="${esc(p.email)}">Quitar</button></td></tr>`).join('')}</tbody></table></div>` : vacio('Todavía no hay personal cargado.')}
  <p class="meta" style="margin-top:14px">Si un profe ya entró antes de estar en esta lista, quedó como "pendiente": buscalo en <a href="#/admin/pendientes">Pendientes</a> y tocá "Es profe", o cambiale el rol en <a href="#/admin/usuarios">Usuarios</a>.</p>`);
  document.getElementById('form-pers').onsubmit = async (e) => { e.preventDefault(); const d = datosForm(e.target);
    await accion(e.submitter, () => api.agregarPersonal({ nombre: d.nombre.trim(), email: d.email, rol: d.rol }), 'Agregado'); vistaPersonal(); };
  $app.querySelectorAll('[data-email]').forEach((b) => { b.onclick = async () => {
    if (!confirm(`¿Quitar ${b.dataset.email} de la lista? (No borra su usuario si ya entró.)`)) return;
    await accion(b, () => api.borrarPersonal(b.dataset.email), 'Quitado'); vistaPersonal(); }; });
}

// ---------------- Inicio ----------------
if (!modoMock) api.alCambiarSesion((ev, s) => {
  if (ev === 'SIGNED_OUT') { perfil = null; uidActual = null; arrancar(); }
  else if (ev === 'SIGNED_IN' && s?.user?.id !== uidActual) arrancar();
});
arrancar();
