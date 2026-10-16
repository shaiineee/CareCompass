const { today } = require('./store');

const canonical = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const sourceContains = (source, quote) => Boolean(quote?.trim()) && canonical(source).includes(canonical(quote));

function readTimes(line) {
  const found = [];
  // Read AM/PM before interpreting a clock as 24-hour time (8:00 PM must become 20:00).
  const pattern = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;
  for (const match of line.matchAll(pattern)) {
    const time = match[1] ? `${String(Number(match[1]) % 12 + (/p/i.test(match[3]) ? 12 : 0)).padStart(2, '0')}:${match[2] || '00'}` : `${match[4].padStart(2, '0')}:${match[5]}`;
    if (!found.includes(time)) found.push(time);
  }
  return found;
}
function analyzeInstruction(instruction) {
  const times = readTimes(instruction);
  const medication = /\b(medicine|medication|tablet|capsule|pill|dose|mg|mcg|ml|insulin)\b/i.test(instruction);
  const type = medication ? 'medication' : /\b(explain|own words|teach.back)\b/i.test(instruction) ? 'teachback' : /\b(check|record|measure)\b/i.test(instruction) ? 'checkin' : 'care';
  const strength = instruction.match(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|micrograms?|grams?|g|ml|millilitres?|units?)\b/i)?.[0] || '';
  const dose = instruction.match(/\b(?:take|apply|inject|use)\s+((?:\d+(?:\.\d+)?|one|two|half|½|¼)\s*(?:tablets?|capsules?|pills?|puffs?|drops?|ml|units?))\b/i)?.[1] || '';
  const name = medication ? instruction.match(/\b(?:take|apply|inject|use)\s+(?:\d+(?:\.\d+)?\s+(?:tablets?|capsules?)\s+of\s+)?([A-Z][A-Za-z-]+)(?=\s+\d+(?:\.\d+)?\s*(?:mg|mcg|ml)\b)/i)?.[1] || '' : '';
  let count = /\b(?:twice|two times|2 times)\s*(?:a |per )?(?:daily|day)\b/i.test(instruction) ? 2 : /\b(?:thrice|three times|3 times)\s*(?:a |per )?(?:daily|day)\b/i.test(instruction) ? 3 : /\b(?:four times|4 times)\s*(?:a |per )?(?:daily|day)\b/i.test(instruction) ? 4 : 1;
  count = Math.max(count, times.length);
  const daily = /\b(daily|every day|each day|a day|per day)\b/i.test(instruction);
  const asNeeded = /\b(as needed|when needed|prn|if needed|if pain)\b/i.test(instruction);
  const complex = medication && /\b(taper|alternate days?|every \d+ hours?|weekly|once a week|then (?:take|reduce|increase)|depending on|adjust (?:the )?dose|od|bd|bid|tds|tid|qid|qds|qhs)\b/i.test(instruction);
  const durationDays = Number(instruction.match(/\bfor\s+(\d{1,3})\s+days?\b/i)?.[1]) || null;
  const warnings = [];
  if (medication && !dose) warnings.push('The amount to take is not clearly extracted. Check the original dispensing label; no dose has been calculated.');
  if (!times.length) warnings.push('No exact clock time is written here. Confirm an appropriate reminder time before scheduling.');
  if (count > times.length) warnings.push(`The instruction indicates ${count} daily occurrences but not all clock times are clear. Add and verify each reminder time.`);
  if (/\b(od|bd|bid|tds|tid|qid|qds|qhs)\b/i.test(instruction)) warnings.push('An abbreviation needs professional clarification. It has not been expanded automatically.');
  if (asNeeded) warnings.push('This is an as-needed instruction. Automatic dose reminders are blocked; obtain a clarified care plan for scheduling.');
  if (complex) warnings.push('This instruction has a conditional or complex schedule. Automatic scheduling is blocked until the source is clarified by the care team.');
  return { type, medicationName: name, strengthText: strength, doseText: dose, times, occurrencesPerDay: count, frequency: daily ? 'daily' : 'once', durationDays, warnings, blockedSchedule: medication && (asNeeded || complex) };
}

function extractStructured(source) {
  // Split on newlines and sentence boundaries, preserving decimal strengths and AM/PM punctuation.
  const lines = source.split(/\r?\n|(?<=[.!?])\s+(?=[A-Z])/).map(line => line.trim()).filter(Boolean);
  const candidates = [];
  for (const line of lines) {
    if (!/\b(take|check|record|walk|exercise|measure|explain|apply|use|attend|inject)\b/i.test(line) || /^(synthetic|not a real)/i.test(line)) continue;
    const analysis = analyzeInstruction(line);
    const total = Math.min(analysis.occurrencesPerDay, 6);
    for (let index = 0; index < total; index++) candidates.push({ title: `${line.split(/[;\n]/)[0].slice(0, 85)}${total > 1 ? ` (${index + 1}/${total})` : ''}`, instruction: line, type: analysis.type, time: analysis.times[index] || '', frequency: analysis.frequency, date: today(), analysis, occurrence: index + 1 });
    if (candidates.length >= 20) break;
  }
  return candidates.slice(0, 20);
}

module.exports = { canonical, sourceContains, readTimes, analyzeInstruction, extractStructured };
