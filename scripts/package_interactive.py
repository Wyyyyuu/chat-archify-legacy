#!/usr/bin/env python3
"""Combine checked Archify viewers, evolution records and local attachments offline."""
import argparse
import base64
import copy
import hashlib
import html
import json
import mimetypes
import re
import shutil
from collections import Counter
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlsplit
from html.parser import HTMLParser
from render import validate
from check_routes import audit_file
from conversation_index import build_conversation_index


def encode(data):
    return base64.b64encode(data).decode('ascii')


def local_path(uri, base):
    if re.match(r'^[A-Za-z]:[\\/]', uri):
        return Path(uri).resolve()
    parsed=urlsplit(uri)
    if parsed.scheme=='file':
        raw=unquote(parsed.path)
        if re.match(r'^/[A-Za-z]:/',raw):raw=raw[1:]
        return Path(raw).resolve()
    if parsed.scheme or uri.startswith('#'):return None
    return (base/uri).resolve()


class ViewerTopologyParser(HTMLParser):
    """Read public SVG data attributes without depending on Archify node IDs."""
    def __init__(self):
        super().__init__()
        self.nodes={}
        self.edges=[]

    def handle_starttag(self,tag,attributes):
        attrs=dict(attributes)
        if tag=='g' and attrs.get('data-node-id'):
            node_id=attrs['data-node-id']
            if node_id in self.nodes:
                raise ValueError(f'Duplicate Archify node ID: {node_id}')
            self.nodes[node_id]=attrs.get('data-node-label','')
        if tag=='path' and 'data-edge-from' in attrs:
            self.edges.append((attrs.get('data-edge-from',''),attrs.get('data-edge-to','')))


def validate_viewer_relationships(record,viewer_bytes,chapter_id):
    """Require matching node IDs and directed edge multiplicities.

    Interactive node selection is bridged by data-node-id, so the record and
    viewer must use the same IDs. Edges are compared by endpoint pairs rather
    than renderer-specific edge IDs.
    """
    parser=ViewerTopologyParser()
    parser.feed(viewer_bytes.decode('utf-8'))
    record_nodes=record.get('nodes',[])
    if not record_nodes:
        raise ValueError(f'Chapter {chapter_id}: record has no nodes')
    if not parser.nodes:
        raise ValueError(f'Chapter {chapter_id}: viewer has no Archify nodes')
    record_ids={node['id'] for node in record_nodes}
    viewer_ids=set(parser.nodes)
    if viewer_ids!=record_ids:
        raise ValueError(f'Chapter {chapter_id}: viewer/record node IDs differ; missing={sorted(record_ids-viewer_ids)}, extra={sorted(viewer_ids-record_ids)}')
    viewer_edges=Counter()
    for source,target in parser.edges:
        if source not in record_ids or target not in record_ids:
            raise ValueError(f'Chapter {chapter_id}: viewer edge has an unknown endpoint ({source} -> {target})')
        viewer_edges[(source,target)]+=1
    record_edges=Counter((edge['from'],edge['to']) for edge in record.get('edges',[]))
    if viewer_edges!=record_edges:
        missing=record_edges-viewer_edges
        extra=viewer_edges-record_edges
        raise ValueError(f'Chapter {chapter_id}: viewer/record directed edge mismatch; missing={dict(missing)}, extra={dict(extra)}')
    return {'node_ids':len(record_ids),'edge_count':sum(record_edges.values())}


def package(manifest_path, output, snapshot_from=None):
    manifest_path,output=Path(manifest_path).resolve(),Path(output).resolve()
    manifest=json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    base=manifest_path.parent
    chapters=manifest['chapters']
    assert chapters and len({c['id'] for c in chapters})==len(chapters)
    pool={}; reports=[]; aliases={}; snapshots={}
    if snapshot_from:
        prior=Path(snapshot_from).read_text(encoding='utf-8')
        payload_match=re.search(r'<script type="application/json" id="explorer-data">(.*?)</script>',prior,re.S)
        assert payload_match, 'Snapshot source does not contain explorer-data'
        snapshots={f['path']:f for f in json.loads(payload_match[1])['files'].values()}
    for ch in chapters:
        record=(base/ch['record']).resolve()
        aliases[str(record.parent/'evolution.html')]=ch['id']
        for alias in ch.get('aliases',[]):aliases[str((base/alias).resolve())]=ch['id']

    def attach(item, record_base):
        uri=item.get('uri','')
        if not uri:return
        path=local_path(uri,record_base)
        if path is None:return
        if str(path) in aliases:
            item['chapter_id']=aliases[str(path)]
            return
        key='file_'+hashlib.sha256(str(path).encode()).hexdigest()[:20]
        item['file_id']=key
        if key in pool:return
        file={'id':key,'path':str(path),'name':path.name,'status':'missing'}
        pool[key]=file
        if str(path) in snapshots:
            preserved=copy.deepcopy(snapshots[str(path)])
            if preserved['status']=='embedded':
                raw_snapshot=base64.b64decode(preserved['data'],validate=True)
                assert hashlib.sha256(raw_snapshot).hexdigest()==preserved['sha256']
                assert len(raw_snapshot)==preserved['bytes']
            preserved['id']=key
            pool[key]=preserved
            return
        if snapshot_from:
            raise ValueError(f'No prior snapshot for {path}; explicitly refresh sources to add files')
        if not path.exists():return
        if path.name.lower().startswith('.env') or path.suffix.lower() in {'.pem','.key','.p12','.pfx'}:
            file.update(status='excluded',note='该文件属于凭据类型，仅保留原始位置。');return
        if path.is_dir():
            paths=sorted(str(p.relative_to(path)).replace('\\','/') for p in path.rglob('*') if p.is_file())
            raw=('目录索引（不包含目录内文件内容）\n原始位置：'+str(path)+'\n\n'+'\n'.join(paths)+'\n').encode('utf-8')
            file.update(name=path.name+'-目录索引.txt',mime='text/plain',is_directory=True)
        else:
            raw=path.read_bytes()
            file['mime']=mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        if len(raw)>25*1024*1024:
            file.update(status='excluded',note='单文件超过25 MB，保留原始位置。');return
        if not file['mime'].startswith('image/'):
            try:
                text=raw.decode('utf-8-sig')
            except UnicodeDecodeError:
                text=None
            if text is not None:
                secret=re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}',text)
                if secret:
                    file.update(status='excluded',note='检测到可能的凭据内容，仅保留原始位置。');return
                file['text']=text
        file.update(status='embedded',data=encode(raw),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())

    packed=[]
    for ch in chapters:
        record=(base/ch['record']).resolve(); viewer=(base/ch['viewer']).resolve()
        raw=json.loads(record.read_text(encoding='utf-8-sig'))
        data=validate(copy.deepcopy(raw),record.parent,output.parent)
        viewer_bytes=viewer.read_bytes()
        geometry=audit_file(viewer)
        assert geometry['conflicting_pair_count']==geometry['node_crossing_count']==0, geometry
        topology=validate_viewer_relationships(data,viewer_bytes,ch['id'])
        for item in data['sources']+[a for n in data['nodes'] for a in n['artifacts']]:attach(item,record.parent)
        for n in data['nodes']:
            n['search_text']=' '.join(str(x) for x in [n['title'],n['summary'],n.get('reason',''),n['branch'],*[a['label'] for a in n['artifacts']]]).lower()
        digest=hashlib.sha256(viewer_bytes).hexdigest()
        packed.append({'id':ch['id'],'label':ch['label'],'record':data,'viewer':encode(viewer_bytes),'viewer_sha256':digest})
        reports.append({'chapter':ch['id'],'nodes':len(data['nodes']),'edges':len(data['edges']),'viewer_sha256':digest,'record_viewer_topology':topology,'all_pair_route_audit':geometry})
    payload={'title':manifest['title'],'chapters':packed,'files':pool,'conversations':build_conversation_index(packed,pool),'created_at':datetime.now().isoformat(timespec='seconds')}
    source=Path(__file__).resolve().parent.parent
    template=(source/'assets/interactive.html').read_text(encoding='utf-8')
    script='\n;\n'.join((source/name).read_text(encoding='utf-8') for name in ['assets/vendor/marked.umd.js','assets/markdown.js','assets/conversations.js','assets/interactive.js'])
    assert not re.search(r'</script',script,re.I), 'Inline script contains a closing script tag'
    serialized=json.dumps(payload,ensure_ascii=False).replace('&','\\u0026').replace('<','\\u003c').replace('>','\\u003e')
    replacements={'@@TITLE@@':html.escape(manifest['title']),'@@PAYLOAD@@':serialized,'@@SCRIPT@@':script}
    page=re.sub(r'@@(?:TITLE|PAYLOAD|SCRIPT)@@',lambda m:replacements[m[0]],template)
    output.parent.mkdir(parents=True,exist_ok=True)
    if output.exists():
        backup=output.parent/'history'/datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        backup.mkdir(parents=True);shutil.copy2(output,backup/output.name)
    output.write_text(page,encoding='utf-8')
    report={'output':str(output),'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'chapters':reports,'files':[{'id':f['id'],'path':f['path'],'status':f['status'],'bytes':f.get('bytes'), 'sha256':f.get('sha256')} for f in pool.values()]}
    (output.parent/'package-receipt.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'chapters':len(packed),'attachments':len(pool),'embedded':sum(f['status']=='embedded' for f in pool.values()),'size_mb':round(output.stat().st_size/1024**2,2)},ensure_ascii=False))
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest');parser.add_argument('output')
    parser.add_argument('--snapshot-from',help='Reuse exact attachments from an existing interactive HTML')
    args=parser.parse_args();package(args.manifest,args.output,args.snapshot_from)
