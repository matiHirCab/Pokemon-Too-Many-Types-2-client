'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const babel = require('@babel/core');
global.window = global;
global.Config = {routes: {root: 'localhost'}, whitelist: []};
global.BattleTMT2 = require('../tmt2/catalog.json');
global.BattleText = require('../play.pokemonshowdown.com/data/text/en.js').BattleText;
vm.runInThisContext(fs.readFileSync('play.pokemonshowdown.com/data/tmt2-native-assets.js','utf8'));
require('../play.pokemonshowdown.com/js/battle-dex-data.js');
Object.assign(global,vm.runInNewContext(fs.readFileSync('play.pokemonshowdown.com/js/battle-dex-data.js','utf8')+
 '\n({BattleAvatarNumbers,BattlePokemonIconIndexes,BattlePokemonIconIndexesLeft});',{}));
global.BattlePokedex=require('../play.pokemonshowdown.com/data/pokedex.js').BattlePokedex;
require('../play.pokemonshowdown.com/js/battle-dex.js');
require('../play.pokemonshowdown.com/js/battle-text-parser.js');
require('../play.pokemonshowdown.com/js/battle-scene-stub.js');
global.BattleLog = vm.runInThisContext(fs.readFileSync('play.pokemonshowdown.com/js/battle-log.js', 'utf8') + '\nBattleLog;');
require('../play.pokemonshowdown.com/js/battle.js');
const NativeTooltips=vm.runInThisContext(fs.readFileSync('play.pokemonshowdown.com/js/battle-tooltips.js','utf8')+'\nBattleTooltips;');
const NativeTeams = vm.runInThisContext(fs.readFileSync('play.pokemonshowdown.com/js/battle-teams.js', 'utf8') + '\nTeams;');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
test('native bootstrap fails closed outside loopback and uses no public auth/data routes', () => {
 const code = fs.readFileSync('play.pokemonshowdown.com/tmt2-native-config.js', 'utf8');
 const context = {window: {}, location: {hostname: '127.0.0.1', host: '127.0.0.1:8080'}};
 vm.runInNewContext(code, context);
 assert.equal(context.window.Config.tmt2Local, true);
 assert.equal(context.window.Config.defaultserver.host, '127.0.0.1');
 assert.ok(Object.values(context.window.Config.routes).every(r => r === '127.0.0.1:8080'));
 assert.throws(() => vm.runInNewContext(code, {window: {}, location: {hostname: 'example.com'}}), /loopback/);
});
test('native entry loads actual scene/move animations and locally generated pinned formatter/artwork', () => {
 const html = fs.readFileSync('play.pokemonshowdown.com/testclient-new.html', 'utf8');
 const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1].split('?')[0]);
 assert.ok(scripts.includes('js/battle-animations.js'));
 assert.ok(scripts.includes('js/battle-animations-moves.js'));
 assert.ok(scripts.indexOf('js/battle-animations.js') < scripts.indexOf('js/battle.js'));
 for(const script of scripts) {assert.ok(!script.startsWith('http'));assert.ok(fs.existsSync('play.pokemonshowdown.com/' + script),script);}
 const assets = JSON.parse(fs.readFileSync('play.pokemonshowdown.com/data/tmt2-native-assets.json'));
 assert.equal(assets.datasetHash, BattleTMT2.metadata.datasetHash);
 assert.equal(assets.sourceSha256, hash(fs.readFileSync('build-tools/build-native-tmt2')));
 assert.match(assets.formatter.serverCommit, /^[a-f0-9]{40}$/);
 for (const [file, sha] of Object.entries(assets.outputs)) assert.equal(hash(fs.readFileSync('play.pokemonshowdown.com/'+file)),sha);
 assert.match(fs.readFileSync('play.pokemonshowdown.com/tmt2/sprites/pidgeot.svg','utf8'), /sprite unavailable/);
 const ctx = {toID};vm.runInNewContext(fs.readFileSync('play.pokemonshowdown.com/js/server/chat-formatter.js','utf8'), Object.assign(ctx,{window:ctx}));
 assert.equal(typeof ctx.formatText,'function');assert.equal(ctx.formatText('**native**'),'<b>native</b>');
});

test('native original artwork routes exact facing/dimensions, trainers and icon states without remote fallback', () => {
 const previous=BattleTMT2Assets;const local=Config.tmt2Local;
 const pin=require('../tmt2/native-artwork.json');
 global.BattleTMT2Assets={schemaVersion:1,datasetHash:BattleTMT2.metadata.datasetHash,mode:'originals-local-evaluation',
  placeholderSpecies: [...BattleTMT2.seed.species, ...(BattleTMT2.seed.forms || [])].filter(s=>!pin.files.some(f=>f.path===`sprites/ani/${s.id}.gif`)).map(s=>s.id),
  files:Object.fromEntries(pin.files.map(f=>[f.path,{path:'tmt2/'+f.path,...(f.gif||f.png)}]))};Config.tmt2Local=true;
 try {
  for(const id of BattleTMT2.seed.species.map(s=>s.id).filter(id=>!BattleTMT2Assets.placeholderSpecies.includes(id))) {
   for(const front of [true,false]) {
    const expected=pin.files.find(f=>f.path===`sprites/${front?'ani':'ani-back'}/${id}.gif`);
    const sprite=Dex.getSpriteData(id,front,{gen:9});
    assert.equal(sprite.url,'tmt2/'+expected.path);assert.equal(sprite.w,expected.gif.width);
    assert.equal(sprite.h,expected.gif.height);assert.equal(sprite.isFrontSprite,front);
    assert.equal(sprite.cryurl,'');
   }
  }
  for(const id of BattleTMT2Assets.placeholderSpecies) {
   const sprite=Dex.getSpriteData(id,true,{gen:9});
   assert.equal(sprite.url,`tmt2/sprites/${id}.svg`);
   assert.match(Dex.getPokemonIcon(id),new RegExp(`tmt2/sprites/${id}.svg`));assert.match(fs.readFileSync('play.pokemonshowdown.com/'+sprite.url,'utf8'),/sprite unavailable/);
  }
  assert.equal(Dex.resolveAvatar('265'),'tmt2/sprites/trainers/rosa.png');
  assert.equal(Dex.resolveAvatar('102'),'tmt2/sprites/trainers/lyra.png');
  assert.equal(Dex.resolveAvatar('1'),'tmt2/sprites/trainer.svg');
  assert.match(Dex.getPokemonIcon('rattata'),/tmt2\/sprites\/pokemonicons-sheet\.png.*-280px -30px/);
  assert.match(Dex.getPokemonIcon('pokeball-statused'),/-40px 4px/);
  assert.match(Dex.getPokemonIcon('pokeball-fainted'),/-80px 4px;opacity/);
  assert.match(Dex.getPokemonIcon('pokeball-none'),/-80px 4px$/);
  const missing=BattleTMT2Assets.files['sprites/ani/pidgeot.gif'];delete BattleTMT2Assets.files['sprites/ani/pidgeot.gif'];
  assert.throws(()=>Dex.getSpriteData('pidgeot',true),/sprite missing/);
  BattleTMT2Assets.files['sprites/ani/pidgeot.gif']=missing;
  BattleTMT2Assets.datasetHash='0'.repeat(64);assert.throws(()=>TMT2.artwork(),/incompatible/);
  Config.tmt2Local=false;
  assert.ok(!Dex.getSpriteData('rattata',true).url.startsWith('tmt2/'));
  assert.ok(!Dex.getPokemonIcon('rattata').includes('tmt2/'));
 }finally{global.BattleTMT2Assets=previous;Config.tmt2Local=local;}
});
test('native premade installation preserves saved teams and avoids duplicates; ordinary client unchanged', () => {
 const source = fs.readFileSync('play.pokemonshowdown.com/src/client-main.ts','utf8');
 const part = source.slice(source.indexOf('class PSTeams extends'),source.indexOf('export type PSLoginState'));
 const js = babel.transformSync(part, {filename:'teams.ts',babelrc:false,plugins:['@babel/plugin-transform-typescript']}).code;
 let saved = '';
 const ctx = {PSStreamModel: class {update(){}}, Config:{tmt2Local:true},Teams:NativeTeams,TMT2,toID,
  window:{BattleFormats:{}},localStorage:{getItem:()=>saved,setItem:(_,v)=>{saved=v;}}};
 const TeamModel=vm.runInNewContext(js+'\nPSTeams;',ctx);
 const first=new TeamModel();assert.equal(first.list.length,BattleTMT2.seed.teams.length);
 first.push({name:'Keep me',format:'gen9ou',packedTeam:NativeTeams.pack(TMT2.premade('alpha')),folder:'',key:'',iconCache:'',isBox:false});
 saved=first.packAll(first.list);
 const second=new TeamModel();assert.equal(second.list.length,BattleTMT2.seed.teams.length+1);assert.equal(second.list.filter(t=>t.name==='Keep me').length,1);
 ctx.Config.tmt2Local=false;saved='';assert.equal(new TeamModel().list.length,0);
});
test('historical v0.1 native recording is rejected by v0.2 without rewriting evidence', () => {
 const value=require('./fixtures/tmt2-native-browser-replay.json');assert.throws(()=>TMT2.validateReplay(value),/mismatch/); // Historical v0.1 parser evidence only; not compatible playback.
 assert.equal(value.log.at(-1),'|win|NativeBeta');
 const drift=structuredClone(value);drift.catalogHash='0'.repeat(64);assert.throws(()=>TMT2.validateReplay(drift),/mismatch/);
});

test('historical recovered native recording retains original evidence and is rejected by v0.2', () => {
 const value=require('./fixtures/tmt2-native-final-replay.json');assert.throws(()=>TMT2.validateReplay(value),/mismatch/); // Preserve original browser evidence, never relabel its identity.
 assert.equal(value.log.length,148);assert.equal(value.log.some(line=>line.startsWith('|error|')),false);
 assert.match(value.evidence.sourceSha256,/^[a-f0-9]{64}$/);
 assert.equal(value.log.at(-1),'|win|NativeFinalB');
 const drift=structuredClone(value);drift.datasetHash='0'.repeat(64);assert.throws(()=>TMT2.validateReplay(drift),/mismatch/);
});

test('native seed opponent tooltip uses exact EV0 IV31 Hardy speed; ordinary ranges remain intact',()=>{
 const value=require('./fixtures/tmt2-teambuilder-simulator-replay.json');
 const battle=new Battle({debug:true});try{
  battle.paused=true;battle.setQueue(value.log);battle.seekTurn(2);
  const tooltip=Object.create(NativeTooltips.prototype);tooltip.battle=battle;
  for(const p of [...battle.p1.pokemon,...battle.p2.pokemon]){
   const expected=TMT2.stats(p.speciesForme).spe;
   assert.deepEqual(tooltip.getSpeedRange(p),{min:expected,ev0:expected,ev84:expected,ev252:expected,max:expected});
   assert.ok(!tooltip.renderStats(p).includes('&ndash;'));
  }
  battle.dex=Dex.forFormat('gen9ou');
  const range=tooltip.getSpeedRange(battle.p1.pokemon.find(p=>p.name==='Pidgeot'));
  assert.ok(range.min<range.max);
 }finally{battle.destroy();}
});

test('local native background can initialize before PS without image-load bootstrap race', () => {
 const source = fs.readFileSync('play.pokemonshowdown.com/src/client-core.ts','utf8');
 const part = source.slice(source.indexOf('export const PSBackground'), source.indexOf('/**********************************************************************', source.indexOf('export const PSBackground')));
 const js = babel.transformSync(part, {filename:'background.ts',babelrc:false,plugins:['@babel/plugin-transform-typescript']}).code.replace('export const','const');
 let loaded;
 const ctx = {Config:{tmt2Local:true},PSStreamModel:class {update(url){loaded=url;}},
  Image:class {constructor(){throw Error('Image color extraction must not race absent PS');}}};
 const bg = vm.runInNewContext(js+'\nPSBackground;',ctx);
 assert.equal(loaded,'fx/bg-city.png');assert.equal(bg.menuColors.length,6);
 assert.ok(fs.existsSync('play.pokemonshowdown.com/'+loaded));
});
