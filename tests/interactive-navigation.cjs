// Portable in-process navigation smoke test. This uses a small fake DOM and
// must not be reported as real-browser or visual acceptance evidence.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const skillRoot = path.resolve(__dirname, '..');
const htmlPath = process.argv[2] && path.resolve(process.argv[2]);
if (!htmlPath || !fs.existsSync(htmlPath)) throw new Error('Usage: node tests/interactive-navigation.cjs <packaged-demo.html>');
const page = fs.readFileSync(htmlPath, 'utf8');
const payloadMatch = page.match(/<script type="application\/json" id="explorer-data">([\s\S]*?)<\/script>/);
assert.ok(payloadMatch, 'packaged demo contains the data payload');
const payload = JSON.parse(payloadMatch[1]);

let activeDocument = null;
class Element {
  constructor(tag) {
    this.tagName = tag.toLowerCase(); this.children = []; this.parentElement = null; this.dataset = {}; this.attrs = {}; this.listeners = {};
    this.style = {}; this._text = ''; this.className = ''; this.hidden = false; this.scrollTop = 0; this.classList = {
      add: (...names) => { for (const name of names) if (!this.className.split(/\s+/).includes(name)) this.className = [this.className,name].filter(Boolean).join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => name && !names.includes(name)).join(' '); },
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name,force) => { const has=this.classList.contains(name),add=force===undefined?!has:Boolean(force);if(add&&!has)this.className=[this.className,name].filter(Boolean).join(' ');if(!add&&has)this.classList.remove(name);return add; }
    };
  }
  get id() { return this._id || ''; } set id(value) { this._id=String(value); }
  get childNodes() { return this.children; }
  get textContent() { return this._text+this.children.map(child=>child.textContent).join(''); }
  set textContent(value) { for(const child of this.children)child.parentElement=null;this.children=[];this._text=String(value??''); }
  get href() { return this.attrs.href||''; } set href(value) { this.attrs.href=String(value); }
  get src() { return this.attrs.src||''; } set src(value) { this.attrs.src=String(value); }
  get value() { return this._value||''; } set value(value) { this._value=String(value??''); }
  get parentNode() { return this.parentElement; }
  append(...children) { for(const child of children){child.parentElement=this;this.children.push(child);} }
  prepend(...children) { for(const child of [...children].reverse()){child.parentElement=this;this.children.unshift(child);} }
  replaceChildren(...children) { for(const child of this.children)child.parentElement=null;this.children=[];this._text='';this.append(...children); }
  replaceChild(next,old) { const i=this.children.indexOf(old);if(i>=0)this.children[i]=next;else this.children.push(next);next.parentElement=this;old.parentElement=null;return old; }
  setAttribute(name,value) { this.attrs[name]=String(value); }
  getAttribute(name) { return this.attrs[name]??null; }
  removeAttribute(name) { delete this.attrs[name]; }
  addEventListener(type,fn) { (this.listeners[type]??=[]).push(fn); }
  dispatchEvent(e) { e.target??=this;for(let node=this;node;node=node.parentElement){e.currentTarget=node;for(const fn of node.listeners?.[e.type]||[])fn(e);if(e.stopped)break;}return true; }
  click() { this.dispatchEvent({type:'click',target:this,currentTarget:this,button:0,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;}}); }
  matches(selector) {
    return selector.split(',').some(part=>{
      part=part.trim();const id=part.match(/^\[data-node-id="([^"]+)"\]$/);if(id)return this.dataset.nodeId===id[1];
      if(part==='[data-node-id][aria-pressed="true"]')return Boolean(this.dataset.nodeId)&&this.getAttribute('aria-pressed')==='true';
      if(part==='[data-node-id]')return Boolean(this.dataset.nodeId);if(part==='[data-chapter]')return Boolean(this.dataset.chapter);
      if(part==='[data-source-start][data-source-end]')return this.dataset.sourceStart!==undefined&&this.dataset.sourceEnd!==undefined;
      if(part==='[data-line]')return this.dataset.line!==undefined;if(part.startsWith('#'))return this.id===part.slice(1);if(part.startsWith('.'))return this.classList.contains(part.slice(1));
      if(part.startsWith('['))return false;return this.tagName===part.toLowerCase();
    });
  }
  querySelectorAll(selector) { return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0]||null; }
  closest(selector) { for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null; }
  remove() { if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null; }
  focus() { if(activeDocument)activeDocument.activeElement=this; }
  select() {}
  scrollIntoView() { this.scrolled=true; }
}
class FakeTextNode {
  constructor(parent,value) { this.parentElement=parent;this.parentNode=parent;this.nodeValue=value; }
  splitText(offset) { const rest=new FakeTextNode(this.parentElement,this.nodeValue.slice(offset));this.nodeValue=this.nodeValue.slice(0,offset);return rest; }
}
const body = new Element('body'), ids = new Map();
const template = fs.readFileSync(path.join(skillRoot,'assets','interactive.html'),'utf8').split('<script type="application/json"')[0];
for(const match of template.matchAll(/<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"/gi)){const node=new Element(match[1]);node.id=match[2];ids.set(node.id,node);body.append(node);}
const dataElement=new Element('script');dataElement.id='explorer-data';dataElement.textContent=JSON.stringify(payload);ids.set(dataElement.id,dataElement);body.append(dataElement);
const findId=(node,id)=>node.id===id?node:node.children.map(child=>findId(child,id)).find(Boolean)||null;
const doc={body,createElement:tag=>new Element(tag),getElementById:id=>ids.get(id)||findId(body,id),querySelectorAll:s=>body.querySelectorAll(s),listeners:{},matches:()=>false,addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},createTreeWalker(root){const nodes=[];const visit=n=>{if(n._text)nodes.push(new FakeTextNode(n,n._text));for(const child of n.children)visit(child);};visit(root);let i=0;return{nextNode:()=>nodes[i++]||null};}};
body.parentElement=doc;
activeDocument=doc;
const windowListeners={};const window={matchMedia:()=>({matches:true}),addEventListener(type,fn){(windowListeners[type]??=[]).push(fn);},dispatchEvent(e){for(const fn of windowListeners[e.type]||[])fn(e);}};
const location={hash:''},historyRows=[];let historyIndex=-1;
const history={get state(){return historyRows[historyIndex]?.state||null;},replaceState(state,_title,url){if(historyIndex<0){historyRows.push({state,url});historyIndex=0;}else historyRows[historyIndex]={state,url};if(url&&String(url).includes('#'))location.hash=String(url).slice(String(url).indexOf('#'));},pushState(state,_title,url){historyRows.splice(historyIndex+1);historyRows.push({state,url});historyIndex++;if(url&&String(url).includes('#'))location.hash=String(url).slice(String(url).indexOf('#'));},back(){if(historyIndex>0){historyIndex--;window.dispatchEvent({type:'popstate',state:this.state});}},forward(){if(historyIndex+1<historyRows.length){historyIndex++;window.dispatchEvent({type:'popstate',state:this.state});}}};
const blobs=new Map();let blobSerial=0;class TestURL extends URL{static createObjectURL(blob){const u=`blob:portable-${++blobSerial}`;blobs.set(u,blob);return u;}static revokeObjectURL(){}}
class Observer{constructor(fn){this.callback=fn;}observe(){}disconnect(){}}
const context=vm.createContext({document:doc,window,history,location,navigator:{clipboard:{writeText:async()=>{}}},URL:TestURL,URLSearchParams,TextDecoder,Uint8Array,Blob,atob,Map,Set,console,MutationObserver:Observer,NodeFilter:{SHOW_TEXT:4},setTimeout:fn=>{fn();return 1;},clearTimeout:()=>{},requestAnimationFrame:fn=>fn(),matchMedia:window.matchMedia,TextEncoder});
const assetScript=['vendor/marked.umd.js','markdown.js','conversations.js','interactive.js'].map(name=>fs.readFileSync(path.join(skillRoot,'assets',name),'utf8')).join('\n;\n');
vm.runInContext(assetScript,context,{timeout:10000});
const run=source=>vm.runInContext(source,context),$=id=>doc.getElementById(id);
const chapter=payload.chapters[0],record=chapter.record;
assert.equal(run('app.panelOpen'),false,'a fresh page opens on the diagram');
assert.equal($('reader-panel').hidden,true);
const fileNode=record.nodes.find(node=>(node.artifacts||[]).some(artifact=>artifact.file_id));
assert.ok(fileNode,'fictional demo exposes a node with a packaged file');
const frame=run(`frameByChapter.get(${JSON.stringify(chapter.id)})`);
assert.ok(frame,'the visible initial graph has a viewer iframe');
const svg=new Element('svg');for(const node of record.nodes){const g=new Element('g');g.dataset.nodeId=node.id;g.setAttribute('aria-pressed','false');svg.append(g);}
const frameListeners={};frame.contentDocument={documentElement:svg,querySelector:s=>svg.querySelector(s),querySelectorAll:s=>svg.querySelectorAll(s),addEventListener(type,fn){(frameListeners[type]??=[]).push(fn);}};
frame.contentWindow={Archify:{focus:{set(id,opts){assert.equal(opts.toggle,false);for(const shape of svg.querySelectorAll('[data-node-id]'))shape.setAttribute('aria-pressed',String(shape.dataset.nodeId===id));}}}};
frame.onload();
const shape=svg.querySelector(`[data-node-id="${fileNode.id}"]`);let clickHandled=false;
frameListeners.click[0]({type:'click',button:0,target:shape,preventDefault(){clickHandled=true;},stopImmediatePropagation(){}});
assert.equal(clickHandled,true);assert.equal(run('app.node'),fileNode.id);assert.equal(run('app.panelOpen'),true,'clicking a node opens its reading panel');
const fileId=fileNode.artifacts.find(item=>item.file_id).file_id;
const artifactLink=$('reader-content').querySelectorAll('a').find(anchor=>anchor.href.startsWith('blob:'));
assert.ok(artifactLink,'the node exposes a true packaged-resource link');
artifactLink.click();assert.equal(run('app.view'),'file');assert.equal(run('app.fileId'),fileId);
const firstFile=$('reader-content').querySelector('#file-render');
assert.ok(firstFile,'artifact opens as a full reader document');
const firstFileObj=payload.files[fileId];
const secondFile=Object.values(payload.files).find(file=>file.name==='review-checklist.md');
assert.ok(firstFileObj.name==='reading-plan.md'&&secondFile,'demo has two mutually linked Markdown files');
const linked=firstFile.querySelectorAll('a').find(anchor=>anchor.href===run(`resourceURL(E.files[${JSON.stringify(secondFile.id)}])`));
assert.ok(linked,'Markdown relative link resolves to the packaged sibling document');
$('reader-content').scrollTop=218;$('reader-content').dispatchEvent({type:'scroll'});linked.click();
assert.equal(run('app.fileId'),secondFile.id);assert.equal($('reader-content').scrollTop,0,'new file route starts at its first line');
$('reader-content').scrollTop=376;$('reader-content').dispatchEvent({type:'scroll'});history.back();
assert.equal(run('app.fileId'),fileId);assert.equal($('reader-content').scrollTop,218,'Back restores the first file position');
history.forward();assert.equal(run('app.fileId'),secondFile.id);assert.equal($('reader-content').scrollTop,376,'Forward restores the second file position');

const search=$('search'),results=$('results');search.value='阅读';search.dispatchEvent({type:'input'});
const kinds=results.querySelectorAll('.search-group-heading').map(node=>node.textContent.split(' · ')[0]);
assert.deepEqual(kinds,['阶段','文件','对话摘录'],'the global search indexes each content kind');
console.log(JSON.stringify({status:'passed',kind:'portable fake-DOM runtime check; not real-browser evidence',checks:['default graph-first startup','node click opens reader','embedded file link opens in reader','two relative Markdown files navigate A/B with Back/Forward scroll','global search groups stages, files, and saved excerpts']}));
