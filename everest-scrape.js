/* ===== Scraper: runs on the Everest planning page (bookmark, console, or the auto-import server) ===== */
function everestScrape(){
  var DAY=/^(\d{1,2})\.?$/;
  var WDS={mo:1,di:2,mi:3,'do':4,fr:5,sa:6,so:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,sun:0,tu:2,we:3,th:4,su:0};
  var MONTH_RE=/(januar|january|februar|february|märz|maerz|march|april|mai|may|juni|june|juli|july|august|september|oktober|october|november|dezember|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|okt|oct|nov|dez|dec)\.?\s*(\d{4})/i;
  var pc=document.createElement('canvas');pc.width=pc.height=1;var pcx=pc.getContext('2d');
  function parseColor(s,depth){
    if(!s){return null;}
    s=String(s).trim();
    if(s==='transparent'||s==='none'||s==='currentcolor'){return [0,0,0,0];}
    var m=s.match(/^rgba?\(([^)]*)\)$/i);
    if(m){
      var p=m[1].replace('/',' ').split(/[\s,]+/).filter(function(x){return x!=='';});
      var a=p.length>3?(p[3].indexOf('%')>=0?parseFloat(p[3])/100:parseFloat(p[3])):1;
      return [parseFloat(p[0]),parseFloat(p[1]),parseFloat(p[2]),a];
    }
    if(depth){return null;}
    try{pcx.fillStyle='#000';pcx.fillStyle=s;var o=pcx.fillStyle;
      if(o.charAt(0)==='#'){return [parseInt(o.substr(1,2),16),parseInt(o.substr(3,2),16),parseInt(o.substr(5,2),16),1];}
      return parseColor(o,1);}catch(e){return null;}
  }
  function klass(c){
    if(!c||c[3]<0.3){return null;}
    var r=c[0]/255,g=c[1]/255,b=c[2]/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,s=mx?d/mx:0,h=0;
    if(d===0||s<0.22||mx<0.25){return 'N';}
    if(mx===r){h=60*(((g-b)/d)%6);}else if(mx===g){h=60*((b-r)/d+2);}else{h=60*((r-g)/d+4);}
    if(h<0){h+=360;}
    if(h<=28||h>=330){return 'R';}
    if(h>=65&&h<=175){return 'G';}
    return 'O';
  }
  function hex(c){if(!c){return '';}return '#'+[0,1,2].map(function(i){var v=Math.round(c[i]).toString(16);return v.length<2?'0'+v:v;}).join('');}
  function splitTop(s){
    var out=[],depth=0,cur='';
    for(var i=0;i<s.length;i++){var ch=s.charAt(i);
      if(ch==='('){depth++;}else if(ch===')'){depth--;}
      if(ch===','&&depth===0){out.push(cur.trim());cur='';}else{cur+=ch;}}
    if(cur.trim()){out.push(cur.trim());}
    return out;
  }
  function gradAt(args,w,h,x,y){
    var parts=splitTop(args),ang=Math.PI,i=0,p0=parts[0]||'';
    if(/^to\s/i.test(p0)){
      var dx=0,dy=0;
      if(/left/.test(p0)){dx=-1;} if(/right/.test(p0)){dx=1;}
      if(/top/.test(p0)){dy=-1;} if(/bottom/.test(p0)){dy=1;}
      ang=(dx&&dy)?Math.atan2(dx*h,-dy*w):Math.atan2(dx,-dy);i=1;
    }else{
      var am=p0.match(/^(-?[\d.]+)(deg|rad|turn|grad)$/);
      if(am){var v=parseFloat(am[1]);ang=am[2]==='deg'?v*Math.PI/180:am[2]==='rad'?v:am[2]==='turn'?v*2*Math.PI:v*Math.PI/200;i=1;}
    }
    var sn=Math.sin(ang),cs=-Math.cos(ang);
    var L=Math.abs(w*sn)+Math.abs(h*Math.cos(ang))||1;
    var t=0.5+((x-w/2)*sn+(y-h/2)*cs)/L;
    var stops=[];
    for(;i<parts.length;i++){
      var pm=parts[i].match(/^((?:rgba?|hsla?|color|lab|lch|oklab|oklch)\([^)]*\)|#[0-9a-f]+|[a-z]+)\s*(.*)$/i);
      if(!pm){continue;}
      var col=parseColor(pm[1]);
      if(!col){continue;}
      var poss=pm[2].trim()?pm[2].trim().split(/\s+/):[];
      if(!poss.length){stops.push({c:col,p:null});}
      poss.forEach(function(ps){var n=parseFloat(ps);var pp=ps.indexOf('%')>=0?n/100:n/L;stops.push({c:col,p:isNaN(pp)?null:pp});});
    }
    if(!stops.length){return null;}
    if(stops[0].p===null){stops[0].p=0;}
    if(stops[stops.length-1].p===null){stops[stops.length-1].p=1;}
    for(var k=1;k<stops.length;k++){
      if(stops[k].p===null){var j=k;while(stops[j].p===null){j++;}
        var a0=stops[k-1].p,a1=stops[j].p;for(var q=k;q<j;q++){stops[q].p=a0+(a1-a0)*(q-k+1)/(j-k+1);}}
      if(stops[k].p<stops[k-1].p){stops[k].p=stops[k-1].p;}
    }
    if(t<=stops[0].p){return stops[0].c;}
    for(var z=0;z<stops.length-1;z++){
      var s0=stops[z],s1=stops[z+1];
      if(t<=s1.p){
        if(s1.p===s0.p){return s1.c;}
        var f=(t-s0.p)/(s1.p-s0.p);
        return [0,1,2,3].map(function(e){return s0.c[e]+(s1.c[e]-s0.c[e])*f;});
      }
    }
    return stops[stops.length-1].c;
  }
  function borderPaint(cs,w,h,lx,ly){
    var bt=parseFloat(cs.borderTopWidth)||0,br=parseFloat(cs.borderRightWidth)||0,bb=parseFloat(cs.borderBottomWidth)||0,bl=parseFloat(cs.borderLeftWidth)||0;
    var inT=ly<bt,inB=ly>h-bb,inL=lx<bl,inR=lx>w-br,side=null,rx=w-lx,by=h-ly;
    if(!(inT||inB||inL||inR)){return null;}
    if(inT&&inL){side=(bl===0||ly*bl<lx*bt)?'Top':'Left';}
    else if(inT&&inR){side=(br===0||ly*br<rx*bt)?'Top':'Right';}
    else if(inB&&inL){side=(bl===0||by*bl<lx*bb)?'Bottom':'Left';}
    else if(inB&&inR){side=(br===0||by*br<rx*bb)?'Bottom':'Right';}
    else{side=inT?'Top':inB?'Bottom':inL?'Left':'Right';}
    if(cs['border'+side+'Style']==='none'||cs['border'+side+'Style']==='hidden'){return null;}
    var c=parseColor(cs['border'+side+'Color']);
    return (c&&c[3]>0.3)?c:null;
  }
  function paintAt(cs,r,x,y,el){
    var lx=x-r.left,ly=y-r.top,w=r.width,h=r.height;
    if(lx<0||ly<0||lx>w||ly>h||w<=0||h<=0){return null;}
    if(cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.opacity)<0.2){return null;}
    if(el&&el.namespaceURI==='http://www.w3.org/2000/svg'&&el.tagName.toLowerCase()!=='svg'){
      var f=parseColor(cs.fill);if(f&&f[3]>0.3){return f;}return null;
    }
    if(el&&el.tagName==='IMG'){
      try{var c2=document.createElement('canvas');c2.width=c2.height=1;var k2=c2.getContext('2d');
        k2.drawImage(el,(lx/w)*el.naturalWidth,(ly/h)*el.naturalHeight,1,1,0,0,1,1);
        var dd=k2.getImageData(0,0,1,1).data;if(dd[3]>80){return [dd[0],dd[1],dd[2],dd[3]/255];}}catch(e){}
      return null;
    }
    var bc=borderPaint(cs,w,h,lx,ly);
    if(bc){return bc;}
    var bi=cs.backgroundImage;
    if(bi&&bi!=='none'){
      var layers=splitTop(bi);
      for(var i=0;i<layers.length;i++){
        var m=layers[i].match(/^(?:repeating-)?linear-gradient\((.*)\)$/i);
        if(m){var gc=gradAt(m[1],w,h,lx,ly);if(gc&&gc[3]>0.3){return gc;}}
      }
    }
    var bg=parseColor(cs.backgroundColor);
    return (bg&&bg[3]>0.3)?bg:null;
  }
  function pseudoPaint(W,el,x,y){
    var hr=null,hcs=null,names=['::after','::before'];
    for(var i=0;i<names.length;i++){
      var cs=W.getComputedStyle(el,names[i]);
      if(!cs||cs.content==='none'||cs.content==='normal'||cs.display==='none'){continue;}
      if(!hr){hr=el.getBoundingClientRect();hcs=W.getComputedStyle(el);}
      var w=parseFloat(cs.width)||0,h=parseFloat(cs.height)||0;
      if(cs.boxSizing!=='border-box'){
        w+=(parseFloat(cs.paddingLeft)||0)+(parseFloat(cs.paddingRight)||0)+(parseFloat(cs.borderLeftWidth)||0)+(parseFloat(cs.borderRightWidth)||0);
        h+=(parseFloat(cs.paddingTop)||0)+(parseFloat(cs.paddingBottom)||0)+(parseFloat(cs.borderTopWidth)||0)+(parseFloat(cs.borderBottomWidth)||0);
      }
      var r;
      if(cs.position==='absolute'||cs.position==='fixed'){
        var ox=hr.left+(parseFloat(hcs.borderLeftWidth)||0),oy=hr.top+(parseFloat(hcs.borderTopWidth)||0);
        var pw=hr.width-(parseFloat(hcs.borderLeftWidth)||0)-(parseFloat(hcs.borderRightWidth)||0);
        var ph=hr.height-(parseFloat(hcs.borderTopWidth)||0)-(parseFloat(hcs.borderBottomWidth)||0);
        var L=parseFloat(cs.left),T=parseFloat(cs.top);
        if(isNaN(L)){L=pw-(parseFloat(cs.right)||0)-w;}
        if(isNaN(T)){T=ph-(parseFloat(cs.bottom)||0)-h;}
        r={left:ox+L,top:oy+T,width:w,height:h};
      }else{r={left:hr.left,top:hr.top,width:w||hr.width,height:h||hr.height};}
      var c=paintAt(cs,r,x,y,null);
      if(c){return c;}
    }
    return null;
  }
  function colorAt(W,cell,hit,x,y){
    var el=hit,stop=cell.parentElement,guard=0;
    if(!el||el.contains(cell)){el=cell;}
    while(el&&guard++<14){
      var c=pseudoPaint(W,el,x,y);
      if(c){return c;}
      c=paintAt(W.getComputedStyle(el),el.getBoundingClientRect(),x,y,el);
      if(c){return c;}
      if(el===cell||el===stop||el.contains(cell)){break;}
      el=el.parentElement;
    }
    return null;
  }
  function textOf(el){return (el.textContent||'').replace(/\s+/g,' ').trim();}
  function findCells(D){
    var all=D.body?D.body.getElementsByTagName('*'):[],seen=new Set(),cells=[];
    for(var i=0;i<all.length;i++){
      var el=all[i];
      if(el.children.length>3){continue;}
      var tx=textOf(el);
      if(tx.length>3||!DAY.test(tx)){continue;}
      var cur=el;
      while(cur.parentElement&&textOf(cur.parentElement)===tx){
        var pr=cur.parentElement.getBoundingClientRect();
        if(pr.width>120||pr.height>120){break;}
        cur=cur.parentElement;
      }
      if(seen.has(cur)){continue;}
      var r=cur.getBoundingClientRect();
      if(r.width<10||r.height<10||r.width>120||r.height>120){continue;}
      seen.add(cur);
      cells.push({el:cur,d:parseInt(tx,10),r:r});
    }
    return cells;
  }
  function leaves(D){
    var all=D.body.getElementsByTagName('*'),out=[];
    for(var i=0;i<all.length;i++){
      var el=all[i],tag=el.tagName;
      if(tag==='SCRIPT'||tag==='STYLE'||tag==='OPTION'){continue;}
      var hasTextChild=false;
      for(var n=el.firstChild;n;n=n.nextSibling){if(n.nodeType===3&&n.nodeValue.trim()){hasTextChild=true;break;}}
      if(!hasTextChild){continue;}
      var tx=textOf(el);
      if(!tx||tx.length>160){continue;}
      var r=el.getBoundingClientRect();
      if(r.width<=0||r.height<=0){continue;}
      out.push({el:el,t:tx,r:r});
    }
    return out;
  }
  var docs=[{D:document,W:window}];
  try{for(var fi=0;fi<window.frames.length;fi++){try{var fw=window.frames[fi];if(fw.document&&fw.document.body){docs.push({D:fw.document,W:fw});}}catch(e){}}}catch(e){}
  var best=null;
  docs.forEach(function(o){var c=findCells(o.D);if(!best||c.length>best.cells.length){best={D:o.D,W:o.W,cells:c};}});
  var D=best.D,W=best.W,cells=best.cells;
  var sorted=cells.slice().sort(function(a,b){return (a.r.top+a.r.height/2)-(b.r.top+b.r.height/2);});
  var clusters=[];
  sorted.forEach(function(c){
    var cy=c.r.top+c.r.height/2,last=clusters[clusters.length-1];
    if(last&&Math.abs(cy-last.cy)<c.r.height/2){last.items.push(c);}
    else{clusters.push({cy:cy,items:[c]});}
  });
  clusters=clusters.filter(function(cl){return cl.items.length>=5;});
  clusters.forEach(function(cl){cl.items.sort(function(a,b){return a.r.left-b.r.left;});});
  var lv=leaves(D);
  var rows=clusters.map(function(cl,ri){
    var first=cl.items[0],top=Math.min.apply(null,cl.items.map(function(c){return c.r.top;})),bot=Math.max.apply(null,cl.items.map(function(c){return c.r.bottom;}));
    var name='',tr=first.el.closest?first.el.closest('tr'):null;
    if(tr&&tr.cells&&tr.cells.length&&!DAY.test(textOf(tr.cells[0]))){name=textOf(tr.cells[0]);}
    if(!name){
      var bestL=null;
      lv.forEach(function(l){
        var cy=l.r.top+l.r.height/2;
        if(cy<top||cy>bot||l.r.right>first.r.left+2||DAY.test(l.t)){return;}
        if(!bestL||l.t.length>bestL.t.length){bestL=l;}
      });
      if(bestL){name=(bestL.el.getAttribute('title')||'').length>bestL.t.length?bestL.el.getAttribute('title'):bestL.t;}
    }
    return {room:name||('Row '+(ri+1)),top:top,items:cl.items};
  });
  var head=[],ml=[];
  if(rows.length){
    var topRow=rows[0];
    var wdl=lv.filter(function(l){return WDS.hasOwnProperty(l.t.toLowerCase().replace('.',''))&&l.r.bottom<=topRow.top+3;});
    var mol=lv.filter(function(l){return MONTH_RE.test(l.t)&&l.r.bottom<=topRow.top+3;});
    topRow.items.forEach(function(c){
      var cx=c.r.left+c.r.width/2,w=null,bd=c.r.width/2,mt='';
      wdl.forEach(function(l){var dd=Math.abs(l.r.left+l.r.width/2-cx);if(dd<bd){bd=dd;w=WDS[l.t.toLowerCase().replace('.','')];}});
      mol.forEach(function(l){if(l.r.left-2<=cx&&cx<=l.r.right+2&&!mt){mt=l.t;}});
      head.push({d:c.d,w:w});ml.push(mt);
    });
  }
  var months=[];
  try{var bt=(D.body.innerText||'').slice(0,40000),re=new RegExp(MONTH_RE.source,'gi'),mm;while((mm=re.exec(bt))&&months.length<30){if(months.indexOf(mm[0])<0){months.push(mm[0]);}}}catch(e){}
  try{D.querySelectorAll('select').forEach(function(s){var o=s.options[s.selectedIndex];if(o&&MONTH_RE.test(o.text)){months.unshift(o.text.trim());}});}catch(e){}
  var saved=[],sc=cells.length?cells[0].el.parentElement:null;
  while(sc){if(sc.scrollLeft||sc.scrollTop){saved.push([sc,sc.scrollLeft,sc.scrollTop]);}sc=sc.parentElement;}
  var wx=W.scrollX,wy=W.scrollY;
  function visible(r){return r.left>=0&&r.top>=0&&r.right<=W.innerWidth&&r.bottom<=W.innerHeight;}
  function okHit(hit,cell){
    if(!hit){return false;}
    if(hit===cell||cell.contains(hit)){return true;}
    if(hit.contains(cell)){return true;}
    var a=hit.getBoundingClientRect(),b=cell.getBoundingClientRect();
    var ix=Math.min(a.right,b.right)-Math.max(a.left,b.left),iy=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
    return ix>0&&iy>0&&a.width*a.height<=b.width*b.height*4;
  }
  var PTS={tl:[0.17,0.17],br:[0.83,0.83],m1:[0.5,0.5],m2:[0.38,0.62],m3:[0.62,0.38]};
  var bad=0;
  function sample(cell){
    var r=cell.getBoundingClientRect();
    if(!visible(r)){cell.scrollIntoView({block:'center',inline:'center'});r=cell.getBoundingClientRect();}
    var res={},retried=false;
    for(var key in PTS){
      var x=r.left+PTS[key][0]*r.width,y=r.top+PTS[key][1]*r.height;
      var hit=D.elementFromPoint(x,y);
      if(!okHit(hit,cell)&&!retried){retried=true;cell.scrollIntoView({block:'center',inline:'center'});r=cell.getBoundingClientRect();x=r.left+PTS[key][0]*r.width;y=r.top+PTS[key][1]*r.height;hit=D.elementFromPoint(x,y);}
      if(!okHit(hit,cell)){hit=null;bad++;}
      res[key]=colorAt(W,cell,hit,x,y);
    }
    return res;
  }
  var outRows=rows.map(function(row){
    return {room:row.room,cells:row.items.map(function(c){
      var s=sample(c.el);
      var o={d:c.d,tl:klass(s.tl)||'?',br:klass(s.br)||'?',m:[s.m1,s.m2,s.m3].map(function(v){return klass(v)||'?';}).join(''),c:hex(s.tl)+hex(s.br)};
      var k=(typeof c.el.className==='string'?c.el.className:'')||'';
      var t=c.el.getAttribute('title')||c.el.getAttribute('data-title')||c.el.getAttribute('data-original-title')||'';
      if(k){o.k=k.slice(0,80);}
      if(t){o.t=t.slice(0,160);}
      return o;
    })};
  });
  saved.forEach(function(s){s[0].scrollLeft=s[1];s[0].scrollTop=s[2];});
  W.scrollTo(wx,wy);
  var data={type:'everest-scrape',v:1,url:location.href.split('?')[0],at:new Date().toISOString(),head:head,ml:ml,months:months,rows:outRows};
  if(window.__everestAuto){return {data:data,cells:cells.length,rows:rows.length};}
  var json=JSON.stringify(data);
  var nIn=0,nOut=0,nUnk=0,nCells=0;
  outRows.forEach(function(r){r.cells.forEach(function(c){nCells++;
    var kk=' '+(c.k||'')+' ';
    if(/planning1-item-day/.test(kk)){
      if(/\sisArrivalDeparture\s/.test(kk)){nIn++;nOut++;}else if(/\sisArrival\s/.test(kk)){nIn++;}else if(/\sisDeparture\s/.test(kk)){nOut++;}
      return;}
    if(c.tl==='G'&&c.br==='R'){nIn++;}else if(c.tl==='R'&&c.br==='G'){nOut++;}
    else if(c.tl==='R'&&c.br==='R'&&c.m.indexOf('G')>=0){nIn++;nOut++;}
    else if(!((c.tl==='R'||c.tl==='G')&&(c.br==='R'||c.br==='G'))){nUnk++;}});});
  function debugInfo(){
    var ex=rows.length?rows[0].items.slice(0,4).map(function(c){
      var el=c.el,list=[el].concat(Array.prototype.slice.call(el.querySelectorAll('*'),0,6));
      return {html:el.outerHTML.slice(0,1500),styles:list.map(function(e){var cs=W.getComputedStyle(e),b=W.getComputedStyle(e,'::before'),a=W.getComputedStyle(e,'::after');
        return {tag:e.tagName,cls:String(e.className||''),bg:cs.backgroundColor,bi:cs.backgroundImage.slice(0,300),bd:[cs.borderTopColor,cs.borderRightColor,cs.borderBottomColor,cs.borderLeftColor,cs.borderTopWidth,cs.borderLeftWidth].join(' '),
          before:b.content==='none'?'':[b.content,b.position,b.width,b.height,b.backgroundColor,b.backgroundImage.slice(0,200),b.borderTopColor,b.borderLeftColor,b.borderTopWidth,b.borderLeftWidth].join(' | '),
          after:a.content==='none'?'':[a.content,a.position,a.width,a.height,a.backgroundColor,a.backgroundImage.slice(0,200),a.borderBottomColor,a.borderRightColor,a.borderBottomWidth,a.borderRightWidth].join(' | ')};})};}):[];
    var g=rows.length?rows[0].items[0].el:null,p=g;for(var i=0;i<4&&p&&p.parentElement;i++){p=p.parentElement;}
    return JSON.stringify({type:'everest-debug',url:location.href.split('?')[0],cellsFound:cells.length,rows:rows.length,bad:bad,examples:ex,gridHtml:p?p.outerHTML.slice(0,12000):''},null,1);
  }
  var old=document.getElementById('__everest_box');if(old){old.remove();}
  var box=document.createElement('div');box.id='__everest_box';
  box.setAttribute('style','position:fixed;top:16px;right:16px;z-index:2147483647;width:380px;max-width:calc(100vw - 32px);background:#15202a;color:#e9eef3;font:14px/1.45 system-ui,sans-serif;border-radius:10px;padding:16px;box-shadow:0 10px 40px rgba(0,0,0,.4)');
  var ok=outRows.length>0;
  box.innerHTML='<div style="font-weight:700;font-size:16px;margin-bottom:6px">Everest scrape</div>'+
    (ok?'<div>Read <b>'+outRows.length+'</b> rooms × <b>'+(outRows[0].cells.length)+'</b> days ('+outRows[0].cells[0].d+'. → '+outRows[0].cells[outRows[0].cells.length-1].d+'.).<br>Check-ins: <b>'+nIn+'</b> · Check-outs: <b>'+nOut+'</b>'+(nUnk?' · <span style="color:#ffb27a">Unreadable cells: '+nUnk+'</span>':'')+'</div>':'<div style="color:#ffb27a">No booking grid found. Open the planning page with the red/green grid visible and try again.</div>')+
    '<div id="__ev_st" style="margin:10px 0;color:#9fe3bf"></div>'+
    '<textarea readonly style="width:100%;height:70px;font:11px monospace;background:#0d151c;color:#cfd8e0;border:1px solid #33414e;border-radius:6px"></textarea>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">'+
    '<button data-a="copy" style="background:#78a9ff;color:#0b1420;border:0;border-radius:6px;padding:8px 12px;font-weight:700;cursor:pointer">Copy data</button>'+
    '<button data-a="debug" style="background:#2a3742;color:#e9eef3;border:0;border-radius:6px;padding:8px 12px;cursor:pointer">Copy debug info</button>'+
    '<button data-a="close" style="background:transparent;color:#9aa8b5;border:1px solid #33414e;border-radius:6px;padding:8px 12px;cursor:pointer">Close</button></div>';
  document.body.appendChild(box);
  var ta=box.querySelector('textarea'),st=box.querySelector('#__ev_st');ta.value=json;
  function copy(text,label){
    function fallback(){ta.value=text;ta.focus();ta.select();var done=false;try{done=document.execCommand('copy');}catch(e){}
      st.style.color=done?'#9fe3bf':'#ffb27a';st.textContent=done?label+' copied. Paste it into the Check-in Board.':'Copy blocked. Select the text in the box and press Ctrl+C.';}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){st.style.color='#9fe3bf';st.textContent=label+' copied. Paste it into the Check-in Board.';},fallback);}else{fallback();}
  }
  box.addEventListener('click',function(e){var a=e.target.getAttribute&&e.target.getAttribute('data-a');
    if(a==='copy'){copy(json,'Data');}else if(a==='debug'){copy(debugInfo(),'Debug info');}else if(a==='close'){box.remove();}});
  if(ok){copy(json,'Data');}
}
