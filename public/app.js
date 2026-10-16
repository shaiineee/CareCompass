(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const dateLabel = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' });
  const dayAfter = (date, count) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10); };
  const timeLabel = time => new Date(`2000-01-01T${time}:00`).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  const activeTasks = () => state?.tasks.filter(task => !task.archived) || [];
  const dueTasks = date => activeTasks().filter(task => date >= (task.startDate || state.createdAt.slice(0, 10)) && (!task.endDate || date <= task.endDate) && (task.frequency === 'daily' || task.date === date));
  const kinds = { medication: ['Rx', 'Medication', 'medicine'], checkin: ['✓', 'Care check', 'check'], teachback: ['Aa', 'Understanding', 'learn'], care: ['♡', 'Care task', 'check'] };
  let state, health, draft, selectedDate, weekStart, reminderTimer, toastTimer, sharePreviewId;
  let calendarRequest = 0;
  let selectedTaskId = null;
  let currentView = 'home';
  let chatPending = false;
  let scanPending = false;
  const announced = new Set();

  async function api(path, options = {}) {
    const { timeout = 20000, ...requestOptions } = options;
    const form = options.body instanceof FormData;
    const response = await fetch(`/api${path}`, {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(timeout), ...requestOptions,
      headers: { 'X-CareCompass-Client': 'web', ...(form ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
      body: options.body === undefined ? undefined : form ? options.body : JSON.stringify(options.body)
    }).catch(error => { throw new Error(error.name === 'TimeoutError' ? 'The server took too long to respond. Please try again.' : 'CareCompass could not reach the server. Check that npm start is still running, then retry.'); });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'This action could not be completed. Please try again.');
    }
    return response.headers.get('content-type')?.includes('application/json') ? response.json() : response.text();
  }
  function toast(text, duration = 5500) {
    clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, duration);
  }
  function showError(error) { toast(error.message || 'Please try again.', 9000); $('#live-region').textContent = error.message || 'The action failed.'; }
  async function busy(button, action) {
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try { await action(); } catch (error) { showError(error); }
    finally { if (button?.isConnected) button.disabled = false; }
  }
  function openDialog(dialog) { if (!dialog.open) dialog.showModal(); document.body.classList.add('modal-open'); }
  function closeDialog(dialog) { dialog.close(); if (!$('dialog[open]')) document.body.classList.remove('modal-open'); }

  async function refresh() {
    state = await api('/state');
    selectedDate ||= state.today; weekStart ||= state.today;
    $('#connection-status').textContent = 'Your care records are saved on this computer.';
    $('#connection-status').classList.remove('is-error');
    renderHome(); renderProfile(); renderHistory(); renderSource(); renderCareCircle();
    if (currentView === 'calendar') await renderCalendar();
    await refreshReminderInbox();
  }
  async function initialize() {
    $('#task-list').innerHTML = '<p class="empty-state">Loading your care plan…</p>';
    try {
      await checkAuth();
      await refresh(); renderMessages();
      const initialView = location.hash.slice(1);
      showView(['home', 'checkin', 'ask', 'calendar', 'caregiver', 'setup'].includes(initialView) ? initialView : 'home');
      health = await api('/health', { timeout: 30000 }); renderServiceStatus();
      clearInterval(reminderTimer); reminderTimer = setInterval(checkReminders, 30000); checkReminders();
    } catch (error) {
      $('#connection-status').classList.add('is-error');
      $('#connection-status').innerHTML = `${escape(error.message)} <button class="text-button" type="button" data-action="retry-connection">Retry connection</button>`;
    }
  }
  function showView(name) {
    if (!state) return;
    currentView = name;
    $$('[data-view]').forEach(view => { view.hidden = view.dataset.view !== name; view.classList.toggle('is-visible', !view.hidden); });
    $$('[data-view-target]').forEach(button => { const active = button.dataset.viewTarget === name; button.classList.toggle('is-active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    history.replaceState(null, '', `#${name}`); window.scrollTo({ top: 0, behavior: 'smooth' });
    const heading = $(`#view-${name} h2`);
      if (heading) { document.title = `${heading.textContent} · CareCompass`; heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    if (name === 'calendar') renderCalendar().catch(showError);
    if (name === 'caregiver') renderCareCircle();
    if (name === 'checkin') updateCheckinTitle();
    if (name === 'setup') renderSetup().catch(showError);
  }

  function renderHome() {
    $('#today-label').textContent = dateLabel(state.today);
    const tasks = dueTasks(state.today);
    $('#task-list').innerHTML = tasks.length ? tasks.map(task => {
      const [icon, label, css] = kinds[task.type] || kinds.care;
      const done = task.completedDates.includes(state.today);
      const [clock, period] = timeLabel(task.time).split(' ');
      const action = task.type === 'checkin' ? 'go-checkin' : task.type === 'teachback' ? 'go-teachback' : 'complete-task';
      return `<article class="task-card${done ? ' is-complete' : ''}" data-task-id="${escape(task.id)}"><div class="task-time"><strong>${escape(clock)}</strong><span>${escape(period)}</span></div><div class="task-body"><div class="task-title-row"><span class="task-type ${css}" aria-hidden="true">${icon}</span><div><p class="task-kicker">${label}</p><h4>${escape(task.title)}</h4></div></div><p class="task-note">Open Explain steps to review your confirmed instructions.</p><div class="task-actions"><button class="button button-ghost" type="button" data-action="toggle-details" aria-expanded="false">Explain steps</button><button class="button button-primary" type="button" data-action="${done ? 'undo-task' : action}">${done ? '✓ Completed · undo' : task.type === 'checkin' ? '→ Start check-in' : task.type === 'teachback' ? 'Start teach-back' : '✓ Mark done'}</button></div><div class="task-details" hidden><h5>From your confirmed care plan</h5><p>${escape(task.instruction)}</p><ol>${(task.steps || [task.instruction]).map(step => `<li>${escape(step)}</li>`).join('')}</ol><button class="button button-ghost" type="button" data-action="ask-task">Ask about this task</button><button class="read-button" type="button" data-action="read-text">🔊 Read these steps aloud</button></div></div></article>`;
    }).join('') : '<div class="empty-state">There are no tasks scheduled for today. Add a confirmed care plan to get started.</div>';
    const count = tasks.filter(task => task.completedDates.includes(state.today)).length;
    const percent = tasks.length ? Math.round(count / tasks.length * 100) : 0;
    $('#completed-count').textContent = count; $('#total-count').textContent = tasks.length; $('#progress-percent').textContent = `${percent}%`;
    $('#progress-ring').style.setProperty('--progress', `${percent * 3.6}deg`); $('#progress-ring').setAttribute('aria-label', `${count} of ${tasks.length} tasks completed`);
    const next = state.reminders.filter(item => item.type === 'appointment' && item.date >= state.today).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
    $('.next-appointment h3').textContent = next?.title || 'No upcoming appointment';
    $('.next-appointment > p:not(.eyebrow)').textContent = next ? `${dateLabel(next.date)} · ${timeLabel(next.time)}` : 'You can add one in Calendar.';
  }
  function renderProfile() {
    const p = state.profile;
    const translated = {
      English: [`Good ${Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', hourCycle: 'h23' }).format(new Date())) < 12 ? 'morning' : Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', hourCycle: 'h23' }).format(new Date())) < 18 ? 'afternoon' : 'evening'}, ${p.name}`, 'Home', 'Check-in', 'Ask Compass', 'Calendar'],
      '简体中文': [`早上好，${p.name}`, '主页', '健康记录', '询问 Compass', '日历'],
      'Bahasa Melayu': [`Selamat pagi, ${p.name}`, 'Utama', 'Semakan', 'Tanya Compass', 'Kalendar'],
      'தமிழ்': [`காலை வணக்கம், ${p.name}`, 'முகப்பு', 'உடல்நிலை பதிவு', 'Compass இடம் கேளுங்கள்', 'நாள்காட்டி']
    }[p.language] || [`Good morning, ${p.name}`, 'Home', 'Check-in', 'Ask Compass', 'Calendar'];
    $('#home-title').textContent = translated[0];
    ['home', 'checkin', 'ask', 'calendar'].forEach((view, i) => $$(`.desktop-nav [data-view-target="${view}"] span:last-child, .mobile-nav [data-view-target="${view}"] small`).forEach(element => { element.textContent = translated[i + 1]; }));
    $('#current-language').textContent = p.language;
    document.body.classList.toggle('large-text', p.largeText); $('#text-size-button').setAttribute('aria-pressed', String(p.largeText));
    $('.profile-copy strong').textContent = p.name; $('.profile-button .avatar').textContent = p.name.slice(0, 1);
    $('.caregiver-chip strong').textContent = p.caregiver || 'No caregiver'; $('.caregiver-chip div > span').textContent = p.caregiverConsent ? 'Sharing allowed' : 'Sharing is off';
    $('.caregiver-chip .avatar').textContent = (p.caregiver || '?').slice(0, 1);
    $('.person-row strong').textContent = p.caregiver || 'Choose a caregiver'; $('.person-row small').textContent = 'Updates require your approval'; $('.permission-tag').textContent = p.caregiverConsent ? 'Allowed' : 'Off';
    $('.care-circle-card .status-dot').style.background = p.caregiverConsent ? '#2bb97a' : '#a9b5b2';
    const contact = $('[data-action="caregiver-help"] strong'); if (contact) contact.textContent = `Contact ${p.caregiver || 'caregiver'}`;
  }
  function renderHistory() {
    $('#checkin-history').innerHTML = state.checkIns.length ? state.checkIns.slice(-7).reverse().map(item => `<article class="history-entry${item.decision.level !== 'recorded' ? ' is-alert' : ''}"><time>${escape(new Date(item.date).toLocaleString('en-SG'))}</time><strong>${escape(item.taskTitle || 'Check-in')} · ${item.pain}/10 · ${escape(item.change)}</strong><p>${escape(item.notes || 'No additional notes')}</p><small>${escape(item.decision.rule)}</small></article>`).join('') : '<p>No check-ins yet. Your recorded answers will appear here.</p>';
  }
  function renderSource() {
    const plan = state.plans.filter(plan => plan.active).at(-1);
    $('.source-panel h3').textContent = plan?.name || 'No confirmed care plan'; $('.source-quote blockquote').textContent = plan?.sourceText || 'Add a plan and review its instructions before asking clinical questions.';
    $('.source-panel > p').textContent = plan ? `Confirmed ${new Date(plan.confirmedAt).toLocaleString('en-SG')}` : 'No source has been confirmed.';
  }
  function renderMessages() {
    const messages = state.messages.length ? state.messages : [{ role: 'assistant', text: 'How can I help you understand your confirmed care plan today?' }];
    $('#chat-thread').innerHTML = messages.map(messageMarkup).join(''); $('#chat-thread').scrollTop = $('#chat-thread').scrollHeight;
  }
  function messageMarkup(message) {
    const user = message.role === 'user';
    return `<div class="message ${user ? 'user-message' : 'compass-message'}${message.kind === 'urgent' ? ' is-urgent' : ''}"><span class="message-avatar" aria-hidden="true">${user ? escape(state.profile.name.slice(0, 1)) : '✦'}</span><div><p>${escape(message.text)}</p>${message.source ? `<small class="message-source">Confirmed source: ${escape(message.source)}</small>` : ''}${!user ? '<button class="read-inline" type="button" data-action="read-message">🔊 Read aloud</button>' : ''}${message.kind === 'urgent' ? '<p><button class="button button-primary" type="button" data-action="open-assistance">Medical Assistance</button></p>' : ''}</div></div>`;
  }
  async function sendChat(text) {
    if (chatPending || !text.trim()) return;
    chatPending = true; const button = $('.send-button'); button.disabled = true;
    $('#chat-thread').insertAdjacentHTML('beforeend', `${messageMarkup({ role: 'user', text })}<p id="chat-loading" role="status">Checking the confirmed source…</p>`); $('#chat-thread').scrollTop = $('#chat-thread').scrollHeight;
    try {
      const response = await api('/chat', { method: 'POST', body: { message: text, mode: $('#chat-mode').value }, timeout: 40000 });
      $('#chat-loading')?.remove(); $('#chat-thread').insertAdjacentHTML('beforeend', messageMarkup(response)); $('#chat-input').value = ''; await refresh();
    } catch (error) { $('#chat-loading')?.remove(); $('#chat-thread').insertAdjacentHTML('beforeend', `<p class="empty-state">Your message could not be confirmed as saved. ${escape(error.message)}</p>`); showError(error); }
    finally { chatPending = false; button.disabled = false; $('#chat-thread').scrollTop = $('#chat-thread').scrollHeight; }
  }

  function updateCheckinTitle() {
    const task = activeTasks().find(task => task.id === selectedTaskId && task.type === 'checkin') || activeTasks().find(task => task.type === 'checkin');
    selectedTaskId = task?.id || null; $('#checkin-title').textContent = task ? `Check-in: ${task.title}` : 'How are you feeling today?';
  }
  async function submitCheckIn(event) {
    event.preventDefault(); const formElement = event.currentTarget;
    await busy(event.submitter, async () => {
      updateCheckinTitle(); const form = new FormData(formElement);
      const item = await api('/checkins', { method: 'POST', body: { pain: Number(form.get('pain')), change: form.get('change'), notes: $('#checkin-notes').value, taskId: selectedTaskId } });
      const decision = item.decision; const result = $('#checkin-result');
      result.classList.toggle('is-alert', decision.level !== 'recorded');
      result.innerHTML = `<div class="result-heading"><span class="result-symbol">${decision.level === 'recorded' ? '✓' : '!'}</span><div><h3>${decision.level === 'urgent' ? 'Please get human help' : decision.level === 'review' ? 'Please arrange a care-team review' : 'Check-in saved'}</h3><p>${escape(decision.action)}</p></div></div><div class="decision-receipt"><div class="receipt-item"><span>Recorded facts</span><strong>${item.pain}/10 · ${escape(item.change)}</strong></div><div class="receipt-item"><span>Rule checked on the server</span><strong>${escape(decision.rule)}</strong></div><div class="receipt-item"><span>Outcome</span><strong>${escape(decision.level)}</strong></div></div><p>${escape(decision.reason)}</p><div class="result-actions"><button class="button button-primary" type="button" data-action="${decision.level === 'recorded' ? 'go-home' : 'open-assistance'}">${decision.level === 'recorded' ? 'Return home' : 'Medical Assistance'}</button><button class="button button-ghost" type="button" data-action="caregiver-help">Review caregiver update</button><button class="button button-ghost" type="button" data-action="professional-help">Download handover</button></div>`;
      result.hidden = false; await refresh(); result.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#live-region').textContent = decision.action; if (item.syncMessage) toast(item.syncMessage);
    });
  }

  function openUpload() {
    if (scanPending) return toast('Your document is still being read.');
    draft = null; $('#upload-step-select').hidden = false; $('#upload-step-processing').hidden = true; $('#upload-step-review').hidden = true;
    $('#care-plan-file').value = ''; $('#medicine-file').value = ''; $('#upload-error').hidden = true; $('#confirm-extraction').checked = false; $('#replace-plan').checked = false; $('[data-action="confirm-plan"]').disabled = true; openDialog($('#upload-modal'));
  }
  let cameraStream = null;
  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return toast('This browser cannot open the camera. Choose a photo instead.');
    // Some embedded browsers never answer the permission request, so give up after 10 seconds.
    try { cameraStream = await Promise.race([navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false }), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))]); }
    catch { return toast('Camera permission was blocked or no camera was found. Allow camera access or choose a photo instead.', 9000); }
    $('#camera-video').srcObject = cameraStream; $('#camera-panel').hidden = false;
  }
  function closeCamera() { cameraStream?.getTracks().forEach(track => track.stop()); cameraStream = null; $('#camera-video').srcObject = null; $('#camera-panel').hidden = true; }
  async function snapCamera() {
    const video = $('#camera-video'); if (!cameraStream || !video.videoWidth) return toast('The camera is still starting. Try again in a moment.');
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0);
    const photo = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    closeCamera(); await scan('medicine', photo);
  }
  async function scan(kind, photo) {
    if (scanPending) return; scanPending = true; $('#upload-error').hidden = true;
    $('#upload-step-select').hidden = true; $('#upload-step-processing').hidden = false; $('#upload-step-review').hidden = true;
    try {
      if (kind === 'demo') draft = await api('/plans/demo', { method: 'POST', body: {} });
      else if (kind === 'text') draft = await api('/plans/text', { method: 'POST', body: { sourceText: $('#source-input').value } });
      else if (kind === 'team') draft = await api('/integrations/tasks/review', { method: 'POST', body: {}, timeout: 30000 });
      else if (kind === 'medicine') {
        const file = photo || $('#medicine-file').files[0]; if (!file) throw new Error('Take or choose a photo of the medicine label first.'); if (file.size > 8 * 1024 * 1024) throw new Error('Choose a photo smaller than 8 MB.');
        const body = new FormData(); body.append('file', file, file.name || 'camera-photo.jpg'); draft = await api('/medicines/scan', { method: 'POST', body, timeout: 120000 });
      }
      else {
        const file = $('#care-plan-file').files[0]; if (!file) throw new Error('Choose a care-plan file first.'); if (file.size > 8 * 1024 * 1024) throw new Error('Choose a file smaller than 8 MB.');
        const body = new FormData(); body.append('file', file); draft = await api('/plans/upload', { method: 'POST', body, timeout: 120000 });
      }
      renderDraft();
    } catch (error) {
      $('#upload-step-select').hidden = false; $('#upload-step-processing').hidden = true; showError(error);
      // Toasts sit behind the open dialog, so repeat the message inside it.
      $('#upload-error').textContent = error.message || 'Please try again.'; $('#upload-error').hidden = false; $('#upload-error').scrollIntoView({ block: 'center' });
    }
    finally { scanPending = false; }
  }
  function renderDraft() {
    $('#upload-step-processing').hidden = true; $('#upload-step-review').hidden = false;
    $('#extraction-method').textContent = `Read using ${draft.method}. ${draft.confidence !== undefined ? `OCR confidence: ${draft.confidence}% (not clinical accuracy).` : ''} ${draft.aiStatus === 'connected-source-checked' ? 'AI-assisted extraction; source quotes checked.' : draft.aiStatus === 'connected-vision-label' ? 'AI vision read the medicine label.' :'Source-based extraction; AI is not active for this draft.'}`;
    $('#extraction-warning').textContent = draft.warning || 'Compare every instruction with the original. Choose the schedule only after checking it.';
    $('#review-source').textContent = draft.sourceText || 'No text could be read. Choose “Correct source wording” and paste the exact instructions.';
    $('#plan-name').value = draft.filename || 'My care plan'; $('#extraction-items').innerHTML = ''; draft.candidates.forEach(addExtractionRow);
    if (!draft.candidates.length && draft.sourceText) addExtractionRow({ instruction: draft.sourceText.split('\n').find(line => line.trim()) || '', title: '' });
    $('#confirm-extraction').checked = false; $('[data-action="confirm-plan"]').disabled = true; $('#extraction-items input')?.focus();
  }
  function addExtractionRow(item = {}) {
    const row = document.createElement('fieldset'); row.className = 'extracted-item';
    row.innerHTML = `<legend>Care task</legend><label class="field-label">Short title<input class="field-input" data-field="title" maxlength="120" value="${escape(item.title || '')}" required></label><label class="field-label">Exact instruction from the source<textarea data-field="instruction" rows="3" required>${escape(item.instruction || '')}</textarea></label><div class="extraction-grid"><label><span>Task type</span><select data-field="type">${Object.entries(kinds).map(([value, [, label]]) => `<option value="${value}"${item.type === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label><span>Time (confirm first)</span><input data-field="time" type="time" value="${escape(item.time || '')}" required></label><label><span>Repeat</span><select data-field="frequency"><option value="daily"${item.frequency === 'daily' ? ' selected' : ''}>Every day</option><option value="once"${item.frequency !== 'daily' ? ' selected' : ''}>One time</option></select></label><label><span>Start / one-time date</span><input data-field="date" type="date" value="${escape(item.date || state.today)}" required></label></div><button class="text-button remove-item" type="button" data-action="remove-extracted-task">Remove this task</button>`;
    if (item.analysis) {
      const a = item.analysis;
      row.insertAdjacentHTML('beforeend', `<div class="extraction-analysis${a.blockedSchedule ? ' is-blocked' : ''}"><strong>Fields found in the source</strong><p>Medicine: ${escape(a.medicationName || 'Not clearly extracted / not applicable')}<br>Written strength: ${escape(a.strengthText || 'Not found')}<br>Written amount: ${escape(a.doseText || 'Not found')}<br>Duration: ${a.durationDays ? `${a.durationDays} days` : 'Not stated'}</p>${a.warnings?.length ? `<ul>${a.warnings.map(warning => `<li>${escape(warning)}</li>`).join('')}</ul>` : ''}</div>`);
    }
    $('#extraction-items').append(row); $('#confirm-extraction').checked = false; $('[data-action="confirm-plan"]').disabled = true;
  }
  async function confirmPlan() {
    if (!draft || !$('#confirm-extraction').checked) return;
    if (!$$('#extraction-items input, #extraction-items textarea, #extraction-items select').every(field => field.reportValidity())) return;
    const tasks = $$('#extraction-items .extracted-item').map(row => Object.fromEntries([...row.querySelectorAll('[data-field]')].map(field => [field.dataset.field, field.value])));
    await api(`/plans/${draft.id}/confirm`, { method: 'POST', body: { confirmed: true, name: $('#plan-name').value, tasks, replace: $('#replace-plan').checked } });
    closeDialog($('#upload-modal')); await refresh(); toast('Confirmed care tasks are saved to Home and Calendar.');
  }

  async function renderCalendar() {
    if (!state) return; const request = ++calendarRequest;
    const events = await api(`/calendar?from=${weekStart}&to=${dayAfter(weekStart, 6)}`); if (request !== calendarRequest) return;
    $('.week-header h3').textContent = `${new Date(`${weekStart}T12:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })} – ${new Date(`${dayAfter(weekStart, 6)}T12:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    $('.day-strip').innerHTML = Array.from({ length: 7 }, (_, offset) => {
      const date = dayAfter(weekStart, offset); const d = new Date(`${date}T12:00:00Z`);
      return `<button type="button" class="day${selectedDate === date ? ' is-selected' : ''}" data-date="${date}" aria-pressed="${selectedDate === date}"><span>${d.toLocaleDateString('en-SG', { weekday: 'short' })}</span><strong>${d.getUTCDate()}</strong>${events.some(item => item.date === date && item.kind === 'reminder') ? '<i></i>' : ''}</button>`;
    }).join('');
    const items = events.filter(item => item.date === selectedDate);
    $('.agenda').innerHTML = `<div class="agenda-date"><p>${escape(dateLabel(selectedDate))}</p></div>${items.length ? items.map(item => {
      const css = (kinds[item.type] || kinds.care)[2];
      return `<article class="agenda-item"><time>${escape(timeLabel(item.time))}</time><span class="agenda-dot ${css}"></span><div><p>${escape(item.kind === 'reminder' ? item.type : (kinds[item.type] || kinds.care)[1])}${item.completed ? ' · Completed' : ''}</p><h4>${escape(item.title)}</h4><span>${escape(item.notes || item.instruction || '')}</span></div><button type="button" ${item.kind === 'reminder' ? `class="reminder-delete" data-action="delete-reminder" data-id="${escape(item.id)}"` : `data-action="calendar-task" data-id="${escape(item.taskId)}"`}>${item.kind === 'reminder' ? 'Remove' : 'View'}</button></article>`;
    }).join('') : '<p class="empty-state">Nothing scheduled for this date.</p>'}`;
    const upcoming = state.reminders.filter(item => item.date >= state.today).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 5);
    $('.upcoming-panel').innerHTML = `<p class="eyebrow">Coming up</p><h3>Appointments and reminders</h3>${upcoming.map(item => `<article><span class="date-tile"><strong>${Number(item.date.slice(8))}</strong>${new Date(`${item.date}T12:00:00Z`).toLocaleDateString('en-SG', { month: 'short' })}</span><div><strong>${escape(item.title)}</strong><small>${escape(timeLabel(item.time))} · ${escape(item.notes || item.type)}</small></div></article>`).join('') || '<p>No upcoming reminders.</p>'}<p class="calendar-legend"><span></span> Orange dots mark saved reminders or appointments.</p>`;
  }
  function openReminder() { $('#reminder-form').reset(); $('#reminder-date').value = selectedDate || state.today; $('#reminder-time').value = '09:00'; openDialog($('#reminder-modal')); }
  async function saveReminder(event) {
    event.preventDefault();
    await busy(event.submitter, async () => {
      const item = await api('/reminders', { method: 'POST', body: { title: $('#reminder-name').value, date: $('#reminder-date').value, time: $('#reminder-time').value, type: $('#reminder-type').value, notes: $('#reminder-notes').value } });
      closeDialog($('#reminder-modal')); selectedDate = item.date; weekStart = item.date; await refresh(); showView('calendar'); toast('Your reminder is saved.');
    });
  }
  function checkReminders() {
    if (!state) return; const now = new Date();
    const singapore = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    if (singapore !== state.today) { refresh().catch(() => {}); return; }
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const items = [...dueTasks(state.today).filter(task => !task.completedDates.includes(state.today)), ...state.reminders.filter(item => item.date === state.today)];
    for (const item of items) if (item.time === clock && !announced.has(`${state.today}:${item.id}`)) { announced.add(`${state.today}:${item.id}`); toast(`Reminder: ${item.title}`, 15000); $('#live-region').textContent = `Reminder: ${item.title}`; }
  }

  function renderCareCircle() {
    const p = state.profile;
    $('#sharing-status').textContent = p.caregiverConsent ? `${p.caregiver || 'Your caregiver'} may receive updates after your approval.` : 'Caregiver sharing is off. Manage sharing to choose a caregiver and give consent.';
    $('#caregiver-alerts').innerHTML = state.alerts.length ? state.alerts.slice().reverse().map(alert => `<article class="history-entry"><time>${escape(new Date(alert.createdAt).toLocaleString('en-SG'))}</time><strong>${alert.acknowledgedAt ? 'Reviewed in this demonstration' : 'Awaiting review'}</strong><p>${escape(alert.deliveryMessage || 'Saved to local caregiver inbox.')}</p><details><summary>View the approved update</summary><pre class="summary-preview">${escape(alert.summary)}</pre></details>${alert.acknowledgedAt ? '' : `<button class="text-button" type="button" data-action="acknowledge-alert" data-id="${escape(alert.id)}">Mark reviewed (demo caregiver view)</button>`}</article>`).join('') : '<p class="privacy-note">No caregiver updates have been approved yet.</p>';
    $('#audit-history').innerHTML = state.audit.slice(-12).reverse().map(item => `<article class="history-entry"><time>${escape(new Date(item.at).toLocaleString('en-SG'))}</time><strong>${escape(item.event.replaceAll('_', ' '))}</strong><p>${escape(Object.entries(item.facts).filter(([key]) => !/id$/i.test(key)).map(([key, value]) => `${key}: ${value}`).join(' · '))}</p></article>`).join('') || '<p>Your care activity will appear here.</p>';
    renderServiceStatus();
  }
  function renderServiceStatus() { $('#database-status').textContent = 'Records are saved on this computer. No Supabase or MySQL account is required. Download a backup before moving computers or clearing browser cookies.'; }
  function openProfile() {
    $('#profile-name').value = state.profile.name; $('#profile-caregiver').value = state.profile.caregiver; $('#caregiver-phone').value = state.profile.caregiverPhone; $('#caregiver-consent').checked = state.profile.caregiverConsent;
    $('#patient-email').value = state.profile.patientEmail || ''; $('#patient-phone').value = state.profile.patientPhone || ''; $('#caregiver-email').value = state.profile.caregiverEmail || ''; $('#reminder-channel').value = state.profile.reminderChannel || 'email'; $('#caregiver-channel').value = state.profile.caregiverChannel || 'email'; $('#reminders-enabled').checked = state.profile.remindersEnabled === true;
    openDialog($('#profile-modal'));
  }
  async function saveProfile(event) {
    event.preventDefault();
    await busy(event.submitter, async () => {
      await api('/profile', { method: 'PATCH', body: { name: $('#profile-name').value, caregiver: $('#profile-caregiver').value, caregiverPhone: $('#caregiver-phone').value, caregiverEmail: $('#caregiver-email').value, caregiverConsent: $('#caregiver-consent').checked, caregiverChannel: $('#caregiver-channel').value, patientEmail: $('#patient-email').value, patientPhone: $('#patient-phone').value, remindersEnabled: $('#reminders-enabled').checked, reminderChannel: $('#reminder-channel').value } });
      closeDialog($('#profile-modal')); await refresh(); renderMessages(); toast('Your profile and sharing preferences are saved.');
    });
  }
  async function reviewCaregiverUpdate() {
    if (!state.profile.caregiverConsent) { toast('Please choose your caregiver and enable sharing first.'); if ($('#assistance-modal').open) closeDialog($('#assistance-modal')); openProfile(); return; }
    const preview = await api('/alerts/preview', { method: 'POST', body: {} }); sharePreviewId = preview.id; if ($('#assistance-modal').open) closeDialog($('#assistance-modal'));
    $('#share-preview').textContent = preview.summary; $('#share-delivery-note').textContent = preview.to ? `Approved recipient: ${preview.to} (${preview.channel}). The update will enter the server’s sending queue. Provider credentials are required for actual sending; inspect notification activity for the result.` : 'No external recipient is saved. This update will remain in the local caregiver inbox. Add the caregiver’s contact in Profile to enable external sending.';
    openDialog($('#share-modal'));
  }
  async function downloadSummary() {
    const text = await api('/summary'); const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'carecompass-handover.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Your factual handover has been downloaded.');
  }
  function speak(text) {
    if (!('speechSynthesis' in window)) return toast('Read-aloud is unavailable in this browser.');
    speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.rate = .86; utterance.lang = { English: 'en-SG', '简体中文': 'zh-CN', 'Bahasa Melayu': 'ms-MY', 'தமிழ்': 'ta-SG' }[state.profile.language] || 'en-SG'; speechSynthesis.speak(utterance);
  }
  function dictate(targetId) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition; if (!Recognition) return toast('Voice input is unavailable in this browser. You can type instead.');
    const recognition = new Recognition(); recognition.lang = 'en-SG'; recognition.interimResults = false;
    recognition.onstart = () => toast('Listening… speak, then pause. Your browser may use its speech service.'); recognition.onresult = event => { const target = document.getElementById(targetId); target.value = `${target.value} ${event.results[0][0].transcript}`.trim(); target.focus(); }; recognition.onerror = () => toast('Voice input could not finish. Please try again or type.'); recognition.start();
  }

  async function renderSetup() {
    const status = await api('/integrations/status', { timeout: 35000 });
    $('#setup-status').innerHTML = [['AI model (optional)', status.providers.ai], ['Email (optional)', status.providers.email], ['SMS (optional)', status.providers.sms], ['Local records + backups', true]].map(([label, ready]) => `<div class="service-status"><strong>${label}</strong><span>${ready ? 'Available' : 'Not connected — optional'}</span></div>`).join('');
    for (const input of $('#integrations-form').querySelectorAll('[name]')) {
      const value = status.configuration[input.name];
      if (typeof value === 'string') input.value = value;
      else if (value?.configured) { input.value = ''; input.placeholder = 'Already saved — leave blank to keep it'; }
    }
    $('#local-backup-status').textContent = 'Working now: daily tasks, care-plan review, source-based questions, check-ins, calendar, approved caregiver inbox updates, local reminder inbox and backup/restore.';
    $('#scheduler-setup-status').textContent = status.scheduler.running ? 'Background worker is running. It checks every 15 seconds and saves its queue between server restarts.' : 'Background worker is not running in this instance (for example, an isolated test server). Start the app with npm start.';
    await renderNotificationActivity();
  }
  async function renderNotificationActivity() {
    const data = await api('/notifications');
    $('#notification-activity').innerHTML = '<h4>Notification activity</h4>' + (data.jobs.length ? data.jobs.slice(-15).reverse().map(job => `<article class="history-entry"><time>${escape(new Date(job.createdAt).toLocaleString('en-SG'))}</time><strong>${escape(job.kind)} · ${escape(job.channel)} · ${escape(job.status)}</strong><p>${escape(job.detail || 'Saved in the queue, awaiting a background check.')}</p>${['failed', 'blocked', 'unknown'].includes(job.status) ? `<button class="text-button" type="button" data-action="retry-notification" data-id="${escape(job.id)}" data-unknown="${job.status === 'unknown'}">Review and retry</button>` : ''}</article>`).join('') : '<p>No background messages have been queued yet.</p>');
  }
  async function saveServiceSettings(event) {
    event.preventDefault();
    await busy(event.submitter, async () => {
      const body = Object.fromEntries(new FormData($('#integrations-form')));
      await api('/integrations/configuration', { method: 'PUT', body });
      $$('#integrations-form input[type="password"]').forEach(input => { input.value = ''; });
      health = await api('/health', { timeout: 35000 }); await renderSetup(); toast('Private service settings saved on this computer. Use connection checks before sending.');
    });
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('button, [data-view-target]'); if (!target) return;
    if (target.dataset.viewTarget) { event.preventDefault(); showView(target.dataset.viewTarget); return; }
    if (target.dataset.date) { selectedDate = target.dataset.date; renderCalendar().catch(showError); return; }
    const action = target.dataset.action; if (!action) return; event.preventDefault();
    busy(target, async () => {
      const taskId = target.closest('[data-task-id]')?.dataset.taskId;
      if (action === 'retry-connection') return initialize(); if (action === 'close-dialog') return closeDialog(target.closest('dialog')); if (!state) return;
      if (action === 'toggle-details') { const detail = target.closest('.task-body').querySelector('.task-details'); detail.hidden = !detail.hidden; target.setAttribute('aria-expanded', String(!detail.hidden)); target.textContent = detail.hidden ? 'Explain steps' : 'Hide steps'; }
      else if (action === 'complete-task' || action === 'undo-task') { const result = await api(`/tasks/${taskId}`, { method: 'PATCH', body: { completed: action === 'complete-task' } }); await refresh(); toast(result.syncMessage || (action === 'complete-task' ? 'Task completion saved.' : 'Task marked as not completed.')); }
      else if (action === 'go-checkin') { selectedTaskId = taskId || target.dataset.id || null; showView('checkin'); }
      else if (action === 'go-teachback' || action === 'go-ask') { showView('ask'); $('#chat-mode').value = 'teachback'; $('#chat-input').focus(); }
      else if (action === 'go-home') showView('home');
      else if (action === 'go-calendar') { selectedDate = state.today; weekStart = state.today; showView('calendar'); }
      else if (action === 'calendar-task') { const task = activeTasks().find(item => item.id === target.dataset.id); if (task?.type === 'checkin') { selectedTaskId = task.id; showView('checkin'); } else if (task?.type === 'teachback') { showView('ask'); $('#chat-mode').value = 'teachback'; } else showView('home'); }
      else if (action === 'open-upload') openUpload(); else if (action === 'scan-demo') await scan('demo'); else if (action === 'open-camera') await openCamera(); else if (action === 'snap-camera') await snapCamera(); else if (action === 'close-camera') closeCamera(); else if (action === 'parse-text') await scan('text');
      else if (action === 'import-team-tasks') { openUpload(); await scan('team'); }
      else if (action === 'add-extracted-task') addExtractionRow();
      else if (action === 'remove-extracted-task') { target.closest('.extracted-item').remove(); $('#confirm-extraction').checked = false; $('[data-action="confirm-plan"]').disabled = true; }
      else if (action === 'edit-extraction') { $('#source-input').value = draft?.sourceText || ''; $('#upload-step-review').hidden = true; $('#upload-step-select').hidden = false; $('.paste-plan').open = true; $('#source-input').focus(); }
      else if (action === 'confirm-plan') await confirmPlan();
      else if (action === 'open-assistance') { $('#emergency-options').hidden = true; openDialog($('#assistance-modal')); }
      else if (action === 'emergency-help') { $('#emergency-options').hidden = false; if (state.profile.caregiverPhone && !$('#caregiver-call')) $('#emergency-options').insertAdjacentHTML('beforeend', `<a id="caregiver-call" class="inline-call" href="tel:${escape(state.profile.caregiverPhone.replace(/[^+\d]/g, ''))}">Call ${escape(state.profile.caregiver)}</a>`); }
      else if (action === 'caregiver-help') await reviewCaregiverUpdate();
      else if (action === 'confirm-share') { const alert = await api('/alerts', { method: 'POST', body: { confirmed: true, previewId: sharePreviewId } }); closeDialog($('#share-modal')); await refresh(); showView('caregiver'); toast(alert.deliveryMessage, 9000); }
      else if (action === 'acknowledge-alert') { await api(`/alerts/${target.dataset.id}`, { method: 'PATCH', body: {} }); await refresh(); }
      else if (action === 'professional-help') await downloadSummary(); else if (action === 'read-text') speak(target.closest('.task-details').innerText); else if (action === 'read-message') speak(target.closest('.message').querySelector('p').textContent); else if (action === 'dictate') dictate(target.dataset.target);
      else if (action === 'add-reminder') openReminder();
      else if (action === 'delete-reminder') { if (!confirm('Remove this reminder?')) return; await api(`/reminders/${target.dataset.id}`, { method: 'DELETE' }); await refresh(); toast('Reminder removed.'); }
      else if (action === 'open-profile') openProfile();
      else if (action === 'ask-task') { const task = activeTasks().find(t => t.id === taskId); showView('ask'); $('#chat-mode').value = 'question'; $('#chat-input').value = task ? `Please explain this instruction: ${task.instruction}` : ''; $('#chat-input').focus(); }
      else if (action === 'view-source') { showView('ask'); $('.source-panel').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else if (action === 'export-backup') { const response = await fetch('/api/backup/export', { credentials: 'same-origin' }); if (!response.ok) throw new Error('Backup download failed.'); const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = `carecompass-backup-${state.today}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Backup downloaded. It contains private care records; store it safely.'); }
      else if (action === 'import-backup') $('#backup-file').click();
      else if (action === 'refresh-setup') await renderSetup();
      else if (action === 'test-provider') { const result = await api('/integrations/test', { method: 'POST', body: { kind: target.dataset.kind }, timeout: 40000 }); toast(result.message, 10000); }
      else if (action === 'view-schema') { $('#schema-preview').textContent = await api('/integrations/schema'); $('#schema-preview').hidden = !$('#schema-preview').hidden; }
      else if (action === 'migrate-cloud') { if (!confirm('Create the CareCompass backup table using the saved PostgreSQL admin connection? This leaves the existing tasks table unchanged.')) return; const result = await api('/cloud/migrate', { method: 'POST', body: { confirmed: true }, timeout: 35000 }); toast(result.message, 10000); await renderSetup(); }
      else if (action === 'backup-now') { const result = await api('/cloud/backup', { method: 'POST', body: {} }); toast(result.message, 10000); await renderSetup(); }
      else if (action === 'restore-cloud') { if (!confirm('Replace this browser’s current records with its cloud backup? A previous local file is retained, and background reminders will be turned off for review.')) return; const result = await api('/cloud/restore', { method: 'POST', body: { confirmed: true } }); await refresh(); renderMessages(); await renderSetup(); toast(result.message, 10000); }
      else if (action === 'send-test') { const channel = target.dataset.channel; if (!confirm(`Send one ${channel} test message to your own contact saved in Profile? This uses your provider account; SMS may incur charges. No medical details will be included.`)) return; const result = await api('/notifications/test', { method: 'POST', body: { confirmed: true, channel } }); toast(result.message, 10000); await renderNotificationActivity(); }
      else if (action === 'retry-notification') { const unknown = target.dataset.unknown === 'true'; if (!confirm(unknown ? 'The earlier sending result is unknown. Check your provider first. Retrying may send a duplicate. Do you approve another attempt?' : 'Retry sending this saved notification? Current consent and recipient details will be checked again.')) return; await api(`/notifications/${target.dataset.id}/retry`, { method: 'POST', body: { confirmed: true, allowPossibleDuplicate: unknown } }); await renderNotificationActivity(); toast('Retry approved. The background worker will process it.'); }
      else if (action === 'reset-demo') { if (!confirm('Reset this browser’s demonstration care records? The original team database tasks will not be deleted.')) return; await api('/reset', { method: 'POST', body: { confirmed: true } }); selectedTaskId = null; selectedDate = null; weekStart = null; $('#checkin-result').hidden = true; await refresh(); renderMessages(); showView('home'); toast('This demonstration profile was reset.'); }
      else if (action === 'open-auth') openAuth();
      else if (action === 'logout') { await api('/auth/logout', { method: 'POST' }); await refresh(); updateAuthUI(null); toast('You have been signed out. A fresh demo session has started.'); }
    });
  });
  $('#chat-form').addEventListener('submit', event => { event.preventDefault(); sendChat($('#chat-input').value); });
  $$('[data-prompt]').forEach(button => button.addEventListener('click', () => { if (/own words|teach.back/i.test(button.dataset.prompt)) { $('#chat-mode').value = 'teachback'; $('#chat-input').value = ''; $('#chat-input').focus(); toast('Describe your care instruction in your own words, then send it.'); } else { $('#chat-mode').value = 'question'; sendChat(button.dataset.prompt); } }));
  $('#checkin-form').addEventListener('submit', submitCheckIn); $('#reminder-form').addEventListener('submit', saveReminder); $('#profile-form').addEventListener('submit', saveProfile);
  $('#integrations-form').addEventListener('submit', saveServiceSettings);
  $('#backup-file').addEventListener('change', event => busy(null, async () => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 900000) throw new Error('This backup is too large to import.');
      const backup = JSON.parse(await file.text());
      if (!confirm('Replace this browser’s care records with this backup? Reminders and caregiver sharing will be turned off for review. Only import a backup you trust.')) return;
      const result = await api('/backup/import', { method: 'POST', body: { confirmed: true, backup } });
      selectedTaskId = null; selectedDate = null; weekStart = null; await refresh(); renderMessages(); toast(result.message, 10000);
    } finally { event.target.value = ''; }
  }));
  $('#care-plan-file').addEventListener('change', () => { if ($('#care-plan-file').files.length) scan('file'); });
  $('#medicine-file').addEventListener('change', () => { if ($('#medicine-file').files.length) scan('medicine'); });
  $('#upload-modal').addEventListener('close', closeCamera);

  // ─── Auth ───
  async function checkAuth() {
    try { const data = await api('/auth/me'); updateAuthUI(data.user); return data.user; }
    catch { updateAuthUI(null); return null; }
  }
  function updateAuthUI(user) {
    const btn = $('#sidebar-auth-btn'); if (!btn) return;
    if (user) {
      btn.textContent = `Account: ${user.email}`;
      btn.dataset.action = 'logout';
    } else {
      btn.textContent = 'Account: Sign in';
      btn.dataset.action = 'open-auth';
    }
  }
  function openAuth() {
    const dialog = $('#auth-modal');
    $('#auth-error').hidden = true;
    $('#auth-email').value = '';
    $('#auth-password').value = '';
    $('#auth-status-text').textContent = '';
    openDialog(dialog);
    $('#auth-email').focus();
  }
  async function submitAuth(event) {
    event.preventDefault();
    const sub = event.submitter; if (!sub) return;
    const mode = sub.dataset.authMode || 'login';
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const errorEl = $('#auth-error');
    errorEl.hidden = true;
    try {
      const result = await api(`/auth/${mode}`, { method: 'POST', body: { email, password } });
      closeDialog($('#auth-modal'));
      selectedTaskId = null; selectedDate = null; weekStart = null;
      await refresh(); renderMessages();
      updateAuthUI(result.user);
      toast(mode === 'register' ? `Account created. Welcome, ${result.user.email}.` : `Signed in as ${result.user.email}.`);
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
    }
  }
  $('#auth-form').addEventListener('submit', submitAuth);
  $('#auth-modal .close-button').addEventListener('click', () => closeDialog($('#auth-modal')));
  $('#confirm-extraction').addEventListener('change', () => { $('[data-action="confirm-plan"]').disabled = !$('#confirm-extraction').checked; });
  $('#extraction-items').addEventListener('input', () => { $('#confirm-extraction').checked = false; $('[data-action="confirm-plan"]').disabled = true; });
  $('#text-size-button').addEventListener('click', event => busy(event.currentTarget, async () => { await api('/profile', { method: 'PATCH', body: { largeText: !state.profile.largeText } }); await refresh(); }));
  $('#language-button').addEventListener('click', () => openDialog($('#language-modal')));
  $$('[data-language]').forEach(button => button.addEventListener('click', () => busy(button, async () => { await api('/profile', { method: 'PATCH', body: { language: button.dataset.language } }); closeDialog($('#language-modal')); await refresh(); toast('Navigation language saved. Clinical source wording remains unchanged.'); })));
  $$('.week-header button').forEach((button, index) => button.addEventListener('click', () => { weekStart = dayAfter(weekStart, index === 0 ? -7 : 7); selectedDate = weekStart; renderCalendar().catch(showError); }));
  $$('dialog').forEach(dialog => { dialog.addEventListener('close', () => { if (!$('dialog[open]')) document.body.classList.remove('modal-open'); }); dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(dialog); }); });
  window.addEventListener('hashchange', () => { const view = location.hash.slice(1); if (['home', 'ask', 'checkin', 'calendar', 'caregiver', 'setup'].includes(view)) showView(view); });
  setInterval(() => { if (currentView === 'setup') renderNotificationActivity().catch(() => {}); }, 5000);
  async function refreshReminderInbox() {
    if (!state) return;
    const data = await api('/notifications');
    $('#reminder-inbox').innerHTML = data.notifications.length ? data.notifications.slice(-5).reverse().map(n => `<article class="history-entry"><time>${escape(new Date(n.createdAt).toLocaleString('en-SG'))}</time><p>${escape(n.text)}</p></article>`).join('') : '<p>No background reminders yet. Enable the in-app inbox in Profile. Reminders are saved while the server is running; reopen the app to see them.</p>';
  }
  setInterval(() => { if (currentView === 'home') refreshReminderInbox().catch(() => {}); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshReminderInbox().catch(() => {}); });
  setTimeout(() => refreshReminderInbox().catch(() => {}), 1500);
  initialize();
})();
