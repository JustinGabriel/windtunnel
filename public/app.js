// Progressive enhancement only: every page works without this file.

// Character counters on tagline inputs.
for (const input of document.querySelectorAll('[data-count]')) {
  const out = document.querySelector(input.dataset.count);
  const limit = Number(input.dataset.limit);
  const update = () => {
    out.textContent = String(input.value.length);
    out.classList.toggle('over', input.value.length > limit);
  };
  input.addEventListener('input', update);
  update();
}

// "Try one" examples fill the form.
for (const button of document.querySelectorAll('[data-example]')) {
  button.addEventListener('click', () => {
    const example = JSON.parse(button.dataset.example);
    for (const key of ['name', 'tagline', 'description']) {
      const field = document.getElementById(key);
      if (!field) continue;
      field.value = example[key] ?? '';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.getElementById('tagline')?.focus();
  });
}

// Copy a report link.
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const label = button.textContent;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'Link copied';
    } catch {
      button.textContent = button.dataset.copy;
    }
    setTimeout(() => (button.textContent = label), 2500);
  });
}

// Line chart hover: a crosshair that snaps to the nearest weekday and one tooltip
// listing every series there. Text goes in with textContent, never innerHTML.
for (const body of document.querySelectorAll('[data-linechart]')) {
  const data = JSON.parse(body.dataset.linechart);
  const svg = body.querySelector('svg');
  const crosshair = svg.querySelector('.crosshair');
  const tip = body.querySelector('.tooltip');
  const viewWidth = svg.viewBox.baseVal.width;

  const show = (i) => {
    crosshair.setAttribute('x1', data.x[i]);
    crosshair.setAttribute('x2', data.x[i]);
    crosshair.classList.add('on');
    tip.replaceChildren();
    const head = document.createElement('p');
    head.className = 'tip-head';
    head.textContent = data.days[i];
    tip.append(head);
    data.series.forEach((s, k) => {
      const row = document.createElement('p');
      const key = document.createElement('span');
      key.className = `key key-line s${k}`;
      const value = document.createElement('strong');
      value.textContent = s.values[i].toLocaleString('en-US');
      const name = document.createElement('span');
      name.textContent = ` votes for ${s.label}`;
      row.append(key, value, name);
      tip.append(row);
    });
    tip.hidden = false;
    const scale = svg.getBoundingClientRect().width / viewWidth;
    const left = data.x[i] * scale;
    const flip = left > body.clientWidth * 0.6;
    tip.style.left = `${flip ? left - tip.offsetWidth - 12 : left + 12}px`;
  };
  const hide = () => {
    crosshair.classList.remove('on');
    tip.hidden = true;
  };
  const nearest = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * viewWidth;
    let best = 0;
    data.x.forEach((px, i) => Math.abs(px - x) < Math.abs(data.x[best] - x) && (best = i));
    return best;
  };

  svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  svg.addEventListener('pointerleave', hide);

  // Keyboard: focus the chart, then arrow between weekdays.
  svg.setAttribute('tabindex', '0');
  let at = 0;
  svg.addEventListener('focus', () => show(at));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') at = Math.min(data.x.length - 1, at + 1);
    else if (e.key === 'ArrowLeft') at = Math.max(0, at - 1);
    else return;
    e.preventDefault();
    show(at);
  });
}

// Slow forms (simulated runs take around 20 seconds): show that work has started,
// and stop a second click from starting a second paid run.
for (const form of document.querySelectorAll('form[data-busy]')) {
  form.addEventListener('submit', () => {
    const button = form.querySelector('button[type="submit"]');
    if (!button || button.disabled) return;
    // Disable after the browser has collected the form data.
    setTimeout(() => {
      button.disabled = true;
      button.textContent = `${form.dataset.busy}\u2026`;
    }, 0);
  });
}

// Interview rehearsals advance on their own; the button remains for when script is off.
for (const form of document.querySelectorAll('form[data-autosubmit]')) {
  setTimeout(() => form.requestSubmit(), 900);
}
