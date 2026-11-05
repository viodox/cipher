'use strict';

const { esc } = require('./http-util');

function shortAddress(address) {
  const value = String(address || '').trim();
  if (value.length < 14) return value;
  return value.slice(0, 6) + '…' + value.slice(-4);
}

// Truncation is visual (CSS ellipsis). The text node and the Copy button
// both hold the full address so a tap copies it and a long-press can select it.
function copyAddressHtml(address, opts) {
  const value = String(address || '').trim();
  if (!value) return '';
  const options = opts || {};
  const label = options.label || 'Copy address';
  const safe = esc(value);
  const open = options.full ? ' ca-open' : '';
  const link = options.href
    ? '<a class="ca-link" href="' + esc(options.href) + '" target="_blank" rel="noopener">' + esc(options.linkText || 'explorer') + '</a>'
    : '';
  return '<span class="ca' + open + '">'
    + '<span class="ca-text" data-address="' + safe + '" title="' + safe + '">' + safe + '</span>'
    + '<button type="button" class="ca-copy" data-copy-address="' + safe + '" aria-label="' + esc(label) + '">Copy</button>'
    + link
    + '</span>';
}

function copyAddressCss() {
  return [
    '.ca{display:inline-flex;align-items:center;gap:8px;max-width:100%;vertical-align:middle;flex-wrap:wrap}',
    '.ca-text{font-family:\'Share Tech Mono\',monospace;font-size:15px;line-height:1.45;color:var(--text);cursor:pointer;user-select:all;-webkit-user-select:all;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:min(46vw,15rem)}',
    '.ca-open .ca-text{max-width:100%;white-space:normal;overflow:visible;text-overflow:clip;word-break:break-all}',
    '.ca-copy{font-family:Orbitron,monospace;font-size:12px;letter-spacing:.08em;text-transform:uppercase;min-height:36px;padding:6px 10px;border-radius:4px;border:1px solid var(--border2);background:var(--surface2);color:var(--text);cursor:pointer}',
    '.ca-copy:hover{border-color:var(--text)}',
    '.ca-copy:focus-visible,.ca-text:focus-visible{outline:2px solid var(--focus);outline-offset:2px}',
    '.ca-copy.is-copied{background:var(--pos);color:var(--on-pos);border-color:var(--pos)}',
    '.ca-link{color:var(--accent);font-size:15px;text-decoration:underline;text-underline-offset:2px}',
    '.ca-toast{position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translateX(-50%) translateY(8px);background:var(--surface);color:var(--text);border:1px solid var(--pos);padding:10px 16px;border-radius:6px;font-family:Orbitron,monospace;font-size:13px;letter-spacing:.08em;text-transform:uppercase;z-index:10000;opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease}',
    '.ca-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}',
  ].join('\n');
}

function copyAddressScript() {
  return `<script>
(function(){
  if(window.__cipherCopyAddress) return;
  window.__cipherCopyAddress=true;
  function toast(msg){
    var el=document.getElementById('ca-toast');
    if(!el){
      el=document.createElement('div');
      el.id='ca-toast';
      el.setAttribute('role','status');
      el.setAttribute('aria-live','polite');
      el.className='ca-toast';
      document.body.appendChild(el);
    }
    el.textContent=msg;
    el.className='ca-toast show';
    clearTimeout(el._t);
    el._t=setTimeout(function(){ el.className='ca-toast'; }, 1600);
  }
  function writeText(text){
    if(navigator.clipboard&&navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function(resolve,reject){
      var ta=document.createElement('textarea');
      ta.value=text;
      ta.setAttribute('readonly','');
      ta.style.position='fixed';
      ta.style.left='-9999px';
      document.body.appendChild(ta);
      ta.select();
      try{ document.execCommand('copy')?resolve():reject(new Error('copy')); }
      catch(e){ reject(e); }
      finally{ document.body.removeChild(ta); }
    });
  }
  function flash(btn){
    if(!btn) return;
    var prev=btn.getAttribute('data-copy-label')||btn.textContent;
    var prevLabel=btn.getAttribute('data-copy-aria')||btn.getAttribute('aria-label')||prev;
    btn.setAttribute('data-copy-label', prev);
    btn.setAttribute('data-copy-aria', prevLabel);
    btn.textContent='Copied';
    btn.setAttribute('aria-label','Copied');
    btn.classList.add('is-copied');
    clearTimeout(btn._t);
    btn._t=setTimeout(function(){
      btn.textContent=prev;
      btn.setAttribute('aria-label', prevLabel);
      btn.classList.remove('is-copied');
    }, 1500);
  }
  document.addEventListener('click', function(ev){
    var node=ev.target&&ev.target.closest?ev.target.closest('[data-copy-address], .ca-text'):null;
    if(!node) return;
    var btn=node.closest('[data-copy-address]');
    var text=btn?null:node.closest('.ca-text');
    if(!btn&&!text) return;
    if(text){
      var selected=window.getSelection?String(window.getSelection()):'';
      if(selected) return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    var value=btn?(btn.getAttribute('data-copy-address')||''):(text.getAttribute('data-address')||text.textContent||'');
    value=String(value).trim();
    if(!value) return;
    var chip=btn||text.parentNode;
    writeText(value).then(function(){
      flash(btn||(chip&&chip.querySelector?chip.querySelector('.ca-copy'):null));
      toast('Copied');
    }).catch(function(){ toast('Could not copy'); });
  }, true);
})();
</script>`;
}

module.exports = {
  shortAddress,
  copyAddressHtml,
  copyAddressCss,
  copyAddressScript,
};
