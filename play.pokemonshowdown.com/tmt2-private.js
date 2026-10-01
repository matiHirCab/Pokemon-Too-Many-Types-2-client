/* Minimal private seed client. Server remains authoritative; no public auth/replay service. */
'use strict';
(function (root) {
	const api = {
		endpoint(value) {
			const url = new URL(value);
			if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
				url.username || url.password || url.pathname !== '/showdown/websocket' || url.search || url.hash) {
				throw new Error('Use a loopback WebSocket endpoint without credentials');
			}
			return url.href;
		},
		replay(value) {
			if (value?.kind !== 'tmt2-local-replay-v1' || !Array.isArray(value.log) || value.log.length > 50000 ||
				value.log.some(l => typeof l !== 'string' || l.length > 10000 || l.includes('\n') || !l.startsWith('|') ||
					/^\|(request|challstr|pm|updateuser)\|/.test(l))) throw new Error('Invalid public replay');
			root.TMT2.verify(value.version, value.datasetHash, value.catalogHash);
			const records = value.log.filter(l => l.startsWith('|tmt2data|'));
			const tiers = value.log.filter(l => l.startsWith('|tier|'));
			if (records.length !== 1 || records[0] !== `|tmt2data|${value.version}|${value.datasetHash}|${value.catalogHash}` ||
				tiers.length !== 1 || tiers[0] !== `|tier|${root.TMT2.catalog().metadata.formatName}` ||
				!value.log.some(l => /^\|(win|tie)\|/.test(l))) throw new Error('Incomplete or incompatible replay');
			return value;
		},
	};
	root.TMT2Private = api;
	if (typeof module === 'object') module.exports = api;
	if (!root.document) return;
	const el = id => document.getElementById(id);
	const meta = root.TMT2.catalog().metadata;
	const session = root.sessionStorage;
	const state = api.state = { socket: null, name: '', room: session.getItem('tmt2-room') || '', log: [], request: null, winner: '', sentRQID: null, incoming: false, compatible: false };
	let replayBattle = null;
	const error = message => { el('error').textContent = message; };
	const safe = fn => { try { return fn(); } catch (e) { error(e.message); } };
	const send = (command, room = '') => {
		if (state.socket?.readyState !== 1) throw new Error('Connect to the local server first');
		state.socket.send(`${room}|${command}`);
	};
	api.send = send;
	function uploadTeam() { send(`/utm ${root.Teams.pack(root.TMT2.premade(el('team').value))}`); }
	function showPremade() { session.setItem('tmt2-team', el('team').value); el('premade').textContent = root.TMT2.exportPremade(el('team').value); }
	function render() {
		el('room').textContent = state.room;
		el('log').textContent = state.log.slice(-55).join('\n');
		el('choices').replaceChildren();
		const request = state.request;
		if (request?.side) el('state').textContent = request.side.pokemon.map(p =>
			`${p.details}: ${p.condition} · ${root.Dex.forFormat(meta.formatID).species.get(p.details.split(',')[0]).types.join(' / ')}`).join('\n');
		if (!request || request.wait || state.winner || state.sentRQID === request.rqid) return;
		const button = (text, choice) => {
			const b = document.createElement('button'); b.textContent = text; b.dataset.choice = choice;
			b.onclick = () => safe(() => {
				if (state.sentRQID === request.rqid) return;
				send(`/choose ${choice}|${request.rqid}`, state.room); state.sentRQID = request.rqid; el('choices').replaceChildren();
			});
			el('choices').append(b);
		};
		if (request.teamPreview) { button('Start with listed team order', 'team 123'); return; }
		if (!state.compatible) return;
		if (!request.forceSwitch && request.active?.[0]) {
			for (const [i, move] of request.active[0].moves.entries()) {
				if (!move.disabled && (move.pp === undefined || move.pp > 0)) button(`${move.move} (${move.pp ?? '∞'} PP)`, `move ${i + 1}`);
			}
		}
		for (const [i, p] of (request.side?.pokemon || []).entries()) {
			if (!p.active && !p.condition.endsWith('fnt')) button(`Switch to ${p.details.split(',')[0]}`, `switch ${i + 1}`);
		}
	}
	function receive(message) {
		let room = '';
		for (const line of message.split('\n')) {
			if (line.startsWith('>')) { room = line.slice(1); continue; }
			const parts = line.split('|');
			if (parts[1] === 'updateuser') {
				state.name = parts[2].trim(); el('connection').textContent = `Connected as ${state.name}`;
				if (parts[3] === '1' && state.room) send(`/join ${state.room}`);
			}
			if (parts[1] === 'popup' || parts[1] === 'error' || parts[1] === 'nametaken') {
				error(parts.slice(2).join('|')); state.sentRQID = null;
			}
			if (parts[1] === 'pm' && parts[4]?.startsWith('/challenge')) {
				el('pending').textContent = parts[4] === '/challenge' ? 'Challenge cancelled or accepted' : `${parts[2].trim()} challenged ${parts[3].trim()}`;
				if (parts[3].trim() === state.name) el('opponent').value = parts[2].trim();
				state.incoming = parts[4] !== '/challenge' && parts[3].trim() === state.name;
				el('accept').disabled = !state.incoming;
			}
			if (!room.startsWith('battle-')) continue;
			if (parts[1] === 'init') { state.room = room; session.setItem('tmt2-room', room); state.log = []; state.winner = ''; state.sentRQID = null; state.compatible = false; }
			if (room !== state.room) continue;
			if (parts[1] === 'request') { state.request = JSON.parse(parts.slice(2).join('|') || 'null'); continue; }
			if (['init', 'title', 'users', 'j', 'l', 'J', 'L', 'c', 'c:', 'html', 'uhtml', 'sentchoice', 'error'].includes(parts[1]) || !line) continue;
			if (parts[1] === 'tmt2data') {
				try { root.TMT2.verify(parts[2], parts[3], parts[4]); state.compatible = true; }
				catch (e) { state.request = null; el('choices').replaceChildren(); state.socket?.close(); throw e; }
			}
			state.log.push(line);
			if (parts[1] === 'win' || parts[1] === 'tie') {
				state.winner = parts[1] === 'win' ? parts[2] : 'Tie';
				el('result').textContent = `Result: ${state.winner}`; el('save').disabled = false;
				session.setItem('tmt2-replay', JSON.stringify(exportReplay()));
			}
		}
		if (!state.winner && state.room) el('result').textContent = 'Battle in progress';
		render();
	}
	function exportReplay() {
		return api.replay({ kind: 'tmt2-local-replay-v1', version: meta.version, datasetHash: meta.datasetHash,
			catalogHash: meta.catalogHash, room: state.room, log: state.log.filter(l => !/^\|(request|challstr|pm|updateuser)\|/.test(l)) });
	}
	api.exportReplay = exportReplay;
	function loadReplay(value) {
		const replay = api.replay(value);
		state.socket?.close(); state.socket = null; el('connection').textContent = 'Offline replay';
		replayBattle?.destroy();
		replayBattle = new root.Battle({ debug: true }); replayBattle.setQueue(replay.log); replayBattle.seekTurn(Infinity);
		if (replayBattle.dex.modid !== meta.modID || !replayBattle.ended) throw new Error('Replay failed to resolve the TMT2 mod');
		state.log = replay.log; state.request = null; state.room = replay.room;
		state.winner = replay.log.find(l => /^\|(win|tie)\|/.test(l)).split('|')[2] || 'Tie';
		error(''); el('result').textContent = `Replay result: ${state.winner}`; el('save').disabled = false;
		el('state').textContent = [replayBattle.p1, replayBattle.p2].map(s => `${s.name}: ${s.pokemon.map(p => `${p.name} (${p.getTypeList().join(' / ')})`).join(', ')}`).join('\n');
		session.setItem('tmt2-replay', JSON.stringify(replay)); render();
	}
	api.loadReplay = loadReplay;
	function connect() {
		const endpoint = api.endpoint(el('server').value), name = el('name').value;
		if (!/^[A-Za-z][A-Za-z0-9]{1,17}$/.test(name)) throw new Error('Use a unique local name: 2–18 letters/digits');
		state.socket?.close(); state.socket = new WebSocket(endpoint);
		session.setItem('tmt2-name', name); session.setItem('tmt2-server', endpoint);
		state.socket.onopen = () => send(`/trn ${name},0,`);
		state.socket.onmessage = e => safe(() => receive(e.data));
		state.socket.onclose = () => { el('connection').textContent = 'Disconnected; reconnect to rejoin'; };
		state.socket.onerror = () => error('Local connection failed');
	}
	el('identity').textContent = `Dataset ${meta.version} · ${meta.datasetHash} · ${meta.catalogHash}`;
	el('team').value = session.getItem('tmt2-team') || 'alpha';
	el('team').onchange = showPremade; showPremade(); el('accept').disabled = true;
	el('connect').onclick = () => safe(connect);
	el('challenge').onclick = () => safe(() => { error(''); uploadTeam(); send('/inviteonlynext'); send(`/challenge ${el('opponent').value}, ${meta.formatID}`); });
	el('accept').onclick = () => safe(() => { error(''); uploadTeam(); send(`/accept ${el('opponent').value}`); });
	el('cancel').onclick = () => safe(() => send(`/cancelchallenge ${el('opponent').value}`));
	el('rejoin').onclick = () => safe(() => send(`/join ${state.room}`));
	el('save').onclick = () => safe(() => {
		const url = URL.createObjectURL(new Blob([JSON.stringify(exportReplay(), null, 2)], { type: 'application/json' }));
		const a = document.createElement('a'); a.href = url; a.download = 'tmt2-local-replay.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
	});
	el('replay-file').onchange = async e => { try { loadReplay(JSON.parse(await e.target.files[0].text())); } catch (err) { error(err.message); } };
	el('last-replay').onclick = () => safe(() => loadReplay(JSON.parse(session.getItem('tmt2-replay'))));
	el('name').value = session.getItem('tmt2-name') || ''; el('server').value = session.getItem('tmt2-server') || el('server').value;
	if (new URL(location.href).searchParams.has('replay')) safe(() => loadReplay(JSON.parse(session.getItem('tmt2-replay'))));
	else if (el('name').value) safe(connect);
})(typeof window === 'undefined' ? globalThis : window);
