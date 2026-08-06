// stet — the page. One self-contained document: inline CSS, inline JS, no
// framework, no build step, no CDN. It opens instantly and works offline.

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>stet</title>
<style>
:root{
  --bg:#14151a; --panel:#1b1d24; --panel2:#20232b; --line:#2b2e38; --line2:#3a3e4a;
  --ink:#d8d2c4; --dim:#8d8677; --faint:#5f5c52;
  --warm:#e79a5e; --cool:#79c2b2; --fail:#d9564f; --del:#b0685f;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Monaco,Consolas,monospace;
  --step:22px;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;background:var(--bg);color:var(--ink);
  font:13px/1.55 var(--mono);
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
}
::selection{background:rgba(231,154,94,.25)}
button,input,textarea{font:inherit;color:inherit}
kbd{
  font:inherit;font-size:10px;border:1px solid var(--line2);border-radius:3px;
  padding:1px 5px;color:var(--dim);background:rgba(0,0,0,.2);
}

/* ── the signature: tiny letterspaced label with a hairline under it ─────── */
.label{
  font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--cool);
  border-bottom:1px solid var(--line);padding-bottom:7px;margin:0 0 14px;
  display:flex;align-items:baseline;justify-content:space-between;gap:14px;
}
.label .dim{color:var(--faint);letter-spacing:.16em}
.label.warm{color:var(--warm)}
.label.fail{color:var(--fail)}
.label.plain{border-bottom:none;padding-bottom:0;margin-bottom:8px}

/* ── top bar ─────────────────────────────────────────────────────────────── */
.topbar{
  position:sticky;top:0;z-index:40;display:flex;align-items:center;justify-content:space-between;
  gap:20px;padding:0 var(--step);height:46px;
  background:rgba(20,21,26,.86);backdrop-filter:blur(12px);
  border-bottom:1px solid var(--line);
}
.brand{display:flex;align-items:center;gap:14px;min-width:0}
.wordmark{
  color:var(--warm);font-size:14px;letter-spacing:.22em;text-transform:lowercase;
}
.wordmark b{font-weight:600}
.vr{width:1px;height:16px;background:var(--line2)}
.repo{color:var(--faint);font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meters{display:flex;align-items:center;gap:18px}
.meter{display:flex;align-items:baseline;gap:7px}
.meter .k{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--faint)}
.meter .v{font-size:14px;color:var(--ink);font-variant-numeric:tabular-nums}
.meter.hot .v{color:var(--warm)}
.meter .v.pulse{animation:pop .5s ease-out}
@keyframes pop{0%{transform:scale(1)}35%{transform:scale(1.5);color:var(--cool)}100%{transform:scale(1)}}
.conn{display:flex;align-items:center;gap:7px;font-size:10px;letter-spacing:.18em;
  text-transform:uppercase;color:var(--faint)}
.conn i{width:6px;height:6px;border-radius:50%;background:var(--faint);display:block}
.conn.live i{background:var(--cool);box-shadow:0 0 0 3px rgba(121,194,178,.14)}
.conn.live{color:var(--cool)}
.conn.gone i{background:var(--fail)}
.conn.gone{color:var(--fail)}
.ghost{
  background:none;border:1px solid var(--line);color:var(--dim);border-radius:4px;
  width:24px;height:22px;cursor:pointer;line-height:1;
}
.ghost:hover{border-color:var(--line2);color:var(--ink)}

/* ── shell ───────────────────────────────────────────────────────────────── */
.wrap{max-width:1760px;margin:0 auto;padding:0 var(--step)}
main{padding-bottom:190px}

/* ── problems band — never skip an unparseable item silently ─────────────── */
.problems{border-bottom:1px solid var(--line);background:rgba(217,86,79,.05)}
.problems .inner{max-width:1760px;margin:0 auto;padding:16px var(--step) 18px}
.prob{display:flex;gap:14px;padding:5px 0;color:var(--ink)}
.prob b{color:var(--fail);font-weight:400}
.prob span{color:var(--dim)}
.prob code{color:var(--faint);font-size:12px}

/* ── the ask ─────────────────────────────────────────────────────────────── */
.ask{padding:30px 0 24px;border-bottom:1px solid var(--line)}
.q{
  font:inherit;font-size:21px;line-height:1.35;letter-spacing:-.01em;
  margin:0 0 14px;color:var(--warm);max-width:74ch;
}
.notes{margin:0 0 16px;color:var(--dim);max-width:82ch}
.how{border-left:2px solid var(--cool);padding:2px 0 2px 14px;margin:18px 0 0;max-width:82ch}
.how .label{border:none;padding:0;margin:0 0 5px}
.how p{margin:0;color:var(--ink)}
.tags{display:flex;gap:7px;flex-wrap:wrap}
.tag{
  font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);
  border:1px solid var(--line);border-radius:3px;padding:2px 7px;
}
.queue{display:flex;gap:6px;align-items:center}
.qdot{width:7px;height:7px;border-radius:50%;background:var(--line2);border:none;padding:0;cursor:pointer}
.qdot.on{background:var(--warm)}
.flipbtn{
  background:none;border:1px solid var(--line);border-radius:4px;color:var(--dim);
  font-size:10px;letter-spacing:.18em;text-transform:uppercase;padding:4px 9px;cursor:pointer;
  display:inline-flex;align-items:center;gap:7px;margin-right:4px;
}
.flipbtn:hover{border-color:var(--cool);color:var(--cool)}
.flipbtn.on{border-color:var(--cool);color:var(--cool);background:rgba(121,194,178,.08)}
.qdot.bad{background:var(--fail)}

/* ── the deck: two variants, chromatically identical ─────────────────────── */
.deck{display:grid;grid-template-columns:repeat(var(--cols,2),1fr);max-width:1760px;margin:0 auto}
.col{
  padding:24px var(--step) 40px;border-right:1px solid var(--line);min-width:0;
  transition:opacity .45s ease, filter .45s ease;
}
.col:last-child{border-right:none}

.colhead{display:flex;align-items:center;gap:12px;margin-bottom:18px}
.chip{
  width:30px;height:30px;border:1px solid var(--line2);border-radius:4px;
  display:grid;place-items:center;font-size:14px;color:var(--dim);
  transition:all .18s ease;
}
.colhint{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--faint)}
.col.sel{background:linear-gradient(180deg,rgba(231,154,94,.05),transparent 260px)}
.col.sel .chip{border-color:var(--warm);color:var(--warm);box-shadow:0 0 0 3px rgba(231,154,94,.1)}
.col.sel .colhint{color:var(--warm)}
.col.dimmed{opacity:.34;filter:saturate(.45)}
.col.won{background:linear-gradient(180deg,rgba(121,194,178,.06),transparent 300px)}
.col.won .chip{border-color:var(--cool);color:var(--cool);box-shadow:0 0 0 3px rgba(121,194,178,.12)}

/* matched views — the same frame for every variant, so only the decision differs */
.deckhead{position:sticky;top:46px;z-index:20;background:rgba(20,21,26,.93);backdrop-filter:blur(12px);
  border-bottom:1px solid var(--line)}
.deckhead .col{padding:12px var(--step) 12px}
.deckhead .colhead{margin:0}
.viewlabel{margin:26px 0 12px}
.deck.flipping .col{border-right:none}
.deck.flipping{position:relative}
.missing{color:var(--faint);border:1px dashed var(--line);border-radius:5px;padding:14px 16px}
/* Named so it cannot collide with the connection indicator, which is
   .conn.live — a bare .live matched both, and every rule meant for the frame
   was silently being applied to the status dot in the header. */
.liveframe{border:1px solid var(--line);border-radius:5px;overflow:hidden;background:var(--panel);
  /* Width first, height derived. Given only an aspect-ratio and a min-height
     the browser resolves the other way — 300px tall at 16/10 is 480px wide —
     so a third variant, whose column is narrower than that, pushed the frames
     over each other and the page scrolled sideways. Two variants never showed
     it: their columns were wider than 480 on any normal screen. */
  width:100%;max-width:100%;
  aspect-ratio:16/10;min-height:300px;margin-bottom:8px;
  /* a real app is taller than a 16:10 box — let the human drag it open */
  resize:vertical}
.liveframe iframe{width:100%;height:100%;border:0;display:block;background:#fff}

.was{
  margin:-6px 0 18px;padding:9px 12px;border:1px solid var(--line);border-radius:4px;
  background:var(--panel);color:var(--ink);
  animation:wasin .5s cubic-bezier(.2,.8,.2,1) both;
}
.was b{color:var(--cool);font-weight:400;letter-spacing:.18em;font-size:10px;
  text-transform:uppercase;margin-right:9px}
@keyframes wasin{from{opacity:0;transform:translateY(-7px)}to{opacity:1;transform:none}}

/* ── blocks ──────────────────────────────────────────────────────────────── */
.block{margin:0 0 18px}
.block .btitle{
  font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--faint);
  margin-bottom:7px;display:flex;justify-content:space-between;gap:10px;
}
pre.code{
  margin:0;padding:14px 16px;background:var(--panel);border:1px solid var(--line);
  border-radius:5px;overflow-x:auto;font-size:12.5px;line-height:1.6;
  white-space:pre;color:var(--ink);
}
pre.code .s{color:#a5c3b4}
pre.code .k{color:#dc9a6b}
pre.code .c{color:var(--faint);font-style:italic}
pre.code .n{color:#c6b58f}
pre.diff .add{color:var(--cool)}
pre.diff .del{color:var(--del)}
pre.diff .hun{color:var(--faint)}
.prose{
  padding:14px 16px;background:var(--panel);border:1px solid var(--line);border-radius:5px;
  white-space:pre-wrap;color:var(--ink);max-width:70ch;
}
figure.img{margin:0;text-align:center}
/* natural size, capped — a 390px phone mockup must not be blown up to 810px */
figure.img img{
  display:inline-block;max-width:100%;height:auto;max-height:76vh;
  border:1px solid var(--line);border-radius:5px;background:var(--panel);
}
audio{width:100%;filter:invert(.9) hue-rotate(180deg) saturate(.4)}
a.urlblock{
  display:flex;justify-content:space-between;gap:14px;align-items:center;
  padding:14px 16px;background:var(--panel);border:1px solid var(--line);border-radius:5px;
  color:var(--warm);text-decoration:none;
}
a.urlblock:hover{border-color:var(--warm)}
a.urlblock span{color:var(--faint)}
.unknown{
  padding:10px 14px;border:1px dashed var(--fail);border-radius:5px;color:var(--fail);
  margin-bottom:8px;
}

/* ── the rail ────────────────────────────────────────────────────────────── */
.rail{
  position:fixed;left:0;right:0;bottom:0;z-index:35;
  background:rgba(20,21,26,.94);backdrop-filter:blur(14px);
  border-top:1px solid var(--line);
}
.rail-inner{
  max-width:1760px;margin:0 auto;padding:14px var(--step);
  display:flex;gap:18px;align-items:flex-start;
}
.picks{display:flex;gap:8px;flex:0 0 auto}
.pick{
  background:var(--panel);border:1px solid var(--line);border-radius:4px;color:var(--dim);
  padding:9px 13px;cursor:pointer;display:flex;align-items:center;gap:9px;
  transition:all .15s ease;white-space:nowrap;
}
.pick:hover{border-color:var(--line2);color:var(--ink)}
.pick.on{border-color:var(--warm);color:var(--warm);background:rgba(231,154,94,.08)}
.pick b{font-weight:400;font-size:14px}
.why{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:8px}
.field{position:relative;display:flex;align-items:center;gap:10px}
.field input,.field textarea{
  flex:1;background:var(--panel);border:1px solid var(--line);border-radius:4px;
  padding:10px 12px;outline:none;resize:vertical;
}
.field input:focus,.field textarea:focus{border-color:var(--warm)}
.field input::placeholder,.field textarea::placeholder{color:var(--faint)}
.gauge{position:absolute;left:1px;bottom:1px;height:1px;background:var(--cool);width:0;transition:width .12s linear}
.gauge.warm{background:var(--warm)}
.gauge.over{background:var(--fail)}
.count{font-size:10px;color:var(--faint);letter-spacing:.14em;min-width:52px;text-align:right}
.count.over{color:var(--fail)}
.linky{background:none;border:none;color:var(--faint);cursor:pointer;padding:0;
  font-size:11px;letter-spacing:.14em;text-transform:uppercase;text-align:left}
.linky:hover{color:var(--cool)}
.commit{
  flex:0 0 auto;background:var(--panel);border:1px solid var(--cool);color:var(--cool);
  border-radius:4px;padding:10px 18px;cursor:pointer;display:flex;align-items:center;gap:10px;
  transition:all .15s ease;
}
.commit:hover{background:rgba(121,194,178,.1)}
.commit[disabled]{border-color:var(--line);color:var(--faint);cursor:not-allowed;background:var(--panel)}
.commit.anyway{border-color:var(--warm);color:var(--warm)}
.commit.anyway:hover{background:rgba(231,154,94,.1)}
.flash{color:var(--warm);padding:0 var(--step) 12px;max-width:1760px;margin:0 auto}
.hintrow{
  max-width:1760px;margin:0 auto;padding:0 var(--step) 12px;color:var(--faint);font-size:11px;
  display:flex;gap:18px;flex-wrap:wrap;
}

/* ── the reveal ──────────────────────────────────────────────────────────── */
.reveal-rail .rail-inner{align-items:center;justify-content:space-between}
.rulecard{
  border:1px solid var(--cool);border-radius:5px;padding:12px 16px;background:var(--panel2);
  flex:1 1 auto;min-width:0;animation:rise .5s cubic-bezier(.2,.8,.2,1) both;
}
.rulecard .label{margin-bottom:6px}
.rulecard .rtext{color:var(--ink)}
.rulecard .surfaces{color:var(--faint);font-size:11px;margin-top:8px}
.rulecard .field{margin:2px 0 10px}
.rulecard .field input{background:var(--panel);border-color:var(--line2)}
.preview{display:flex;gap:12px;align-items:baseline;padding:9px 12px;border-radius:4px;
  background:rgba(0,0,0,.28);border:1px solid var(--line)}
.preview .pk{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--faint);flex:0 0 auto}
.preview code{color:var(--ink);word-break:break-word}
.warn{color:var(--warm);font-size:11.5px;margin-top:8px;padding-left:14px;position:relative}
.warn::before{content:"!";position:absolute;left:0;color:var(--warm)}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

/* ── canon ───────────────────────────────────────────────────────────────── */
.canon{padding:38px 0 40px}
.bignum{
  font-size:46px;line-height:1;color:var(--warm);letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;
}
.bigsub{color:var(--dim);margin-top:10px}
.shelf{margin-top:34px;border-top:1px solid var(--line)}
.rule{
  display:grid;grid-template-columns:52px 1fr;gap:18px;padding:16px 0;
  border-bottom:1px solid var(--line);
}
.rule:hover{background:rgba(255,255,255,.012)}
.rule .n{color:var(--warm);font-variant-numeric:tabular-nums;text-align:right;padding-top:1px}
.rule .t{color:var(--ink);max-width:84ch}
.rule .m{color:var(--faint);font-size:11px;margin-top:7px;letter-spacing:.06em}
.rule .b{color:var(--dim);margin-top:9px;max-width:84ch;white-space:pre-wrap;font-size:12.5px}
.void{
  border:1px solid var(--line);border-radius:6px;padding:26px 28px;background:var(--panel);
  max-width:80ch;
}
.void p{margin:0 0 12px;color:var(--dim)}
.void code{color:var(--cool)}
.waiting{display:flex;align-items:center;gap:10px;margin-top:30px;color:var(--faint)}
.waiting i{width:6px;height:6px;border-radius:50%;background:var(--cool);animation:breathe 2.4s ease-in-out infinite}
@keyframes breathe{0%,100%{opacity:.25}50%{opacity:1}}
.arrive{animation:arrive .6s cubic-bezier(.2,.8,.2,1) both}
@keyframes arrive{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

/* ── help ────────────────────────────────────────────────────────────────── */
.overlay{
  position:fixed;inset:0;z-index:60;background:rgba(10,11,14,.72);
  display:grid;place-items:center;backdrop-filter:blur(3px);
}
.overlay[hidden]{display:none}
.sheet{
  background:var(--panel);border:1px solid var(--line2);border-radius:7px;
  padding:26px 30px;min-width:380px;max-width:520px;
}
.keys{display:grid;grid-template-columns:auto 1fr;gap:11px 20px;margin-top:4px}
.keys div:nth-child(odd){text-align:right}
.keys span{color:var(--dim)}

@media (max-width:1000px){
  .deck{grid-template-columns:1fr}
  .col{border-right:none;border-bottom:1px solid var(--line)}
  .rail-inner{flex-wrap:wrap}
  .q{font-size:19px}
}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001ms !important;animation-iteration-count:1 !important;
    transition-duration:.001ms !important}
}
</style>
</head>
<body>
<header class="topbar">
  <div class="brand">
    <span class="wordmark"><b>stet</b></span>
    <span class="vr"></span>
    <span class="repo" id="repo"></span>
  </div>
  <div class="meters">
    <div class="meter" id="mp"><span class="k">pending</span><span class="v" id="mPending">0</span></div>
    <div class="meter"><span class="k">canon</span><span class="v" id="mCanon">0</span></div>
    <div class="conn" id="conn"><i></i><span id="connText">connecting</span></div>
    <button class="ghost" id="helpBtn" title="shortcuts">?</button>
  </div>
</header>

<div id="problems"></div>
<main id="app"></main>
<div id="rail"></div>

<div class="overlay" id="help" hidden>
  <div class="sheet">
    <div class="label">shortcuts</div>
    <div class="keys">
      <div><kbd>A</kbd> <kbd>B</kbd></div><span>pick that variant</span>
      <div><kbd>1</kbd> <kbd>2</kbd></div><span>pick by position</span>
      <div><kbd>3</kbd></div><span>a verdict of your own — the number after the last variant</span>
      <div><kbd>S</kbd></div><span>flip variants in place — same frame, one thing changing</span>
      <div><kbd>/</kbd></div><span>write the rule</span>
      <div><kbd>⏎</kbd></div><span>commit — then again to move on</span>
      <div><kbd>[</kbd> <kbd>]</kbd></div><span>previous / next pending</span>
      <div><kbd>?</kbd></div><span>this</span>
      <div><kbd>esc</kbd></div><span>close / unfocus</span>
    </div>
  </div>
</div>

<script>
(function(){
"use strict";
var S={repo:"",pending:[],decided:[],rules:[],counts:{pending:0,decided:0,rules:0}};
var cur=0, sel=null, reveal=null, flip=-1, draft={rule:"",more:"",custom:"",showMore:false,sharpen:null};
/* The server pushes new state before it answers the POST, so the item being
   revealed has already left the pending queue. Pin it, or the reveal renders
   against the next decision. */
var revealEntry=null, inflight=false;
var lastSig="", flashMsg="", conn="init", lastRuleCount=0;

var el=function(id){return document.getElementById(id)};
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}

/* tiny, deterministic highlighter — strings, comments, keywords, numbers */
var HL=/("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')|(\\/\\/[^\\n]*|#[^\\n]*)|\\b(const|let|var|function|return|await|async|for|while|do|if|else|import|from|export|new|of|in|true|false|null|undefined|string|number|boolean|type|interface|class)\\b|\\b(\\d+(?:\\.\\d+)?)\\b/g;
function hl(src){
  var out="",last=0,m; HL.lastIndex=0;
  while((m=HL.exec(src))!==null){
    out+=esc(src.slice(last,m.index));
    var c=m[1]?"s":m[2]?"c":m[3]?"k":"n";
    out+='<span class="'+c+'">'+esc(m[0])+"</span>";
    last=m.index+m[0].length;
  }
  return out+esc(src.slice(last));
}
function diffHtml(text){
  return String(text).split("\\n").map(function(l){
    var c=l[0]==="+"?"add":l[0]==="-"?"del":(l.indexOf("@@")===0?"hun":"");
    return c?'<span class="'+c+'">'+esc(l)+"</span>":esc(l);
  }).join("\\n");
}
/* item.json is written by an agent, so every URL in it is untrusted. A
   javascript: href is currently defused by accident — asset() does not know the
   scheme, so it becomes a relative path — and defence by accident stops working
   the moment someone widens the check. Refuse the scheme on purpose. */
function safeUrl(u,allowData){
  var s=String(u||"").trim();
  if(/^(https?:)?\\/\\//.test(s)||/^\\//.test(s)) return s;
  if(allowData&&/^data:image\\//i.test(s)) return s;
  if(/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;   // any other scheme, including javascript:
  return "";                                          // relative — caller resolves it
}
function asset(id,src,allowData){
  var safe=safeUrl(src,allowData!==false);
  if(safe===null) return null;
  if(safe) return safe;
  return "/a/"+encodeURIComponent(id)+"/"+String(src).split("/").map(encodeURIComponent).join("/");
}

/* The sandbox depends on where the variant is served from, and the difference
   matters both ways.

   A dev server on another port is a different origin, so allow-same-origin
   gives the frame ITS OWN origin — not ours. It still cannot reach this page,
   and without it the frame gets an opaque origin where localStorage throws and
   same-origin fetch fails: a real app renders its markup and is otherwise dead,
   so you would be judging two broken copies of your own page.

   A variant we serve ourselves is same-origin, and there allow-scripts plus
   allow-same-origin would let the frame reach into this document and remove
   its own sandbox. So that combination is never granted to our own URLs. */
function sandboxFor(href){
  var base="allow-scripts allow-forms allow-popups";
  try{
    if(new URL(href,location.href).origin!==location.origin) return base+" allow-same-origin";
  }catch(e){}
  return base;
}

/* Shown, never silently dropped: a refused URL is a fact the human should see. */
function refused(kind,value){
  return '<div class="unknown">refused a '+esc(kind)+' with an unusable scheme — shown as text, not loaded</div>'+
    '<div class="block"><pre class="code">'+esc(String(value))+"</pre></div>";
}

function blockHtml(b,id,revealed){
  var t=b&&b.title?'<div class="btitle"><span>'+esc(b.title)+"</span></div>":"";
  if(!b||typeof b!=="object") return '<div class="unknown">a block that is not an object</div>';
  switch(b.kind){
    case "code":
      return '<div class="block">'+
        (b.title||b.lang?'<div class="btitle"><span>'+esc(b.title||"")+"</span><span>"+esc(b.lang||"")+"</span></div>":"")+
        '<pre class="code">'+hl(String(b.text==null?"":b.text))+"</pre></div>";
    case "diff":
      return '<div class="block"><div class="btitle"><span>'+esc(b.path||b.title||"diff")+"</span><span>diff</span></div>"+
        '<pre class="code diff">'+diffHtml(b.text==null?"":b.text)+"</pre></div>";
    case "text":
      return '<div class="block">'+t+'<div class="prose">'+esc(b.text==null?"":b.text)+"</div></div>";
    case "image":
      // Not lazy: with intrinsic sizing an unloaded image is a 0x0 box, so it
      // never enters the viewport and never loads. These are local files.
      var isrc=asset(id,String(b.src||""));
      if(isrc===null) return refused("image",b.src);
      return '<div class="block">'+t+'<figure class="img"><img alt="'+esc(b.title||"variant image")+
        '" src="'+esc(isrc)+'"></figure></div>';
    case "audio":
      var asrc=asset(id,String(b.src||""),false);
      if(asrc===null) return refused("audio",b.src);
      return '<div class="block">'+t+'<audio controls preload="none" src="'+esc(asrc)+'"></audio></div>';
    case "url":
      // The whole running thing, not a picture of it. Live and clickable.
      // A relative href resolves to a file beside item.json, so a variant can
      // be self-contained; an absolute one points at your dev server.
      var href=asset(id,String(b.href||""),false);
      if(href===null) return refused("url",b.href);
      // The address is withheld until the verdict. A URL is rarely neutral --
      // /hero-serif beside /hero-sans hands the human the answer while they are
      // still supposed to be judging the frame -- and printing it under every
      // panel was doing exactly that. The link still opens; it just does not
      // announce where it goes.
      return '<div class="block">'+t+
        // Not lazy: a live variant that has not loaded yet is a blank white box,
        // and a blank box is something a human will judge.
        '<div class="liveframe"><iframe src="'+esc(href)+'" '+
          'sandbox="'+esc(sandboxFor(href))+'"></iframe></div>'+
        '<a class="urlblock" target="_blank" rel="noreferrer" href="'+esc(href)+'">'+
        esc(b.title||"open full size")+"<span>"+
        (revealed?esc(b.href||"")+" ↗":"opens in a new tab ↗")+"</span></a></div>";
    default:
      return '<div class="unknown">unsupported block kind "'+esc(b.kind)+'" — shown raw</div>'+
        '<div class="block"><pre class="code">'+esc(JSON.stringify(b,null,2))+"</pre></div>";
  }
}

function okPending(){return S.pending.filter(function(p){return p.ok})}
function badPending(){return S.pending.filter(function(p){return !p.ok})}

function renderProblems(){
  var bad=badPending();
  if(!bad.length){el("problems").innerHTML="";return}
  el("problems").innerHTML='<div class="problems"><div class="inner">'+
    '<div class="label fail">unparseable — shown, not skipped</div>'+
    bad.map(function(p){
      return '<div class="prob"><b>'+esc(p.id)+'</b><span>'+esc(p.error)+"</span><code>"+esc(p.dir)+"</code></div>";
    }).join("")+"</div></div>";
}

function renderAsk(entry,i,total){
  var it=entry.item;
  var tags=(it.tags||[]).map(function(t){return '<span class="tag">'+esc(t)+"</span>"}).join("");
  var dots=okPending().map(function(p,k){
    return '<button class="qdot'+(k===i?" on":"")+'" data-go="'+k+'" title="'+esc(p.item.question)+'"></button>';
  }).join("");
  var n=String(i+1).padStart(2,"0"), tt=String(total).padStart(2,"0");
  return '<div class="wrap"><section class="ask">'+
    '<div class="label">decision <span class="dim">'+n+" / "+tt+'</span>'+
      '<span class="queue">'+
        ((it.variants||[]).length>1?'<button class="flipbtn'+(flip>=0?" on":"")+'" data-flip="1">'+
          (flip>=0?"flipping":"flip")+" <kbd>S</kbd></button>":"")+
        dots+"</span></div>"+
    '<h1 class="q">'+esc(it.question)+"</h1>"+
    (it.notes?'<p class="notes">'+esc(it.notes)+"</p>":"")+
    (tags?'<div class="tags">'+tags+"</div>":"")+
    (it.how?'<div class="how"><div class="label plain cool">how to judge</div><p>'+esc(it.how)+"</p></div>":"")+
  "</section></div>";
}

/* Views in first-seen order. "" is the unviewed remainder and always sinks. */
function viewsOf(it){
  var order=[], seen={};
  (it.variants||[]).forEach(function(v){
    (v.blocks||[]).forEach(function(b){
      var k=(b&&b.view)||"";
      if(!(k in seen)){seen[k]=true;if(k)order.push(k)}
    });
  });
  var any=(it.variants||[]).some(function(v){
    return (v.blocks||[]).some(function(b){return !b||!b.view});
  });
  if(any) order.push("");
  return order.length?order:[""];
}

function colClasses(v){
  var on=!reveal&&sel===v.label;
  var won=reveal&&reveal.verdict===v.label;
  var lost=reveal&&reveal.verdict!==v.label;
  return "col"+(on?" sel":"")+(won?" won":"")+(lost?" dimmed":"");
}

function renderDeck(entry){
  var it=entry.item, vs=it.variants||[];
  var views=viewsOf(it);
  var shown=flip>=0&&vs[flip]?[vs[flip]]:vs;
  var named=views.length>1||views[0]!=="";

  var head='<section class="deck deckhead" style="--cols:'+shown.length+'">'+
    shown.map(function(v){
      var won=reveal&&reveal.verdict===v.label;
      return '<div class="'+colClasses(v)+' headcell" data-pick="'+esc(v.label)+'">'+
        '<div class="colhead"><span class="chip">'+esc(v.label)+"</span>"+
          '<span class="colhint">'+(reveal?(won?"your verdict":"not chosen"):(flip>=0?"showing — press S":"press "+esc(v.label)))+"</span></div>"+
        (reveal?'<div class="was"><b>was</b>'+esc(reveal.map[v.label]||"—")+"</div>":"")+
      "</div>";
    }).join("")+"</section>";

  var rows=views.map(function(view){
    var label=named?'<div class="wrap"><div class="label viewlabel">'+esc(view||"detail")+
      '<button class="flipbtn'+(flip>=0?" on":"")+'" data-flip="1">'+
        (flip>=0?"flipping in place":"flip in place")+" <kbd>S</kbd></button></div></div>":"";
    return label+'<section class="deck'+(flip>=0?" flipping":"")+'" style="--cols:'+shown.length+'">'+
      shown.map(function(v){
        var blocks=(v.blocks||[]).filter(function(b){return ((b&&b.view)||"")===view});
        return '<div class="'+colClasses(v)+'" data-pick="'+esc(v.label)+'">'+
          (blocks.length?blocks.map(function(b){return blockHtml(b,entry.id,!!reveal)}).join(""):'<div class="missing">no '+esc(view)+" for "+esc(v.label)+"</div>")+
        "</div>";
      }).join("")+"</section>";
  }).join("");

  return head+rows;
}

function renderRail(entry){
  if(reveal) return renderRevealRail();
  var it=entry.item, vs=it.variants||[];
  var picks=vs.map(function(v,k){
    return '<button class="pick'+(sel===v.label?" on":"")+'" data-pick="'+esc(v.label)+'"><b>'+esc(v.label)+"</b><kbd>"+(k+1)+"</kbd></button>";
  }).join("");
  var other=sel!==null&&!vs.some(function(v){return v.label===sel});
  var len=draft.rule.length;
  var pct=Math.min(len/90,1)*100;
  var gcls=len>110?"gauge over":len>72?"gauge warm":"gauge";
  return '<div class="rail'+'"><div class="rail-inner">'+
    '<div class="picks">'+picks+
      // The key comes after the variants, not a fixed 3. With A/B it is 3 as
      // it always was; with a third variant, 3 picks C and this said 3 too —
      // the label advertising a key that does something else, and no key at
      // all for the thing it is labelling.
      '<button class="pick'+(other?" on":"")+'" data-pick="*">something else'+
        (vs.length<9?"<kbd>"+(vs.length+1)+"</kbd>":"")+"</button></div>"+
    '<div class="why">'+
      (other?'<div class="field"><input id="custom" placeholder="your verdict, in your words — e.g. keep both, ship them as a picker" value="'+esc(draft.custom)+'"></div>':"")+
      '<div class="field"><input id="rule" placeholder="why — your reason, while you still cannot see which is which" value="'+esc(draft.rule)+'">'+
        '<div class="'+gcls+'" style="width:'+pct+'%"></div>'+
        '<span class="count'+(len>110?" over":"")+'">'+(len?len+"/90":"")+"</span></div>"+
      (draft.showMore?'<div class="field"><textarea id="more" rows="2" placeholder="anything more — stored, never injected">'+esc(draft.more)+"</textarea></div>":
        '<button class="linky" id="moreBtn">+ more, if it needs it</button>')+
    "</div>"+
    '<button class="commit" id="commit">commit <kbd>⏎</kbd></button>'+
  "</div>"+
  (flashMsg?'<div class="flash">'+esc(flashMsg)+"</div>":"")+
  '<div class="hintrow"><span>you sharpen this into the rule after the reveal</span>'+
    "<span>no verdict, no rule</span></div></div>";
}

/* A rule that names a variant label is dead on arrival — labels are shuffled
   per decision. Deterministic, offline, no model call. */
function weakness(t){
  t=String(t||"").split("\\n")[0].trim();
  if(!t) return "nothing to inject yet";
  if(t.length<12) return "too short to mean anything to an agent next week";
  if(/\\b(option|variant|version)\\s+[ab12]\\b|\\b[ab]\\s+(is|was|looks|reads)\\b/i.test(t))
    return "names a variant label — those are shuffled per decision and mean nothing later";
  if(/^(looks?|feels?|seems?|sounds?)\\b/i.test(t)&&!/\\b(so|because|use|keep|never|always|prefer)\\b/i.test(t))
    return "reads as a reaction, not an instruction — say what to do next time";
  if(/^(i\\s+(think|guess|feel|like|prefer|would|reckon)|i'?d|maybe|probably|let'?s)\\b/i.test(t))
    return "written to yourself, not to an agent — drop the \\"I\\" and say what to do";
  /* "they both look the same? can you please review" became rule 1 of someone's
     canon on their first use. It is not a weak rule, it is not a rule: it is a
     reply to whoever queued the decision, and this screen is not a reply box.
     Kept byte-identical to weakness() in rules.ts — a test compares them. */
  if(t.indexOf("?")!==-1)
    return "this is a question, not a rule — an agent cannot obey it; answer the decision or discard it";
  if(/^(why|what|which|who|how|can|could|should|would|does|did|is|are|was|were)\\b/i.test(t))
    return "reads as a question, not an instruction — say what an agent should do instead";
  if(/\\b(please|can you|could you|pls)\\b/i.test(t)||/^(review|check|fix|redo|look)\\b/i.test(t))
    return "this asks someone to do something — a rule tells every future agent what to do";
  return null;
}

/* The reveal is not only the payoff. It is the first moment the human knows
   what they chose, and therefore the first moment they can write a rule worth
   obeying. The first version is already saved; this sharpens it. */
function renderRevealRail(){
  var r=reveal;
  var surf=(r.surfaces||[]).filter(function(s){return s.action!=="unchanged"}).map(function(s){return s.path}).join(", ");
  // If the reason will not work as a rule, start the field empty rather than
  // pre-filled. A focused field holding a weak line makes Enter the cheapest
  // action, and the warning becomes something to click past.
  var original=r.rule.text;
  var born=weakness(original);
  var text=draft.sharpen!==null?draft.sharpen:(born?"":original);
  var injected=text.trim()||original;
  var warn=weakness(injected);
  return '<div class="rail reveal-rail"><div class="rail-inner">'+
    '<div class="rulecard">'+
      '<div class="label">rule '+r.rule.n+' — now you know what you chose, sharpen it'+
        '<span class="dim">'+esc(r.revealed||"")+"</span></div>"+
      '<div class="field"><input id="sharpen" value="'+esc(text)+'" placeholder="'+
        (born?"what should the next agent do? — your reason will not work as a rule":"what should the next agent do?")+'"></div>'+
      '<div class="preview"><span class="pk">agents will read</span><code>'+r.rule.n+". "+esc(injected)+"</code></div>"+
      (warn?'<div class="warn">'+esc(warn)+"</div>":"")+
      '<div class="surfaces">'+(surf?"synced → "+esc(surf):"in every agent surface in this repo")+"</div></div>"+
    '<button class="commit'+(warn?" anyway":"")+'" id="next">'+
      (warn?"let it stand anyway":"let it stand")+' <kbd>⏎</kbd></button>'+
  "</div></div>";
}

function renderCanon(){
  var n=S.counts.rules;
  var body;
  if(!n){
    body='<div class="void"><div class="label">nothing yet</div>'+
      "<p>No rules earned. That is the correct state on day one.</p>"+
      "<p>An agent queues a decision with <code>stet ask &lt; item.json</code>, and blocks on "+
      "<code>stet await &lt;id&gt;</code> until you rule on it. Every verdict you give lands here and becomes binding.</p>"+
      "</div>";
  }else{
    body='<div class="bignum">'+n+'</div><div class="bigsub">rule'+(n===1?"":"s")+" earned in this repo — newest first</div>"+
      '<div class="shelf">'+S.rules.map(function(r){
        var m=[];
        if(r.from)m.push("from "+r.from);
        if(r.earned)m.push(r.earned);
        if(r.tags&&r.tags.length)m.push(r.tags.join(" · "));
        return '<div class="rule"><div class="n">'+r.n+'</div><div><div class="t">'+esc(r.text)+"</div>"+
          '<div class="m">'+esc(m.join("  ·  "))+"</div>"+
          (r.body?'<div class="b">'+esc(r.body)+"</div>":"")+"</div></div>";
      }).join("")+"</div>";
  }
  return '<div class="wrap"><section class="canon">'+
    '<div class="label">the canon <span class="dim">'+S.counts.decided+" decided</span></div>"+
    body+
    '<div class="waiting"><i></i>waiting for the next decision</div>'+
  "</section></div>";
}

function render(){
  renderProblems();
  el("repo").textContent=S.repo||"";
  el("mPending").textContent=S.counts.pending;
  el("mCanon").textContent=S.counts.rules;
  el("mp").className="meter"+(S.counts.pending?" hot":"");
  document.title=S.counts.pending?"stet — "+S.counts.pending+" pending":"stet";

  var list=okPending();
  if(cur>=list.length) cur=Math.max(0,list.length-1);
  var entry=(reveal&&revealEntry)?revealEntry:list[cur];

  if(!entry){
    el("app").innerHTML=renderCanon();
    el("rail").innerHTML="";
    return;
  }
  el("app").innerHTML=renderAsk(entry,cur,list.length)+renderDeck(entry);
  el("rail").innerHTML=renderRail(entry);
  wire(entry);
}

function wire(entry){
  Array.prototype.forEach.call(document.querySelectorAll("[data-pick]"),function(node){
    node.addEventListener("click",function(e){
      if(reveal) return;
      // A live variant is meant to be used, not just looked at. Never let a
      // click on the running thing — or on text being selected — become a vote.
      if(e.target&&e.target.closest&&e.target.closest(".live,audio,a,button,input,textarea,pre")) return;
      var s=window.getSelection&&window.getSelection();
      if(s&&String(s).length>2) return;
      var v=node.getAttribute("data-pick");
      pick(v==="*"?"":v,v==="*");
      e.stopPropagation();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-flip]"),function(node){
    node.addEventListener("click",function(e){
      e.stopPropagation();
      doFlip(entry);
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-go]"),function(node){
    node.addEventListener("click",function(){cur=Number(node.getAttribute("data-go"));sel=null;reveal=null;render()});
  });
  var rule=el("rule");
  if(rule){
    rule.addEventListener("input",function(){
      draft.rule=rule.value;
      var len=draft.rule.length, f=rule.parentNode;
      var g=f.querySelector(".gauge"), c=f.querySelector(".count");
      g.style.width=Math.min(len/90,1)*100+"%";
      g.className="gauge"+(len>110?" over":len>72?" warm":"");
      c.textContent=len?len+"/90":"";
      c.className="count"+(len>110?" over":"");
    });
  }
  var custom=el("custom");
  if(custom) custom.addEventListener("input",function(){draft.custom=custom.value});
  var more=el("more");
  if(more) more.addEventListener("input",function(){draft.more=more.value});
  var moreBtn=el("moreBtn");
  if(moreBtn) moreBtn.addEventListener("click",function(){draft.showMore=true;render();var m=el("more");if(m)m.focus()});
  var commit=el("commit");
  if(commit) commit.addEventListener("click",function(){submit(entry)});
  var next=el("next");
  if(next) next.addEventListener("click",advance);
  var sharpen=el("sharpen");
  if(sharpen){
    sharpen.addEventListener("input",function(){
      draft.sharpen=sharpen.value;
      var card=sharpen.closest(".rulecard");
      var shown=draft.sharpen.trim()||reveal.rule.text;
      card.querySelector(".preview code").textContent=reveal.rule.n+". "+shown;
      var w=weakness(shown), node=card.querySelector(".warn");
      var btn=document.getElementById("next");
      if(btn){ btn.className="commit"+(w?" anyway":""); btn.innerHTML=(w?"let it stand anyway":"let it stand")+' <kbd>\u23ce</kbd>'; }
      if(w&&!node){
        node=document.createElement("div");node.className="warn";
        card.insertBefore(node,card.querySelector(".surfaces"));
      }
      if(node){ node.textContent=w||""; node.style.display=w?"":"none" }
    });
    // Rule 1: always take focus when the reveal lands, weak rule or not — the
    // loop stays on the keyboard. The delay is the reveal's animation, so the
    // mapping has landed before the cursor arrives.
    setTimeout(function(){sharpen.focus();sharpen.select()},420);
  }
}

/* split → first variant → next → … → split. The same frame, one thing
   changing: how you actually see a spacing or type difference. */
function doFlip(entry){
  if(reveal) return;
  var n=((entry&&entry.item.variants)||[]).length;
  if(n<2) return;
  flip=flip+1>=n?-1:flip+1;
  var y=window.scrollY; render(); window.scrollTo(0,y);
}

function pick(label,isOther){
  if(isOther){ sel=draft.custom||""; render(); var c=el("custom"); if(c){c.focus()} return }
  sel=label; render();
  var r=el("rule"); if(r&&!draft.rule) r.focus();
}

function flash(msg){
  flashMsg=msg; render();
  setTimeout(function(){ if(flashMsg===msg){flashMsg="";render()} },3200);
}

function submit(entry){
  var vs=(entry.item.variants||[]).map(function(v){return v.label});
  var verdict=sel;
  if(sel!==null&&vs.indexOf(sel)===-1) verdict=(el("custom")?el("custom").value:draft.custom).trim();
  if(!verdict){ flash("pick a variant, or write a verdict of your own"); return }
  if(!draft.rule.trim()){
    flash("say why in one line — that sentence becomes the rule");
    var r=el("rule"); if(r) r.focus();
    return;
  }
  var because=draft.rule.trim()+(draft.more.trim()?"\\n\\n"+draft.more.trim():"");
  inflight=true;
  fetch("/api/decide",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({id:entry.id,verdict:verdict,because:because})
  }).then(function(res){return res.json().then(function(j){return{ok:res.ok,j:j}})})
  .then(function(out){
    inflight=false;
    if(!out.ok){ flash(out.j.error||"could not record that"); return }
    reveal=out.j; revealEntry=entry;
    render();
    var m=el("mCanon");
    m.textContent=out.j.rule.n;
    m.classList.remove("pulse"); void m.offsetWidth; m.classList.add("pulse");
  }).catch(function(){ inflight=false; flash("the server is not answering — is stet still running?") });
}

function advance(){
  var sharpened=draft.sharpen!==null&&reveal&&draft.sharpen.trim()&&draft.sharpen.trim()!==reveal.rule.text;
  var n=reveal?reveal.rule.n:0, text=draft.sharpen;
  reveal=null; revealEntry=null; sel=null; flip=-1;
  draft={rule:"",more:"",custom:"",showMore:false,sharpen:null};
  cur=0; render();
  if(sharpened){
    fetch("/api/revise",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({n:n,text:text})}).catch(function(){});
  }
}

document.addEventListener("keydown",function(e){
  var t=e.target, typing=t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA");
  if(e.key==="Escape"){
    if(!el("help").hidden){el("help").hidden=true;return}
    if(typing){t.blur();return}
  }
  if(e.key==="Enter"&&(reveal||!typing||t.tagName==="INPUT")){
    if(!el("help").hidden) return;
    if(reveal){advance();e.preventDefault();return}
    var list=okPending(); if(list[cur]){submit(list[cur]);e.preventDefault()}
    return;
  }
  if(typing) return;
  if(e.key==="?"){el("help").hidden=!el("help").hidden;return}
  if(reveal) return;
  var list=okPending(), entry=list[cur];
  if(!entry) return;
  var vs=(entry.item.variants||[]).map(function(v){return v.label});
  if(e.key==="/"){var r=el("rule");if(r){r.focus();e.preventDefault()}return}
  if(e.key==="]"){cur=(cur+1)%list.length;sel=null;flip=-1;render();return}
  if(e.key==="["){cur=(cur-1+list.length)%list.length;sel=null;flip=-1;render();return}
  if(e.key==="s"||e.key==="S"){ e.preventDefault(); doFlip(entry); return }
  var up=e.key.toUpperCase();
  if(vs.indexOf(up)!==-1){e.preventDefault();pick(up);return}
  var num=parseInt(e.key,10);
  if(num>=1&&num<=vs.length){e.preventDefault();pick(vs[num-1]);return}
  if(num===vs.length+1&&vs.length<9){e.preventDefault();pick("",true)}
});
el("helpBtn").addEventListener("click",function(){el("help").hidden=!el("help").hidden});
el("help").addEventListener("click",function(){el("help").hidden=true});

function setConn(state,text){
  conn=state;
  var c=el("conn");
  c.className="conn"+(state==="live"?" live":state==="gone"?" gone":"");
  el("connText").textContent=text;
}

function apply(next){
  // The signature must cover rule TEXT, not just the count. Sharpening a rule
  // after the reveal changes neither the count nor the pending list, so a
  // count-only signature left the canon showing the line you just replaced.
  var sig=JSON.stringify([
    next.pending.map(function(p){return p.id+(p.ok?"":"!")}),
    next.counts.rules,
    next.rules.map(function(r){return r.n+":"+r.text})
  ]);
  var wasEmpty=!okPending().length;
  S=next;
  if(sig!==lastSig||!lastSig){
    lastSig=sig;
    if(!reveal&&!inflight) render();
    else { el("mPending").textContent=S.counts.pending; el("mCanon").textContent=S.counts.rules }
    if(wasEmpty&&okPending().length){
      var a=document.querySelector(".ask"); if(a) a.classList.add("arrive");
    }
  }else{
    el("mPending").textContent=S.counts.pending;
    el("mCanon").textContent=S.counts.rules;
  }
}

function connect(){
  var es=new EventSource("/events");
  es.addEventListener("open",function(){setConn("live","live")});
  es.addEventListener("state",function(ev){ setConn("live","live"); apply(JSON.parse(ev.data)) });
  es.addEventListener("error",function(){ setConn("gone","server gone") });
}
fetch("/api/state").then(function(r){return r.json()}).then(apply).catch(function(){});
connect();
})();
</script>
</body>
</html>
`;
