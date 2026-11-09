import {
  LABEL_GROUPS, PHRASES, isPhrase, isProjection, isHead, makeNode, normalizeNode,
  clone, walk, findNode, findParent, usedWordIndices, tokenize, allowedLabels,
  validateBank, readProgress, duplicateSuffix, uid
} from './model.js';
import {readExercisesXlsx} from './xlsx.js';

const $=id=>document.getElementById(id);
const NS='http://www.w3.org/2000/svg';
const BG='#ffffff', INK='#14233e', EDGE='#53647c';
const TOP=95, SIDE=105, V_GAP=124, H_GAP=24;
const iconPaths={
  branches:'<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v3a6 6 0 0 0 6 6v1M18 7v3a6 6 0 0 1-6 6"/>',
  label:'<path d="M4 20l4.5-1L20 7a2.12 2.12 0 0 0-3-3L5 16zM15 6l3 3"/>',
  word:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M12 9v7M9 16h6"/>',
  comment:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5A8.5 8.5 0 1 1 21 11.5z"/>',
  delete:'<path d="M3 6h18M8 6V4h8v2M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  reset:'<path d="M3 11a9 9 0 1 1 2.5 6.2M3 4v7h7"/>'
};
const TOOL_CONFIG=[
  ['branches','Add branches'],['label','Change label'],['word','Attach/Edit word'],
  ['comment','Add comment'],['delete','Delete subtree'],['reset','Reset tree']
];
const toolButtons={};
let mode='free';
let root=makeNode('?'), freeTree=clone(root), freeWords=[];
let selectedUid=null, undoStack=[], redoStack=[];
let lastTouchNode=null, lastTouchTime=0, lastTouchOpenTime=0;
let bankName='No worksheet imported', sentences=[], exerciseIds=[], originalCount=0;
let currentIndex=0, workingTrees={}, workHandle=null, workFilename=null;
let zoom=1, leftCollapsed=false,rightCollapsed=false, floatingVisible=true;
let floatingPosition=null, toastTimer=null;
let sceneWidth=900,sceneHeight=580;
let scrollReset=false, menuOpen=false;
const textCanvas=document.createElement('canvas'), textCtx=textCanvas.getContext('2d');

function words(){return mode==='free'?freeWords:(sentences.length?tokenize(sentences[currentIndex]):[]);}
const ready=()=>mode==='free'||(mode==='practice'&&sentences.length>0);
const currentNode=()=>selectedUid?findNode(root,selectedUid):null;
const used=()=>usedWordIndices(root);
const heading=x=>x==='EMPTY'?'Empty':x;
const textWidth=(str,font='20px Georgia')=>{textCtx.font=font;return textCtx.measureText(String(str)).width;};

function showToast(message){
  const box=$('toast');box.textContent=message;box.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.classList.remove('show'),3700);
}
function setInfo(text){$('bottomInfo').textContent=text;}
function downloadFile(name,content,type){
  const blob=content instanceof Blob?content:new Blob([content],{type});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1800);
}

function closeMenu(){
  for(const id of ['contextMenu','subMenu']){const menu=$(id);menu.hidden=true;menu.replaceChildren();}
  menuOpen=false;
}
function showSubmenu(anchor,items){
  const menu=$('subMenu');menu.replaceChildren();
  for(const item of items){
    const b=document.createElement('button');b.type='button';b.textContent=item.label;
    b.onclick=()=>{closeMenu();item.action?.();};menu.append(b);
  }
  menu.hidden=false;
  const rect=anchor.getBoundingClientRect();
  const x=rect.right+6+menu.offsetWidth<=innerWidth?rect.right+6:rect.left-menu.offsetWidth-6;
  menu.style.left=Math.max(8,x)+'px';
  menu.style.top=Math.max(8,Math.min(rect.top,innerHeight-menu.offsetHeight-8))+'px';
}
function showMenu(anchor,items){
  closeMenu();const menu=$('contextMenu');
  for(const item of items){
    if(item.separator){menu.append(document.createElement('hr'));continue;}
    if(item.group){const heading=document.createElement('div');heading.className='group-label';heading.textContent=item.group;menu.append(heading);}
    if(item.labels){
      const grid=document.createElement('div');grid.className='menu-grid';
      for(const [text,value] of item.labels){
        const b=document.createElement('button');b.type='button';b.textContent=text;
        b.addEventListener('click',()=>{closeMenu();item.choose(value);});grid.append(b);
      }menu.append(grid);continue;
    }
    if(!item.label) continue;
    const b=document.createElement('button');b.type='button';
    if(item.submenu){
      b.className='has-submenu';
      const caption=document.createElement('span');caption.textContent=item.label;
      const chevron=document.createElement('span');chevron.textContent='▶';
      b.append(caption,chevron);
      b.addEventListener('mouseenter',()=>showSubmenu(b,item.submenu));
      b.addEventListener('click',()=>showSubmenu(b,item.submenu));
    }else{
      b.textContent=item.label;
      b.addEventListener('mouseenter',()=>{$('subMenu').hidden=true;});
      b.addEventListener('click',()=>{closeMenu();item.action?.();});
    }
    if(item.disabled)b.disabled=true;
    menu.append(b);
  }
  if(!menu.children.length)return;
  menu.hidden=false;menuOpen=true;
  const pos=anchor?.getBoundingClientRect?.();
  const x=typeof anchor?.clientX==='number'?anchor.clientX:pos?.left??40;
  const y=typeof anchor?.clientY==='number'?anchor.clientY:(pos?.bottom??70)+4;
  menu.style.left=Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-8))+'px';
  menu.style.top=Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-8))+'px';
}
function showDialog(title,buildButtons){
  closeMenu();const overlay=$('overlay');overlay.classList.add('show');overlay.setAttribute('aria-hidden','false');
  $('dialogTitle').textContent=title;$('dialogBody').replaceChildren();$('dialogFooter').replaceChildren();
  $('closeDialog').onclick=()=>closeDialog();
  return buildButtons($('dialogBody'),$('dialogFooter'));
}
function closeDialog(){
  $('overlay').classList.remove('show');$('overlay').setAttribute('aria-hidden','true');
  $('dialogBody').replaceChildren();$('dialogFooter').replaceChildren();
}
function addDialogButton(footer,label,callback,primary=false){
  const b=document.createElement('button');b.type='button';b.textContent=label;
  if(primary)b.classList.add('primary');b.addEventListener('click',callback);footer.append(b);return b;
}
function alertDialog(title,message){
  return new Promise(resolve=>showDialog(title,(body,footer)=>{
    const p=document.createElement('p');p.textContent=message;body.append(p);
    addDialogButton(footer,'OK',()=>{closeDialog();resolve();},true);
    $('closeDialog').onclick=()=>{closeDialog();resolve();};
  }));
}
function confirmDialog(title,message){
  return new Promise(resolve=>showDialog(title,(body,footer)=>{
    const p=document.createElement('p');p.textContent=message;body.append(p);
    addDialogButton(footer,'No',()=>{closeDialog();resolve(false);});
    addDialogButton(footer,'Yes',()=>{closeDialog();resolve(true);},true);
    $('closeDialog').onclick=()=>{closeDialog();resolve(false);};
  }));
}
function inputDialog(title,prompt,value='',opts={}){
  return new Promise(resolve=>showDialog(title,(body,footer)=>{
    const label=document.createElement('div');label.className='field-label';label.textContent=prompt;body.append(label);
    const field=document.createElement(opts.multiline?'textarea':'input');
    if(!opts.multiline){field.type='text';field.autocomplete='off';}
    field.value=value;field.spellcheck=false;body.append(field);
    if(opts.multiline){
      const count=document.createElement('div');count.className='count';body.append(count);
      const update=()=>count.textContent=`${field.value.length} / 800 characters`;
      field.addEventListener('input',update);update();
    }
    const finish=ok=>{const result=field.value;closeDialog();resolve({ok,value:result});};
    addDialogButton(footer,'Cancel',()=>finish(false));addDialogButton(footer,'OK',()=>finish(true),true);
    $('closeDialog').onclick=()=>finish(false);
    field.addEventListener('keydown',e=>{if(e.key==='Enter'&&!opts.multiline){e.preventDefault();finish(true);}});
    requestAnimationFrame(()=>{field.focus();if(!opts.multiline)field.select();});
  }));
}
function choiceDialog(title,prompt,options,selectedIndex=0){
  return new Promise(resolve=>showDialog(title,(body,footer)=>{
    const label=document.createElement('div');label.className='field-label';label.textContent=prompt;body.append(label);
    const select=document.createElement('select');
    options.forEach((item,i)=>{const opt=document.createElement('option');opt.value=String(i);opt.textContent=item;select.append(opt);});
    select.selectedIndex=Math.max(0,selectedIndex);body.append(select);
    const finish=ok=>{const index=select.selectedIndex;closeDialog();resolve(ok?index:null);};
    addDialogButton(footer,'Cancel',()=>finish(false));addDialogButton(footer,'OK',()=>finish(true),true);
    $('closeDialog').onclick=()=>finish(false);
    requestAnimationFrame(()=>select.focus());
  }));
}
function showAbout(){
  alertDialog('About Syntax Tree Builder',
    'Syntax Tree Builder\n\nDeveloped by Timur Akishev (KIMEP University), 2026\nFree for educational, non-commercial use.\n\nThis is an initial test build, not a final release.\n\nContact: t.akishev@kimep.kz');
}
function icon(name,color='#2A3B56'){
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name]}</svg>`;
}
function initTools(){
  for(const [name,title] of TOOL_CONFIG){
    const b=document.createElement('button');b.type='button';b.className='tool'+(name==='branches'?' primary-soft':'');
    b.innerHTML=`<span class="tool-icon">${icon(name,name==='branches'?'#1554BF':'#2A3B56')}</span><span>${title}</span>`;
    b.id='tool-'+name;b.onclick=()=>runTool(name,b);$('sidebarTools').append(b);
    const floating=document.createElement('button');floating.type='button';floating.className='float-btn';
    floating.title=title;floating.setAttribute('aria-label',title);floating.innerHTML=icon(name,name==='branches'?'#1554BF':'#2A3B56');
    floating.onclick=()=>runTool(name,floating);$('floatingButtons').append(floating);
    toolButtons[name]={b,floating};
  }
}

function enabled(name){
  const editable=ready(),node=currentNode();
  if(name==='comment'||name==='reset')return editable;
  if(!editable||!node)return false;
  if(name==='label')return true;
  if(name==='delete')return node.uid!==root.uid;
  if(name==='branches')return node.word_index===null&&node.triangle_text===null&&
    node.children.length<(isPhrase(node.label)?3:2)&&node.label!=='?'&&node.label!=='EMPTY'&&
    (isPhrase(node.label)||isProjection(node.label));
  if(name==='word')return !node.children.length&&(
    node.triangle_text!==null || (node.uid!==root.uid&&!isPhrase(node.label)&&!isProjection(node.label)&&node.label!=='?' &&
    (mode==='free'||node.word_index!==null||new Set(used()).size<words().length)));
  return false;
}
function updateControls(){
  const node=currentNode();
  for(const [name,obj] of Object.entries(toolButtons)){
    const on=enabled(name);obj.b.disabled=!on;obj.floating.disabled=!on;
  }
  $('undoBtn').disabled=!ready()||!undoStack.length;
  $('redoBtn').disabled=!ready()||!redoStack.length;
  $('openBtn').disabled=mode!=='practice';
  $('saveBtn').disabled=mode!=='practice'||!sentences.length;
  $('pngBtn').disabled=!ready();
  $('prevBtn').disabled=mode!=='practice'||!sentences.length||currentIndex<=0;
  $('nextBtn').disabled=mode!=='practice'||!sentences.length||currentIndex>=sentences.length-1;
  $('duplicateBtn').disabled=mode!=='practice'||!sentences.length||sentences.length>=1000;
  if(!node){$('selectionText').textContent='Click a node to select it';return;}
  let hint;
  if(node.triangle_text!==null)hint='Click Attach/Edit word to edit or remove triangle';
  else if(enabled('branches'))hint=node.children.length?'Add another daughter if needed':'Click Add branches to expand';
  else hint='Double-click to change label';
  $('selectionText').textContent=`Selected: ${heading(node.label)}   ·   ${hint}`;
}
function selectNode(id){if(id&&!findNode(root,id))return;selectedUid=id;updateSelection();updateControls();}
function updateSelection(){
  document.querySelectorAll('.tree-node').forEach(g=>{
    const on=g.dataset.uid===selectedUid;g.classList.toggle('selected',on);
    const rect=g.querySelector('.selection-frame');if(rect)rect.setAttribute('visibility',on?'visible':'hidden');
  });
}
function checkpoint(){undoStack.push(clone(root));if(undoStack.length>80)undoStack.shift();redoStack=[];}
function afterEdit(){
  if(mode==='free')freeTree=clone(root);
  else if(sentences.length)workingTrees[currentIndex]=clone(root);
  render();
}
function undo(){if(!undoStack.length)return;redoStack.push(clone(root));root=normalizeNode(undoStack.pop());if(selectedUid&&!findNode(root,selectedUid))selectedUid=null;afterEdit();}
function redo(){if(!redoStack.length)return;undoStack.push(clone(root));root=normalizeNode(redoStack.pop());if(selectedUid&&!findNode(root,selectedUid))selectedUid=null;afterEdit();}

function addBranches(anchor){
  const node=currentNode();if(!node||!enabled('branches'))return;
  const max=isPhrase(node.label)?3:2,room=max-node.children.length;
  const choices=[];
  for(let count=1;count<=room;count++){
    const label=node.children.length+count===3&&node.label!=='TP'
      ?`Add ${count} · coordination only`
      :`Add ${count} daughter${count!==1?'s':''}`;
    choices.push({label,action:()=>{
      checkpoint();node.children.push(...Array.from({length:count},()=>makeNode('?')));afterEdit();
    }});
  }
  if(isPhrase(node.label)&&!node.children.length){
    choices.push({separator:true});
    choices.push({label:'Add triangle',action:()=>editTriangle()});
  }
  showMenu(anchor,choices);
}
function changeLabel(anchor){
  const node=currentNode();if(!node||!ready())return;
  const allowed=new Set(allowedLabels(root,node));
  const items=[];
  for(const [group,labels] of Object.entries(LABEL_GROUPS)){
    const options=labels.filter(l=>allowed.has(l));
    if(!options.length)continue;
    items.push({label:group,submenu:options.map(value=>({label:heading(value),action:()=>{
      if(node.label===value)return;
      checkpoint();node.label=value;afterEdit();
    }}))});
  }
  showMenu(anchor??$('tool-label'),items);
}
async function editTriangle(){
  const node=currentNode();
  if(!node||!isPhrase(node.label)||node.label==='EMPTY'||node.children.length||node.word_index!==null)return;
  if(node.triangle_text!==null){
    const {ok,value}=await inputDialog('Edit triangle text','Edit text (leave empty to remove triangle):',node.triangle_text);
    if(!ok)return;
    let phrase=value.trim();
    if(!phrase){
      checkpoint();node.triangle_text=null;node.triangle_indices=[];afterEdit();return;
    }
    if(phrase.length>300||phrase.includes('\n')){
      await alertDialog('Triangle text','Enter no more than 300 characters on one line.');return;
    }
    let indices=[];
    if(mode==='practice'){
      const requested=phrase.split(/\s+/),text=words();
      const occupied=new Set(used().filter(i=>!node.triangle_indices.includes(i)));
      const candidates=[];
      for(let start=0;start<=text.length-requested.length;start++){
        const ids=Array.from({length:requested.length},(_,i)=>start+i);
        if(requested.every((w,i)=>w===text[start+i])&&!ids.some(i=>occupied.has(i)))candidates.push(ids);
      }
      if(!candidates.length){
        await alertDialog('Triangle text','Enter consecutive available words exactly as they appear in the worksheet.');return;
      }
      indices=candidates.find(ids=>JSON.stringify(ids)===JSON.stringify(node.triangle_indices))??candidates[0];
      phrase=indices.map(i=>text[i]).join(' ');
    }
    if(phrase===node.triangle_text&&JSON.stringify(indices)===JSON.stringify(node.triangle_indices))return;
    checkpoint();node.triangle_text=phrase;node.triangle_indices=indices;afterEdit();return;
  }
  if(mode==='free'){
    const {ok,value}=await inputDialog('Triangle words','Enter a word or an unanalyzed phrase:','');
    if(!ok)return;
    const phrase=value.trim();
    if(!phrase||phrase.length>300||phrase.includes('\n')){
      await alertDialog('Triangle words','Enter 1–300 characters on one line.');return;
    }
    checkpoint();node.triangle_text=phrase;node.triangle_indices=[];afterEdit();return;
  }
  const text=words();
  const occupied=new Set(used().filter(i=>!node.triangle_indices.includes(i)));
  const starts=text.map((_,i)=>i).filter(i=>!occupied.has(i));
  if(!starts.length){await alertDialog('Triangle words','No unused worksheet words are available.');return;}
  const startOptions=starts.map(i=>`${i+1}. ${text[i]}`);
  const currentStart=node.triangle_indices[0]??starts[0];
  const startResult=await choiceDialog('Triangle words','First word:',startOptions,Math.max(0,starts.indexOf(currentStart)));
  if(startResult===null)return;
  const start=starts[startResult],ends=[];
  for(let i=start;i<text.length;i++){if(occupied.has(i))break;ends.push(i);}
  const endOptions=ends.map(i=>`${i+1}. ${text[i]}`);
  const currentEnd=node.triangle_indices.at(-1)??start;
  const endResult=await choiceDialog('Triangle words','Last word:',endOptions,Math.max(0,ends.indexOf(currentEnd)));
  if(endResult===null)return;
  const end=ends[endResult],indices=Array.from({length:end-start+1},(_,i)=>start+i);
  const phrase=indices.map(i=>text[i]).join(' ');
  if(phrase===node.triangle_text&&JSON.stringify(indices)===JSON.stringify(node.triangle_indices))return;
  checkpoint();node.triangle_text=phrase;node.triangle_indices=indices;afterEdit();
}
async function attachWord(anchor){
  const node=currentNode();if(!node||!enabled('word'))return;
  if(node.triangle_text!==null){editTriangle();return;}
  if(mode==='free'){
    const old=node.word_index!==null&&node.word_index<freeWords.length?freeWords[node.word_index]:'';
    const {ok,value}=await inputDialog('Attach word','Enter a word (leave empty to remove):',old);
    if(!ok)return;
    const word=value.trim();
    if(word.length>100||word.includes('\n')){
      await alertDialog('Invalid word','Enter a single short lexical item.');return;
    }
    if(word===old)return;
    checkpoint();
    if(!word)node.word_index=null;
    else{node.word_index=freeWords.length;freeWords.push(word);}
    afterEdit();return;
  }
  const occupied=new Set(used()),items=[];
  words().forEach((token,index)=>{
    if(!occupied.has(index)||index===node.word_index)items.push({
      label:`${index+1}.  ${token}`,action:()=>{
        if(node.word_index===index)return;
        checkpoint();node.word_index=index;afterEdit();
      }
    });
  });
  if(node.word_index!==null){
    items.push({separator:true});items.push({label:'Remove attached word',action:()=>{
      checkpoint();node.word_index=null;afterEdit();
    }});
  }
  showMenu(anchor,items);
}
async function addComment(){
  if(!ready())return;
  const {ok,value}=await inputDialog('Add Comment','Enter your question or comment:','',{multiline:true});
  const text=value.trim();if(!ok||!text)return;
  if(text.length>800){await alertDialog('Comment too long','Please use 800 characters or fewer.');return;}
  checkpoint();root.comments.push({id:uid(),text});afterEdit();
}
async function editComment(commentId){
  const comment=root.comments.find(c=>c.id===commentId);if(!comment)return;
  const {ok,value}=await inputDialog('Edit Comment','Edit the comment (leave empty to delete):',comment.text,{multiline:true});
  if(!ok)return;const text=value.trim();
  if(text.length>800){await alertDialog('Comment too long','Please use 800 characters or fewer.');return;}
  if(!text&&!await confirmDialog('Delete Comment','Remove this comment?'))return;
  if(text===comment.text)return;
  checkpoint();if(text)comment.text=text;else root.comments=root.comments.filter(c=>c.id!==commentId);
  afterEdit();
}
function deleteNode(){
  const node=currentNode();if(!node||node.uid===root.uid)return;
  const parent=findParent(root,node.uid);if(!parent)return;
  checkpoint();parent.children=parent.children.filter(c=>c.uid!==node.uid);
  selectedUid=parent.uid;afterEdit();
}
async function resetTree(){
  if(!ready()||!await confirmDialog('Reset tree','Discard the current tree and start again with an empty root?'))return;
  checkpoint();root=makeNode('?');selectedUid=null;afterEdit();
}
function runTool(name,anchor){
  if(!enabled(name))return;
  ({branches:()=>addBranches(anchor),label:()=>changeLabel(anchor),word:()=>attachWord(anchor),
    comment:addComment,delete:deleteNode,reset:resetTree})[name]?.();
}
function switchMode(next){
  if(next===mode||!['free','practice'].includes(next))return;
  if(mode==='free')freeTree=clone(root);
  else if(sentences.length)workingTrees[currentIndex]=clone(root);
  mode=next;
  root=next==='free'?normalizeNode(freeTree):
    workingTrees[currentIndex]?normalizeNode(workingTrees[currentIndex]):makeNode('?');
  selectedUid=null;undoStack=[];redoStack=[];scrollReset=true;
  setInfo('');render();
}
function loadBankData(raw){
  const bank=validateBank(raw);
  bankName=bank.name;sentences=bank.sentences;exerciseIds=bank.exercise_ids;originalCount=bank.original_count;
  workingTrees={};workHandle=null;workFilename=null;currentIndex=0;
  root=makeNode('?');selectedUid=null;undoStack=[];redoStack=[];
  scrollReset=true;setInfo('');render();
}
function switchExercise(index){
  if(mode!=='practice'||index<0||index>=sentences.length||index===currentIndex)return;
  workingTrees[currentIndex]=clone(root);currentIndex=index;
  root=workingTrees[index]?normalizeNode(workingTrees[index]):makeNode('?');
  selectedUid=null;undoStack=[];redoStack=[];scrollReset=true;render();
}
async function saveAndGo(){
  if(mode!=='practice'||!sentences.length)return;
  const value=$('jumpInput').value.trim().toLowerCase(),index=exerciseIds.indexOf(value);
  if(index<0){await alertDialog('Invalid exercise number','Enter an existing exercise number, for example 3, 3b, or 3c.');return;}
  if(index===currentIndex){$('jumpInput').value=exerciseIds[currentIndex];return;}
  const previous=currentIndex;switchExercise(index);
  if(workFilename&&!await saveProgress(false)){switchExercise(previous);return;}
  $('jumpInput').value=exerciseIds[currentIndex];
}
async function saveAndNext(){
  if(mode!=='practice'||currentIndex>=sentences.length-1)return;
  const previous=currentIndex;switchExercise(previous+1);
  if(workFilename&&!await saveProgress(false))switchExercise(previous);
}
function duplicateExercise(){
  if(mode!=='practice'||!sentences.length)return;
  if(sentences.length>=1000){alertDialog('Duplicate exercise','A saved worksheet can contain at most 1000 entries.');return;}
  const base=exerciseIds[currentIndex].replace(/[a-z]+$/,'');
  let suffixNum=2;
  while(exerciseIds.includes(`${base}${duplicateSuffix(suffixNum)}`))suffixNum++;
  const newLabel=`${base}${duplicateSuffix(suffixNum)}`;
  let insertAt=currentIndex+1;
  while(insertAt<exerciseIds.length&&exerciseIds[insertAt].replace(/[a-z]+$/,'')===base)insertAt++;
  workingTrees[currentIndex]=clone(root);
  workingTrees=Object.fromEntries(Object.entries(workingTrees).map(([i,tree])=>[
    +i>=insertAt?+i+1:+i,tree
  ]));
  sentences.splice(insertAt,0,sentences[currentIndex]);exerciseIds.splice(insertAt,0,newLabel);
  workingTrees[insertAt]=clone(root);
  currentIndex=insertAt;root=normalizeNode(workingTrees[insertAt]);
  selectedUid=null;undoStack=[];redoStack=[];scrollReset=true;render();
  if(workFilename)saveProgress(false);
}
async function importWorksheet(file){
  try {
    const exercises=await readExercisesXlsx(file);
    if(sentences.length&&!await confirmDialog('Replace worksheet',
      'Importing a new worksheet replaces the current exercises and their unsaved trees. Continue?'))return;
    loadBankData({name:file.name.replace(/\.xlsx$/i,''),sentences:exercises});
    setInfo(`Imported ${exercises.length} exercises from ${file.name}`);
  }catch(e){await alertDialog('Cannot import worksheet',e.message);}
}

function workDocument(){
  workingTrees[currentIndex]=clone(root);
  return {
    format:'syntax-tree-builder-work-1',bank_name:bankName,sentences:[...sentences],
    exercise_ids:[...exerciseIds],original_count:originalCount,current_index:currentIndex,
    trees:Object.fromEntries(Object.entries(workingTrees).map(([i,t])=>[String(i),clone(t)]))
  };
}
async function saveProgress(interactive=true){
  if(mode!=='practice'||!sentences.length){
    if(interactive)await alertDialog('Save work',mode!=='practice'
      ?'Editable saving for Free Mode will be implemented later. For now you can export the Free Mode tree as PNG.'
      :'Import an XLSX worksheet first.');
    return false;
  }
  let text=JSON.stringify(workDocument(),null,2);
  try{
    if(!workHandle&&'showSaveFilePicker' in window && interactive){
      workHandle=await window.showSaveFilePicker({suggestedName:'syntax_tree_progress.stb.json',
        types:[{description:'Syntax Tree Builder work',accept:{'application/json':['.json']}}]});
      workFilename=workHandle.name;
    }
    if(workHandle){
      const writable=await workHandle.createWritable();
      await writable.write(text);await writable.close();
      setInfo(`Progress saved: ${workFilename}`);return true;
    }
    // Downloads are used when the browser cannot write back to an existing file.
    workFilename=workFilename??'syntax_tree_progress.stb.json';
    downloadFile(workFilename,text,'application/json;charset=utf-8');
    setInfo(`Progress downloaded: ${workFilename}`);return true;
  }catch(e){
    if(e.name==='AbortError')return false;
    await alertDialog('Cannot save progress',e.message);return false;
  }
}
async function openProgress(file){
  if(mode!=='practice')return;
  try{
    const parsed=readProgress(JSON.parse(await file.text()));
    loadBankData({name:parsed.name,sentences:parsed.sentences,
      exercise_ids:parsed.exercise_ids,original_count:parsed.original_count});
    workingTrees=parsed.trees;currentIndex=parsed.current_index;
    root=workingTrees[currentIndex]?normalizeNode(workingTrees[currentIndex]):makeNode('?');
    selectedUid=root.uid;workHandle=null;workFilename=file.name;
    undoStack=[];redoStack=[];scrollReset=true;render();
    setInfo(`Progress opened: ${file.name}`);
  }catch(e){await alertDialog('Cannot open work',e.message);}
}

function svgEl(tag,attrs={},text){
  const el=document.createElementNS(NS,tag);
  for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));
  if(text!==undefined)el.textContent=String(text);
  return el;
}
function widthForLabel(label){return label==='EMPTY'?48:Math.max(76,textWidth(label,'20px Georgia')+34);}
function layoutTree(){
  const widths=new Map(),labelWidths=new Map(),points=new Map(),terminals=[],triangles=[],edges=[];
  const text=words();let maxDepth=0;
  function measure(node,depth=0){
    if(depth>35)throw Error('Tree is too deep to display.');
    const lw=widthForLabel(node.label);labelWidths.set(node.uid,lw);
    let width=lw;
    if(node.children.length){
      width=Math.max(lw,node.children.reduce((sum,c)=>sum+measure(c,depth+1),0)+H_GAP*(node.children.length-1));
    }else if(node.triangle_text!==null){
      width=Math.max(lw,textWidth(node.triangle_text,'20px Georgia')+34,125);
    }else if(node.word_index!==null&&node.word_index>=0&&node.word_index<text.length){
      width=Math.max(lw,widthForLabel(text[node.word_index]));
    }
    widths.set(node.uid,width);return width;
  }
  function assign(node,left,depth){
    maxDepth=Math.max(maxDepth,depth);
    const mid=left+widths.get(node.uid)/2,y=TOP+depth*V_GAP;
    points.set(node.uid,{x:mid,y});
    if(node.children.length){
      const span=node.children.reduce((sum,c)=>sum+widths.get(c.uid),0)+H_GAP*(node.children.length-1);
      let x=mid-span/2;
      for(const child of node.children){
        assign(child,x,depth+1);const p=points.get(child.uid);
        edges.push({x1:mid,y1:y+47,x2:p.x,y2:p.y});
        x+=widths.get(child.uid)+H_GAP;
      }
    }else if(node.triangle_text!==null){
      triangles.push({phrase:node.triangle_text,x:mid,y,span:widths.get(node.uid)});
      maxDepth=Math.max(maxDepth,depth+1);
    }else if(node.word_index!==null&&node.word_index>=0&&node.word_index<text.length){
      terminals.push({text:text[node.word_index],x:mid,y:y+39});
      maxDepth=Math.max(maxDepth,depth+1);
    }
  }
  const width=measure(root);
  const sceneW=Math.max(900,width+2*SIDE);
  assign(root,(sceneW-width)/2,0);
  const sceneH=Math.max(580,TOP+(maxDepth+1)*V_GAP+60);
  return {width,maxDepth,points,terminals,triangles,edges,labelWidths,sceneW,sceneH};
}
function geometryOfTree(layout){
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  const add=(a,b,c,d)=>{left=Math.min(left,a);top=Math.min(top,b);right=Math.max(right,c);bottom=Math.max(bottom,d);};
  for(const node of walk(root)){
    const p=layout.points.get(node.uid),w=layout.labelWidths.get(node.uid);
    add(p.x-w/2,p.y,p.x+w/2,p.y+47);
  }
  for(const e of layout.edges)add(Math.min(e.x1,e.x2),Math.min(e.y1,e.y2),Math.max(e.x1,e.x2),Math.max(e.y1,e.y2));
  for(const t of layout.terminals){const w=textWidth(t.text);add(t.x-w/2,t.y+4,t.x+w/2,t.y+33);}
  for(const t of layout.triangles){const w=Math.max(65,t.span/2-4);add(t.x-w,t.y+48,t.x+w,t.y+126);}
  if(!isFinite(left))return {left:0,top:0,right:0,bottom:0};
  return {left,top,right,bottom};
}
function intersects(a,b,gap=0){return a.left<b.right+gap&&a.right>b.left-gap&&a.top<b.bottom+gap&&a.bottom>b.top-gap;}
function placeComment(rect,obstacles){
  const isClear=(p)=>{
    const box={left:p.x,top:p.y,right:p.x+rect.w,bottom:p.y+rect.h};
    return obstacles.every(o=>!intersects(box,o,9));
  };
  const start={x:rect.x,y:rect.y};if(isClear(start))return start;
  const xs=[start.x],ys=[start.y];
  for(const o of obstacles){xs.push(o.left-rect.w-18,o.right+18);ys.push(o.top-rect.h-18,o.bottom+18);}
  let closest=null,distance=Infinity;
  for(const x of xs)for(const y of ys){
    const p={x,y};if(!isClear(p))continue;
    const d=(x-start.x)**2+(y-start.y)**2;
    if(d<distance){closest=p;distance=d;}
  }
  return closest??start;
}
function splitLongWord(word,maxWidth,font){
  if(textWidth(word,font)<=maxWidth)return [word];
  const out=[];let segment='';
  for(const char of word){
    if(segment&&textWidth(segment+char,font)>maxWidth){out.push(segment);segment=char;}
    else segment+=char;
  }
  if(segment)out.push(segment);return out;
}
function wrapComment(text,maxWidth=242){
  const font='14.5px "Segoe UI", Arial';const lines=[];
  for(const paragraph of text.split(/\r?\n/)){
    if(!paragraph){lines.push('');continue;}
    let line='';
    for(const initial of paragraph.split(/\s+/)){
      for(const word of splitLongWord(initial,maxWidth,font)){
        const next=line?`${line} ${word}`:word;
        if(line&&textWidth(next,font)>maxWidth){lines.push(line);line=word;}
        else line=next;
      }
    }
    lines.push(line);
  }
  return lines;
}
function buildComments(layout){
  const treeArea=geometryOfTree(layout);
  const treeObstacle={left:treeArea.left-20,top:treeArea.top-20,
    right:treeArea.right+20,bottom:treeArea.bottom+20};
  const entries=[],obstacles=[treeObstacle];
  root.comments.forEach((comment,index)=>{
    const lines=wrapComment(comment.text),h=Math.max(80,lines.length*19+47);
    const fallback={x:treeArea.right+35,y:treeArea.top+20+index*120};
    const start={x:Number.isFinite(+comment.x)?+comment.x:fallback.x,
      y:Number.isFinite(+comment.y)?+comment.y:fallback.y};
    const pos=placeComment({...start,w:270,h},obstacles);
    comment.x=pos.x;comment.y=pos.y;
    const rect={left:pos.x,top:pos.y,right:pos.x+270,bottom:pos.y+h};
    obstacles.push(rect);entries.push({comment,lines,x:pos.x,y:pos.y,w:270,h});
  });
  return entries;
}
function createTreeSvg(layout,comments){
  const svg=$('treeSvg');svg.replaceChildren();
  const maxRight=Math.max(layout.sceneW,...comments.map(c=>c.x+c.w+30));
  const maxBottom=Math.max(layout.sceneH,...comments.map(c=>c.y+c.h+30));
  const minX=Math.min(0,...comments.map(c=>c.x-30));
  const minY=Math.min(0,...comments.map(c=>c.y-30));
  const offsetX=-minX,offsetY=-minY;
  sceneWidth=Math.max(1,maxRight-minX);sceneHeight=Math.max(1,maxBottom-minY);
  svg.setAttribute('viewBox',`0 0 ${sceneWidth} ${sceneHeight}`);
  svg.setAttribute('width',String(sceneWidth*zoom));svg.setAttribute('height',String(sceneHeight*zoom));
  svg.style.width=(sceneWidth*zoom)+'px';svg.style.height=(sceneHeight*zoom)+'px';
  const stage=$('treeStage');stage.style.width=`${Math.max(sceneWidth*zoom,$('scrollCanvas').clientWidth)}px`;
  stage.style.height=`${Math.max(sceneHeight*zoom,$('scrollCanvas').clientHeight)}px`;
  svg.style.margin='auto';
  const defs=svgEl('defs');const dots=svgEl('pattern',{id:'dots',width:24,height:24,patternUnits:'userSpaceOnUse'});
  dots.append(svgEl('circle',{cx:0,cy:0,r:.75,fill:'#e6ecf5'}));defs.append(dots);svg.append(defs);
  svg.append(svgEl('rect',{width:sceneWidth,height:sceneHeight,fill:BG}));
  svg.append(svgEl('rect',{width:sceneWidth,height:sceneHeight,fill:'url(#dots)'}));
  const content=svgEl('g',{transform:`translate(${offsetX} ${offsetY})`});svg.append(content);
  for(const e of layout.edges){
    content.append(svgEl('line',{x1:e.x1,y1:e.y1,x2:e.x2,y2:e.y2,stroke:EDGE,'stroke-width':2,'stroke-linecap':'round'}));
  }
  for(const n of walk(root)){
    const point=layout.points.get(n.uid),w=layout.labelWidths.get(n.uid);
    const group=svgEl('g',{'class':'tree-node',transform:`translate(${point.x-w/2} ${point.y})`,'data-uid':n.uid,tabindex:0,role:'button','aria-label':heading(n.label)});
    group.append(svgEl('rect',{'class':'hit',x:0,y:0,width:w,height:47,fill:'transparent'}));
    if(n.label==='EMPTY')group.append(svgEl('rect',{'class':'hover-frame',
      x:1,y:1,width:w-2,height:45,rx:10,fill:'none',stroke:'#9daabc',
      'stroke-width':1,'stroke-dasharray':'4 4',opacity:0}));
    const frame=svgEl('rect',{'class':'selection-frame',x:1,y:1,width:w-2,height:45,rx:10,fill:'none',stroke:'#1747ad','stroke-width':3,
      visibility:n.uid===selectedUid?'visible':'hidden'});
    group.append(frame);
    if(n.label!=='EMPTY')group.append(svgEl('text',{x:w/2,y:24,'text-anchor':'middle','dominant-baseline':'middle',
      'font-family':'Georgia,serif','font-size':20,'font-weight':'bold',fill:INK},n.label));

    group.style.touchAction='manipulation';

    group.addEventListener('click',event=>{
      event.stopPropagation();
      selectNode(n.uid);
    });

    group.addEventListener('pointerup',event=>{
      if(event.pointerType!=='touch'&&event.pointerType!=='pen')return;

      const now=performance.now();

      if(lastTouchNode===n.uid&&selectedUid===n.uid&&now-lastTouchTime<500){
        lastTouchNode=null;
        lastTouchTime=0;
        lastTouchOpenTime=now;
        event.preventDefault();
        event.stopPropagation();
        selectNode(n.uid);
        changeLabel(event);
      }else{
        lastTouchNode=n.uid;
        lastTouchTime=now;
      }
    });

    group.addEventListener('dblclick',event=>{
      if(performance.now()-lastTouchOpenTime<700)return;
      event.stopPropagation();
      selectedUid=n.uid;
      updateSelection();
      updateControls();
      changeLabel(event);
    });
    group.addEventListener('keydown',event=>{
      if(event.key==='Enter'){event.preventDefault();event.stopPropagation();selectNode(n.uid);changeLabel(group);}
    });
    content.append(group);
  }
  for(const t of layout.triangles){
    const half=Math.max(65,t.span/2-4),apex=t.y+48,base=t.y+97;
    content.append(svgEl('path',{d:`M${t.x} ${apex} L${t.x-half} ${base} L${t.x+half} ${base} Z`,
      fill:'none',stroke:EDGE,'stroke-width':2,'stroke-linejoin':'round'}));
    content.append(svgEl('text',{x:t.x,y:base+25,'text-anchor':'middle',
      'font-family':'Georgia,serif','font-size':20,fill:'#24334d'},t.phrase));
  }
  for(const t of layout.terminals){
    content.append(svgEl('text',{x:t.x,y:t.y+28,'text-anchor':'middle','font-family':'Georgia,serif','font-size':20,fill:'#24334d'},t.text));
  }
  for(const info of comments){
    const {comment,x,y,w,h,lines}=info;
    const group=svgEl('g',{'class':'comment-bubble',transform:`translate(${x} ${y})`,'data-comment':comment.id});
    group.append(svgEl('rect',{width:w,height:h,rx:14,ry:14,fill:'#eaf2ff',stroke:'#a9c8ee','stroke-width':1.3}));
    group.append(svgEl('text',{'class':'comment-head',x:14,y:21,'font-size':12,'font-family':'Segoe UI,Arial','font-weight':'600',fill:'#35639b'},'COMMENT'));
    lines.forEach((text,index)=>{
      group.append(svgEl('text',{'class':'comment-body',x:14,y:46+index*19,
        'font-family':'Segoe UI,Arial','font-size':14.5,fill:INK},text));
    });
    group.addEventListener('click',e=>e.stopPropagation());
    group.addEventListener('dblclick',e=>{e.stopPropagation();editComment(comment.id);});
    group.addEventListener('pointerdown',e=>startCommentDrag(e,group,info));
    content.append(group);
  }
  svg.onclick=e=>{if(e.target.closest?.('.tree-node,.comment-bubble'))return;selectNode(null);};
}
function startCommentDrag(event,group,info){
  if(event.button!==0)return;
  event.preventDefault();event.stopPropagation();closeMenu();
  const svg=$('treeSvg'),point=svg.createSVGPoint();
  const convert=e=>{point.x=e.clientX;point.y=e.clientY;return point.matrixTransform(svg.getScreenCTM().inverse());};
  const start=convert(event);const base={x:info.x,y:info.y};
  const original={x:info.comment.x,y:info.comment.y};
  const beforeDrag=clone(root);let moved=false;
  group.setPointerCapture(event.pointerId);
  function move(e){
    const p=convert(e);let x=base.x+(p.x-start.x),y=base.y+(p.y-start.y);
    if(Math.abs(x-base.x)+Math.abs(y-base.y)>1)moved=true;
    group.setAttribute('transform',`translate(${x} ${y})`);
    info.comment.x=x;info.comment.y=y;
  }
  function done(e){
    group.removeEventListener('pointermove',move);group.removeEventListener('pointerup',done);
    group.removeEventListener('pointercancel',cancel);
    if(!moved){info.comment.x=original.x;info.comment.y=original.y;return;}
    const other=buildComments(layoutTree()).find(x=>x.comment.id===info.comment.id);
    if(!other)return;
    info.comment.x=other.x;info.comment.y=other.y;
    undoStack.push(beforeDrag);
    if(undoStack.length>80)undoStack.shift();
    redoStack=[];
    if(mode==='practice')workingTrees[currentIndex]=clone(root);else freeTree=clone(root);
    render();
  }
  function cancel(){group.removeEventListener('pointermove',move);group.removeEventListener('pointerup',done);group.removeEventListener('pointercancel',cancel);info.comment.x=original.x;info.comment.y=original.y;render();}
  group.addEventListener('pointermove',move);group.addEventListener('pointerup',done);group.addEventListener('pointercancel',cancel);
}
function drawTree(reset=false){
  if(!ready())return;
  const canvas=$('scrollCanvas'),sx=canvas.scrollLeft,sy=canvas.scrollTop;
  let layout;
  try{layout=layoutTree();}catch(error){alertDialog('Cannot display tree',error.message);return;}
  const comments=buildComments(layout);
  createTreeSvg(layout,comments);
  if(reset){
    requestAnimationFrame(()=>{
      canvas.scrollLeft=Math.max(0,(canvas.scrollWidth-canvas.clientWidth)/2);
      canvas.scrollTop=Math.max(0,(canvas.scrollHeight-canvas.clientHeight)/2);
    });
  }else{canvas.scrollLeft=sx;canvas.scrollTop=sy;}
}

function render(){
  closeMenu();
  const practice=mode==='practice',hasBank=practice&&sentences.length>0,canEdit=ready();
  $('freeTab').classList.toggle('active',!practice);
  $('practiceTab').classList.toggle('active',practice);
  $('freeTab').setAttribute('aria-pressed',String(!practice));
  $('practiceTab').setAttribute('aria-pressed',String(practice));
  $('modeDesc').textContent=practice?'Complete instructor-assigned Excel worksheets.':'Create your own syntax trees from scratch.';
  $('leftSide').hidden=!practice;
  $('leftSide').classList.toggle('collapsed',leftCollapsed);
  $('rightSide').classList.toggle('collapsed',rightCollapsed);
  $('leftToggle').textContent=leftCollapsed?'▶':'◀';
  $('rightToggle').textContent=rightCollapsed?'◀':'▶';
  $('leftToggle').title=leftCollapsed?'Expand worksheet sidebar':'Collapse worksheet sidebar';
  $('rightToggle').title=rightCollapsed?'Expand Tree Tools sidebar':'Collapse Tree Tools sidebar';
  $('bankName').textContent=bankName;
  if(hasBank){
    const label=exerciseIds[currentIndex];
    const nodes=[...walk(root)];
    $('progressText').textContent=`Exercise ${label} of ${originalCount}\nNodes labeled: ${nodes.filter(n=>n.label!=='?').length}/${nodes.length}\nWords attached: ${used().length}/${words().length}`;
    $('progressText').style.whiteSpace='pre-line';
    $('exerciseNumber').textContent=`Exercise ${label} of ${originalCount}:`;
    $('sentenceText').textContent=`"${sentences[currentIndex]}"`;
    $('jumpTotal').textContent=`/ ${originalCount}`;
    if(document.activeElement!==$('jumpInput'))$('jumpInput').value=label;
  }else{
    $('progressText').textContent=practice?'No worksheet imported.':'Import an Excel worksheet to begin.';
  }
  $('jumpPanel').hidden=!(hasBank&&(originalCount>5||sentences.length>originalCount));
  $('sentenceBar').hidden=!hasBank;
  $('scrollCanvas').hidden=!canEdit;
  $('placeholder').hidden=!practice||!!sentences.length;
  $('floatingBar').hidden=!canEdit||!floatingVisible;
  $('floatingToggle').textContent=floatingVisible?'Floating tools: On':'Floating tools: Off';
  $('floatingToggle').classList.toggle('inactive',!floatingVisible);
  $('rightSide').classList.toggle('disabled',!canEdit);
  updateControls();
  if(canEdit){const reset=scrollReset;scrollReset=false;drawTree(reset);}
}
function changeZoom(factor){
  const current=zoom;
  zoom=Math.max(.45,Math.min(2.25,zoom*factor));
  if(zoom===current)return;
  const canvas=$('scrollCanvas'),oldWidth=sceneWidth*current,oldHeight=sceneHeight*current;
  const focusX=(canvas.scrollLeft+canvas.clientWidth/2)/Math.max(1,oldWidth);
  const focusY=(canvas.scrollTop+canvas.clientHeight/2)/Math.max(1,oldHeight);
  drawTree();
  canvas.scrollLeft=focusX*sceneWidth*zoom-canvas.clientWidth/2;
  canvas.scrollTop=focusY*sceneHeight*zoom-canvas.clientHeight/2;
}
async function exportPNG(){
  if(!ready())return;
  const svg=$('treeSvg'),rect=svg.viewBox.baseVal,w=Math.round(rect.width*2),h=Math.round(rect.height*2);
  if(w*h>45000000){await alertDialog('Tree too large','Zoom or simplify the tree before exporting.');return;}
  try{
    const copy=svg.cloneNode(true);
    copy.querySelectorAll('.selection-frame').forEach(el=>el.setAttribute('visibility','hidden'));
    copy.querySelectorAll('.hover-frame').forEach(el=>el.setAttribute('opacity','0'));
    copy.setAttribute('width',String(rect.width));copy.setAttribute('height',String(rect.height));
    copy.removeAttribute('style');copy.setAttribute('xmlns',NS);
    const xml=new XMLSerializer().serializeToString(copy);
    const image=new Image(),url=URL.createObjectURL(new Blob([xml],{type:'image/svg+xml;charset=utf-8'}));
    await new Promise((resolve,reject)=>{
      image.onload=resolve;image.onerror=()=>reject(Error('The tree image could not be rendered.'));
      image.src=url;
    });
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
    ctx.drawImage(image,0,0,w,h);URL.revokeObjectURL(url);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob)throw Error('Could not create PNG.');
    downloadFile('syntax_tree.png',blob,'image/png');setInfo('PNG exported: syntax_tree.png');
  }catch(e){await alertDialog('Export failed',e.message);}
}
function initFloatingToolbar(){
  const grip=$('floatGrip'),bar=$('floatingBar'),area=$('drawingArea');
  let drag=null;
  grip.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    event.preventDefault();closeMenu();
    const rect=bar.getBoundingClientRect(),parent=area.getBoundingClientRect();
    drag={startX:event.clientX,startY:event.clientY,x:rect.left-parent.left,y:rect.top-parent.top,
      w:rect.width,h:rect.height};
    bar.style.transform='none';bar.style.right='auto';bar.style.bottom='auto';
    bar.style.left=drag.x+'px';bar.style.top=drag.y+'px';
    grip.setPointerCapture(event.pointerId);
  });
  grip.addEventListener('pointermove',event=>{
    if(!drag)return;

    const bounds=area.getBoundingClientRect();
    const pointerX=event.clientX-bounds.left;

    const dockRight=pointerX>=bounds.width-55;
    const dockLeft=!dockRight&&pointerX<=55;

    bar.classList.toggle('vertical',dockLeft||dockRight);
    bar.classList.toggle('docked-right',dockRight);

    let x=drag.x+event.clientX-drag.startX;
    let y=drag.y+event.clientY-drag.startY;

    if(dockLeft){
      x=12;
    }else if(dockRight){
      x=bounds.width-bar.offsetWidth-12;
    }else{
      x=Math.max(6,Math.min(bounds.width-bar.offsetWidth-6,x));
    }

    y=Math.max(6,Math.min(bounds.height-bar.offsetHeight-6,y));

    bar.style.left=x+'px';
    bar.style.top=y+'px';
    bar.style.right='auto';

    floatingPosition={
      x,y,
      vertical:dockLeft||dockRight,
      right:dockRight
    };
  });

  grip.addEventListener('pointerup',()=>{drag=null;});
  grip.addEventListener('pointercancel',()=>{drag=null;});
  new ResizeObserver(()=>{
    if(!floatingPosition)return;
    const w=area.clientWidth,h=area.clientHeight;
    const x=Math.min(Math.max(8,floatingPosition.x),Math.max(8,w-bar.offsetWidth-8));
    const y=Math.min(Math.max(8,floatingPosition.y),Math.max(8,h-bar.offsetHeight-8));
    bar.style.left=x+'px';bar.style.top=y+'px';
  }).observe(area);
}
function initCanvasPan(){
  const canvas=$('scrollCanvas');let drag=null;
  new ResizeObserver(()=>{if(ready())drawTree();}).observe(canvas);
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest?.('.tree-node,.comment-bubble'))return;
    selectNode(null);
    drag={x:event.clientX,y:event.clientY,scrollX:canvas.scrollLeft,scrollY:canvas.scrollTop};
    canvas.classList.add('panning');canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if(!drag)return;
    canvas.scrollLeft=drag.scrollX+drag.x-event.clientX;
    canvas.scrollTop=drag.scrollY+drag.y-event.clientY;
  });
  const finish=()=>{drag=null;canvas.classList.remove('panning');};
  canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
  canvas.addEventListener('wheel',event=>{
    if(!event.ctrlKey)return;
    event.preventDefault();changeZoom(event.deltaY<0?1.12:1/1.12);
  },{passive:false});
}
function init(){
  initTools();
  $('freeTab').onclick=()=>switchMode('free');
  $('practiceTab').onclick=()=>switchMode('practice');
  $('aboutBtn').onclick=showAbout;
  $('leftToggle').onclick=()=>{leftCollapsed=!leftCollapsed;render();};
  $('rightToggle').onclick=()=>{rightCollapsed=!rightCollapsed;render();};
  $('floatingToggle').onclick=()=>{floatingVisible=!floatingVisible;render();};
  $('undoBtn').onclick=undo;$('redoBtn').onclick=redo;
  $('zoomIn').onclick=()=>changeZoom(1.15);$('zoomOut').onclick=()=>changeZoom(1/1.15);
  $('prevBtn').onclick=()=>switchExercise(currentIndex-1);
  $('nextBtn').onclick=saveAndNext;
  $('duplicateBtn').onclick=duplicateExercise;
  $('jumpBtn').onclick=saveAndGo;
  $('jumpInput').addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();saveAndGo();}
  });
  $('importBtn').onclick=()=>$('importFile').click();
  $('importFile').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if(file)await importWorksheet(file);
  };
  $('openBtn').onclick=()=>$('openFile').click();
  $('openFile').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if(file)await openProgress(file);
  };
  $('saveBtn').onclick=()=>saveProgress();
  $('pngBtn').onclick=exportPNG;
  $('overlay').addEventListener('click',event=>{
    if(event.target===$('overlay'))$('closeDialog').click();
  });
  document.addEventListener('pointerdown',event=>{
    if(menuOpen&&!event.target.closest('#contextMenu,#subMenu'))closeMenu();
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      if(menuOpen)closeMenu();
      else if($('overlay').classList.contains('show'))$('closeDialog').click();
      return;
    }
    if(event.target.closest('input,textarea,select,[contenteditable]'))return;
    const cmd=event.ctrlKey||event.metaKey;
    if(cmd&&event.key.toLowerCase()==='z'){
      event.preventDefault();if(event.shiftKey)redo();else undo();
    }else if(cmd&&event.key.toLowerCase()==='y'){
      event.preventDefault();redo();
    }else if(cmd&&event.key.toLowerCase()==='s'){
      event.preventDefault();saveProgress();
    }else if(cmd&&(event.key==='+'||event.key==='=')){
      event.preventDefault();changeZoom(1.15);
    }else if(cmd&&event.key==='-'){
      event.preventDefault();changeZoom(1/1.15);
    }else if(event.key==='Delete'&&selectedUid){
      event.preventDefault();deleteNode();
    }
  });
  initCanvasPan();initFloatingToolbar();
  scrollReset=true;render();
}
init();
