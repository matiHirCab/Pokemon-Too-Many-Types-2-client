'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const preact = require('preact');
const render = require('preact-render-to-string');
global.window = global;
global.Config = {routes:{root:'localhost'},whitelist:[]};
global.BattleTMT2 = require('../tmt2/catalog.json');
global.BattleText = require('../play.pokemonshowdown.com/data/text/en.js').BattleText;
require('../play.pokemonshowdown.com/js/battle-dex-data.js');
require('../play.pokemonshowdown.com/js/battle-dex.js');
const Teams = vm.runInThisContext(fs.readFileSync('play.pokemonshowdown.com/js/battle-teams.js','utf8')+'\nTeams;');
const Search = vm.runInThisContext(fs.readFileSync('play.pokemonshowdown.com/js/battle-dex-search.js','utf8')+'\nDexSearch;');
const data = vm.runInNewContext(fs.readFileSync('play.pokemonshowdown.com/js/battle-dex-data.js','utf8')+'\n({BattleNatures});');
const context = {preact, PSModel:class {}, TMT2, Dex, Teams, DexSearch:Search, toID,
 window:{}, Config, PSUtils:{}, TL:Object.assign((s,...args)=>s.reduce((a,v,i)=>a+v+(args[i]||''),''),
  {statShort:{hp:'HP',atk:'Atk',def:'Def',spa:'SpA',spd:'SpD',spe:'Spe'}}), ...data};
const source=fs.readFileSync('play.pokemonshowdown.com/src/battle-team-editor.tsx','utf8');
const compiled=babel.transformSync(source,{filename:'editor.tsx',babelrc:false,plugins:[
 ['@babel/plugin-transform-typescript',{isTSX:true}],['@babel/plugin-transform-react-jsx',{pragma:'preact.h',pragmaFrag:'preact.Fragment'}],
 'remove-import-export',
]}).code;
const classes=vm.runInNewContext(compiled+'\n({TeamEditorState,StatForm,DetailsForm});',context);
const team=id=>({format:'gen9tmt2seed',packedTeam:Teams.pack(TMT2.premade(id)),name:'TMT2 '+id});
test('native state renders fixed format stats, preserves invalid import for correction and roundtrips legal premades',()=>{
 for(const premade of BattleTMT2.seed.teams) {
  const editor=new classes.TeamEditorState(team(premade.id));
  assert.equal(editor.defaultLevel,50);
  for(const set of editor.sets) for(const stat of Dex.statNames) assert.equal(editor.getStat(stat,set,0,252,1.1),TMT2.stats(set.species)[stat]);
  assert.deepEqual(TMT2.teamProblems(editor.sets),[]);
  editor.import(editor.export());assert.deepEqual(TMT2.teamProblems(editor.sets),[]);
  const invalid=editor.export().replace('Level: 50','Level: 100');
  editor.import(invalid);
  assert.equal(editor.sets[0].level,100);assert.match(TMT2.teamProblems(editor.sets).join('\n'),/Level must be exactly 50/);
 }
});
test('fixed native stats/details expose no EV/IV/nature/Tera editors or automatic spread controls',()=>{
 const editor=new classes.TeamEditorState(team('beta'));
 for(const Component of [classes.StatForm,classes.DetailsForm]) {
  const html=render(preact.h(Component,{editor,set:editor.sets[2],onChange:()=>{}}));
  assert.match(html,/EV0/);assert.match(html,/Level 50/);
  assert.doesNotMatch(html,/<input|<select|setStatFormGuesses|setStatFormOptimization/);
 }
 const standard=new classes.TeamEditorState({...team('alpha'),format:'gen9ou'});
 assert.equal(standard.defaultLevel,100);assert.equal(standard.isTMT2,false);
 assert.notEqual(standard.getStat('atk',standard.sets[0],31,252),TMT2.stats('rattata').atk);
});
test('native search includes first/second/third type matches and excludes battle-only forms as starting choices',()=>{
 for(const [type,ids] of Object.entries({Grass:['floragato'],Magic:['floragato'],Cat:['eevee','floragato'],Bird:['pidgeot','pidgeotto','pidgey'],Crab:['krabby']})){
  const search=new Search();search.setType('pokemon','gen9tmt2seed');search.addFilter(['type',type]);search.find('');
  assert.deepEqual(search.results.map(r=>r[1]).sort(),ids.sort());
 }
 const search=new Search();search.setType('pokemon','gen9tmt2seed');search.find('mega');
 assert.equal(search.results.some(r=>r[0]==='pokemon'),false);
 assert.deepEqual(Dex.forFormat('gen9tmt2seed').species.get('pidgeotmega').types,['Holy','Bird','Bird']);
});
test('local move/ability/item tooltip text matches pinned catalog and remains nonempty',()=>{
 const dex=Dex.forFormat('gen9tmt2seed');
 for(const kind of ['moves','abilities','items'])for(const record of BattleTMT2.seed[kind]){
  const effect=dex[kind].get(record.id);
  assert(effect.shortDesc);assert.equal(effect.shortDesc,record.shortDesc);
 }
 assert.match(dex.moves.get('waterpulse').shortDesc,/20%/);
 assert.match(dex.abilities.get('shellarmor').shortDesc,/critical/i);
 assert.equal(dex.moves.get('surf').exists,false);
});
