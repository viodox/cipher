'use strict';

// First-party prefix. Filter lists block /_vercel/insights/script.js and
// /_vercel/insights/view. vercel.json rewrites /rq/s/* onto that route.
// The production script (sv 0.1.3) reads data-endpoint off document.currentScript
// and POSTs pageviews to {endpoint}/view and custom events to {endpoint}/event.
const ANALYTICS_SRC = '/rq/s/script.js';
const ANALYTICS_ENDPOINT = '/rq/s';

const ANALYTICS_SNIPPET =
  '<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>\n' +
  '<script defer src="' + ANALYTICS_SRC + '" data-endpoint="' + ANALYTICS_ENDPOINT + '"></script>';

// CipherPot writes the scan permalink with history.replaceState. The Vercel
// script hooks pushState and popstate only, so those URL changes need an
// explicit pageview. va('pageview') with no options is ignored by script 0.1.3;
// the second argument must be truthy.
const ROUTE_PAGEVIEW_SCRIPT = `<script>
(function(){
  var replace = history.replaceState;
  history.replaceState = function(){
    var before = location.pathname + location.search;
    var result = replace.apply(history, arguments);
    var after = location.pathname + location.search;
    if(after !== before && typeof window.va === 'function') window.va('pageview', { path: location.pathname });
    return result;
  };
})();
</script>`;

module.exports = {
  ANALYTICS_SRC,
  ANALYTICS_ENDPOINT,
  ANALYTICS_SNIPPET,
  ROUTE_PAGEVIEW_SCRIPT,
};
