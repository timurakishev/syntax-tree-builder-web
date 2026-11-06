const decoder = new TextDecoder();
const MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const OFFICE='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG='http://schemas.openxmlformats.org/package/2006/relationships';

function parseXml(xml){
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.getElementsByTagName('parsererror').length) throw Error('This is not a readable standard .xlsx worksheet.');
  return doc;
}
function elements(parent,ns,name){return [...parent.getElementsByTagNameNS(ns,name)];}
function first(parent,ns,name){return elements(parent,ns,name)[0]??null;}
function textNodes(parent){return elements(parent,MAIN,'t').map(el=>el.textContent??'').join('');}

async function unzipXlsx(buffer){
  const data=new Uint8Array(buffer),view=new DataView(buffer);
  let eocd=-1;
  for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--){
    if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}
  }
  if(eocd<0) throw Error('This is not a readable standard .xlsx worksheet.');
  const entries=new Map();
  let pos=view.getUint32(eocd+16,true);
  const count=view.getUint16(eocd+10,true);
  for(let n=0;n<count;n++){
    if(view.getUint32(pos,true)!==0x02014b50) throw Error('The Excel file has an invalid ZIP directory.');
    const method=view.getUint16(pos+10,true);
    const size=view.getUint32(pos+20,true);
    const nameLength=view.getUint16(pos+28,true);
    const extraLength=view.getUint16(pos+30,true);
    const commentLength=view.getUint16(pos+32,true);
    const offset=view.getUint32(pos+42,true);
    const name=decoder.decode(data.subarray(pos+46,pos+46+nameLength));
    entries.set(name,{method,size,offset});
    pos+=46+nameLength+extraLength+commentLength;
  }
  async function read(name){
    const ent=entries.get(name);
    if(!ent) throw Error('Missing Excel workbook component: '+name);
    const pos=ent.offset;
    if(view.getUint32(pos,true)!==0x04034b50) throw Error('The Excel file contains an invalid ZIP entry.');
    const length=view.getUint16(pos+26,true), extra=view.getUint16(pos+28,true);
    const start=pos+30+length+extra;
    const source=data.slice(start,start+ent.size);
    if(ent.method===0) return decoder.decode(source);
    if(ent.method===8){
      if(typeof DecompressionStream==='undefined') throw Error('This browser does not support Excel decompression. Try a current version of Chrome, Edge, Firefox or Safari.');
      try {
        const stream=new Blob([source]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return decoder.decode(await new Response(stream).arrayBuffer());
      }catch(error){throw Error('Could not decompress the Excel worksheet: '+error.message);}
    }
    throw Error('This Excel file uses an unsupported ZIP compression method.');
  }
  return {read,has:name=>entries.has(name)};
}

export async function readExercisesXlsx(file){
  if(!/\.xlsx$/i.test(file.name)) throw Error('Choose an Excel workbook with the .xlsx extension.');
  let zip;
  try{zip=await unzipXlsx(await file.arrayBuffer());}
  catch(err){throw Error(err.message||'This is not a readable standard .xlsx worksheet.');}
  const workbook=parseXml(await zip.read('xl/workbook.xml'));
  const rels=parseXml(await zip.read('xl/_rels/workbook.xml.rels'));
  const sheet=first(workbook,MAIN,'sheet');
  if(!sheet) throw Error('This workbook has no worksheets.');
  const relId=sheet.getAttributeNS(OFFICE,'id');
  const relation=elements(rels,PKG,'Relationship').find(r=>r.getAttribute('Id')===relId);
  if(!relation) throw Error('Cannot locate the first worksheet in this Excel file.');
  let target=relation.getAttribute('Target')||'';
  let member=target.startsWith('/')?target.slice(1):'xl/'+target;
  const parts=[];
  for(const part of member.split('/')){
    if(part==='..') parts.pop(); else if(part&&part!=='.') parts.push(part);
  }
  member=parts.join('/');
  if(!member.startsWith('xl/worksheets/')) throw Error('The first worksheet could not be read.');
  const sheetDoc=parseXml(await zip.read(member));
  let strings=[];
  if(zip.has('xl/sharedStrings.xml')){
    const shared=parseXml(await zip.read('xl/sharedStrings.xml'));
    strings=elements(shared,MAIN,'si').map(textNodes);
  }
  const column=[];
  for(const row of elements(sheetDoc,MAIN,'row')){
    const cell=[...row.children].find(c=>c.localName==='c' && /^A\d+$/.test(c.getAttribute('r')||''));
    if(!cell) continue;
    if(first(cell,MAIN,'f')) throw Error('Formulas are not accepted in the Text column. Enter the exercise as ordinary text.');
    const kind=cell.getAttribute('t')||'';
    let text='';
    if(kind==='inlineStr') text=textNodes(cell);
    else {
      const v=first(cell,MAIN,'v')?.textContent??'';
      if(kind==='s'){
        const i=Number(v);
        if(!Number.isInteger(i)||i<0||i>=strings.length) throw Error('This is not a readable standard .xlsx worksheet.');
        text=strings[i];
      } else if(kind==='e') throw Error('An Excel error appears in the Text column: '+v);
      else text=v;
    }
    column.push(text.trim());
  }
  const headings=new Set(['text','sentence','phrase','sentence or phrase','sentence / phrase','exercise','example']);
  if(!column.length||!headings.has(column[0].toLowerCase()))
    throw Error('Use "Text" as the heading in cell A1; put one sentence or phrase per row in column A.');
  const exercises=column.slice(1).filter(Boolean);
  if(!exercises.length) throw Error('The worksheet contains no exercises. Add text in A2, A3, and so on.');
  if(exercises.length>200) throw Error('A worksheet can contain at most 200 exercises.');
  if(exercises.some(s=>s.length>600)) throw Error('Each exercise must be at most 600 characters long.');
  return exercises;
}
