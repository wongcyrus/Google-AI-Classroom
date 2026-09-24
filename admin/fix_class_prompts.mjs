import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'it114115-2627';
initializeApp({
  credential: applicationDefault(),
  projectId: projectId,
});

const db = getFirestore();

console.log(`[fix_class_prompts] Running for project: ${projectId}`);

// 1. Load library prompts
const promptsSnap = await db.collection('prompts').get();
const libraryPrompts = [];
promptsSnap.forEach((doc) => {
  libraryPrompts.push({ id: doc.id, ...doc.data() });
});

console.log(`[fix_class_prompts] Loaded ${libraryPrompts.length} prompts from library.`);

const promptFieldCategoryMap = {
  afterClassVideoPrompt: 'videos',
  liveImagePrompt: 'images',
  bingoPrompt: 'images',
  liveAudioPrompt: 'audios',
  sessionAudioPrompt: 'audios',
  gemmaIntentPrompt: 'audios',
  subtitlePrompt: 'translations',
};

// 2. Scan all classes and synchronize prompt references
const classesSnap = await db.collection('classes').get();
let totalRepairedClasses = 0;
let totalRepairedFields = 0;

for (const classDoc of classesSnap.docs) {
  const classData = classDoc.data();
  const classId = classDoc.id;
  const updates = {};
  let classModified = false;

  for (const [field, expectedCat] of Object.entries(promptFieldCategoryMap)) {
    const val = classData[field];
    if (!val || typeof val !== 'object') continue;

    // Matching resolution hierarchy:
    // 1. By val.id directly
    // 2. By val.originalId directly
    // 3. By exact name and expected category
    // 4. By exact name
    let matched = null;
    if (val.id) {
      matched = libraryPrompts.find((p) => p.id === val.id);
    }
    if (!matched && val.originalId) {
      matched = libraryPrompts.find((p) => p.id === val.originalId);
    }
    if (!matched && val.name) {
      matched = libraryPrompts.find((p) => p.category === expectedCat && p.name === val.name);
    }
    if (!matched && val.name) {
      matched = libraryPrompts.find((p) => p.name === val.name);
    }

    if (matched) {
      const needsIdFix = val.id !== matched.id;
      const needsOriginalIdFix = val.originalId !== matched.id;
      const needsCategoryFix = !val.category || val.category !== matched.category;

      if (needsIdFix || needsOriginalIdFix || needsCategoryFix) {
        console.log(`\nFixing Class [${classId}].${field}:`);
        console.log(`  Name: "${val.name || matched.name}"`);
        console.log(`  id: ${val.id} -> ${matched.id}`);
        console.log(`  originalId: ${val.originalId} -> ${matched.id}`);
        console.log(`  category: ${val.category} -> ${matched.category}`);

        updates[field] = {
          ...val,
          id: matched.id,
          originalId: matched.id,
          name: val.name || matched.name,
          category: val.category || matched.category,
          promptText: val.promptText || matched.promptText,
        };
        classModified = true;
        totalRepairedFields++;
      } else {
        console.log(`Class [${classId}].${field}: OK (id=${val.id}, name="${val.name}")`);
      }
    } else {
      console.warn(`⚠️ Warning: Class [${classId}].${field} could not be matched to any library prompt!`, {
        id: val.id,
        originalId: val.originalId,
        name: val.name,
      });
    }
  }

  if (classModified) {
    await db.collection('classes').doc(classId).update(updates);
    totalRepairedClasses++;
    console.log(`  -> Saved repaired class [${classId}].`);
  }
}

console.log(`\n[fix_class_prompts] Completed for ${projectId}.`);
console.log(`Total classes updated: ${totalRepairedClasses}`);
console.log(`Total prompt fields repaired: ${totalRepairedFields}`);
