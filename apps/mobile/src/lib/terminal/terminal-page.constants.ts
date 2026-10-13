const XTERM = "https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0";
const FIT = "https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.11.0";

/**
 * The terminal page phones load in a WebView: xterm.js from a pinned CDN version, checked by
 * subresource integrity (the same files as the npm packages the web build bundles).
 */
export const TERMINAL_PAGE = `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<link rel="stylesheet" href="${XTERM}/css/xterm.css" integrity="sha384-n2n7twoohnW+d3myBKaUgl7DSiwidw6MkQy9oesGzkPpMjejKRR3XlnD+5yCdtBD" crossorigin="anonymous" />
<style>html, body, #t { margin: 0; height: 100%; background: black; }</style>
</head>
<body>
<div id="t"></div>
<script src="${XTERM}/lib/xterm.js" integrity="sha384-f/1U6Z9wM4D71a5eRXEZnyOTMOvjqxr2XLwh+Go1OvIl3L3tOcvUrzudnhbECwl4" crossorigin="anonymous"></script>
<script src="${FIT}/lib/addon-fit.js" integrity="sha384-txoiwu4RR2GD3qySbaj+BbzibkLbSJRcfqGYMu6z1EqHil4A2dyBiBW5dlacG6OR" crossorigin="anonymous"></script>
<script>
  const term = new Terminal({ fontSize: 13, cursorBlink: true, scrollback: 5000 });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById("t"));
  fit.fit();
  const post = (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m));
  term.onData((data) => post({ type: "input", data }));
  term.onResize(({ cols, rows }) => post({ type: "resize", cols, rows }));
  window.addEventListener("resize", () => fit.fit());
  window.agentdeckWrite = (data) => term.write(data);
  post({ type: "ready", cols: term.cols, rows: term.rows });
</script>
</body>
</html>`;
