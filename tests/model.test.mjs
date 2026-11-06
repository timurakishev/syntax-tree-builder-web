import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, PHRASES, makeNode, normalizeNode, clone, walk, findNode, findParent,
  usedWordIndices, tokenize, allowedLabels, ensureTreeShape, validateBank,
  readProgress, duplicateSuffix
} from '../model.js';

test('category inventory matches the desktop editor',()=>{
  assert.equal(CATEGORIES.length,41);
  assert.equal(PHRASES.size,14);
  assert.ok(CATEGORIES.includes('Voice′'));
  assert.ok(CATEGORIES.includes('Conj'));
});
test('tokenization keeps contractions and drops punctuation',()=>{
  assert.deepEqual(tokenize("The student's book isn't here."),['The',"student's",'book',"isn't",'here']);
  assert.deepEqual(tokenize('Сәлем, әлем!'),['Сәлем','әлем']);
});
test('root labels are phrases without EMPTY',()=>{
  const root=makeNode('?');
  const labels=allowedLabels(root,root);
  assert.ok(labels.includes('TP'));
  assert.ok(!labels.includes('EMPTY'));
  assert.ok(!labels.includes('T'));
});
test('word-bearing heads cannot be relabeled as phrases',()=>{
  const root=makeNode('TP'),head=makeNode('V');head.word_index=0;root.children=[head];
  assert.deepEqual(allowedLabels(root,head).some(x=>PHRASES.has(x)),false);
  assert.ok(allowedLabels(root,head).includes('N'));
});
test('used word indices include triangle spans',()=>{
  const root=makeNode('TP'),np=makeNode('NP'),v=makeNode('V');
  np.triangle_text='the first student';np.triangle_indices=[0,1,2];
  v.word_index=3;root.children=[np,v];
  assert.deepEqual(usedWordIndices(root),[0,1,2,3]);
  assert.equal(findNode(root,v.uid),v);
  assert.equal(findParent(root,v.uid),root);
});
test('tree serializes with the original field names',()=>{
  const root=makeNode('TP'),child=makeNode('PP');
  child.triangle_text='of poems';child.triangle_indices=[1,2];root.children=[child];
  root.comments.push({id:'note1',text:'Why is this PP attached here?',x:400,y:20});
  const parsed=normalizeNode(clone(root));
  assert.deepEqual(parsed,root);
  ensureTreeShape(parsed,['a','of','poems']);
});
test('saved work imports with duplicated exercise labels',()=>{
  const root=makeNode('TP'),child=makeNode('NP');
  child.triangle_text='a book';child.triangle_indices=[0,1];root.children=[child];
  const work={format:'syntax-tree-builder-work-1',bank_name:'Syntax Lab',
    sentences:['a book','a book'],exercise_ids:['1','1b'],original_count:1,
    current_index:1,trees:{0:root,1:clone(root)}};
  const parsed=readProgress(work);
  assert.equal(parsed.current_index,1);
  assert.deepEqual(parsed.exercise_ids,['1','1b']);
  assert.equal(parsed.trees[1].children[0].triangle_text,'a book');
});
test('save-file validation rejects invalid spans',()=>{
  const root=makeNode('TP');root.triangle_text='the student';root.triangle_indices=[0,2];
  assert.throws(()=>ensureTreeShape(root,['the','old','student']),/contiguous/);
});
test('worksheet validation preserves the original count',()=>{
  const result=validateBank({name:'Lab',sentences:['A sentence.','Another.'],original_count:2,exercise_ids:['1','2']});
  assert.equal(result.original_count,2);
  assert.throws(()=>validateBank({sentences:['?']}),/needs text/);
});
test('duplicate naming follows b, c, ..., aa',()=>{
  assert.equal(duplicateSuffix(2),'b');
  assert.equal(duplicateSuffix(3),'c');
  assert.equal(duplicateSuffix(26),'z');
  assert.equal(duplicateSuffix(27),'aa');
});
