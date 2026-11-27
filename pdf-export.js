// Local PDF export: no CDN, server or external PDF library is required.
const encoder=new TextEncoder();
const bytes=text=>encoder.encode(text);
const A4=[595.28,841.89];
const RESOLUTION=3;

function wrapText(ctx,text,maxWidth){
  const lines=[];
  let line='';
  for(const word of String(text).trim().split(/\s+/)){
    if(!word)continue;
    const candidate=line?`${line} ${word}`:word;
    if(ctx.measureText(candidate).width<=maxWidth){line=candidate;continue;}
    if(line){lines.push(line);line='';}
    for(const char of word){
      if(line&&ctx.measureText(line+char).width>maxWidth){lines.push(line);line='';}
      line+=char;
    }
  }
  if(line)lines.push(line);
  return lines;
}

async function loadTreeImage(svg){
  const xml=new XMLSerializer().serializeToString(svg);
  const url=URL.createObjectURL(new Blob([xml],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const image=new Image();
    await new Promise((resolve,reject)=>{
      image.onload=resolve;
      image.onerror=()=>reject(Error('Could not render a tree for the PDF.'));
      image.src=url;
    });
    return image;
  }finally{
    URL.revokeObjectURL(url);
  }
}

async function makePage(entry,options,index,total){
  const svg=options.renderTree(entry);
  const [, , treeW,treeH]=svg.getAttribute('viewBox').split(/\s+/).map(Number);
  if(!(treeW>0&&treeH>0&&Number.isFinite(treeW)&&Number.isFinite(treeH)))
    throw Error('Invalid tree dimensions.');
  const [w,h]=treeW/treeH>1.15?[A4[1],A4[0]]:A4;
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(w*RESOLUTION);
  canvas.height=Math.round(h*RESOLUTION);
  try{
    const ctx=canvas.getContext('2d');
    if(!ctx)throw Error('PDF canvas is unavailable.');
    ctx.scale(canvas.width/w,canvas.height/h);
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,w,h);
    const margin=32,usable=w-2*margin;
    let y=margin;
    const paragraph=(text,font,color,lineHeight,after=0)=>{
      if(!text)return;
      ctx.font=font;ctx.fillStyle=color;ctx.textBaseline='top';
      for(const line of wrapText(ctx,text,usable)){
        ctx.fillText(line,margin,y);y+=lineHeight;
      }
      y+=after;
    };
    paragraph(options.title,'bold 19px Arial, sans-serif','#263027',23,8);
    if(options.identity.name)paragraph(`Name: ${options.identity.name}`,'12px Arial, sans-serif','#333333',15);
    if(options.identity.studentId)paragraph(`Student ID: ${options.identity.studentId}`,'12px Arial, sans-serif','#333333',15);
    if(options.practice){
      y+=10;
      paragraph(`Exercise ${entry.label}`,'bold 14px Arial, sans-serif','#263027',18,3);
      paragraph(entry.sentence,'12px Arial, sans-serif','#333333',15,5);
    }
    y+=9;
    ctx.strokeStyle='#d4d9d1';ctx.lineWidth=0.7;
    ctx.beginPath();ctx.moveTo(margin,y);ctx.lineTo(w-margin,y);ctx.stroke();
    y+=12;
    const availableH=h-y-margin-17;
    if(availableH<35)throw Error(`The header is too long for exercise ${entry.label||'1'}.`);
    const scale=Math.min(usable/treeW,availableH/treeH,1.4);
    const dw=treeW*scale,dh=treeH*scale;
    const image=await loadTreeImage(svg);
    ctx.drawImage(image,(w-dw)/2,y,dw,dh);
    ctx.font='10px Arial, sans-serif';ctx.fillStyle='#666666';
    ctx.textBaseline='bottom';ctx.textAlign='right';
    ctx.fillText(`${index+1} / ${total}`,w-margin,h-22);
    const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.96));
    if(!jpeg||jpeg.type!=='image/jpeg')throw Error('Could not encode a PDF page.');
    return {w,h,pixelW:canvas.width,pixelH:canvas.height,image:new Uint8Array(await jpeg.arrayBuffer())};
  }finally{
    canvas.width=0;canvas.height=0;
  }
}

// PDF 1.4 writer: catalog, page tree, and one JPEG image per page.
// Count byte offsets, rather than JavaScript string lengths, for the xref table.
export async function buildTreePDF(options){
  const total=options.entries.length;
  if(!total)throw Error('There are no trees to export.');
  const chunks=[],offsets=[0];
  let size=0;
  const push=value=>{
    const part=typeof value==='string'?bytes(value):value;
    chunks.push(part);size+=part.length;
  };
  const object=(id,body)=>{
    offsets[id]=size;push(`${id} 0 obj\n`);push(body);push('\nendobj\n');
  };
  const stream=(id,dict,data)=>{
    offsets[id]=size;
    push(`${id} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`);
    push(data);push('\nendstream\nendobj\n');
  };
  push('%PDF-1.4\n');push(new Uint8Array([37,226,227,207,211,10]));
  object(1,'<< /Type /Catalog /Pages 2 0 R >>');
  const kids=Array.from({length:total},(_,i)=>`${3+i*3} 0 R`).join(' ');
  object(2,`<< /Type /Pages /Count ${total} /Kids [${kids}] >>`);
  for(let i=0;i<total;i++){
    options.onProgress?.(i,total);
    const page=await makePage(options.entries[i],options,i,total);
    const pageId=3+i*3,imageId=pageId+1,contentId=pageId+2;
    const {w,h,pixelW,pixelH,image}=page;
    object(pageId,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    stream(imageId,`/Type /XObject /Subtype /Image /Width ${pixelW} /Height ${pixelH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,image);
    stream(contentId,'',bytes(`q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`));
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  options.onProgress?.(total,total);
  const xref=size,count=3+3*total;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for(let id=1;id<count;id++)push(`${String(offsets[id]).padStart(10,'0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks,{type:'application/pdf'});
}
