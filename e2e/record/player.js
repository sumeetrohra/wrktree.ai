/* global Terminal, FitAddon */
// Replays a recorded E2E run: terminal bytes into two xterm.js panes, steps,
// assertions and title cards, on the timeline the recorder computed.
(function () {
  const pb = window.PLAYBACK;
  const theme = {
    background: "#11141b",
    foreground: "#e6e8ee",
    cursor: "#11141b",
    black: "#1b1f2a",
    brightBlack: "#6b7385",
    red: "#f87171",
    green: "#4ade80",
    yellow: "#facc15",
    blue: "#7aa2ff",
    magenta: "#e879f9",
    cyan: "#67e8f9",
    white: "#e6e8ee",
  };
  const mk = (id) => {
    const term = new Terminal({
      fontFamily: "'DejaVu Sans Mono', 'Menlo', 'Consolas', monospace",
      fontSize: 15,
      lineHeight: 1.15,
      theme,
      scrollback: 2000,
      convertEol: false,
      cursorBlink: false,
      disableStdin: true,
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(document.getElementById(id));
    fit.fit();
    return term;
  };
  const terms = { cmd: mk("cmd"), events: mk("events") };

  const $ = (id) => document.getElementById(id);
  const progress = $("progress");
  for (let i = 0; i < pb.total; i++) progress.appendChild(document.createElement("i"));
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

  function card(html) {
    const c = $("card");
    if (html) {
      c.innerHTML = html;
      c.classList.add("show");
    } else {
      c.classList.remove("show");
    }
  }

  const handlers = {
    intro(e) {
      card(
        `<div class="kicker">Agentdeck · Phase 1 · Daemon core</div>` +
          `<h1>End-to-end tests</h1>` +
          `<p>${pb.total} scenarios against the real daemon and the real <code>agentdeck</code> CLI, ` +
          `driving a scripted ACP agent (no tokens spent).</p>` +
          `<p>Left: commands as typed. Middle: the live event stream. Right: assertions as they pass.</p>` +
          `<div class="meta">${esc(e.meta)}</div>`,
      );
    },
    scenario(e) {
      terms.cmd.reset();
      terms.events.reset();
      $("checks").innerHTML = "";
      $("name").textContent = `${e.n}/${pb.total} · ${e.title}`;
      $("step").textContent = "";
      [...progress.children].forEach((el, i) => {
        if (i === e.n - 1) el.className = "cur";
      });
      card(
        `<div class="kicker">Scenario ${e.n} of ${pb.total}</div>` +
          `<h1>${esc(e.title)}</h1><p>${esc(e.summary)}</p>` +
          `<div class="covers">Spec acceptance: ${e.covers.map(esc).join("<br>")}</div>`,
      );
    },
    play() {
      card(null);
    },
    out(e) {
      terms[e.pane].write(e.data);
    },
    step(e) {
      $("step").textContent = e.text;
    },
    check(e) {
      const div = document.createElement("div");
      div.className = `check${e.ok ? "" : " fail"}`;
      div.innerHTML = `<b>${e.ok ? "✓" : "✗"}</b><span>${esc(e.label)}${e.detail ? `<span class="detail">${esc(e.detail.slice(0, 300))}</span>` : ""}</span>`;
      $("checks").appendChild(div);
    },
    result(e) {
      progress.children[e.n - 1].className = e.ok ? "done" : "fail";
      $("step").textContent = e.ok ? "✓ passed" : `✗ failed: ${e.error ?? ""}`;
    },
    summary(e) {
      const rows = e.rows
        .map(
          (r) =>
            `<tr><td class="${r.ok ? "ok" : "bad"}">${r.ok ? "PASS" : "FAIL"}</td><td>${r.n}. ${esc(r.title)}</td>` +
            `<td class="muted">${r.checks} assertions</td><td class="muted">${(r.ms / 1000).toFixed(1)} s</td></tr>`,
        )
        .join("");
      card(
        `<div class="kicker">Phase 1 · Summary</div>` +
          `<h1>${e.passed}/${e.total} scenarios passed</h1>` +
          `<p>${e.checks} assertions · real run time ${(e.ms / 1000).toFixed(1)} s (idle gaps shortened in this video)</p>` +
          `<table>${rows}</table><div class="meta">${esc(e.meta)}</div>`,
      );
    },
  };

  const start = performance.now();
  let i = 0;
  function tick() {
    const now = performance.now() - start;
    while (i < pb.events.length && pb.events[i].at <= now) {
      const e = pb.events[i++];
      handlers[e.kind](e);
    }
    if (i < pb.events.length) requestAnimationFrame(tick);
    else setTimeout(() => (window.__done = true), pb.tail);
  }
  window.__start = () => requestAnimationFrame(tick);
})();
