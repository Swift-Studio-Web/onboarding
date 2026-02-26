#!/usr/bin/env node
/**
 * Swift Studio Intake Server
 * - Serves onboarding form at GET /
 * - Receives form submissions at POST /submit
 * - Saves intake JSON + fires openclaw system event
 */
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { execSync } = require('child_process');

const PORT        = 3000;
const INTAKES_DIR = path.join(__dirname, '..', 'memory', 'intakes');
const FORM_PATH   = path.join(__dirname, 'index.html');
const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1473486095139209490/vkxKkeP4RtaLhGIJFAgHKPqpg9ap5cwXd6ReEBbdYwaYmGdlrkpFaPIAEZy8VjITwQWv';
const MC_ACTIVITY_URL = 'http://127.0.0.1:3002/api/activity';

function logActivity(actor, action, target, status = 'success', details) {
  const payload = JSON.stringify({ actor, action, target, status, details });
  const req = http.request({
    hostname: '127.0.0.1', port: 3002, path: '/api/activity', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  }, (res) => {
    if (res.statusCode >= 400) console.error(`[activity-log] HTTP ${res.statusCode}`);
  });
  req.on('error', (e) => console.error('[activity-log] error:', e.message));
  req.end(payload);
}

const LABEL_MAP = {
  'yes-outdated':'Yes — needs full redo','yes-ok':'Yes — minor improvements','no':'No website yet',
  leads:'Get more leads',credibility:'Look professional',sales:'Sell online',
  portfolio:'Showcase work',info:'Informational',seo:'Improve SEO',
  logo:'Logo',colors:'Brand colors',fonts:'Fonts',photos:'Photography',copy:'Written copy',none:'None — starting fresh',
  'contact-form':'Contact form','live-chat':'Live chat',booking:'Online booking',
  payments:'Payments',gallery:'Gallery',map:'Map embed',multilang:'Multi-language',nothing:'Keep it simple',
  urgent:'ASAP',month:'Within a month','1-3mo':'1–3 months',planning:'Just planning',
  'free-offer':'Complimentary (Swift Studio offer)','<500':'Under $500','500-1k':'$500–$1k','1-2k':'$1k–$2k','2k+':'$2k+',unsure:'Not sure / get a quote',
  home:'Home',about:'About',services:'Services',contact:'Contact',shop:'Online Store',blog:'Blog',faq:'FAQ',
};
function label(v) { return LABEL_MAP[v] || v || '—'; }
function labelList(arr) { return (Array.isArray(arr) ? arr.map(label).join(', ') : label(arr)) || '—'; }

function postToDiscord(data) {
  const embed = {
    title: `New Onboarding — ${data.name || 'Unknown'}`,
    color: 0x2563eb,
    fields: [
      { name: 'Name',          value: data.name || '—',              inline: true },
      { name: 'Source',         value: data.source || 'direct',       inline: true },
      { name: 'Business',       value: data.business || '—' },
      { name: 'Existing Site',  value: label(data.existingSite),      inline: true },
      { name: 'URL',            value: data.siteUrl || '—',           inline: true },
      { name: 'Goals',          value: labelList(data.goals) },
      { name: 'Pages',          value: labelList(data.pages) },
      { name: 'Branding',       value: labelList(data.branding) },
      { name: 'Features',       value: labelList(data.features) },
      { name: 'Inspiration',    value: data.inspiration || '—' },
      { name: 'Timeline',       value: label(data.timeline),          inline: true },
      { name: 'Budget',         value: label(data.budget),            inline: true },
      { name: 'Notes',          value: data.notes || '—' },
    ],
    footer: { text: `Swift Studio Onboarding • ${new Date().toLocaleString()}` }
  };

  const payload = JSON.stringify({ embeds: [embed] });
  const url = new URL(DISCORD_WEBHOOK);
  const req = https.request({
    hostname: url.hostname, path: url.pathname, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  }, (res) => {
    if (res.statusCode >= 400) console.error(`Discord webhook responded ${res.statusCode}`);
  });
  req.on('error', (e) => console.error('Discord webhook error:', e.message));
  req.end(payload);
}

fs.mkdirSync(INTAKES_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  // CORS for any preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve favicon
  if (req.method === 'GET' && req.url === '/favicon.svg') {
    try {
      const svg = fs.readFileSync(path.join(__dirname, 'favicon.svg'));
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
      res.end(svg);
    } catch (e) {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  // Serve the onboarding form
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    try {
      const html = fs.readFileSync(FORM_PATH, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500); res.end('Server error');
    }
    return;
  }

  // Handle form submission
  if (req.method === 'POST' && req.url === '/submit') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const id   = Date.now();
        const file = path.join(INTAKES_DIR, `${id}.json`);
        fs.writeFileSync(file, JSON.stringify({ ...data, id, receivedAt: new Date().toISOString() }, null, 2));

        // Fire Discord webhook simultaneously
        postToDiscord(data);

        // Log to Mission Control activity feed
        logActivity('Swifty', 'received intake', `${name} / ${business}`, 'success', `Budget: ${label(budget)} | Timeline: ${label(timeline)}`);

        const name     = data.name     || 'Unknown';
        const business = data.business || '—';
        const budget   = data.budget   || '—';
        const timeline = data.timeline || '—';
        const goals    = Array.isArray(data.goals) ? data.goals.join(', ') : (data.goals || '—');
        const channel  = data.channel  || '';

        const text = [
          `New client intake from ${name} (${business}).`,
          `Goals: ${goals} | Budget: ${budget} | Timeline: ${timeline}.`,
          channel ? `Follow up in Discord channel ${channel}.` : '',
          `Full intake at ${file}.`,
          `Read the file, follow up with the client to clarify anything unclear, then send perpaloo a requirements summary.`
        ].filter(Boolean).join(' ');

        execSync(`node /app/dist/entry.js system event --text ${JSON.stringify(text)} --mode now`, {
          timeout: 5000,
          env: { ...process.env }
        });

        console.log(`[${new Date().toISOString()}] Intake from ${name} (${business}) → saved to ${file}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id }));
      } catch (e) {
        console.error('Submission error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Swift Studio intake server listening on 0.0.0.0:${PORT}`);
});
