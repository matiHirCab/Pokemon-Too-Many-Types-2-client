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
require('../play.pokemonshowdown.com/js/battle-dex-data.js');
require('../play.pokemonshowdown.com/js/battle-dex.js');
require('../play.pokemonshowdown.com/js/battle-text-parser.js');
require('../play.pokemonshowdown.com/js/battle-scene-stub.js');
global.BattleLog = vm.runInThisContext(fs.readFileSync('play.pokemonshowdown.com/js/battle-log.js', 'utf8') + '\nBattleLog;');
require('../play.pokemonshowdown.com/js/battle.js');
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
test('native entry loads actual scene/move animations and locally generated pinned formatter/cards', () => {
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
test('native premade installation preserves saved teams and avoids duplicates; ordinary client unchanged', () => {
 const source = fs.readFileSync('play.pokemonshowdown.com/src/client-main.ts','utf8');
 const part = source.slice(source.indexOf('class PSTeams extends'),source.indexOf('export type PSLoginState'));
 const js = babel.transformSync(part, {filename:'teams.ts',babelrc:false,plugins:['@babel/plugin-transform-typescript']}).code;
 let saved = '';
 const ctx = {PSStreamModel: class {update(){}}, Config:{tmt2Local:true},Teams:NativeTeams,TMT2,toID,
  window:{BattleFormats:{}},localStorage:{getItem:()=>saved,setItem:(_,v)=>{saved=v;}}};
 const TeamModel=vm.runInNewContext(js+'\nPSTeams;',ctx);
 const first=new TeamModel();assert.equal(first.list.length,2);
 first.push({name:'Keep me',format:'gen9ou',packedTeam:NativeTeams.pack(TMT2.premade('alpha')),folder:'',key:'',iconCache:'',isBox:false});
 saved=first.packAll(first.list);
 const second=new TeamModel();assert.equal(second.list.length,3);assert.equal(second.list.filter(t=>t.name==='Keep me').length,1);
 ctx.Config.tmt2Local=false;saved='';assert.equal(new TeamModel().list.length,0);
});
test('actual native browser recording reproduces winner and repeated types with compatibility rejection', () => {
 const value=require('./fixtures/tmt2-native-browser-replay.json');TMT2.validateReplay(value);
 const battle=new Battle({debug:true});try {
 battle.setQueue(value.log);battle.seekTurn(Infinity);assert.equal(battle.ended,true);assert.equal(battle.dex.modid,'gen9tmt2seed');
 assert.equal(value.log.at(-1),'|win|NativeBeta');assert.deepEqual(battle.p2.pokemon.find(p=>p.speciesForme==='Pidgeot').getTypeList(),['Bird','Bird','Bird']);
 }finally{battle.destroy();}
 const drift=structuredClone(value);drift.catalogHash='0'.repeat(64);assert.throws(()=>TMT2.validateReplay(drift),/mismatch/);
});

test('recovered final native browser recording completes cleanly after the recorded reload', () => {
 const value=require('./fixtures/tmt2-native-final-replay.json');TMT2.validateReplay(value);
 assert.equal(value.log.length,148);assert.equal(value.log.some(line=>line.startsWith('|error|')),false);
 assert.match(value.evidence.sourceSha256,/^[a-f0-9]{64}$/);
 const battle=new Battle({debug:true});try {
 battle.setQueue(value.log);battle.seekTurn(Infinity);
 assert.equal(battle.ended,true);assert.equal(battle.turn,11);assert.equal(battle.dex.modid,'gen9tmt2seed');
 assert.equal(value.log.at(-1),'|win|NativeFinalB');
 assert.deepEqual(battle.p2.pokemon.find(p=>p.speciesForme==='Pidgeot').getTypeList(),['Bird','Bird','Bird']);
 }finally{battle.destroy();}
 const drift=structuredClone(value);drift.datasetHash='0'.repeat(64);assert.throws(()=>TMT2.validateReplay(drift),/mismatch/);
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
