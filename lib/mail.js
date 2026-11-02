'use strict';

const SITE = 'https://www.ciphersignal.xyz';

function resendUrl() {
  return (process.env.RESEND_API_URL || 'https://api.resend.com/emails').replace(/\/$/, '');
}

function unsubUrl(token) {
  return SITE + '/api/alerts/unsubscribe?token=' + encodeURIComponent(token) + '&confirm=1';
}

async function sendMail({ to, subject, text, unsub }) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    return { ok: false, error: 'email is not configured' };
  }
  const headers = {};
  if (unsub) {
    headers['List-Unsubscribe'] = '<' + unsub + '>';
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  let res;
  try {
    res = await fetch(resendUrl(), {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + process.env.RESEND_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: [to],
        subject,
        text,
        headers,
      }),
    });
  } catch (err) {
    return { ok: false, error: 'email request failed' };
  }
  if (!res.ok) return { ok: false, error: 'email was not accepted', status: res.status };
  return { ok: true };
}

function confirmationText(row) {
  const link = unsubUrl(row.unsubToken);
  return [
    'Your CIPHER price alert is saved.',
    '',
    row.coinSymbol + ' (' + row.coinId + ') — email when the USD price goes ' + row.direction + ' $' + row.threshold + '.',
    'Prices are checked about once a day. You get one email if your number is hit.',
    '',
    'Unsubscribe (one click): ' + link,
    '',
    'Not financial advice.',
  ].join('\n');
}

function alertText(row, price) {
  const link = unsubUrl(row.unsubToken);
  return [
    row.coinSymbol + ' is $' + price + ', which is ' + row.direction + ' your $' + row.threshold + ' alert.',
    '',
    SITE + '/coin/' + row.coinId,
    '',
    'This alert will not email again.',
    'Unsubscribe: ' + link,
    '',
    'Not financial advice.',
  ].join('\n');
}

module.exports = { sendMail, confirmationText, alertText, unsubUrl, resendUrl };
