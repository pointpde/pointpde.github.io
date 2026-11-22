// Menú móvil
const burger = document.querySelector('.burger');
const menu = document.querySelector('.menu');
if (burger && menu) {
  burger.addEventListener('click', () => {
    const abierto = menu.classList.toggle('abierto');
    burger.setAttribute('aria-expanded', abierto);
  });
}

// Pestañas genéricas: [data-tabs] con botones [role=tab][aria-controls]
document.querySelectorAll('[data-tabs]').forEach((grupo) => {
  const tabs = grupo.querySelectorAll('[role="tab"]');
  const activar = (tab) => {
    tabs.forEach((t) => {
      const sel = t === tab;
      t.setAttribute('aria-selected', sel);
      t.tabIndex = sel ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !sel;
    });
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => activar(t));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
      const sig = tabs[(i + dir + tabs.length) % tabs.length];
      sig.focus(); activar(sig);
    });
  });
  // abrir pestaña por hash (#ingles, etc.)
  const hash = location.hash.slice(1);
  const porHash = hash && grupo.querySelector(`[aria-controls="p-${hash}"]`);
  if (porHash) activar(porHash);
});

// Formulario de contacto → WhatsApp
const form = document.getElementById('form-contacto');
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = new FormData(form);
    const msg = `Hola Point! Soy ${d.get('nombre') || ''}.\n` +
      `Me interesa: ${d.get('nivel')} (${d.get('modalidad')}).\n` +
      (d.get('mensaje') ? `${d.get('mensaje')}` : '');
    window.open('https://wa.me/5493816111359?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  });
}

// Demo del aula: login simulado
const loginForm = document.getElementById('login-demo');
if (loginForm) {
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const nombre = (new FormData(loginForm).get('usuario') || '').trim().split(/[\s@.]/)[0] || 'Sofi';
    document.querySelectorAll('[data-nombre]').forEach((el) => {
      el.textContent = nombre.charAt(0).toUpperCase() + nombre.slice(1);
    });
    document.getElementById('pantalla-login').hidden = true;
    document.getElementById('pantalla-aula').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}
const salir = document.getElementById('salir-demo');
if (salir) {
  salir.addEventListener('click', () => {
    document.getElementById('pantalla-aula').hidden = true;
    document.getElementById('pantalla-login').hidden = false;
  });
}

// Visor de beneficios (Círculo Point)
const visor = document.getElementById('visor');
if (visor) {
  const img = visor.querySelector('img');
  const txt = visor.querySelector('p');
  document.querySelectorAll('.beneficio').forEach((btn) => {
    btn.addEventListener('click', () => {
      img.src = btn.dataset.full; img.alt = btn.dataset.alt; txt.textContent = btn.dataset.alt;
      visor.showModal();
    });
  });
  visor.querySelector('.cerrar').addEventListener('click', () => visor.close());
  visor.addEventListener('click', (e) => { if (e.target === visor) visor.close(); });
}
