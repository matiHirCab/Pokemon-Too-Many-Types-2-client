const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const {describe, it, test} = require('node:test');
global.window = global;
global.Config = {routes: {root: 'localhost'}, whitelist: []};
const catalog = require('../tmt2/catalog.json');
global.BattleTMT2 = catalog;
require('../play.pokemonshowdown.com/js/battle-dex-data.js');
require('../play.pokemonshowdown.com/js/battle-dex.js');
require('../play.pokemonshowdown.com/js/battle-scene-stub.js');
require('../play.pokemonshowdown.com/js/battle-text-parser.js');
require('../play.pokemonshowdown.com/js/battle.js');
const vm = require('vm');
global.BattleLog = vm.runInThisContext(fs.readFileSync('play.pokemonshowdown.com/js/battle-log.js', 'utf8') + '\nBattleLog;');
const TMTSearch = vm.runInThisContext(fs.readFileSync('play.pokemonshowdown.com/js/battle-dex-search.js', 'utf8') + '\nDexSearch;');

describe('TMT-05 client catalog routing (not complete battle)', () => {
	it('preserves a catalog-selected stone in premade copies and text exports (synthetic item fixture)', () => {
		const prior = global.BattleTMT2;
		const copy = structuredClone(prior);
		copy.seed.teams[1].sets.find(s => s.species === 'pidgeot').item = 'pidgeotite';
		copy.table.items.pidgeotite = { id: 'pidgeotite', name: 'Pidgeotite' };
		global.BattleTMT2 = copy;
		try {
			assert.equal(TMT2.premade('beta').find(s => s.species === 'pidgeot').item, 'pidgeotite');
			assert.match(TMT2.exportPremade('beta'), /Pidgeot @ Pidgeotite/);
			assert.equal(TMT2.premade('alpha')[0].item, '');
		} finally { global.BattleTMT2 = prior; }
	});
	it('parses completed deterministic simulator mega replay with selected Dex; rejects historical identity',
		{ skip: !catalog.seed.forms?.length }, () => {
			global.BattleText = require('../play.pokemonshowdown.com/data/text/en.js').BattleText;
			const replay = require('./fixtures/tmt2-teambuilder-simulator-replay.json');
			const log = replay.log;
			TMT2.validateReplay(replay);
			const b = new Battle({ debug: true });
			try {
				b.paused = true; b.setQueue(log); b.seekTurn(2);
				assert.equal(b.turn, 2);
				assert.deepEqual(b.p1.pokemon.find(p => p.speciesForme === 'Pidgeot-Mega').getTypeList(), ['Holy', 'Bird', 'Bird']);
				assert.deepEqual(b.dex.species.get('pidgeotmega').requiredItems, ['Pidgeotite']);
				b.seekTurn(Infinity); assert.equal(b.ended, true); assert.equal(log.at(-1), '|win|MegaBeta');
			} finally { b.destroy(); }
		});
	it('provides fixed premades, authoritative EV0 stats and engine-only Struggle', () => {
		for (const team of catalog.seed.teams) {
			assert.equal(TMT2.premade(team.id).length, 3);
			assert.match(TMT2.exportPremade(team.id), /Level: 50\nHardy Nature/);
			for (const s of team.sets) {
				const stats = TMT2.stats(s.species), base = catalog.table.species[s.species].baseStats;
				for (const stat of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) {
					assert.equal(stats[stat], Math.floor((2 * base[stat] + 31) / 2) + (stat === 'hp' ? 60 : 5));
				}
			}
		}
		const copy = TMT2.premade('alpha'); copy[0].evs.atk = 252;
		assert.equal(TMT2.premade('alpha')[0].evs.atk, 0);
		assert.throws(() => TMT2.premade('random'), /Unknown/);
		assert.throws(() => TMT2.stats('mew'), /outside/);
		assert.equal(Dex.forFormat('gen9tmt2seed').moves.get('struggle').basePower, 50);
		assert.equal(catalog.table.moves.struggle, undefined);
	});
	it('uses explicit format routing even without upstream tables, never silently falls back', () => {
		const dex = Dex.forFormat(catalog.metadata.formatName);
		assert.equal(dex.modid, catalog.metadata.modID);
		for (const s of catalog.seed.species) {
			assert.deepEqual(dex.species.get(s.id).types, catalog.table.species[s.id].types);
			assert.deepEqual(dex.species.get(s.id).baseStats, s.baseStats);
			assert.equal(dex.species.get(s.id).name, s.name);
		}
		for (const m of catalog.seed.moves) {
			const actual = dex.moves.get(m.id);
			for (const field of ['name', 'basePower', 'accuracy', 'pp', 'priority', 'category']) assert.equal(actual[field], m[field]);
			assert.deepEqual(actual.flags, m.flags);
			assert.equal(actual.type, catalog.table.moves[m.id].type);
		}
		for (const a of catalog.seed.abilities) assert.equal(dex.abilities.get(a.id).name, a.name);
		for (const t of catalog.seed.types) assert.deepEqual(dex.types.get(t.id).damageTaken, catalog.table.types[t.id].damageTaken);
		assert.equal(dex.items.get('none').name, 'No item');
		assert.equal(dex.species.get('mew').exists, false);
		assert.equal(dex.moves.get('surf').exists, false);
		const saved = global.BattleTMT2;
		delete global.BattleTMT2;
		assert.throws(() => Dex.forFormat('gen9tmt2seed'), /missing or incompatible/);
		global.BattleTMT2 = saved;
		assert.equal(Dex.forFormat('gen9ou').modid, 'gen9');
	});
	it('routes battle/replay tiers and gen messages; detects dataset mismatch', () => {
		const b = new Battle({debug: true, log: ['|gen|9', `|tier|${catalog.metadata.formatName}`, `|tmt2data|${catalog.metadata.version}|${catalog.metadata.datasetHash}|${catalog.metadata.catalogHash}`]});
		assert.equal(b.dex.modid, catalog.metadata.modID);
		assert.deepEqual(b.dex.species.get('pidgeot').types, ['Bird', 'Bird', 'Bird']);
		b.run('|gen|9');
		assert.equal(b.dex.modid, catalog.metadata.modID);
		assert.throws(() => TMT2.verify('bad', catalog.metadata.datasetHash, catalog.metadata.catalogHash), /dataset mismatch/);
		assert.throws(() => TMT2.verify(catalog.metadata.version, catalog.metadata.datasetHash, '0'.repeat(64)), /mismatch/);
		b.destroy();
	});
	it('scopes search, checks all type slots and preserves duplicate display labels', () => {
		const search = new TMTSearch();
		search.setType('pokemon', 'gen9tmt2seed');
		search.find('');
		assert.equal(search.results.length, catalog.seed.species.length);
		search.addFilter(['type', 'Cat']);
		search.find('');
		assert.deepEqual(search.results.map(r => r[1]).sort(), ['eevee', 'floragato']);
		const moves = new TMTSearch();
		moves.setType('move', 'gen9tmt2seed', 'pidgeot');
		moves.find('');
		assert.deepEqual(moves.results.map(r => r[1]).sort(), ['gust', 'protect', 'quickattack', 'tackle']);
		moves.find('surf');
		assert.equal(moves.results.length, 0);
		assert.match(Dex.getTypeIcon('Bird'), />Bird</);
		assert.equal((catalog.table.species.pidgeot.types.map(t => Dex.getTypeIcon(t)).join('').match(/>Bird</g) || []).length, 3);
	});
	it('generated entry points include the local catalog for client and replay', () => {
		for (const file of ['play.pokemonshowdown.com/testclient-new.html', 'play.pokemonshowdown.com/testclient-old.html', 'replay.pokemonshowdown.com/testclient.html']) {
			assert.match(fs.readFileSync(file, 'utf8'), /data\/tmt2-seed.js/);
		}
	});
});

describe('Offline generation failure paths', () => {
	it('rejects unspecified server inputs without creating an upstream checkout', () => {
		const before = fs.existsSync('caches/pokemon-showdown');
		const result = spawnSync(process.execPath, ['build-tools/build-indexes'], {encoding: 'utf8'});
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /automatic clone\/pull is disabled/);
		assert.equal(fs.existsSync('caches/pokemon-showdown'), before);
	});
	it('rejects table drift and symlink output without overwriting unrelated data', () => {
		const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'tmt05-client-'));
		try {
			fs.mkdirSync(path.join(dir, 'build-tools'));
			fs.mkdirSync(path.join(dir, 'tmt2'));
			fs.copyFileSync('build-tools/build-tmt2', path.join(dir, 'build-tools/build-tmt2'));
			const copy = JSON.parse(JSON.stringify(catalog));
			copy.table.species.pidgeot.types = ['Normal', 'Flying'];
			fs.writeFileSync(path.join(dir, 'tmt2/catalog.json'), JSON.stringify(copy));
			const run = () => spawnSync(process.execPath, [path.join(dir, 'build-tools/build-tmt2')], {encoding: 'utf8'});
			assert.match(run().stderr, /table drift/);
			fs.writeFileSync(path.join(dir, 'tmt2/catalog.json'), JSON.stringify(catalog));
			fs.mkdirSync(path.join(dir, 'play.pokemonshowdown.com/data'), {recursive: true});
			const personal = path.join(dir, 'personal.txt');
			fs.writeFileSync(personal, 'preserve');
			fs.symlinkSync(personal, path.join(dir, 'play.pokemonshowdown.com/data/tmt2-seed.js'));
			assert.match(run().stderr, /symlink/);
			assert.equal(fs.readFileSync(personal, 'utf8'), 'preserve');
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});
});

test('TMT-09 gamma export and Dex use the bounded catalog rather than upstream Water/Flying records', () => {
 assert.deepEqual(TMT2.premade('gamma').map(s=>s.species), ['pidgey','pidgeotto','krabby']);
 const dex=Dex.forFormat('gen9tmt2seed');
 for(const [id,types] of Object.entries({pidgey:['Bird'],pidgeotto:['Bird','Bird'],krabby:['Crab']})) {
  assert.deepEqual(dex.species.get(id).types,types);
 }
 assert.match(TMT2.exportPremade('gamma'),/Krabby.*\nAbility: Shell Armor/);
 assert.equal(dex.moves.get('waterpulse').exists,true);
 assert.equal(dex.moves.get('surf').exists,false);
});

test('TMT-08 recorded replay keeps its original identity and cannot masquerade as the expanded dataset', () => {
 const historical=require('./fixtures/tmt2-mega-simulator-replay.json');
 assert.equal(historical.version,'0.2.0');
 assert.throws(()=>TMT2.validateReplay(historical),/mismatch/);
});
