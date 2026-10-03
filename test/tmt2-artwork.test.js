'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {loadArtwork,importArtwork}=require('../build-tools/tmt2-native-artwork');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(){
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'tmt2-artwork-test-'));
 const bytes=Buffer.from('R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==','base64');
 const file={path:'sprites/ani/rattata.gif',sizeBytes:bytes.length,sha256:hash(bytes),gif:{width:1,height:1,frames:1}};
 const manifest=Buffer.from(JSON.stringify({complete:true,files:[file]}));
 const pin={manifestSha256:hash(manifest),files:[file]};
 fs.mkdirSync(path.join(dir,'sprites/ani'),{recursive:true});
 fs.writeFileSync(path.join(dir,file.path),bytes);fs.writeFileSync(path.join(dir,'manifest.json'),manifest);
 return {dir,bytes,file,manifest,pin,close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
// A stored ZIP fixture with UTF-8 filenames; artwork provenance is never fixture evidence.
function archive(entries){
 return Buffer.concat(entries.map(([name,bytes])=>{
  const filename=Buffer.from(name);const header=Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);header.writeUInt16LE(0x800,6);
  header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(filename.length,26);
  return Buffer.concat([header,filename,bytes]);
 }));
}
test('artwork loader verifies pinned bytes and source manifest before returning original output',()=>{
 const f=fixture();try{
  const loaded=loadArtwork(f.dir,f.pin);assert.deepEqual(loaded.outputs['tmt2/'+f.file.path],f.bytes);
  assert.equal(loaded.files[f.file.path].width,1);
  fs.writeFileSync(path.join(f.dir,f.file.path),Buffer.from('HTML'));
  assert.throws(()=>loadArtwork(f.dir,f.pin),/bytes mismatch/);
  fs.writeFileSync(path.join(f.dir,f.file.path),f.bytes);
  fs.writeFileSync(path.join(f.dir,'manifest.json'),'{}');
  assert.throws(()=>loadArtwork(f.dir,f.pin),/manifest mismatch/);
 }finally{f.close();}
});
test('missing, unsafe and symlinked artwork fails without touching the source',()=>{
 const f=fixture();try{
  const p=path.join(f.dir,f.file.path);fs.unlinkSync(p);
  assert.throws(()=>loadArtwork(f.dir,f.pin),/ENOENT/);
  fs.symlinkSync(path.join(f.dir,'manifest.json'),p);
  assert.throws(()=>loadArtwork(f.dir,f.pin),/symlink/);
  const bad=structuredClone(f.pin);bad.files[0].path='../outside.gif';
  assert.throws(()=>loadArtwork(f.dir,bad),/Unsafe/);
  assert.deepEqual(fs.readFileSync(path.join(f.dir,'manifest.json')),f.manifest);
 }finally{f.close();}
});
test('pinned ZIP import is deterministic, refuses existing destination and detects tampering',()=>{
 const f=fixture();try{
  const zip=archive([['manifest.json',f.manifest],[f.file.path,f.bytes]]);
  const file=path.join(f.dir,'sprites.zip');fs.writeFileSync(file,zip);f.pin.archiveSha256=hash(zip);
  for(const name of ['first','second'])importArtwork(file,path.join(f.dir,name),f.pin);
  assert.deepEqual(loadArtwork(path.join(f.dir,'first'),f.pin),loadArtwork(path.join(f.dir,'second'),f.pin));
  assert.throws(()=>importArtwork(file,path.join(f.dir,'first'),f.pin),/already exists/);
  const changed=Buffer.from(zip);changed[50]^=1;fs.writeFileSync(file,changed);
  assert.throws(()=>importArtwork(file,path.join(f.dir,'third'),f.pin),/ZIP mismatch/);
  assert.equal(fs.existsSync(path.join(f.dir,'third')),false);
 }finally{f.close();}
});
test('ZIP traversal/duplicate entries and symlink destinations fail without outside writes',()=>{
 const f=fixture();try{
  const input=path.join(f.dir,'bad.zip'),target=path.join(f.dir,'target');
  for(const entries of [[['../escape',f.bytes]],[['manifest.json',f.manifest],['manifest.json',f.manifest]]]){
   const zip=archive(entries);fs.writeFileSync(input,zip);f.pin.archiveSha256=hash(zip);
   assert.throws(()=>importArtwork(input,target,f.pin),/unsafe/);
   assert.equal(fs.existsSync(target),false);
  }
  const zip=archive([['manifest.json',f.manifest],[f.file.path,f.bytes]]);fs.writeFileSync(input,zip);f.pin.archiveSha256=hash(zip);
  fs.symlinkSync(f.dir,target);assert.throws(()=>importArtwork(input,target,f.pin),/symlink/);
 }finally{f.close();}
});

test('official metadata pins three views per bounded Pokemon and rejects untrusted sources',()=>{
 const {validateShowdownPin}=require('../build-tools/tmt2-native-artwork');
 const pin=require('../tmt2/showdown-artwork.json'),catalog=require('../tmt2/catalog.json');validateShowdownPin(pin);
 assert.deepEqual(pin.mapping.map(x=>x.id).sort(),[...catalog.seed.species,...catalog.seed.forms].map(x=>x.id).sort());
 assert.equal(pin.mapping.find(x=>x.id==='pidgeotmega').sourceID,'pidgeot-omega');
 for(const mutate of [p=>p.files[0].sourcePath='../escape',p=>p.sourceCommit='master',p=>p.mapping.push(p.mapping[0])]){
  const bad=structuredClone(pin);mutate(bad);assert.throws(()=>validateShowdownPin(bad));
 }
});
test('supplied custom artwork wins byte-for-byte over matching official art without source changes',()=>{
 const {composeArtwork}=require('../build-tools/tmt2-native-artwork');
 const name='sprites/ani/rattata.gif',target='tmt2/'+name,custom=Buffer.from('synthetic custom'),standard=Buffer.from('synthetic official');
 const user={outputs:{[target]:custom},files:{[name]:{path:target,sha256:hash(custom)}}};
 const official={outputs:{[target]:standard,'tmt2/sprites/ani/krabby.gif':standard},files:{[name]:{path:target,sha256:hash(standard)}}};
 const result=composeArtwork(user,official);assert.deepEqual(result.outputs[target],custom);
 assert.equal(result.files[name].source,'user-provided-local');assert.deepEqual(user.outputs[target],custom);assert.deepEqual(official.outputs[target],standard);
 assert.deepEqual(result.outputs['tmt2/sprites/ani/krabby.gif'],standard);
});
