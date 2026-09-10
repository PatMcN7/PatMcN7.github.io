(() => {
  const canvas = document.querySelector('#paint');
  const ctx = canvas.getContext('2d');
  const button = document.querySelector('#pause');
  if (!ctx) { button.hidden = true; return; }

  const colors = ['#edb4cd', '#b6c9ef', '#f3d18b', '#b4d8ad', '#ccb5e7', '#efb99d', '#a8d6da'];
  let width, height, lastTime, frame, count = 0;
  let brushes = [];
  const simultaneousStrokes = 3;
  const staggerTime = 1500;
  let paused = false;
  let paintTime = 0;
  let strokes = [];
  const holdTime = 50000;
  const fadeTime = 6000;
  const random = (a, b) => a + Math.random() * (b - a);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const smoothstep = t => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };

  function textBounds() {
    // Measure the content, not the main element's large outer padding.
    const boxes = [...document.querySelectorAll('main > *')].map(element => element.getBoundingClientRect());
    return {
      left: Math.min(...boxes.map(box => box.left)),
      right: Math.max(...boxes.map(box => box.right)),
      top: Math.min(...boxes.map(box => box.top)),
      bottom: Math.max(...boxes.map(box => box.bottom))
    };
  }

  function clearance(point, bounds) {
    const x = clamp(point.x, bounds.left, bounds.right);
    const y = clamp(point.y, bounds.top, bounds.bottom);
    const dx = point.x - x;
    const dy = point.y - y;
    const distance = Math.hypot(dx, dy);
    return { distance, nx: dx / (distance || 1), ny: dy / (distance || 1) };
  }

  function makePath(edge, thickness, bounds) {
    const radius = thickness / 2;
    const margin = radius + 24;
    const outside = radius + 3;
    const entries = [
      { x: -outside, y: random(0, height), angle: 0 },
      { x: width + outside, y: random(0, height), angle: Math.PI },
      { x: random(0, width), y: -outside, angle: Math.PI / 2 },
      { x: random(0, width), y: height + outside, angle: -Math.PI / 2 }
    ];
    let point = entries[edge];
    const zone = random(85, 180);
    if (clearance(point, bounds).distance < margin + zone * .65) return null;
    let base = point.angle + random(-.65, .65);
    const amplitude = random(.35, .75);
    const wavelength = random(320, 850);
    const phase = random(0, Math.PI * 2);
    const wave = travel => amplitude * Math.sin(travel / wavelength * Math.PI * 2 + phase);
    const points = [{ x: point.x, y: point.y }];
    let turn = null;
    let cooling = false;
    let entered = false;
    const step = 2;

    for (let travel = 0; travel < Math.hypot(width, height) * 6; travel += step) {
      const near = clearance(point, bounds);
      const room = near.distance - margin;
      if (room < 0) return null;
      let angle = base + wave(travel);
      if (cooling && room > zone + 40) cooling = false;
      const approach = Math.cos(angle) * near.nx + Math.sin(angle) * near.ny;
      if (!turn && !cooling && room < zone && approach < -.15) {
        // Keep the incoming motion along the text, with a small outward bias:
        // a glancing skip, rather than a reflection or a perimeter-following force.
        const tangentX = -near.ny;
        const tangentY = near.nx;
        const along = Math.cos(angle) * tangentX + Math.sin(angle) * tangentY;
        const side = Math.abs(along) > .08 ? Math.sign(along) : (Math.random() < .5 ? -1 : 1);
        const outward = random(.22, .34);
        const vx = tangentX * side + near.nx * outward;
        const vy = tangentY * side + near.ny * outward;
        const outgoing = Math.atan2(vy, vx);
        const delta = Math.atan2(Math.sin(outgoing - angle), Math.cos(outgoing - angle));
        turn = { start: travel, length: Math.max(2, room * .9), angle, delta };
      }
      if (turn) {
        const t = Math.min(1, (travel - turn.start) / turn.length);
        angle = turn.angle + turn.delta * smoothstep(t);
        if (t >= 1) {
          base = angle - wave(travel);
          turn = null;
          cooling = true;
        }
      }
      point = { x: point.x + Math.cos(angle) * step, y: point.y + Math.sin(angle) * step };
      points.push(point);
      if (point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height) entered = true;
      if (entered && (point.x < -outside || point.x > width + outside || point.y < -outside || point.y > height + outside)) {
        return points;
      }
    }
    return null;
  }

  let entryEdges = [];
  function newBrush() {
    const thickness = random(.065, .095) * Math.min(width, height);
    const bounds = textBounds();
    if (!entryEdges.length) {
      entryEdges = [0, 1, 2, 3];
      for (let i = 3; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [entryEdges[i], entryEdges[j]] = [entryEdges[j], entryEdges[i]];
      }
    }
    const preferredEdge = entryEdges.pop();
    let points;
    for (let attempt = 0; attempt < 120 && !points; attempt++) {
      // A narrow phone layout may leave an entire edge obstructed by text.
      const edge = attempt < 40 ? preferredEdge : Math.floor(random(0, 4));
      points = makePath(edge, thickness, bounds);
    }
    // If the visible content leaves no usable route, keep painting offscreen
    // until a later stroke or viewport change makes room.
    if (!points) points = [{ x: -thickness, y: -thickness }, { x: width + thickness, y: -thickness }];
    return { points, segment: 0, progress: 0, thickness, color: colors[count++ % colors.length] };
  }

  function paint(brush, distance) {
    // Spend the same pixel distance every frame, including across curve segments
    // and when one edge-to-edge stroke hands off to the next.
    while (distance > .001) {
      const a = brush.points[brush.segment];
      const b = brush.points[brush.segment + 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const next = Math.min(length, brush.progress + distance);
      if (!brush.stroke) {
        brush.stroke = { born: paintTime, color: brush.color, thickness: brush.thickness, points: [{ x: a.x, y: a.y }] };
        strokes.push(brush.stroke);
      }
      brush.stroke.points.push({ x: a.x + (b.x - a.x) * next / length, y: a.y + (b.y - a.y) * next / length });
      distance -= next - brush.progress;
      brush.progress = next;
      if (next >= length) {
        brush.segment++;
        brush.progress = 0;
        if (brush.segment >= brush.points.length - 1) brush = newBrush();
      }
    }
    return brush;
  }

  function render() {
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    strokes = strokes.filter(stroke => paintTime - stroke.born < holdTime + fadeTime);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokes) {
      const age = paintTime - stroke.born;
      ctx.globalAlpha = 1 - smoothstep((age - holdTime) / fadeTime);
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.thickness;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function resize() {
    width = innerWidth;
    height = innerHeight;
    const scale = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    strokes = [];
    paintTime = 0;
    brushes = [newBrush()];
    lastTime = undefined;
  }

  function tick(time) {
    const elapsed = Math.min(time - (lastTime ?? time - 16), 100);
    lastTime = time;
    paintTime += elapsed;
    while (brushes.length < simultaneousStrokes && paintTime >= brushes.length * staggerTime) {
      brushes.push(newBrush());
    }
    brushes = brushes.map(brush => paint(brush, elapsed * .18));
    render();
    frame = requestAnimationFrame(tick);
  }

  function sync() {
    cancelAnimationFrame(frame);
    lastTime = undefined;
    button.textContent = paused ? 'Resume painting' : 'Pause painting';
    button.setAttribute('aria-label', paused ? 'Resume background painting' : 'Pause background painting');
    if (!paused && !document.hidden) frame = requestAnimationFrame(tick);
  }
  button.addEventListener('click', () => { paused = !paused; sync(); });
  document.addEventListener('visibilitychange', sync);
  let resizeTimer;
  const refresh = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 100); };
  window.addEventListener('resize', refresh);
  window.addEventListener('scroll', refresh, { passive: true });
  resize();
  sync();
})();
