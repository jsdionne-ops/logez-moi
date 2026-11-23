(() => {
  const API = 'https://room-availability-calendar-api.jsdionne.chatgpt.site';
  const propertyDetails = {
    standre_1200: 'boulevard.html',
    lasalle_3881: 'verdun.html',
  };
  const weekdayLabels = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  const monthFormatter = new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dateFormatter = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const longDateFormatter = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeZone: 'UTC' });
  const state = { calendars: [], failed: [], propertyId: null, start: '', end: '', view: new Date(), onConfirm: null, loading: false };

  const isoDate = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  const fromIso = value => new Date(`${value}T00:00:00Z`);
  const addDays = (value, days) => { const date = fromIso(value); date.setUTCDate(date.getUTCDate() + days); return isoDate(date); };
  const nightCount = (start, end) => start && end ? Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) : 0;
  const formatDate = value => value ? longDateFormatter.format(fromIso(value)) : 'Choisir';
  const todayIso = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };

  async function api(path) {
    const response = await fetch(`${API}${path}`, { credentials: 'include', headers: { accept: 'application/json' } });
    let data;
    try { data = await response.json(); } catch { throw new Error('Réponse invalide du service de calendriers.'); }
    if (!response.ok) throw new Error(data.error || 'Les calendriers ne sont pas accessibles pour le moment.');
    return data;
  }

  function ensureOverlay() {
    let overlay = document.querySelector('#room-calendar-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'room-calendar-overlay';
    overlay.className = 'room-calendar-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <button class="room-calendar-scrim" type="button" aria-label="Fermer le calendrier" data-calendar-close></button>
      <section class="room-calendar-dialog" role="dialog" aria-modal="true" aria-labelledby="room-calendar-title">
        <header class="room-calendar-header">
          <div><h2 id="room-calendar-title">Choisissez vos dates</h2><span class="room-calendar-nights" id="room-calendar-nights">Séjour minimum de 31 nuits</span><p id="room-calendar-range">Dates affichées selon les calendriers Airbnb.</p></div>
          <div class="room-calendar-selected"><button type="button" data-calendar-slot="start"><small>ARRIVÉE</small><strong id="room-calendar-start">Choisir</strong></button><button type="button" data-calendar-slot="end"><small>DÉPART</small><strong id="room-calendar-end">Choisir</strong></button></div>
          <button class="room-calendar-x" type="button" aria-label="Fermer" data-calendar-close>×</button>
        </header>
        <div class="room-calendar-nav"><button type="button" aria-label="Mois précédent" data-calendar-prev>‹</button><span id="room-calendar-month-a"></span><span id="room-calendar-month-b"></span><button type="button" aria-label="Mois suivant" data-calendar-next>›</button></div>
        <div class="room-calendar-months"><div class="room-calendar-grid" id="room-calendar-grid-a"></div><div class="room-calendar-grid" id="room-calendar-grid-b"></div></div>
        <div class="room-calendar-status" id="room-calendar-status" role="status" aria-live="polite"></div>
        <footer class="room-calendar-footer"><span class="room-calendar-legend"><i></i>Dates déjà réservées</span><div><button class="room-calendar-clear" type="button" data-calendar-clear>Effacer les dates</button><button class="button" type="button" data-calendar-confirm disabled>Utiliser ces dates</button></div></footer>
      </section>`;
    document.body.append(overlay);
    overlay.addEventListener('click', event => {
      if (event.target.closest('[data-calendar-close]')) closeCalendar();
      if (event.target.closest('[data-calendar-prev]')) { state.view.setUTCMonth(state.view.getUTCMonth() - 1); renderCalendar(); }
      if (event.target.closest('[data-calendar-next]')) { state.view.setUTCMonth(state.view.getUTCMonth() + 1); renderCalendar(); }
      if (event.target.closest('[data-calendar-clear]')) { state.start = ''; state.end = ''; renderCalendar(); }
      const slot = event.target.closest('[data-calendar-slot]');
      if (slot) { if (slot.dataset.calendarSlot === 'start') state.end = ''; else if (state.start) state.end = ''; renderCalendar(); }
      const day = event.target.closest('[data-calendar-day]');
      if (day && !day.disabled) chooseDay(day.dataset.calendarDay);
      if (event.target.closest('[data-calendar-confirm]') && !event.target.closest('[data-calendar-confirm]').disabled) {
        const callback = state.onConfirm;
        const start = state.start, end = state.end;
        closeCalendar();
        if (callback) callback(start, end);
      }
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !overlay.hidden) closeCalendar(); });
    return overlay;
  }

  function activeCalendars() {
    return state.calendars.filter(item => !state.propertyId || item.property.id === state.propertyId);
  }
  function busyOn(calendar, date) { return calendar.busy.some(range => range.start <= date && range.end > date); }
  function availableForRange(calendar, start, end) { return !calendar.busy.some(range => range.start < end && range.end > start); }
  function anyAvailableForRange(start, end) { return activeCalendars().some(calendar => availableForRange(calendar, start, end)); }
  function dayBlocked(date) {
    const calendars = activeCalendars();
    if (!calendars.length) return true;
    if (state.propertyId) return busyOn(calendars[0], date);
    return calendars.every(calendar => busyOn(calendar, date));
  }
  function dateDisabled(date) {
    if (date < todayIso()) return true;
    if (!state.start || (state.end && nightCount(state.start,state.end)>=31)) return dayBlocked(date);
    if (date <= state.start) return dayBlocked(date);
    const nights = nightCount(state.start, date);
    if (nights < 31) return !anyAvailableForRange(state.start,date);
    return !anyAvailableForRange(state.start, date);
  }

  function chooseDay(date) {
    if (!state.start || (state.end && nightCount(state.start,state.end)>=31) || date <= state.start) {
      if (dayBlocked(date)) return;
      state.start = date;
      state.end = '';
    } else {
      state.end = date;
    }
    renderCalendar();
  }

  function renderMonth(year, month, target) {
    const container = document.querySelector(target);
    const heading = document.querySelector(target.endsWith('-a') ? '#room-calendar-month-a' : '#room-calendar-month-b');
    const first = new Date(Date.UTC(year, month, 1));
    heading.textContent = monthFormatter.format(first);
    container.replaceChildren();
    weekdayLabels.forEach(label => { const day = document.createElement('span'); day.className = 'room-calendar-weekday'; day.textContent = label; container.append(day); });
    const offset = first.getUTCDay();
    for (let index = 0; index < offset; index++) { const blank = document.createElement('span'); blank.className = 'room-calendar-blank'; container.append(blank); }
    const totalDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let number = 1; number <= totalDays; number++) {
      const date = isoDate(new Date(Date.UTC(year, month, number)));
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'room-calendar-day';
      button.textContent = String(number);
      button.dataset.calendarDay = date;
      const selected = date === state.start || date === state.end;
      const inRange = state.start && state.end && date > state.start && date < state.end;
      if (selected) button.classList.add('selected');
      if (inRange) button.classList.add('in-range');
      const blocked = dayBlocked(date);
      if (blocked) button.classList.add('busy');
      button.disabled = dateDisabled(date);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.setAttribute('aria-label', `${formatDate(date)}${blocked ? ', non disponible' : ''}`);
      container.append(button);
    }
  }

  function renderCalendar() {
    const year = state.view.getUTCFullYear(), month = state.view.getUTCMonth();
    renderMonth(year, month, '#room-calendar-grid-a');
    renderMonth(year, month + 1, '#room-calendar-grid-b');
    document.querySelector('#room-calendar-start').textContent = state.start ? dateFormatter.format(fromIso(state.start)) : 'Choisir';
    document.querySelector('#room-calendar-end').textContent = state.end ? dateFormatter.format(fromIso(state.end)) : 'Choisir';
    const nights = nightCount(state.start, state.end);
    document.querySelector('#room-calendar-nights').textContent = nights ? `${nights} nuit${nights === 1 ? '' : 's'}` : 'Séjour minimum de 31 nuits';
    const label = state.propertyId ? activeCalendars()[0]?.property.label : 'Recherche parmi les logements';
    document.querySelector('#room-calendar-title')?.replaceChildren(document.createTextNode(label || 'Choisissez vos dates'));
    const status = document.querySelector('#room-calendar-status');
    status.classList.toggle('minimum', nights>0 && nights<31);
    if (state.failed.length) status.textContent = `Calendrier(s) indisponible(s) : ${state.failed.length}. Les dates devront être vérifiées manuellement.`;
    else if (state.start && state.end && nights < 31) status.textContent = `Vous avez sélectionné ${nights} nuit(s). La location touristique de courte durée est réglementée à Montréal. ROOM propose ici des séjours de 31 nuits minimum. Pour cette arrivée, choisissez un départ le ${formatDate(addDays(state.start,31))} ou après.`;
    else if (state.start && state.end && !anyAvailableForRange(state.start, state.end)) status.textContent = 'Aucun logement ne semble libre pour toute cette période. Essayez d’autres dates.';
    else if (state.start && state.end) status.textContent = 'Au moins un logement semble libre. La disponibilité finale sera confirmée par ROOM.';
    else status.textContent = state.loading ? 'Lecture des calendriers Airbnb…' : 'Les jours grisés sont déjà occupés.';
    document.querySelector('[data-calendar-confirm]').disabled = !(state.start && state.end && nights >= 31 && anyAvailableForRange(state.start, state.end));
  }

  async function openCalendar(propertyId, onConfirm) {
    const overlay = ensureOverlay();
    state.calendars=[]; state.failed=[];
    overlay.querySelector('[data-calendar-confirm]').textContent=propertyId?'Demander de réserver':'Utiliser ces dates';
    state.propertyId = propertyId || null;
    state.start = '';
    state.end = '';
    state.onConfirm = onConfirm;
    state.loading = true;
    state.view = new Date();
    state.view.setUTCDate(1);
    overlay.hidden = false;
    document.body.classList.add('room-calendar-open');
    document.querySelector('#room-calendar-status').textContent = 'Lecture des calendriers Airbnb…';
    renderCalendar();
    try {
      const query = propertyId ? `?property=${encodeURIComponent(propertyId)}` : '';
      const result = await api(`/api/calendars${query}`);
      state.calendars = result.calendars || [];
      state.failed = result.failed || [];
      if (!result.complete) state.failed = result.failed || [];
    } catch (error) {
      state.calendars = [];
      state.failed = ['service'];
      document.querySelector('#room-calendar-status').textContent = `Impossible de lire les calendriers : ${error.message}`;
    } finally {
      state.loading = false;
      renderCalendar();
    }
  }

  function closeCalendar() {
    const overlay = document.querySelector('#room-calendar-overlay');
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove('room-calendar-open');
  }

  function setDateValue(input, value) {
    if (!input) return;
    input.value = value;
    input.dataset.isoDate = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function requestStay(unit,start,end,guests) {
    const dialog=document.createElement('dialog'); dialog.className='room-request';
    dialog.innerHTML=`<form class="request-form" method="post" action="https://formsubmit.co/jsdionne@roomcollective.ca">
      <button type="button" class="room-calendar-x" aria-label="Fermer">×</button><h2>Demande de réservation</h2><p class="summary"></p>
      <label>Votre nom<input name="Nom" autocomplete="name" required maxlength="120"></label>
      <label>Adresse courriel<input name="email" type="email" autocomplete="email" required></label>
      <label>Numéro de téléphone<input name="Téléphone" type="tel" autocomplete="tel" required pattern="[+0-9() .\\-]{7,25}" maxlength="25"></label>
      <p>ROOM vous répondra pour confirmer le tarif et le séjour. Cette demande ne bloque aucune date.</p>
      <p role="status"></p><button type="submit" class="button">Envoyer ma demande</button></form>`;
    const f=dialog.querySelector('form'); f.querySelector('[type=tel]').removeAttribute('pattern');
    f.querySelector('.summary').textContent=unit.name+' · '+formatDate(start)+' au '+formatDate(end)+' · '+nightCount(start,end)+' nuits';
    for(const [key,value] of Object.entries({Logement:unit.name,Arrivée:start,Départ:end,Nuits:nightCount(start,end),...(guests?{Personnes:guests}:{}),_subject:'Logez-moi — Demande de réservation : '+unit.name,_cc:'alex@roomcollective.ca',_template:'table'})){
      const field=document.createElement('input');field.type='hidden';field.name=key;field.value=value;f.append(field);
    }
    f.querySelector('[type=button]').onclick=()=>dialog.close();
    f.onsubmit=async e=>{e.preventDefault();const submit=f.querySelector('[type=submit]'),status=f.querySelector('[role=status]');submit.disabled=true;
      try{const data=await api('/api/availability?arrival='+start+'&departure='+end+'&guests='+(guests||1));
        if(!data.results.some(x=>x.id===unit.id)){status.textContent='Ces dates ne peuvent plus être confirmées. Veuillez refaire la recherche.';submit.disabled=false;return;}
        HTMLFormElement.prototype.submit.call(f);
      }catch{status.textContent='Impossible de vérifier les dates. Veuillez réessayer.';submit.disabled=false;}
    };
    document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
  }
  function renderSearchResults(data) {
    const target=document.querySelector('#availability-results');target.replaceChildren();
    const caps={"esplanade_4801": 2, "villeneuve_155a": 4, "standre_1198": 8, "beaudry_f1597": 2, "villeneuve_155": 4, "villeneuve_159": 6}; data.results=data.results.filter(u=>!caps[u.id]||caps[u.id]>=data.guests); const status=document.createElement('p');status.className='availability-summary';status.textContent=data.results.length+' logement(s) libre(s) pour toute la période · '+data.feedsChecked+' / '+data.feedsTotal+' calendriers vérifiés.';target.append(status);
    for(const unit of data.results){const card=document.createElement('article');card.className='available-property';
      const h=document.createElement('h3');h.textContent=unit.name;card.append(h);
      if(!unit.details)unit.details=unit.id+'.html';if(unit.details){const a=document.createElement('a');a.href=unit.details;a.textContent='Voir la fiche';card.append(a);}
      const btn=document.createElement('button');btn.className='button';btn.type='button';btn.textContent='Demander de réserver';btn.onclick=()=>requestStay(unit,data.arrival,data.departure,data.guests);card.append(btn);target.append(card);}
  }
  function installGlobalSearch() {
    const form = document.querySelector('#request-form');
    if (!form) return;
    const arrival = document.querySelector('#arrival');
    const departure = document.querySelector('#departure');
    const open = document.querySelector('[data-open-global-calendar]');
    const search = document.querySelector('#search-availability');
    const guest = document.querySelector('#guests');
    const preferredRaw = new URLSearchParams(location.search).get('propriete');
    const preferred = ({ verdun: 'lasalle_3881', boulevard: 'standre_1200' })[preferredRaw] || preferredRaw;
    const queryArrival = new URLSearchParams(location.search).get('arrivee');
    const queryDeparture = new URLSearchParams(location.search).get('depart');
    if (queryArrival) setDateValue(arrival, queryArrival);
    if (queryDeparture) setDateValue(departure, queryDeparture);
    const setButtonLabel = () => {
      if (!open) return;
      open.textContent = arrival.value && departure.value ? `${dateFormatter.format(fromIso(arrival.value))} — ${dateFormatter.format(fromIso(departure.value))}` : 'Choisir les dates';
    };
    open?.addEventListener('click', () => openCalendar(null, (start, end) => { setDateValue(arrival, start); setDateValue(departure, end); setButtonLabel(); }));
    setButtonLabel();
    const runSearch = async () => {
      const start = arrival.value, end = departure.value;
      if (!start || !end || nightCount(start, end) < 31) {
        document.querySelector('#availability-results').textContent = 'Choisissez une période d’au moins 31 nuits.';
        return;
      }
      search.disabled = true;
      search.textContent = 'Recherche en cours…';
      try {
        const data = await api(`/api/availability?arrival=${encodeURIComponent(start)}&departure=${encodeURIComponent(end)}&guests=${encodeURIComponent(guest.value || '1')}`);
        renderSearchResults(data, preferred);
      } catch (error) {
        const target = document.querySelector('#availability-results');
        target.textContent = `La vérification en ligne a échoué : ${error.message} Les disponibilités devront être vérifiées manuellement.`;
      } finally { search.disabled = false; search.textContent = 'Rechercher tous les logements'; }
    };
    search?.addEventListener('click', runSearch);
    if (queryArrival && queryDeparture) runSearch();
    form.addEventListener('submit',event=>{event.preventDefault();runSearch();});
    for(const el of [arrival,departure,guest])el.addEventListener('change',()=>document.querySelector('#availability-results').replaceChildren());
  }

  function installDetailCalendar() {
    document.querySelectorAll('[data-open-room-calendar]').forEach(button => {
      button.addEventListener('click', () => openCalendar(button.dataset.openRoomCalendar, (start, end) => {
        const propertyId = button.dataset.openRoomCalendar;
        const unit=state.calendars.find(x=>x.property.id===propertyId)?.property;
        if(unit)requestStay({id:unit.id,name:unit.label},start,end);
      }));
    });
  }

  document.addEventListener('DOMContentLoaded', () => { installGlobalSearch(); installDetailCalendar(); });
})();
