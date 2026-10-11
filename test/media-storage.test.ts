import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaFilesystemMatches } from '../src/media-storage.js';
import { failureCode } from '../src/acquisition/io.js';

test('media mount guard accepts systemd writable bind mounts on the external drive',()=>{
  const mounted={target:'/mnt/lkp-media','maj:min':'8:1',fstype:'ntfs3'};
  const media={...mounted,target:'/mnt/lkp-media/LKP'};
  assert.ok(mediaFilesystemMatches('/mnt/lkp-media/LKP','/mnt/lkp-media',media,mounted));
  assert.ok(mediaFilesystemMatches('/mnt/lkp-media/LKP','/mnt/lkp-media',mounted,mounted));
  assert.ok(!mediaFilesystemMatches('/mnt/lkp-media/LKP','/mnt/lkp-media',{...media,'maj:min':'179:2'},mounted));
  assert.ok(!mediaFilesystemMatches('/mnt/lkp-media/LKP','/mnt/lkp-media',media,{...mounted,target:'/'}));
  assert.ok(!mediaFilesystemMatches('/mnt/lkp-media-other/LKP','/mnt/lkp-media',media,mounted));
  assert.ok(!mediaFilesystemMatches('/mnt/lkp-media/LKP','/mnt/lkp-media',{...media,'maj:min':''},{...mounted,'maj:min':''}));
});

test('startup diagnostics expose only approved error codes, never arbitrary messages or codes',()=>{
  assert.equal(failureCode(Object.assign(new Error('private provider response'),{code:'MEDIA_MOUNT_MISMATCH'})),'MEDIA_MOUNT_MISMATCH');
  assert.equal(failureCode(Object.assign(new Error('private provider response'),{code:'secret-value'})),'UNEXPECTED');
  assert.equal(failureCode(new Error('private provider response')),'UNEXPECTED');
  assert.equal(failureCode(null),'UNEXPECTED');
});
