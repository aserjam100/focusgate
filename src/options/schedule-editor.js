// Weekly schedule editor: per weekday, a list of start/end windows.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // show Monday first

export function renderScheduleEditor(container, schedule, onChange) {
  const sched = structuredClone(schedule);
  const changed = () => onChange(structuredClone(sched));

  function draw() {
    container.replaceChildren();
    container.classList.add('sched');

    const always = document.createElement('label');
    always.className = 'row small';
    const acb = document.createElement('input');
    acb.type = 'checkbox';
    acb.checked = !!sched.always;
    acb.onchange = () => {
      sched.always = acb.checked;
      changed();
      draw();
    };
    always.append(acb, 'Block all the time (ignore the days below)');
    container.append(always);

    const presets = document.createElement('div');
    presets.className = 'row small wrap';
    presets.append('Presets:');
    for (const [label, days, s, e] of [
      ['Mon–Fri 9–18', [1, 2, 3, 4, 5], '09:00', '18:00'],
      ['Every day 9–18', [0, 1, 2, 3, 4, 5, 6], '09:00', '18:00'],
      ['Nights 22–07', [0, 1, 2, 3, 4, 5, 6], '22:00', '07:00'],
      ['Clear', [], '', ''],
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.onclick = () => {
        sched.days = [[], [], [], [], [], [], []];
        for (const d of days) sched.days[d] = [{ start: s, end: e }];
        changed();
        draw();
      };
      presets.append(b);
    }
    container.append(presets);

    const table = document.createElement('div');
    table.className = 'sched-days';
    table.classList.toggle('disabled', !!sched.always);
    for (const d of ORDER) {
      const row = document.createElement('div');
      row.className = 'sched-day';
      const name = document.createElement('span');
      name.className = 'sched-name';
      name.textContent = DAY_NAMES[d];
      row.append(name);
      const wins = document.createElement('div');
      wins.className = 'sched-wins';
      (sched.days[d] ||= []).forEach((w, i) => {
        const win = document.createElement('span');
        win.className = 'sched-win';
        const s = timeInput(w.start, (v) => { w.start = v; changed(); });
        const e = timeInput(w.end === '24:00' ? '23:59' : w.end, (v) => { w.end = v; changed(); });
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'link';
        rm.textContent = '×';
        rm.title = 'Remove window';
        rm.onclick = () => {
          sched.days[d].splice(i, 1);
          changed();
          draw();
        };
        const cross = document.createElement('span');
        cross.className = 'muted small';
        const updCross = () => (cross.textContent = w.end && w.start && w.end <= w.start ? '(+1 day)' : '');
        s.addEventListener('change', updCross);
        e.addEventListener('change', updCross);
        updCross();
        win.append(s, '–', e, cross, rm);
        wins.append(win);
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'link';
      add.textContent = '+ window';
      add.onclick = () => {
        sched.days[d].push({ start: '09:00', end: '18:00' });
        changed();
        draw();
      };
      wins.append(add);
      row.append(wins);
      table.append(row);
    }
    container.append(table);
    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent = 'An end time at or before the start runs past midnight into the next day.';
    container.append(note);
  }
  draw();
}

function timeInput(value, onInput) {
  const el = document.createElement('input');
  el.type = 'time';
  el.value = value;
  el.required = true;
  el.addEventListener('change', () => {
    if (el.value) onInput(el.value);
  });
  return el;
}
