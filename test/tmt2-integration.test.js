const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const {describe, it} = require('node:test');
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
		assert.equal(search.results.length, 6);
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
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmt05-client-'));
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
