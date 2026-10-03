"""Index existing conversation excerpts; never invent message links or missing turns."""
import hashlib
import re
from urllib.parse import urlsplit

UUID = r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}'

def verified_original_url(source):
    """Return only source-provided HTTPS task URLs explicitly marked verified."""
    value=source.get('original_url')
    if source.get('original_url_verified') is not True or not isinstance(value,str):
        return ''
    value=value.strip()
    try:
        parsed=urlsplit(value)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password:
            return ''
    except ValueError:
        return ''
    return value
HEADER = re.compile(r'^#{1,2} ([^\n]+)\n+((?:任务：[^\n]+\n+)?任务 ID：('+UUID+r')[^\n]*\n)',re.M)

def excerpts(text, task_id):
    text=text.replace('\r\n','\n')
    starts=list(HEADER.finditer(text))
    result=[]
    for i,match in enumerate(starts):
        if task_id and match[3]!=task_id:continue
        end=starts[i+1].start() if i+1<len(starts) else len(text)
        block=text[match.end():end].strip().removesuffix('---').strip()
        turn=re.search(r'^轮次 ID：([^\n]+)',block,re.M)
        message=re.search(r'^消息 ID：([^\n]+)',block,re.M)
        body=re.sub(r'^(?:轮次|消息) ID：[^\n]+\n?', '',block,flags=re.M).strip()
        date=re.search(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}',match[1])
        common={'task_id':match[3],'date':date[0].replace('T',' ') if date else '',
                'line':text[:match.start()].count('\n')+1}
        summaries=list(re.finditer(r'^- 轮次 ('+UUID+r')：(.+)$',body,re.M))
        if summaries and not turn:
            for row in summaries:
                result.append({**common,'title':match[1],'role':'摘要','turn_id':row[1],
                               'message_id':'','text':row[2],'line':text[:text.index(row[0],match.start(),end)].count('\n')+1})
        else:
            role='用户' if match[1].endswith('· 用户') else '助手' if '助手' in match[1] else '摘要'
            result.append({**common,'title':match[1],'role':role,'turn_id':turn[1] if turn else '',
                           'message_id':message[1] if message else '', 'text':body})
    return result

def build_conversation_index(chapters,files):
    entries={}
    for chapter in chapters:
        sources={s['id']:s for s in chapter['record']['sources']}
        for source in sources.values():
            if source['kind']!='conversation':continue
            file=files.get(source.get('file_id'))
            source['conversation_entry_ids']=[]
            if not file or not isinstance(file.get('text'),str):continue
            task=re.search(UUID,source.get('locator',''))
            parsed=excerpts(file['text'],task[0] if task else '')
            if not parsed and not task:
                parsed=[{'title':source['title'],'role':'记录','date':'','task_id':'','turn_id':'',
                         'message_id':'','text':file['text'],'line':1}]
            for excerpt in parsed:
                identity=file['id']+'|'+excerpt['task_id']+'|'+excerpt['turn_id']+'|'+excerpt['message_id']+'|'+str(excerpt['line'])
                key='conversation_'+hashlib.sha256(identity.encode()).hexdigest()[:18]
                if key not in entries:
                    original_url=verified_original_url(source)
                    entries[key]={**excerpt,'id':key,'source_title':source['title'],'file_id':file['id'],
                                  'source_locator':source['locator'],'coverage':source['coverage'],'nodes':[],
                                  'original_url':original_url,'original_url_verified':bool(original_url)}
                source['conversation_entry_ids'].append(key)
        for node in chapter['record']['nodes']:
            refs=[];available=[]
            for evidence in node['evidence']:
                source=sources[evidence['source']]
                if source['kind']!='conversation':continue
                candidates=source.get('conversation_entry_ids',[])
                available.extend(candidates)
                for key in candidates:
                    entry=entries[key]
                    if any(value and value in evidence['locator'] for value in [entry['turn_id'],entry['message_id']]):refs.append(key)
            node['conversation_entry_ids']=list(dict.fromkeys(refs))
            node['conversation_source_entry_ids']=list(dict.fromkeys(available))
            for key in node['conversation_entry_ids']:
                entries[key]['nodes'].append({'chapter':chapter['id'],'node':node['id'],'title':node['title']})
    by_source_task={}
    by_turn={}
    for entry in entries.values():
        task_key=(entry['file_id'],entry.get('task_id') or entry.get('source_locator',''))
        by_source_task.setdefault(task_key,[]).append(entry)
        if entry.get('turn_id'):
            by_turn.setdefault((*task_key,entry['turn_id']),[]).append(entry)
    for key,group in by_turn.items():
        group.sort(key=lambda entry:(entry.get('line') or 0,entry['id']))
        digest=hashlib.sha256('|'.join(str(value) for value in key).encode()).hexdigest()[:18]
        ids=[entry['id'] for entry in group]
        for entry in group:
            entry['turn_group_id']='turn_'+digest
            entry['turn_entry_ids']=ids
    for group in by_source_task.values():
        group.sort(key=lambda entry:(entry.get('line') or 0,entry['id']))
        for index,entry in enumerate(group):
            neighbors=[]
            if index:neighbors.append(group[index-1]['id'])
            if index+1<len(group):neighbors.append(group[index+1]['id'])
            entry['context_entry_ids']=neighbors
    return list(entries.values())
