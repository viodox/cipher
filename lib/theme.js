'use strict';

// One source for the four color modes. The homepage file must include
// themeBootScript() and themeCss() verbatim (see test/feature-pack.test.js)
// so the first paint matches the shell pages.

const THEME_KEY = 'cipher-theme';

const THEMES = {
  og: {
    label: 'OG',
    title: 'Original teal and black',
    vars: {
      '--bg': '#060810',
      '--surface': '#0b0e1a',
      '--surface2': '#111625',
      '--border': '#1a2035',
      '--border2': '#243050',
      '--accent': '#00e5ff',
      '--accent3': '#00ff99',
      '--accent4': '#ff3355',
      '--text': '#e8eef8',
      '--ink': '#e4eef8',
      '--secondary': '#c9d4e6',
      '--muted': '#a8b8d4',
      '--pos': '#00ff99',
      '--neg': '#ff3355',
      '--warn': '#ffb400',
      '--on-accent': '#041018',
      '--on-pos': '#04140c',
      '--on-warn': '#041018',
      '--focus': '#e4eef8',
      '--scheme': 'dark',
    },
  },
  voltage: {
    label: 'Voltage',
    title: 'Voltage, electric violet on black',
    vars: {
      '--bg': '#07060e',
      '--surface': '#120c1c',
      '--surface2': '#1c1230',
      '--border': '#3a2460',
      '--border2': '#55348a',
      '--accent': '#edd9ff',
      '--accent3': '#8dffb5',
      '--accent4': '#ff7b93',
      '--text': '#f6efff',
      '--ink': '#f4ecff',
      '--secondary': '#e6daf8',
      '--muted': '#d4c6ee',
      '--pos': '#8dffb5',
      '--neg': '#ff8fa3',
      '--warn': '#ffd78a',
      '--on-accent': '#1a0b2e',
      '--on-pos': '#04140c',
      '--on-warn': '#1a0b2e',
      '--focus': '#f6efff',
      '--scheme': 'dark',
    },
  },
  mint: {
    label: 'Mint',
    title: 'Mint on charcoal',
    vars: {
      '--bg': '#07110e',
      '--surface': '#0e1c17',
      '--surface2': '#143026',
      '--border': '#1f4638',
      '--border2': '#2f6a54',
      '--accent': '#c8fff0',
      '--accent3': '#9dffc0',
      '--accent4': '#ff8fa3',
      '--text': '#edfff8',
      '--ink': '#e7fff6',
      '--secondary': '#d7f6ea',
      '--muted': '#c8e8da',
      '--pos': '#9dffc0',
      '--neg': '#ff9aab',
      '--warn': '#ffe0a3',
      '--on-accent': '#042018',
      '--on-pos': '#04140c',
      '--on-warn': '#042018',
      '--focus': '#edfff8',
      '--scheme': 'dark',
    },
  },
  paper: {
    label: 'Paper',
    title: 'Paper, high-contrast light',
    vars: {
      '--bg': '#f4f7fb',
      '--surface': '#ffffff',
      '--surface2': '#e7eef8',
      '--border': '#c5d2e4',
      '--border2': '#6d84a3',
      '--accent': '#004e66',
      '--accent3': '#085c34',
      '--accent4': '#9f1239',
      '--text': '#101828',
      '--ink': '#0c1220',
      '--secondary': '#1a2740',
      '--muted': '#1e2d44',
      '--pos': '#085c34',
      '--neg': '#9f1239',
      '--warn': '#7a3e00',
      '--on-accent': '#ffffff',
      '--on-pos': '#ffffff',
      '--on-warn': '#ffffff',
      '--focus': '#004e66',
      '--scheme': 'light',
    },
  },
};

function themeBootScript() {
  return '<script>(function(){var a={og:1,voltage:1,mint:1,paper:1};var t="og";try{var s=localStorage.getItem("' + THEME_KEY + '");if(a[s])t=s;}catch(e){}document.documentElement.setAttribute("data-theme",t);})();</script>';
}

function themeCss() {
  const blocks = Object.keys(THEMES).map((id) => {
    const theme = THEMES[id];
    const body = Object.keys(theme.vars).map((key) => {
      if (key === '--scheme') return 'color-scheme:' + theme.vars[key];
      return key + ':' + theme.vars[key];
    }).join(';');
    if (id === 'og') return ':root,html[data-theme="og"]{' + body + '}';
    return 'html[data-theme="' + id + '"]{' + body + '}';
  });
  blocks.push(
    '.grade-a{color:var(--pos)}.grade-b{color:var(--accent)}.grade-c{color:var(--warn)}.grade-d{color:#ff7a45}.grade-f{color:var(--neg)}',
    'html[data-theme="paper"] .grade-d{color:#9a3412}',
    'html[data-theme="paper"] .buy-cta-label,html[data-theme="paper"] .buy-cta-note,html[data-theme="paper"] .buy-disclosure,html[data-theme="paper"] .buy-soft{color:#102033}',
    '.theme-switch{display:flex;align-items:center;gap:4px;flex-wrap:wrap;border:1px solid var(--border2);border-radius:4px;padding:3px;background:var(--surface)}',
    '.theme-switch .theme-k{font-family:Orbitron,monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:0 6px}',
    '.theme-switch button{font-family:Orbitron,monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;background:transparent;color:var(--muted);border:1px solid transparent;border-radius:3px;padding:6px 8px;cursor:pointer;min-height:32px}',
    '.theme-switch button[aria-pressed="true"]{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}',
    '.theme-switch button:hover{color:var(--text)}',
    '.theme-switch button:focus-visible,.site-nav a:focus-visible,a:focus-visible,button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}',
    '.site-nav a.flagship{color:var(--on-accent);background:var(--accent);border-color:var(--accent);font-weight:700}',
    '.site-nav a.flagship:hover{filter:brightness(1.08);color:var(--on-accent)}'
  );
  return blocks.join('\n');
}

function themeControlHtml() {
  const buttons = Object.keys(THEMES).map((id) => {
    const theme = THEMES[id];
    const pressed = id === 'og' ? 'true' : 'false';
    return '<button type="button" data-theme-set="' + id + '" title="' + theme.title + '" aria-pressed="' + pressed + '">' + theme.label + '</button>';
  }).join('');
  return '<div class="theme-switch" role="group" aria-label="Color theme"><span class="theme-k">Theme</span>' + buttons + '</div>';
}

function themeClientScript() {
  return '<script>(function(){var KEY="' + THEME_KEY + '";var buttons=document.querySelectorAll("[data-theme-set]");function apply(t){document.documentElement.setAttribute("data-theme",t);try{localStorage.setItem(KEY,t);}catch(e){}buttons.forEach(function(b){b.setAttribute("aria-pressed",b.getAttribute("data-theme-set")===t?"true":"false");});}buttons.forEach(function(b){b.addEventListener("click",function(){apply(b.getAttribute("data-theme-set"));});});apply(document.documentElement.getAttribute("data-theme")||"og");})();</script>';
}

function themeHead() {
  return themeBootScript() + '<style id="cipher-themes">' + themeCss() + '</style>';
}

module.exports = {
  THEME_KEY,
  THEMES,
  themeBootScript,
  themeCss,
  themeControlHtml,
  themeClientScript,
  themeHead,
};
