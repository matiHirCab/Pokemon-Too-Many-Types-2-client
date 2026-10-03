'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// This reads immutable, already-decoded artwork identified by the reviewed pin.
// It neither fetches assets nor trusts dimensions/paths from a supplied manifest.
function readRegular(filename, limit) {
	for (let at = path.resolve(filename); at !== path.dirname(at); at = path.dirname(at)) {
		if (fs.lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink()) throw Error('Artwork symlink refused');
	}
	const stat = fs.lstatSync(filename);
	if (!stat.isFile() || stat.size > limit) throw Error('Invalid artwork file/size');
	return fs.readFileSync(filename);
}

function loadArtwork(directory, pin) {
	const manifest = readRegular(path.join(directory, 'manifest.json'), 65536);
	if (hash(manifest) !== pin.manifestSha256) throw Error('Artwork manifest mismatch');
	const parsed = JSON.parse(manifest);
	if (!parsed.complete || parsed.files.length !== pin.files.length) throw Error('Incomplete artwork');
	const outputs = {};
	const files = {};
	for (const file of pin.files) {
		const allowed = /^sprites\/(?:ani(?:-back)?\/[a-z0-9]+\.gif|trainers\/(?:rosa|lyra)\.png|pokemonicons(?:-pokeball)?-sheet\.png)$/;
		if (!allowed.test(file.path)) {
			throw Error('Unsafe pinned artwork path');
		}
		if (files[file.path]) throw Error('Duplicate pinned artwork');
		const bytes = readRegular(path.join(directory, file.path), 8 * 1024 * 1024);
		if (bytes.length !== file.sizeBytes || hash(bytes) !== file.sha256) throw Error(`Artwork bytes mismatch: ${file.path}`);
		const target = `tmt2/${file.path}`;
		outputs[target] = bytes;
		files[file.path] = { path: target, sha256: file.sha256, ...(file.gif || file.png) };
	}
	return { outputs, files, manifestSha256: pin.manifestSha256 };
}

function importArtwork(archive, destination, pin) {
	// Accept only this byte-verified upload, not a general-purpose ZIP extractor.
	const bytes = readRegular(archive, 2 * 1024 * 1024);
	if (hash(bytes) !== pin.archiveSha256) throw Error('Artwork ZIP mismatch');
	const expected = new Set(['manifest.json', ...pin.files.map(f => f.path)]);
	const entries = [];
	let offset = 0;
	while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
		const flags = bytes.readUInt16LE(offset + 6);
		const method = bytes.readUInt16LE(offset + 8);
		const size = bytes.readUInt32LE(offset + 18);
		const unpacked = bytes.readUInt32LE(offset + 22);
		const nameLength = bytes.readUInt16LE(offset + 26);
		const extraLength = bytes.readUInt16LE(offset + 28);
		const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
		const start = offset + 30 + nameLength + extraLength;
		if ((flags & ~0x800) || method || size !== unpacked || start + size > bytes.length || !expected.delete(name)) {
			throw Error('Unsupported/unsafe artwork ZIP entry');
		}
		entries.push([name, bytes.subarray(start, start + size)]);
		offset = start + size;
	}
	if (expected.size) throw Error('Incomplete artwork ZIP');
	const target = path.resolve(destination);
	for (let at = target; at !== path.dirname(at); at = path.dirname(at)) {
		if (fs.lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink()) throw Error('Artwork symlink refused');
	}
	if (fs.lstatSync(target, { throwIfNoEntry: false })) throw Error('Artwork destination already exists; preserve it');
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const staging = fs.mkdtempSync(path.join(path.dirname(target), '.tmt2-artwork-'));
	try {
		for (const [name, content] of entries) {
			const file = path.join(staging, name);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, content, { flag: 'wx' });
		}
		loadArtwork(staging, pin);
		// Reserve rather than replacing an existing destination, including an empty directory.
		fs.mkdirSync(target);
		for (const name of fs.readdirSync(staging)) fs.renameSync(path.join(staging, name), path.join(target, name));
	} finally {
		fs.rmSync(staging, { recursive: true, force: true });
	}
}

function validateShowdownPin(pin) {
	if (pin.schemaVersion !== 1 || pin.kind !== 'official-showdown-matching-art-local-evaluation' ||
		pin.sourceRepository !== 'smogon/sprites' || !/^[a-f0-9]{40}$/.test(pin.sourceCommit) ||
		!Array.isArray(pin.mapping) || !pin.mapping.length || pin.mapping.length > 32) {
		throw Error('Invalid Showdown artwork pin');
	}
	const unmatched = pin.unmatchedSpecies || [];
	if (!Array.isArray(unmatched) || unmatched.some(id => !/^[a-z0-9]+$/.test(id)) ||
		new Set(unmatched).size !== unmatched.length || pin.mapping.some(m => unmatched.includes(m.id))) {
		throw Error('Invalid unmatched artwork identity');
	}
	const expected = new Map();
	for (const { id, sourceID } of pin.mapping) {
		if (!/^[a-z0-9]+$/.test(id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sourceID)) throw Error('Unsafe artwork identity');
		for (const facing of ['ani', 'ani-back', 'home-centered']) {
			const target = `sprites/${facing}/${id}.${facing === 'home-centered' ? 'png' : 'gif'}`;
			const source = facing === 'home-centered' ? `src/minisprites/pokemon/home/s${sourceID}.png` :
				`src/models/s${sourceID}${facing === 'ani-back' ? '-b' : ''}.gif`;
			if (expected.has(target)) throw Error('Duplicate artwork identity');
			expected.set(target, source);
		}
	}
	if (!Array.isArray(pin.files) || pin.files.length !== expected.size) throw Error('Incomplete Showdown artwork pin');
	for (const f of pin.files) {
		if (expected.get(f.path) !== f.sourcePath || !/^[a-f0-9]{40}$/.test(f.gitBlobSha1) ||
			!Number.isInteger(f.sizeBytes) || f.sizeBytes < 14 || f.sizeBytes > 8 * 1024 * 1024 ||
			(f.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(f.sha256))) throw Error('Unsafe Showdown artwork pin entry');
		expected.delete(f.path);
	}
}

function verifyShowdownBytes(bytes, file) {
	const blob = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
	if (bytes.length !== file.sizeBytes || blob !== file.gitBlobSha1 ||
		(file.sha256 && hash(bytes) !== file.sha256)) throw Error(`Showdown artwork bytes mismatch: ${file.path}`);
	let width, height;
	if (file.path.endsWith('.gif')) {
		if (!/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) throw Error('Invalid pinned GIF');
		width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8);
	} else {
		if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('Invalid pinned PNG');
		width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
	}
	if (!width || !height || width > 4096 || height > 4096) throw Error('Invalid pinned image dimensions');
	return { width, height, sha256: hash(bytes) };
}

function loadShowdownArtwork(directory, pin) {
	validateShowdownPin(pin);
	const manifest = readRegular(path.join(directory, 'manifest.json'), 131072);
	const parsed = JSON.parse(manifest);
	if (!parsed.complete || parsed.pinSha256 !== hash(JSON.stringify(pin)) ||
		parsed.files?.length !== pin.files.length) throw Error('Showdown artwork manifest mismatch');
	const outputs = {}, files = {};
	for (const f of pin.files) {
		const bytes = readRegular(path.join(directory, f.path), 8 * 1024 * 1024);
		const info = verifyShowdownBytes(bytes, f);
		const recorded = parsed.files.find(x => x.path === f.path);
		if (recorded?.sha256 !== info.sha256) throw Error('Showdown artwork manifest file mismatch');
		const target = `tmt2/${f.path}`; outputs[target] = bytes;
		files[f.path] = { path: target, ...info, source: 'official-showdown-matching-art' };
	}
	return { outputs, files, manifestSha256: hash(manifest) };
}

function composeArtwork(user, official) {
	const outputs = { ...official?.outputs, ...user?.outputs };
	const files = { ...official?.files };
	for (const [name, file] of Object.entries(user?.files || {})) {
		files[name] = { ...file, source: 'user-provided-local' };
	}
	return { outputs, files };
}

module.exports = {
	loadArtwork, importArtwork, loadShowdownArtwork, validateShowdownPin, verifyShowdownBytes, composeArtwork,
};
