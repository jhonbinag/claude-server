/**
 * One-off script: create an admin credential with activated=true.
 * Run: node scripts/create-admin-cred.js
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

async function main() {
  // Bootstrap Firebase if enabled
  const config = require('../src/config');
  if (config.isFirebaseEnabled) {
    try {
      const admin = require('firebase-admin');
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
        });
      }
    } catch (e) {
      console.warn('Firebase init skipped:', e.message);
    }
  }

  const store = require('../src/services/dashboardCredentialStore');

  // Check if username already exists
  const existing = await store.getByUsername('admin');
  if (existing) {
    console.log('Username "admin" already exists — deleting and recreating...');
    await store.deleteCredential(existing.credentialId);
  }

  const { cred, plainPassword } = await store.createCredential({
    name:        'Admin',
    email:       'admin@hlprotools.com',
    username:    'admin',
    locationIds: ['all'],
    role:        'admin',
    status:      'active',
  });

  // Force-activate (createCredential always sets activated:false)
  if (config.isFirebaseEnabled) {
    try {
      const admin = require('firebase-admin');
      const db    = admin.app().firestore();
      await db.collection('dashboardCredentials').doc(cred.credentialId).set({ activated: true }, { merge: true });
    } catch (e) {
      console.warn('Could not force-activate in Firestore:', e.message);
    }
  }

  console.log('\n✓ Admin credential created\n');
  console.log('  Username :', cred.username);
  console.log('  Password :', plainPassword);
  console.log('  Role     :', cred.role);
  console.log('  Status   :', cred.status);
  console.log('  Activated: true');
}

main().then(() => process.exit(0)).catch(e => { console.error('Error:', e.message); process.exit(1); });
