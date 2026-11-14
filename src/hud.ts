// Broadcast-style overlay for the animated lap: timing tower, sectors,
// telemetry (speed, gear, revs, pedals), track map and event tags.
import { LocalProjection } from './geometry';
import { type LapProfile, carAt, formatLapTime, telemetry, timeAtDist } from './lap';
import { SECTOR_COLORS } from './elements';

export interface HudOptions {
  profile: LapProfile;
  name: string;
  /** Distances where sectors 2 and 3 start. */
  sectors: [number, number];
  corners: { number: number; from: number; to: number }[];
  straightMode: { from: number; to: number }[];
  speedTrap: number | null;
  closed: boolean;
}

const inRange = (d: number, from: number, to: number) => (from <= to ? d >= from && d <= to : d >= from || d <= to);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const RPM_LEDS = 15;

export class LapHud {
  private root: HTMLElement;
  private o: HudOptions;
  private sectorTimes: number[];
  private trapShownAt = -1;
  private trapSpeed = 0;
  private el: Record<string, HTMLElement> = {};
  private leds: HTMLElement[] = [];
  private secEls: HTMLElement[] = [];
  private toMap: (i: number) => [number, number];

  constructor(root: HTMLElement, o: HudOptions) {
    this.root = root;
    this.o = o;
    const p = o.profile;
    // Time each sector ends.
    this.sectorTimes = [timeAtDist(p, o.sectors[0]), timeAtDist(p, o.sectors[1]), p.lapTime];

    // Track map, north up, fitted into a 200×150 box.
    const proj = new LocalProjection(p.coords[0]);
    const xy = p.coords.map((c) => proj.toXY(c));
    const xs = xy.map((q) => q[0]);
    const ys = xy.map((q) => q[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const scale = Math.min(184 / (maxX - minX || 1), 134 / (maxY - minY || 1));
    const ox = (200 - (maxX - minX) * scale) / 2;
    const oy = (150 - (maxY - minY) * scale) / 2;
    this.toMap = (i) => [ox + (xy[i][0] - minX) * scale, 150 - oy - (xy[i][1] - minY) * scale];
    const pathFor = (from: number, to: number) => {
      let d = '';
      for (let i = 0; i < p.coords.length; i++) {
        if (p.dist[i] < from - 6 || p.dist[i] > to + 6) continue;
        const [x, y] = this.toMap(i);
        d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      }
      return d;
    };
    const cuts = [0, o.sectors[0], o.sectors[1], p.length];
    const sectorPaths = [0, 1, 2]
      .map((s) => `<path d="${pathFor(cuts[s], cuts[s + 1])}" stroke="${SECTOR_COLORS[s]}" class="m-sec"/>`)
      .join('');
    const [sx, sy] = this.toMap(0);

    root.innerHTML = `
      <div class="hud-tower">
        <div class="hud-head"><b>${esc(o.name || 'Circuito')}</b><span>${(p.length / 1000).toFixed(3)} km</span></div>
        <div class="hud-row hud-lap"><span>Vuelta</span><b>1 / 1</b></div>
        <div class="hud-row hud-clock"><b data-k="time">0:00.000</b></div>
        ${[0, 1, 2]
          .map(
            (s) => `<div class="hud-row hud-sec" data-s="${s}">
              <i style="background:${SECTOR_COLORS[s]}"></i><span>S${s + 1}</span><b>—</b></div>`,
          )
          .join('')}
        <div class="hud-row hud-est"><span>Estimado</span><b>${formatLapTime(p.lapTime, 3)}</b></div>
      </div>
      <svg class="hud-map" viewBox="0 0 200 150" aria-hidden="true">
        <path d="${pathFor(0, p.length)}" class="m-base"/>${sectorPaths}
        <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="3.2" class="m-start"/>
        <circle data-k="dot" r="5" class="m-car"/>
      </svg>
      <div class="hud-tags">
        <div class="hud-tag corner" data-k="corner" hidden></div>
        <div class="hud-tag sm" data-k="sm" hidden>Straight Mode</div>
        <div class="hud-tag trap" data-k="trap" hidden></div>
      </div>
      <div class="hud-tele">
        <div class="hud-leds">${'<i></i>'.repeat(RPM_LEDS)}</div>
        <div class="hud-main">
          <div class="hud-gear"><b data-k="gear">N</b><span>Marcha</span></div>
          <div class="hud-speed"><b data-k="speed">0</b><span>km/h</span></div>
          <div class="hud-pedals">
            <div class="ped thr"><i data-k="thr"></i></div>
            <div class="ped brk"><i data-k="brk"></i></div>
          </div>
        </div>
      </div>
      <div class="hud-progress"><i data-k="bar"></i></div>`;
    root.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.el[e.dataset.k!] = e));
    this.leds = [...root.querySelectorAll<HTMLElement>('.hud-leds i')];
    this.secEls = [...root.querySelectorAll<HTMLElement>('.hud-sec')];
    root.hidden = false;
  }

  /** Draw the overlay `t` seconds into the lap. */
  update(t: number) {
    const { profile: p, corners, straightMode, speedTrap } = this.o;
    const car = carAt(p, t);
    const lapT = Math.min(t, p.lapTime);
    const tel = telemetry(p, car.index, car.speed);
    const kmh = Math.round(car.speed * 3.6);

    this.el.time.textContent = formatLapTime(lapT, 3);
    this.el.speed.textContent = String(kmh);
    this.el.gear.textContent = String(tel.gear);
    this.el.thr.style.height = `${tel.throttle * 100}%`;
    this.el.brk.style.height = `${tel.brake * 100}%`;
    this.el.bar.style.width = `${(100 * car.dist) / p.length}%`;
    const lit = Math.round(tel.rpm * RPM_LEDS);
    this.leds.forEach((l, i) => l.classList.toggle('on', i < lit));

    // Sectors: finished ones show their time, the current one counts up.
    let start = 0;
    this.secEls.forEach((row, s) => {
      const end = this.sectorTimes[s];
      const b = row.querySelector('b')!;
      row.classList.toggle('done', lapT >= end);
      row.classList.toggle('live', lapT >= start && lapT < end);
      if (lapT >= end) b.textContent = (end - start).toFixed(3);
      else if (lapT >= start) b.textContent = (lapT - start).toFixed(1);
      else b.textContent = '—';
      start = end;
    });

    const [x, y] = this.toMap(car.index);
    this.el.dot.setAttribute('cx', x.toFixed(1));
    this.el.dot.setAttribute('cy', y.toFixed(1));

    const corner = corners.find((c) => inRange(car.dist, c.from, c.to));
    this.el.corner.hidden = !corner;
    if (corner) this.el.corner.textContent = `Curva ${corner.number}`;
    this.el.sm.hidden = !straightMode.some((z) => inRange(car.dist, z.from, z.to));

    if (speedTrap !== null && this.trapShownAt < 0 && car.dist >= speedTrap) {
      this.trapShownAt = t;
      this.trapSpeed = kmh;
    }
    const showTrap = this.trapShownAt >= 0 && t - this.trapShownAt < 4;
    this.el.trap.hidden = !showTrap;
    if (showTrap) this.el.trap.innerHTML = `Speed trap <b>${this.trapSpeed}</b> km/h`;
  }

  destroy() {
    this.root.hidden = true;
    this.root.innerHTML = '';
  }
}
