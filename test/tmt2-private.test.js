'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
global.window = global;
const page = fs.readFileSync('play.pokemonshowdown.com/tmt2-private.html', 'utf8');
const bootstrap = page.match(/<script>(window\.Config = [\s\S]*?)<\/script>/)[1];
vm.runInNewContext(bootstrap, { window: global, location: { host: '127.0.0.1:8080' } });
assert.equal(Config.routes.root, '127.0.0.1:8080');
global.BattleTMT2 = require('../tmt2/catalog.json');
require('../play.pokemonshowdown.com/js/battle-dex-data.js');
require('../play.pokemonshowdown.com/js/battle-dex.js');
require('../play.pokemonshowdown.com/js/battle-scene-stub.js');
require('../play.pokemonshowdown.com/js/battle-text-parser.js');
global.BattleLog = vm.runInThisContext(fs.readFileSync('play.pokemonshowdown.com/js/battle-log.js', 'utf8') + '\nBattleLog;');
require('../play.pokemonshowdown.com/js/battle.js');
const privateClient = require('../play.pokemonshowdown.com/tmt2-private.js');
const recorded = require('./fixtures/tmt2-browser-replay.json');

test('private client accepts only credential-free loopback endpoints', () => {
	assert.equal(privateClient.endpoint('ws://127.0.0.1:8000/showdown/websocket'), 'ws://127.0.0.1:8000/showdown/websocket');
	for (const url of ['ws://example.com/showdown/websocket', 'wss://localhost/showdown/websocket',
		'ws://name:password@localhost/showdown/websocket', 'ws://localhost/wrong', 'ws://localhost/showdown/websocket?token=value']) {
		assert.throws(() => privateClient.endpoint(url), /loopback/);
	}
});
test('recorded two-browser replay parses with actual client, mod, winner and repeated types without graphics', () => {
	privateClient.replay(recorded);
	const battle = new Battle({ debug: true });
	try {
		battle.setQueue(recorded.log); battle.seekTurn(Infinity);
		assert.equal(battle.ended, true);
		assert.equal(battle.dex.modid, 'gen9tmt2seed');
		assert.equal(battle.p1.name, 'TmtAlpha'); assert.equal(battle.p2.name, 'TmtBeta');
		assert.equal(recorded.log.at(-1), '|win|TmtBeta');
		assert.deepEqual(battle.p2.pokemon.find(p => p.speciesForme === 'Pidgeot').getTypeList(), ['Bird', 'Bird', 'Bird']);
		assert.equal(battle.p1.pokemon.length, 3); assert.equal(battle.p2.pokemon.length, 3);
	} finally { battle.destroy(); }
});
test('local replay rejects drift, base format fallback, incomplete outcomes and private/auth payloads', () => {
	for (const mutate of [r => { r.catalogHash = '0'.repeat(64); }, r => { r.datasetHash = '0'.repeat(64); },
		r => { r.log = r.log.filter(l => !l.startsWith('|win|')); },
		r => { r.log.push('|request|{}'); }, r => { r.log.push('|challstr|credential'); },
		r => { r.log.push('|tier|[Gen 9] OU'); }, r => { r.log.push(r.log.find(l => l.startsWith('|tmt2data|'))); }]) {
		const bad = structuredClone(recorded); mutate(bad); assert.throws(() => privateClient.replay(bad));
	}
});
test('browser controller sends each rqid once and halts choices on live dataset drift', () => {
	const elements = new Map();
	const element = id => {
		if (!elements.has(id)) elements.set(id, { value: id === 'server' ? 'ws://127.0.0.1:8000/showdown/websocket' : '',
			children: [], replaceChildren() { this.children = []; }, append(child) { this.children.push(child); }, dataset: {} });
		return elements.get(id);
	};
	const storage = new Map(), sent = [];
	class Socket {
		readyState = 1;
		send(message) { sent.push(message); }
		close() { this.readyState = 3; }
	}
	const context = { TMT2, Dex, URL, WebSocket: Socket, location: { href: 'http://127.0.0.1/tmt2-private.html' },
		sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
		document: { getElementById: element, createElement: () => ({ dataset: {} }) } };
	context.window = context;
	vm.runInNewContext(fs.readFileSync('play.pokemonshowdown.com/tmt2-private.js', 'utf8'), context);
	element('name').value = 'LocalTest'; element('connect').onclick();
	const socket = context.TMT2Private.state.socket, meta = BattleTMT2.metadata;
	const request = { rqid: 4, side: { pokemon: [{ details: 'Rattata, L50', condition: '105/105', active: true }] },
		active: [{ moves: [{ move: 'Tackle', pp: 30 }] }] };
	socket.onmessage({ data: `>battle-test\n|init|battle\n|tmt2data|${meta.version}|${meta.datasetHash}|${meta.catalogHash}\n|request|${JSON.stringify(request)}` });
	const button = element('choices').children[0]; button.onclick(); button.onclick();
	socket.onmessage({ data: '|queryresponse|unrelated|{}' });
	assert.equal(sent.filter(s => s.includes('/choose')).length, 1);
	assert.equal(element('choices').children.length, 0);
	request.rqid = 5;
	socket.onmessage({ data: `>battle-test\n|request|${JSON.stringify(request)}` });
	assert.equal(element('choices').children.length, 1);
	socket.onmessage({ data: `>battle-test\n|tmt2data|${meta.version}|${'0'.repeat(64)}|${meta.catalogHash}` });
	assert.equal(socket.readyState, 3);
	assert.equal(context.TMT2Private.state.request, null);
	assert.equal(element('choices').children.length, 0);
	assert.match(element('error').textContent, /dataset mismatch/);
});
