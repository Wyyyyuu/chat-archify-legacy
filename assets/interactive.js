'use strict';
const E=JSON.parse(document.getElementById('explorer-data').textContent);
const $=id=>document.getElementById(id);
const STATUS={proposed:'提议',in_progress:'进行中',completed:'已完成',verified:'已验证',failed:'该尝试失败',paused:'暂停／延期',superseded:'被替代',unknown:'待确认'};
const KIND={goal:'目标',milestone:'里程碑',module:'模块',experiment:'尝试',decision:'决策',issue:'问题'};
const REL={continues:'延续',branches:'分叉',adds:'增加',pivots:'转向',merges:'汇合',depends_on:'依赖',chronological:'仅先后'};
const C=new Map(E.chapters.map(c=>[c.id,c]));
const resourceURLs=new Map(),frameByChapter=new Map(),lastNodeByChapter=new Map(),focusedNodeByChapter=new Map();
let generation=0,historyCursor=0,maxHistoryCursor=0,searchTimer=null,scrollTimer=null,expandedSearchTypes=new Set();
let app={chapter:C.keys().next().value,node:null,view:'node',fileId:null,conversationId:null,panelOpen:true,crumbs:[],origin:null,resourceNote:'',locator:'',fileRaw:false,searchQuery:'',searchOpen:false,conversationScope:null,conversationLabel:'',conversationQuery:'',conversationTask:'',readerScroll:0,listScroll:0};
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
function button(text,fn,cls='button'){const b=el('button',text,cls);b.type='button';b.addEventListener('click',fn);return b;}
function paragraph(parent,text,cls){if(text!==undefined&&text!==null&&String(text)!=='')parent.append(el('p',String(text),cls));}
function section(parent,title,cls='reader-section'){const s=el('section',undefined,cls);s.append(el('h3',title));parent.append(s);return s;}
function bytes64(data){return Uint8Array.from(atob(data),c=>c.charCodeAt(0));}
function downloadBytes(bytes,name,mime){const blob=new Blob([bytes],{type:mime||'application/octet-stream'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function downloadFile(file){if(file?.status==='embedded')downloadBytes(bytes64(file.data),file.name,file.mime);}
function resourceURL(file){if(!resourceURLs.has(file.id)){const type=typeof file.text==='string'?'text/plain;charset=utf-8':(/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(file.mime)?file.mime:'application/octet-stream');resourceURLs.set(file.id,URL.createObjectURL(new Blob([bytes64(file.data)],{type})));}return resourceURLs.get(file.id);}
async function copy(value,b){try{await navigator.clipboard.writeText(value);b.textContent='已复制';}catch{let area=b.parentElement.querySelector('.copy-fallback');if(!area){area=el('textarea',undefined,'copy-fallback');area.readOnly=true;area.rows=3;b.parentElement.append(area);}area.value=value;area.focus();area.select();b.textContent='请复制下方内容';}}
function isMarkdown(file){return /\.(md|markdown|mdown)$/i.test(file.name)||file.mime==='text/markdown';}
function findNode(id,chapterId=app.chapter){return C.get(chapterId)?.record.nodes.find(n=>n.id===id)||null;}
function currentChapter(){return C.get(app.chapter)||C.get(C.keys().next().value);}
function verifiedHttpsUrl(value,verified){if(verified!==true||typeof value!=='string')return '';try{const url=new URL(value);return url.protocol==='https:'&&url.hostname&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function currentRoute(){return {chapter:app.chapter,node:app.node,view:app.view,fileId:app.fileId,conversationId:app.conversationId,panelOpen:app.panelOpen,origin:app.origin,resourceNote:app.resourceNote,locator:app.locator,crumbs:app.crumbs};}
function serializableState(){return {chatArchify:true,index:historyCursor,app:{...app,crumbs:(app.crumbs||[]).map(c=>({...c}))}};}
function routeHash(state){const params=new URLSearchParams();if(state.chapter)params.set('chapter',state.chapter);if(state.node)params.set('node',state.node);if(state.view&&state.view!=='node')params.set('view',state.view);if(state.fileId)params.set('file',state.fileId);if(state.conversationId)params.set('conversation',state.conversationId);return '#'+params.toString();}
function persistState(){try{history.replaceState(serializableState(),'',routeHash(app));}catch{}}
function saveCurrentPosition(){
 if(app.panelOpen&&app.view!=='graph'){
  const content=$('reader-content');if(content)app.readerScroll=content.scrollTop;
  const list=$('conversation-list');if(list)app.listScroll=list.scrollTop;
 }
 if(history.state?.chatArchify)persistState();
}
function savePositionSoon(){clearTimeout(scrollTimer);scrollTimer=setTimeout(saveCurrentPosition,70);}
function syncHistoryButtons(){const back=app.historyIndex??historyCursor;['history-back','reader-back'].forEach(id=>{$(id).disabled=back<=0;});['history-forward','reader-forward'].forEach(id=>{$(id).disabled=back>=maxHistoryCursor;});}
function focusReader(){const target=app.panelOpen&&app.view!=='graph'?$('reader-title'):$('wide');if(target&&!target.hidden)target.focus({preventScroll:true});}
function scrollToSavedPosition(){requestAnimationFrame(()=>{const content=$('reader-content');if(content)content.scrollTop=app.readerScroll||0;const list=$('conversation-list');if(list)list.scrollTop=app.listScroll||0;const results=$('results');if(results)results.scrollTop=app.searchScroll||0;});}
function renderRoute({focus=false,restoreScroll=false}={}){
 const ch=currentChapter();if(!ch)return;app.chapter=ch.id;
 const graphVisible=window.matchMedia('(min-width:781px)').matches||!app.panelOpen||app.view==='graph';const activeFrame=graphVisible?ensureFrame(ch):frameByChapter.get(ch.id);for(const [id,frame] of frameByChapter)frame.hidden=id!==ch.id;
 document.querySelectorAll('[data-chapter]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.chapter===ch.id)));
 $('workspace').classList.toggle('show-graph',!app.panelOpen||app.view==='graph');
 $('reader-panel').hidden=!app.panelOpen||app.view==='graph';
 $('reader-graph').hidden=window.matchMedia('(min-width:781px)').matches;
 $('wide').textContent=app.panelOpen&&app.view!=='graph'?'返回图':'打开阅读面板';
 $('node-picker').replaceChildren();const placeholder=el('option','定位阶段');placeholder.value='';placeholder.disabled=true;$('node-picker').append(placeholder);
 for(const n of ch.record.nodes){const option=el('option',n.title);option.value=n.id;$('node-picker').append(option);}
 $('node-picker').value=findNode(app.node,ch.id)?app.node:'';
 $('graph-count').textContent=`${ch.record.nodes.length} 个阶段 · ${ch.record.edges.length} 条关系`;
 $('native-download').disabled=false;coverage();
 if(!restoreScroll&&app.panelOpen&&app.view!=='graph'){$('reader-content').scrollTop=0;const list=$('conversation-list');if(list)list.scrollTop=0;}
 renderBreadcrumbs();renderReader();syncHistoryButtons();
 if(app.node){lastNodeByChapter.set(app.chapter,app.node);if(focusedNodeByChapter.get(app.chapter)!==app.node)focusNodeInFrame(app.chapter,app.node);}
 if(restoreScroll)scrollToSavedPosition();if(focus)focusReader();
}
function pushRoute(changes={},opts={}){
 saveCurrentPosition();const next={...app,readerScroll:opts.preservePosition?app.readerScroll:0,listScroll:opts.preservePosition?app.listScroll:0,searchScroll:opts.preservePosition?app.searchScroll:0,...changes};
 historyCursor=(app.historyIndex??historyCursor)+1;maxHistoryCursor=historyCursor;next.historyIndex=historyCursor;app=next;
 try{history.pushState(serializableState(),'',routeHash(app));}catch{}
 renderRoute({focus:opts.focus!==false,restoreScroll:opts.restoreScroll===true});
}
function replaceRoute(changes={}){Object.assign(app,changes);persistState();renderRoute({restoreScroll:true});}
function navigateChapter(chapterId,nodeId=null){
 const ch=C.get(chapterId);if(!ch)return;const node=findNode(nodeId,chapterId)||findNode(lastNodeByChapter.get(chapterId),chapterId)||ch.record.nodes[0];
 pushRoute({chapter:chapterId,node:node?.id||null,view:'node',fileId:null,conversationId:null,panelOpen:app.panelOpen,crumbs:[],origin:null,resourceNote:'',locator:'',fileRaw:false});
 if(node)lastNodeByChapter.set(chapterId,node.id);
}
function navigateNode(nodeId,chapterId=app.chapter,{focusGraph=false,preserveCrumbs=false}={}){
 const ch=C.get(chapterId),node=findNode(nodeId,chapterId);if(!ch||!node)return;
 pushRoute({chapter:chapterId,node:nodeId,view:'node',fileId:null,conversationId:null,panelOpen:true,crumbs:preserveCrumbs?app.crumbs:[],origin:null,resourceNote:'',locator:'',fileRaw:false});
 lastNodeByChapter.set(chapterId,nodeId);
}
function viewGraph(){pushRoute({panelOpen:false},{preservePosition:true,focus:false});}
function openReader(){const n=findNode(app.node);if(n)pushRoute({panelOpen:true},{preservePosition:true,restoreScroll:true});else navigateNode(currentChapter().record.nodes[0]?.id);}
function crumbBase(state=app){
 if(state.crumbs?.length)return state.crumbs.map(c=>({...c}));
 const ch=C.get(state.chapter),items=[];if(ch)items.push({label:ch.label,chapter:ch.id,view:'node',node:null});
 const n=findNode(state.node,state.chapter);if(n)items.push({label:n.title,chapter:state.chapter,node:n.id,view:'node'});
 return items;
}
function labelFor(state){if(state.view==='file')return E.files[state.fileId]?.name||'文件';if(state.view==='conversation-entry'){const entry=(E.conversations||[]).find(e=>e.id===state.conversationId);return entry?.source_title||'对话摘录';}if(state.view==='conversations')return '对话索引';if(state.view==='graph')return '框图';return findNode(state.node,state.chapter)?.title||C.get(state.chapter)?.label||'项目';}
function routeSnapshot(state){return {label:labelFor(state),chapter:state.chapter,node:state.node,view:state.view,fileId:state.fileId,conversationId:state.conversationId};}
function openCrumb(index){const all=visibleCrumbs();const crumb=all[index];if(!crumb)return;const chapter=crumb.chapter||app.chapter,ch=C.get(chapter),node=findNode(crumb.node,chapter)||findNode(lastNodeByChapter.get(chapter),chapter)||ch?.record.nodes[0];const route={chapter,node:node?.id||null,view:crumb.view||'node',fileId:crumb.fileId||null,conversationId:crumb.conversationId||null,panelOpen:true,origin:routeSnapshot(app),resourceNote:'',locator:'',fileRaw:false,crumbs:all.slice(0,index)};pushRoute(route);}
function visibleCrumbs(){
 if(app.view==='node'||app.view==='graph')return crumbBase({chapter:app.chapter,node:app.node,view:app.view});
 const base=app.crumbs?.length?app.crumbs.map(c=>({...c})):crumbBase({chapter:app.chapter,node:app.node,view:'node'});
 return [...base,{...routeSnapshot(app),chapter:app.chapter,node:app.node}];
}
function renderBreadcrumbs(){
 const root=$('breadcrumbs');root.replaceChildren();for(const [i,crumb] of visibleCrumbs().entries()){
  if(i)root.append(el('span','›','note'));const b=button(crumb.label,()=>openCrumb(i),'breadcrumb');b.setAttribute('aria-label','返回'+crumb.label);root.append(b);
 }
}
function openFile(id,options={}){
 const f=E.files[id];if(!f)return;
 const parent=options.from||app,crumbs=crumbBase(parent);if(['file','conversation-entry','conversations'].includes(parent.view))crumbs.push(routeSnapshot(parent));
 pushRoute({view:'file',fileId:id,conversationId:null,panelOpen:true,crumbs,origin:options.origin||routeSnapshot(parent),resourceNote:options.note||'',locator:options.locator||'',fileRaw:false});
}
function navigateToConversationIndex(ids=null,label=''){
 const base=app.view==='node'?crumbBase(app):app.crumbs?.length?app.crumbs.map(c=>({...c})):crumbBase(app);if(['file','conversation-entry'].includes(app.view))base.push(routeSnapshot(app));
 pushRoute({view:'conversations',fileId:null,conversationId:null,panelOpen:true,crumbs:base,conversationScope:ids?Array.from(ids):null,conversationLabel:label,conversationTask:'',conversationQuery:'',origin:routeSnapshot(app),resourceNote:'',locator:''});
}
function navigateToConversationEntry(id){
 const entry=(E.conversations||[]).find(e=>e.id===id);if(!entry)return;
 let crumbs=app.view==='conversations'||app.view==='conversation-entry'?(app.crumbs||[]).map(c=>({...c})):crumbBase(app);if(app.view==='file')crumbs.push(routeSnapshot(app));
 pushRoute({view:'conversation-entry',conversationId:id,fileId:null,panelOpen:true,crumbs:crumbs.map(c=>({...c})),origin:app.view==='conversations'?app.origin:routeSnapshot(app)});
}
function showCoverage(){const details=$('coverage');details.open=true;details.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});}
function coverage(){const root=$('coverage-body');root.replaceChildren();const ch=currentChapter();for(const text of ch.record.coverage||[])paragraph(root,text);for(const text of ch.record.open_questions||[])paragraph(root,'待确认：'+text);paragraph(root,'文件链接打开本页保存的快照；原始路径可复制。验证范围见随附记录，当前环境未完成真实浏览器交互检查。');}
function ensureFrame(ch){
 let frame=frameByChapter.get(ch.id);if(frame)return frame;
 frame=el('iframe');frame.id='viewer-'+ch.id;frame.title=`Archify 项目演进交互图 · ${ch.label}`;frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-downloads');frame.referrerPolicy='no-referrer';frame.loading='eager';
 const token=++generation;frame.onload=()=>wireFrame(ch.id,token);frame.srcdoc=new TextDecoder().decode(bytes64(ch.viewer));$('viewer-host').append(frame);frameByChapter.set(ch.id,frame);return frame;
}
function focusNodeInFrame(chapterId,id){
 try{const frame=frameByChapter.get(chapterId),node=frame?.contentDocument?.querySelector(`[data-node-id="${id}"]`);if(!node)return;const focus=frame.contentWindow?.Archify?.focus;if(focus?.set)focus.set(id,{toggle:false,hideChip:true,updateUrl:false});else node.setAttribute('aria-pressed','true');focusedNodeByChapter.set(chapterId,id);}catch{}
}
function wireFrame(chapterId,token){
 if(token!==Number($('viewer-'+chapterId)?.dataset.wireToken||token))return;
 try{
  const frame=frameByChapter.get(chapterId),doc=frame?.contentDocument;if(!doc?.querySelector('[data-node-id]'))throw new Error('viewer unavailable');$('viewer-note').hidden=true;
  const activate=event=>{
   if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;if(event.type==='click'&&event.button!==undefined&&event.button!==0)return;
   const node=event.target.closest?.('[data-node-id]');if(!node||!findNode(node.dataset.nodeId,chapterId)||doc.querySelector('[data-just-panned="true"]'))return;
   event.preventDefault();event.stopImmediatePropagation();if(chapterId===app.chapter)navigateNode(node.dataset.nodeId,chapterId);
  };
  doc.addEventListener('click',activate,true);doc.addEventListener('keydown',activate,true);
  const localObserver=new MutationObserver(records=>{if(chapterId!==app.chapter||!records.some(r=>r.target.matches?.('[data-node-id]')))return;const active=doc.querySelector('[data-node-id][aria-pressed="true"]');if(active&&active.dataset.nodeId!==app.node&&findNode(active.dataset.nodeId,chapterId))navigateNode(active.dataset.nodeId,chapterId);});
  localObserver.observe(doc.documentElement,{subtree:true,attributes:true,attributeFilter:['aria-pressed']});frame.dataset.wireToken=String(token);frame._archifyObserver=localObserver;if(chapterId===app.chapter&&app.node&&focusedNodeByChapter.get(chapterId)!==app.node)focusNodeInFrame(chapterId,app.node);
 }catch{$('viewer-note').hidden=false;}
}
function fileAssociations(fileId){
 const found=[];for(const ch of E.chapters){const sources=new Map((ch.record.sources||[]).map(s=>[s.id,s]));for(const n of ch.record.nodes){const artifact=(n.artifacts||[]).some(a=>a.file_id===fileId);const evidence=(n.evidence||[]).some(e=>sources.get(e.source)?.file_id===fileId);if(artifact||evidence)found.push({chapter:ch.id,chapterLabel:ch.label,node:n.id,title:n.title,relationship:artifact&&evidence?'产物与依据':artifact?'节点产物':'证据来源'});}}
 return found;
}
function nodeSearchText(n,ch){const sources=new Map((ch.record.sources||[]).map(s=>[s.id,s]));return [n.title,n.kind,n.branch,n.date,n.summary,n.reason,...(n.artifacts||[]).flatMap(a=>[a.label,a.title,a.note,a.version]),...(n.evidence||[]).flatMap(e=>{const s=sources.get(e.source);return [e.locator,e.note,s?.title,s?.locator];})].filter(Boolean).join(' ');}
function searchIndex(){
 const results=[];for(const ch of E.chapters)for(const n of ch.record.nodes){results.push({type:'阶段',chapter:ch.id,node:n.id,title:n.title,sub:ch.label,content:nodeSearchText(n,ch)});}
 for(const f of Object.values(E.files||{})){if(f.status==='embedded')results.push({type:'文件',fileId:f.id,title:f.name,sub:f.path,content:[f.name,f.path,f.text||'',f.note||''].join(' '),raw:f.text||''});}
 for(const entry of E.conversations||[])results.push({type:'对话摘录',conversationId:entry.id,title:entry.source_title,sub:[entry.date,entry.role].filter(Boolean).join(' · '),content:[entry.source_title,entry.date,entry.role,entry.task_id,entry.text].filter(Boolean).join(' '),raw:entry.text||''});
 return results;
}
const INDEX=searchIndex();
function findMatch(text,q){const lower=String(text||'').toLocaleLowerCase(),needle=q.toLocaleLowerCase(),at=lower.indexOf(needle);if(at<0)return null;const start=Math.max(0,at-56),end=Math.min(String(text).length,at+needle.length+84);return {at,snippet:(start?'…':'')+String(text).slice(start,end).replace(/\s+/g,' ').trim()+(end<String(text).length?'…':'')};}
function search({open=true}={}){
 clearTimeout(searchTimer);searchTimer=setTimeout(()=>{
  const q=$('search').value.trim(),root=$('results');app.searchQuery=q;if(open){app.searchOpen=Boolean(q);app.searchScroll=0;expandedSearchTypes.clear();app.searchExpandedTypes=[];}else expandedSearchTypes=new Set(app.searchExpandedTypes||[]);root.replaceChildren();root.hidden=!(q&&app.searchOpen);if(!q){persistState();return;}
  const buckets=new Map([['阶段',[]],['文件',[]],['对话摘录',[]]]);
  for(const item of INDEX){const match=findMatch(item.content,q);if(match){const rawMatch=item.raw?findMatch(item.raw,q):null;buckets.get(item.type).push({...item,match,rawMatch});}}
  let any=false;for(const [type,matches] of buckets){if(!matches.length)continue;any=true;const group=el('section',undefined,'search-results-group');group.append(el('h3',`${type} · ${matches.length}`,'search-group-heading'));const limit=expandedSearchTypes.has(type)?matches.length:10;
   for(const item of matches.slice(0,limit)){const b=button('',()=>openSearchResult(item),'result');b.append(el('span',type,'result-type'),el('strong',item.title||item.sub));const meta=[item.sub,item.match.snippet].filter(Boolean).join(' · ');b.append(el('span',meta,'match-context'));group.append(b);}
   if(matches.length>limit)group.append(button(`显示其余 ${matches.length-limit} 项`,()=>{expandedSearchTypes.add(type);app.searchExpandedTypes=[...expandedSearchTypes];search({open:false});},'link-button'));root.append(group);
  }
  if(!any)root.append(el('div','没有匹配的阶段、文件或已收录对话。','notice'));root.scrollTop=app.searchScroll||0;
  persistState();
 },80);
}
function openSearchResult(item){
 const q=app.searchQuery;$('results').hidden=true;
 if(item.type==='阶段')navigateNode(item.node,item.chapter);
 else if(item.type==='文件'){const line=item.rawMatch?item.raw.slice(0,item.rawMatch.at).split('\n').length:null;openFile(item.fileId,{from:app,origin:{label:'搜索结果',view:'search',chapter:app.chapter,node:app.node},locator:line?`L${line}`:'',note:''});}
 else navigateToConversationEntry(item.conversationId);
 app.searchQuery=q;app.searchOpen=false;$('search').value=q;persistState();
}
function highlightTextMatch(root,query){
 const needle=String(query||'').toLocaleLowerCase();if(!needle)return false;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
 while((node=walker.nextNode())){if(!node.nodeValue||!node.nodeValue.toLocaleLowerCase().includes(needle))continue;const parent=node.parentElement;if(parent?.closest('script,style,textarea,button,a'))continue;const index=node.nodeValue.toLocaleLowerCase().indexOf(needle),after=node.splitText(index),tail=after.splitText(needle.length),mark=el('mark',after.nodeValue);after.parentNode.replaceChild(mark,after);mark.scrollIntoView({block:'center'});return true;}
 return false;
}
function renderNode(){
 const root=$('reader-content'),ch=currentChapter(),n=findNode(app.node);root.replaceChildren();$('reader-title').textContent=n?.title||'未选择阶段';const actions=$('reader-actions');actions.replaceChildren();
 actions.append(button('复制阶段定位',event=>copy(`${ch.label}\n${n?.title||''}\n${n?.date||'阶段时间未注明'}`,event.currentTarget)));
 if(!n){paragraph(root,'请从框图或阶段列表选择一个阶段。','notice');return;}
 const head=section(root,'阶段信息');paragraph(head,`${KIND[n.kind]||n.kind} · ${n.branch||'分支未注明'}`,'meta');paragraph(head,'阶段时间：'+(n.date||'未注明'),'reader-node-time');head.append(el('span',STATUS[n.status]||n.status,'status'));const title=el('h2',n.title,'reader-node-title');head.prepend(title);
 const artifacts=section(root,`相关资源 · ${(n.artifacts||[]).length}`);if(!(n.artifacts||[]).length)paragraph(artifacts,'没有记录相关产物。','note');for(const item of n.artifacts||[])describeResource(artifacts,item);
 const summary=section(root,'发生了什么');paragraph(summary,n.summary||'没有提供摘要。');if(n.reason)paragraph(section(root,'为什么这样走'),n.reason);
 conversationContext(root,n);
 const sources=new Map((ch.record.sources||[]).map(s=>[s.id,s])),evidence=section(root,`依据 · ${(n.evidence||[]).length}`);
 for(const ref of n.evidence||[]){const source=sources.get(ref.source);if(!source)continue;const box=el('div',undefined,'resource-line');if(source.file_id){box.append(button(source.title||E.files[source.file_id]?.name||'查看证据文件',()=>openFile(source.file_id,{note:source.note||'',locator:ref.locator||'',from:app}),'link-button'));}else if(verifiedHttpsUrl(source.original_url,source.original_url_verified)){const a=el('a',source.title||'打开来源', 'resource-link');a.href=verifiedHttpsUrl(source.original_url,source.original_url_verified);a.target='_blank';a.rel='noopener noreferrer';box.append(a);}else box.append(el('strong',source.title||'来源'));
  paragraph(box,source.coverage||source.locator,'note');if(source.note)paragraph(box,source.note,'note');if(ref.note)paragraph(box,ref.note,'note');
  if(ref.locator){const loc=button('定位 '+ref.locator,()=>source.file_id?openFile(source.file_id,{note:source.note||'',locator:ref.locator,from:app}):paragraph(box,'当前来源没有可打开的内嵌文件，保留原始定位：'+ref.locator,'locator-help'),'link-button');box.append(loc);}
  evidence.append(box);
 }
 const relations=ch.record.edges.filter(e=>e.from===n.id||e.to===n.id);if(relations.length){const sec=section(root,'连接关系');for(const edge of relations){const incoming=edge.to===n.id,other=findNode(incoming?edge.from:edge.to,ch.id),box=el('div',undefined,'resource-line');paragraph(box,(incoming?'来自':'通向')+' · '+REL[edge.type]+(edge.confidence==='inferred'?'（推测）':''),'note');if(other)box.append(button(other.title,()=>navigateNode(other.id,ch.id),'link-button'));paragraph(box,edge.reason,'note');sec.append(box);}}
}
function describeResource(parent,item){
 const box=el('div',undefined,'resource-line'),title=item.label||item.title||item.uri||'未命名资源';
 if(item.chapter_id){box.append(button(title,()=>navigateChapter(item.chapter_id),'link-button'));paragraph(box,'相关的讨论路线','note');}
 else if(item.file_id){const f=E.files[item.file_id];if(f?.status==='embedded'){const a=el('a',title===f.name?title:`${title} · ${f.name}`,'resource-link');a.href=resourceURL(f);a.target='_blank';a.rel='noopener noreferrer';a.addEventListener('click',event=>{if(event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();openFile(f.id,{from:app,note:item.note||''});}});box.append(a);paragraph(box,f.is_directory?'目录索引':'文件快照','note');const actions=el('div',undefined,'actions');actions.append(button('页内查看',()=>openFile(f.id,{from:app,note:item.note||''})),button('下载文件',()=>downloadFile(f)),button('复制原始路径',event=>copy(f.path,event.currentTarget)));box.append(actions);}else{box.append(el('strong',title));paragraph(box,f?.note||'文件未找到，保留原始位置。','note');box.append(button('查看文件信息',()=>openFile(item.file_id,{from:app,note:item.note||''}),'link-button'));}}
 else if(/^https?:\/\//i.test(item.uri||'')){const a=el('a',title,'resource-link');a.href=item.uri;a.target='_blank';a.rel='noopener noreferrer';box.append(a);}
 else {box.append(el('strong',title));if(item.uri)box.append(button('复制链接',event=>copy(item.uri,event.currentTarget),'link-button'));}
 if(item.note)paragraph(box,item.note,'note');if(item.version)paragraph(box,'版本：'+item.version,'note');parent.append(box);
}
function parseLineLocators(value){const text=String(value||''),ranges=[],pattern=/(?:^|[^\w])L(?:ine\s*)?(\d+)(?:\s*[–—-]\s*L?(\d+))?/gi;let match;while((match=pattern.exec(text))){const start=Number(match[1]),end=Number(match[2]||match[1]);if(start>0&&end>=start)ranges.push({start,end});}return ranges;}
function renderRawText(text,container){container.replaceChildren();const pre=el('pre',undefined,'raw-source'),lines=String(text||'').split('\n');lines.forEach((line,index)=>{const span=el('span',line+(index<lines.length-1?'\n':''),'source-line');span.dataset.line=String(index+1);pre.append(span);});container.append(pre);}
function highlightLocator(container,locator){
 const ranges=parseLineLocators(locator);container.querySelectorAll('.locator-target').forEach(node=>node.classList.remove('locator-target'));
 if(!ranges.length)return {ok:false,reason:'无法识别为行号定位'};
 const targets=[...container.querySelectorAll('.source-line,[data-source-start][data-source-end]')].filter(node=>{const start=Number(node.dataset.line||node.dataset.sourceStart),end=Number(node.dataset.line||node.dataset.sourceEnd);return Number.isFinite(start)&&Number.isFinite(end)&&ranges.some(range=>start<=range.end&&end>=range.start);});
 if(!targets.length)return {ok:false,reason:'当前渲染结果未能将这些原文行映射到段落'};
 targets.forEach(node=>node.classList.add('locator-target'));targets[0].scrollIntoView({block:'center'});return {ok:true,count:targets.length,ranges};
}
function renderFile(){
 const f=E.files[app.fileId],root=$('reader-content');root.replaceChildren();$('reader-title').textContent=f?.name||'文件';const actions=$('reader-actions');actions.replaceChildren();if(!f)return;
 if(f.status==='embedded'&&isMarkdown(f))actions.append(button(app.fileRaw?'返回阅读视图':'查看原文',()=>toggleRawFile(),'button'));
 actions.append(button('下载文件',()=>downloadFile(f),'button primary'));
 if(f.path)actions.append(button('复制原始路径',event=>copy(f.path,event.currentTarget),'button'));
 const meta=section(root,'文件快照');paragraph(meta,`${f.status==='embedded'?(Math.ceil((f.bytes||0)/1024)+' KB'):'未嵌入内容'} · 快照时间：${f.snapshot_at||'未记录'}`,'note');
 if(f.note)paragraph(meta,f.note,'note');if(app.resourceNote)paragraph(meta,app.resourceNote,'note');
 if(app.origin?.label)paragraph(meta,`从“${app.origin.label}”进入。`,'note');
 const locatorBox=app.locator?section(root,'来源定位'):null;if(locatorBox){paragraph(locatorBox,'原始文件位置：'+app.locator,'note');locatorBox.append(button('定位到相关段落',()=>{const outcome=highlightLocator($('file-render'),app.locator);if(!outcome.ok)paragraph(locatorBox,outcome.reason+'；请查看原文中的行号。','locator-help');}));}
 const outline=el('div',undefined,'file-outline');const article=el('article',undefined,'markdown-body');article.id='file-render';
 if(f.status==='embedded'){
  if(/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(f.mime)){const img=el('img');img.alt=f.name;img.src=`data:${f.mime};base64,${f.data}`;img.style.maxWidth='100%';article.append(img);}
  else if(isMarkdown(f)&&!app.fileRaw){const headings=renderMarkdown(f.text,article,f);if(headings.length){const select=el('select');select.setAttribute('aria-label','文档目录');const first=el('option','选择文档章节');first.value='';select.append(first);headings.forEach((h,i)=>{const option=el('option','　'.repeat(Math.min(3,h.depth-1))+h.label);option.value=String(i);select.append(option);});select.addEventListener('change',()=>{if(select.value!=='')headings[Number(select.value)].element.scrollIntoView({block:'start'});});outline.append(select);} }
  else if(typeof f.text==='string')renderRawText(f.text,article);else paragraph(article,'此格式可下载后用对应应用打开。');
 }else paragraph(article,f.note||'原始文件不存在，未生成快照。','note');
 if(outline.childNodes.length)root.append(outline);root.append(article);
 if(app.locator){const outcome=highlightLocator(article,app.locator);if(!outcome.ok)paragraph(root,outcome.reason+'；请查看原文中的行号。','locator-help');}
 const associated=fileAssociations(f.id),association=el('details',undefined,'technical-details');association.append(el('summary',`文件关联阶段 · ${associated.length}`));if(associated.length){for(const item of associated){const row=el('div',undefined,'resource-line');paragraph(row,`${item.chapterLabel} · ${item.relationship}`,'note');row.append(button(item.title,()=>navigateNode(item.node,item.chapter),'link-button'));association.append(row);}}else paragraph(association,'没有已记录的节点直接关联此文件。','note');root.append(association);
 const technical=el('details',undefined,'technical-details');technical.append(el('summary','文件位置与校验信息'));paragraph(technical,f.path||'原始路径未记录','note');if(f.sha256)paragraph(technical,'快照 SHA-256：'+f.sha256,'note');root.append(technical);
 const context=section(root,'相关对话摘录');const related=new Set(associated.flatMap(item=>{const n=findNode(item.node,item.chapter);return conversationIdsFor(n);}));if(related.size){context.append(button(`查看 ${related.size} 段相关摘录`,()=>navigateToConversationIndex([...related],f.name),'button primary'));}else paragraph(context,'没有从文件关系中精确关联到对话摘录。','note');
}
function toggleRawFile(){saveCurrentPosition();const scroll=$('reader-content').scrollTop;app.fileRaw=!app.fileRaw;persistState();renderRoute({restoreScroll:false});$('reader-content').scrollTop=scroll;}
function renderReader(){
 const root=$('reader-content');if(!root)return;switch(app.view){case'graph':root.replaceChildren();$('reader-title').textContent='框图';$('reader-actions').replaceChildren();break;case'file':renderFile();break;case'conversations':$('reader-title').textContent='已保存对话摘录';$('reader-actions').replaceChildren(button('全部已收录对话',()=>navigateToConversationIndex(null,''),'button'));renderConversationIndex(root);break;case'conversation-entry':$('reader-title').textContent='已保存对话摘录';$('reader-actions').replaceChildren();renderConversationEntry(root,app.conversationId);break;default:renderNode();break;}
}
function initialState(){
 const params=new URLSearchParams(location.hash.slice(1)),chapter=C.has(params.get('chapter'))?params.get('chapter'):C.keys().next().value,node=findNode(params.get('node'),chapter),conversationId=(E.conversations||[]).some(e=>e.id===params.get('conversation'))?params.get('conversation'):null;
 const requestedView=params.get('view'),view=conversationId?'conversation-entry':requestedView==='file'&&E.files[params.get('file')]?'file':'node';
 return {...app,chapter,node:node?.id||C.get(chapter).record.nodes[0]?.id||null,view,fileId:view==='file'?params.get('file'):null,conversationId,panelOpen:view==='file'||view==='conversation-entry',historyIndex:0};
}
function setup(){
 for(const ch of E.chapters){const b=button(ch.label,()=>navigateChapter(ch.id),'tab');b.dataset.chapter=ch.id;b.id='tab-'+ch.id;b.setAttribute('role','tab');b.setAttribute('aria-selected','false');b.setAttribute('aria-controls','viewer-host');$('chapters').append(b);}
 $('chapters').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const all=[...$('chapters').querySelectorAll('button')],i=all.indexOf(event.target);if(i<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?all.length-1:(i+(event.key==='ArrowRight'?1:-1)+all.length)%all.length;all[next].focus();all[next].click();});
 $('node-picker').addEventListener('change',()=>{if($('node-picker').value)navigateNode($('node-picker').value,app.chapter,{focusGraph:true});});
 $('search').addEventListener('input',search);$('search').addEventListener('focus',()=>{if(app.searchQuery){app.searchOpen=true;$('results').hidden=false;search({open:false});}});$('search').addEventListener('keydown',event=>{if(event.key==='Escape'){$('results').hidden=true;app.searchOpen=false;persistState();}});document.addEventListener('click',event=>{if(!event.target.closest('.search')){$('results').hidden=true;if(app.searchOpen){app.searchOpen=false;persistState();}}});
 $('wide').addEventListener('click',()=>app.panelOpen&&app.view!=='graph'?viewGraph():openReader());$('history-back').addEventListener('click',()=>{saveCurrentPosition();history.back();});$('reader-back').addEventListener('click',()=>{saveCurrentPosition();history.back();});$('history-forward').addEventListener('click',()=>history.forward());$('reader-forward').addEventListener('click',()=>history.forward());$('reader-graph').addEventListener('click',viewGraph);$('reader-close').addEventListener('click',viewGraph);$('about').addEventListener('click',showCoverage);$('native-download').addEventListener('click',()=>downloadBytes(bytes64(currentChapter().viewer),'project-'+app.chapter+'-diagram.html','text/html'));
 $('reader-content').addEventListener('scroll',()=>{app.readerScroll=$('reader-content').scrollTop;savePositionSoon();});$('results').addEventListener('scroll',()=>{app.searchScroll=$('results').scrollTop;savePositionSoon();});
 window.addEventListener('popstate',event=>{const saved=event.state;if(!saved?.chatArchify)return;historyCursor=Number(saved.index)||0;app={...app,...saved.app,historyIndex:historyCursor};renderRoute({restoreScroll:true});if(app.searchQuery){$('search').value=app.searchQuery;$('results').hidden=!app.searchOpen;search({open:false});}});
 window.addEventListener('resize',()=>renderRoute({restoreScroll:true}));
 document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(app.searchOpen){$('results').hidden=true;app.searchOpen=false;persistState();return;}if(app.panelOpen&&app.view!=='graph'){if(historyCursor>0)history.back();else viewGraph();}});
 setupConversations();app=initialState();historyCursor=0;maxHistoryCursor=0;try{history.replaceState(serializableState(),'',routeHash(app));}catch{}renderRoute({restoreScroll:true});
 if(app.view==='conversation-entry'){const entry=(E.conversations||[]).find(e=>e.id===app.conversationId);if(entry)app.conversationScope=null;}
}
setup();
