'use strict';
let conversationUI=null;
function excerptSummary(entry){return String(entry.text||'').replace(/[`#*>_\[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,150);}
function conversationIdsFor(node){return node?.conversation_entry_ids?.length?node.conversation_entry_ids:node?.conversation_source_entry_ids||[];}
function conversationEntry(id){return (E.conversations||[]).find(entry=>entry.id===id)||null;}
function conversationContext(parent,node){
 const box=el('section',undefined,'reader-section conversation-context');parent.append(box);box.append(el('h3','对话摘录'));
 if(node){paragraph(box,'当前阶段：'+node.title);paragraph(box,node.summary,'note');}
 const ids=conversationIdsFor(node),exact=Boolean(node?.conversation_entry_ids?.length);
 if(exact)paragraph(box,`已与 ${ids.length} 段保存摘录精确对应（按记录中的轮次或消息 ID 匹配）。`,'note');
 else if(ids.length)paragraph(box,`找到 ${ids.length} 段同来源任务摘录，但记录没有把它们精确对应到某一轮。`,'note');
 else paragraph(box,'此阶段没有可直接定位的已保存摘录；可在对话索引中查看收录范围。','note');
 box.append(button(exact?'查看对应摘录':ids.length?'查看来源任务摘录':'打开对话索引',()=>navigateToConversationIndex(ids.length?ids:null,node?.title||''),exact?'button primary':'button'));
}
function conversationScopeEntries(){
 const scope=Array.isArray(app.conversationScope)?new Set(app.conversationScope):null;
 return (E.conversations||[]).filter(e=>!scope||scope.has(e.id));
}
function conversationMatches(entry,q){
 return !q||[entry.source_title,entry.date,entry.role,entry.task_id,entry.text].join(' ').toLocaleLowerCase().includes(q.toLocaleLowerCase());
}
function conversationGroups(entries){
 const groups=new Map();for(const entry of entries){const key=entry.turn_group_id||entry.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);}
 return [...groups.values()].map(group=>group.sort((a,b)=>(a.line||0)-(b.line||0))).sort((a,b)=>(a[0].line||0)-(b[0].line||0));
}
function renderConversationIndex(root){
 root.replaceChildren();const controls=el('div',undefined,'conversation-controls');
 const task=el('select');task.setAttribute('aria-label','按任务标题筛选');const all=el('option','全部已收录任务');all.value='';task.append(all);
 const entries=conversationScopeEntries(),titles=[...new Set(entries.map(e=>e.source_title).filter(Boolean))];for(const title of titles){const option=el('option',title);option.value=title;task.append(option);}task.value=app.conversationTask||'';
 task.addEventListener('change',()=>{app.conversationTask=task.value;app.listScroll=0;persistState();renderConversationList();});
 const searchInput=el('input');searchInput.type='search';searchInput.placeholder='搜索已保存摘录';searchInput.setAttribute('aria-label','搜索已保存对话摘录');searchInput.value=app.conversationQuery||'';
 searchInput.addEventListener('input',()=>{app.conversationQuery=searchInput.value;app.listScroll=0;persistState();renderConversationList();});
 const reset=button('清除筛选',()=>{app.conversationTask='';app.conversationQuery='';persistState();task.value='';searchInput.value='';renderConversationList();});
 const count=el('span','', 'note');controls.append(task,searchInput,reset,count);root.append(controls);
 const grid=el('div',undefined,'conversation-grid'),list=el('div',undefined,'conversation-list'),detail=el('section',undefined,'conversation-detail');list.id='conversation-list';list.setAttribute('aria-label','按任务和轮次分组的已保存摘录');detail.id='conversation-content';detail.setAttribute('aria-label','摘录与轮次上下文');detail.tabIndex=0;grid.append(list,detail);root.append(grid);
 conversationUI={task,searchInput,count,list,detail};renderConversationList();
}
function renderConversationList(){
 const ui=conversationUI;if(!ui)return;const q=(ui.searchInput?.value||app.conversationQuery||'').trim(),task=ui.task?.value||app.conversationTask||'';
 let entries=conversationScopeEntries().filter(e=>(!task||e.source_title===task)&&conversationMatches(e,q));const groups=conversationGroups(entries);
 ui.list.replaceChildren();ui.count.textContent=`${groups.length} 轮 · ${entries.length} 段已保存摘录`;
 if(!entries.length){ui.detail.replaceChildren(el('p',q?'没有匹配的已保存摘录。':'当前筛选没有可显示的摘录。','notice'));return;}
 const active=entries.some(e=>e.id===app.conversationId)?app.conversationId:entries[0].id;
 for(const group of groups){const current=group.some(e=>e.id===active)?active:group[0].id,entry=conversationEntry(current);const b=button('',()=>navigateToConversationEntry(current),'conversation-result');b.setAttribute('aria-pressed',String(current===app.conversationId));
  const turn=entry.turn_id?`轮次 ${entry.turn_id.slice(0,8)}`:'未标轮次';b.append(el('strong',`${entry.date||'时间未收录'} · ${entry.source_title||'来源任务未命名'} · ${turn}`),el('span',group.map(e=>e.role).join(' + ')+' · '+excerptSummary(entry)));ui.list.append(b);
 }
 renderConversationEntry(ui.detail,active);if(active!==app.conversationId&&app.view==='conversations')ui.detail.setAttribute('data-preview-entry',active);
}
function relatedTurnEntries(entry){
 if(Array.isArray(entry.turn_entry_ids)&&entry.turn_entry_ids.length)return entry.turn_entry_ids.map(conversationEntry).filter(Boolean);
 if(entry.turn_id)return (E.conversations||[]).filter(e=>e.file_id===entry.file_id&&e.task_id===entry.task_id&&e.turn_id===entry.turn_id).sort((a,b)=>(a.line||0)-(b.line||0));
 return [];
}
function neighborEntries(entry){
 if(Array.isArray(entry.context_entry_ids))return entry.context_entry_ids.map(conversationEntry).filter(Boolean);
 const same=(E.conversations||[]).filter(e=>e.file_id===entry.file_id&&e.task_id===entry.task_id).sort((a,b)=>(a.line||0)-(b.line||0)),i=same.findIndex(e=>e.id===entry.id);return [...(i>0?[same[i-1]]:[]),...(i>=0&&i+1<same.length?[same[i+1]]:[])];
}
function renderConversationEntry(root,id){
 root.replaceChildren();const entry=conversationEntry(id);if(!entry){paragraph(root,'找不到这段已保存摘录。','notice');return;}
 const heading=el('h3',`${entry.date||'时间未收录'} · ${entry.role||'角色未注明'}`);root.append(heading);paragraph(root,entry.source_title||'来源任务标题未记录','note');paragraph(root,'以下内容来自已保存摘录，只覆盖当前收录范围；不能据此还原任务完整历史。','locator-help');
 const actions=el('div',undefined,'reading-links');const locator=[entry.source_title,entry.task_id?`任务 ID：${entry.task_id}`:'',entry.turn_id?`轮次 ID：${entry.turn_id}`:'',entry.message_id?`消息 ID：${entry.message_id}`:''].filter(Boolean).join('\n');
 const taskUrl=verifiedHttpsUrl(entry.original_url,entry.original_url_verified);if(taskUrl){const a=el('a','打开原任务','button primary');a.href=taskUrl;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}
 else{actions.append(button('复制人工定位信息',event=>copy(locator||entry.source_title||'未记录的来源任务',event.currentTarget),'button primary'));actions.append(el('span','尚未提供已验证的原任务链接；请在原应用中按标题或任务 ID 查找。','note'));}
 if(entry.file_id&&E.files[entry.file_id])actions.append(button('打开完整摘录文件',()=>openFile(entry.file_id,{from:app,origin:{label:'已保存摘录',view:'conversation-entry',chapter:app.chapter,node:app.node},locator:entry.line?`L${entry.line}`:''}),'button'));
 root.append(actions);
 const turn=relatedTurnEntries(entry);if(turn.length>1){const context=section(root,`同一任务与轮次 · ${turn.length} 段`);for(const part of turn){const card=el('article',undefined,'conversation-turn');card.setAttribute('aria-current',String(part.id===entry.id));card.append(el('h4',`${part.date||'时间未收录'} · ${part.role||'角色未注明'}${part.id===entry.id?' · 当前摘录':''}`));const md=el('div');renderMarkdown(part.text,md,E.files[part.file_id]);card.append(md);context.append(card);}paragraph(context,'本组只包含来源文件中实际收录的消息，不代表该轮对话完整。','note');}
 else {const saved=section(root,'已保存摘录');const article=el('article');renderMarkdown(entry.text,article,E.files[entry.file_id]);saved.append(article);}
 const neighbors=neighborEntries(entry);if(neighbors.length){const context=section(root,'同来源的前后片段');for(const other of neighbors){const row=el('div',undefined,'resource-line');paragraph(row,`${other.date||'时间未收录'} · ${other.role||'角色未注明'} · 第 ${other.line||'?'} 行`,'note');paragraph(row,excerptSummary(other));row.append(button('查看此片段',()=>navigateToConversationEntry(other.id),'link-button'));context.append(row);}paragraph(context,'这些片段按同一摘录文件中的顺序排列；缺少的轮次不会补写。','note');}
 const related=new Set(entry.nodes||[]);if(related.size){const sec=section(root,'关联阶段');for(const item of related){sec.append(button(`查看阶段：${item.title}`,()=>navigateNode(item.node,item.chapter),'link-button'));}}
 const technical=el('details',undefined,'technical-details');technical.append(el('summary','来源定位信息'));paragraph(technical,'任务：'+(entry.task_id||entry.source_locator||'未记录'),'note');if(entry.turn_id)paragraph(technical,'轮次：'+entry.turn_id,'note');if(entry.message_id)paragraph(technical,'消息：'+entry.message_id,'note');if(entry.file_id)paragraph(technical,'摘录文件第 '+(entry.line||'?')+' 行','note');if(entry.coverage)paragraph(technical,'来源覆盖：'+entry.coverage,'note');technical.append(button('复制对话定位',event=>copy(locator,event.currentTarget),'button'));paragraph(technical,'原任务入口只使用数据记录提供且标记已验证的 HTTPS 地址。','note');root.append(technical);if(app.searchQuery)highlightTextMatch(root,app.searchQuery);
}
function setupConversations(){
 $('conversation-open').addEventListener('click',()=>navigateToConversationIndex(null,''));
}
