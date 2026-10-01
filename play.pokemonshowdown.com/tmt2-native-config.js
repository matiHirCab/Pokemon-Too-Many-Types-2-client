/* Local-only native Showdown test entry. No login server or remote data fallback. */
(function () {
	'use strict';
	if (!['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('TMT2 local client requires loopback');
	window.Config = {
		version: 'local', bannedHosts: [], whitelist: [], customcolors: {}, testclient: true, tmt2Local: true,
		routes: Object.fromEntries(['root', 'client', 'dex', 'replays', 'users', 'teams'].map(k => [k, location.host])),
		defaultserver: {id: 'local', host: '127.0.0.1', port: 8000},
	};
})();
