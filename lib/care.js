const { today } = require('./store');
const { extractStructured } = require('./extraction');

// Demonstration gates only. Replace thresholds with clinician-approved pathways before clinical use.
function evaluateCheckIn({ pain, change, notes }, history = []) {
  const text = String(notes || '').toLowerCase();
  const redFlags = ['chest pain', 'pain in my chest', 'chest hurts', 'cannot breathe', "can't breathe", 'difficulty breathing', 'shortness of breath', 'breathlessness', 'fainted', 'collapsed', 'unconscious'];
  // Do not let a benign topic match take priority over a red flag.
  const redFlag = redFlags.find(phrase => text.includes(phrase));
  if (redFlag) return { level: 'urgent', rule: 'Reported emergency warning phrase', reason: `Recorded phrase: “${redFlag}”. Normal coaching has stopped.`, action: 'Seek urgent human help. If severe or immediately unsafe, contact local emergency services now.' };
  if (change === 'sudden' || pain >= 8) return { level: 'urgent', rule: change === 'sudden' ? 'Sudden change reported' : 'Demo discomfort threshold ≥ 8/10', reason: 'A demonstration safety gate was activated; this is not a diagnosis.', action: 'Contact a healthcare professional promptly. If severe or immediately unsafe, contact emergency services.' };
  if (/\b(severe|sudden|unbearable)\b/.test(text)) return { level: 'urgent', rule: 'Severe or sudden symptoms described in notes', reason: 'The description needs human attention even when the selected rating is lower.', action: 'Contact a healthcare professional promptly. If severe or immediately unsafe, contact emergency services.' };
  if (change === 'worse') return { level: 'review', rule: 'Worsening symptoms reported', reason: 'Your symptoms were reported as worse. A human should review the change.', action: 'Contact your care team for advice; do not wait for a weekly check-in.' };
  const distinctDays = new Set(history.filter(entry => entry.pain > 0 && entry.change === 'same' && entry.date >= new Date(Date.now() - 7 * 86400000).toISOString()).map(entry => entry.day));
  distinctDays.add(today());
  if (pain > 0 && change === 'same' && distinctDays.size >= 7) return { level: 'review', rule: 'Persistent discomfort across seven recorded days', reason: 'Repeated unchanged discomfort needs professional review.', action: 'Arrange a review with your care team.' };
  if (pain >= 6) return { level: 'review', rule: 'Strong discomfort reported', reason: 'Your discomfort rating merits human review in this demonstration.', action: 'Ask your care team for advice, especially if this is new or worrying.' };
  return { level: 'recorded', rule: 'No demonstration escalation gate activated', reason: 'This does not rule out illness or establish that symptoms are safe.', action: 'Follow your confirmed care plan. Seek professional advice whenever you are worried.' };
}

const normalize = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function extractCandidates(source) {
  return extractStructured(source);
}

function planAnswer(message, profile, mode = 'question') {
  const text = message.toLowerCase();
  const urgent = evaluateCheckIn({ pain: 0, change: 'same', notes: message });
  if (urgent.level === 'urgent' || /\b(emergency|suicid|overdose|sudden severe)\b/.test(text)) return { text: `${urgent.level === 'urgent' ? urgent.action : 'Seek urgent human help for an emergency.'} CareCompass has stopped ordinary coaching. Open Medical Assistance.`, kind: 'urgent', source: null };
  const plans = profile.plans.filter(plan => plan.active);
  if (!plans.length) return { text: 'Please add and confirm a care plan first. I cannot explain instructions without a confirmed source.', kind: 'unsupported', source: null };
  const tasks = profile.tasks.filter(task => !task.archived);
  if (mode === 'teachback') return teachBack(message, tasks);
  if (/\b(dose|double|skip|stop taking|change.*med|extra pill)\b/.test(text)) return { text: 'I cannot select or change a dose. Follow the dispensing label and contact your pharmacist or care professional if it is unclear. Your own words have been recorded for review.', kind: 'clarification', source: tasks.find(task => task.type === 'medication')?.instruction || null };
  const scored = tasks.map(task => {
    const words = new Set(normalize(`${task.title} ${task.instruction}`).split(' ').filter(word => word.length > 3));
    const score = normalize(message).split(' ').filter(word => words.has(word)).length;
    return { task, score };
  }).sort((a, b) => b.score - a.score);
  let task = scored[0]?.score ? scored[0].task : null;
  if (/\b(medicine|medication|pill|label)\b/.test(text)) task = tasks.find(item => item.type === 'medication') || task;
  if (/\b(ankle|swelling)\b/.test(text)) task = tasks.find(item => /ankle/i.test(item.instruction)) || task;
  if (/\b(own words|teach.back|understand my plan)\b/.test(text)) return { text: 'Choose “Teach-back”, then describe a care task in your own words. I will compare the details with your confirmed instructions and show any details to review.', kind: 'guidance', source: null };
  if (!task) return { text: 'I could not find support for that question in your confirmed care plan. I will not invent clinical advice. Please check with your care professional.', kind: 'unsupported', source: null };
  return { text: `Your confirmed plan says: “${task.instruction}”\n\n${(task.steps || []).join('\n')}\n\nIf this wording is unclear or your symptoms have changed, ask your care team for clarification.`, kind: 'grounded', source: task.instruction, taskId: task.id };
}

function teachBack(message, tasks) {
  const task = tasks.filter(item => item.type !== 'teachback').find(item => normalize(message).split(' ').some(word => word.length > 4 && normalize(item.title).includes(word))) || tasks.find(item => item.type !== 'teachback');
  if (!task) return { text: 'Confirm a care task before starting teach-back.', kind: 'unsupported', source: null };
  const changingMedicine = task.type === 'medication' && (message.match(/\b(double|twice|extra|skip|stop|half)\b/gi) || []).some(word => !new RegExp(`\\b${word}\\b`, 'i').test(task.instruction));
  const keywords = [...new Set(normalize(task.instruction).split(' ').filter(word => word.length > 5))];
  const covered = keywords.filter(word => normalize(message).includes(word));
  const sufficient = !changingMedicine && covered.length >= Math.min(3, keywords.length) && message.trim().split(/\s+/).length >= 8;
  return { text: changingMedicine ? 'That may change the medicine instruction. Please do not change the dose based on this chat. Compare your explanation with the source below and confirm any uncertainty with your pharmacist.' : sufficient ? 'Your explanation mentions several details from the plan. Please compare it with the exact source below. This wording check cannot verify clinical understanding; ask your care team about anything unclear.' : 'Let’s review the instruction together. Your explanation does not yet cover enough of the written details. Read or listen to the source below and try again in your own words.', kind: sufficient ? 'teachback-reviewed' : 'teachback-review', source: task.instruction, taskId: task.id, needsReview: !sufficient, engine: 'source-word comparison' };
}

module.exports = { evaluateCheckIn, extractCandidates, planAnswer, normalize };
