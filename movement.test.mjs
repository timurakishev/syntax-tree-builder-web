import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeNode, normalizeNode, clone, usedWordIndices,
  allowedLabels, ensureTreeShape, readProgress
} from '../model.js';

function exerciseTree(){
  const root=makeNode('CP');
  const overt=makeNode('DP');
  const head=makeNode('D');
  head.word_index=0;
  overt.children=[head];
  const lower=makeNode('DP');
  lower.trace={placement:'replace-label',kind:'index',subscript:'i'};
  root.children=[overt,lower];
  return {root,overt,lower,head};
}

test('phrasal trace does not consume a worksheet word',()=>{
  const {root}=exerciseTree();
  assert.deepEqual(usedWordIndices(root),[0]);
  assert.doesNotThrow(()=>ensureTreeShape(root,['what']));
});

test('head traces may appear below a head or replace its label',()=>{
  const root=makeNode('TP');
  const head=makeNode('T');
  root.children=[head];
  head.trace={placement:'below-head',kind:'lexical',subscript:'have'};
  assert.doesNotThrow(()=>ensureTreeShape(root,[]));
  head.trace={placement:'replace-label',kind:'category',subscript:'T'};
  assert.doesNotThrow(()=>ensureTreeShape(root,[]));
});

test('phrasal traces cannot use below-head placement',()=>{
  const {root,lower}=exerciseTree();
  lower.trace.placement='below-head';
  assert.throws(()=>ensureTreeShape(root,['what']),/Only a head/);
});

test('traces cannot coexist with words, null elements, daughters or triangles',()=>{
  for(const conflict of ['word','null','child','triangle']){
    const {root,lower}=exerciseTree();
    if(conflict==='word')lower.word_index=0;
    if(conflict==='null')lower.null_element=true;
    if(conflict==='child')lower.children=[makeNode('D')];
    if(conflict==='triangle'){
      lower.triangle_text='what';
      lower.triangle_indices=[0];
    }
    assert.throws(()=>ensureTreeShape(root,['what']),/trace/);
  }
});

test('trace label edits keep the original head or phrase category',()=>{
  const {root,lower}=exerciseTree();
  assert.ok(allowedLabels(root,lower).includes('NP'));
  assert.ok(!allowedLabels(root,lower).includes('T'));
  assert.ok(!allowedLabels(root,lower).includes('EMPTY'));
  assert.doesNotThrow(()=>ensureTreeShape(root,['what']));
});

test('movement arrows survive normalization independently of trace and binding',()=>{
  const {root,overt,lower}=exerciseTree();
  lower.movement_arrows=[overt.uid];
  overt.coindexation='i';
  overt.movement_chain_id='movement-example';
  overt.movement_index='1';
  lower.movement_chain_id='movement-example';
  lower.movement_index='1';
  const copy=normalizeNode(clone(root));
  assert.deepEqual(copy,root);
  assert.equal(copy.children[0].coindexation,'i');
  assert.equal(copy.children[0].movement_index,'1');
  assert.deepEqual(copy.children[1].movement_arrows,[copy.children[0].uid]);
  assert.doesNotThrow(()=>ensureTreeShape(copy,['what']));
});

test('movement arrows cannot point to missing nodes or themselves',()=>{
  const {root,lower}=exerciseTree();
  lower.movement_arrows=['missing'];
  assert.throws(()=>ensureTreeShape(root,['what']),/movement arrow/);
  lower.movement_arrows=[lower.uid];
  assert.throws(()=>ensureTreeShape(root,['what']),/movement arrow/);
});

test('successive movement admits multiple traces in the same chain',()=>{
  const {root,overt,lower}=exerciseTree();
  const intermediate=makeNode('DP');
  intermediate.trace={placement:'replace-label',kind:'index',subscript:'i'};
  root.children.push(intermediate);
  for(const node of [overt,lower,intermediate]){
    node.movement_chain_id='chain-1';
    node.movement_index='i';
  }
  assert.doesNotThrow(()=>ensureTreeShape(root,['what']));
  assert.equal(usedWordIndices(root).length,1);
});

test('old progress without movement fields still opens',()=>{
  const old={
    label:'TP',uid:'root-old',word_index:null,null_element:false,
    label_features:'',lexical_features:'',form_feature:'',coindexation:'',
    triangle_text:null,triangle_indices:[],comments:[],children:[]
  };
  const work={format:'syntax-tree-builder-work-1',bank_name:'Old',
    sentences:['What moved'],exercise_ids:['1'],original_count:1,
    current_index:0,trees:{0:old}};
  const recovered=readProgress(work).trees[0];
  assert.equal(recovered.trace,null);
  assert.deepEqual(recovered.movement_arrows,[]);
});

test('movement traces persist through saved work',()=>{
  const {root}=exerciseTree();
  const work={format:'syntax-tree-builder-work-1',bank_name:'Movement',
    sentences:['What moved'],exercise_ids:['1'],original_count:1,
    current_index:0,trees:{0:clone(root)}};
  const parsed=readProgress(work);
  assert.equal(parsed.trees[0].children[1].trace.subscript,'i');
  assert.deepEqual(usedWordIndices(parsed.trees[0]),[0]);
});
