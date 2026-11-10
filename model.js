export const CATEGORIES = [
  'TP','NP','VP','PP','AdjP','AdvP','DP','CP','XP','PerfP','ProgP','VoiceP','NegP','EMPTY',
  'T′','N′','V′','P′','Adj′','Adv′','D′','C′','X′','Perf′','Prog′','Voice′','Neg′',
  'T','N','V','P','Adj','Adv','D','C','Conj','X','Perf','Prog','Voice','Neg'
];
export const PHRASES = new Set(CATEGORIES.slice(0,14));
export const LABEL_GROUPS = {
  PHRASES: CATEGORIES.slice(0,14),
  'X-BAR PROJECTIONS': CATEGORIES.slice(14,27),
  HEADS: CATEGORIES.slice(27)
};
export const isProjection = label => label?.endsWith('′');
export const isPhrase = label => PHRASES.has(label);
export const isHead = label => CATEGORIES.includes(label) && !isPhrase(label) && !isProjection(label);
export const uid = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g,'').slice(0,12);
  return Math.random().toString(16).slice(2,14).padEnd(12,'0');
};
export function makeNode(label='?') {
  return {
    label,
    uid:uid(),
    word_index:null,
    null_element:false,
    label_features:'',
    lexical_features:'',
    form_feature:'',
    coindexation:'',
    triangle_text:null,
    triangle_indices:[],
    comments:[],
    children:[]
  };
}
export function normalizeNode(raw) {
  if (!raw || typeof raw !== 'object') throw Error('Invalid syntax tree.');
  return {
    label: String(raw.label ?? '?'),
    uid: String(raw.uid || uid()),
    word_index: raw.word_index ?? null,
    null_element: raw.null_element === true,
    label_features: String(raw.label_features ?? ''),
    lexical_features: String(raw.lexical_features ?? ''),
    form_feature: String(raw.form_feature ?? ''),
    coindexation: String(raw.coindexation ?? ''),
    triangle_text: raw.triangle_text ?? null,
    triangle_indices: [...(raw.triangle_indices ?? [])],
    comments: (raw.comments ?? []).map(c => ({...c})),
    children: (raw.children ?? []).map(normalizeNode)
  };
}
export const clone = value => JSON.parse(JSON.stringify(value));
export function* walk(node) {
  yield node;
  for (const c of node.children) yield* walk(c);
}
export const findNode = (root, id) => [...walk(root)].find(n => n.uid === id) ?? null;
export const findParent = (root,id) => [...walk(root)].find(n=>n.children.some(c=>c.uid===id)) ?? null;
export function usedWordIndices(root) {
  const result=[];
  for (const n of walk(root)) {
    if (n.word_index!==null) result.push(n.word_index);
    result.push(...n.triangle_indices);
  }
  return result;
}
export function tokenize(sentence) {
  return String(sentence).match(/[\p{L}\p{N}_]+(?:['’][\p{L}\p{N}_]+)*/gu) ?? [];
}
export function allowedLabels(root,node) {
  let labels = node===root ? CATEGORIES.slice(0,13) : [...CATEGORIES];
  if (node.children.length || node.word_index!==null || node.triangle_text!==null || node.null_element)
    labels=labels.filter(x=>x!=='EMPTY');
  if (node.children.length) labels=labels.filter(x=>isPhrase(x)||isProjection(x));
  if (node.triangle_text!==null) labels=labels.filter(x=>isPhrase(x)&&x!=='EMPTY');
  if (node.word_index!==null || node.null_element) labels=labels.filter(isHead);
  return labels;
}
export function ensureTreeShape(root,words) {
  const nodes=[...walk(root)];
  if (nodes.length>150 || new Set(nodes.map(n=>n.uid)).size!==nodes.length)
    throw Error('Tree is too large or contains repeated node IDs.');
  for(const n of nodes){
    if(n.children.length>3) throw Error('Nodes with more than three daughters are not supported.');
    if(n.word_index!==null && (!Number.isInteger(n.word_index)||n.word_index<0||n.word_index>=words.length))
      throw Error('Invalid terminal word index in saved tree.');
    if(n.null_element && (n.word_index!==null || n.children.length || !isHead(n.label) || n.triangle_text!==null))
      throw Error('A null lexical item requires a terminal head.');    
    if(n.triangle_text!==null){
      if(typeof n.triangle_text!=='string'||!n.triangle_text.trim()||n.triangle_text.length>300)
        throw Error('Invalid triangle text in saved tree.');
      if(!isPhrase(n.label)||n.label==='EMPTY'||n.children.length||n.word_index!==null)
        throw Error('A triangle requires a terminal phrase node.');
      const a=n.triangle_indices;
      if(!a.length || a.some(i=>!Number.isInteger(i)||i<0||i>=words.length) ||
         a.some((i,j)=>j>0&&i!==a[j-1]+1))
        throw Error('Triangle words must be a contiguous worksheet span.');
    } else if (n.triangle_indices.length) throw Error('Triangle word indices without a triangle.');
  }
}
export function validateBank(data) {
  const sentences=data.sentences;
  if(!Array.isArray(sentences)||sentences.length<1||sentences.length>1000)
    throw Error('Work must contain 1–1000 exercise entries.');
  if(sentences.some(s=>typeof s!=='string'||!tokenize(s).length||s.length>600))
    throw Error('Every exercise needs text (up to 600 characters).');
  const original_count=data.original_count ?? sentences.length;
  const labels=data.exercise_ids ?? sentences.map((_,i)=>String(i+1));
  if(!Number.isInteger(original_count)||original_count<1||original_count>Math.min(200,sentences.length)||
     !Array.isArray(labels)||labels.length!==sentences.length||
     labels.some(x=>typeof x!=='string')||new Set(labels).size!==labels.length||
     Array.from({length:original_count},(_,i)=>String(i+1)).some(x=>!labels.includes(x))||
     labels.some(x=>!/^\d+[a-z]*$/.test(x)||+x.replace(/[a-z]+$/,'')<1||+x.replace(/[a-z]+$/,'')>original_count))
    throw Error('Invalid exercise labels or original exercise count.');
  return {name:String(data.name ?? 'Imported worksheet').slice(0,90),sentences:[...sentences],exercise_ids:[...labels],original_count};
}
export function readProgress(work){
  if(work?.format!=='syntax-tree-builder-work-1') throw Error('Not a Syntax Tree Builder saved-work file.');
  const bank=validateBank({name:work.bank_name??'Recovered work',...work});
  const trees={};
  if(!work.trees||typeof work.trees!=='object') throw Error('Saved work is missing its trees.');
  for(const [key,raw] of Object.entries(work.trees)){
    const index=Number(key);
    if(!Number.isInteger(index)||index<0||index>=bank.sentences.length) throw Error('Invalid sentence number in saved file.');
    const tree=normalizeNode(raw);
    ensureTreeShape(tree,tokenize(bank.sentences[index]));
    trees[index]=tree;
  }
  const current_index=Number.isInteger(work.current_index)&&work.current_index>=0&&work.current_index<bank.sentences.length?work.current_index:0;
  return {...bank,trees,current_index};
}
export function duplicateSuffix(number){
  let result='';
  while(number){number--;result=String.fromCharCode(97+number%26)+result;number=Math.floor(number/26);}
  return result;
}
