import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'it114115-2627';
initializeApp({
  credential: applicationDefault(),
  projectId: projectId
});

const db = getFirestore();

// 1. Load all prompts in the prompts collection
const promptSnap = await db.collection('prompts').get();
const libraryPrompts = [];
promptSnap.forEach(d => {
  libraryPrompts.push({ id: d.id, ...d.data() });
});

console.log('Project:', projectId);
console.log('--- PROMPTS IN LIBRARY (count=' + libraryPrompts.length + ') ---');
libraryPrompts.forEach(p => {
  console.log(p.id + ' | ' + p.name + ' | category=' + p.category);
});

// 2. Check each prompt in each class
const promptFields = [
  'afterClassVideoPrompt',
  'liveImagePrompt',
  'bingoPrompt',
  'liveAudioPrompt',
  'sessionAudioPrompt',
  'gemmaIntentPrompt',
  'subtitlePrompt'
];

const classesSnap = await db.collection('classes').get();
console.log('\n--- CHECKING CLASSES ---');
for (const cdoc of classesSnap.docs) {
  const cdata = cdoc.data();
  for (const field of promptFields) {
    const val = cdata[field];
    if (val) {
      const matchById = libraryPrompts.find(p => p.id === val.id);
      const matchByOrigId = libraryPrompts.find(p => p.id === val.originalId);
      const matchByName = libraryPrompts.filter(p => p.name === val.name);

      console.log('\nClass [' + cdoc.id + '].' + field + ':');
      console.log('  name:', val.name);
      console.log('  id:', val.id);
      console.log('  originalId:', val.originalId);
      console.log('  Match by id:', matchById ? 'FOUND (' + matchById.name + ')' : 'NOT FOUND');
      console.log('  Match by originalId:', matchByOrigId ? 'FOUND (' + matchByOrigId.name + ')' : 'NOT FOUND');
      console.log('  Matches by name:', matchByName.map(m => 'id=' + m.id + ' (cat=' + m.category + ')').join(', ') || 'NONE');
    }
  }
}
