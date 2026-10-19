import { createWebGLCRT } from '../dist/crt-effect.js';

// These are example overrides, not additional library presets.
const examples = {
  balanced: { options: { preset:'balanced' }, draw:earthrise },
  soft: { options: { curvature:.015,grain:.01,scanlines:.045,mask:.01,vignette:.20,glow:.035 }, draw:broadcast },
  arcade: { options: { curvature:.065,grain:.035,scanlines:.24,scanlineSpacing:3,mask:.10,vignette:.50,glow:.16 }, draw:arcade },
  terminal: { options: { curvature:.045,grain:.045,scanlines:.16,scanlineSpacing:3,mask:0,vignette:.48,glow:.20 }, draw:terminal },
};
const screen = document.querySelector('#screen'), canvas = document.querySelector('#source');
canvas.width = 960; canvas.height = 600;
const ctx = canvas.getContext('2d');
const select = document.querySelector('#example'), enabled = document.querySelector('#enabled');
const image = new Image(); image.src = './assets/earthrise.jpg';
await image.decode();
let effect;
function text(value,x,y,size=18,color='#e7f0ec') {
  ctx.fillStyle=color; ctx.font=`${size}px ui-monospace,monospace`; ctx.fillText(value,x,y);
}
function border(color) { ctx.strokeStyle=color; ctx.lineWidth=2; ctx.strokeRect(34,34,892,532); }
function earthrise() {
  ctx.drawImage(image,0,850,3000,1875,0,0,960,600);
  border('#c3d2dd');
  text('APOLLO 08 / LUNAR ORBIT',62,83,16,'#a8b9cb');
  text('EARTHRISE',59,144,58);
  text('DEC 24 1968',64,179,16,'#a8b9cb');
  ctx.strokeStyle='#9baebc'; ctx.lineWidth=1;
  for(const [x,y] of [[810,118],[156,360]]) {
    ctx.beginPath();ctx.moveTo(x-12,y);ctx.lineTo(x+12,y);ctx.moveTo(x,y-12);ctx.lineTo(x,y+12);ctx.stroke();
  }
  text('AS08–14–2383',62,538,17,'#fff');
  text('NASA / BILL ANDERS',674,538,15,'#fff');
}
function broadcast() {
  const colors=['#ededed','#e9dc45','#43d4da','#43c76b','#cf55c5','#e24d4b','#3c53cf'];
  colors.forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i*960/7,0,960/7+1,390);});
  const grays=['#101010','#303030','#505050','#707070','#909090','#b0b0b0','#d0d0d0','#f0f0f0'];
  grays.forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i*120,390,120,78);});
  ctx.fillStyle='#11121b';ctx.fillRect(0,468,960,132);
  text('SIGNAL / 01',60,531,34);text('COLOR · LUMA · CHROMA',60,558,15,'#97a8b8');
  ctx.strokeStyle='#e8edf1';ctx.lineWidth=1;
  for(let x=600;x<900;x+=5){ctx.beginPath();ctx.moveTo(x,500);ctx.lineTo(x,557);ctx.stroke();}
  border('#ffffff');
}
function arcade() {
  const sky=ctx.createLinearGradient(0,0,0,600);sky.addColorStop(0,'#09091c');sky.addColorStop(.66,'#25133d');sky.addColorStop(1,'#080a24');ctx.fillStyle=sky;ctx.fillRect(0,0,960,600);
  for(let i=0;i<85;i++){ctx.fillStyle=i%3?'#667aa8':'#c6dcff';ctx.fillRect(42+(i*173%880),54+(i*89%270),i%4?1:2,2);}
  ctx.fillStyle='#ff844d';ctx.beginPath();ctx.arc(680,260,94,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#201030';for(let y=266;y<356;y+=15)ctx.fillRect(580,y,210,6);
  ctx.fillStyle='#080b24';ctx.beginPath();ctx.moveTo(0,420);ctx.lineTo(110,290);ctx.lineTo(185,385);ctx.lineTo(326,267);ctx.lineTo(490,415);ctx.lineTo(620,352);ctx.lineTo(730,406);ctx.lineTo(846,305);ctx.lineTo(960,425);ctx.lineTo(960,600);ctx.lineTo(0,600);ctx.fill();
  ctx.strokeStyle='#f25cd5';ctx.lineWidth=1.5;ctx.beginPath();
  for(let x=-600;x<1600;x+=155){ctx.moveTo(480,385);ctx.lineTo(x,600);}
  for(const y of [398,416,441,476,527,599]){ctx.moveTo(0,y);ctx.lineTo(960,y);}ctx.stroke();
  ctx.fillStyle='#68eff8';ctx.beginPath();ctx.moveTo(480,400);ctx.lineTo(452,459);ctx.lineTo(480,446);ctx.lineTo(508,459);ctx.closePath();ctx.fill();
  text('ORBITAL',60,131,52,'#fbe8ff');text('RUNNER',60,185,52,'#fbe8ff');
  text('SCORE 024800',61,237,18,'#ffb0df');text('INSERT COIN',386,550,23,'#72efff');border('#7167a5');
}
function terminal() {
  ctx.fillStyle='#06150f';ctx.fillRect(0,0,960,600);
  ctx.strokeStyle='#183c29';ctx.lineWidth=1;ctx.beginPath();
  for(let x=40;x<960;x+=40){ctx.moveTo(x,40);ctx.lineTo(x,560);}
  for(let y=40;y<600;y+=40){ctx.moveTo(40,y);ctx.lineTo(920,y);}ctx.stroke();
  text('VECTOR SCOPE',63,100,38,'#b5f4ba');text('CHANNEL 02   /   120 Hz',65,133,16,'#6cb88e');
  for(const [phase,color] of [[0,'#9ff2a5'],[1.3,'#3c8f77']]) {
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();
    for(let x=50;x<911;x++){const y=330+Math.sin(x*.018+phase)*63+Math.sin(x*.047+phase)*23;x===50?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.stroke();
  }
  text('TIMEBASE  5 ms/div',63,518,18,'#a0d9ac');text('TRIGGER  AUTO',63,546,16,'#6cb88e');text('CH1  2.00 V',733,535,17,'#a0d9ac');border('#76ba8b');
}
function render() {
  effect?.destroy();
  const example=examples[select.value];ctx.clearRect(0,0,960,600);example.draw();
  effect=createWebGLCRT(screen,{sources:[canvas],aperture:true,...example.options,enabled:enabled.checked});
  screen.setAttribute('aria-label',select.selectedOptions[0].textContent);
  document.querySelector('#settings').textContent=JSON.stringify(example.options);
  const url=new URL(location.href);url.searchParams.set('example',select.value);history.replaceState(null,'',url);
  screen.dataset.ready=select.value;
}
const requested=new URL(location.href).searchParams.get('example');
if(examples[requested]) select.value=requested;
select.addEventListener('change',render);enabled.addEventListener('change',()=>effect.setEnabled(enabled.checked));
render();
