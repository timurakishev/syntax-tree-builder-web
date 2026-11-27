import {
  LABEL_GROUPS, PHRASES, isPhrase, isProjection, isHead, makeNode, normalizeNode,
  clone, walk, findNode, findParent, usedWordIndices, tokenize, allowedLabels,
  validateBank, readProgress, duplicateSuffix, uid
} from './model.js';
import {readExercisesXlsx} from './xlsx.js';

const $=id=>document.getElementById(id);
const NS='http://www.w3.org/2000/svg';
const BG='#ffffff', INK='#14233e', EDGE='#53647c';
const TOP=82, SIDE=105, V_GAP=108, H_GAP=18;
const iconPaths={
  branches:'<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v3a6 6 0 0 0 6 6v1M18 7v3a6 6 0 0 1-6 6"/>',
  parent:'<circle cx="12" cy="4" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="20" r="2"/><path d="M12 6v4M12 14v4"/>',
  label:'<path d="M4 20l4.5-1L20 7a2.12 2.12 0 0 0-3-3L5 16zM15 6l3 3"/>',
  word:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M12 9v7M9 16h6"/>',
  features:'<path d="M8 4H5v16h3M16 4h3v16h-3"/><text x="12" y="16.2" text-anchor="middle" font-size="13" font-family="Georgia,serif" font-weight="bold" font-style="italic" fill="currentColor" stroke="none">f</text>',
  comment:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5A8.5 8.5 0 1 1 21 11.5z"/>',
  movement:'<path d="M4 20c6-1 6-10 12-12h4M16 4l4 4-4 4"/><circle cx="4" cy="20" r="2"/>',
  delete:'<path d="M3 6h18M8 6V4h8v2M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  reset:'<path d="m7 21-4-4a2 2 0 0 1 0-3l10-10a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3L11 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/>',
  redo:'<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h2"/>'
};
const TOOL_CONFIG=[
  ['branches','Expand tree'],
  ['label','Change label'],['word','Attach/Edit word'],
  ['features','Attach/Edit feature'],['movement','Add/Edit movement'],['comment','Add comment'],
  ['delete','Delete subtree'],['reset','Reset tree']
];
const toolButtons={};
let mode='free';
let root=makeNode('?'), freeTree=clone(root), freeWords=[];
let selectedUid=null, undoStack=[], redoStack=[];
let lastTouchNode=null, lastTouchTime=0, lastTouchOpenTime=0;
let bankName='No worksheet imported', sentences=[], exerciseIds=[], originalCount=0;
let currentIndex=0, workingTrees={}, workHandle=null, workFilename=null;
let zoom=1, leftCollapsed=false,rightCollapsed=false;
let floatingPosition=null, toastTimer=null;
let sceneWidth=900,sceneHeight=580;
let scrollReset=false, menuOpen=false;
let pendingMovement=null;
const textCanvas=document.createElement('canvas'), textCtx=textCanvas.getContext('2d');

function words(){return mode==='free'?freeWords:(sentences.length?tokenize(sentences[currentIndex]):[]);}
const ready=()=>mode==='free'||(mode==='practice'&&sentences.length>0);
const currentNode=()=>selectedUid?findNode(root,selectedUid):null;
const used=()=>usedWordIndices(root);
const heading=x=>x==='EMPTY'?'Empty':x;
function eligibleBranchParent(node){
  return !!node&&node.word_index===null&&!node.null_element&&
    node.triangle_text===null&&!node.trace&&node.label!=='?'&&node.label!=='EMPTY'&&
    (isPhrase(node.label)||isProjection(node.label));
}

function branchDepth(node){
  let depth=0,cursor=node;
  while(cursor&&cursor.uid!==root.uid){
    cursor=findParent(root,cursor.uid);
    if(!cursor)return Infinity;
    depth++;
  }
  return depth;
}

function availableBranchRoom(node){
  if(!eligibleBranchParent(node)||branchDepth(node)>=35)return 0;
  return Math.max(0,Math.min(3-node.children.length,150-[...walk(root)].length));
}

function subtreeHeight(node){
  if(!node.children.length)return 0;
  return 1+Math.max(...node.children.map(subtreeHeight));
}

function canInsertParentAbove(node){
  return !!node&&node.label!=='?'&&
    [...walk(root)].length<150&&
    branchDepth(node)+subtreeHeight(node)<35;
}
function canRemoveParentAbove(node){
  if(!node)return false;
  const parent=findParent(root,node.uid);
  if(!parent||parent.children.length!==1)return false;
  if(parent.uid===root.uid&&(!isPhrase(node.label)||node.label==='EMPTY'||node.trace))return false;
  return true;
}
const textWidth=(str,font='20px Georgia')=>{textCtx.font=font;return textCtx.measureText(String(str)).width;};

function showToast(message){
  const box=$('toast');box.textContent=message;box.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.classList.remove('show'),3700);
}
let infoTimer = null;

function setInfo(text,duration=7000) {
  const target = $('bottomInfo');
  if (!target) return;

  clearTimeout(infoTimer);
  target.textContent = text;

  if (text) {
    infoTimer = setTimeout(() => {
      target.textContent = '';
    }, duration);
  }
}
function showBackupNotice(){
  setInfo('Backed up in this browser',6000);
  const icon=document.createElementNS(NS,'svg');
  icon.classList.add('backup-disk-icon');
  icon.setAttribute('viewBox','0 0 24 24');
  icon.setAttribute('aria-hidden','true');
  icon.innerHTML='<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>';
  $('bottomInfo')?.prepend(icon);
}
function downloadFile(name,content,type){
  const blob=content instanceof Blob?content:new Blob([content],{type});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1800);
}

function closeMenu(){
  for(const id of ['contextMenu','subMenu']){const menu=$(id);menu.hidden=true;menu.replaceChildren();}
  $('progressMenuBtn')?.setAttribute('aria-expanded','false');
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
  menu.style.width=anchor?.id==='progressMenuBtn'?'175px':'';
  menu.style.minWidth=anchor?.id==='progressMenuBtn'?'0':'';
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
    if(opts.insertNull)addDialogButton(footer,'Insert Ø',()=>{closeDialog();resolve({ok:true,value:'Ø'});});
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
    'Developed by Timur Akishev (KIMEP University), 2026. An interactive tool for building and exploring syntactic trees, designed for teaching, learning, and practice. Free for educational, non-commercial use.');
}
function showInstructions(){
  showDialog('Instructions',(body,footer)=>{
    const section=(title,paragraphs)=>{
      const heading=document.createElement('div');
      heading.className='field-label';
      heading.textContent=title;
      body.append(heading);

      for(const message of paragraphs){
        const p=document.createElement('p');
        p.textContent=message;
        body.append(p);
      }
    };

    section('Free Mode',[
      'Build and edit a syntax tree freely, without importing a worksheet.',
      'You can export the current tree as an image. Editable progress files and automatic browser backups are not available for Free Mode.'
    ]);

    section('Practice/Exam Mode',[
      'Import the XLSX worksheet provided by your instructor. Each sentence or phrase becomes a separate exercise.',
      'Build your trees and switch between exercises using Previous, Next, or Go to. Your work is automatically backed up in this browser.'
    ]);

    section('Saving and continuing your work',[
      'Download Progress saves the entire worksheet and all your trees as one editable .stb.json file. Download it before finishing, switching devices, or submitting editable work.',
      'Open Progress loads a previously downloaded .stb.json file so you can continue editing.',
      'When you reopen the app on the same browser, you may be offered your previous automatic backup. Browser backups can be lost if browser data is cleared, so keep your downloaded progress file.',
      'Export PNG saves an image of the current tree; it is not an editable progress file.'
    ]);

    addDialogButton(footer,'Close',closeDialog,true);
  });
}
function icon(name,color='currentColor'){
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name]}</svg>`;
}

function addFloatingButton(button){
  const group=$('floatingButtons');

  if(group.children.length){
    const divider=document.createElement('span');
    divider.className='float-separator';
    divider.setAttribute('aria-hidden','true');
    group.append(divider);
  }

  group.append(button);
}

function initTools(){
  for(const [name,title] of TOOL_CONFIG){
    const b=document.createElement('button');
    b.type='button';
    b.className='tool'+(name==='branches'?' primary-soft':'');
    b.innerHTML=`<span class="tool-icon">${icon(name)}</span><span>${title}</span>`;
    b.id='tool-'+name;
    b.onclick=()=>runTool(name,b);
    $('sidebarTools').append(b);

    const floating=document.createElement('button');
    floating.type='button';
    floating.className='float-btn'+(name==='branches'?' float-branches':'');
    floating.title=title;
    floating.setAttribute('aria-label',title);
    floating.innerHTML=icon(name);
    floating.onclick=()=>runTool(name,floating);

    addFloatingButton(floating);
    toolButtons[name]={b,floating};
  }

  for(const [name,title,action] of [
    ['undo','Undo',undo],
    ['redo','Redo',redo]
  ]){
    const button=document.createElement('button');
    button.type='button';
    button.id=name==='undo'?'floatingUndo':'floatingRedo';
    button.className='float-btn';
    button.title=title;
    button.setAttribute('aria-label',title);
    button.innerHTML=icon(name);
    button.onclick=action;

    addFloatingButton(button);
  }
}

function enabled(name){
  const editable=ready(),node=currentNode();
  if(name==='comment'||name==='reset')return editable;
  if(!editable||!node)return false;
  if(name==='label')return true;
  if(name==='movement')return node.label!=='?' && node.label!=='EMPTY' &&
    (isHead(node.label)||isPhrase(node.label));
  if(name==='features'){
    return node.label!=='EMPTY' &&
      (isHead(node.label)||isPhrase(node.label));
  }
  
  if(name==='parent')return canInsertParentAbove(node);
  if(name==='delete')return node.uid!==root.uid;
  if(name==='branches')return availableBranchRoom(node)>0||
    (eligibleBranchParent(node)&&isPhrase(node.label)&&!node.children.length)||
    canInsertParentAbove(node)||canRemoveParentAbove(node);
  if(name==='word')return !node.trace&&!node.children.length&&(
    node.triangle_text!==null || (node.uid!==root.uid&&isHead(node.label)));
  return false;
}
function updateControls(){
  const node=currentNode();
  for(const [name,obj] of Object.entries(toolButtons)){
    const on=enabled(name);obj.b.disabled=!on;obj.floating.disabled=!on;
  }
  $('floatingUndo').disabled=!ready()||!undoStack.length;
  $('floatingRedo').disabled=!ready()||!redoStack.length;
  $('sidebarUndo').disabled=$('floatingUndo').disabled;
  $('sidebarRedo').disabled=$('floatingRedo').disabled;
  $('sidebarZoomOut').disabled=!ready();
  $('sidebarZoomIn').disabled=!ready();
  $('pngBtn').disabled=!ready();
  $('prevBtn').disabled=mode!=='practice'||!sentences.length||currentIndex<=0;
  $('nextBtn').disabled=mode!=='practice'||!sentences.length||currentIndex>=sentences.length-1;
  $('duplicateBtn').disabled=mode!=='practice'||!sentences.length||sentences.length>=1000;
  if(!node){
    $('selectionText').textContent=pendingMovement
      ?'Choose the movement destination (Escape cancels)'
      :'Click a node to select it';
    return;
  }
  let hint;
  if(pendingMovement)hint='Click the destination node, or press Escape to cancel';
  else if(node.trace)hint='Click Add/Edit movement to edit or remove the trace';
  else if(node.null_element)hint='Click Attach/Edit word to replace or remove Ø';
  else if(node.triangle_text!==null)hint='Click Attach/Edit word to edit or remove triangle';
  else if(enabled('branches'))hint='Use Expand tree to modify the branching structure';
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
function removeBrokenMovementArrows(){
  const nodes=[...walk(root)];
  const nodesById=new Map(nodes.map(node=>[node.uid,node]));
  const chains=new Map();

  for(const node of nodes){
    node.movement_arrows=node.movement_arrows.filter(id=>{
      const target=nodesById.get(id);

      if(!target||id===node.uid||node.label==='EMPTY')return false;

      const bothHeads=isHead(node.label)&&isHead(target.label);
      const bothPhrases=isPhrase(node.label)&&isPhrase(target.label);

      return bothHeads||bothPhrases;
    });
    if(node.movement_chain_id){
      const members=chains.get(node.movement_chain_id)??[];
      members.push(node);
      chains.set(node.movement_chain_id,members);
    }
  }
  // A chain needs at least two extant positions.
  for(const members of chains.values()){
    if(members.length!==1)continue;
    members[0].movement_chain_id='';
    members[0].movement_index='';
  }
}
function afterEdit(){
  removeBrokenMovementArrows();
  if(mode==='free')freeTree=clone(root);
  else if(sentences.length)workingTrees[currentIndex]=clone(root);
  if(mode==='practice'&&sentences.length)backupNoticeRequested=true;
  render();
}
function undo(){if(!undoStack.length)return;redoStack.push(clone(root));root=normalizeNode(undoStack.pop());if(selectedUid&&!findNode(root,selectedUid))selectedUid=null;afterEdit();}
function redo(){if(!redoStack.length)return;undoStack.push(clone(root));root=normalizeNode(redoStack.pop());if(selectedUid&&!findNode(root,selectedUid))selectedUid=null;afterEdit();}


function addBranches(anchor){
  const node=currentNode();if(!node||!enabled('branches'))return;
  const parentUid=node.uid,existing=node.children.length;
  const room=availableBranchRoom(node);
  const choices=[{group:`${heading(node.label)} · ${existing} daughter${existing===1?'':'s'}`}];
  const coordinationNote=count=>count===3&&node.label!=='TP'?' · coordination only':'';

  const insert=(index,count=1)=>{
    const parent=findNode(root,parentUid);
    if(!ready()||selectedUid!==parentUid||!parent||
       parent.children.length!==existing||
       availableBranchRoom(parent)<count||
       index<0||index>parent.children.length)return;
    checkpoint();
    const added=Array.from({length:count},()=>makeNode('?'));
    parent.children.splice(index,0,...added);
    selectedUid=added[0].uid;
    afterEdit();
  };

  if(room>0){
    if(existing===0){
      for(let count=1;count<=room;count++){
        choices.push({
          label:`Add ${count} daughter${count===1?'':'s'}${coordinationNote(count)}`,
          action:()=>insert(0,count)
        });
      }
    }else{
      const note=coordinationNote(existing+1);
      choices.push({label:`Add daughter on left${note}`,action:()=>insert(0)});
      if(existing===2){
        choices.push({label:`Add daughter between${note}`,action:()=>insert(1)});
      }
      choices.push({label:`Add daughter on right${note}`,action:()=>insert(existing)});
    }
  }

  if(eligibleBranchParent(node)&&isPhrase(node.label)&&existing===0){
    if(choices.length>1)choices.push({separator:true});
    choices.push({label:'Add triangle',action:()=>{
      if(selectedUid===parentUid)editTriangle();
    }});
  }

  const canInsert=canInsertParentAbove(node);
  const canRemove=canRemoveParentAbove(node);
  if(canInsert||canRemove){
    if(choices.length>1)choices.push({separator:true});
    if(canInsert){
      choices.push({label:'Insert parent above',action:()=>{
        if(selectedUid===parentUid)insertParentAbove();
      }});
    }
    if(canRemove){
      choices.push({label:'Remove parent above (unary only)',action:()=>{
        if(selectedUid===parentUid)removeParentAbove();
      }});
    }
  }
  showMenu(anchor,choices);
}

function insertParentAbove(){
  const node=currentNode();
  if(!node||!enabled('parent'))return;

  const existingParent=findParent(root,node.uid);
  const index=existingParent
    ?existingParent.children.findIndex(child=>child.uid===node.uid)
    :-1;
  if(existingParent&&index<0)return;

  checkpoint();
  const newParent=makeNode('?');
  newParent.children=[node];

  if(existingParent){
    existingParent.children[index]=newParent;
  }else{
    newParent.comments=node.comments;
    node.comments=[];
    root=newParent;
  }

  selectedUid=newParent.uid;
  afterEdit();
}
function removeParentAbove(){
  const node=currentNode();
  if(!ready()||!canRemoveParentAbove(node))return;

  const parent=findParent(root,node.uid);
  const grandparent=findParent(root,parent.uid);
  const index=grandparent
    ?grandparent.children.findIndex(child=>child.uid===parent.uid)
    :-1;
  if(grandparent&&index<0)return;

  checkpoint();
  node.comments=[...parent.comments,...node.comments];
  if(grandparent){
    grandparent.children[index]=node;
  }else{
    root=node;
  }

  selectedUid=node.uid;
  afterEdit();
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

// Step 2: Feature editor
// Feature rendering will be implemented in Step 3.

function editFeatures(){
  const node=currentNode();
  if(!node||!ready()||node.label==='EMPTY'||
     (!isHead(node.label)&&!isPhrase(node.label)))return;
  
  showDialog(`Attach/Edit feature — ${heading(node.label)}`,(body,footer)=>{
    const fields={};

    const addField=(key,title,help,presets,replacePreset=false)=>{
      const group=document.createElement('div');
      group.className='dialog-group';

      const caption=document.createElement('b');
      caption.textContent=title;
      group.append(caption);

      const field=document.createElement('input');
      field.type='text';
      field.autocomplete='off';
      field.spellcheck=false;
      field.value=node[key]??'';
      field.setAttribute('aria-label',title);
      group.append(field);
      fields[key]=field;

      const hint=document.createElement('div');
      hint.className='dialog-note';
      hint.textContent=help;
      group.append(hint);

      if(presets.length){
        const grid=document.createElement('div');
        grid.className='label-grid feature-presets';
        grid.style.marginTop='9px';

        for(const example of presets){
          const button=document.createElement('button');
          button.type='button';
          button.textContent=example;
          button.title=`Insert ${example}`;

          button.addEventListener('click',()=>{
            const value=field.value.trim();

            // Combine bracketed features:
            // [+Q] and [+WH] become [+Q, +WH].

            if(replacePreset){
              field.value=example;
            }
            else if(/^\[[^\]]+\]$/.test(value)&&/^\[[^\]]+\]$/.test(example)){
              const pieces=value.slice(1,-1)
                .split(',')
                .map(p=>p.trim())
                .filter(Boolean);

              for(const part of example.slice(1,-1).split(',').map(p=>p.trim())){
                if(part&&!pieces.includes(part)){
                  pieces.push(part);
                }
              }

              field.value=`[${pieces.join(', ')}]`;
            }
            else if(!value){
              field.value=example;
            }
            else if(!value.split(/\s*,\s*|\s+/).includes(example)){
              field.value=`${value} ${example}`;
            }

            field.focus();
            field.setSelectionRange(field.value.length,field.value.length);
          });

          grid.append(button);
        }

        group.append(grid);
      }

      body.append(group);
      return field;
    };

    // Features attached to heads and phrase labels

    addField(
      'label_features',
      'Head / phrase label features',
      'Shown as a subscript to the category label (C, T, DP, etc.).',
      [
        '[+Q]','[-Q]','[+WH]','[NOM]',
        '[+ACC]','[-ACC]'
      ]
    );

    // Features attached to lexical or null elements

    if(isHead(node.label)){
      addField(
        'lexical_features',
        'Lexical / null-element features',
        'For the word or Ø attached to this head. Custom entries are allowed.',
        [
          '[+Q]','[-Q]',
          'pres','past','perf','prog',
          'pass','active','neg','emph',
        ]
      );

      // Expanded FORM annotation

      addField(
        'form_feature',
        '[FORM] feature',
        'FORM features appear beneath an attached word or Ø. Attach a lexical item first; otherwise, the feature will not be visible on the tree.',
        [
          '[+V, FORM bare]',
          '[+V, FORM present]',
          '[+V, FORM preterite]',
          '[+V, FORM participle]',
          '[+V, FORM gerund]'
        ],
        true
      );
    }

    // Coindexation

    addField(
      'coindexation',
      'Coindexation',
      'Enter an index or ungrammatical coindexation marker.',
      ['i','j','k','*i','*j','*k'],
      true
    );

    // Save all feature changes

    const finish=()=>{
      const changes={};

      for(const [key,input] of Object.entries(fields)){
        changes[key]=input.value.trim();
      }

      if(Object.entries(changes).some(([key,value])=>node[key]!==value)){
        checkpoint();
        Object.assign(node,changes);
        afterEdit();
      }

      closeDialog();
    };

    addDialogButton(footer,'Cancel',closeDialog);
    addDialogButton(footer,'Save features',finish,true);

    requestAnimationFrame(()=>fields.label_features.focus());
  });
}
async function editTriangle(){
  const node=currentNode();
  if(!node||!isPhrase(node.label)||node.label==='EMPTY'||node.children.length||node.word_index!==null||node.trace)return;
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
    const old=node.null_element?'Ø':
      (node.word_index!==null&&node.word_index<freeWords.length?freeWords[node.word_index]:'');

    const {ok,value}=await inputDialog(
      'Attach word',
      'Enter a word (leave empty to remove):',
      old,
      {insertNull:true}
    );

    if(!ok)return;
    const word=value.trim();

    if(word.length>100||word.includes('\n')){
      await alertDialog('Invalid word','Enter a single short lexical item.');
      return;
    }

    if(word===old)return;

    checkpoint();

    if(word==='Ø'){
      node.word_index=null;
      node.null_element=true;
    }else if(!word){
      node.word_index=null;
      node.null_element=false;
    }else{
      node.word_index=freeWords.length;
      node.null_element=false;
      freeWords.push(word);
    }

    afterEdit();
    return;
  }

  const occupied=new Set(used());

  const items=[{
    label:'Insert Ø (null element)',
    action:()=>{
      if(node.null_element)return;
      checkpoint();
      node.word_index=null;
      node.null_element=true;
      afterEdit();
    }
  }];

  words().forEach((token,index)=>{
    if(!occupied.has(index)){
      items.push({
        label:`${index+1}.  ${token}`,
        action:()=>{
          if(node.word_index===index&&!node.null_element)return;
          checkpoint();
          node.word_index=index;
          node.null_element=false;
          afterEdit();
        }
      });
    }
  });

  if(node.word_index!==null||node.null_element){
    items.push({separator:true});
    items.push({
      label:node.null_element?'Remove null element':'Remove attached word',
      action:()=>{
        checkpoint();
        node.word_index=null;
        node.null_element=false;
        afterEdit();
      }
    });
  }

  showMenu(anchor,items);
}
// Movement is a visual notation layer. It never consumes worksheet words.
function canTrace(node){
  return !!node && node.uid!==root.uid && !node.children.length &&
    node.word_index===null && !node.null_element && node.triangle_text===null &&
    (isHead(node.label)||(isPhrase(node.label)&&node.label!=='EMPTY'));
}

async function insertOrEditTrace(){
  const node=currentNode();
  if(!node || (!node.trace&&!canTrace(node)))return;

  showDialog(node.trace?'Edit movement trace':'Insert movement trace',(body,footer)=>{
    const group=document.createElement('div');
    group.className='dialog-group';
    group.style.display='grid';
    group.style.rowGap='10px';

    const placementLabel=document.createElement('label');
    placementLabel.textContent='Placement';
    placementLabel.className='field-label';
    const placement=document.createElement('select');
    const placements=[['replace-label','Replace the head/phrase label']];
    if(isHead(node.label))placements.push(['below-head','Below the head label']);
    for(const [value,text] of placements){
      const option=document.createElement('option');
      option.value=value;
      option.textContent=text;
      placement.append(option);
    }
    placement.value=node.trace?.placement??(isHead(node.label)?'below-head':'replace-label');
    group.append(placementLabel,placement);

    const kindLabel=document.createElement('label');
    kindLabel.textContent='Subscript identifies';
    kindLabel.className='field-label';
    kindLabel.style.marginTop='16px';
    const kind=document.createElement('select');
    for(const [value,text] of [
      ['index','Movement-chain index (i, j, 1, 2, etc.)'],
      ['category','Syntactic category (DP, V, Voice, etc.)'],
      ['lexical','Lexical identity (have, be, etc.)']
    ]){
      const option=document.createElement('option');
      option.value=value;
      option.textContent=text;
      kind.append(option);
    }
    kind.value=node.trace?.kind??'index';
    group.append(kindLabel,kind);

    const subscriptLabel=document.createElement('label');
    subscriptLabel.textContent='Subscript (optional)';
    subscriptLabel.className='field-label';
    subscriptLabel.style.marginTop='16px';
    const subscript=document.createElement('input');
    subscript.type='text';
    subscript.maxLength=40;
    subscript.autocomplete='off';
    subscript.spellcheck=false;
    const examples={index:'',category:node.label,lexical:'have'};
    subscript.value=node.trace?.subscript??examples[kind.value];
    let previousKind=kind.value;
    kind.addEventListener('change',()=>{
      if(subscript.value.trim()===examples[previousKind]){
        subscript.value=examples[kind.value];
      }
      previousKind=kind.value;
    });
    group.append(subscriptLabel,subscript);

    const note=document.createElement('p');
    note.className='dialog-note';
    note.textContent='A trace never uses an Excel worksheet word. Binding coindexation is edited separately under Attach/Edit feature.';
    group.append(note);
    body.append(group);

    addDialogButton(footer,'Cancel',closeDialog);
    const save=()=>{
      const value=subscript.value.trim();
      const next={placement:placement.value,kind:kind.value,subscript:value};
      if(JSON.stringify(next)!==JSON.stringify(node.trace)){
        checkpoint();
        node.trace=next;
        // A manually reconfigured trace is no longer forced to display its old chain index.
        if(next.kind==='index'&&node.movement_chain_id&&value){
          node.movement_index=value;
          for(const partner of walk(root)){
            if(partner.movement_chain_id===node.movement_chain_id){
              partner.movement_index=value;
            }
          }
        }
        afterEdit();
      }
      closeDialog();
    };
    addDialogButton(footer,'Save trace',save,true);
    requestAnimationFrame(()=>subscript.focus());
  });
}

function moveLinkIndex(node){
  return node.movement_chain_id ? node.movement_index : '';
}

function unlinkMovementNode(node){
  const chainId=node.movement_chain_id;
  if(!chainId)return;
  checkpoint();
  node.movement_chain_id='';
  node.movement_index='';
  const remaining=[...walk(root)].filter(partner=>partner.movement_chain_id===chainId);
  if(remaining.length===1){
    remaining[0].movement_chain_id='';
    remaining[0].movement_index='';
  }
  afterEdit();
}

function beginMovement(kind){
  const source=currentNode();
  if(!source)return;
  pendingMovement={kind,sourceUid:source.uid};
  closeMenu();
  setInfo(kind==='arrow'
    ?'Movement arrow: click its landing position (Escape cancels).'
    :'Movement chain: click a trace position (Escape cancels).',15000);
  updateControls();
}

async function finishMovement(destinationUid){
  const action=pendingMovement;
  if(!action)return false;
  const source=findNode(root,action.sourceUid);
  const destination=findNode(root,destinationUid);
  if(!source||!destination){pendingMovement=null;return true;}
  if(source.uid===destination.uid){
    setInfo('Choose a different destination node. Press Escape to cancel.',10000);
    return true;
  }

  if(destination.label==='EMPTY'&&!isPhrase(source.label)){
    setInfo('Only a phrase can move into an empty specifier.',10000);
    return true;
  }

  const bothHeads=isHead(source.label)&&isHead(destination.label);
  const bothPhrases=isPhrase(source.label)&&isPhrase(destination.label);
  if(!bothHeads&&!bothPhrases){
    setInfo('Connect head to head, or phrase to phrase.',10000);
    return true;
  }

  if(action.kind==='arrow'){
    pendingMovement=null;
    if(!source.movement_arrows.includes(destination.uid)){
      checkpoint();
      source.movement_arrows.push(destination.uid);
      afterEdit();
    }else{
      render();
    }
    selectNode(source.uid);
    setInfo('Movement arrow added.');
    return true;
  }

  if(!destination.trace || source.trace){
    setInfo('Start at the overt moved constituent and finish at a trace.',10000);
    return true;
  }
  if(source.movement_chain_id && destination.movement_chain_id &&
     source.movement_chain_id!==destination.movement_chain_id){
    setInfo('That trace already belongs to another movement chain.',10000);
    return true;
  }

  const suggested=source.movement_index||destination.movement_index||'1';
  pendingMovement=null;
  const {ok,value}=await inputDialog(
    'Link movement chain',
    'Movement-chain index (use numbers to distinguish from binding indices):',
    suggested
  );
  if(!ok)return true;
  const index=value.trim();
  if(!index || index.length>20){
    await alertDialog('Invalid movement index','Enter an index of 1–20 characters.');
    return true;
  }
  checkpoint();
  const chainId=source.movement_chain_id||destination.movement_chain_id||uid();
  for(const partner of walk(root)){
    if(partner.uid===source.uid || partner.uid===destination.uid ||
       partner.movement_chain_id===chainId){
      partner.movement_chain_id=chainId;
      partner.movement_index=index;
      if(partner.trace?.kind==='index'&&partner.trace.subscript.trim())partner.trace.subscript=index;
    }
  }
  afterEdit();
  selectNode(source.uid);
  setInfo('Movement chain linked.');
  return true;
}

function editMovement(anchor){
  const node=currentNode();
  if(!node||!enabled('movement'))return;
  const items=[];

  if(node.trace){
    items.push({label:'Edit trace',action:insertOrEditTrace});
    items.push({label:'Remove trace',action:()=>{
      checkpoint();
      node.trace=null;
      node.movement_chain_id='';
      node.movement_index='';
      afterEdit();
    }});
  }else if(canTrace(node)){
    items.push({label:'Insert trace',action:insertOrEditTrace});
  }

  items.push({separator:true});
  items.push({label:'Draw movement arrow from this node',action:()=>beginMovement('arrow')});
  if(!node.trace){
    items.push({label:'Link this constituent to a trace',action:()=>beginMovement('chain')});
  }

  const incoming=[...walk(root)].filter(other=>other.movement_arrows.includes(node.uid));
  if(node.movement_arrows.length||incoming.length){
    items.push({label:'Remove arrows connected to this node',action:()=>{
      checkpoint();
      node.movement_arrows=[];
      for(const other of walk(root)){
        other.movement_arrows=other.movement_arrows.filter(id=>id!==node.uid);
      }
      afterEdit();
    }});
  }
  if(node.movement_chain_id){
    items.push({label:'Unlink this node from movement chain',action:()=>unlinkMovementNode(node)});
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
  pendingMovement=null;
  if(!ready()||!await confirmDialog('Reset tree','Discard the current tree and all comments and start again with an empty root?'))return;
  checkpoint();root=makeNode('?');selectedUid=null;afterEdit();
}
function runTool(name,anchor){
  if(!enabled(name))return;
  ({branches:()=>addBranches(anchor),parent:insertParentAbove,
    label:()=>changeLabel(anchor),word:()=>attachWord(anchor),
    features:editFeatures,movement:()=>editMovement(anchor),
    comment:addComment,delete:deleteNode,reset:resetTree})[name]?.();
}
function switchMode(next){
  if(next===mode||!['free','practice'].includes(next))return;
  if(mode==='free')freeTree=clone(root);
  else if(sentences.length)workingTrees[currentIndex]=clone(root);
  pendingMovement=null;
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
  pendingMovement=null;
  if(mode!=='practice'||index<0||index>=sentences.length||index===currentIndex)return;
  workingTrees[currentIndex]=clone(root);currentIndex=index;
  root=workingTrees[index]?normalizeNode(workingTrees[index]):makeNode('?');
  selectedUid=null;undoStack=[];redoStack=[];scrollReset=true;render();
}
async function saveAndGo(){
  if(mode!=='practice'||!sentences.length)return;
  const value=$('jumpInput').value.trim().toLowerCase(),index=exerciseIds.indexOf(value);
  if(index<0){await alertDialog('Invalid exercise number','Enter an existing exercise number.');return;}
  if(index===currentIndex){$('jumpInput').value=exerciseIds[currentIndex];return;}
  switchExercise(index);
  $('jumpInput').value=exerciseIds[currentIndex];
}
async function saveAndNext(){
  if(mode!=='practice'||currentIndex>=sentences.length-1)return;
  switchExercise(currentIndex+1);
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
  selectedUid=null;pendingMovement=null;undoStack=[];redoStack=[];scrollReset=true;
  backupNoticeRequested=true;
  render();
}

async function deleteDuplicate(){
  if(mode!=='practice'||!sentences.length)return;

  const label=exerciseIds[currentIndex];
  if(!/^\d+[a-z]+$/.test(label))return;

  if(!await confirmDialog(
    'Delete duplicate',
    `Delete exercise ${label} and its tree? This cannot be undone.`
  ))return;

  const removed=currentIndex;
  const original=label.replace(/[a-z]+$/,'');

  sentences.splice(removed,1);
  exerciseIds.splice(removed,1);

  workingTrees=Object.fromEntries(
    Object.entries(workingTrees)
      .filter(([index])=>Number(index)!==removed)
      .map(([index,tree])=>[
        Number(index)>removed?Number(index)-1:Number(index),
        tree
      ])
  );

  currentIndex=exerciseIds.indexOf(original);

  root=workingTrees[currentIndex]
    ?normalizeNode(workingTrees[currentIndex])
    :makeNode('?');

  selectedUid=null;
  undoStack=[];
  redoStack=[];
  scrollReset=true;

  backupNoticeRequested=true;
  render();

  setInfo(`Deleted duplicate exercise ${label}`);
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
let lastSuccessfulBrowserBackup=null;
let backupNoticeRequested=false;
let backupNoticeTimer=null;
let lastBackupNoticeAt=0;
let backupFailureShown=false;

function backupWorkInBrowser(){
  if(mode!=='practice'||!sentences.length)return;

  try{
    const content=JSON.stringify(workDocument());
    if(content===lastSuccessfulBrowserBackup)return;

    localStorage.setItem('syntax-tree-builder-browser-backup-v1',content);
    lastSuccessfulBrowserBackup=content;
    backupFailureShown=false;

    if(!backupNoticeRequested)return;
    backupNoticeRequested=false;
    clearTimeout(backupNoticeTimer);

    backupNoticeTimer=setTimeout(()=>{
      if(mode!=='practice')return;
      if(lastBackupNoticeAt&&Date.now()-lastBackupNoticeAt<20000)return;
      if($('bottomInfo')?.textContent?.trim())return;

      lastBackupNoticeAt=Date.now();
      showBackupNotice();
    },1800);
  }catch(error){
    clearTimeout(backupNoticeTimer);
    backupNoticeTimer=null;

    if(!backupFailureShown){
      backupFailureShown=true;
      setInfo('Browser backup unavailable. Use Download Progress to keep your work.');
    }
  }
}
async function restoreBrowserBackup(){
  let parsed;

  try{
    const saved=localStorage.getItem('syntax-tree-builder-browser-backup-v1');
    if(!saved)return;

    parsed=readProgress(JSON.parse(saved));
  }catch(error){
    await alertDialog('Cannot restore browser backup',
      'The previous browser backup could not be read. Use Open Progress if you downloaded a progress file.');
    return;
  }

  if(!await confirmDialog('Restore previous work',
    `An automatic backup for "${parsed.name}" was found on this device. Continue where you left off?`))return;

  if(mode==='free')freeTree=clone(root);

  mode='practice';
  bankName=parsed.name;
  sentences=parsed.sentences;
  exerciseIds=parsed.exercise_ids;
  originalCount=parsed.original_count;
  workingTrees=parsed.trees;
  currentIndex=parsed.current_index;

  root=workingTrees[currentIndex]
    ?normalizeNode(workingTrees[currentIndex])
    :makeNode('?');

  selectedUid=root.uid;
  workHandle=null;
  workFilename=null;
  undoStack=[];
  redoStack=[];
  scrollReset=true;

  render();
  setInfo('Previous work restored. Use Download Progress to keep a separate copy.');
}
async function saveProgress(interactive=true){
  if(mode!=='practice'||!sentences.length){
    if(interactive)await alertDialog('Download progress',mode!=='practice'
      ?'Editable progress downloads are available in Practice/Exam Mode. You can export a Free Mode tree as PNG.'
      :'Import an XLSX worksheet first.');
    return false;
  }
  try{
    const filename=workFilename??'syntax_tree_progress.stb.json';
    const text=JSON.stringify(workDocument(),null,2);
    downloadFile(filename,text,'application/json;charset=utf-8');
    setInfo(`Download started: ${filename}. Check your Downloads folder.`);
    return true;
  }catch(e){
    await alertDialog('Cannot download progress',e.message);
    return false;
  }
}
async function openProgress(file){
  pendingMovement=null;
  if(mode!=='practice')return;
  try{
    const parsed=readProgress(JSON.parse(await file.text()));

    if(sentences.length&&!await confirmDialog(
      'Replace current work',
      'Opening another progress file will replace your current worksheet and any unsaved changes. Continue?'
    ))return;

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
function labelSubscripts(node){
  const parts=[];
  const feature=String(node.label_features??'').trim();
  const index=String(node.coindexation??'').trim();

  if(feature)parts.push({text:feature,italic:false});
  if(index)parts.push({
    text:index.startsWith('*')?`(${index})`:index,
    italic:true
  });

  return parts;
}

function traceParts(node){
  if(!node.trace || !node.trace.subscript.trim())return [];
  const subscript=node.trace.kind==='index' && node.movement_chain_id
    ?node.movement_index:node.trace.subscript;
  return [{text:subscript,italic:node.trace.kind!=='category'}];
}

function displayLabel(node){
  return node.trace?.placement==='replace-label'?'t':node.label;
}

function displayLabelParts(node){
  if(node.trace?.placement==='replace-label')return traceParts(node);
  const parts=labelSubscripts(node);
  // A movement-chain number is stored separately from ordinary binding coindexation.
  if(node.movement_chain_id&&!node.trace){
    const index=node.coindexation?`m${node.movement_index}`:node.movement_index;
    parts.push({text:index,italic:true});
  }
  return parts;
}

function lexicalSubscripts(node){
  const feature=String(node.lexical_features??'').trim();
  return feature?[{
    text:feature,
    italic:false
  }]:[];
}

function annotatedWidth(base,parts=[],bold=false){
  let width=textWidth(base,`${bold?'bold ':''}20px Georgia`);

  for(const part of parts){
    width+=3+textWidth(
      part.text,
      `${part.italic?'italic ':''}13px Georgia`
    );
  }
  return width;
}

function widthForLabel(label,parts=[],bold=false){
  if(label==='EMPTY')return 48;
  const mainWidth=textWidth(label,`${bold?'bold ':''}20px Georgia`);
  const subWidth=annotatedWidth(label,parts,bold)-mainWidth;
  return Math.max(76,mainWidth+2*subWidth+34);
}

function appendAnnotatedText(parent,base,parts,x,y,{bold=false,italic=false,middle=false,color=INK}={}){
  const font=`${bold?'bold ':''}${italic?'italic ':''}20px Georgia`;
  let left=x-textWidth(base,font)/2;

  const mainAttrs={
    x:left,y,
    'font-family':'Georgia,serif',
    'font-size':20,
    fill:color
  };

  if(bold)mainAttrs['font-weight']='bold';
  if(italic)mainAttrs['font-style']='italic';
  if(middle)mainAttrs['dominant-baseline']='middle';

  parent.append(svgEl('text',mainAttrs,base));
  left+=textWidth(base,font);

  for(const part of parts){
    left+=3;
    const attrs={
      x:left,
      y:y+8,
      'font-family':'Georgia,serif',
      'font-size':13,
      fill:color
    };

    if(part.italic)attrs['font-style']='italic';
    if(middle)attrs['dominant-baseline']='middle';

    parent.append(svgEl('text',attrs,part.text));
    left+=textWidth(
      part.text,
      `${part.italic?'italic ':''}13px Georgia`
    );
  }
}
function formAnnotationWidth(node){
  const form=String(node.form_feature??'').trim();
  return form?textWidth(form,'15px Georgia')+34:0;
}

function layoutTree(){
  const labelWidths=new Map(),points=new Map();
  const terminals=[],triangles=[],edges=[];
  const text=words();

  // A contour records how far a subtree extends at each depth.
  // Unlike a single bounding width, it lets shallow sisters stay close
  // even when one sister contains a large, deeply branching subtree.
  function build(node,depth=0){
    if(depth>35)throw Error('Tree is too deep to display.');

    const labelWidth=widthForLabel(displayLabel(node),displayLabelParts(node),true);
    labelWidths.set(node.uid,labelWidth);
    const contours=[{left:-labelWidth/2,right:labelWidth/2}];
    const positions=new Map([[node.uid,{x:0,depth:0}]]);

    if(node.children.length){
      const children=node.children.map(child=>build(child,depth+1));
      const combined=[];
      const offsets=[];

      for(const child of children){
        let offset=0;
        for(let level=0;level<child.contours.length;level++){
          const earlier=combined[level],current=child.contours[level];
          if(earlier&&current){
            offset=Math.max(offset,earlier.right+H_GAP-current.left);
          }
        }
        offsets.push(offset);
        child.contours.forEach((bounds,level)=>{
          const left=bounds.left+offset,right=bounds.right+offset;
          if(!combined[level])combined[level]={left,right};
          else{
            combined[level].left=Math.min(combined[level].left,left);
            combined[level].right=Math.max(combined[level].right,right);
          }
        });
      }

      // Center the mother over its immediate daughters, NOT over every
      // terminal dominated by those daughters. Unary edges stay vertical.
      const center=offsets.length===1
        ?offsets[0]:(offsets[0]+offsets[offsets.length-1])/2;

      children.forEach((child,index)=>{
        const shift=offsets[index]-center;
        for(const [id,p] of child.positions){
          positions.set(id,{x:p.x+shift,depth:p.depth+1});
        }
      });
      combined.forEach((bounds,level)=>{
        contours[level+1]={
          left:bounds.left-center,
          right:bounds.right-center
        };
      });
    }else if(node.triangle_text!==null){
      const span=Math.max(labelWidth,textWidth(node.triangle_text,'20px Georgia')+34,125);
      const half=Math.max(65,span/2-4);
      contours[1]={left:-half-8,right:half+8};
    }else{
      const terminal=node.trace?.placement==='below-head'?'t':
        node.null_element?'Ø':
        node.word_index!==null&&node.word_index>=0&&node.word_index<text.length
          ?text[node.word_index]:null;

      if(terminal!==null){
        const parts=node.trace?.placement==='below-head'?traceParts(node):lexicalSubscripts(node);
        const main=textWidth(terminal,'20px Georgia');
        const suffix=annotatedWidth(terminal,parts)-main;
        const form=String(node.form_feature??'').trim();
        const formHalf=form?textWidth(form,'15px Georgia')/2:0;
        contours[1]={
          left:-Math.max(38,main/2+12,formHalf+12),
          right:Math.max(38,main/2+suffix+12,formHalf+12)
        };
      }
    }

    return {contours,positions};
  }

  const tree=build(root);
  const left=Math.min(...tree.contours.filter(Boolean).map(bounds=>bounds.left));
  const right=Math.max(...tree.contours.filter(Boolean).map(bounds=>bounds.right));
  const width=right-left;
  const sceneW=Math.max(900,width+2*SIDE);
  const shiftX=(sceneW-width)/2-left;
  let maxDepth=0;

  for(const node of walk(root)){
    const position=tree.positions.get(node.uid);
    const x=position.x+shiftX;
    const y=TOP+position.depth*V_GAP;
    points.set(node.uid,{x,y});
    maxDepth=Math.max(maxDepth,position.depth);

    for(const child of node.children){
      const p=tree.positions.get(child.uid);
      edges.push({
        x1:x,y1:y+47,
        x2:p.x+shiftX,y2:TOP+p.depth*V_GAP
      });
    }

    if(node.triangle_text!==null){
      const span=Math.max(labelWidths.get(node.uid),
        textWidth(node.triangle_text,'20px Georgia')+34,125);
      triangles.push({phrase:node.triangle_text,x,y,span});
      maxDepth=Math.max(maxDepth,position.depth+1);
    }else if(!node.children.length){
      const terminal=node.trace?.placement==='below-head'?'t':
        node.null_element?'Ø':
        node.word_index!==null&&node.word_index>=0&&node.word_index<text.length
          ?text[node.word_index]:null;
      if(terminal!==null){
        terminals.push({
          text:terminal,
          parts:node.trace?.placement==='below-head'?traceParts(node):lexicalSubscripts(node),
          form:node.trace?'':String(node.form_feature??'').trim(),
          x,y:y+39,
          italic:node.trace?.placement==='below-head'
        });
        maxDepth=Math.max(maxDepth,position.depth+1);
      }
    }
  }

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
  for(const t of layout.terminals){
    const mainWidth=textWidth(t.text,'20px Georgia');
    const subWidth=annotatedWidth(t.text,t.parts)-mainWidth;

    add(t.x-mainWidth/2,t.y+4,t.x+mainWidth/2+subWidth,t.y+40);

    if(t.form){
      const fw=textWidth(t.form,'15px Georgia');
      add(t.x-fw/2,t.y+41,t.x+fw/2,t.y+60);
    }
  }
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
function getTreePalette(){
  // Theme colors are read only when the tree is drawn; SVG attributes
  // then make the same colors work in the PNG export as on the screen.
  const css=getComputedStyle(document.documentElement);
  const get=(variable,fallback)=>css.getPropertyValue(variable).trim()||fallback;
  return {
    bg:get('--ui-canvas','#ffffff'),
    ink:get('--tree-ink','#14233e'),
    terminal:get('--tree-terminal','#24334d'),
    edge:get('--tree-edge','#53647c'),
    dots:get('--tree-dots','#e6ecf5'),
    selection:get('--tree-selection','#1747ad'),
    hover:get('--tree-hover','#9daabc'),
    commentBg:get('--tree-comment-bg','#eaf2ff'),
    commentBorder:get('--tree-comment-border','#a9c8ee'),
    commentTitle:get('--tree-comment-title','#35639b')
  };
}
function applyZoom(){
  const svg=$('treeSvg');
  if(!svg)return;
  svg.setAttribute('width',String(sceneWidth*zoom));
  svg.setAttribute('height',String(sceneHeight*zoom));
  svg.style.width=(sceneWidth*zoom)+'px';
  svg.style.height=(sceneHeight*zoom)+'px';
  const stage=$('treeStage');
  stage.style.width=`${Math.max(sceneWidth*zoom,$('scrollCanvas').clientWidth)}px`;
  stage.style.height=`${Math.max(sceneHeight*zoom,$('scrollCanvas').clientHeight)}px`;
  svg.style.margin='auto';
}
// Cache arrow paths until visible tree geometry changes.
let movementGeometryKey='';
const movementPathCache=new Map();

// Compute independent, smooth movement arcs in unscaled tree coordinates.
function movementRoutes(layout){
  const nodes=[...walk(root)];
  if(!nodes.some(n=>n.movement_arrows.length))return [];
  const geometryKey=JSON.stringify([
    layout.sceneW,layout.sceneH,[...layout.points],layout.terminals,layout.triangles,layout.edges,
    nodes.map(n=>[n.uid,n.children.map(c=>c.uid),displayLabel(n),displayLabelParts(n),n.trace?.placement])
  ]);
  if(geometryKey!==movementGeometryKey){
    movementGeometryKey=geometryKey;
    movementPathCache.clear();
  }
  const routes=[];
  const pending=[];
  for(const source of nodes){
    for(const targetId of source.movement_arrows){
      const cacheKey=JSON.stringify([source.uid,targetId]);
      if(movementPathCache.has(cacheKey))routes.push(movementPathCache.get(cacheKey));
      else pending.push({source,targetId,cacheKey});
    }
  }
  if(!pending.length)return routes;
  const byId=new Map(nodes.map(n=>[n.uid,n]));
  const parents=new Map();
  const bounds=new Map(),anchors=new Map(),boxes=[],branches=[];
  const key=(x,y)=>`${x}:${y}`;
  const terminals=new Map(layout.terminals.map(t=>[key(t.x,t.y-39),t]));
  const triangles=new Map(layout.triangles.map(t=>[key(t.x,t.y),t]));
  const rect=(l,r,t,b)=>({l,r,t,b});
  const union=(a,b)=>rect(Math.min(a.l,b.l),Math.max(a.r,b.r),
    Math.min(a.t,b.t),Math.max(a.b,b.b));
  const pad=(a,p)=>rect(a.l-p,a.r+p,a.t-p,a.b+p);

  // Measure visible material once, then collect subtree bounds bottom-up.
  for(const n of nodes){
    const p=layout.points.get(n.uid);
    for(const child of n.children)parents.set(child.uid,n.uid);
    const label=displayLabel(n),parts=displayLabelParts(n);
    const font=n.trace?.placement==='replace-label'?'italic 20px Georgia':'bold 20px Georgia';
    const half=label==='EMPTY'?0:textWidth(label,font)/2;
    const suffix=parts.reduce((w,part)=>w+3+textWidth(part.text,
      `${part.italic?'italic ':''}13px Georgia`),0);
    let b=rect(p.x-half,p.x+half+suffix,p.y+7,p.y+(parts.length?43:37));
    if(label!=='EMPTY')boxes.push(pad(b,6));
    const t=terminals.get(key(p.x,p.y));
    const tri=triangles.get(key(p.x,p.y));
    if(t){
      const main=textWidth(t.text,'20px Georgia');
      const extra=annotatedWidth(t.text,t.parts)-main;
      const fw=t.form?textWidth(t.form,'15px Georgia')/2:0;
      const tb=rect(t.x-Math.max(main/2,fw),t.x+Math.max(main/2+extra,fw),
        t.y+4,t.y+(t.form?61:t.parts.length?43:36));
      boxes.push(pad(tb,6));b=union(b,tb);
    }
    if(tri){
      const w=Math.max(65,tri.span/2-4);
      const tb=rect(p.x-w,p.x+w,p.y+47,p.y+130);
      boxes.push(pad(tb,6));b=union(b,tb);
    }
    bounds.set(n.uid,b);
    anchors.set(n.uid,{bottom:b.b,left:p.x,right:p.x});
  }
  for(let i=nodes.length-1;i>=0;i--){
    const n=nodes[i];
    let b=bounds.get(n.uid),a=anchors.get(n.uid);
    for(const child of n.children){
      b=union(b,bounds.get(child.uid));
      const c=anchors.get(child.uid);
      if(c.bottom>a.bottom+0.5)a={...c};
      else if(Math.abs(c.bottom-a.bottom)<=0.5)a={bottom:Math.max(a.bottom,c.bottom),
        left:Math.min(a.left,c.left),right:Math.max(a.right,c.right)};
    }
    bounds.set(n.uid,b);anchors.set(n.uid,a);
  }
  for(const e of layout.edges){
    const dx=e.x2-e.x1,dy=e.y2-e.y1,len=Math.hypot(dx,dy)||1;
    branches.push({x:e.x1,y:e.y1,ux:dx/len,uy:dy/len,len,
      box:pad(rect(Math.min(e.x1,e.x2),Math.max(e.x1,e.x2),
        Math.min(e.y1,e.y2),Math.max(e.y1,e.y2)),7)});
  }
  const anchor=(node,target)=>{
    const p=layout.points.get(node.uid),a=anchors.get(node.uid);
    if(target&&displayLabel(node)==='EMPTY')return {x:p.x,y:p.y+23.5};
    return {x:(a.left+a.right)/2,y:a.bottom+(target?17:11)};
  };
  const contains=(b,p)=>p.x>=b.l&&p.x<=b.r&&p.y>=b.t&&p.y<=b.b;
  const overlaps=(a,b)=>a.l<=b.r&&a.r>=b.l&&a.t<=b.b&&a.b>=b.t;
  // Test the entire line segment, not only the sampled endpoints.
  const hitsRect=(a,b,r)=>{
    let lo=0,hi=1;
    for(const [v,d,min,max] of [[a.x,b.x-a.x,r.l,r.r],[a.y,b.y-a.y,r.t,r.b]]){
      if(Math.abs(d)<1e-9){if(v<min||v>max)return false;continue;}
      const p=(min-v)/d,q=(max-v)/d;
      lo=Math.max(lo,Math.min(p,q));hi=Math.min(hi,Math.max(p,q));
      if(lo>hi)return false;
    }
    return true;
  };
  const project=(p,e)=>({x:(p.x-e.x)*e.ux+(p.y-e.y)*e.uy,
    y:-(p.x-e.x)*e.uy+(p.y-e.y)*e.ux});
  const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const add=(a,b,k=1)=>({x:a.x+k*b.x,y:a.y+k*b.y});
  const distLine=(p,a,b)=>{
    const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy;
    const t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)):0;
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
  };
  // Flatten each cubic adaptively to subpixel tolerance for collision tests.
  const flatten=(a,b,c,d,out,depth=0)=>{
    if(depth>=12||Math.max(distLine(b,a,d),distLine(c,a,d))<=0.75){out.push(d);return;}
    const ab=mid(a,b),bc=mid(b,c),cd=mid(c,d);
    const abc=mid(ab,bc),bcd=mid(bc,cd),m=mid(abc,bcd);
    flatten(a,ab,abc,m,out,depth+1);flatten(m,bcd,cd,d,out,depth+1);
  };
  const rounded=v=>Math.round(v*100)/100;
  const xy=p=>`${rounded(p.x)} ${rounded(p.y)}`;
  for(const {source,targetId,cacheKey} of pending){
    const target=byId.get(targetId);if(!target||target===source)continue;
    const start=anchor(source,false),end=anchor(target,true);
    const dx=end.x-start.x,dy=end.y-start.y;
    const length=Math.hypot(dx,dy);if(length<0.01)continue;
    const side=dx<=0?-1:1;
    const m=mid(start,end),h={x:dx/2,y:dy/2};
    const pathNodes=new Set();
    for(const n of [source,target]){
      for(let id=n.uid;id;id=parents.get(id))pathNodes.add(id);
    }
    // Protect entire intervening sister subtrees, including their lower branches.
    const protectedBoxes=[];
    const left=Math.min(start.x,end.x),right=Math.max(start.x,end.x);
    for(const id of pathNodes){
      for(const child of byId.get(id).children){
        if(pathNodes.has(child.uid))continue;
        const p=layout.points.get(child.uid),b=pad(bounds.get(child.uid),10);
        if(p.x>left+3&&p.x<right-3&&p.y<=Math.max(start.y,end.y)&&
           !contains(b,start)&&!contains(b,end))protectedBoxes.push(b);
      }
    }
    const obstacles=[...boxes,...protectedBoxes];
    let best=null;
    const test=(bx,by,preference,underpass=null)=>{
      // Two quarter-ellipse cubics with matching tangents at the midpoint.
      // The bow is always toward the movement side and/or downward.
      const bow={x:side*bx,y:by},k=0.5522847498;
      let peak=add(m,bow);
      let c1=add(start,bow,k),c2=add(peak,h,-k);
      let c3=add(peak,h,k),c4=add(end,bow,k);
      if(underpass){
        // Two rounded shoulders meet at the actual lowest point.
        // Unlike a tilted ellipse, this keeps the bottom at the chosen depth.
        peak={x:underpass.x,y:underpass.y};
        const shoulder=0.88;
        c1={x:start.x,y:start.y+shoulder*(peak.y-start.y)};
        c2={x:peak.x+shoulder*(start.x-peak.x),y:peak.y};
        c3={x:peak.x+shoulder*(end.x-peak.x),y:peak.y};
        c4={x:end.x,y:end.y+shoulder*(peak.y-end.y)};
      }
      const points=[start];
      flatten(start,c1,c2,peak,points);flatten(peak,c3,c4,end,points);
      let b=rect(start.x,start.x,start.y,start.y);
      for(const p of points)b=union(b,rect(p.x,p.x,p.y,p.y));
      const broad=pad(b,2);
      const localBoxes=obstacles.filter(o=>overlaps(o,broad));
      const localBranches=branches.filter(e=>overlaps(e.box,broad));
      const touched=new Set();
      for(let i=1;i<points.length;i++){
        const a=points[i-1],z=points[i];
        const s=rect(Math.min(a.x,z.x),Math.max(a.x,z.x),Math.min(a.y,z.y),Math.max(a.y,z.y));
        for(const o of localBoxes){if(!touched.has(o)&&overlaps(s,o)&&hitsRect(a,z,o))touched.add(o);}
        for(const e of localBranches){
          if(!touched.has(e)&&overlaps(s,e.box)&&hitsRect(project(a,e),project(z,e),rect(-7,e.len+7,-7,7)))touched.add(e);
        }
      }
      const score=preference+Math.max(0,b.b-Math.max(start.y,end.y))*0.6+
        Math.max(0,left-b.l,b.r-right)*0.35;
      const candidate={d:`M${xy(start)} C${xy(c1)} ${xy(c2)} ${xy(peak)} C${xy(c3)} ${xy(c4)} ${xy(end)}`,
        bounds:b,hits:touched.size,score};
      if(!best||candidate.hits<best.hits||(candidate.hits===best.hits&&score<best.score))best=candidate;
      return candidate;
    };
    // Prefer near-semicircles; use a compact elliptical bow for long moves.
    let baseX=Math.min(190,Math.abs(dy)*0.5);
    let baseY=Math.min(170,Math.abs(dx)*0.5);
    // For downward movement, avoid a bow parallel to the chord.
    if(dy>0){
      if(Math.abs(dx)>=dy*0.5)baseX=0;
      else baseY=0;
    }
    for(const scale of [1,1.25,1.6]){
      const trial=test(baseX*scale,baseY*scale,Math.abs(1-scale)*20);
      if(!trial.hits)break;
    }
    if(Math.abs(dx)>8&&(best.hits||best.bounds.b>Math.max(start.y,end.y)+80)){
      // Look for a rounded, shallow U below the intervening material.
      // Its deepest point is set directly instead of scaling the entire ellipse.
      const between=[...obstacles,...branches.map(e=>e.box)].filter(o=>
        o.l>left+1&&o.r<right-1);
      const lowest=between.reduce((b,o)=>Math.max(b,o.b),Math.max(start.y,end.y));
      const deep=between.filter(o=>o.b>=lowest-35);
      const lowX=deep.length
        ?(Math.min(...deep.map(o=>o.l))+Math.max(...deep.map(o=>o.r)))/2:m.x;
      const xMin=left+(right-left)*0.2,xMax=right-(right-left)*0.2;
      const centers=[...new Set([Math.max(xMin,Math.min(xMax,lowX)),m.x])];
      const floor=lowest+12;
      for(const x of centers){
        let lo=floor;
        for(const extra of [0,16,32,64,112,180]){
          const y=floor+extra;
          const trial=test(0,0,22,{x,y});
          if(trial.hits){lo=y;continue;}
          let hi=y;
          for(let i=0;i<5&&hi-lo>2;i++){
            const next=(lo+hi)/2;
            if(test(0,0,22,{x,y:next}).hits)lo=next;
            else hi=next;
          }
          break;
        }
        if(!best.hits&&best.bounds.b<=floor+20)break;
      }
    }
    if(best.hits&&Math.abs(dx)>8){
      // Underpass: with zero horizontal bow, x is monotonic. Estimate the
      // depth needed to pass below all intervening material, then verify it.
      // Only obstacles strictly between the endpoints constrain this estimate.
      let required=Math.max(35,baseY);
      for(const o of [...obstacles,...branches.map(e=>e.box)]){
        if(o.l<=left+1||o.r>=right-1)continue;
        for(const x of [o.l,o.r]){
          const u=(x-start.x)/dx;
          const height=Math.sqrt(Math.max(0,4*u*(1-u)));
          if(height>0.01)required=Math.max(required,(o.b+15-(start.y+dy*u))/height);
        }
      }
      const limit=Math.max(100,layout.sceneH-Math.min(start.y,end.y)+80);
      required=Math.min(required*1.05,limit);
      // Try compact downward bows first; then the calculated clearance.
      // Find a clear downward arc, then tighten it with a bounded search.
      // A pure downward bow never overshoots either endpoint horizontally.
      const depths=[baseY*1.5+25,baseY*2+45,required,Math.min(limit,required*1.25+20),limit];
      for(const bx of [0,Math.min(baseX*0.18,24)]){
        let lo=0;
        for(const depth of [...new Set(depths)].sort((a,b)=>a-b)){
          const trial=test(bx,depth,30);
          if(trial.hits){lo=depth;continue;}
          let hi=depth;
          for(let i=0;i<7&&hi-lo>3;i++){
            const mid=(lo+hi)/2;
            if(test(bx,mid,30).hits)lo=mid;
            else hi=mid;
          }
          break;
        }
        if(!best.hits)break;
      }
    }
    if(best.hits){
      // Extra side clearance for unusually tall, narrow or nearly vertical trees.
      for(const scale of [2,3])test(Math.max(24,baseX*scale),baseY*scale,70+scale*10);
    }
    movementPathCache.set(cacheKey,best);
  }
  return nodes.flatMap(n=>n.movement_arrows.map(id=>movementPathCache.get(JSON.stringify([n.uid,id]))).filter(Boolean));
}

function createTreeSvg(layout,comments){
  const palette=getTreePalette();
  const svg=$('treeSvg');svg.replaceChildren();
  const routes=movementRoutes(layout);
  const hasMovementArrows=routes.length>0;
  const maxRight=Math.max(layout.sceneW+(hasMovementArrows?150:0),...comments.map(c=>c.x+c.w+30),...routes.map(r=>r.bounds.r+30));
  const maxBottom=Math.max(layout.sceneH+(hasMovementArrows?120:0),...comments.map(c=>c.y+c.h+30),...routes.map(r=>r.bounds.b+30));
  const arrowPadding=hasMovementArrows?150:0;
  const minX=Math.min(-arrowPadding,...comments.map(c=>c.x-30),...routes.map(r=>r.bounds.l-30));
  const minY=Math.min(0,...comments.map(c=>c.y-30),...routes.map(r=>r.bounds.t-30));
  const offsetX=-minX,offsetY=-minY;
  sceneWidth=Math.max(1,maxRight-minX);sceneHeight=Math.max(1,maxBottom-minY);
  svg.setAttribute('viewBox',`0 0 ${sceneWidth} ${sceneHeight}`);
  applyZoom();
  const defs=svgEl('defs');const dots=svgEl('pattern',{id:'dots',width:24,height:24,patternUnits:'userSpaceOnUse'});
  dots.append(svgEl('circle',{cx:0,cy:0,r:.75,fill:palette.dots}));defs.append(dots);svg.append(defs);
  svg.append(svgEl('rect',{width:sceneWidth,height:sceneHeight,fill:palette.bg}));
  svg.append(svgEl('rect',{width:sceneWidth,height:sceneHeight,fill:'url(#dots)'}));
  const content=svgEl('g',{transform:`translate(${offsetX} ${offsetY})`});svg.append(content);
  for(const e of layout.edges){
    content.append(svgEl('line',{x1:e.x1,y1:e.y1,x2:e.x2,y2:e.y2,stroke:palette.edge,'stroke-width':2,'stroke-linecap':'round'}));
  }
  // Draw each independently calculated path; preserve the theme and thin stroke.
  const arrowGroup=svgEl('g',{'class':'movement-arrows','pointer-events':'none'});
  if(routes.length){
    const markerId='movement-arrowhead';
    const marker=svgEl('marker',{
      id:markerId,viewBox:'0 0 12 12',refX:11,refY:6,
      markerWidth:7,markerHeight:7,orient:'auto-start-reverse'
    });
    marker.append(svgEl('path',{d:'M1 1 L11 6 L1 11 Z',fill:palette.selection}));
    defs.append(marker);
    for(const route of routes){
      arrowGroup.append(svgEl('path',{
        d:route.d,fill:'none',stroke:palette.bg,'stroke-width':4.5,
        'stroke-linecap':'round','stroke-linejoin':'round'
      }));
      arrowGroup.append(svgEl('path',{
        d:route.d,fill:'none',stroke:palette.selection,'stroke-width':1.7,
        'stroke-linecap':'round','stroke-linejoin':'round',
        'marker-end':`url(#${markerId})`
      }));
    }
  }
  content.append(arrowGroup);
  for(const n of walk(root)){
    const point=layout.points.get(n.uid),w=layout.labelWidths.get(n.uid);
    const label=displayLabel(n);
    const parts=displayLabelParts(n);
    const mainWidth=textWidth(label,n.trace?.placement==='replace-label'?'italic 20px Georgia':'bold 20px Georgia');
    const annotated=label!=='EMPTY'&&parts.length>0;
    const hitX=annotated?w/2-mainWidth/2-12:0;
    const hitW=annotated?annotatedWidth(label,parts,true)+24:w;

    const group=svgEl('g',{
      'class':'tree-node',
      transform:`translate(${point.x-w/2} ${point.y})`,
      'data-uid':n.uid,
      tabindex:0,
      role:'button',
      'aria-label':heading(n.label)
    });

    group.append(svgEl('rect',{
      'class':'hit',
      x:hitX,y:0,width:hitW,height:47,
      fill:'transparent'
    }));

    if(label==='EMPTY')group.append(svgEl('rect',{
      'class':'hover-frame',
      x:1,y:1,width:w-2,height:45,rx:10,
      fill:'none',stroke:palette.hover,
      'stroke-width':1,
      'stroke-dasharray':'4 4',
      opacity:0
    }));

    const frame=svgEl('rect',{
      'class':'selection-frame',
      x:annotated?hitX+1:1,
      y:1,
      width:annotated?hitW-2:w-2,
      height:45,
      rx:10,
      fill:'none',
      stroke:palette.selection,
      'stroke-width':3,
      visibility:n.uid===selectedUid?'visible':'hidden'
    });

    group.append(frame);

    if(label!=='EMPTY'){
      appendAnnotatedText(group,label,parts,w/2,24,{
        bold:n.trace?.placement!=='replace-label',
        italic:n.trace?.placement==='replace-label',
        middle:true,
        color:palette.ink
      });
    }
    group.style.touchAction='manipulation';

    group.addEventListener('click',event=>{
      event.stopPropagation();
      if(pendingMovement){
        finishMovement(n.uid);
        return;
      }
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
      fill:'none',stroke:palette.edge,'stroke-width':2,'stroke-linejoin':'round'}));
    content.append(svgEl('text',{x:t.x,y:base+25,'text-anchor':'middle',
      'font-family':'Georgia,serif','font-size':20,fill:palette.terminal},t.phrase));
  }
  for(const t of layout.terminals){
    appendAnnotatedText(content,t.text,t.parts,t.x,t.y+28,{color:palette.terminal,italic:t.italic});
    
    if(t.form){
      content.append(svgEl('text',{
        x:t.x,
        y:t.y+56,
        'text-anchor':'middle',
        'font-family':'Georgia,serif',
        'font-size':15,
        fill:palette.terminal
      },t.form));
    }
  }
  for(const info of comments){
    const {comment,x,y,w,h,lines}=info;
    const group=svgEl('g',{'class':'comment-bubble',transform:`translate(${x} ${y})`,'data-comment':comment.id});
    group.append(svgEl('rect',{width:w,height:h,rx:14,ry:14,fill:palette.commentBg,stroke:palette.commentBorder,'stroke-width':1.3}));
    group.append(svgEl('text',{'class':'comment-head',x:14,y:21,'font-size':12,'font-family':'Segoe UI,Arial','font-weight':'600',fill:palette.commentTitle},'COMMENT'));
    lines.forEach((text,index)=>{
      group.append(svgEl('text',{'class':'comment-body',x:14,y:46+index*19,
        'font-family':'Segoe UI,Arial','font-size':14.5,fill:palette.ink},text));
    });
    group.addEventListener('click',e=>e.stopPropagation());
    group.addEventListener('dblclick',e=>{e.stopPropagation();editComment(comment.id);});
    group.addEventListener('pointerdown',e=>startCommentDrag(e,group,info));
    content.append(group);
  }
  svg.onclick=e=>{if(e.target.closest?.('.tree-node,.comment-bubble'))return;if(!pendingMovement)selectNode(null);};
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
    if(mode==='practice'){
      workingTrees[currentIndex]=clone(root);
      backupNoticeRequested=true;
    }else freeTree=clone(root);
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
  $('deleteDuplicateBtn').hidden=!hasBank||!/^\d+[a-z]+$/.test(exerciseIds[currentIndex]??'');
  $('scrollCanvas').hidden=!canEdit;
  $('placeholder').hidden=!practice||!!sentences.length;
  $('floatingBar').hidden=!canEdit;
  $('rightSide').classList.toggle('disabled',!canEdit);
  updateControls();
  if(canEdit){const reset=scrollReset;scrollReset=false;drawTree(reset);}
  backupWorkInBrowser();
}
function changeZoom(factor){
  const current=zoom;
  zoom=Math.max(.45,Math.min(2.25,zoom*factor));
  if(zoom===current)return;
  const canvas=$('scrollCanvas'),oldWidth=sceneWidth*current,oldHeight=sceneHeight*current;
  const focusX=(canvas.scrollLeft+canvas.clientWidth/2)/Math.max(1,oldWidth);
  const focusY=(canvas.scrollTop+canvas.clientHeight/2)/Math.max(1,oldHeight);
  applyZoom();
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
    const ctx=canvas.getContext('2d');ctx.fillStyle=getTreePalette().bg;ctx.fillRect(0,0,w,h);
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

    const rect=bar.getBoundingClientRect();
    const bounds=area.getBoundingClientRect();
    const wasVertical=bar.classList.contains('vertical');
    const wasRight=bar.classList.contains('docked-right');

    if(wasVertical)bar.classList.remove('vertical');
    const horizontalWidth=bar.offsetWidth;
    if(wasVertical)bar.classList.add('vertical');

    drag={
      lastClientX:event.clientX,
      lastClientY:event.clientY,
      virtualX:wasVertical
        ?(wasRight?bounds.width-horizontalWidth-55:55)
        :rect.left-bounds.left,
      y:rect.top-bounds.top,
      horizontalWidth
    };

    bar.style.transform='none';
    bar.style.right='auto';
    bar.style.bottom='auto';
    bar.style.left=(rect.left-bounds.left)+'px';
    bar.style.top=drag.y+'px';

    grip.setPointerCapture(event.pointerId);
  });
  grip.addEventListener('pointermove',event=>{
    if(!drag)return;

    const bounds=area.getBoundingClientRect();

    drag.virtualX+=event.clientX-drag.lastClientX;
    drag.y+=event.clientY-drag.lastClientY;
    drag.lastClientX=event.clientX;
    drag.lastClientY=event.clientY;

    const wasLeft=bar.classList.contains('vertical') &&
      !bar.classList.contains('docked-right');
    const wasRight=bar.classList.contains('vertical') &&
      bar.classList.contains('docked-right');

    const DOCK_DISTANCE=55;
    const RELEASE_DISTANCE=55;

    const leftEdge=drag.virtualX;
    const rightEdge=drag.virtualX+drag.horizontalWidth;

    let dockLeft=wasLeft
      ?leftEdge<=DOCK_DISTANCE+RELEASE_DISTANCE
      :leftEdge<=DOCK_DISTANCE;

    let dockRight=wasRight
      ?rightEdge>=bounds.width-DOCK_DISTANCE-RELEASE_DISTANCE
      :rightEdge>=bounds.width-DOCK_DISTANCE;

    if(dockLeft&&dockRight){
      if(wasLeft)dockRight=false;
      else if(wasRight)dockLeft=false;
      else if((leftEdge+rightEdge)/2<bounds.width/2)dockRight=false;
      else dockLeft=false;
    }

    bar.classList.toggle('vertical',dockLeft||dockRight);
    bar.classList.toggle('docked-right',dockRight);

    let x;

    if(dockLeft){
      x=12;
    }else if(dockRight){
      x=bounds.width-bar.offsetWidth-12;
    }else{
      x=Math.max(6,Math.min(
        bounds.width-bar.offsetWidth-6,
        drag.virtualX
      ));
    }

    const y=Math.max(6,Math.min(
      bounds.height-bar.offsetHeight-6,
      drag.y
    ));

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
    const x=floatingPosition.right
      ?Math.max(8,w-bar.offsetWidth-12)
      :Math.min(Math.max(8,floatingPosition.x),Math.max(8,w-bar.offsetWidth-8));

    const y=Math.min(
      Math.max(8,floatingPosition.y),
      Math.max(8,h-bar.offsetHeight-8)
    );

    bar.style.left=x+'px';
    bar.style.top=y+'px';

    floatingPosition.x=x;
    floatingPosition.y=y;
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
  $('instructionsBtn').onclick=showInstructions;
  $('leftToggle').onclick=()=>{leftCollapsed=!leftCollapsed;render();};
  $('rightToggle').onclick=()=>{rightCollapsed=!rightCollapsed;render();};
  $('zoomIn').onclick=()=>changeZoom(1.15);$('zoomOut').onclick=()=>changeZoom(1/1.15);
  $('sidebarUndo').onclick=undo;
  $('sidebarRedo').onclick=redo;
  $('sidebarZoomOut').onclick=()=>changeZoom(1/1.15);
  $('sidebarZoomIn').onclick=()=>changeZoom(1.15);
  $('prevBtn').onclick=()=>switchExercise(currentIndex-1);
  $('nextBtn').onclick=saveAndNext;
  $('duplicateBtn').onclick=duplicateExercise;
  $('deleteDuplicateBtn').onclick=deleteDuplicate;
  $('jumpBtn').onclick=saveAndGo;
  $('jumpInput').addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();saveAndGo();}
  });
  $('importBtn').onclick=()=>$('importFile').click();
  $('importFile').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if(file)await importWorksheet(file);
  };
  $('progressMenuBtn').onclick=()=>{
    if($('progressMenuBtn').getAttribute('aria-expanded')==='true'){
      closeMenu();
      return;
    }
    showMenu($('progressMenuBtn'),[
      {label:'Open progress',disabled:mode!=='practice',action:()=>$('openFile').click()},
      {label:'Download progress',disabled:mode!=='practice'||!sentences.length,
        action:()=>saveProgress()}
    ]);
    $('progressMenuBtn').setAttribute('aria-expanded','true');
  };
  $('openFile').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if(file)await openProgress(file);
  };
  $('pngBtn').onclick=exportPNG;
  document.addEventListener('syntax-tree-theme-change',()=>drawTree());
  $('overlay').addEventListener('click',event=>{
    if(event.target===$('overlay'))$('closeDialog').click();
  });
  document.addEventListener('pointerdown',event=>{
    if(menuOpen&&!event.target.closest('#contextMenu,#subMenu,#progressMenuBtn'))closeMenu();
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      if(pendingMovement){
        pendingMovement=null;
        setInfo('Movement action cancelled.');
        updateControls();
        return;
      }
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
  restoreBrowserBackup();
}
init();
